//! System tray: keeps the app alive when the main window closes and offers a
//! way back to the window (or to quit) while it runs in the background.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::domain::Settings;

const TRAY_ID: &str = "main-tray";
const MENU_SHOW: &str = "tray-show";
const MENU_QUIT: &str = "tray-quit";

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
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}
