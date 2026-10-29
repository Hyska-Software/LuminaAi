//! Comandos da sessão de código: snapshot de estado, modo de permissão, modo
//! Plano, aprovações, regras e reversão de alterações.
//!
//! Contrato: `docs/goals/code-harness/HARNESS.md` §6/§7/§11/§12 e
//! `WORKBENCH.md` §5/§7.2.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::domain::{
    ApprovalDecision, ApprovalRequest, ApprovalRule, ApprovalScope, ChangesSummary,
    CodeSessionState, FileChangeKind, FileChangeSummary, PlanState, PlanView, Workspace,
};
use crate::state::AppState;

use super::workspace::{enrich_workspace, project_info, workspace_path};

/// Kinds gravados em `code_events` por este módulo. As projeções de plano e
/// tarefas vivem em [`crate::harness::code::session`] (projeção única, D9).
pub const EVENT_APPROVAL_DECIDED: &str = crate::harness::code::session::KIND_APPROVAL_DECIDED;
pub const EVENT_PERMISSION_MODE: &str = crate::harness::code::session::KIND_PERMISSION_MODE;
pub const EVENT_REVERT: &str = crate::harness::code::session::KIND_REVERT;

fn map_err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn objects_dir(app_data: &Path) -> PathBuf {
    app_data.join("checkpoints").join("objects")
}

/// Reconstrói o estado da sessão a partir do log de eventos + journal + git.
async fn session_state(state: &AppState, conversation_id: &str) -> Result<CodeSessionState, String> {
    let conversation = state
        .db
        .get_conversation(conversation_id)
        .map_err(map_err)?
        .ok_or_else(|| format!("conversa não encontrada: {conversation_id}"))?;

    let mut workspace: Option<Workspace> = None;
    let mut project = None;
    if let Some(workspace_id) = conversation.workspace_id.as_deref() {
        if let Some(found) = state.db.get_workspace(workspace_id).map_err(map_err)? {
            let root = PathBuf::from(&found.path);
            if root.is_dir() {
                project = Some(project_info(&root));
                workspace = Some(enrich_workspace(&root, found).await);
            } else {
                workspace = Some(found);
            }
        }
    }

    let changes = collect_changes(state, conversation_id, workspace.as_ref()).await;

    let approvals: Vec<ApprovalRequest> = state
        .approvals
        .pending_requests()
        .into_iter()
        .filter(|request| {
            request.conversation_id.is_empty() || request.conversation_id == conversation_id
        })
        .collect();
    let questions: Vec<crate::domain::AskUserRequest> = state
        .questions
        .pending_requests()
        .into_iter()
        .filter(|request| request.conversation_id == conversation_id)
        .collect();

    // Projeção **única** (`PLAN.md` D9/B-09): plano, modo e tarefas vêm de
    // `harness::code::session` — este módulo não recalcula nada.
    let plan_mode = crate::harness::code::session::plan_mode_active(&state.db, conversation_id)
        .map_err(map_err)?;
    let plan = crate::harness::code::session::plan_view(&state.db, conversation_id)
        .map_err(map_err)?;
    // Uma revisão sem aprovação `submit_plan` pendente não tem gate ativo
    // (timeout/cancel/crash): degrada para planejamento com instrução curta.
    let has_pending_plan_approval = approvals.iter().any(|request| request.tool == "submit_plan");
    let plan = degrade_orphan_review(plan, has_pending_plan_approval);
    let todos = crate::harness::code::session::todos(&state.db, conversation_id)
        .map_err(map_err)?;
    // O `compacted` vem sempre da projeção canônica (`context/compacted`): o
    // `/compact` manual só grava esse evento (D25), então sem o overlay o valor
    // ficaria congelado no último `context/stats` até o próximo passo do turno.
    let compacted = crate::harness::code::session::compacted_messages(&state.db, conversation_id);
    let context = project_context(
        crate::harness::code::session::context_stats(&state.db, conversation_id),
        compacted,
    );

    Ok(CodeSessionState {
        conversation_id: conversation_id.to_string(),
        permission_mode: conversation.permission_mode,
        plan_mode,
        plan,
        todos,
        workspace,
        project,
        context,
        changes,
        jobs: state.jobs.list(conversation_id),
        approvals,
        questions,
    })
}

/// Uma revisão órfã (aprovação expirou/cancelou, o app reiniciou ou o turno
/// acabou sem decisão) não tem gate ativo: degrada para `Planning` com
/// instrução curta para reenviar o plano (B-07, espelho do fold do `turn/ended`).
fn degrade_orphan_review(
    plan: Option<PlanView>,
    has_pending_plan_approval: bool,
) -> Option<PlanView> {
    let mut plan = plan?;
    if plan.state == PlanState::Reviewing && !has_pending_plan_approval {
        plan.state = PlanState::Planning;
        plan.feedback = Some(crate::harness::code::session::STALE_REVIEW_FEEDBACK.to_string());
    }
    Some(plan)
}

