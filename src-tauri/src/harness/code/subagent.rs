//! Subagents (`task`): delegation to a **read-only** child agent.
//!
//! The child runs the same Code loop/profile in an ephemeral conversation
//! (session workspace, `read_only` permission, read tools) and returns the
//! final text to the parent; the child conversation is deleted on any outcome
//! (success, error, timeout or cancellation) by an RAII guard.
//!
//! Maximum depth 1: the child catalog excludes `task` and the runner refuses
//! nesting. The child also does not receive MCP, approval/question channels,
//! shell or write tools.
//!
//! Contract: `docs/goals/code-harness/PLAN.md` F8 and `TOOLS.md` §2.6.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use futures_util::future::BoxFuture;
use parking_lot::Mutex;
use tokio_util::sync::CancellationToken;

use crate::catalog::ModelInfo;
use crate::db::Db;
use crate::domain::{
    MessageStatus, PermissionMode, ReasoningMode, ReasoningSelection, Settings, TurnOptions,
    TurnPayload, TurnProfile, UsageInfo,
};
use crate::events::TurnEvent;
use crate::harness::code::questions::QuestionRegistry;
use crate::harness::{self, EventEmitter, HarnessDeps};
use crate::policy::approval::ApprovalRegistry;

/// Short child budget (the parent configures `Settings::code_max_steps`).
pub const SUBAGENT_MAX_STEPS: u32 = 24;
/// Budget of an autonomous worker child: implementing + verifying needs more
/// steps than a read-only investigation.
pub const WORKER_MAX_STEPS: u32 = 48;
/// Maximum delegation time before the parent gives up.
pub const SUBAGENT_TIMEOUT_SECS: u64 = 15 * 60;
/// Autonomous workers run commands and tests, so they get a larger wall-clock
/// budget than read-only scouts.
pub const WORKER_TIMEOUT_SECS: u64 = 30 * 60;
/// Grace period for the child to unwind after cancellation (cleanup).
pub const SUBAGENT_CANCEL_GRACE_SECS: u64 = 5;
/// Hard cap of delegations per turn (cost/loop guardrail).
pub const MAX_DELEGATIONS_PER_TURN: u32 = 4;
/// Hard cap of subagents running at the same time.
pub const MAX_CONCURRENT_SUBAGENTS: usize = 4;
/// Maximum delegation depth (1 level: user session → child).
pub const MAX_DELEGATION_DEPTH: u32 = 1;

/// Delegation kind (defines the child prompt).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubagentKind {
    /// Explore the repository and answer (without editing).
    Explore,
    /// Review the diff/changes and point out problems.
    Review,
    /// General read/investigation work.
    General,
    /// Autonomous worker: edits files and runs commands/checks.
    Worker,
}

impl SubagentKind {
    /// Strict `subagent_type` parser (accepts Portuguese synonyms).
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "explore" | "explorar" | "exploração" | "exploracao" => Some(Self::Explore),
            "review" | "revisor" | "revisão" | "revisao" => Some(Self::Review),
            "general" | "geral" => Some(Self::General),
            "worker" | "executor" | "trabalhador" => Some(Self::Worker),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Explore => "explore",
            Self::Review => "review",
            Self::General => "general",
            Self::Worker => "worker",
        }
    }

    /// `worker` edits files and runs commands; the other kinds are read-only.
    pub fn is_writable(self) -> bool {
        matches!(self, Self::Worker)
    }

    /// Model-step budget of the child turn.
    pub fn max_steps(self) -> u32 {
        if self.is_writable() {
            WORKER_MAX_STEPS
        } else {
            SUBAGENT_MAX_STEPS
        }
    }

    /// Wall-clock timeout enforced by `run_task`.
    pub fn timeout_secs(self) -> u64 {
        if self.is_writable() {
            WORKER_TIMEOUT_SECS
        } else {
            SUBAGENT_TIMEOUT_SECS
        }
    }

    fn instructions(self) -> &'static str {
        match self {
            Self::Explore => {
                "You are an exploration subagent. Read the relevant files, answer the \
                 question with concrete paths and line numbers, and return an objective summary. You \
                 CANNOT edit files, run shell commands, ask the user or delegate — the parent will \
                 make the changes. Return a concise report (lead with the answer, then evidence). \
                 Investigate only what the parent's question needs: batch independent reads/searches \
                 in one step and stop as soon as you can answer."
            }
            Self::Review => {
                "You are a reviewer subagent. Examine the repository changes (git diff/status) \
                 and the parent's request, point out bugs, risks, missing tests and concrete \
                 suggestions. You CANNOT edit files, run shell commands, ask the user or delegate. \
                 Return findings ordered by severity, each with path:line and a concrete fix. \
                 Batch git/read calls in one step and stop when the risks are covered."
            }
            Self::General => {
                "You are a support subagent. Investigate the workspace and answer with a summary \
                 useful to another agent. You CANNOT edit files, run shell commands, ask the user \
                 or delegate. State assumptions and return a concise, self-contained report. \
                 Batch independent reads/searches in one step and stop as soon as the parent's \
                 question is answerable."
            }
            Self::Worker => {
                "You are an autonomous worker subagent. Implement the parent's brief in the \
                 workspace: read the relevant files, edit them, and run commands/checks without \
                 asking for confirmation. You CANNOT ask the user, request approval, delegate, use \
                 MCP, or use computer/browser tools. Batch independent reads in one step, keep \
                 changes scoped to the brief, run the relevant verification (commands run in the \
                 foreground; `run_in_background` is unavailable), and return a concise report with \
                 the files you changed and the command/exit-code evidence. Report changes made by \
                 commands too: they are not journaled. Do not stop at analysis or wait for the \
                 parent."
            }
        }
    }
}

