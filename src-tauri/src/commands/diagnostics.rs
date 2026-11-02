//! Read-only platform diagnostics for support and the Activity panel.

use serde::Serialize;
use tauri::State;

use crate::agents::AgentTask;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticTurn {
    pub turn_id: String,
    pub conversation_id: String,
    pub started_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformDiagnostics {
    pub version: String,
    pub active_turns: Vec<DiagnosticTurn>,
    pub active_computer_sessions: usize,
    pub open_tasks: usize,
    pub tasks_by_status: std::collections::BTreeMap<String, usize>,
    pub generated_at: i64,
}

#[tauri::command]
pub fn platform_diagnostics(state: State<'_, AppState>) -> Result<PlatformDiagnostics, String> {
    let tasks = state
        .db
        .list_agent_tasks(None, None, None, Some(500))
        .map_err(|error| format!("{error:#}"))?;
    let mut tasks_by_status = std::collections::BTreeMap::new();
    for task in &tasks {
        *tasks_by_status.entry(task.status.clone()).or_insert(0) += 1;
    }
    let open_statuses = [
        "queued",
        "accepted",
        "running",
        "waiting_input",
        "waiting_approval",
        "review",
        "handoff_pending",
    ];
    let open_tasks = tasks
        .iter()
        .filter(|task: &&AgentTask| open_statuses.contains(&task.status.as_str()))
        .count();
    let active_computer_sessions = state
        .db
        .list_active_computer_sessions()
        .map(|sessions| sessions.len())
        .unwrap_or(0);
    Ok(PlatformDiagnostics {
        version: env!("CARGO_PKG_VERSION").to_string(),
        active_turns: state
            .active_turn_details()
            .into_iter()
            .map(|(turn_id, conversation_id, started_at)| DiagnosticTurn {
                turn_id,
                conversation_id,
                started_at,
            })
            .collect(),
        active_computer_sessions,
        open_tasks,
        tasks_by_status,
        generated_at: crate::domain::now_ms(),
    })
}