/// Junta journal (alterações da sessão) + git (working tree) por arquivo.
async fn collect_changes(
    state: &AppState,
    conversation_id: &str,
    workspace: Option<&Workspace>,
) -> Option<ChangesSummary> {
    let journal = state
        .db
        .list_file_journal(conversation_id)
        .map_err(|_| ())
        .ok()?;
    let mut files: BTreeMap<String, FileChangeSummary> = BTreeMap::new();
    for entry in &journal {
        files.insert(
            entry.path.clone(),
            FileChangeSummary {
                path: entry.path.clone(),
                kind: entry.change_kind,
                added: entry.added.unwrap_or(0),
                removed: entry.removed.unwrap_or(0),
                origin: Some("session".to_string()),
                staged: false,
            },
        );
    }
    if let Some(workspace) = workspace {
        let root = PathBuf::from(&workspace.path);
        let status = crate::workspace::git::detect(&root).await;
        if status.is_repo {
            for file in &status.staged {
                let entry = files.entry(file.path.clone()).or_insert_with(|| FileChangeSummary {
                    path: file.path.clone(),
                    kind: FileChangeKind::Modified,
                    added: 0,
                    removed: 0,
                    origin: None,
                    staged: false,
                });
                entry.staged = true;
                entry.origin = Some(if entry.origin.as_deref() == Some("session") {
                    "both".to_string()
                } else {
                    "git".to_string()
                });
            }
            for file in &status.unstaged {
                let entry = files.entry(file.path.clone()).or_insert_with(|| FileChangeSummary {
                    path: file.path.clone(),
                    kind: FileChangeKind::Modified,
                    added: 0,
                    removed: 0,
                    origin: None,
                    staged: false,
                });
                if entry.origin.is_none() {
                    entry.origin = Some("git".to_string());
                } else if entry.origin.as_deref() == Some("session") {
                    entry.origin = Some("both".to_string());
                }
            }
            for path in &status.untracked {
                files.entry(path.clone()).or_insert_with(|| FileChangeSummary {
                    path: path.clone(),
                    kind: FileChangeKind::Created,
                    added: 0,
                    removed: 0,
                    origin: Some("git".to_string()),
                    staged: false,
                });
            }
        }
    }
    if files.is_empty() {
        return None;
    }
    let list: Vec<FileChangeSummary> = files.into_values().collect();
    Some(ChangesSummary {
        turn_id: None,
        added: list.iter().map(|file| file.added).sum(),
        removed: list.iter().map(|file| file.removed).sum(),
        files: list,
    })
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

/// Snapshot completo da sessão de código (header, painel, cards).
#[tauri::command]
pub async fn get_code_session_state(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<CodeSessionState, String> {
    session_state(&state, &conversation_id).await
}

/// Troca o modo de permissão da sessão (persistido + auditado).
#[tauri::command]
pub async fn set_permission_mode(
    state: State<'_, AppState>,
    conversation_id: String,
    mode: crate::domain::PermissionMode,
) -> Result<CodeSessionState, String> {
    state
        .db
        .set_conversation_permission_mode(&conversation_id, mode)
        .map_err(map_err)?;
    let payload = serde_json::json!({ "mode": mode.as_str() }).to_string();
    state
        .db
        .append_code_event(&conversation_id, None, EVENT_PERMISSION_MODE, &payload)
        .map_err(map_err)?;
    session_state(&state, &conversation_id).await
}

/// Liga/desliga o modo Plano (somente leitura) da sessão.
#[tauri::command]
pub async fn set_plan_mode(
    state: State<'_, AppState>,
    conversation_id: String,
    plan_mode: bool,
) -> Result<CodeSessionState, String> {
    apply_plan_mode(&state.db, &conversation_id, plan_mode)?;
    session_state(&state, &conversation_id).await
}

/// Lógica testável de `set_plan_mode`: valida a conversa **antes** de gravar o
/// evento (B-16 — ids inválidos não podem deixar linhas órfãs em `code_events`).
fn apply_plan_mode(
    db: &crate::db::Db,
    conversation_id: &str,
    plan_mode: bool,
) -> Result<(), String> {
    ensure_conversation(db, conversation_id)?;
    crate::harness::code::session::set_plan_mode(db, conversation_id, plan_mode).map_err(map_err)
}

fn ensure_conversation(
    db: &crate::db::Db,
    conversation_id: &str,
) -> Result<crate::domain::Conversation, String> {
    db.get_conversation(conversation_id)
        .map_err(map_err)?
        .ok_or_else(|| format!("conversa não encontrada: {conversation_id}"))
}

/// Status dos servidores MCP configurados (`mcp.json`) e tools descobertas.
#[tauri::command]
pub async fn mcp_status(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let tools = state.mcp.refresh_tools().await;
    Ok(serde_json::json!({
        "servers": state.mcp.config().servers,
        "tools": tools,
    }))
}

/// Responde a uma pergunta pendente do agente (`ask_user`).
#[tauri::command]
pub async fn respond_question(
    state: State<'_, AppState>,
    request_id: String,
    answers: Vec<crate::domain::AskUserAnswer>,
    skipped: Option<bool>,
) -> Result<bool, String> {
    let skipped = skipped.unwrap_or(false);
    let response = crate::domain::AskUserResponse {
        request_id: request_id.clone(),
        answers: if skipped { Vec::new() } else { answers },
        skipped,
    };
    if !state.questions.resolve(response) {
        return Err("QUESTION_NOT_FOUND: esta pergunta já foi resolvida".to_string());
    }
    Ok(true)
}

/// Resposta do usuário a uma aprovação pendente (dados do card).
#[derive(Debug, Clone)]
struct ApprovalAnswer {
    decision: ApprovalDecision,
    scope: Option<ApprovalScope>,
    feedback: Option<String>,
    /// Escolha do gate de plano: `approve_run` | `approve_review`.
    choice: Option<String>,
    /// Markdown revisado pelo usuário antes de aprovar o plano (D3).
    plan_markdown: Option<String>,
}

impl Default for ApprovalAnswer {
    fn default() -> Self {
        Self {
            decision: ApprovalDecision::Denied,
            scope: None,
            feedback: None,
            choice: None,
            plan_markdown: None,
        }
    }
}

/// Responde a uma aprovação pendente (falha fechada para id desconhecido).
#[tauri::command]
pub async fn respond_approval(
    state: State<'_, AppState>,
    approval_id: String,
    decision: ApprovalDecision,
    scope: Option<ApprovalScope>,
    feedback: Option<String>,
    choice: Option<String>,
    plan_markdown: Option<String>,
) -> Result<bool, String> {
    apply_approval_decision(
        &state.db,
        &state.approvals,
        &approval_id,
        ApprovalAnswer {
            decision,
            scope,
            feedback,
            choice,
            plan_markdown,
        },
    )
}

/// Aplica a decisão de uma aprovação.
///
/// Ordem importa (B-17): **resolve o oneshot primeiro** — se o pedido já morreu
/// (timeout/cancelamento/duplo clique) devolve `APPROVAL_NOT_FOUND` sem criar
/// regra nem auditar uma decisão que nunca existiu. Aprovações de plano **não**
/// criam regra "sempre permitir" (D5).
fn apply_approval_decision(
    db: &crate::db::Db,
    approvals: &crate::policy::approval::ApprovalRegistry,
    approval_id: &str,
    answer: ApprovalAnswer,
) -> Result<bool, String> {
    let request = approvals
        .request(approval_id)
        .ok_or_else(|| "APPROVAL_NOT_FOUND: esta aprovação já foi resolvida".to_string())?;
    let is_plan = request.tool == "submit_plan";

    if is_plan {
        if answer.scope.is_some() {
            return Err(
                "APPROVAL_INVALID: aprovações de plano não criam regra de permissão".to_string(),
            );
        }
        if answer.decision == ApprovalDecision::Approved {
            validate_plan_choice(answer.choice.as_deref(), answer.plan_markdown.as_deref())?;
        }
    } else if answer.choice.is_some() || answer.plan_markdown.is_some() {
        return Err(
            "APPROVAL_INVALID: `choice`/`planMarkdown` só se aplicam à aprovação de plano"
                .to_string(),
        );
    }

    let normalized_markdown = answer
        .plan_markdown
        .as_deref()
        .map(str::trim)
        .filter(|markdown| !markdown.is_empty())
        .map(str::to_string);
    let mut outcome = match answer.decision {
        ApprovalDecision::Approved if is_plan => {
            crate::policy::approval::ApprovalOutcome::approved_plan(
                answer.choice.clone(),
                normalized_markdown,
            )
        }
        ApprovalDecision::Approved => {
            crate::policy::approval::ApprovalOutcome::approved(answer.scope)
        }
        ApprovalDecision::Denied => {
            crate::policy::approval::ApprovalOutcome::denied(answer.feedback.clone())
        }
        ApprovalDecision::Cancelled => crate::policy::approval::ApprovalOutcome::cancelled(),
        ApprovalDecision::Expired => crate::policy::approval::ApprovalOutcome::expired(),
    };
    // O feedback também acompanha aprovações (auditoria/card).
    if answer.decision == ApprovalDecision::Approved {
        outcome.feedback = answer.feedback.clone();
    }
    if !approvals.resolve(approval_id, outcome.clone()) {
        return Err("APPROVAL_NOT_FOUND: esta aprovação já foi resolvida".to_string());
    }

    // A partir daqui a tool já destravou: regra/auditoria são efeitos
    // secundários (best effort auditado; regra pode falhar e reportar erro).
    if answer.decision == ApprovalDecision::Approved {
        if let Some(scope) = answer.scope {
            let (matcher, pattern, scope_id) = rule_from_request(db, &request, scope)?;
            state_create_rule(
                db,
                scope,
                scope_id.as_deref(),
                &request.tool,
                &matcher,
                &pattern,
            )?;
        }
    }
    let audit = serde_json::json!({
        "approvalId": approval_id,
        "decision": answer.decision.as_str(),
        "choice": outcome.choice,
        "scope": outcome.scope.map(|scope| scope.as_str()),
        "feedback": outcome.feedback,
    })
    .to_string();
    db.append_code_event(
        &request.conversation_id,
        None,
        EVENT_APPROVAL_DECIDED,
        &audit,
    )
    .map_err(map_err)?;
    Ok(true)
}

/// Cria a regra "sempre permitir" derivada do pedido aprovado.
fn state_create_rule(
    db: &crate::db::Db,
    scope: ApprovalScope,
    scope_id: Option<&str>,
    tool: &str,
    matcher: &str,
    pattern: &str,
) -> Result<(), String> {
    db.create_approval_rule(&crate::db::NewApprovalRule {
        scope,
        scope_id,
        tool,
        matcher,
        pattern,
        decision: ApprovalDecision::Approved,
    })
    .map(|_| ())
    .map_err(|error| format!("não foi possível salvar a regra: {error}"))
}

/// Valida a escolha do gate de plano e o markdown revisado (D3/D5).
fn validate_plan_choice(choice: Option<&str>, plan_markdown: Option<&str>) -> Result<(), String> {
    if let Some(choice) = choice {
        match choice {
            "approve_run" | "approve_review" => {}
            other => {
                return Err(format!(
                    "APPROVAL_INVALID: escolha de plano desconhecida: `{other}`"
                ))
            }
        }
    }
    if let Some(markdown) = plan_markdown {
        let trimmed = markdown.trim();
        if trimmed.is_empty() {
            return Err("APPROVAL_INVALID: o plano revisado não pode ficar vazio".to_string());
        }
        if trimmed.chars().count() > 20_000 {
            return Err(
                "APPROVAL_INVALID: o plano revisado excede 20 000 caracteres".to_string(),
            );
        }
    }
    Ok(())
}

/// Deriva `(matcher, pattern, scope_id)` de um pedido para a regra "sempre".
///
/// Para `scope = Workspace` o `scope_id` vem da conversa; sem workspace a ação
/// falha em vez de gravar uma regra que nunca casaria (B-06).
fn rule_from_request(
    db: &crate::db::Db,
    request: &ApprovalRequest,
    scope: ApprovalScope,
) -> Result<(String, String, Option<String>), String> {
    let scope_id = match scope {
        ApprovalScope::Session => Some(request.conversation_id.clone()),
        ApprovalScope::Workspace => {
            let conversation = ensure_conversation(db, &request.conversation_id)?;
            Some(conversation.workspace_id.ok_or_else(|| {
                "APPROVAL_INVALID: a sessão não tem workspace; escolha \"esta sessão\" ou \"sempre\""
                    .to_string()
            })?)
        }
        ApprovalScope::Global => None,
    };
    let (matcher, pattern) = match &request.detail {
        crate::domain::ApprovalDetail::Command { command, .. } => {
            ("prefix".to_string(), command.trim().to_string())
        }
        crate::domain::ApprovalDetail::Paths { paths, .. } => (
            "glob".to_string(),
            paths.first().cloned().unwrap_or_default(),
        ),
        crate::domain::ApprovalDetail::Secret { path }
        | crate::domain::ApprovalDetail::Outside { path } => ("glob".to_string(), path.clone()),
        crate::domain::ApprovalDetail::Other { text } => ("exact".to_string(), text.clone()),
    };
    Ok((matcher, pattern, scope_id))
}

#[tauri::command]
pub async fn list_approval_rules(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<ApprovalRule>, String> {
    let conversation = state
        .db
        .get_conversation(&conversation_id)
        .map_err(map_err)?
        .ok_or_else(|| format!("conversa não encontrada: {conversation_id}"))?;
    state
        .db
        .list_approval_rules_for_context(
            Some(&conversation_id),
            conversation.workspace_id.as_deref(),
        )
        .map_err(map_err)
}

/// Dados para criar uma regra de aprovação manualmente (Configurações).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRuleInput {
    pub scope: ApprovalScope,
    #[serde(default)]
    pub scope_id: Option<String>,
    #[serde(default)]
    pub conversation_id: Option<String>,
    pub tool: String,
    pub matcher: String,
    pub pattern: String,
    pub decision: ApprovalDecision,
}

#[tauri::command]
pub async fn save_approval_rule(
    state: State<'_, AppState>,
    input: ApprovalRuleInput,
) -> Result<ApprovalRule, String> {
    let mut scope_id = input.scope_id.clone();
    if scope_id.is_none() {
        if let Some(conversation_id) = input.conversation_id.as_deref() {
            match input.scope {
                ApprovalScope::Session => scope_id = Some(conversation_id.to_string()),
                ApprovalScope::Workspace => {
                    if let Some(conversation) = state
                        .db
                        .get_conversation(conversation_id)
                        .map_err(map_err)?
                    {
                        scope_id = conversation.workspace_id;
                    }
                }
                ApprovalScope::Global => {}
            }
        }
    }
    state
        .db
        .create_approval_rule(&crate::db::NewApprovalRule {
            scope: input.scope,
            scope_id: scope_id.as_deref(),
            tool: &input.tool,
            matcher: &input.matcher,
            pattern: &input.pattern,
            decision: input.decision,
        })
        .map_err(map_err)
}

#[tauri::command]
pub async fn delete_approval_rule(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let removed = state.db.delete_approval_rule(&id).map_err(map_err)?;
    if !removed {
        return Err(format!("regra não encontrada: {id}"));
    }
    Ok(())
}

/// Alterações da sessão (journal + working tree) para o painel.
#[tauri::command]
pub async fn get_workspace_changes(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<crate::domain::FileChange>, String> {
    let conversation = state
        .db
        .get_conversation(&conversation_id)
        .map_err(map_err)?
        .ok_or_else(|| format!("conversa não encontrada: {conversation_id}"))?;
    let mut workspace = None;
    if let Some(workspace_id) = conversation.workspace_id.as_deref() {
        workspace = state.db.get_workspace(workspace_id).map_err(map_err)?;
    }
    let summary = collect_changes(&state, &conversation_id, workspace.as_ref())
        .await
        .unwrap_or(ChangesSummary {
            turn_id: None,
            files: Vec::new(),
            added: 0,
            removed: 0,
        });
    Ok(summary
        .files
        .into_iter()
        .map(|file| crate::domain::FileChange {
            path: file.path,
            kind: file.kind,
            added: file.added,
            removed: file.removed,
            diff: None,
        })
        .collect())
}

/// Diff de um arquivo: journal da sessão quando existe, senão git.
#[tauri::command]
pub async fn get_file_diff(
    state: State<'_, AppState>,
    workspace_id: String,
    path: String,
    staged: bool,
) -> Result<String, String> {
    let root = workspace_path(&state, &workspace_id)?;
    let resolved = crate::workspace::safe_path::resolve(
        &root,
        &path,
        crate::workspace::safe_path::Access::Read,
    )
    .map_err(map_err)?;
    let relative = crate::workspace::safe_path::to_relative(&root, &resolved);
    if !staged {
        if let Some(diff) = journal_diff(&state, &relative)? {
            return Ok(diff);
        }
    }
    let text =
        crate::workspace::git::diff(&root, std::slice::from_ref(&relative), staged, 3, 200_000)
            .await
            .map_err(|error| format!("{}: {}", error.code, error.message))?;
    // Arquivo novo (untracked) não aparece no `git diff`: monta o patch "new
    // file" a partir do conteúdo para a aba Alterações mostrar `A` + diff mesmo
    // sem staging.
    if !staged && text.trim().is_empty() && !crate::workspace::git::is_tracked(&root, &relative).await
    {
        return crate::workspace::git::untracked_diff(&root, &relative, 200_000)
            .map_err(|error| format!("{}: {}", error.code, error.message));
    }
    Ok(text)
}

/// Diff do journal para um path (usa o object store de checkpoints).
fn journal_diff(state: &AppState, path: &str) -> Result<Option<String>, String> {
    // Procura o journal mais recente que contenha o path em qualquer sessão?
    // Não: o journal é por conversa. Sem conversa no payload, calcula pelo
    // arquivo atual vs. working tree? A UI passa `get_file_diff` com workspace,
    // então usamos git; o journal é usado no revert. Mantido simples e honesto.
    let _ = (state, path);
    Ok(None)
}

/* ------------------------------------------------------------------ */
/* Reversão                                                            */
/* ------------------------------------------------------------------ */

fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "path sem pai"))?;
    std::fs::create_dir_all(parent)?;
    let tmp = parent.join(format!(
        ".lumina-revert-{}-{}",
        std::process::id(),
        crate::domain::now_ms()
    ));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path).or_else(|error| {
        let _ = std::fs::remove_file(&tmp);
        Err(error)
    })
}

