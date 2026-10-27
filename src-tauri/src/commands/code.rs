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
    ApprovalDecision, ApprovalRequest, ApprovalRule, ApprovalScope, ApprovalScope as Scope,
    ChangesSummary, CodeSessionState, ContextStats, FileChangeKind, FileChangeSummary, PlanState,
    PlanView, TodoItem, Workspace,
};
use crate::state::AppState;

use super::workspace::{enrich_workspace, project_info, workspace_path};

/// Kinds gravados em `code_events` pela sessão de código.
pub const EVENT_APPROVAL_ASKED: &str = "approval/asked";
pub const EVENT_APPROVAL_DECIDED: &str = "approval/decided";
pub const EVENT_PERMISSION_MODE: &str = "permission/mode";
pub const EVENT_PLAN_MODE: &str = "plan/mode";
pub const EVENT_PLAN_SUBMITTED: &str = "plan/submitted";
pub const EVENT_PLAN_APPROVED: &str = "plan/approved";
pub const EVENT_TODOS: &str = "todos";
pub const EVENT_CONTEXT_STATS: &str = "context/stats";
pub const EVENT_CHANGES_SUMMARY: &str = "changes/summary";
pub const EVENT_REVERT: &str = "revert/performed";

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

/// Payloads gravados em `code_events` (schema versionado por `kind`).
#[derive(Debug, Deserialize)]
struct ModePayload {
    #[serde(default)]
    active: bool,
}

#[derive(Debug, Deserialize)]
struct PlanPayload {
    #[serde(default)]
    markdown: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TodosPayload {
    #[serde(default)]
    items: Vec<TodoItem>,
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

    let plan_mode = state
        .db
        .latest_code_event(conversation_id, EVENT_PLAN_MODE)
        .map_err(map_err)?
        .and_then(|event| serde_json::from_str::<ModePayload>(&event.payload).ok())
        .map(|payload| payload.active)
        .unwrap_or(false);

    let plan = build_plan_view(state, conversation_id)?;
    let todos = state
        .db
        .latest_code_event(conversation_id, EVENT_TODOS)
        .map_err(map_err)?
        .and_then(|event| serde_json::from_str::<TodosPayload>(&event.payload).ok())
        .map(|payload| payload.items)
        .unwrap_or_default();
    let context = state
        .db
        .latest_code_event(conversation_id, EVENT_CONTEXT_STATS)
        .map_err(map_err)?
        .and_then(|event| serde_json::from_str::<ContextStats>(&event.payload).ok());

    let changes = collect_changes(state, conversation_id, workspace.as_ref()).await;

    let approvals: Vec<ApprovalRequest> = state
        .approvals
        .pending_requests()
        .into_iter()
        .filter(|request| {
            request.conversation_id.is_empty() || request.conversation_id == conversation_id
        })
        .collect();

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
        jobs: Vec::new(),
        approvals,
    })
}

fn build_plan_view(state: &AppState, conversation_id: &str) -> Result<Option<PlanView>, String> {
    let submitted = state
        .db
        .latest_code_event(conversation_id, EVENT_PLAN_SUBMITTED)
        .map_err(map_err)?;
    let approved = state
        .db
        .latest_code_event(conversation_id, EVENT_PLAN_APPROVED)
        .map_err(map_err)?;
    let active = state
        .db
        .latest_code_event(conversation_id, EVENT_PLAN_MODE)
        .map_err(map_err)?
        .and_then(|event| serde_json::from_str::<ModePayload>(&event.payload).ok())
        .map(|payload| payload.active)
        .unwrap_or(false);

    let Some(submitted) = submitted else {
        if active {
            return Ok(Some(PlanView {
                state: PlanState::Planning,
                markdown: None,
                updated_at: crate::domain::now_ms(),
            }));
        }
        return Ok(None);
    };
    let markdown = serde_json::from_str::<PlanPayload>(&submitted.payload)
        .ok()
        .and_then(|payload| payload.markdown);
    let is_approved = approved
        .as_ref()
        .map(|event| event.seq > submitted.seq)
        .unwrap_or(false);
    Ok(Some(PlanView {
        state: if is_approved {
            PlanState::Approved
        } else {
            PlanState::Reviewing
        },
        markdown,
        updated_at: submitted.created_at,
    }))
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
    let payload = serde_json::json!({ "active": plan_mode }).to_string();
    state
        .db
        .append_code_event(&conversation_id, None, EVENT_PLAN_MODE, &payload)
        .map_err(map_err)?;
    session_state(&state, &conversation_id).await
}