/// Effective parent turn context captured by `run_turn` (not a stale
/// `Conversation` snapshot). The child uses the same route and the parent id as
/// its wire/cache session.
#[derive(Debug, Clone)]
pub struct ParentTurnContext {
    pub conversation_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub workspace_id: Option<String>,
    /// Turn id of the parent request; writable children journal under it.
    pub turn_id: String,
}

/// Delegation request coming from the `task` tool.
#[derive(Debug, Clone)]
pub struct SubagentRequest {
    pub task_call_id: String,
    pub description: String,
    pub prompt: String,
    pub kind: SubagentKind,
    /// Optional `provider/model` (or a model id in the parent provider).
    pub model: Option<String>,
    /// Optional reasoning effort (model-declared values, or `off`).
    pub effort: Option<String>,
}

/// Child result (the text goes to the parent; usage is aggregated in the turn).
#[derive(Debug, Clone)]
pub struct SubagentOutcome {
    pub conversation_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub effort: Option<String>,
    pub text: String,
    pub usage: Option<UsageInfo>,
    pub steps: u32,
    pub duration_ms: u64,
}

/// Runner injected into `ToolCtx` (the implementation lives in the harness,
/// which owns the loop).
pub trait SubagentRunner: Send + Sync {
    fn run(
        &self,
        request: SubagentRequest,
        cancel: CancellationToken,
        progress: Option<Arc<dyn EventEmitter>>,
    ) -> BoxFuture<'static, anyhow::Result<SubagentOutcome>>;
}

struct RunnerImpl {
    deps: HarnessDeps,
    settings: Settings,
    parent: ParentTurnContext,
    depth: u32,
    usage: Arc<Mutex<UsageInfo>>,
}

impl SubagentRunner for RunnerImpl {
    fn run(
        &self,
        request: SubagentRequest,
        cancel: CancellationToken,
        progress: Option<Arc<dyn EventEmitter>>,
    ) -> BoxFuture<'static, anyhow::Result<SubagentOutcome>> {
        if !can_delegate(self.depth) {
            return Box::pin(async move {
                anyhow::bail!(crate::i18n::t("code.subagents.depthExceeded"))
            });
        }
        let deps = self.deps.clone();
        let settings = self.settings.clone();
        let parent = self.parent.clone();
        let depth = self.depth.saturating_add(1);
        let usage = self.usage.clone();
        Box::pin(async move {
            let outcome =
                run_child(deps, settings, parent, request, depth, cancel, progress).await?;
            if let Some(child_usage) = outcome.usage.as_ref() {
                let mut total = usage.lock();
                harness::merge_usage(&mut total, child_usage);
            }
            Ok(outcome)
        })
    }
}

/// Builds the runner for the current Code turn.
pub fn runner(
    deps: &HarnessDeps,
    settings: &Settings,
    parent: ParentTurnContext,
    depth: u32,
    usage: Arc<Mutex<UsageInfo>>,
) -> Arc<dyn SubagentRunner> {
    Arc::new(RunnerImpl {
        deps: deps.clone(),
        settings: settings.clone(),
        parent,
        depth,
        usage,
    })
}

/// Forwards a filtered subset of child events to the parent turn channel.
struct SubagentForwarder {
    parent: Option<Arc<dyn EventEmitter>>,
    task_call_id: String,
}

impl EventEmitter for SubagentForwarder {
    fn emit(&self, event: TurnEvent) {
        let Some(parent) = self.parent.as_ref() else {
            return;
        };
        let Some(event) = forwardable_event(&event) else {
            return;
        };
        parent.emit(TurnEvent::SubagentEvent {
            task_call_id: self.task_call_id.clone(),
            event: Box::new(event),
        });
    }
}

fn forwardable_event(event: &TurnEvent) -> Option<TurnEvent> {
    match event {
        TurnEvent::StepStarted { .. }
        | TurnEvent::ReasoningDelta { .. }
        | TurnEvent::ReasoningDone
        | TurnEvent::TextDelta { .. }
        | TurnEvent::ToolCallStarted { .. }
        | TurnEvent::ToolCallExecuting { .. }
        | TurnEvent::ToolCallArgs { .. }
        | TurnEvent::ToolCallFinished { .. }
        | TurnEvent::ToolProgress { .. }
        | TurnEvent::Usage { .. }
        | TurnEvent::Error { .. }
        | TurnEvent::Cancelled => Some(event.clone()),
        _ => None,
    }
}

/// Guard that cleans up a retained subagent conversation.
///
/// Before the child turn starts (`retain == false`) a setup failure deletes the
/// empty conversation. After it starts the transcript is retained for audit and
/// only its `usage_log` row is removed (usage is aggregated into the parent
/// turn), so billing is not double-counted.
struct SubagentConversation {
    db: Arc<Db>,
    id: String,
    spill_dir: Option<PathBuf>,
    approvals: Option<Arc<ApprovalRegistry>>,
    questions: Option<Arc<QuestionRegistry>>,
    retain: bool,
}