fn revert_entries(
    state: &AppState,
    conversation_id: &str,
    root: &Path,
    mut entries: Vec<crate::db::FileJournalEntry>,
) -> Result<u32, String> {
    // Reverte do mais recente para o mais antigo; cada path uma vez.
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.id));
    let objects = crate::workspace::journal::ObjectStore::new(objects_dir(&state.data_dir));
    let mut seen = std::collections::HashSet::new();
    let mut reverted = 0u32;
    for entry in entries {
        if !seen.insert(entry.path.clone()) {
            continue;
        }
        let target = crate::workspace::safe_path::resolve(
            root,
            &entry.path,
            crate::workspace::safe_path::Access::Write,
        )
        .map_err(map_err)?;
        // Verificação de corrida: o arquivo precisa estar como o turno deixou.
        let current = std::fs::read(&target).ok();
        if let (Some(after_hash), Some(current_bytes)) = (&entry.after_hash, &current) {
            if &sha256_hex(current_bytes) != after_hash {
                return Err(format!(
                    "FS_STALE_VERSION: `{}` mudou desde o turno; revise o diff antes de reverter",
                    entry.path
                ));
            }
        }
        match &entry.before_hash {
            Some(before_hash) => {
                let bytes = objects
                    .get(before_hash)
                    .map_err(|error| format!("checkpoint ausente para `{}`: {error}", entry.path))?;
                atomic_write(&target, &bytes).map_err(map_err)?;
            }
            None => {
                if target.exists() {
                    std::fs::remove_file(&target).map_err(map_err)?;
                }
            }
        }
        reverted += 1;
    }
    Ok(reverted)
}

