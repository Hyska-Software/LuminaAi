//! Scheduled agent routines.
//!
//! A routine is one instruction plus a schedule. Each run appends a normal turn
//! to a dedicated agent thread, so the result lands where its context already
//! lives. The scheduler runs only while the app is open; it is not a cron
//! service or a cloud worker.

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio_util::sync::CancellationToken;

use crate::agents::{routine_next_run_at, AgentRoutine, AgentRoutineInput};
use crate::domain::{TurnKind, TurnOptions, TurnPayload, TurnProfile};
use crate::events::TurnEvent;
use crate::harness::{self, EventEmitter, HarnessDeps};
use crate::state::AppState;

fn to_error(error: impl std::fmt::Display) -> String {
    format!("{error:#}")
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

struct SilentEmitter;
impl EventEmitter for SilentEmitter {
    fn emit(&self, _event: TurnEvent) {}
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRoutineRunEvent {
    pub routine_id: String,
    pub agent_id: String,
    pub conversation_id: Option<String>,
    pub title: String,
    pub status: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn list_agent_routines(
    state: State<'_, AppState>,
    agent_id: String,
) -> Result<Vec<AgentRoutine>, String> {
    state.db.list_agent_routines(&agent_id).map_err(to_error)
}

#[tauri::command]
pub fn create_agent_routine(
    state: State<'_, AppState>,
    agent_id: String,
    input: AgentRoutineInput,
) -> Result<AgentRoutine, String> {
    let input = input.normalize()?;
    state
        .db
        .create_agent_routine(&agent_id, &input, now_ms())
        .map_err(to_error)
}

#[tauri::command]
pub fn update_agent_routine(
    state: State<'_, AppState>,
    routine_id: String,
    input: AgentRoutineInput,
) -> Result<AgentRoutine, String> {
    let input = input.normalize()?;
    state
        .db
        .update_agent_routine(&routine_id, &input, now_ms())
        .map_err(to_error)
}

#[tauri::command]
pub fn set_agent_routine_enabled(
    state: State<'_, AppState>,
    routine_id: String,
    enabled: bool,
) -> Result<AgentRoutine, String> {
    state
        .db
        .set_agent_routine_enabled(&routine_id, enabled, now_ms())
        .map_err(to_error)
}

#[tauri::command]
pub fn delete_agent_routine(
    state: State<'_, AppState>,
    routine_id: String,
) -> Result<(), String> {
    state.db.delete_agent_routine(&routine_id).map_err(to_error)
}

/// Runs one routine immediately, in its dedicated thread.
#[tauri::command]
pub async fn run_agent_routine_now(
    app: AppHandle,
    state: State<'_, AppState>,
    routine_id: String,
) -> Result<AgentRoutine, String> {
    let routine = state
        .db
        .get_agent_routine(&routine_id)
        .map_err(to_error)?
        .ok_or_else(|| format!("AGENT_ROUTINE_NOT_FOUND: rotina `{routine_id}` não existe"))?;
    execute_routine(&app, &routine).await?;
    state
        .db
        .get_agent_routine(&routine_id)
        .map_err(to_error)?
        .ok_or_else(|| format!("AGENT_ROUTINE_NOT_FOUND: rotina `{routine_id}` não existe"))
}

/// One scheduler pass. Called by the background loop; also safe to call from a
/// test/command. Sequential by design: routines never overlap the same thread.
pub async fn scheduler_tick(app: AppHandle) {
    let due = {
        let state = app.state::<AppState>();
        match state.db.list_due_agent_routines(now_ms()) {
            Ok(due) => due,
            Err(error) => {
                eprintln!("lumina: falha ao listar rotinas: {error:#}");
                return;
            }
        }
    };
    for routine in due {
        if let Err(error) = execute_routine(&app, &routine).await {
            eprintln!(
                "lumina: rotina `{}` falhou: {error}",
                routine.title
            );
        }
    }
}

async fn execute_routine(app: &AppHandle, routine: &AgentRoutine) -> Result<(), String> {
    let state = app.state::<AppState>();
    let db = state.db.clone();
    let agent = db
        .get_agent(&routine.agent_id)
        .map_err(to_error)?
        .ok_or_else(|| {
            format!(
                "AGENT_NOT_FOUND: agente `{}` não existe",
                routine.agent_id
            )
        })?;
    if agent.is_archived() {
        let error = "AGENT_ARCHIVED: restaure o agente antes de executar a rotina".to_string();
        let next = routine_next_run_at(
            &routine.schedule_kind,
            routine.interval_minutes,
            routine.hour,
            routine.minute,
            now_ms(),
        );
        let _ = db.mark_agent_routine_run(
            &routine.id,
            None,
            "blocked",
            Some(&error),
            next,
            now_ms(),
        );
        emit_run(app, routine, None, "blocked", Some(error.clone()));
        return Err(error);
    }

    let conversation = match routine.conversation_id.as_deref() {
        Some(id) => match db.get_conversation(id).map_err(to_error)? {
            Some(conversation) => conversation,
            // The user deleted the routine thread: recreate it instead of
            // leaving the routine permanently broken.
            None => db
                .create_agent_conversation(&agent.id, &routine.title)
                .map_err(to_error)?,
        },
        None => db
            .create_agent_conversation(&agent.id, &routine.title)
            .map_err(to_error)?,
    };

    // Mark the next schedule before the model call so a crash cannot run the
    // same slot twice; the status is replaced with the real result below.
    let next = routine_next_run_at(
        &routine.schedule_kind,
        routine.interval_minutes,
        routine.hour,
        routine.minute,
        now_ms(),
    );
    let _ = db.mark_agent_routine_run(
        &routine.id,
        Some(&conversation.id),
        "running",
        None,
        next,
        now_ms(),
    );

    let profile = if conversation.workspace_id.is_some() {
        TurnProfile::Code
    } else {
        TurnProfile::Chat
    };
    let payload = TurnPayload {
        conversation_id: conversation.id.clone(),
        content: routine.prompt.clone(),
        attachment_ids: Vec::new(),
        provider_id: agent.provider_id.clone(),
        model_id: agent.model_id.clone(),
        reasoning: agent.reasoning.clone(),
        options: TurnOptions::default(),
        profile,
        turn_kind: TurnKind::User,
        goal_request: false,
        turn_id: Some(uuid::Uuid::new_v4().to_string()),
    };
    let settings = crate::config::load_settings(app);
    let deps = HarnessDeps {
        app: Some(app.clone()),
        db: db.clone(),
        http: state.http.clone(),
        search_http: state.search_http.clone(),
        catalog: state.catalog.clone(),
        data_dir: None,
        skills_roots: None,
        // Unattended runs cannot answer approval/questions cards. Fail closed
        // immediately instead of waiting for the approval timeout.
        approvals: None,
        observed: Some(state.observed.clone()),
        jobs: Some(state.jobs.clone()),
        questions: None,
        mcp: Some(state.mcp.clone()),
        streamer: None,
        api_key_override: None,
        credential_override: None,
        refresh_override: None,
        model_source: None,
    };
    let result = harness::run_turn(
        deps,
        payload,
        settings,
        Arc::new(SilentEmitter),
        CancellationToken::new(),
    )
    .await;

    let (status, error) = match result {
        Ok(_) => ("ok", None),
        Err(error) => ("error", Some(format!("{error:#}"))),
    };
    let _ = db.mark_agent_routine_run(
        &routine.id,
        Some(&conversation.id),
        status,
        error.as_deref(),
        next,
        now_ms(),
    );
    emit_run(app, routine, Some(&conversation.id), status, error.clone());
    if let Some(error) = error {
        Err(error)
    } else {
        Ok(())
    }
}

fn emit_run(
    app: &AppHandle,
    routine: &AgentRoutine,
    conversation_id: Option<&str>,
    status: &str,
    error: Option<String>,
) {
    let _ = app.emit(
        "lumina:agent-routine-run",
        AgentRoutineRunEvent {
            routine_id: routine.id.clone(),
            agent_id: routine.agent_id.clone(),
            conversation_id: conversation_id.map(str::to_string),
            title: routine.title.clone(),
            status: status.to_string(),
            error,
        },
    );
}
