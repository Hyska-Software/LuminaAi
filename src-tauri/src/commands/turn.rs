//! One conversational turn: streaming harness execution + cancellation.

use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::domain::{TurnPayload, TurnResult};
use crate::events::TurnEvent;
use crate::harness::{self, HarnessDeps};
use crate::state::AppState;

#[tauri::command]
pub async fn run_turn(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: TurnPayload,
    on_event: Channel<TurnEvent>,
) -> Result<TurnResult, String> {
    let turn_id = payload
        .turn_id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let cancel = state.register_turn(&turn_id);
    let settings = crate::config::load_settings(&app);
    let deps = HarnessDeps {
        app: Some(app.clone()),
        db: state.db.clone(),
        http: state.http.clone(),
        search_http: state.search_http.clone(),
        catalog: state.catalog.clone(),
        streamer: None,
        api_key_override: None,
    };
    let result = harness::run_turn(
        deps,
        payload,
        settings,
        std::sync::Arc::new(on_event),
        cancel,
    )
    .await;
    state.finish_turn(&turn_id);
    result.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn cancel_turn(state: State<'_, AppState>, turn_id: String) -> bool {
    state.cancel_turn(&turn_id)
}
