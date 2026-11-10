//! Windows setup mode: the same binary exposes a small, isolated installer
//! surface (UI + engine) that never initializes the chat database or harness.
//!
//! The module is Windows-only. macOS and Linux ship native DMG/deb/rpm/AppImage
//! bundles instead of a setup wizard.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

pub mod context;
mod windows;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallerMode {
    Install,
    Uninstall,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallScope {
    User,
    Machine,
}

impl InstallScope {
    pub fn label(self) -> &'static str {
        match self {
            InstallScope::User => "user",
            InstallScope::Machine => "machine",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingInstall {
    pub scope: InstallScope,
    pub path: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallerContext {
    pub mode: InstallerMode,
    pub version: String,
    pub arch: String,
    pub is_admin: bool,
    pub default_path_user: String,
    pub default_path_machine: String,
    pub existing: Option<ExistingInstall>,
    pub conflicting: Option<ExistingInstall>,
    pub app_running: bool,
    pub webview2_installed: bool,
    pub free_bytes: Option<u64>,
    pub required_bytes: u64,
    pub log_path: String,
    pub data_paths: Vec<String>,
    pub can_elevate: bool,
    pub pending_options: Option<InstallOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOptions {
    pub scope: InstallScope,
    pub path: String,
    pub desktop_shortcut: bool,
    pub start_menu_shortcut: bool,
    pub launch_after_install: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallStep {
    pub id: String,
    pub label: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum InstallerEvent {
    Step { step: InstallStep },
    Progress { percent: f32, message: String },
    Log { line: String },
    Done {
        install_path: String,
        launched: bool,
        log_path: String,
    },
    Error {
        message: String,
        log_path: String,
    },
}

pub struct InstallerState {
    mode: InstallerMode,
    busy: AtomicBool,
    cancel: AtomicBool,
    log_path: Mutex<Option<PathBuf>>,
}

impl InstallerState {
    fn new(mode: InstallerMode) -> Self {
        Self {
            mode,
            busy: AtomicBool::new(false),
            cancel: AtomicBool::new(false),
            log_path: Mutex::new(None),
        }
    }

    pub fn mode(&self) -> InstallerMode {
        self.mode
    }

    pub fn cancel_requested(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    pub fn is_busy(&self) -> bool {
        self.busy.load(Ordering::SeqCst)
    }

    pub fn log_path(&self) -> PathBuf {
        let mut guard = self
            .log_path
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(path) = guard.as_ref() {
            return path.clone();
        }
        let path = windows::new_log_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path);
        *guard = Some(path.clone());
        path
    }
}

#[derive(Debug, Default)]
struct CliArgs {
    silent: bool,
    elevated: bool,
    from_temp: bool,
    allow_downgrade: bool,
    options: Option<InstallOptions>,
    purge: bool,
    no_launch: bool,
}

pub fn requested_options() -> Option<InstallOptions> {
    parse_cli().options
}

fn parse_cli() -> CliArgs {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut parsed = CliArgs::default();
    let mut scope: Option<InstallScope> = None;
    let mut path: Option<String> = None;
    let mut desktop = true;
    let mut start_menu = true;
    let mut launch = true;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--silent" | "/S" => parsed.silent = true,
            "--elevated" => parsed.elevated = true,
            "--from-temp" => parsed.from_temp = true,
            "--allow-downgrade" => parsed.allow_downgrade = true,
            "--purge" => parsed.purge = true,
            "--no-launch" => {
                launch = false;
                parsed.no_launch = true;
            }
            "--no-desktop" => desktop = false,
            "--no-start-menu" => start_menu = false,
            "--scope" => {
                if let Some(value) = args.get(index + 1) {
                    scope = match value.as_str() {
                        "machine" => Some(InstallScope::Machine),
                        _ => Some(InstallScope::User),
                    };
                    index += 1;
                }
            }
            "--dir" | "--install-dir" => {
                if let Some(value) = args.get(index + 1) {
                    path = Some(value.clone());
                    index += 1;
                }
            }
            _ => {}
        }
        index += 1;
    }
    if let Some(scope) = scope {
        let path = path.unwrap_or_else(|| windows::default_install_path(scope));
        parsed.options = Some(InstallOptions {
            scope,
            path,
            desktop_shortcut: desktop,
            start_menu_shortcut: start_menu,
            launch_after_install: launch,
        });
    }
    parsed
}

/// Detects setup/uninstall mode before Tauri initializes any window or state.
pub fn requested_mode() -> Option<InstallerMode> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--uninstall") {
        return Some(InstallerMode::Uninstall);
    }
    if args.iter().any(|arg| arg == "--setup") {
        return Some(InstallerMode::Install);
    }
    if std::env::var("ZYLARA_SETUP").ok().as_deref() == Some("1") {
        return Some(InstallerMode::Install);
    }

    let name = std::env::current_exe()
        .ok()
        .and_then(|path| path.file_name().map(|name| name.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    if name.contains("uninstall") {
        return Some(InstallerMode::Uninstall);
    }
    if name.contains("setup") {
        return Some(InstallerMode::Install);
    }
    None
}

pub fn run(mode: InstallerMode, mut context: tauri::Context<tauri::Wry>) {
    let cli = parse_cli();
    let state = InstallerState::new(mode);

    // Add/Remove Programs runs the installed exe. Copy ourselves to TEMP before
    // deleting the installation directory, so Windows does not keep the exe
    // locked while the uninstaller is running.
    if mode == InstallerMode::Uninstall && !cli.from_temp {
        if let Some(existing) = windows::find_install() {
            if existing.scope == InstallScope::Machine && !windows::is_admin() && !cli.elevated {
                if let Err(error) = windows::relaunch_self_elevated() {
                    windows::fatal_message("Zylara", &format!("{error:#}"));
                    std::process::exit(1);
                }
                std::process::exit(0);
            }
            if windows::is_current_exe_in(&existing.path) {
                if let Err(error) = windows::relaunch_from_temp_uninstall() {
                    windows::fatal_message("Zylara", &format!("{error:#}"));
                    std::process::exit(1);
                }
                std::process::exit(0);
            }
        }
    }

    if std::env::args().any(|arg| arg == "--self-test") {
        match context::build(&state) {
            Ok(value) => {
                println!("{}", serde_json::to_string_pretty(&value).unwrap_or_default());
                std::process::exit(0);
            }
            Err(error) => {
                eprintln!("{error:#}");
                std::process::exit(1);
            }
        }
    }

    if cli.silent {
        if mode == InstallerMode::Install {
            if let Err(error) = windows::ensure_webview2(false) {
                windows::write_log(&state, &format!("erro fatal: {error:#}"));
                std::process::exit(1);
            }
        }
        let result = match mode {
            InstallerMode::Install => windows::silent_install(&state, cli.options, cli.allow_downgrade),
            InstallerMode::Uninstall => windows::silent_uninstall(&state, cli.purge),
        };
        match result {
            Ok(()) => {
                if cli.from_temp {
                    windows::schedule_self_delete(&state);
                }
                std::process::exit(0);
            }
            Err(error) => {
                windows::write_log(&state, &format!("erro fatal: {error:#}"));
                std::process::exit(1);
            }
        }
    }

    if mode == InstallerMode::Install {
        if let Err(error) = windows::ensure_webview2(true) {
            windows::fatal_message(&crate::i18n::t("installer.window.install"), &format!("{error:#}"));
            std::process::exit(1);
        }
    }

    for window in &mut context.config_mut().app.windows {
        window.create = false;
    }

    // The installer starts in English regardless of the app's saved locale.
    crate::i18n::set_language("en");
    let title = installer_window_title(mode);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            installer_context,
            installer_start,
            installer_uninstall,
            installer_cancel,
            installer_close_app,
            installer_relaunch_elevated,
            installer_finish,
            installer_open_log,
            installer_open_folder,
            installer_set_language,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<InstallerState>();
                if state.is_busy() {
                    api.prevent_close();
                }
            }
        })
        .setup(move |app| {
            let state = app.state::<InstallerState>();
            windows::write_log(&state, "abrindo a janela do instalador");
            tauri::WebviewWindowBuilder::new(
                app,
                "setup",
                tauri::WebviewUrl::App("installer.html".into()),
            )
            .title(title)
            .inner_size(980.0, 640.0)
            .min_inner_size(900.0, 580.0)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .decorations(false)
            .center()
            .data_directory(windows::setup_webview_data_dir())
            .on_page_load(|window, payload| {
                let state = window.app_handle().state::<InstallerState>();
                windows::write_log(
                    &state,
                    &format!(
                        "página do instalador carregada ({:?}): {}",
                        payload.event(),
                        payload.url()
                    ),
                );
            })
            .build()?;
            windows::write_log(&state, "janela do instalador criada");
            Ok(())
        })
        .build(context)
        .expect("error while building the Zylara installer");

    let from_temp = cli.from_temp;
    app.run(move |app_handle, event| {
        if from_temp && matches!(event, tauri::RunEvent::Exit) {
            let state = app_handle.state::<InstallerState>();
            windows::schedule_self_delete(&state);
        }
    });
}

#[tauri::command]
fn installer_window_title(mode: InstallerMode) -> String {
    match mode {
        InstallerMode::Install => crate::i18n::t("installer.window.install"),
        InstallerMode::Uninstall => crate::i18n::t("installer.window.uninstall"),
    }
}

/// Switches the backend language and retitles the setup window. The renderer
/// calls this on mount and whenever the user changes the installer language.
#[tauri::command]
pub fn installer_set_language(app: AppHandle, locale: String) {
    crate::i18n::set_language(&locale);
    let mode = app.state::<InstallerState>().mode;
    if let Some(window) = app.get_webview_window("setup") {
        let _ = window.set_title(&installer_window_title(mode));
    }
}

#[tauri::command]
pub fn installer_context(state: State<'_, InstallerState>) -> Result<InstallerContext, String> {
    eprintln!("[zylara-setup] installer_context invoked");
    windows::write_log(&state, "contexto do instalador solicitado pela UI");
    context::build(&state).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub async fn installer_start(
    app: AppHandle,
    options: InstallOptions,
    on_event: Channel<InstallerEvent>,
) -> Result<(), String> {
    {
        let state = app.state::<InstallerState>();
        if state.busy.swap(true, Ordering::SeqCst) {
            return Err(crate::i18n::t("installer.errors.installInProgress"));
        }
        state.cancel.store(false, Ordering::SeqCst);
    }

    let app_for_task = app.clone();
    let events = on_event.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        let state = app_for_task.state::<InstallerState>();
        let result = windows::install(&state, &options, &events);
        state.busy.store(false, Ordering::SeqCst);
        result
    })
    .await;
    if joined.is_err() {
        app.state::<InstallerState>()
            .busy
            .store(false, Ordering::SeqCst);
    }
    let result = joined.map_err(|error| {
        crate::i18n::t_args(
            "installer.errors.threadFailed",
            &[("error", &error.to_string())],
        )
    })?;