impl Drop for SubagentConversation {
    fn drop(&mut self) {
        if let Some(questions) = &self.questions {
            questions.cancel_for_conversation(&self.id);
        }
        if let Some(approvals) = &self.approvals {
            approvals.cancel_for_conversation(&self.id);
        }
        if self.retain {
            if let Err(error) = self.db.delete_usage_for_conversation(&self.id) {
                eprintln!(
                    "zylara: falha ao remover o usage_log do subagente {}: {error:#}",
                    self.id
                );
            }
            return;
        }
        if let Some(dir) = &self.spill_dir {
            let _ = std::fs::remove_dir_all(dir);
        }
        if let Err(error) = self.db.delete_conversation(&self.id) {
            eprintln!(
                "zylara: falha ao apagar a conversa do subagente {}: {error:#}",
                self.id
            );
        }
    }
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

fn resolve_data_dir(deps: &HarnessDeps) -> Option<PathBuf> {
    deps.data_dir.clone().or_else(|| {
        deps.app
            .as_ref()
            .and_then(|app| crate::config::data_dir(app).ok())
    })
}

fn resolve_route(
    deps: &HarnessDeps,
    parent: &ParentTurnContext,
    requested: Option<&str>,
) -> anyhow::Result<(String, String, ModelInfo)> {
    let requested = requested.map(str::trim).filter(|value| !value.is_empty());
    let (provider_id, model_id) = match requested {
        None => (parent.provider_id.clone(), parent.model_id.clone()),
        Some(value) => match value.split_once('/') {
            Some((provider, model))
                if !provider.trim().is_empty()
                    && !model.trim().is_empty()
                    && deps.catalog.provider(provider.trim()).is_some() =>
            {
                (provider.trim().to_string(), model.trim().to_string())
            }
            _ => (parent.provider_id.clone(), value.to_string()),
        },
    };
    let provider = deps
        .catalog
        .provider(&provider_id)
        .cloned()
        .ok_or_else(|| {
            anyhow::anyhow!(crate::i18n::t_args(
                "code.subagents.providerUnknown",
                &[("provider_id", &provider_id)],
            ))
        })?;
    let model = harness::resolve_model(deps, &provider, &model_id).ok_or_else(|| {
        anyhow::anyhow!(crate::i18n::t_args(
            "code.subagents.modelUnavailable",
            &[("model_id", &model_id), ("provider_id", &provider.id)],
        ))
    })?;
    Ok((provider.id, model.id.clone(), model))
}

fn reasoning_selection(
    model: &ModelInfo,
    effort: Option<&str>,
) -> anyhow::Result<Option<ReasoningSelection>> {
    let Some(value) = effort.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let value = value.to_ascii_lowercase();
    if value == "auto" || value == "default" {
        return Ok(None);
    }
    if value == "off" || value == "none" {
        return Ok(Some(ReasoningSelection {
            mode: ReasoningMode::Off,
            effort: None,
            budget: None,
        }));
    }
    if !model.reasoning {
        anyhow::bail!(crate::i18n::t_args(
            "code.subagents.reasoningUnsupported",
            &[("model_id", &model.id)],
        ));
    }
    let allowed: Vec<&str> = model
        .reasoning_options
        .iter()
        .filter_map(|option| option.efforts())
        .flatten()
        .map(String::as_str)
        .collect();
    if !allowed.is_empty()
        && !allowed
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(&value))
    {
        anyhow::bail!(crate::i18n::t_args(
            "code.subagents.reasoningInvalid",
            &[
                ("value", &value),
                ("model_id", &model.id),
                ("allowed", &allowed.join(", ")),
            ],
        ));
    }
    Ok(Some(ReasoningSelection {
        mode: ReasoningMode::Effort,
        effort: Some(value),
        budget: None,
    }))
}

fn emit_started(
    progress: &Option<Arc<dyn EventEmitter>>,
    request: &SubagentRequest,
    conversation_id: &str,
    provider_id: &str,
    model_id: &str,
    effort: Option<&str>,
) {
    if let Some(progress) = progress.as_ref() {
        progress.emit(TurnEvent::SubagentStarted {
            task_call_id: request.task_call_id.clone(),
            conversation_id: conversation_id.to_string(),
            subagent_type: request.kind.as_str().to_string(),
            description: request.description.clone(),
            prompt: request.prompt.clone(),
            provider_id: provider_id.to_string(),
            model_id: model_id.to_string(),
            effort: effort.map(str::to_string),
        });
    }
}

fn emit_finished(
    progress: &Option<Arc<dyn EventEmitter>>,
    task_call_id: &str,
    conversation_id: Option<String>,
    status: &str,
    usage: Option<UsageInfo>,
    duration_ms: u64,
    error: Option<String>,
) {
    if let Some(progress) = progress.as_ref() {
        progress.emit(TurnEvent::SubagentFinished {
            task_call_id: task_call_id.to_string(),
            conversation_id,
            status: status.to_string(),
            usage,
            duration_ms,
            error,
        });
    }
}

