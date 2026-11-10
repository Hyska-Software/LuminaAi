//! Computer-use audit/status commands.

use base64::Engine;
use tauri::{AppHandle, Emitter, State};

use crate::computer::{ComputerActionRecord, ComputerSession};
use crate::state::AppState;

fn to_error(error: impl std::fmt::Display) -> String {
    format!("{error:#}")
}

pub(crate) fn begin_control_audit(state: &AppState, conversation_id: &str, backend: &str, action: &str) -> Result<String, String> {
    begin_control_audit_db(&state.db, conversation_id, backend, action)
}

fn begin_control_audit_db(db: &crate::db::Db, conversation_id: &str, backend: &str, action: &str) -> Result<String, String> {
    let conversation = db.get_conversation(conversation_id).map_err(to_error)?
        .ok_or_else(|| "COMPUTER_CONVERSATION_NOT_FOUND".to_string())?;
    let now = crate::domain::now_ms();
    let session = match db.list_computer_sessions(conversation_id).map_err(to_error)?
        .into_iter().find(|session| session.status == "active") {
        Some(session) => session,
        None => db.get_or_create_computer_session(conversation.agent_id.as_deref(), conversation_id, backend, now).map_err(to_error)?,
    };
    let action = db.begin_computer_action(
        &session.id, conversation.agent_id.as_deref(), conversation_id, "human-control",
        action, action, &serde_json::json!({}), None, "human", now,
    ).map_err(to_error)?;
    Ok(action.id)
}

pub(crate) fn finish_control_audit(state: &AppState, id: &str) -> Result<(), String> {
    state.db.finish_computer_action(id, "ok", None, None, Some("allowed"), Some("human"), crate::domain::now_ms()).map_err(to_error)
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
    pub control_target: String,
    pub session_id: Option<String>,
    pub captured_at: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerControlTarget {
    pub kind: String,
    pub url: Option<String>,
    pub generation: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerControlStatus {
    conversation_id: String,
    paused: bool,
    taken_over: bool,
    target: String,
    generation: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalScreenFrame {
    data_url: String,
    width: u32,
    height: u32,
    captured_at: i64,
}

fn local_streams() -> &'static parking_lot::Mutex<std::collections::HashMap<String, tokio_util::sync::CancellationToken>> {
    static STREAMS: std::sync::OnceLock<parking_lot::Mutex<std::collections::HashMap<String, tokio_util::sync::CancellationToken>>> = std::sync::OnceLock::new();
    STREAMS.get_or_init(Default::default)
}

#[tauri::command]
pub async fn computer_start_local_stream(
    app: AppHandle, state: State<'_, AppState>, conversation_id: String, stream_id: String,
    on_frame: tauri::ipc::Channel<LocalScreenFrame>,
) -> Result<(), String> {
    ensure_computer_capability(&state, &conversation_id)?;
    let settings = settings_for_conversation(&state, &conversation_id, crate::config::load_settings(&app));
    if !crate::computer::desktop_enabled(&settings) || crate::computer::backend(&settings) != crate::computer::ComputerBackend::Local {
        return Err(crate::i18n::t("computer.errors.streamUnavailable").into());
    }
    if stream_id.is_empty() || stream_id.len() > 100 { return Err("COMPUTER_STREAM_INVALID".into()); }
    #[cfg(not(windows))]
    { let _ = on_frame; return Err(crate::i18n::t("computer.errors.unsupported").into()); }
    #[cfg(windows)]
    {
        let cancel = tokio_util::sync::CancellationToken::new();
        if let Some(previous) = local_streams().lock().insert(stream_id.clone(), cancel.clone()) { previous.cancel(); }
        tauri::async_runtime::spawn(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let script = r#"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
while ($true) {
  $b=[System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height)
  $g=[System.Drawing.Graphics]::FromImage($bmp)
  $stream=New-Object System.IO.MemoryStream
  try {
    $g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size)
    $bmp.Save($stream,[System.Drawing.Imaging.ImageFormat]::Jpeg)
    [Console]::Out.WriteLine("$($b.Width),$($b.Height),$([Convert]::ToBase64String($stream.ToArray()))")
    [Console]::Out.Flush()
  } finally { $stream.Dispose(); $g.Dispose(); $bmp.Dispose() }
  Start-Sleep -Milliseconds 250
}
"#;
            let encoded = base64::engine::general_purpose::STANDARD.encode(script.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<_>>());
            let mut command = tokio::process::Command::new("powershell");
            command.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &encoded])
                .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null()).kill_on_drop(true).creation_flags(0x08000000);
            if let Ok(mut child) = command.spawn() {
                if let Some(stdout) = child.stdout.take() {
                    let mut lines = BufReader::new(stdout).lines();
                    loop {
                        let next = tokio::select! { _ = cancel.cancelled() => break, next = lines.next_line() => next };
                        let Ok(Some(line)) = next else { break };
                        let mut fields = line.splitn(3, ',');
                        let (Some(width), Some(height), Some(data)) = (fields.next(), fields.next(), fields.next()) else { continue };
                        let (Ok(width), Ok(height)) = (width.parse::<u32>(), height.parse::<u32>()) else { continue };
                        if data.len() > 16 * 1024 * 1024 { continue; }
                        if on_frame.send(LocalScreenFrame { data_url: format!("data:image/jpeg;base64,{data}"), width, height, captured_at: crate::domain::now_ms() }).is_err() { break; }
                    }
                }
                let _ = child.kill().await;
            }
            let mut streams = local_streams().lock();
            if streams.get(&stream_id).is_some_and(|current| current == &cancel) { streams.remove(&stream_id); }
        });
        Ok(())
    }
}

