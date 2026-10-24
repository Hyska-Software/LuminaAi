//! Conversation CRUD commands (implemented by the storage module).

use tauri::{AppHandle, State};

use crate::domain::{Conversation, ConversationDetail};
use crate::state::AppState;

#[tauri::command]
pub fn list_conversations(state: State<'_, AppState>) -> Result<Vec<Conversation>, String> {
    let _ = &state;
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn create_conversation(
    state: State<'_, AppState>,
    title: Option<String>,
    provider_id: Option<String>,
    model_id: Option<String>,
) -> Result<Conversation, String> {
    let _ = (state, title, provider_id, model_id);
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn get_conversation(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<ConversationDetail>, String> {
    let _ = (state, id);
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn rename_conversation(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> Result<(), String> {
    let _ = (state, id, title);
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn delete_conversation(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let _ = (state, id);
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn set_conversation_pinned(
    state: State<'_, AppState>,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    let _ = (state, id, pinned);
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn search_conversations(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<Conversation>, String> {
    let _ = (state, query);
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn truncate_conversation(
    state: State<'_, AppState>,
    conversation_id: String,
    from_message_id: String,
) -> Result<(), String> {
    let _ = (state, conversation_id, from_message_id);
    todo!("implemented by the storage module")
}

#[tauri::command]
pub fn export_conversation(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    format: String,
) -> Result<Option<String>, String> {
    let _ = (app, state, id, format);
    todo!("implemented by the storage module")
}
