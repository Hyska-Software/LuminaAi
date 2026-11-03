//! Computer-use audit/status commands.

use base64::Engine;
use tauri::{AppHandle, State};

use crate::computer::{ComputerActionRecord, ComputerSession};
use crate::state::AppState;

fn to_error(error: impl std::fmt::Display) -> String {
    format!("{error:#}")
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerPreview {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub backend: String,
    pub active_window: String,
    pub paused: bool,
    pub taken_over: bool,
    pub session_id: Option<String>,
    pub captured_at: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerControlTarget {
    pub kind: String,
    pub url: Option<String>,
}

/// Applies the persona's computer environment to the global settings for this
/// command path (the harness does the same before a turn).
fn settings_for_conversation(
    state: &AppState,
    conversation_id: &str,
    mut settings: crate::domain::Settings,
) -> crate::domain::Settings {
    if let Ok(Some(conversation)) = state.db.get_conversation(conversation_id) {
        if let Some(agent_id) = conversation.agent_id.as_deref() {
            if let Ok(Some(agent)) = state.db.get_agent(agent_id) {
                settings.computer_environment = agent.computer_environment;
            }
        }
    }
    settings
}

fn ensure_computer_capability(
    state: &AppState,
    conversation_id: &str,
) -> Result<(), String> {
    let conversation = state
        .db
        .get_conversation(conversation_id)
        .map_err(to_error)?
        .ok_or_else(|| format!("COMPUTER_CONVERSATION_NOT_FOUND: `{conversation_id}`"))?;
    let Some(agent_id) = conversation.agent_id.as_deref() else {
        return Ok(());
    };
    let agent = state
        .db
        .get_agent(agent_id)
        .map_err(to_error)?
        .ok_or_else(|| "COMPUTER_AGENT_NOT_FOUND: o agente da conversa não existe".to_string())?;
    if !agent.capabilities.computer_use && !agent.capabilities.screen_capture {
        return Err(
            "COMPUTER_CAPABILITY_DENIED: ative o controle do computador para este agente"
                .to_string(),
        );
    }
    Ok(())
}

/// Live preview for the user-facing agent panel. It never touches the model
/// or the audit trail and deletes the temporary PNG after encoding it.
#[tauri::command]
pub async fn computer_preview(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<ComputerPreview, String> {
    ensure_computer_capability(&state, &conversation_id)?;
    let settings = settings_for_conversation(
        &state,
        &conversation_id,
        crate::config::load_settings(&app),
    );
    if !crate::computer::desktop_enabled(&settings) {
        return Err(
            "COMPUTER_PREVIEW_DISABLED: o ambiente está desligado ou em modo navegador"
                .to_string(),
        );
    }
    let shot = crate::computer::screenshot(&settings, &state.data_dir, &conversation_id)
        .await
        .map_err(to_error)?;
    let bytes = std::fs::read(&shot.path).map_err(to_error)?;
    let _ = std::fs::remove_file(&shot.path);
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("COMPUTER_PREVIEW_TOO_LARGE: screenshot acima de 8 MiB".to_string());
    }
    let backend = match crate::computer::backend(&settings) {
        crate::computer::ComputerBackend::Docker => "docker",
        crate::computer::ComputerBackend::Local => "local",
    };
    let active_window = crate::computer::active_window_title(
        &settings,
        &state.data_dir,
        &conversation_id,
    )
    .await
    .unwrap_or_default();
    let (paused, taken_over) = state
        .db
        .computer_control(&conversation_id)
        .unwrap_or((false, false));
    let session_id = state
        .db
        .list_computer_sessions(&conversation_id)
        .ok()
        .and_then(|sessions| {
            sessions
                .into_iter()
                .find(|session| session.status == "active")
                .map(|session| session.id)
        });
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(ComputerPreview {
        data_url: format!("data:image/png;base64,{encoded}"),
        width: shot.width,
        height: shot.height,
        backend: backend.to_string(),
        active_window,
        paused,
        taken_over,
        session_id,
        captured_at: crate::domain::now_ms(),
    })
}

#[tauri::command]
pub fn set_computer_paused(
    state: State<'_, AppState>,
    conversation_id: String,
    paused: bool,
) -> Result<(), String> {
    state
        .db
        .set_computer_control(&conversation_id, Some(paused), None, crate::domain::now_ms())
        .map_err(to_error)
}

/// Pauses the agent and returns where the human should interact. For the
/// private desktop this is noVNC (requires Docker networking); local/browser
/// control happens in the user's own window.
#[tauri::command]
pub async fn computer_take_control(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<ComputerControlTarget, String> {
    let settings = settings_for_conversation(
        &state,
        &conversation_id,
        crate::config::load_settings(&app),
    );
    let backend = crate::computer::backend(&settings);
    let target = match backend {
        crate::computer::ComputerBackend::Local => ComputerControlTarget {
            kind: "local".to_string(),
            url: None,
        },
        crate::computer::ComputerBackend::Docker => {
            if !settings.docker_network {
                return Err(
                    "COMPUTER_CONTROL_UNAVAILABLE: ative a rede do Docker para abrir o noVNC"
                        .to_string(),
                );
            }
            // Ensure the container exists and has the published noVNC port.
            crate::computer::screenshot(&settings, &state.data_dir, &conversation_id)
                .await
                .map_err(to_error)?;
            let url =
                crate::computer::vnc_url(&settings, &state.data_dir, &conversation_id)
                    .await
                    .map_err(to_error)?;
            ComputerControlTarget {
                kind: "vnc".to_string(),
                url: Some(url),
            }
        }
    };
    state
        .db
        .set_computer_control(
            &conversation_id,
            Some(true),
            Some(true),
            crate::domain::now_ms(),
        )
        .map_err(to_error)?;
    Ok(target)
}

#[tauri::command]
pub fn release_computer_control(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<(), String> {
    state
        .db
        .set_computer_control(
            &conversation_id,
            Some(false),
            Some(false),
            crate::domain::now_ms(),
        )
        .map_err(to_error)
}

/// Returns a data URL for a screenshot inside `<app-data>/tool-images`.
/// Tool screenshots are persisted there instead of in the DB.
#[tauri::command]
pub fn tool_image_preview(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let requested = std::path::PathBuf::from(&path);
    let root = state.data_dir.join("tool-images");
    let canonical_root = root.canonicalize().map_err(to_error)?;
    let canonical = requested.canonicalize().map_err(to_error)?;
    if !canonical.starts_with(&canonical_root) {
        return Err("TOOL_IMAGE_FORBIDDEN: caminho fora do diretório de imagens".to_string());
    }
    let bytes = std::fs::read(&canonical).map_err(to_error)?;
    if bytes.is_empty() || bytes.len() > 12 * 1024 * 1024 {
        return Err("TOOL_IMAGE_INVALID: imagem vazia ou acima de 12 MiB".to_string());
    }
    let mime = if canonical
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("png"))
    {
        "image/png"
    } else {
        "image/jpeg"
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
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
pub async fn stop_computer_session(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<(), String> {
    state
        .db
        .end_computer_session(&conversation_id, "stopped", crate::domain::now_ms())
        .map_err(to_error)?;
    let settings = settings_for_conversation(
        &state,
        &conversation_id,
        crate::config::load_settings(&app),
    );
    if crate::computer::backend(&settings) == crate::computer::ComputerBackend::Docker {
        let _ = crate::computer::remove_container(&settings, &state.data_dir, &conversation_id)
            .await;
    }
    Ok(())
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
