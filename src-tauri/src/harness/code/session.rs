//! Projeções da sessão de código sobre `code_events` (log append-only).
//!
//! `messages` continua sendo a fonte da história do modelo; `code_events` é a
//! fonte dos fatos da UI: permissões, plano, tarefas, contexto, aprovações,
//! alterações e reversões (`docs/goals/code-harness/HARNESS.md` §11).
//!
//! Todas as projeções são folds simples do último evento de um `kind`; o
//! snapshot completo é montado por `commands::code::get_code_session_state`.

use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::db::Db;
use crate::domain::{ContextStats, PlanState, PlanView, TodoItem, TodoStatus};

pub const KIND_APPROVAL_ASKED: &str = "approval/asked";
pub const KIND_APPROVAL_DECIDED: &str = "approval/decided";
pub const KIND_PERMISSION_MODE: &str = "permission/mode";
pub const KIND_PLAN_MODE: &str = "plan/mode";
pub const KIND_PLAN_SUBMITTED: &str = "plan/submitted";
pub const KIND_PLAN_APPROVED: &str = "plan/approved";
pub const KIND_TODOS: &str = "todos";
pub const KIND_CONTEXT_STATS: &str = "context/stats";
pub const KIND_CHANGES_SUMMARY: &str = "changes/summary";
pub const KIND_REVERT: &str = "revert/performed";
pub const KIND_TURN_ENDED: &str = "turn/ended";
pub const KIND_TURN_INTERRUPTED: &str = "turn/interrupted";

/// Grava um evento da sessão (JSON serializado).
pub fn append(db: &Db, conversation_id: &str, turn_id: Option<&str>, kind: &str, payload: &Value) -> anyhow::Result<()> {
    db.append_code_event(conversation_id, turn_id, kind, &payload.to_string())?;
    Ok(())
}

fn latest<T: DeserializeOwned>(db: &Db, conversation_id: &str, kind: &str) -> Option<T> {
    db.latest_code_event(conversation_id, kind)
        .ok()
        .flatten()
        .and_then(|event| serde_json::from_str::<T>(&event.payload).ok())
}

#[derive(Debug, serde::Deserialize)]
struct ModePayload {
    #[serde(default)]
    active: bool,
}

