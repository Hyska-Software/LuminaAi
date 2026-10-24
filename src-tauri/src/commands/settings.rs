//! Settings, API keys and app info commands (implemented by the storage module).

use tauri::{AppHandle, State};

use crate::domain::{AppInfo, ProviderValidation, Settings, SettingsView};
use crate::state::AppState;

#[tauri::command]
pub fn get_settings(app: AppHandle, state: State<'_, AppState>) -> Result<SettingsView, String> {
    let _ = (&app, &state);
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<SettingsView, String> {
    let _ = (&app, &state, settings);
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn set_provider_key(
    app: AppHandle,
    state: State<'_, AppState>,
    provider_id: String,
    key: Option<String>,
) -> Result<SettingsView, String> {
    let _ = (&app, &state, provider_id, key);
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn app_info(app: AppHandle, state: State<'_, AppState>) -> Result<AppInfo, String> {
    let _ = (&app, &state);
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn open_data_dir(app: AppHandle) -> Result<(), String> {
    let _ = &app;
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn reset_app_data(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let _ = (&app, &state);
    todo!("implemented by the storage module")
}

#[tauri::command]
pub async fn validate_provider(
    app: AppHandle,
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<ProviderValidation, String> {
    let _ = (&app, &state, provider_id);
    todo!("implemented by the storage module")
}
