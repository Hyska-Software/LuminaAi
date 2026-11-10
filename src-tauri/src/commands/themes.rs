//! Theme package commands (list, install, remove, assets and folder).

use std::path::Path;

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::config;
use crate::domain::{ThemeInfo, ThemeInstallResult};

fn to_error(error: impl std::fmt::Display) -> String {
    format!("{error:#}")
}

/// Lists the built-in theme plus every installed theme.
#[tauri::command]
pub fn list_themes(app: AppHandle) -> Result<Vec<ThemeInfo>, String> {
    let data_dir = config::data_dir(&app).map_err(to_error)?;
    Ok(crate::themes::list_themes(&data_dir))
}

/// Installs or atomically replaces a theme from a ZIP package.
#[tauri::command]
pub async fn install_theme(app: AppHandle, path: String) -> Result<ThemeInstallResult, String> {
    let data_dir = config::data_dir(&app).map_err(to_error)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::themes::install_theme(&data_dir, Path::new(&path))
    })
    .await
    .map_err(|error| {
        crate::i18n::t_args(
            "themes.errors.installFailed",
            &[("error", &error.to_string())],
        )
    })?
}

/// Removes an installed theme and returns the remaining list.
#[tauri::command]
pub fn uninstall_theme(app: AppHandle, theme_id: String) -> Result<Vec<ThemeInfo>, String> {
    let data_dir = config::data_dir(&app).map_err(to_error)?;
    crate::themes::uninstall_theme(&data_dir, &theme_id)
}

/// Returns a theme asset as a bounded `data:` URL.
#[tauri::command]
pub async fn get_theme_asset(
    app: AppHandle,
    theme_id: String,
    asset: String,
) -> Result<String, String> {
    let data_dir = config::data_dir(&app).map_err(to_error)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::themes::theme_asset(&data_dir, &theme_id, &asset)
    })
    .await
    .map_err(|error| {
        crate::i18n::t_args(
            "themes.errors.assetReadFailed",
            &[("error", &error.to_string())],
        )
    })?
}

/// Opens `<app-data>/themes` in the OS file manager.
#[tauri::command]
pub fn open_themes_dir(app: AppHandle) -> Result<(), String> {
    let data_dir = config::data_dir(&app).map_err(to_error)?;
    let dir = data_dir.join("themes");
    std::fs::create_dir_all(&dir).map_err(|error| {
        crate::i18n::t_args(
            "themes.errors.createThemesDir",
            &[("error", &error.to_string())],
        )
    })?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| {
            crate::i18n::t_args(
                "themes.errors.openThemesDir",
                &[("error", &error.to_string())],
            )
        })
}
