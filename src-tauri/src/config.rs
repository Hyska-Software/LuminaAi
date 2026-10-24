//! Application settings + provider API keys.
//!
//! Settings live in `<app-data>/settings.json`; keys live in
//! `<app-data>/secrets.json` (never sent to the renderer in plain text).
//! As a convenience the backend also detects keys from the OpenCode CLI
//! (`~/.local/share/opencode/auth.json`) and from `OPENCODE_API_KEY`.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::domain::{ProviderKeyStatus, Settings};

pub fn data_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!("cannot resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn settings_path(app: &AppHandle) -> PathBuf {
    data_dir(app)
        .map(|d| d.join("settings.json"))
        .unwrap_or_else(|_| PathBuf::from("settings.json"))
}

pub fn secrets_path(app: &AppHandle) -> PathBuf {
    data_dir(app)
        .map(|d| d.join("secrets.json"))
        .unwrap_or_else(|_| PathBuf::from("secrets.json"))
}

pub fn load_settings(app: &AppHandle) -> Settings {
    let path = settings_path(app);
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save_settings(app: &AppHandle, settings: &Settings) -> anyhow::Result<()> {
    let path = settings_path(app);
    let raw = serde_json::to_string_pretty(settings)?;
    std::fs::write(path, raw)?;
    Ok(())
}

/// Reads a key from the secrets file / environment / OpenCode CLI, in that order.
pub fn api_key(app: &AppHandle, provider_id: &str) -> Option<String> {
    let _ = (app, provider_id);
    todo!("implemented by the storage module")
}

pub fn set_api_key(app: &AppHandle, provider_id: &str, key: Option<&str>) -> anyhow::Result<()> {
    let _ = (app, provider_id, key);
    todo!("implemented by the storage module")
}

pub fn key_status(app: &AppHandle, provider_id: &str) -> ProviderKeyStatus {
    let _ = (app, provider_id);
    todo!("implemented by the storage module")
}

pub fn all_key_status(app: &AppHandle, providers: &[String]) -> Vec<ProviderKeyStatus> {
    providers.iter().map(|p| key_status(app, p)).collect()
}