#[derive(Debug, serde::Deserialize)]
struct PlanPayload {
    #[serde(default)]
    markdown: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct TodosPayload {
    #[serde(default)]
    items: Vec<TodoItem>,
}

/// Modo Plano está ativo nesta sessão?
pub fn plan_mode_active(db: &Db, conversation_id: &str) -> bool {
    latest::<ModePayload>(db, conversation_id, KIND_PLAN_MODE)
        .map(|payload| payload.active)
        .unwrap_or(false)
}

/// Liga/desliga o modo Plano (append-only; último evento vence).
pub fn set_plan_mode(db: &Db, conversation_id: &str, active: bool) -> anyhow::Result<()> {
    append(
        db,
        conversation_id,
        None,
        KIND_PLAN_MODE,
        &serde_json::json!({ "active": active }),
    )
}

/// Estado do plano: em planejamento, aguardando revisão ou aprovado.
pub fn plan_view(db: &Db, conversation_id: &str) -> Option<PlanView> {
    let active = plan_mode_active(db, conversation_id);
    let submitted = db.latest_code_event(conversation_id, KIND_PLAN_SUBMITTED).ok()?;
    let approved = db.latest_code_event(conversation_id, KIND_PLAN_APPROVED).ok()?;
    match submitted {
        None => {
            if active {
                Some(PlanView {
                    state: PlanState::Planning,
                    markdown: None,
                    updated_at: crate::domain::now_ms(),
                })
            } else {
                None
            }
        }
        Some(submitted) => {
            let markdown = serde_json::from_str::<PlanPayload>(&submitted.payload)
                .ok()
                .and_then(|payload| payload.markdown);
            let is_approved = approved
                .as_ref()
                .map(|event| event.seq > submitted.seq)
                .unwrap_or(false);
            Some(PlanView {
                state: if is_approved {
                    PlanState::Approved
                } else {
                    PlanState::Reviewing
                },
                markdown,
                updated_at: submitted.created_at,
            })
        }
    }
}

/// Registra o plano submetido para revisão.
pub fn submit_plan(db: &Db, conversation_id: &str, turn_id: &str, markdown: &str) -> anyhow::Result<()> {
    append(
        db,
        conversation_id,
        Some(turn_id),
        KIND_PLAN_SUBMITTED,
        &serde_json::json!({ "markdown": markdown }),
    )
}

/// Marca o plano como aprovado (a sessão sai do modo Plano).
pub fn approve_plan(db: &Db, conversation_id: &str, turn_id: &str) -> anyhow::Result<()> {
    append(
        db,
        conversation_id,
        Some(turn_id),
        KIND_PLAN_APPROVED,
        &serde_json::json!({ "approved": true }),
    )?;
    set_plan_mode(db, conversation_id, false)
}

/// Lista de tarefas atual do agente.
pub fn todos(db: &Db, conversation_id: &str) -> Vec<TodoItem> {
    latest::<TodosPayload>(db, conversation_id, KIND_TODOS)
        .map(|payload| payload.items)
        .unwrap_or_default()
}

/// Substitui a lista inteira de tarefas (e emite para a UI pelo chamador).
pub fn save_todos(db: &Db, conversation_id: &str, turn_id: &str, items: &[TodoItem]) -> anyhow::Result<()> {
    append(
        db,
        conversation_id,
        Some(turn_id),
        KIND_TODOS,
        &serde_json::json!({ "items": items }),
    )
}

/// Valida a lista de tarefas (itens vazios/duplicados, in_progress único).
pub fn validate_todos(items: &[TodoItem], allow_parallel: bool) -> Result<(), String> {
    if items.is_empty() {
        return Err("a lista de tarefas não pode ficar vazia".to_string());
    }
    if items.len() > 50 {
        return Err("a lista de tarefas aceita no máximo 50 itens".to_string());
    }
    let mut seen = std::collections::HashSet::new();
    for item in items {
        let content = item.content.trim();
        if content.is_empty() {
            return Err("cada tarefa precisa de uma descrição".to_string());
        }
        if !seen.insert(content.to_lowercase()) {
            return Err(format!("tarefa duplicada: `{content}`"));
        }
    }
    if !allow_parallel {
        let in_progress = items
            .iter()
            .filter(|item| item.status == TodoStatus::InProgress)
            .count();
        if in_progress > 1 {
            return Err("no máximo uma tarefa pode estar `in_progress`".to_string());
        }
    }
    Ok(())
}

/// Uso de contexto mais recente registrado pela sessão.
pub fn context_stats(db: &Db, conversation_id: &str) -> Option<ContextStats> {
    latest::<ContextStats>(db, conversation_id, KIND_CONTEXT_STATS)
}

/// Persiste o uso de contexto do passo (chamado no fim de cada passo).
pub fn save_context_stats(db: &Db, conversation_id: &str, turn_id: &str, stats: &ContextStats) -> anyhow::Result<()> {
    append(
        db,
        conversation_id,
        Some(turn_id),
        KIND_CONTEXT_STATS,
        &serde_json::to_value(stats)?,
    )
}

/// Resumo das alterações de um turno (journal) para o evento `WorkspaceChanges`.
pub fn turn_changes(db: &Db, conversation_id: &str, turn_id: &str) -> Option<crate::domain::ChangesSummary> {
    let entries = db.list_file_journal_for_turn(conversation_id, turn_id).ok()?;
    if entries.is_empty() {
        return None;
    }
    let files: Vec<crate::domain::FileChangeSummary> = entries
        .into_iter()
        .map(|entry| crate::domain::FileChangeSummary {
            path: entry.path,
            kind: entry.change_kind,
            added: entry.added.unwrap_or(0),
            removed: entry.removed.unwrap_or(0),
            origin: Some("session".to_string()),
            staged: false,
        })
        .collect();
    Some(crate::domain::ChangesSummary {
        turn_id: Some(turn_id.to_string()),
        added: files.iter().map(|file| file.added).sum(),
        removed: files.iter().map(|file| file.removed).sum(),
        files,
    })
}

/// Estimativa de tokens do contexto do turno (heurística `chars/4` + overhead).
///
/// Não é um tokenizer exato: a UI mostra "≈" e o uso real do provider corrige a
/// leitura no próximo turno (`docs/goals/code-harness/HARNESS.md` §10.1).
pub fn estimate_context(
    system_prompt_chars: usize,
    history_chars: usize,
    tool_results_chars: usize,
    window: u32,
    output_cap: u32,
    messages: u32,
) -> ContextStats {
    let chars = system_prompt_chars + history_chars + tool_results_chars;
    let used = ((chars / 4) as u32).saturating_add(messages.saturating_mul(8));
    let percent = if window == 0 {
        0.0
    } else {
        (used as f32 / window as f32 * 100.0).min(100.0)
    };
    ContextStats {
        used,
        window,
        output_cap,
        percent,
        compacted: 0,
        messages,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::TodoStatus;

    fn db() -> Db {
        Db::open_in_memory().expect("banco em memória")
    }

    #[test]
    fn plan_mode_and_plan_view_lifecycle() {
        let db = db();
        assert!(!plan_mode_active(&db, "conv-1"));
        set_plan_mode(&db, "conv-1", true).expect("modo plano");
        assert!(plan_mode_active(&db, "conv-1"));
        set_plan_mode(&db, "conv-1", false).expect("modo plano off");
        assert!(!plan_mode_active(&db, "conv-1"));

        set_plan_mode(&db, "conv-1", true).expect("modo plano");
        submit_plan(&db, "conv-1", "turn-1", "# Plano\n\n1. Fazer").expect("plano");
        let view = plan_view(&db, "conv-1").expect("plano visível");
        assert_eq!(view.state, PlanState::Reviewing);
        assert!(view.markdown.unwrap().contains("# Plano"));

        approve_plan(&db, "conv-1", "turn-1").expect("aprovar");
        let view = plan_view(&db, "conv-1").expect("plano aprovado");
        assert_eq!(view.state, PlanState::Approved);
        assert!(!plan_mode_active(&db, "conv-1"));
    }

    #[test]
    fn todos_roundtrip_and_validation() {
        let db = db();
        let items = vec![
            TodoItem {
                content: "Ler o módulo".to_string(),
                status: TodoStatus::Completed,
            },
            TodoItem {
                content: "Corrigir o bug".to_string(),
                status: TodoStatus::InProgress,
            },
        ];
        validate_todos(&items, false).expect("lista válida");
        save_todos(&db, "conv-1", "turn-1", &items).expect("salvar");
        let loaded = todos(&db, "conv-1");
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[1].status, TodoStatus::InProgress);
    }

    #[test]
    fn rejects_duplicate_or_multiple_in_progress() {
        let db = db();
        let duplicates = vec![
            TodoItem {
                content: "A".to_string(),
                status: TodoStatus::Pending,
            },
            TodoItem {
                content: "a".to_string(),
                status: TodoStatus::Pending,
            },
        ];
        assert!(validate_todos(&duplicates, false).is_err());
        let parallel = vec![
            TodoItem {
                content: "A".to_string(),
                status: TodoStatus::InProgress,
            },
            TodoItem {
                content: "B".to_string(),
                status: TodoStatus::InProgress,
            },
        ];
        assert!(validate_todos(&parallel, false).is_err());
        assert!(validate_todos(&parallel, true).is_ok());
        let _ = db;
    }

    #[test]
    fn context_stats_roundtrip() {
        let db = db();
        assert!(context_stats(&db, "conv-1").is_none());
        let stats = ContextStats {
            used: 12_000,
            window: 200_000,
            output_cap: 32_000,
            percent: 6.0,
            compacted: 0,
            messages: 4,
        };
        save_context_stats(&db, "conv-1", "turn-1", &stats).expect("salvar stats");
        let loaded = context_stats(&db, "conv-1").expect("stats");
        assert_eq!(loaded.used, 12_000);
    }
}
