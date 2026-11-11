//! System tray: keeps the app alive when the main window closes and offers a
//! way back to the window (or to quit) while it runs in the background.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::domain::Settings;

const TRAY_ID: &str = "main-tray";
const MENU_SHOW: &str = "tray-show";
const MENU_QUIT: &str = "tray-quit";

/// Must match `identifier` in `tauri.conf.json` (asserted by a unit test): the
/// activation marker must be found before the Tauri app (and its path resolver)
/// exists.
const APP_IDENTIFIER: &str = "app.zylara.chat";
/// Rewritten by every launch that finds the app already running.
const ACTIVATION_FILE: &str = "activation-request";
/// Reading a 40-byte file twice a second costs nothing next to the existing
/// schedulers and keeps the restored window within a blink.
const ACTIVATION_POLL: std::time::Duration = std::time::Duration::from_millis(500);

fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let show = MenuItem::with_id(
        app,
        MENU_SHOW,
        crate::i18n::t("tray.show"),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(
        app,
        MENU_QUIT,
        crate::i18n::t("tray.quit"),
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    Menu::with_items(app, &[&show, &separator, &quit])
}

/// Creates the tray icon. Failure is logged by the caller: the app must still
/// boot on systems without a notification area.
pub fn init(app: &AppHandle, settings: &Settings) -> tauri::Result<()> {
    let tray_menu = menu(app)?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Zylara")
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_SHOW => show_main_window(app),
            MENU_QUIT => crate::begin_graceful_exit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            let activate = matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            );
            if activate {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    let tray = builder.build(app)?;
    tray.set_visible(settings.close_to_tray)?;
    Ok(())
}

/// Rebuilds the menu (the language can change with settings) and mirrors the
/// visibility of the tray icon to the saved preference.
pub fn sync(app: &AppHandle, settings: &Settings) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    if let Ok(tray_menu) = menu(app) {
        if let Err(error) = tray.set_menu(Some(tray_menu)) {
            eprintln!("zylara: failed to update the tray menu: {error}");
        }
    }
    if let Err(error) = tray.set_visible(settings.close_to_tray) {
        eprintln!("zylara: failed to update the tray visibility: {error}");
    }
}

pub fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("zylara: main window is gone; cannot show it");
        return;
    };
    if let Err(error) = window.show() {
        eprintln!("zylara: failed to show the main window: {error}");
    }
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// Whether the tray icon this app created still exists.
pub fn is_available(app: &AppHandle) -> bool {
    app.tray_by_id(TRAY_ID).is_some()
}

/// True when another process already owns the app. Outside Windows the
/// single-instance plugin keeps covering this.
#[cfg(windows)]
pub fn another_instance_running() -> bool {
    activation::another_instance_running()
}

#[cfg(not(windows))]
pub fn another_instance_running() -> bool {
    false
}

/// Asks the running instance to show its window. `false` when the request
/// could not be written.
#[cfg(windows)]
pub fn request_activation() -> bool {
    activation::request_activation()
}

#[cfg(not(windows))]
pub fn request_activation() -> bool {
    false
}

/// Shows the main window whenever a launch rewrites the activation marker.
#[cfg(windows)]
pub fn watch_activation(app: AppHandle) {
    activation::watch_activation(app);
}

#[cfg(not(windows))]
pub fn watch_activation(_app: AppHandle) {}

#[cfg(windows)]
mod activation {
    use std::path::{Path, PathBuf};
    use std::sync::OnceLock;
    use std::time::{SystemTime, UNIX_EPOCH};

    use tauri::AppHandle;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{
        GetLastError, SetLastError, ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS, ERROR_SUCCESS,
    };
    use windows::Win32::System::Threading::CreateMutexW;

    use super::{show_main_window, ACTIVATION_FILE, ACTIVATION_POLL, APP_IDENTIFIER};

    /// Kept for the process lifetime: dropping the handle would release the
    /// claim.
    static APP_LOCK: OnceLock<isize> = OnceLock::new();

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// True when another process already owns the app. Windows also reports
    /// access denied when the other process runs at a higher integrity level,
    /// which must count as "already running".
    pub(super) fn another_instance_running() -> bool {
        claim_lock(&format!("{APP_IDENTIFIER}-app-lock"))
    }

    /// Claims a named mutex for the process lifetime.
    pub(super) fn claim_lock(name: &str) -> bool {
        let name = wide(name);
        unsafe { SetLastError(ERROR_SUCCESS) };
        let result = unsafe { CreateMutexW(None, false, PCWSTR(name.as_ptr())) };
        let error = unsafe { GetLastError() };
        match result {
            Ok(_) if error == ERROR_ALREADY_EXISTS => true,
            Ok(handle) => {
                let _ = APP_LOCK.set(handle.0 as isize);
                false
            }
            Err(_) if error == ERROR_ACCESS_DENIED => true,
            Err(failure) => {
                eprintln!("zylara: failed to claim the app lock: {failure}");
                false
            }
        }
    }

    fn marker_path() -> Option<PathBuf> {
        let appdata = std::env::var_os("APPDATA")?;
        Some(
            PathBuf::from(appdata)
                .join(APP_IDENTIFIER)
                .join(ACTIVATION_FILE),
        )
    }

    /// Writes the activation request. `false` when the running instance cannot
    /// be asked to show itself.
    pub(super) fn request_activation() -> bool {
        let Some(path) = marker_path() else {
            eprintln!("zylara: APPDATA is not set; cannot signal the running instance");
            return false;
        };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        match std::fs::write(&path, format!("{}-{stamp}", std::process::id())) {
            Ok(()) => true,
            Err(error) => {
                eprintln!("zylara: failed to signal the running instance: {error}");
                false
            }
        }
    }

    /// Shows the main window whenever a launch rewrites the marker. The
    /// baseline is read at start, so booting never counts as a request.
    pub(super) fn watch_activation(app: AppHandle) {
        let Ok(dir) = crate::config::data_dir(&app) else {
            eprintln!("zylara: cannot resolve the app data dir; activations are disabled");
            return;
        };
        let path = dir.join(ACTIVATION_FILE);
        let spawned = std::thread::Builder::new()
            .name("zylara-activation".into())
            .spawn(move || {
                let mut last = read_marker(&path);
                loop {
                    std::thread::sleep(ACTIVATION_POLL);
                    let current = read_marker(&path);
                    if current != last {
                        last = current;
                        show_main_window(&app);
                    }
                }
            });
        if let Err(error) = spawned {
            eprintln!("zylara: failed to start the activation watcher: {error}");
        }
    }

    fn read_marker(path: &Path) -> Option<String> {
        std::fs::read_to_string(path).ok()
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn app_identifier_matches_tauri_config() {
        let raw = include_str!("../tauri.conf.json");
        let config: serde_json::Value = serde_json::from_str(raw).expect("parse tauri.conf.json");
        assert_eq!(config["identifier"].as_str(), Some(super::APP_IDENTIFIER));
    }

    /// The guard must report the second claim as "already running", otherwise a
    /// second launch would boot a duplicate app instead of waking the window.
    #[cfg(windows)]
    #[test]
    fn second_lock_claim_reports_running_instance() {
        let name = format!(
            "{}-lock-test-{}",
            super::APP_IDENTIFIER,
            std::process::id()
        );
        assert!(!super::activation::claim_lock(&name));
        assert!(super::activation::claim_lock(&name));
    }
}