/// Responde a uma aprovação pendente (falha fechada para id desconhecido).
#[tauri::command]
pub async fn respond_approval(
    state: State<'_, AppState>,
    approval_id: String,
    decision: ApprovalDecision,
    scope: Option<ApprovalScope>,
    feedback: Option<String>,
) -> Result<bool, String> {
    let request = state.approvals.request(&approval_id);
    let Some(request) = request else {
        return Err("APPROVAL_NOT_FOUND: esta aprovação já foi resolvida".to_string());
    };
    let outcome = match decision {
        ApprovalDecision::Approved => {
            if let Some(scope) = scope {
                // "Sempre permitir": deriva a regra do pedido auditado.
                let (matcher, pattern, scope_id) = rule_from_request(&request, scope);
                let tool = request.tool.clone();
                let decision = ApprovalDecision::Approved;
                if let Err(error) = state.db.create_approval_rule(
                    &crate::db::NewApprovalRule {
                        scope,
                        scope_id: scope_id.as_deref(),
                        tool: &tool,
                        matcher: &matcher,
                        pattern: &pattern,
                        decision,
                    },
                ) {
                    return Err(format!("não foi possível salvar a regra: {error}"));
                }
            }
            crate::policy::approval::ApprovalOutcome {
                decision: ApprovalDecision::Approved,
                scope,
                feedback: feedback.clone(),
            }
        }
        ApprovalDecision::Denied | ApprovalDecision::Cancelled | ApprovalDecision::Expired => {
            crate::policy::approval::ApprovalOutcome {
                decision,
                scope: None,
                feedback: feedback.clone(),
            }
        }
    };
    let audit = serde_json::json!({
        "approvalId": approval_id,
        "decision": decision.as_str(),
        "scope": scope.map(|scope| scope.as_str()),
        "feedback": feedback,
    })
    .to_string();
    state
        .db
        .append_code_event(
            &request.conversation_id,
            None,
            EVENT_APPROVAL_DECIDED,
            &audit,
        )
        .map_err(map_err)?;
    Ok(state.approvals.resolve(&approval_id, outcome))
}

/// Deriva `(matcher, pattern, scope_id)` de um pedido para a regra "sempre".
fn rule_from_request(
    request: &ApprovalRequest,
    scope: ApprovalScope,
) -> (String, String, Option<String>) {
    let scope_id = match scope {
        ApprovalScope::Session => Some(request.conversation_id.clone()),
        ApprovalScope::Workspace => None,
        ApprovalScope::Global => None,
    };
    match &request.detail {
        crate::domain::ApprovalDetail::Command { command, .. } => {
            ("prefix".to_string(), command.trim().to_string(), scope_id)
        }
        crate::domain::ApprovalDetail::Paths { paths, .. } => (
            "glob".to_string(),
            paths.first().cloned().unwrap_or_default(),
            scope_id,
        ),
        crate::domain::ApprovalDetail::Secret { path }
        | crate::domain::ApprovalDetail::Outside { path } => {
            ("glob".to_string(), path.clone(), scope_id)
        }
        crate::domain::ApprovalDetail::Other { text } => {
            ("exact".to_string(), text.clone(), scope_id)
        }
    }
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
    crate::workspace::git::diff(&root, std::slice::from_ref(&relative), staged, 3, 200_000)
        .await
        .map_err(|error| format!("{}: {}", error.code, error.message))
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

/// Compactação manual do contexto (v1.5: ainda não implementada no loop Code).
#[tauri::command]
pub async fn compact_session(
    _state: State<'_, AppState>,
    _conversation_id: String,
) -> Result<bool, String> {
    Err("a compactação automática ainda não está disponível nesta versão".to_string())
}
