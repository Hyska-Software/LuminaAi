//! Local CDP browser commands used by the agent right sidebar.

use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::computer::browser::{
    self, BrowserFrame, BrowserSnapshot, BrowserStatus, BrowserTab,
};
use crate::state::AppState;

fn streams() -> &'static parking_lot::Mutex<std::collections::HashMap<String, tokio_util::sync::CancellationToken>> {
    static STREAMS: std::sync::OnceLock<parking_lot::Mutex<std::collections::HashMap<String, tokio_util::sync::CancellationToken>>> = std::sync::OnceLock::new();
    STREAMS.get_or_init(Default::default)
}

#[tauri::command]
pub async fn browser_start_stream(
    state: State<'_, AppState>,
    conversation_id: String,
    tab_id: Option<String>,
    stream_id: String,
    on_frame: tauri::ipc::Channel<BrowserFrame>,
) -> Result<(), String> {
    ensure_browser_capability(&state, &conversation_id)?;
    if stream_id.len() > 100 || stream_id.is_empty() { return Err("BROWSER_STREAM_INVALID".into()); }
    let manager = manager()?;
    if !manager.is_active(&conversation_id) { return Err("BROWSER_NOT_RUNNING".into()); }
    let cancel = tokio_util::sync::CancellationToken::new();
    if let Some(previous) = streams().lock().insert(stream_id.clone(), cancel.clone()) { previous.cancel(); }
    tauri::async_runtime::spawn(async move {
        let _ = manager.stream_frames(&conversation_id, tab_id.as_deref(), cancel.clone(), on_frame).await;
        let mut registry = streams().lock();
        if registry.get(&stream_id).is_some_and(|current| current == &cancel) { registry.remove(&stream_id); }
    });
    Ok(())
}

#[tauri::command]
pub fn browser_stop_stream(stream_id: String) {
    if let Some(cancel) = streams().lock().remove(&stream_id) { cancel.cancel(); }
}

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
    let gate = crate::computer::control::gate(&conversation_id);
    let _action = gate.action.lock().await;
    let starting = !manager()?.is_active(&conversation_id);
    let settings = crate::config::load_settings(&app);
    let target = url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| browser::validate_with_policy(&settings, value))
        .transpose()?;
    let control = state.db.computer_control(&conversation_id).map_err(to_error)?;
    if target.is_some() && (!starting || control == (true, true)) {
        return Err("BROWSER_HUMAN_CONTROL_REQUIRED: use a barra de endereço durante o controle".into());
    }
    let status = manager()?
        .ensure(&conversation_id, download_dir(&state, &conversation_id))
        .await?;
    if starting && control == (true, true)
        && state.db.computer_control_target(&conversation_id).map_err(to_error)? == "browser" {
        gate.start_browser_generation();
        crate::commands::computer::emit_control_status(&app, &state, &conversation_id);
    }
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
    let gate = crate::computer::control::gate(&conversation_id);
    let _action = gate.action.lock().await;
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
    generation: String,
) -> Result<BrowserTab, String> {
    let gate = crate::computer::control::gate(&conversation_id);
    let _action = gate.action.lock().await;
    ensure_human_control(&state, &conversation_id)?;
    gate.require_browser_generation(&generation)?;
    let settings = crate::config::load_settings(&app);
    let target = url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| browser::validate_with_policy(&settings, value))
        .transpose()?;
    if !manager()?.is_active(&conversation_id) {
        return Err("BROWSER_NOT_RUNNING: abra o navegador primeiro".into());
    }
    manager()?
        .new_tab(&conversation_id, target.as_deref())
        .await
}

#[tauri::command]
pub async fn browser_close_tab(
    state: State<'_, AppState>,
    conversation_id: String,
    tab_id: String,
    generation: String,
) -> Result<(), String> {
    let gate = crate::computer::control::gate(&conversation_id);
    let _action = gate.action.lock().await;
    ensure_human_control(&state, &conversation_id)?;
    gate.require_browser_generation(&generation)?;
    manager()?.release_human_input(&conversation_id).await?;
    manager()?.close_tab(&conversation_id, &tab_id).await
}

#[tauri::command]
pub async fn browser_activate_tab(
    state: State<'_, AppState>,
    conversation_id: String,
    tab_id: String,
    generation: String,
) -> Result<(), String> {
    let gate = crate::computer::control::gate(&conversation_id);
    let _action = gate.action.lock().await;
    ensure_human_control(&state, &conversation_id)?;
    gate.require_browser_generation(&generation)?;
    manager()?.activate_tab(&conversation_id, &tab_id).await
}

