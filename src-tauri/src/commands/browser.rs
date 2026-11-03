//! Local CDP browser commands used by the agent right sidebar.

use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::computer::browser::{
    self, BrowserFrame, BrowserSnapshot, BrowserStatus, BrowserTab,
};
use crate::state::AppState;

fn to_error(error: impl std::fmt::Display) -> String {
    format!("{error:#}")
}

fn manager() -> Result<&'static browser::BrowserManager, String> {
    browser::global().ok_or_else(|| "BROWSER_NOT_INITIALIZED".to_string())
}

fn ensure_browser_capability(
    state: &AppState,
    conversation_id: &str,
) -> Result<(), String> {
    let conversation = state
        .db
        .get_conversation(conversation_id)
        .map_err(to_error)?
        .ok_or_else(|| format!("BROWSER_CONVERSATION_NOT_FOUND: `{conversation_id}`"))?;
    let Some(agent_id) = conversation.agent_id.as_deref() else {
        return Ok(());
    };
    let agent = state
        .db
        .get_agent(agent_id)
        .map_err(to_error)?
        .ok_or_else(|| "BROWSER_AGENT_NOT_FOUND".to_string())?;
    if !agent.capabilities.browser_use {
        return Err(
            "BROWSER_CAPABILITY_DENIED: ative o navegador para este agente".to_string(),
        );
    }
    Ok(())
}

fn download_dir(state: &AppState, conversation_id: &str) -> Option<PathBuf> {
    let conversation = state.db.get_conversation(conversation_id).ok().flatten()?;
    let workspace_id = conversation.workspace_id?;
    let workspace = state.db.get_workspace(&workspace_id).ok().flatten()?;
    Some(PathBuf::from(workspace.path).join("downloads"))
}

#[tauri::command]
pub async fn browser_session_status(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<BrowserStatus, String> {
    ensure_browser_capability(&state, &conversation_id)?;
    Ok(manager()?.status(&conversation_id).await)
}

#[tauri::command]
pub async fn browser_session_open(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
    url: Option<String>,
) -> Result<BrowserStatus, String> {
    ensure_browser_capability(&state, &conversation_id)?;
    let settings = crate::config::load_settings(&app);
    let target = url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| browser::validate_with_policy(&settings, value))
        .transpose()?;
    let status = manager()?
        .ensure(&conversation_id, download_dir(&state, &conversation_id))
        .await?;
    if let Some(target) = target {
        manager()?
            .navigate(&conversation_id, status.active_tab.as_deref(), &target)
            .await?;
    }
    Ok(manager()?.status(&conversation_id).await)
}

#[tauri::command]
pub async fn browser_session_close(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<bool, String> {
    let _ = ensure_browser_capability(&state, &conversation_id);
    Ok(manager()?.close(&conversation_id))
}

#[tauri::command]
pub async fn browser_tabs(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<BrowserTab>, String> {
    ensure_browser_capability(&state, &conversation_id)?;
    manager()?.tabs(&conversation_id).await
}

#[tauri::command]
pub async fn browser_new_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
    url: Option<String>,
) -> Result<BrowserTab, String> {
    ensure_browser_capability(&state, &conversation_id)?;
    let settings = crate::config::load_settings(&app);
    let target = url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| browser::validate_with_policy(&settings, value))
        .transpose()?;
    manager()?
        .ensure(&conversation_id, download_dir(&state, &conversation_id))
        .await?;
    manager()?
        .new_tab(&conversation_id, target.as_deref())
        .await
}

#[tauri::command]
pub async fn browser_close_tab(
    state: State<'_, AppState>,
    conversation_id: String,
    tab_id: String,
) -> Result<(), String> {
    ensure_browser_capability(&state, &conversation_id)?;
    manager()?.close_tab(&conversation_id, &tab_id).await
}

#[tauri::command]
pub async fn browser_activate_tab(
    state: State<'_, AppState>,
    conversation_id: String,
    tab_id: String,
) -> Result<(), String> {
    ensure_browser_capability(&state, &conversation_id)?;
    manager()?.activate_tab(&conversation_id, &tab_id).await
}

