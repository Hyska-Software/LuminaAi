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

use crate::db::Db;
use crate::domain::{
    MessageStatus, PermissionMode, Settings, TurnOptions, TurnPayload, TurnProfile, UsageInfo,
    CONVERSATION_MODE_CODE,
};
use crate::events::TurnEvent;
use crate::harness::code::questions::QuestionRegistry;
use crate::harness::{self, EventEmitter, HarnessDeps};
use crate::policy::approval::ApprovalRegistry;

/// Short child budget (the parent configures `Settings::code_max_steps`).
pub const SUBAGENT_MAX_STEPS: u32 = 24;
/// Maximum delegation time before the parent gives up.
pub const SUBAGENT_TIMEOUT_SECS: u64 = 15 * 60;
/// Grace period for the child to unwind after cancellation (cleanup).
pub const SUBAGENT_CANCEL_GRACE_SECS: u64 = 5;
/// Hard cap of delegations per turn (cost/loop guardrail).
pub const MAX_DELEGATIONS_PER_TURN: u32 = 4;
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
}

impl SubagentKind {
    /// Strict `subagent_type` parser (accepts Portuguese synonyms).
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "explore" | "explorar" | "exploração" | "exploracao" => Some(Self::Explore),
            "review" | "revisor" | "revisão" | "revisao" => Some(Self::Review),
            "general" | "geral" => Some(Self::General),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Explore => "explore",
            Self::Review => "review",
            Self::General => "general",
        }
    }

    fn instructions(self) -> &'static str {
        match self {
            Self::Explore => {
                "You are an exploration subagent. Read the relevant files, answer the \
                 question with concrete paths and line numbers, and return an objective summary. You \
                 CANNOT edit files, run shell commands, ask the user or delegate — the parent will \
                 make the changes. Return a concise report (lead with the answer, then evidence)."
            }
            Self::Review => {
                "You are a reviewer subagent. Examine the repository changes (git diff/status) \
                 and the parent's request, point out bugs, risks, missing tests and concrete \
                 suggestions. You CANNOT edit files, run shell commands, ask the user or delegate. \
                 Return findings ordered by severity, each with path:line and a concrete fix."
            }
            Self::General => {
                "You are a support subagent. Investigate the workspace and answer with a summary \
                 useful to another agent. You CANNOT edit files, run shell commands, ask the user \
                 or delegate. State assumptions and return a concise, self-contained report."
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
}

/// Delegation request coming from the `task` tool.
#[derive(Debug, Clone)]
pub struct SubagentRequest {
    pub description: String,
    pub prompt: String,
    pub kind: SubagentKind,
}

/// Child result (the text goes to the parent; usage is aggregated in the turn).
#[derive(Debug, Clone)]
pub struct SubagentOutcome {
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
    ) -> BoxFuture<'static, anyhow::Result<SubagentOutcome>> {
        if !can_delegate(self.depth) {
            return Box::pin(async move {
                anyhow::bail!("DELEGATION_DEPTH: subagentes não podem delegar de novo")
            });
        }
        let deps = self.deps.clone();
        let settings = self.settings.clone();
        let parent = self.parent.clone();
        let depth = self.depth.saturating_add(1);
        let usage = self.usage.clone();
        Box::pin(async move {
            let outcome = run_child(deps, settings, parent, request, depth, cancel).await?;
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

struct DiscardEmitter;

impl EventEmitter for DiscardEmitter {
    fn emit(&self, _event: TurnEvent) {}
}

/// Guard that deletes the ephemeral conversation on **any** exit (including a
/// future drop by timeout/cancellation). It also removes the spill directory and
/// cancels pending approvals/questions as defense in depth.
struct EphemeralConversation {
    db: Arc<Db>,
    id: String,
    spill_dir: Option<PathBuf>,
    approvals: Option<Arc<ApprovalRegistry>>,
    questions: Option<Arc<QuestionRegistry>>,
}

impl Drop for EphemeralConversation {
    fn drop(&mut self) {
        if let Some(questions) = &self.questions {
            questions.cancel_for_conversation(&self.id);
        }
        if let Some(approvals) = &self.approvals {
            approvals.cancel_for_conversation(&self.id);
        }
        if let Some(dir) = &self.spill_dir {
            let _ = std::fs::remove_dir_all(dir);
        }
        if let Err(error) = self.db.delete_conversation(&self.id) {
            eprintln!(
                "lumina: falha ao apagar a conversa efêmera do subagente {}: {error:#}",
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

async fn run_child(
    deps: HarnessDeps,
    settings: Settings,
    parent: ParentTurnContext,
    request: SubagentRequest,
    depth: u32,
    cancel: CancellationToken,
) -> anyhow::Result<SubagentOutcome> {
    let db: Arc<Db> = deps.db.clone();
    let data_dir = resolve_data_dir(&deps);
    let title = format!("Subagente: {}", truncate(request.description.trim(), 48));
    let child = db.create_conversation_with_mode(
        &title,
        &parent.provider_id,
        &parent.model_id,
        CONVERSATION_MODE_CODE,
    )?;
    // Created immediately after the conversation exists: any `?`/drop below
    // goes through `Drop` and leaves no orphan row.
    let _guard = EphemeralConversation {
        db: db.clone(),
        id: child.id.clone(),
        spill_dir: data_dir
            .as_ref()
            .map(|dir| dir.join("spill").join(&child.id)),
        approvals: deps.approvals.clone(),
        questions: deps.questions.clone(),
    };
    db.set_conversation_workspace(&child.id, parent.workspace_id.as_deref())?;
    // The child is read-only: policy denies writes/shell; the catalog is also
    // narrowed to read tools (defense in depth).
    db.set_conversation_permission_mode(&child.id, PermissionMode::ReadOnly)?;

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
        provider_id: parent.provider_id.clone(),
        model_id: parent.model_id.clone(),
        reasoning: None,
        options: TurnOptions {
            max_steps: SUBAGENT_MAX_STEPS,
            delegation_depth: depth,
            web_search: false,
            create_files: false,
            run_code: false,
            system_prompt_override: Some(instructions),
            wire_session_id: Some(parent.conversation_id.clone()),
            ..Default::default()
        },
        profile: TurnProfile::Code,
        turn_kind: crate::domain::TurnKind::User,
        goal_request: false,
        turn_id: None,
    };
    let emitter: Arc<dyn EventEmitter> = Arc::new(DiscardEmitter);
    let started = Instant::now();
    let result = harness::run_turn(deps, payload, settings, emitter, cancel).await;
    let duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let result = result?;
    if let Some(error) = result.error.as_deref() {
        anyhow::bail!("subagente falhou: {error}");
    }
    match result.assistant_message.status {
        MessageStatus::Complete => {}
        MessageStatus::Cancelled => anyhow::bail!("SUBAGENT_CANCELLED: subagente cancelado"),
        MessageStatus::Error => anyhow::bail!("subagente terminou com erro"),
        MessageStatus::Streaming => anyhow::bail!("subagente terminou incompleto"),
    }
    let text = result.assistant_message.content.trim().to_string();
    if text.is_empty() {
        anyhow::bail!("o subagente terminou sem resposta útil");
    }
    let steps = u32::try_from(result.assistant_message.trace.len()).unwrap_or(u32::MAX);
    let usage = result.usage;
    Ok(SubagentOutcome {
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
            std::env::temp_dir().join(format!("lumina-subagent-{}", uuid::Uuid::new_v4()));
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
        }
    }

    fn request(prompt: &str) -> SubagentRequest {
        SubagentRequest {
            description: "Explorar src".to_string(),
            prompt: prompt.to_string(),
            kind: SubagentKind::Explore,
        }
    }

    #[tokio::test]
    async fn runner_executes_a_child_turn_and_deletes_the_ephemeral_conversation() {
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
            std::env::temp_dir().join(format!("lumina-subagent-{}", uuid::Uuid::new_v4()));
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
            },
            0,
            usage,
        );
        let outcome = runner
            .run(
                SubagentRequest {
                    description: "Explorar src".to_string(),
                    prompt: "O que há em src/app.ts?".to_string(),
                    kind: SubagentKind::Explore,
                },
                CancellationToken::new(),
            )
            .await
            .expect("resumo do filho");
        assert!(outcome.text.contains("achei src/app.ts"));
        // The ephemeral subagent conversation was removed; only the parent remains.
        assert_eq!(db.list_conversations().expect("conversas").len(), 1);
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
            .run(request(sentinel), CancellationToken::new())
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
    async fn dropping_the_runner_future_deletes_the_ephemeral_conversation() {
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
        let handle = tokio::spawn(runner.run(request("pending"), CancellationToken::new()));
        started.notified().await;
        assert_eq!(db.list_conversations().expect("conversas").len(), 2);
        handle.abort();
        let _ = handle.await;
        assert_eq!(db.list_conversations().expect("conversas").len(), 1);
    }

    #[tokio::test]
    async fn cancelling_the_child_finishes_and_cleans_up() {
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
        let handle = tokio::spawn(runner.run(request("pending"), cancel.clone()));
        started.notified().await;
        cancel.cancel();
        let completed = tokio::time::timeout(std::time::Duration::from_secs(2), handle).await;
        assert!(completed.is_ok(), "o filho não terminou após o cancelamento");
        assert!(completed.expect("timeout").expect("join").is_err());
        assert_eq!(db.list_conversations().expect("conversas").len(), 1);
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
            .run(request("falhe"), CancellationToken::new())
            .await
            .expect_err("erro do provider");
        let message = format!("{error:#}");
        assert!(message.contains("provider boom"), "{message}");
        assert_eq!(db.list_conversations().expect("conversas").len(), 1);
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
            .run(request("x"), CancellationToken::new())
            .await
            .expect_err("workspace inválido");
        assert!(format!("{error:#}").contains("workspace"), "{error:#}");
        assert_eq!(db.list_conversations().expect("conversas").len(), 1);
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
        assert_eq!(SubagentKind::parse("x"), None);
        assert!(SubagentKind::Review.instructions().contains("reviewer"));
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