/// Reverte um arquivo ao estado anterior à primeira edição do turno.
#[tauri::command]
pub async fn revert_file(
    state: State<'_, AppState>,
    conversation_id: String,
    path: String,
) -> Result<bool, String> {
    let conversation = state
        .db
        .get_conversation(&conversation_id)
        .map_err(map_err)?
        .ok_or_else(|| format!("conversa não encontrada: {conversation_id}"))?;
    let workspace_id = conversation
        .workspace_id
        .ok_or_else(|| "FS_NO_WORKSPACE: a sessão não tem workspace".to_string())?;
    let root = workspace_path(&state, &workspace_id)?;
    let entries: Vec<_> = state
        .db
        .list_file_journal(&conversation_id)
        .map_err(map_err)?
        .into_iter()
        .filter(|entry| entry.path == path)
        .collect();
    if entries.is_empty() {
        return Err(format!("não há alteração registrada para `{path}`"));
    }
    let reverted = revert_entries(&state, &conversation_id, &root, entries)?;
    let payload = serde_json::json!({ "files": [path], "reverted": reverted }).to_string();
    state
        .db
        .append_code_event(&conversation_id, None, EVENT_REVERT, &payload)
        .map_err(map_err)?;
    Ok(reverted > 0)
}

/// Reverte todas as alterações de um turno (arquivos que ainda estão como o
/// turno deixou; recusa se algum mudou por fora).
#[tauri::command]
pub async fn revert_turn(
    state: State<'_, AppState>,
    conversation_id: String,
    turn_id: String,
) -> Result<bool, String> {
    let conversation = state
        .db
        .get_conversation(&conversation_id)
        .map_err(map_err)?
        .ok_or_else(|| format!("conversa não encontrada: {conversation_id}"))?;
    let workspace_id = conversation
        .workspace_id
        .ok_or_else(|| "FS_NO_WORKSPACE: a sessão não tem workspace".to_string())?;
    let root = workspace_path(&state, &workspace_id)?;
    let entries = state
        .db
        .list_file_journal_for_turn(&conversation_id, &turn_id)
        .map_err(map_err)?;
    if entries.is_empty() {
        return Err("o turno não registrou alterações de arquivo".to_string());
    }
    let paths: Vec<String> = entries.iter().map(|entry| entry.path.clone()).collect();
    let reverted = revert_entries(&state, &conversation_id, &root, entries)?;
    let payload = serde_json::json!({ "turnId": turn_id, "files": paths, "reverted": reverted })
        .to_string();
    state
        .db
        .append_code_event(&conversation_id, Some(&turn_id), EVENT_REVERT, &payload)
        .map_err(map_err)?;
    Ok(reverted > 0)
}

