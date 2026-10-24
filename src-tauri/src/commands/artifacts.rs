//! Artifact commands (implemented by the storage module).

use tauri::{AppHandle, State};

use crate::domain::{Artifact, ArtifactContent};
use crate::state::AppState;

#[tauri::command]
pub fn list_artifacts(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<Artifact>, String> {
    let _ = (&state, conversation_id);
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn get_artifact_content(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<ArtifactContent>, String> {
    let _ = (&state, id);
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn save_artifact(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    suggested_name: Option<String>,
) -> Result<Option<String>, String> {
    let _ = (&app, &state, id, suggested_name);
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn open_artifact(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let _ = (&app, &state, id);
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn delete_artifact(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let _ = (&app, &state, id);
    todo!("implemented by the storage module")
}
