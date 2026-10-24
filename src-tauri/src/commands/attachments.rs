//! Attachment import / inspection commands (implemented by the storage module).

use tauri::{AppHandle, State};

use crate::domain::AttachmentInfo;
use crate::state::AppState;

#[tauri::command]
pub fn import_attachments(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<AttachmentInfo>, String> {
    let _ = (&app, &state, paths);
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn get_attachment(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<AttachmentInfo>, String> {
    let _ = (&state, id);
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn delete_attachment(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let _ = (&app, &state, id);
    todo!("implemented by the storage module")
}