async fn run_child(
    deps: HarnessDeps,
    settings: Settings,
    parent: ParentTurnContext,
    request: SubagentRequest,
    depth: u32,
    cancel: CancellationToken,
    progress: Option<Arc<dyn EventEmitter>>,
) -> anyhow::Result<SubagentOutcome> {
    let db: Arc<Db> = deps.db.clone();
    let data_dir = resolve_data_dir(&deps);
    let (provider_id, model_id, model) =
        resolve_route(&deps, &parent, request.model.as_deref())?;
    let reasoning = reasoning_selection(&model, request.effort.as_deref())?;
    let effort = request
        .effort
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase);
    let title = crate::i18n::t_args(
        "code.subagents.title",
        &[("description", &truncate(request.description.trim(), 48))],
    );
    let child = db.create_subagent_conversation(
        &title,
        &provider_id,
        &model_id,
        &parent.conversation_id,
        &request.task_call_id,
        request.kind.as_str(),
    )?;
    // Created immediately after the conversation exists: setup failures delete
    // the empty child; once the turn starts the transcript is retained.
    let mut guard = SubagentConversation {
        db: db.clone(),
        id: child.id.clone(),
        spill_dir: data_dir
            .as_ref()
            .map(|dir| dir.join("spill").join(&child.id)),
        approvals: deps.approvals.clone(),
        questions: deps.questions.clone(),
        retain: false,
    };
    db.set_conversation_workspace(&child.id, parent.workspace_id.as_deref())?;
    // The child is read-only for investigation kinds; a worker inherits the
    // parent's autonomous envelope (the caller already verified the parent
    // mode) and gets write/shell tools. The catalog is the execution boundary.
    let child_mode = if request.kind.is_writable() {
        PermissionMode::Autonomous
    } else {
        PermissionMode::ReadOnly
    };
    db.set_conversation_permission_mode(&child.id, child_mode)?;

    // The parent request goes **once** in the user message. The override has
    // only the constant kind instructions, so the child prefix stays stable and
    // cache-reusable across delegations of the same kind.
    let instructions = format!(
        "# Subagent instructions\n\n{}",
        request.kind.instructions()
    );
    let payload = TurnPayload {
        conversation_id: child.id.clone(),
        content: request.prompt.clone(),
        attachment_ids: Vec::new(),
        provider_id: provider_id.clone(),
        model_id: model_id.clone(),
        reasoning,
        options: TurnOptions {
            max_steps: request.kind.max_steps(),
            delegation_depth: depth,
            web_search: false,
            create_files: false,
            run_code: false,
            subagent_write: request.kind.is_writable(),
            journal_owner: request.kind.is_writable().then(|| {
                crate::domain::JournalOwner {
                    conversation_id: parent.conversation_id.clone(),
                    turn_id: parent.turn_id.clone(),
                }
            }),
            system_prompt_override: Some(instructions),
            wire_session_id: Some(parent.conversation_id.clone()),
            ..Default::default()
        },
        profile: TurnProfile::Code,
        turn_kind: crate::domain::TurnKind::User,
        goal_request: false,
        turn_id: None,
    };
    emit_started(
        &progress,
        &request,
        &child.id,
        &provider_id,
        &model_id,
        effort.as_deref(),
    );
    guard.retain = true;
    let emitter: Arc<dyn EventEmitter> = Arc::new(SubagentForwarder {
        parent: progress.clone(),
        task_call_id: request.task_call_id.clone(),
    });
    let started = Instant::now();
    let result = harness::run_turn(deps, payload, settings, emitter, cancel).await;
    let duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            emit_finished(
                &progress,
                &request.task_call_id,
                Some(child.id.clone()),
                "error",
                None,
                duration_ms,
                Some(format!("{error:#}")),
            );
            return Err(error);
        }
    };
    if let Some(error) = result.error.as_deref() {
        emit_finished(
            &progress,
            &request.task_call_id,
            Some(child.id.clone()),
            "error",
            result.usage.clone(),
            duration_ms,
            Some(error.to_string()),
        );
        anyhow::bail!("subagente falhou: {error}");
    }
    match result.assistant_message.status {
        // Subagents do not run the completion gate; a usable report stays a
        // successful child result.
        MessageStatus::Complete | MessageStatus::Incomplete => {}
        MessageStatus::Cancelled => {
            emit_finished(
                &progress,
                &request.task_call_id,
                Some(child.id.clone()),
                "cancelled",
                result.usage.clone(),
                duration_ms,
                None,
            );
            anyhow::bail!(crate::i18n::t("code.subagents.cancelled"))
        }
        MessageStatus::Error => {
            emit_finished(
                &progress,
                &request.task_call_id,
                Some(child.id.clone()),
                "error",
                result.usage.clone(),
                duration_ms,
                Some(crate::i18n::t("code.subagents.endedWithError")),
            );
            anyhow::bail!(crate::i18n::t("code.subagents.endedWithError"))
        }
        MessageStatus::Streaming => {
            emit_finished(
                &progress,
                &request.task_call_id,
                Some(child.id.clone()),
                "error",
                result.usage.clone(),
                duration_ms,
                Some(crate::i18n::t("code.subagents.endedIncomplete")),
            );
            anyhow::bail!(crate::i18n::t("code.subagents.endedIncomplete"))
        }
    }
    let text = result.assistant_message.content.trim().to_string();
    if text.is_empty() {
        emit_finished(
            &progress,
            &request.task_call_id,
            Some(child.id.clone()),
            "error",
            result.usage.clone(),
            duration_ms,
            Some(crate::i18n::t("code.subagents.endedWithoutAnswer")),
        );
        anyhow::bail!(crate::i18n::t("code.subagents.endedWithoutAnswer"));
    }
    let steps = u32::try_from(result.assistant_message.trace.len()).unwrap_or(u32::MAX);
    let usage = result.usage;
    emit_finished(
        &progress,
        &request.task_call_id,
        Some(child.id.clone()),
        "done",
        usage.clone(),
        duration_ms,
        None,
    );
    Ok(SubagentOutcome {
        conversation_id: child.id,
        provider_id,
        model_id,
        effort,
        text,
        usage,
        steps,
        duration_ms,
    })
}

/// Only the top-level session can delegate (maximum 1 subagent level).
pub fn can_delegate(depth: u32) -> bool {
    depth < MAX_DELEGATION_DEPTH
}

/// Tool names visible to a subagent (read-only).
pub fn readonly_tools() -> &'static [&'static str] {
    &[
        "read_file",
        "list_dir",
        "search_files",
        "search_text",
        "read_tool_output",
        "git_status",
        "git_diff",
        "git_log",
    ]
}