    result.map_err(|error| {
        let message = format!("{error:#}");
        let state = app.state::<InstallerState>();
        windows::write_log(&state, &format!("erro: {message}"));
        let _ = on_event.send(InstallerEvent::Error {
            message: message.clone(),
            log_path: state.log_path().to_string_lossy().to_string(),
        });
        message
    })
}

#[tauri::command]
pub async fn installer_uninstall(
    app: AppHandle,
    purge_data: bool,
    on_event: Channel<InstallerEvent>,
) -> Result<(), String> {
    {
        let state = app.state::<InstallerState>();
        if state.busy.swap(true, Ordering::SeqCst) {
            return Err(crate::i18n::t("installer.errors.operationInProgress"));
        }
        state.cancel.store(false, Ordering::SeqCst);
    }

    let app_for_task = app.clone();
    let events = on_event.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        let state = app_for_task.state::<InstallerState>();
        let result = windows::uninstall(&state, purge_data, &events);
        state.busy.store(false, Ordering::SeqCst);
        result
    })
    .await;
    if joined.is_err() {
        app.state::<InstallerState>()
            .busy
            .store(false, Ordering::SeqCst);
    }
    let result = joined.map_err(|error| {
        crate::i18n::t_args(
            "installer.errors.threadFailed",
            &[("error", &error.to_string())],
        )
    })?;

    result.map_err(|error| {
        let message = format!("{error:#}");
        let state = app.state::<InstallerState>();
        windows::write_log(&state, &format!("erro: {message}"));
        let _ = on_event.send(InstallerEvent::Error {
            message: message.clone(),
            log_path: state.log_path().to_string_lossy().to_string(),
        });
        message
    })
}