#[tauri::command]
pub fn computer_stop_local_stream(stream_id: String) {
    if let Some(cancel) = local_streams().lock().remove(&stream_id) { cancel.cancel(); }
}

#[tauri::command]
pub fn computer_control_status(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<ComputerControlStatus, String> {
    let conversation = state.db.get_conversation(&conversation_id).map_err(to_error)?
        .ok_or_else(|| "COMPUTER_CONVERSATION_NOT_FOUND".to_string())?;
    if let Some(agent_id) = conversation.agent_id {
        let agent = state.db.get_agent(&agent_id).map_err(to_error)?
            .ok_or_else(|| "COMPUTER_AGENT_NOT_FOUND".to_string())?;
        if !agent.capabilities.computer_use && !agent.capabilities.screen_capture && !agent.capabilities.browser_use {
            return Err("COMPUTER_CAPABILITY_DENIED".to_string());
        }
    }
    let (paused, taken_over) = state.db.computer_control(&conversation_id).map_err(to_error)?;
    let target = state.db.computer_control_target(&conversation_id).map_err(to_error)?;
    let generation = if paused && taken_over && target == "browser" { crate::computer::control::gate(&conversation_id).browser_generation() } else { None };
    Ok(ComputerControlStatus { conversation_id, paused, taken_over, target, generation })
}

pub(crate) fn emit_control_status(app: &AppHandle, state: &AppState, conversation_id: &str) {
    if let (Ok((paused, taken_over)), Ok(target)) = (state.db.computer_control(conversation_id), state.db.computer_control_target(conversation_id)) {
        let generation = if paused && taken_over && target == "browser" { crate::computer::control::gate(conversation_id).browser_generation() } else { None };
        let _ = app.emit("zylara:computer-control", ComputerControlStatus { conversation_id: conversation_id.to_string(), paused, taken_over, target, generation });
    }
}

/// Opens a one-use local bridge to the isolated desktop's RFB server.
#[tauri::command]
pub async fn computer_open_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
    interactive: bool,
) -> Result<String, String> {
    ensure_computer_capability(&state, &conversation_id)?;
    let settings = settings_for_conversation(&state, &conversation_id, crate::config::load_settings(&app));
    if !crate::computer::desktop_enabled(&settings)
        || crate::computer::backend(&settings) != crate::computer::ComputerBackend::Docker {
        return Err("COMPUTER_STREAM_UNAVAILABLE: o fluxo integrado requer o desktop privado".into());
    }
    let gate = crate::computer::control::gate(&conversation_id);
    let _transition = gate.transition.lock().await;
    crate::computer::ensure_container(&settings, &state.data_dir, &conversation_id).await.map_err(to_error)?;
    crate::computer::verify_stream_support(&settings, &state.data_dir, &conversation_id).await.map_err(to_error)?;
    crate::computer::stream::open(
        state.db.clone(), conversation_id.clone(),
        crate::computer::container_for(&settings, &conversation_id), interactive,
    ).await
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
        .ok_or_else(|| crate::i18n::t("computer.errors.agentNotFound"))?;
    if !agent.capabilities.computer_use && !agent.capabilities.screen_capture {
        return Err(
            crate::i18n::t("computer.errors.capabilityDenied"),
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
        return Err(crate::i18n::t("computer.errors.previewDisabled"));
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
        .map_err(to_error)?;
    let control_target = state.db.computer_control_target(&conversation_id).map_err(to_error)?;
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
        control_target,
        session_id,
        captured_at: crate::domain::now_ms(),
    })
}