/// Aplica o `compacted` da projeção canônica ao último `ContextStats` lido do
/// log. Sem o overlay, o `/compact` manual (que não tem um turno para reescrever
/// `context/stats`) deixaria o medidor com o valor antigo até o próximo passo do
/// harness — bug D25. Sem stats persistido continua `None` (não inventa contexto).
fn project_context(
    context: Option<crate::domain::ContextStats>,
    compacted: u32,
) -> Option<crate::domain::ContextStats> {
    context.map(|mut stats| {
        stats.compacted = compacted;
        stats
    })
}

/// Projeta o `/compact` manual nos eventos canônicos (D25): grava
/// `context/compacted` com o **mesmo payload da compactação automática**
/// (`{messages, tokensFreed}`) via [`compaction::record_compaction`].
///
/// Nunca gravar payload parcial em `context/stats`: o fold daquele kind
/// desserializa um `ContextStats` inteiro e um payload inválido fazia o
/// `context` do `CodeSessionState` voltar a `None` (bug D25).
fn record_manual_compaction(
    db: &crate::db::Db,
    conversation_id: &str,
    covered_messages: u32,
    tokens_freed: u32,
) -> anyhow::Result<()> {
    use crate::harness::code::compaction;
    // O comando manual não roda dentro de um turno: `""` vira `None` no evento.
    compaction::record_compaction(db, conversation_id, "", covered_messages, tokens_freed)
}