#[tauri::command]
pub async fn browser_navigate(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
    tab_id: Option<String>,
    url: String,
    generation: String,
) -> Result<String, String> {
    let gate = crate::computer::control::gate(&conversation_id);
    let _action = gate.action.lock().await;
    ensure_human_control(&state, &conversation_id)?;
    gate.require_browser_generation(&generation)?;
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
    generation: String,
) -> Result<(), String> {
    let gate = crate::computer::control::gate(&conversation_id);
    let _action = gate.action.lock().await;
    ensure_human_control(&state, &conversation_id)?;
    gate.require_browser_generation(&generation)?;
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

fn ensure_human_control(state: &AppState, conversation_id: &str) -> Result<(), String> {
    ensure_browser_capability(state, conversation_id)?;
    let (paused, taken_over) = state.db.computer_control(conversation_id).map_err(to_error)?;
    if !paused || !taken_over || state.db.computer_control_target(conversation_id).map_err(to_error)? != "browser" {
        return Err("BROWSER_HUMAN_CONTROL_REQUIRED: assuma o controle antes de interagir".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_human_input(
    state: State<'_, AppState>, conversation_id: String, tab_id: Option<String>,
    kind: String, params: serde_json::Value, generation: String,
) -> Result<(), String> {
    let gate = crate::computer::control::gate(&conversation_id);
    let _action = gate.action.lock().await;
    ensure_human_control(&state, &conversation_id)?;
    gate.require_browser_generation(&generation)?;
    manager()?.human_input(&conversation_id, tab_id.as_deref(), &kind, params).await
}

/// Human takeover click from the panel preview.
#[tauri::command]
pub async fn browser_click_at(
    state: State<'_, AppState>,
    conversation_id: String,
    tab_id: Option<String>,
    x: f64,
    y: f64,
    generation: String,
) -> Result<(), String> {
    let gate = crate::computer::control::gate(&conversation_id);
    let _action = gate.action.lock().await;
    ensure_human_control(&state, &conversation_id)?;
    gate.require_browser_generation(&generation)?;
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
    generation: String,
) -> Result<(), String> {
    let gate = crate::computer::control::gate(&conversation_id);
    let _action = gate.action.lock().await;
    ensure_human_control(&state, &conversation_id)?;
    gate.require_browser_generation(&generation)?;
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
    generation: String,
) -> Result<(), String> {
    let gate = crate::computer::control::gate(&conversation_id);
    let _action = gate.action.lock().await;
    ensure_human_control(&state, &conversation_id)?;
    gate.require_browser_generation(&generation)?;
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
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<crate::commands::computer::ComputerControlTarget, String> {
    ensure_browser_capability(&state, &conversation_id)?;
    if !manager()?.is_active(&conversation_id) {
        return Err("BROWSER_NOT_RUNNING: abra o navegador antes de assumir o controle".to_string());
    }
    let gate = crate::computer::control::gate(&conversation_id);
    let _transition = gate.transition.lock().await;
    let (_, held) = state.db.computer_control(&conversation_id).map_err(to_error)?;
    if held && state.db.computer_control_target(&conversation_id).map_err(to_error)? != "browser" {
        return Err("COMPUTER_CONTROL_HELD: devolva o controle do desktop primeiro".into());
    }
    state.db.set_computer_control(&conversation_id, Some(true), None, crate::domain::now_ms()).map_err(to_error)?;
    gate.request_takeover();
    crate::commands::computer::emit_control_status(&app, &state, &conversation_id);
    let _action = gate.action.lock().await;
    let audit = crate::commands::computer::begin_control_audit(&state, &conversation_id, "browser", "computer.control_taken")?;
    state.db.set_computer_control_target(&conversation_id, "browser").map_err(to_error)?;
    state
        .db
        .set_computer_control(
            &conversation_id,
            Some(true),
            Some(true),
            crate::domain::now_ms(),
        )
        .map_err(to_error)?;
    let generation = if held {
        gate.browser_generation().unwrap_or_else(|| gate.start_browser_generation())
    } else {
        gate.start_browser_generation()
    };
    crate::commands::computer::finish_control_audit(&state, &audit)?;
    crate::commands::computer::emit_control_status(&app, &state, &conversation_id);
    Ok(crate::commands::computer::ComputerControlTarget {
        kind: "browser".to_string(),
        url: None,
        generation: Some(generation),
    })
}