#[tauri::command]
pub async fn browser_navigate(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
    tab_id: Option<String>,
    url: String,
) -> Result<String, String> {
    ensure_browser_capability(&state, &conversation_id)?;
    let settings = crate::config::load_settings(&app);
    let target = browser::validate_with_policy(&settings, &url)?;
    manager()?
        .navigate(&conversation_id, tab_id.as_deref(), &target)
        .await
}

#[tauri::command]
pub async fn browser_history(
    state: State<'_, AppState>,
    conversation_id: String,
    tab_id: Option<String>,
    action: String,
) -> Result<(), String> {
    ensure_browser_capability(&state, &conversation_id)?;
    manager()?
        .history(&conversation_id, tab_id.as_deref(), &action)
        .await
}

#[tauri::command]
pub async fn browser_frame(
    state: State<'_, AppState>,
    conversation_id: String,
    tab_id: Option<String>,
) -> Result<BrowserFrame, String> {
    ensure_browser_capability(&state, &conversation_id)?;
    manager()?.frame(&conversation_id, tab_id.as_deref()).await
}

/// Human takeover click from the panel preview (only when paused/taken over).
#[tauri::command]
pub async fn browser_click_at(
    state: State<'_, AppState>,
    conversation_id: String,
    tab_id: Option<String>,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let (paused, taken_over) = state
        .db
        .computer_control(&conversation_id)
        .map_err(to_error)?;
    if !paused && !taken_over {
        return Err(
            "BROWSER_HUMAN_CONTROL_REQUIRED: assuma o controle antes de clicar no preview"
                .to_string(),
        );
    }
    manager()?
        .click_at(&conversation_id, tab_id.as_deref(), x, y)
        .await
}

#[tauri::command]
pub async fn browser_press_key(
    state: State<'_, AppState>,
    conversation_id: String,
    tab_id: Option<String>,
    key: String,
) -> Result<(), String> {
    let (paused, taken_over) = state
        .db
        .computer_control(&conversation_id)
        .map_err(to_error)?;
    if !paused && !taken_over {
        return Err(
            "BROWSER_HUMAN_CONTROL_REQUIRED: assuma o controle antes de digitar no preview"
                .to_string(),
        );
    }
    manager()?
        .press(&conversation_id, tab_id.as_deref(), &key)
        .await
}

#[tauri::command]
pub async fn browser_insert_text(
    state: State<'_, AppState>,
    conversation_id: String,
    tab_id: Option<String>,
    text: String,
) -> Result<(), String> {
    let (paused, taken_over) = state
        .db
        .computer_control(&conversation_id)
        .map_err(to_error)?;
    if !paused && !taken_over {
        return Err(
            "BROWSER_HUMAN_CONTROL_REQUIRED: assuma o controle antes de digitar no preview"
                .to_string(),
        );
    }
    manager()?
        .insert_text(&conversation_id, tab_id.as_deref(), &text)
        .await
}

#[tauri::command]
pub async fn browser_snapshot(
    state: State<'_, AppState>,
    conversation_id: String,
    tab_id: Option<String>,
) -> Result<BrowserSnapshot, String> {
    ensure_browser_capability(&state, &conversation_id)?;
    manager()?.snapshot(&conversation_id, tab_id.as_deref()).await
}

#[tauri::command]
pub async fn browser_take_control(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<crate::commands::computer::ComputerControlTarget, String> {
    ensure_browser_capability(&state, &conversation_id)?;
    manager()?.take_control(&conversation_id, true).await?;
    state
        .db
        .set_computer_control(
            &conversation_id,
            Some(true),
            Some(true),
            crate::domain::now_ms(),
        )
        .map_err(to_error)?;
    Ok(crate::commands::computer::ComputerControlTarget {
        kind: "browser".to_string(),
        url: None,
    })
}
