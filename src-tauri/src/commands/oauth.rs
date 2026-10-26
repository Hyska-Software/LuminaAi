//! Tauri commands for the "Sign in with ChatGPT" flow (OpenAI plan usage).
//!
//! Two-phase login: `openai_login_start` returns the authorization URL (also
//! opened in the browser) and an attempt id; `openai_login_wait` resolves when
//! the loopback callback is processed. No token ever crosses this boundary.

use tauri::{AppHandle, State};

use crate::domain::{LoginChallenge, ProviderAuthStatus};
use crate::state::AppState;

fn to_error(error: impl std::fmt::Display) -> String {
    format!("{error:#}")
}

#[tauri::command]
pub async fn openai_login_start(
    app: AppHandle,
    state: State<'_, AppState>,
    provider_id: String,
    force_consent: Option<bool>,
) -> Result<LoginChallenge, String> {
    crate::oauth::login_start(
        &app,
        state.oauth.clone(),
        &state.http,
        &state.catalog,
        &provider_id,
        force_consent.unwrap_or(false),
    )
    .await
    .map_err(to_error)
}

#[tauri::command]
pub async fn openai_login_wait(
    state: State<'_, AppState>,
    attempt_id: String,
) -> Result<ProviderAuthStatus, String> {
    crate::oauth::login_wait(&state.oauth, &attempt_id)
        .await
        .map_err(to_error)
}

#[tauri::command]
pub async fn openai_login_cancel(
    state: State<'_, AppState>,
    attempt_id: String,
) -> Result<(), String> {
    crate::oauth::login_cancel(&state.oauth, &attempt_id).map_err(to_error)
}

#[tauri::command]
pub async fn openai_sign_out(
    app: AppHandle,
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<ProviderAuthStatus, String> {
    crate::oauth::sign_out(
        &app,
        &state.oauth,
        &state.catalog,
        &state.http,
        &provider_id,
    )
    .await
    .map_err(to_error)
}

#[tauri::command]
pub fn openai_auth_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Vec<ProviderAuthStatus> {
    crate::oauth::statuses(&app, &state.catalog)
}

/// Refreshes the account model list and returns the merged catalog view.
#[tauri::command]
pub async fn refresh_provider_models(
    app: AppHandle,
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<crate::domain::CatalogView, String> {
    crate::commands::models::refresh_provider_models_impl(&app, &state, &provider_id)
        .await
        .map_err(to_error)
}

#[cfg(test)]
mod tests {
    /// Registration guard: the command names must be present in the
    /// `generate_handler!` list (Tauri does not fail compilation otherwise).
    #[test]
    fn auth_commands_are_registered() {
        let lib = include_str!("../lib.rs");
        for command in [
            "commands::oauth::openai_login_start",
            "commands::oauth::openai_login_wait",
            "commands::oauth::openai_login_cancel",
            "commands::oauth::openai_sign_out",
            "commands::oauth::openai_auth_status",
            "commands::oauth::refresh_provider_models",
        ] {
            assert!(
                lib.contains(command),
                "comando {command} não está registrado no generate_handler!"
            );
        }
    }
}
