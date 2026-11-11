use std::path::Path;

use super::windows;
use super::{InstallScope, InstallerContext, InstallerState};
use anyhow::Result;

pub fn build(state: &InstallerState) -> Result<InstallerContext> {
    let user = windows::find_install_scope(InstallScope::User);
    let machine = windows::find_install_scope(InstallScope::Machine);
    let (existing, conflicting) = match (user, machine) {
        (Some(user), Some(machine)) => (Some(user), Some(machine)),
        (Some(user), None) => (Some(user), None),
        (None, Some(machine)) => (Some(machine), None),
        (None, None) => (None, None),
    };

    let default_path_user = windows::default_install_path(InstallScope::User);
    let default_path_machine = windows::default_install_path(InstallScope::Machine);
    let probe = existing
        .as_ref()
        .map(|install| install.path.clone())
        .unwrap_or_else(|| default_path_user.clone());

    let required_bytes = windows::installed_size(windows::payload_size())
        .saturating_add(8 * 1024 * 1024);

    Ok(InstallerContext {
        mode: state.mode(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        arch: std::env::consts::ARCH.to_string(),
        is_admin: windows::is_admin(),
        default_path_user,
        default_path_machine,
        existing,
        conflicting,
        app_running: windows::app_running(),
        webview2_installed: windows::webview2_version().is_some(),
        free_bytes: windows::free_bytes(Path::new(&probe)),
        required_bytes,
        installed_bytes: installed_bytes_for(&probe, required_bytes),
        log_path: state.log_path().to_string_lossy().to_string(),
        data_paths: windows::data_paths(),
        can_elevate: true,
        pending_options: super::requested_options(),
    })
}

/// Size of what is actually on disk. A registry entry without a folder (stale
/// install) falls back to the payload estimate so the UI never shows zero.
fn installed_bytes_for(install_path: &str, fallback: u64) -> u64 {
    folder_size(Path::new(install_path)).unwrap_or(fallback)
}

fn folder_size(path: &Path) -> Option<u64> {
    let entries = std::fs::read_dir(path).ok()?;
    let mut total = 0u64;
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_file() {
            total = total.saturating_add(meta.len());
        }
    }
    Some(total)
}
