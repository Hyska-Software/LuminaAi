//! IPC surface of the in-app updater.
//!
//! Checks are cheap and safe to run automatically; downloads and installs are
//! always explicit. Every command validates the requested version against the
//! cached release so the renderer can never ask the backend to fetch an
//! arbitrary URL.

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::domain::now_ms;
use crate::state::AppState;
use crate::update::feed::UpdateNotes;
use crate::update::{
    download, feed, install, DownloadResult, UpdateEvent, UpdateState, UpdateStatus,
};
#[cfg(unix)]
use crate::update::managed::{self, ManagedMode};

/// Manual checks within this window reuse the previous result instead of
/// hammering GitHub. Automatic checks are paced by the renderer.
const MIN_CHECK_INTERVAL_MS: i64 = 15_000;

fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn status(state: &UpdateState) -> UpdateStatus {
    state.status(&current_version())
}

fn to_error(error: anyhow::Error) -> String {
    format!("{error:#}")
}

#[tauri::command]
pub fn update_status(state: State<'_, UpdateState>) -> Result<UpdateStatus, String> {
    Ok(status(&state))
}

#[tauri::command]
pub async fn check_for_update(
    state: State<'_, UpdateState>,
    http: State<'_, AppState>,
    force: bool,
) -> Result<UpdateStatus, String> {
    let current = current_version();
    if !force {
        if let Some(last) = state.preferences().last_check_at {
            if now_ms() - last < MIN_CHECK_INTERVAL_MS {
                return Ok(status(&state));
            }
        }
    }
    if !state.begin_check() {
        return Err(crate::i18n::t("update.errors.checkInProgress"));
    }

    let result = async {
        match feed::latest_release(&http.http).await {
            Ok(Some(candidate)) => {
                let info = feed::update_info_for(&candidate, &current, now_ms());
                state.record_check(&current, info)?;
            }
            Ok(None) => {
                // No release published yet (normal for a new repository).
                state.record_check(&current, None)?;
            }
            Err(error) => return Err(error),
        }
        Ok::<UpdateStatus, anyhow::Error>(status(&state))
    }
    .await;

    state.end_check();
    result.map_err(to_error)
}

#[tauri::command]
pub async fn get_update_notes(
    http: State<'_, AppState>,
    version: String,
) -> Result<UpdateNotes, String> {
    feed::release_notes(&http.http, &version)
        .await
        .map_err(to_error)
}

#[tauri::command]
pub async fn download_update(
    state: State<'_, UpdateState>,
    http: State<'_, AppState>,
    version: String,
    on_event: Channel<UpdateEvent>,
) -> Result<DownloadResult, String> {
    let info = state
        .cached_for(&version)
        .ok_or_else(|| crate::i18n::t("update.errors.updateNotFoundRetry"))?;
    let asset = info
        .asset
        .clone()
        .ok_or_else(|| crate::i18n::t("update.errors.noInstallerForPlatform"))?;
    if !state.begin_download() {
        return Err(crate::i18n::t("update.errors.downloadInProgress"));
    }

    let result = download::run(
        &http.http,
        &state,
        &version,
        &asset,
        &feed::web_base(),
        &on_event,
    )
    .await;
    state.end_download();
    result.map_err(to_error)
}

#[tauri::command]
pub fn cancel_update_download(state: State<'_, UpdateState>) -> Result<(), String> {
    state.request_cancel();
    Ok(())
}

#[tauri::command]
pub fn install_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
    version: String,
) -> Result<(), String> {
    let info = state
        .cached_for(&version)
        .ok_or_else(|| crate::i18n::t("update.errors.updateNotFoundRetry"))?;
    let asset = info
        .asset
        .clone()
        .ok_or_else(|| crate::i18n::t("update.errors.noInstallerForPlatform"))?;
    #[cfg(unix)]
    {
        let state = state.inner();
        let managed_status = state.managed();
        let compatible = (cfg!(target_os = "linux") && asset.kind == "appimage")
            || (cfg!(target_os = "macos") && asset.kind == "dmg");
        if managed_status.mode == ManagedMode::Managed
            && managed_status.supported
            && compatible
        {
            managed::launch(state, &version, &asset, &managed_status).map_err(to_error)?;
            crate::begin_graceful_exit(&app);
            return Ok(());
        }
    }
    // The Windows setup wizard closes the running app with WM_CLOSE; with
    // close-to-tray that close must quit instead of hiding.
    #[cfg(windows)]
    if asset.kind == "setup" {
        app.state::<AppState>().allow_exit_on_close();
    }
    let result = install::install(&app, &state, &version, &asset);
    if let Err(error) = result {
        app.state::<AppState>().take_exit_on_close();
        return Err(to_error(error));
    }
    // On Windows the setup wizard is now running. Close this app immediately
    // so the installer can replace the executable without the user having to
    // close it manually; the wizard also sends WM_CLOSE, but this makes the
    // click itself the single trigger.
    #[cfg(windows)]
    if asset.kind == "setup" {
        crate::begin_graceful_exit(&app);
    }
    Ok(())
}

#[tauri::command]
pub fn reveal_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
    version: String,
) -> Result<(), String> {
    let info = state
        .cached_for(&version)
        .ok_or_else(|| crate::i18n::t("update.errors.updateNotFound"))?;
    let Some(asset) = info.asset else {
        return Err(crate::i18n::t("update.errors.noDownloadedFile"));
    };
    install::reveal(&app, &state, &version, &asset).map_err(to_error)
}

#[tauri::command]
pub fn set_update_preferences(
    state: State<'_, UpdateState>,
    auto_check: bool,
) -> Result<UpdateStatus, String> {
    state.set_auto_check(auto_check).map_err(to_error)?;
    Ok(status(&state))
}

#[tauri::command]
pub fn skip_update_version(
    state: State<'_, UpdateState>,
    version: Option<String>,
) -> Result<UpdateStatus, String> {
    state.set_skipped(version).map_err(to_error)?;
    Ok(status(&state))
}

#[tauri::command]
pub fn mark_update_notified(state: State<'_, UpdateState>, version: String) -> Result<(), String> {
    state.mark_notified(&version).map_err(to_error)
}

#[tauri::command]
pub fn acknowledge_update_result(state: State<'_, UpdateState>) -> Result<(), String> {
    state.acknowledge_install_result().map_err(to_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_version_is_not_empty() {
        assert!(!current_version().trim().is_empty());
    }
}