/// Compactação manual do contexto (`/compact`): resume o trecho antigo da
/// conversa e o aplica aos próximos turnos do modelo.
///
/// **Cache-safe (F6.2):** o resumo é delegado a
/// [`crate::harness::compaction::summarize_manual_for_conversation`], que monta o
/// **prefixo normal** da sessão (system prompt congelado do snapshot, tools,
/// histórico com replay/surface/resumo aplicado) e anexa `summary_instruction`
/// como última mensagem de user — o provedor lê o prefixo cacheado em vez de
/// pagar o prompt inteiro. O `cache_plan` do request normal também é reusado.
/// (O antigo caminho de prompt próprio (`summary_system_prompt` +
/// `batch::complete_text`) saiu do comando; `summary_system_prompt` pode ser
/// removido do harness quando ninguém mais usar.)
///
/// **Contrato estável (D25):** a fronteira persistida é o ordinal de **mensagens
/// cobertas** (`session_summaries.to_seq`), o mesmo da compactação automática —
/// não o índice do histórico neutro. O evento gravado é `context/compacted`
/// (`{messages, tokensFreed}`), que preserva o `context` do medidor; o
/// `compacted` exibido por `get_code_session_state` vem da projeção
/// ([`project_context`]). O helper não persiste nada: o comando grava
/// resumo/evento só depois do `Some(outcome)`.
#[tauri::command]
pub async fn compact_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<bool, String> {
    let conversation = state
        .db
        .get_conversation(&conversation_id)
        .map_err(map_err)?
        .ok_or_else(|| format!("conversa não encontrada: {conversation_id}"))?;
    // Guarda amigável antes de resolver provider/credencial (o harness também
    // devolve `None` para histórico curto/inválido).
    let messages = state
        .db
        .list_messages(&conversation_id)
        .map_err(map_err)?;
    if messages.len() < 8 {
        return Err("conversa curta demais para compactar".to_string());
    }
    let deps = crate::harness::HarnessDeps {
        app: Some(app.clone()),
        db: state.db.clone(),
        http: state.http.clone(),
        search_http: state.search_http.clone(),
        catalog: state.catalog.clone(),
        streamer: None,
        credential_override: None,
        refresh_override: None,
        model_source: None,
        api_key_override: None,
        data_dir: Some(state.data_dir.clone()),
        skills_roots: Some(Vec::new()),
        approvals: Some(state.approvals.clone()),
        observed: Some(state.observed.clone()),
        jobs: Some(state.jobs.clone()),
        questions: Some(state.questions.clone()),
        mcp: Some(state.mcp.clone()),
    };
    let settings = crate::config::load_settings(&app);
    // Prefixo normal + resumo + `cache_plan` montados pelo harness (cache-safe).
    let outcome = crate::harness::compaction::summarize_manual_for_conversation(
        &deps,
        &conversation,
        &settings,
    )
    .await
    .map_err(|error| format!("falha ao compactar: {error:#}"))?
    .ok_or_else(|| "não há trecho antigo suficiente para compactar".to_string())?;

    // `to_seq` = `outcome.covered` (ordinal estável de mensagens); a coluna
    // `tokens` guarda a estimativa de tokens liberados (informativa).
    state
        .db
        .insert_session_summary(
            &conversation_id,
            1,
            i64::from(outcome.covered),
            &outcome.summary,
            Some(outcome.tokens_freed),
        )
        .map_err(map_err)?;
    // Projeção canônica da UI (D25): `context/compacted`, nunca `context/stats`.
    record_manual_compaction(
        &state.db,
        &conversation_id,
        outcome.covered,
        outcome.tokens_freed,
    )
    .map_err(map_err)?;
    Ok(true)
}

/* ------------------------------------------------------------------ */
/* Jobs em background (F4)                                             */
/* ------------------------------------------------------------------ */

/// PÃ¡gina de saÃ­da de um job em background (`get_job_output`).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobOutputPage {
    pub output: String,
    pub next_cursor: usize,
    pub job: crate::domain::JobView,
}