#[tauri::command]
pub async fn set_computer_paused(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
    paused: bool,
) -> Result<(), String> {
    ensure_computer_capability(&state, &conversation_id)?;
    let gate = crate::computer::control::gate(&conversation_id);
    let _transition = gate.transition.lock().await;
    if paused {
        state.db.set_computer_control(&conversation_id, Some(true), None, crate::domain::now_ms()).map_err(to_error)?;
        gate.request_takeover();
    }
    let _action = gate.action.lock().await;
    let (_, taken_over) = state.db.computer_control(&conversation_id).map_err(to_error)?;
    if !paused && taken_over {
        return Err("COMPUTER_CONTROL_HELD: devolva o controle antes de retomar".to_string());
    }
    state
        .db
        .set_computer_control(&conversation_id, Some(paused), None, crate::domain::now_ms())
        .map_err(to_error)?;
    emit_control_status(&app, &state, &conversation_id);
    Ok(())
}

/// Pauses the agent and grants control only after in-flight actions finish.
#[tauri::command]
pub async fn computer_take_control(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<ComputerControlTarget, String> {
    ensure_computer_capability(&state, &conversation_id)?;
    let settings = settings_for_conversation(
        &state,
        &conversation_id,
        crate::config::load_settings(&app),
    );
    if !crate::computer::desktop_enabled(&settings) {
        return Err(crate::i18n::t("computer.errors.noDesktop"));
    }
    let backend = crate::computer::backend(&settings);
    let host_gate = crate::computer::control::gate(crate::computer::control::HOST_CONTROL);
    let _host_transition = if backend == crate::computer::ComputerBackend::Local { Some(host_gate.transition.lock().await) } else { None };
    if backend == crate::computer::ComputerBackend::Local {
        let (_, held) = state.db.computer_control(&conversation_id).map_err(to_error)?;
        if held && state.db.computer_control_target(&conversation_id).map_err(to_error)? != "desktop" {
            return Err("COMPUTER_CONTROL_HELD: devolva o controle do navegador primeiro".into());
        }
        crate::computer::control::request_host(&state.db, &conversation_id)?;
    }
    let _host_action = if backend == crate::computer::ComputerBackend::Local { Some(host_gate.action.lock().await) } else { None };
    let gate = crate::computer::control::gate(&conversation_id);
    let _transition = gate.transition.lock().await;
    let (_, held) = state.db.computer_control(&conversation_id).map_err(to_error)?;
    if held && state.db.computer_control_target(&conversation_id).map_err(to_error)? != "desktop" {
        if backend == crate::computer::ComputerBackend::Local {
            crate::computer::control::release_host(&state.db, &conversation_id)?;
        }
        return Err("COMPUTER_CONTROL_HELD: devolva o controle do navegador primeiro".into());
    }
    state.db.set_computer_control(&conversation_id, Some(true), None, crate::domain::now_ms()).map_err(to_error)?;
    gate.request_takeover();
    emit_control_status(&app, &state, &conversation_id);
    let _action = gate.action.lock().await;
    let target = match backend {
        crate::computer::ComputerBackend::Local => ComputerControlTarget {
            kind: "local".to_string(),
            url: None,
            generation: None,
        },
        crate::computer::ComputerBackend::Docker => {
            crate::computer::ensure_container(&settings, &state.data_dir, &conversation_id).await.map_err(to_error)?;
            ComputerControlTarget {
                kind: "vnc".to_string(),
                url: None,
                generation: None,
            }
        }
    };
    let audit = begin_control_audit(&state, &conversation_id, if backend == crate::computer::ComputerBackend::Docker { "docker" } else { "local" }, "computer.control_taken")?;
    state.db.set_computer_control_target(&conversation_id, "desktop").map_err(to_error)?;
    state
        .db
        .set_computer_control(
            &conversation_id,
            Some(true),
            Some(true),
            crate::domain::now_ms(),
        )
        .map_err(to_error)?;
    finish_control_audit(&state, &audit)?;
    emit_control_status(&app, &state, &conversation_id);
    Ok(target)
}

#[tauri::command]
pub async fn release_computer_control(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
    expected_target: String,
    generation: Option<String>,
) -> Result<(), String> {
    release_computer_control_inner(&state.db, &conversation_id, &expected_target, generation.as_deref()).await?;
    emit_control_status(&app, &state, &conversation_id);
    Ok(())
}

/// The command and integration tests share the complete serialized handoff.
pub(crate) async fn release_computer_control_inner(
    db: &crate::db::Db,
    conversation_id: &str,
    expected_target: &str,
    generation: Option<&str>,
) -> Result<(), String> {
    release_computer_control_with_browser(db, conversation_id, expected_target, generation, crate::computer::browser::global()).await
}

/// Shared handoff implementation; production supplies the global browser manager.
pub(crate) async fn release_computer_control_with_browser(
    db: &crate::db::Db,
    conversation_id: &str,
    expected_target: &str,
    generation: Option<&str>,
    browser: Option<&crate::computer::browser::BrowserManager>,
) -> Result<(), String> {
    let host_gate = crate::computer::control::gate(crate::computer::control::HOST_CONTROL);
    let _host_transition = if expected_target == "desktop" { Some(host_gate.transition.lock().await) } else { None };
    let host_owned = expected_target == "desktop" && db.computer_control_target(crate::computer::control::HOST_CONTROL).map_err(to_error)? == conversation_id;
    let _host_action = if host_owned { Some(host_gate.action.lock().await) } else { None };
    let gate = crate::computer::control::gate(conversation_id);
    let _transition = gate.transition.lock().await;
    let _stream = if expected_target == "desktop" {
        Some(gate.drain_interactive_stream().await?)
    } else {
        None
    };
    let _action = gate.action.lock().await;
    let target = db.computer_control_target(conversation_id).map_err(to_error)?;
    if !target.is_empty() && target != expected_target {
        return Err(crate::i18n::t("computer.errors.controlHeld").into());
    }
    if expected_target == "browser" {
        gate.require_browser_generation(generation.unwrap_or(""))?;
    }
    if target == "browser" {
        browser
            .ok_or(crate::i18n::t("computer.errors.browserUnavailable"))?
            .release_human_input(conversation_id).await?;
        gate.invalidate_browser_generation();
    }
    let audit = begin_control_audit_db(db, conversation_id, "control", "computer.control_released")?;
    db.set_computer_needs_observation(conversation_id, true).map_err(to_error)?;
    db
        .set_computer_control(
            conversation_id,
            Some(false),
            Some(false),
            crate::domain::now_ms(),
        )
        .map_err(to_error)?;
    db.set_computer_control_target(conversation_id, "").map_err(to_error)?;
    if host_owned { crate::computer::control::release_host(db, conversation_id)?; }
    gate.request_takeover();
    db.finish_computer_action(&audit, "ok", None, None, Some("allowed"), Some("human"), crate::domain::now_ms()).map_err(to_error)?;
    Ok(())
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
        return Err(crate::i18n::t("computer.errors.imageOutsideDir"));
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
    let host_gate = crate::computer::control::gate(crate::computer::control::HOST_CONTROL);
    let _host_transition = host_gate.transition.lock().await;
    let host_owned = state.db.computer_control_target(crate::computer::control::HOST_CONTROL).map_err(to_error)? == conversation_id;
    let _host_action = if host_owned { Some(host_gate.action.lock().await) } else { None };
    let gate = crate::computer::control::gate(&conversation_id);
    let _transition = gate.transition.lock().await;
    state.db.set_computer_control(&conversation_id, Some(true), Some(false), crate::domain::now_ms()).map_err(to_error)?;
    state.db.set_computer_control_target(&conversation_id, "").map_err(to_error)?;
    gate.invalidate_stream();
    emit_control_status(&app, &state, &conversation_id);
    state.cancel_conversation(&conversation_id);
    let _stream = gate.interactive_stream.lock().await;
    let _action = gate.action.lock().await;
    gate.invalidate_browser_generation();
    if host_owned { crate::computer::control::release_host(&state.db, &conversation_id)?; }
    state
        .db
        .end_computer_session(&conversation_id, "stopped", crate::domain::now_ms())
        .map_err(to_error)?;
    if let Some(manager) = crate::computer::browser::global() {
        manager.close(&conversation_id);
    }
    let settings = settings_for_conversation(
        &state,
        &conversation_id,
        crate::config::load_settings(&app),
    );
    if crate::computer::backend(&settings) == crate::computer::ComputerBackend::Docker {
        crate::computer::remove_container(&settings, &state.data_dir, &conversation_id)
            .await
            .map_err(to_error)?;
        gate.clear_stream_cleanup_error();
    }
    Ok(())
}

#[tauri::command]
pub async fn stop_all_computer_sessions(app: AppHandle, state: State<'_, AppState>) -> Result<u64, String> {
    let sessions = state.db.list_active_computer_sessions().map_err(to_error)?;
    let conversations: std::collections::HashSet<_> = sessions.iter().map(|session| session.conversation_id.clone()).collect();
    for conversation_id in &conversations {
        state.cancel_conversation(conversation_id);
        crate::computer::control::gate(conversation_id).request_takeover();
    }
    let mut failures = Vec::new();
    for conversation_id in conversations {
        if let Err(error) = stop_computer_session(app.clone(), state.clone(), conversation_id.clone()).await {
            failures.push(format!("{conversation_id}: {error}"));
        }
    }
    if let Some(manager) = crate::computer::browser::global() {
        manager.close_all();
    }
    if !failures.is_empty() {
        return Err(format!("COMPUTER_STOP_FAILED: {}", failures.join("; ")));
    }
    Ok(sessions.len() as u64)
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
        return Err(crate::i18n::t("computer.errors.screenshotOutsideDir"));
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

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn release_keeps_human_control_when_rfb_cleanup_fails() {
        let db = crate::db::Db::open_in_memory().expect("database");
        let conversation = db.create_conversation("Cleanup failure", "test", "test").expect("conversation").id;
        db.set_computer_control(&conversation, Some(true), Some(true), 1).expect("takeover");
        db.set_computer_control_target(&conversation, "desktop").expect("target");
        let gate = crate::computer::control::gate(&conversation);
        gate.set_stream_cleanup_error("test cleanup failure".into());
        let error = super::release_computer_control_inner(&db, &conversation, "desktop", None)
            .await.expect_err("failed cleanup must not release control");
        assert!(error.contains("COMPUTER_INPUT_CLEANUP_FAILED"));
        assert_eq!(db.computer_control(&conversation).expect("control"), (true, true));
        assert_eq!(db.computer_control_target(&conversation).expect("target"), "desktop");
        gate.clear_stream_cleanup_error();
    }
}
