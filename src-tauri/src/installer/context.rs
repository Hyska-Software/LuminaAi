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

    let required_bytes = windows::payload_size().saturating_add(8 * 1024 * 1024);

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
        log_path: state.log_path().to_string_lossy().to_string(),
        data_paths: windows::data_paths(),
        can_elevate: true,
        pending_options: super::requested_options(),
    })
}