/// Jobs de processo da sessÃ£o (painel e cards).
#[tauri::command]
pub async fn list_jobs(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<crate::domain::JobView>, String> {
    Ok(state.jobs.list(&conversation_id))
}

/// SaÃ­da incremental de um job a partir de um cursor absoluto.
#[tauri::command]
pub async fn get_job_output(
    state: State<'_, AppState>,
    job_id: String,
    cursor: Option<usize>,
) -> Result<JobOutputPage, String> {
    let (output, next_cursor, job) = state
        .jobs
        .output(&job_id, cursor.unwrap_or(0))
        .map_err(map_err)?;
    Ok(JobOutputPage {
        output,
        next_cursor,
        job,
    })
}

/// Encerra um job (processo + Ã¡rvore) e devolve o estado final.
#[tauri::command]
pub async fn kill_job(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<crate::domain::JobView, String> {
    state.jobs.kill(&job_id).map_err(map_err)?;
    state
        .jobs
        .wait(&job_id, std::time::Duration::from_millis(1_500))
        .await
        .map_err(map_err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{ApprovalDetail, RiskClass};
    use crate::harness::code::session;
    use crate::policy::approval::{ApprovalOutcome, ApprovalRegistry};

    fn db_with_conversation() -> (crate::db::Db, String) {
        let db = crate::db::Db::open_in_memory().expect("banco em memória");
        let conversation = db
            .create_conversation_with_mode(
                "Sessão",
                "opencode-go",
                "deepseek-v4.1-flash",
                crate::domain::CONVERSATION_MODE_CODE,
            )
            .expect("conversa");
        (db, conversation.id)
    }

    fn approval_request(conversation_id: &str, tool: &str) -> ApprovalRequest {
        ApprovalRequest {
            id: "apr-1".to_string(),
            conversation_id: conversation_id.to_string(),
            tool_call_id: "call-1".to_string(),
            tool: tool.to_string(),
            title: "Ação?".to_string(),
            detail: ApprovalDetail::Command {
                command: "npm test".to_string(),
                workdir: ".".to_string(),
            },
            risk: RiskClass::Shell,
            preview: None,
            options: Vec::new(),
            created_at: 1,
        }
    }

    fn answer(decision: ApprovalDecision) -> ApprovalAnswer {
        ApprovalAnswer {
            decision,
            ..Default::default()
        }
    }

    #[test]
    fn set_plan_mode_validates_the_conversation_before_writing() {
        let (db, conversation_id) = db_with_conversation();
        assert!(apply_plan_mode(&db, "nao-existe", true).is_err());
        assert!(
            db.latest_code_event("nao-existe", session::KIND_PLAN_MODE)
                .expect("ler")
                .is_none(),
            "id inválido não pode gravar evento"
        );

        apply_plan_mode(&db, &conversation_id, true).expect("ligar plano");
        assert!(session::plan_mode_active(&db, &conversation_id).expect("modo"));
    }

    #[test]
    fn rule_from_request_resolves_the_workspace_scope_id() {
        let (db, conversation_id) = db_with_conversation();
        let request = approval_request(&conversation_id, "run_command");

        // Sessão sem workspace: erro em vez de regra morta (B-06).
        let error = rule_from_request(&db, &request, ApprovalScope::Workspace)
            .expect_err("sem workspace deve falhar");
        assert!(error.contains("workspace"), "{error}");

        let workspace = db
            .create_workspace("demo", "C:/dev/demo")
            .expect("workspace");
        db.set_conversation_workspace(&conversation_id, Some(&workspace.id))
            .expect("vincular");
        let (matcher, pattern, scope_id) =
            rule_from_request(&db, &request, ApprovalScope::Workspace).expect("regra");
        assert_eq!(matcher, "prefix");
        assert_eq!(pattern, "npm test");
        assert_eq!(scope_id.as_deref(), Some(workspace.id.as_str()));

        let (_, _, session_scope) =
            rule_from_request(&db, &request, ApprovalScope::Session).expect("sessão");
        assert_eq!(session_scope.as_deref(), Some(conversation_id.as_str()));
        let (_, _, global_scope) =
            rule_from_request(&db, &request, ApprovalScope::Global).expect("global");
        assert!(global_scope.is_none());
    }

    #[test]
    fn validate_plan_choice_rejects_invalid_choice_and_bad_markdown() {
        assert!(validate_plan_choice(None, None).is_ok());
        assert!(validate_plan_choice(Some("approve_run"), None).is_ok());
        assert!(validate_plan_choice(Some("approve_review"), Some("# Plano")).is_ok());
        assert!(validate_plan_choice(Some("keep_planning"), None).is_err());
        assert!(validate_plan_choice(Some("qualquer"), None).is_err());
        assert!(validate_plan_choice(None, Some("   ")).is_err());
        assert!(validate_plan_choice(None, Some(&"x".repeat(20_001))).is_err());
    }

    #[test]
    fn orphan_review_degrades_to_planning_only_without_a_pending_approval() {
        let reviewing = |state: PlanState| PlanView {
            state,
            markdown: Some("# Draft".into()),
            feedback: None,
            updated_at: 10,
        };

        // Gate pendente: mantém a revisão (o card ainda pode aprovar).
        let kept = degrade_orphan_review(Some(reviewing(PlanState::Reviewing)), true)
            .expect("plano");
        assert_eq!(kept.state, PlanState::Reviewing);
        assert!(kept.feedback.is_none());

        // Sem aprovação pendente: volta para planejamento com o aviso.
        let degraded = degrade_orphan_review(Some(reviewing(PlanState::Reviewing)), false)
            .expect("plano");
        assert_eq!(degraded.state, PlanState::Planning);
        assert_eq!(
            degraded.feedback.as_deref(),
            Some(session::STALE_REVIEW_FEEDBACK)
        );
        assert_eq!(degraded.markdown.as_deref(), Some("# Draft"));

        // Aprovado/planejando não são tocados.
        let approved = degrade_orphan_review(Some(reviewing(PlanState::Approved)), false)
            .expect("plano");
        assert_eq!(approved.state, PlanState::Approved);
        assert!(degrade_orphan_review(None, false).is_none());
    }

    #[test]
    fn dead_approval_is_rejected_without_rule_or_audit() {
        let (db, conversation_id) = db_with_conversation();
        let registry = ApprovalRegistry::new();
        let error = apply_approval_decision(&db, &registry, "apr-morto", answer(ApprovalDecision::Approved))
            .expect_err("aprovação inexistente");
        assert!(error.starts_with("APPROVAL_NOT_FOUND"), "{error}");
        assert!(
            db.latest_code_event(&conversation_id, session::KIND_APPROVAL_DECIDED)
                .expect("ler")
                .is_none()
        );
        assert!(db.list_approval_rules().expect("regras").is_empty());
    }

    #[test]
    fn approval_is_resolved_once_and_plan_scope_is_rejected() {
        let (db, conversation_id) = db_with_conversation();
        let registry = ApprovalRegistry::new();

        // Gate de plano: escopo é inválido (não cria regra — D5).
        let mut request = approval_request(&conversation_id, "submit_plan");
        request.id = "apr-plan".to_string();
        let _rx = registry.register_request(request);
        let error = apply_approval_decision(
            &db,
            &registry,
            "apr-plan",
            ApprovalAnswer {
                decision: ApprovalDecision::Approved,
                scope: Some(ApprovalScope::Session),
                ..Default::default()
            },
        )
        .expect_err("escopo em plano é inválido");
        assert!(error.starts_with("APPROVAL_INVALID"), "{error}");
        assert!(registry.has_pending("apr-plan"), "pedido continua pendente");

        // Aprovação normal: o oneshot resolve e o segundo clique falha.
        let mut rx = registry.register_request(approval_request(&conversation_id, "run_command"));
        let first = apply_approval_decision(
            &db,
            &registry,
            "apr-1",
            answer(ApprovalDecision::Approved),
        )
        .expect("primeira decisão");
        assert!(first);
        let outcome = rx.try_recv().expect("outcome entregue");
        assert!(outcome.is_approved());
        assert!(outcome.choice.is_none());
        assert!(
            db.latest_code_event(&conversation_id, session::KIND_APPROVAL_DECIDED)
                .expect("ler")
                .is_some(),
            "auditoria registrada"
        );

        let second = apply_approval_decision(
            &db,
            &registry,
            "apr-1",
            answer(ApprovalDecision::Approved),
        )
        .expect_err("segundo clique não pode resolver");
        assert!(second.starts_with("APPROVAL_NOT_FOUND"), "{second}");
    }

    #[test]
    fn workspace_scope_rule_is_created_with_the_conversation_workspace() {
        let (db, conversation_id) = db_with_conversation();
        let workspace = db
            .create_workspace("demo", "C:/dev/demo")
            .expect("workspace");
        db.set_conversation_workspace(&conversation_id, Some(&workspace.id))
            .expect("vincular");

        let registry = ApprovalRegistry::new();
        let _rx = registry.register_request(approval_request(&conversation_id, "run_command"));
        let resolved = apply_approval_decision(
            &db,
            &registry,
            "apr-1",
            ApprovalAnswer {
                decision: ApprovalDecision::Approved,
                scope: Some(ApprovalScope::Workspace),
                ..Default::default()
            },
        )
        .expect("aprovar com regra workspace");
        assert!(resolved);

        let rules = db.list_approval_rules().expect("regras");
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].scope, ApprovalScope::Workspace);
        assert_eq!(rules[0].scope_id.as_deref(), Some(workspace.id.as_str()));
        assert_eq!(rules[0].tool, "run_command");
        assert_eq!(rules[0].pattern, "npm test");
    }

    #[test]
    fn plan_choice_and_revised_markdown_reach_the_approval_outcome() {
        let (db, conversation_id) = db_with_conversation();
        let registry = ApprovalRegistry::new();
        let mut request = approval_request(&conversation_id, "submit_plan");
        request.id = "apr-plan".to_string();
        let mut rx = registry.register_request(request);
        let resolved = apply_approval_decision(
            &db,
            &registry,
            "apr-plan",
            ApprovalAnswer {
                decision: ApprovalDecision::Approved,
                choice: Some("approve_review".to_string()),
                plan_markdown: Some("  # Plano revisado  ".to_string()),
                ..Default::default()
            },
        )
        .expect("aprovar plano");
        assert!(resolved);
        let outcome: ApprovalOutcome = rx.try_recv().expect("outcome");
        assert!(outcome.is_approved());
        assert!(outcome.review_each_edit());
        assert_eq!(outcome.plan_markdown.as_deref(), Some("# Plano revisado"));
        assert!(
            db.list_approval_rules().expect("regras").is_empty(),
            "aprovação de plano não cria regra"
        );
    }

    /* -------------------------------------------------------------- */
    /* /compact manual: cache-safe (F6.2) + projeção D25               */
    /* -------------------------------------------------------------- */

    /// O `/compact` manual agora delega ao helper cache-safe do harness; não pode
    /// voltar a montar um request de resumo próprio (caminho não cache-safe).
    /// O uso real é provado em compile-time pela chamada no comando; este teste
    /// protege contra regressão textual (needles partidos para não casarem com o
    /// próprio literal do teste).
    #[test]
    fn manual_compact_uses_the_harness_cache_safe_helper() {
        let source = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/commands/code.rs"));
        assert!(
            source.contains(concat!("summarize_manual", "_for_conversation")),
            "o /compact manual deve delegar ao helper cache-safe do harness"
        );
        assert!(
            !source.contains(concat!("summary_system", "_prompt()")),
            "o manual não deve voltar a montar prompt próprio de sumarização"
        );
        assert!(
            !source.contains(concat!("complete", "_text(")),
            "o manual não deve voltar ao caminho de texto do batch (não cache-safe)"
        );
        // `to_seq`/projeção seguem vindo do outcome do helper.
        assert!(source.contains(concat!("i64::from(outcome", ".covered)")));
        assert!(source.contains(concat!("outcome", ".tokens_freed")));
    }

    #[test]
    fn manual_compact_projection_keeps_context_and_updates_compacted() {
        let (db, conversation_id) = db_with_conversation();
        assert!(session::context_stats(&db, &conversation_id).is_none());

        let stats = session::estimate_context(4_000, 8_000, 2_000, 200_000, 8_192, 10, 2, 0);
        session::save_context_stats(&db, &conversation_id, "turn-1", &stats).expect("stats");
        let before = session::context_stats(&db, &conversation_id).expect("contexto antes");
        assert_eq!(before.compacted, 0);

        // `/compact` manual grava só a projeção canônica (`context/compacted`).
        record_manual_compaction(&db, &conversation_id, 7, 900).expect("compactação manual");

        // D25: o fold do medidor continua lendo o `ContextStats` completo; antes
        // do fix o payload parcial em `context/stats` zerava o `context`.
        let after = session::context_stats(&db, &conversation_id).expect("contexto depois");
        assert_eq!(after.used, stats.used);
        assert_eq!(
            after.compacted, 0,
            "o manual não reescreve context/stats (payload exige ContextStats inteiro)"
        );
        assert_eq!(session::compacted_messages(&db, &conversation_id), 7);
        // `get_code_session_state` projeta o compacted atualizado via overlay.
        let projected = project_context(
            Some(after),
            session::compacted_messages(&db, &conversation_id),
        )
        .expect("contexto projetado");
        assert_eq!(projected.compacted, 7);
        assert_eq!(projected.used, stats.used);
        assert!(
            project_context(None, 7).is_none(),
            "sem stats persistido não inventa contexto"
        );

        // Um segundo `/compact` atualiza a projeção (último evento vence).
        record_manual_compaction(&db, &conversation_id, 9, 500).expect("segunda compactação");
        assert_eq!(session::compacted_messages(&db, &conversation_id), 9);

        // Resumo da compactação manual: `to_seq` = mensagens cobertas.
        db.insert_session_summary(&conversation_id, 1, 9, "resumo manual", None)
            .expect("resumo");
        let latest = db
            .latest_session_summary(&conversation_id)
            .expect("ler resumo")
            .expect("resumo persistido");
        assert_eq!(latest.to_seq, 9);
    }
}