/// Tool names of an autonomous worker subagent: read tools + workspace
/// mutation + shell/checks + the task ledger. No MCP, `ask_user`, plan/goal,
/// nested delegation, UI validation, computer/browser or background jobs.
pub fn worker_tools() -> &'static [&'static str] {
    &[
        "read_file",
        "list_dir",
        "search_files",
        "search_text",
        "read_tool_output",
        "git_status",
        "git_diff",
        "git_log",
        "write_file",
        "edit_file",
        "run_command",
        "run_checks",
        "todo_write",
    ]
}

/// True when a `task` call's `subagent_type` parses to `worker`.
pub fn is_worker_call(arguments: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|value| {
            value
                .get("subagent_type")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        })
        .and_then(|value| SubagentKind::parse(&value))
        .is_some_and(SubagentKind::is_writable)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(
        streamer: crate::harness::ProviderStreamer,
    ) -> (Arc<Db>, HarnessDeps, crate::domain::Conversation) {
        use crate::domain::CONVERSATION_MODE_CODE;
        use crate::harness::CredentialOverride;

        let db = Arc::new(Db::open_in_memory().expect("db"));
        let parent = db
            .create_conversation_with_mode(
                "Pai",
                "opencode-go",
                "deepseek-v4.1-flash",
                CONVERSATION_MODE_CODE,
            )
            .expect("conversa pai");
        let data_dir =
            std::env::temp_dir().join(format!("zylara-subagent-{}", uuid::Uuid::new_v4()));
        let deps = HarnessDeps {
            app: None,
            db: db.clone(),
            http: reqwest::Client::new(),
            search_http: reqwest::Client::new(),
            catalog: crate::catalog::CatalogFile::load().expect("catalog"),
            streamer: Some(streamer),
            credential_override: Some(CredentialOverride::ApiKey("k".into())),
            refresh_override: None,
            model_source: None,
            api_key_override: None,
            data_dir: Some(data_dir),
            skills_roots: Some(Vec::new()),
            approvals: None,
            observed: None,
            jobs: None,
            questions: None,
            mcp: None,
        };
        (db, deps, parent)
    }

    fn parent_context(parent: &crate::domain::Conversation) -> ParentTurnContext {
        ParentTurnContext {
            conversation_id: parent.id.clone(),
            provider_id: parent.provider_id.clone(),
            model_id: parent.model_id.clone(),
            workspace_id: None,
            turn_id: "parent-turn".into(),
        }
    }

    fn request(prompt: &str) -> SubagentRequest {
        SubagentRequest {
            task_call_id: "task-call-1".to_string(),
            description: "Explorar src".to_string(),
            prompt: prompt.to_string(),
            kind: SubagentKind::Explore,
            model: None,
            effort: None,
        }
    }

    #[tokio::test]
    async fn runner_executes_a_child_turn_and_retains_the_transcript() {
        use crate::domain::{Settings, CONVERSATION_MODE_CODE};
        use crate::harness::CredentialOverride;
        use crate::providers::ProviderEvent;

        let db = std::sync::Arc::new(crate::db::Db::open_in_memory().expect("db"));
        let parent = db
            .create_conversation_with_mode(
                "Pai",
                "opencode-go",
                "deepseek-v4.1-flash",
                CONVERSATION_MODE_CODE,
            )
            .expect("conversa pai");
        let streamer: crate::harness::ProviderStreamer = std::sync::Arc::new(|_request, sink| {
            Box::pin(async move {
                let _ = sink.send(ProviderEvent::TextDelta(
                    "achei src/app.ts com duas constantes".to_string(),
                ));
                let _ = sink.send(ProviderEvent::Done);
                Ok(())
            })
        });
        let data_dir =
            std::env::temp_dir().join(format!("zylara-subagent-{}", uuid::Uuid::new_v4()));
        let deps = HarnessDeps {
            app: None,
            db: db.clone(),
            http: reqwest::Client::new(),
            search_http: reqwest::Client::new(),
            catalog: crate::catalog::CatalogFile::load().expect("catalog"),
            streamer: Some(streamer),
            credential_override: Some(CredentialOverride::ApiKey("k".into())),
            refresh_override: None,
            model_source: None,
            api_key_override: None,
            data_dir: Some(data_dir),
            skills_roots: Some(Vec::new()),
            approvals: None,
            observed: None,
            jobs: None,
            questions: None,
            mcp: None,
        };
        let settings = Settings::default();
        let usage = Arc::new(Mutex::new(UsageInfo::default()));
        let runner = runner(
            &deps,
            &settings,
            ParentTurnContext {
                conversation_id: parent.id.clone(),
                provider_id: parent.provider_id.clone(),
                model_id: parent.model_id.clone(),
                workspace_id: None,
                turn_id: "parent-turn".into(),
            },
            0,
            usage,
        );
        let outcome = runner
            .run(
                SubagentRequest {
                    task_call_id: "task-call-1".to_string(),
                    description: "Explorar src".to_string(),
                    prompt: "O que há em src/app.ts?".to_string(),
                    kind: SubagentKind::Explore,
                    model: None,
                    effort: None,
                },
                CancellationToken::new(),
                None,
            )
            .await
            .expect("resumo do filho");
        assert!(outcome.text.contains("achei src/app.ts"));
        // The child transcript is retained but hidden from the sidebar.
        assert_eq!(db.list_conversations().expect("conversas").len(), 1);
        assert_eq!(
            db.list_subagent_conversations(&parent.id)
                .expect("subagentes")
                .len(),
            1
        );
        assert!(db
            .get_conversation(&outcome.conversation_id)
            .expect("conversa filha")
            .is_some());
    }

    #[tokio::test]
    async fn child_prompt_is_not_duplicated_and_uses_parent_session_id() {
        use crate::providers::{HistoryMessage, HistoryRole, ProviderEvent};

        let captured = Arc::new(parking_lot::Mutex::new(Vec::<
            (String, Vec<HistoryMessage>, String),
        >::new()));
        let captured_for_stream = captured.clone();
        let streamer: crate::harness::ProviderStreamer = Arc::new(move |request, sink| {
            captured_for_stream.lock().push((
                request.system_prompt.clone(),
                request.history.clone(),
                request.config.session_id.clone(),
            ));
            Box::pin(async move {
                let _ = sink.send(ProviderEvent::Usage(UsageInfo {
                    input_tokens: Some(10),
                    output_tokens: Some(5),
                    total_tokens: Some(15),
                    ..Default::default()
                }));
                let _ = sink.send(ProviderEvent::TextDelta("resumo".to_string()));
                let _ = sink.send(ProviderEvent::Done);
                Ok(())
            })
        });
        let (db, deps, parent) = fixture(streamer);
        let usage = Arc::new(Mutex::new(UsageInfo::default()));
        let runner = runner(&deps, &Settings::default(), parent_context(&parent), 0, usage.clone());
        let sentinel = "SENTINEL_PARENT_REQUEST";
        let outcome = runner
            .run(request(sentinel), CancellationToken::new(), None)
            .await
            .expect("resumo");
        assert!(outcome.steps <= 1);
        assert!(outcome.usage.is_some());
        assert_eq!(usage.lock().input_tokens, Some(10));
        let captured = captured.lock();
        let (system_prompt, history, session_id) = &captured[0];
        assert!(system_prompt.contains("exploration subagent"));
        assert!(!system_prompt.contains(sentinel));
        assert_eq!(session_id, &parent.id);
        let sentinel_messages = history
            .iter()
            .filter(|message| message.role == HistoryRole::User)
            .filter(|message| message.text.contains(sentinel))
            .count();
        assert_eq!(sentinel_messages, 1, "o prompt deve aparecer uma única vez");
        assert_eq!(db.list_conversations().expect("conversas").len(), 1);
    }

    #[tokio::test]
    async fn child_events_are_forwarded_to_the_parent_recorder() {
        use crate::providers::ProviderEvent;

        #[derive(Default)]
        struct Recorder {
            events: parking_lot::Mutex<Vec<TurnEvent>>,
        }
        impl EventEmitter for Recorder {
            fn emit(&self, event: TurnEvent) {
                self.events.lock().push(event);
            }
        }

        let streamer: crate::harness::ProviderStreamer = Arc::new(|_request, sink| {
            Box::pin(async move {
                let _ = sink.send(ProviderEvent::TextDelta("olá do filho".to_string()));
                let _ = sink.send(ProviderEvent::Done);
                Ok(())
            })
        });
        let (db, deps, parent) = fixture(streamer);
        let recorder = Arc::new(Recorder::default());
        let progress: Arc<dyn EventEmitter> = recorder.clone();
        let runner = runner(
            &deps,
            &Settings::default(),
            parent_context(&parent),
            0,
            Arc::new(Mutex::new(UsageInfo::default())),
        );
        let outcome = runner
            .run(
                request("diga olá"),
                CancellationToken::new(),
                Some(progress),
            )
            .await
            .expect("resumo");
        let events = recorder.events.lock();
        assert!(events.iter().any(|event| matches!(event, TurnEvent::SubagentStarted { .. })));
        assert!(events.iter().any(|event| matches!(
            event,
            TurnEvent::SubagentEvent { event, .. }
                if matches!(event.as_ref(), TurnEvent::TextDelta { delta } if delta == "olá do filho")
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            TurnEvent::SubagentFinished { conversation_id: Some(id), .. }
                if id == &outcome.conversation_id
        )));
        assert!(db
            .get_conversation(&outcome.conversation_id)
            .expect("filho")
            .is_some());
    }

    #[tokio::test]
    async fn aborting_the_runner_retains_the_child_transcript() {
        let started = Arc::new(tokio::sync::Notify::new());
        let started_for_stream = started.clone();
        let streamer: crate::harness::ProviderStreamer = Arc::new(move |_request, sink| {
            let started = started_for_stream.clone();
            Box::pin(async move {
                // Keep the sender alive: a dropped `sink` would close the
                // channel and the harness loop would leave the select before
                // cancellation.
                let _sink = sink;
                started.notify_one();
                std::future::pending::<anyhow::Result<()>>().await
            })
        });
        let (db, deps, parent) = fixture(streamer);
        let runner = runner(
            &deps,
            &Settings::default(),
            parent_context(&parent),
            0,
            Arc::new(Mutex::new(UsageInfo::default())),
        );
        let handle = tokio::spawn(runner.run(request("pending"), CancellationToken::new(), None));
        started.notified().await;
        assert_eq!(
            db.list_subagent_conversations(&parent.id)
                .expect("subagentes")
                .len(),
            1
        );
        handle.abort();
        let _ = handle.await;
        assert_eq!(db.list_conversations().expect("conversas").len(), 1);
        assert_eq!(
            db.list_subagent_conversations(&parent.id)
                .expect("subagentes")
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn cancelling_the_child_finishes_and_keeps_the_transcript() {
        let started = Arc::new(tokio::sync::Notify::new());
        let started_for_stream = started.clone();
        let streamer: crate::harness::ProviderStreamer = Arc::new(move |_request, sink| {
            let started = started_for_stream.clone();
            Box::pin(async move {
                let _sink = sink;
                started.notify_one();
                std::future::pending::<anyhow::Result<()>>().await
            })
        });
        let (db, deps, parent) = fixture(streamer);
        let runner = runner(
            &deps,
            &Settings::default(),
            parent_context(&parent),
            0,
            Arc::new(Mutex::new(UsageInfo::default())),
        );
        let cancel = CancellationToken::new();
        let handle = tokio::spawn(runner.run(request("pending"), cancel.clone(), None));
        started.notified().await;
        cancel.cancel();
        let completed = tokio::time::timeout(std::time::Duration::from_secs(2), handle).await;
        assert!(completed.is_ok(), "o filho não terminou após o cancelamento");
        assert!(completed.expect("timeout").expect("join").is_err());
        assert_eq!(db.list_conversations().expect("conversas").len(), 1);
        assert_eq!(
            db.list_subagent_conversations(&parent.id)
                .expect("subagentes")
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn provider_failure_is_not_masked_as_a_successful_summary() {
        use crate::providers::ProviderEvent;

        let streamer: crate::harness::ProviderStreamer = Arc::new(|_request, sink| {
            Box::pin(async move {
                let _ = sink.send(ProviderEvent::TextDelta("parcial".to_string()));
                Err(anyhow::anyhow!("provider boom"))
            })
        });
        let (db, deps, parent) = fixture(streamer);
        let runner = runner(
            &deps,
            &Settings::default(),
            parent_context(&parent),
            0,
            Arc::new(Mutex::new(UsageInfo::default())),
        );
        let error = runner
            .run(request("falhe"), CancellationToken::new(), None)
            .await
            .expect_err("erro do provider");
        let message = format!("{error:#}");
        assert!(message.contains("provider boom"), "{message}");
        assert_eq!(db.list_conversations().expect("conversas").len(), 1);
        assert_eq!(
            db.list_subagent_conversations(&parent.id)
                .expect("subagentes")
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn workspace_failure_after_creation_still_cleans_up() {
        let streamer: crate::harness::ProviderStreamer = Arc::new(|_request, sink| {
            Box::pin(async move {
                let _ = sink.send(crate::providers::ProviderEvent::TextDelta("ok".to_string()));
                let _ = sink.send(crate::providers::ProviderEvent::Done);
                Ok(())
            })
        });
        let (db, deps, parent) = fixture(streamer);
        let mut context = parent_context(&parent);
        context.workspace_id = Some("ws-inexistente".to_string());
        let runner = runner(
            &deps,
            &Settings::default(),
            context,
            0,
            Arc::new(Mutex::new(UsageInfo::default())),
        );
        let error = runner
            .run(request("x"), CancellationToken::new(), None)
            .await
            .expect_err("workspace inválido");
        assert!(format!("{error:#}").contains("workspace"), "{error:#}");
        assert_eq!(db.list_conversations().expect("conversas").len(), 1);
        assert!(db
            .list_subagent_conversations(&parent.id)
            .expect("subagentes")
            .is_empty());
    }

    #[test]
    fn model_and_effort_are_validated_for_the_child_route() {
        let streamer: crate::harness::ProviderStreamer = Arc::new(|_request, sink| {
            Box::pin(async move {
                let _ = sink.send(crate::providers::ProviderEvent::TextDelta("ok".to_string()));
                let _ = sink.send(crate::providers::ProviderEvent::Done);
                Ok(())
            })
        });
        let (_db, deps, parent) = fixture(streamer);
        let context = parent_context(&parent);
        let model = deps
            .catalog
            .model("opencode-go", "deepseek-v4.1-flash")
            .expect("modelo do fixture");
        assert!(reasoning_selection(&model, None).expect("auto").is_none());
        assert_eq!(
            reasoning_selection(&model, Some("high"))
                .expect("effort válido")
                .and_then(|selection| selection.effort),
            Some("high".to_string())
        );
        assert!(reasoning_selection(&model, Some("not-an-effort")).is_err());
        let (provider, model_id, _) = resolve_route(
            &deps,
            &context,
            Some("opencode-go/deepseek-v4.1-flash"),
        )
        .expect("rota válida");
        assert_eq!(provider, "opencode-go");
        assert_eq!(model_id, "deepseek-v4.1-flash");
        assert!(resolve_route(&deps, &context, Some("nope/model")).is_err());
    }

    #[tokio::test]
    async fn worker_child_writes_files_and_journals_under_the_parent_turn() {
        use crate::domain::Settings;
        use crate::providers::ProviderEvent;
        use std::sync::atomic::{AtomicUsize, Ordering};

        let calls = Arc::new(AtomicUsize::new(0));
        let first_tools = Arc::new(Mutex::new(Vec::<String>::new()));
        let streamer: crate::harness::ProviderStreamer = {
            let calls = calls.clone();
            let first_tools = first_tools.clone();
            Arc::new(move |request, sink| {
                let calls = calls.clone();
                let first_tools = first_tools.clone();
                Box::pin(async move {
                    if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                        *first_tools.lock() =
                            request.tools.iter().map(|tool| tool.name.clone()).collect();
                        let args = r#"{"path":"a.txt","content":"oi"}"#;
                        let _ = sink.send(ProviderEvent::ToolCallStart {
                            index: 0,
                            id: "write-1".to_string(),
                            name: "write_file".to_string(),
                        });
                        let _ = sink.send(ProviderEvent::ToolCallArgsDelta {
                            index: 0,
                            delta: args.to_string(),
                        });
                        let _ = sink.send(ProviderEvent::ToolCallDone {
                            index: 0,
                            arguments: args.to_string(),
                        });
                    } else {
                        let _ =
                            sink.send(ProviderEvent::TextDelta("arquivo criado".to_string()));
                    }
                    let _ = sink.send(ProviderEvent::Done);
                    Ok(())
                })
            })
        };
        let (db, deps, parent) = fixture(streamer);
        let workspace_dir =
            std::env::temp_dir().join(format!("zylara-worker-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&workspace_dir).expect("workspace dir");
        let workspace = db
            .create_workspace("worker-test", &workspace_dir.to_string_lossy())
            .expect("workspace");
        db.set_workspace_trusted(&workspace.id, true).expect("trusted");
        db.set_conversation_workspace(&parent.id, Some(&workspace.id))
            .expect("workspace da conversa");
        let context = ParentTurnContext {
            conversation_id: parent.id.clone(),
            provider_id: parent.provider_id.clone(),
            model_id: parent.model_id.clone(),
            workspace_id: Some(workspace.id.clone()),
            turn_id: "parent-turn".into(),
        };
        let usage = Arc::new(Mutex::new(UsageInfo::default()));
        let runner = runner(&deps, &Settings::default(), context, 0, usage);
        let mut request = request("Crie a.txt com oi");
        request.kind = SubagentKind::Worker;
        let outcome = runner
            .run(request, CancellationToken::new(), None)
            .await
            .expect("worker");
        assert_eq!(
            std::fs::read_to_string(workspace_dir.join("a.txt")).expect("a.txt"),
            "oi"
        );
        let journal = db
            .list_file_journal_for_turn(&parent.id, "parent-turn")
            .expect("journal");
        assert!(
            journal.iter().any(|entry| entry.path == "a.txt"),
            "{journal:?}"
        );
        let child = db
            .get_conversation(&outcome.conversation_id)
            .expect("conversa")
            .expect("filho");
        assert_eq!(child.permission_mode, PermissionMode::Autonomous);
        let tools = first_tools.lock().clone();
        for name in ["write_file", "run_command"] {
            assert!(tools.iter().any(|tool| tool == name), "faltou {name}: {tools:?}");
        }
        for name in ["ask_user", "task"] {
            assert!(!tools.iter().any(|tool| tool == name), "sobrou {name}: {tools:?}");
        }
    }

    #[test]
    fn depth_guard_allows_only_the_top_level() {
        assert!(can_delegate(0));
        assert!(!can_delegate(1));
        assert!(!can_delegate(3));
    }

    #[test]
    fn kinds_parse_and_describe() {
        assert_eq!(SubagentKind::parse("review"), Some(SubagentKind::Review));
        assert_eq!(SubagentKind::parse("explore"), Some(SubagentKind::Explore));
        assert_eq!(SubagentKind::parse("geral"), Some(SubagentKind::General));
        assert_eq!(SubagentKind::parse("worker"), Some(SubagentKind::Worker));
        assert_eq!(SubagentKind::parse("executor"), Some(SubagentKind::Worker));
        assert_eq!(SubagentKind::parse("x"), None);
        assert!(SubagentKind::Review.instructions().contains("reviewer"));
        assert!(SubagentKind::Worker.instructions().contains("autonomous worker"));
        assert!(!SubagentKind::Explore.is_writable());
        assert!(SubagentKind::Worker.is_writable());
        assert_eq!(SubagentKind::Worker.max_steps(), WORKER_MAX_STEPS);
        assert_eq!(SubagentKind::Worker.timeout_secs(), WORKER_TIMEOUT_SECS);
        assert_eq!(SubagentKind::Explore.max_steps(), SUBAGENT_MAX_STEPS);
        for kind in [
            SubagentKind::Explore,
            SubagentKind::Review,
            SubagentKind::General,
            SubagentKind::Worker,
        ] {
            assert!(
                kind.instructions().contains("one step"),
                "{kind:?} sem orientação de economia de passos"
            );
        }
    }

    #[test]
    fn worker_tools_add_mutation_and_shell_without_interaction() {
        let tools = worker_tools();
        for name in ["read_file", "write_file", "edit_file", "run_command", "run_checks", "todo_write"] {
            assert!(tools.contains(&name), "{name} deveria estar no worker");
        }
        for name in ["ask_user", "task", "goal", "submit_plan", "validate_ui", "mcp__fake__echo", "job_list"] {
            assert!(!tools.contains(&name), "{name} não deveria estar no worker");
        }
    }

    #[test]
    fn worker_call_detection_reads_the_subagent_type() {
        assert!(is_worker_call(r#"{"subagent_type":"worker"}"#));
        assert!(is_worker_call(r#"{"subagent_type":"executor"}"#));
        assert!(!is_worker_call(r#"{"subagent_type":"explore"}"#));
        assert!(!is_worker_call(r#"{"description":"x","prompt":"y"}"#));
        assert!(!is_worker_call("not json"));
    }

    #[test]
    fn readonly_tools_contain_no_mutating_tool() {
        let tools = readonly_tools();
        assert!(tools.contains(&"read_file"));
        assert!(!tools.contains(&"write_file"));
        assert!(!tools.contains(&"run_command"));
        assert!(!tools.contains(&"task"));
        // The goal is top-level session state: a subagent does not see `goal`.
        assert!(!tools.contains(&"goal"));
        assert!(!tools.contains(&"todo_write"));
        assert!(!tools.contains(&"submit_plan"));
        assert!(!tools.contains(&"ask_user"));
        assert!(!tools.contains(&"mcp__fake__echo"));
    }

    #[test]
    fn truncate_keeps_it_short() {
        assert_eq!(truncate("abc", 10), "abc");
        assert_eq!(truncate("abcdef", 4).chars().count(), 4);
    }
}
