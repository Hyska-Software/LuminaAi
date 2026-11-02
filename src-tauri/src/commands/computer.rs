//! Computer-use audit/status commands.

use base64::Engine;
use tauri::State;

use crate::computer::{ComputerActionRecord, ComputerSession};
use crate::state::AppState;

fn to_error(error: impl std::fmt::Display) -> String {
    format!("{error:#}")
}

#[tauri::command]
pub fn list_computer_actions(
    state: State<'_, AppState>,
    conversation_id: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<ComputerActionRecord>, String> {
    state
        .db
        .list_computer_actions(conversation_id.as_deref(), limit)
        .map_err(to_error)
}

#[tauri::command]
pub fn list_computer_sessions(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<ComputerSession>, String> {
    state
        .db
        .list_computer_sessions(&conversation_id)
        .map_err(to_error)
}

#[tauri::command]
pub fn list_active_computer_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<ComputerSession>, String> {
    state.db.list_active_computer_sessions().map_err(to_error)
}

/// Ends the active computer-use session of a conversation (Stop button).
#[tauri::command]
pub fn stop_computer_session(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<(), String> {
    state
        .db
        .end_computer_session(&conversation_id, "stopped", crate::domain::now_ms())
        .map_err(to_error)
}

#[tauri::command]
pub fn stop_all_computer_sessions(state: State<'_, AppState>) -> Result<u64, String> {
    state
        .db
        .end_all_computer_sessions("stopped", crate::domain::now_ms())
        .map_err(to_error)
}

/// Returns a data URL for a screenshot *inside the app-data computer folder*.
/// The path is validated so the renderer can never read arbitrary files.
#[tauri::command]
pub fn computer_screenshot_preview(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    let requested = std::path::PathBuf::from(&path);
    let root = state.data_dir.join("computer");
    let canonical_root = root.canonicalize().map_err(to_error)?;
    let canonical = requested.canonicalize().map_err(to_error)?;
    if !canonical.starts_with(&canonical_root) {
        return Err("COMPUTER_PREVIEW_FORBIDDEN: caminho fora do diretório de screenshots".to_string());
    }
    let bytes = std::fs::read(&canonical).map_err(to_error)?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("COMPUTER_PREVIEW_TOO_LARGE: screenshot acima de 8 MiB".to_string());
    }
    let mime = if canonical
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("jpg") || ext.eq_ignore_ascii_case("jpeg"))
    {
        "image/jpeg"
    } else {
        "image/png"
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}
