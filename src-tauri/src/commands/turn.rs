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
        // Produção resolve o data dir pelo AppHandle; o campo existe para os
        // testes do harness (sem Tauri) apontarem para um diretório temporário.
        data_dir: None,
        // `None` = repositórios padrão de skills (Agent Skills/Codex/Claude/
        // OpenCode) resolvidos a partir do home do usuário.
        skills_roots: None,
        approvals: Some(state.approvals.clone()),
        observed: Some(state.observed.clone()),
        jobs: Some(state.jobs.clone()),
        questions: Some(state.questions.clone()),
        streamer: None,
        api_key_override: None,
        // Produção resolve credencial/modelos pelo `AppState` (OAuth refresh,
        // lista de modelos da conta); os overrides existem só para testes.
        credential_override: None,
        refresh_override: None,
        model_source: None,
    };
    let events = on_event.clone();
    let result = harness::run_turn(
        deps,
        payload,
        settings,
        std::sync::Arc::new(on_event),
        cancel,
    )
    .await;
    state.finish_turn(&turn_id);
    match result {
        Ok(value) => Ok(value),
        Err(error) => {
            // A turn that fails before the first provider call (missing/expired
            // credential) persists nothing, so the renderer only learns about it
            // through this error event; surface the actionable code/hint.
            if let Some(credential) = error.downcast_ref::<harness::CredentialError>() {
                let _ = events.send(TurnEvent::Error {
                    message: credential.message.clone(),
                    code: Some(credential.code.to_string()),
                    hint: credential.hint.clone(),
                });
            }
            Err(format!("{error:#}"))
        }
    }
}

#[tauri::command]
pub fn cancel_turn(state: State<'_, AppState>, turn_id: String) -> bool {
    state.cancel_turn(&turn_id)
}