#[tauri::command]
pub fn installer_cancel(state: State<'_, InstallerState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn installer_close_app() -> Result<(), String> {
    windows::close_running_app().map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub fn installer_relaunch_elevated(
    app: AppHandle,
    options: InstallOptions,
) -> Result<(), String> {
    windows::relaunch_elevated(&options).map_err(|error| format!("{error:#}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn installer_finish(app: AppHandle, launch: bool) -> Result<(), String> {
    if launch {
        let install = windows::find_install().ok_or_else(|| {
            crate::i18n::t("installer.errors.notInRegistry")
        })?;
        windows::launch_installed(&install.path).map_err(|error| format!("{error:#}"))?;
    }
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn installer_open_log(app: AppHandle, state: State<'_, InstallerState>) -> Result<(), String> {
    let path = state.log_path();
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| {
            crate::i18n::t_args(
                "installer.errors.openLog",
                &[("error", &error.to_string())],
            )
        })
}

#[tauri::command]
pub fn installer_open_folder(app: AppHandle) -> Result<(), String> {
    let install = windows::find_install()
        .ok_or_else(|| crate::i18n::t("installer.errors.notInRegistry"))?;
    app.opener()
        .open_path(install.path, None::<&str>)
        .map_err(|error| {
            crate::i18n::t_args(
                "installer.errors.openFolder",
                &[("error", &error.to_string())],
            )
        })
}
