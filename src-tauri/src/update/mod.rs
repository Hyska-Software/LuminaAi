//! In-app update system: GitHub release feed, verified download and install.
//!
//! The check is cheap (one small `release.json` request), the download is
//! explicit and streams progress, and installing reuses the existing Lumina
//! setup wizard on Windows. Nothing is installed silently.

pub mod download;
pub mod feed;
pub mod install;
pub mod store;
pub mod version;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::domain::now_ms;

/// Selected release artifact for the current platform.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAsset {
    pub name: String,
    pub size: u64,
    pub sha256: String,
    pub download_url: String,
    /// Human label shown in the popover ("Windows x64", "macOS (universal)"…).
    pub platform_label: String,
    /// `setup` | `dmg` | `appimage` | `deb` | `rpm`.
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub available: bool,
    pub release_name: String,
    #[serde(default)]
    pub released_at: Option<String>,
    pub html_url: String,
    /// `None` when the release has no artifact for this platform; the UI then
    /// offers the GitHub page instead of a download.
    #[serde(default)]
    pub asset: Option<UpdateAsset>,
    pub checked_at: i64,
    /// True when the user is seeing a cached result after a failed refresh.
    #[serde(default)]
    pub stale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedUpdate {
    pub version: String,
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdatePreferences {
    /// Check on launch and once per day.
    pub auto_check: bool,
    pub last_check_at: Option<i64>,
    /// Version the user chose to ignore. A newer version is shown again.
    pub skipped_version: Option<String>,
    /// Last version that produced a toast (shown once per version).
    pub notified_version: Option<String>,
}

impl Default for UpdatePreferences {
    fn default() -> Self {
        Self {
            auto_check: true,
            last_check_at: None,
            skipped_version: None,
            notified_version: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current_version: String,
    pub preferences: UpdatePreferences,
    pub info: Option<UpdateInfo>,
    pub download: Option<DownloadedUpdate>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub cancelled: bool,
    pub download: Option<DownloadedUpdate>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UpdateEvent {
    Started {
        name: String,
        total: u64,
    },
    Progress {
        received: u64,
        total: u64,
        percent: f32,
        bytes_per_sec: u64,
    },
    Verifying,
    Done {
        download: DownloadedUpdate,
    },
    Cancelled,
}

/// Runtime state managed by Tauri.
pub struct UpdateState {
    data_dir: PathBuf,
    file: Mutex<store::UpdateFile>,
    checking: AtomicBool,
    downloading: AtomicBool,
    cancel: AtomicBool,
}

impl UpdateState {
    pub fn new(data_dir: PathBuf) -> Self {
        let path = store::path_in(&data_dir);
        let mut file = store::load_at(&path);
        // After an update the cache refers to the version that is now running:
        // drop it so the chip/download folder do not linger until the next
        // successful check.
        if file
            .cached
            .as_ref()
            .is_some_and(|info| !version::is_newer(&info.latest_version, env!("CARGO_PKG_VERSION")))
        {
            file.cached = None;
            let _ = store::save_at(&path, &file);
        }
        let state = Self {
            data_dir,
            file: Mutex::new(file),
            checking: AtomicBool::new(false),
            downloading: AtomicBool::new(false),
            cancel: AtomicBool::new(false),
        };
        state.cleanup_downloads();
        state
    }

    pub fn preferences(&self) -> UpdatePreferences {
        self.file.lock().preferences.clone()
    }

    pub fn status(&self, current_version: &str) -> UpdateStatus {
        let file = self.file.lock();
        let skipped = file.preferences.skipped_version.as_deref();
        let info = file
            .cached
            .clone()
            .filter(|info| version::is_newer(&info.latest_version, current_version))
            .filter(|info| skipped != Some(info.latest_version.as_str()))
            .map(|mut info| {
                info.current_version = current_version.to_string();
                info.available = true;
                info.stale = false;
                info
            });
        let download = info
            .as_ref()
            .and_then(|info| info.asset.as_ref().map(|asset| (info, asset)))
            .and_then(|(info, asset)| self.downloaded_inner(&info.latest_version, asset));
        UpdateStatus {
            current_version: current_version.to_string(),
            preferences: file.preferences.clone(),
            info,
            download,
        }
    }

    /// Stores the result of a successful check and updates `lastCheckAt`.
    pub fn record_check(
        &self,
        current_version: &str,
        info: Option<UpdateInfo>,
    ) -> anyhow::Result<()> {
        let info = info.filter(|info| version::is_newer(&info.latest_version, current_version));
        {
            let mut file = self.file.lock();
            file.preferences.last_check_at = Some(now_ms());
            file.cached = info;
            file.schema_version = file.schema_version.max(1);
            store::save_at(&store::path_in(&self.data_dir), &file)?;
        }
        self.cleanup_downloads();
        Ok(())
    }

    pub fn set_auto_check(&self, value: bool) -> anyhow::Result<()> {
        let mut file = self.file.lock();
        file.preferences.auto_check = value;
        store::save_at(&store::path_in(&self.data_dir), &file)
    }

    pub fn set_skipped(&self, version: Option<String>) -> anyhow::Result<()> {
        let mut file = self.file.lock();
        file.preferences.skipped_version = version
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        store::save_at(&store::path_in(&self.data_dir), &file)
    }

    pub fn mark_notified(&self, version: &str) -> anyhow::Result<()> {
        let mut file = self.file.lock();
        file.preferences.notified_version = Some(version.trim().to_string());
        store::save_at(&store::path_in(&self.data_dir), &file)
    }

    pub fn cached_for(&self, version: &str) -> Option<UpdateInfo> {
        self.file
            .lock()
            .cached
            .clone()
            .filter(|info| info.available && info.latest_version == version)
    }

    pub fn begin_check(&self) -> bool {
        !self.checking.swap(true, Ordering::SeqCst)
    }

    pub fn end_check(&self) {
        self.checking.store(false, Ordering::SeqCst);
    }

    pub fn begin_download(&self) -> bool {
        if self.downloading.swap(true, Ordering::SeqCst) {
            return false;
        }
        self.cancel.store(false, Ordering::SeqCst);
        true
    }

    pub fn end_download(&self) {
        self.downloading.store(false, Ordering::SeqCst);
    }

    pub fn request_cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    pub fn cancel_requested(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    pub fn updates_root(&self) -> PathBuf {
        self.data_dir.join("updates")
    }

    /// Resolves the final path for a verified download, rejecting path
    /// traversal in both the version and the asset name.
    pub fn download_path(&self, version: &str, asset_name: &str) -> Option<PathBuf> {
        if !safe_component(version) || !safe_component(asset_name) {
            return None;
        }
        Some(self.updates_root().join(version).join(asset_name))
    }

    #[cfg(test)]
    pub fn downloaded(&self, version: &str) -> Option<DownloadedUpdate> {
        let info = self.cached_for(version)?;
        let asset = info.asset.as_ref()?;
        self.downloaded_inner(version, asset)
    }

    fn downloaded_inner(&self, version: &str, asset: &UpdateAsset) -> Option<DownloadedUpdate> {
        let path = self.download_path(version, &asset.name)?;
        let metadata = std::fs::metadata(&path).ok()?;
        if !metadata.is_file() || metadata.len() != asset.size {
            return None;
        }
        Some(DownloadedUpdate {
            version: version.to_string(),
            path: path.to_string_lossy().to_string(),
            size: metadata.len(),
            sha256: asset.sha256.clone(),
        })
    }

    /// Keeps only the pending version and removes partial downloads. Runs on
    /// startup and after every successful check.
    fn cleanup_downloads(&self) {
        if self.downloading.load(Ordering::SeqCst) {
            // Never delete the `.partial` of a download that is still running.
            return;
        }
        let keep = self
            .file
            .lock()
            .cached
            .as_ref()
            .map(|info| info.latest_version.clone());
        let root = self.updates_root();
        let Ok(entries) = std::fs::read_dir(&root) else {
            return;
        };
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if !path.is_dir() {
                let _ = std::fs::remove_file(&path);
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if keep.as_deref() != Some(name.as_str()) {
                let _ = std::fs::remove_dir_all(&path);
                continue;
            }
            if let Ok(files) = std::fs::read_dir(&path) {
                for file in files.filter_map(Result::ok) {
                    if file
                        .file_name()
                        .to_string_lossy()
                        .to_ascii_lowercase()
                        .ends_with(".partial")
                    {
                        let _ = std::fs::remove_file(file.path());
                    }
                }
            }
        }
    }
}

/// Only ASCII letters, digits, `.`, `-`, `_` and `+`, without `..`. Release
/// versions and asset names never need anything else.
pub fn safe_component(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 160
        && !trimmed.contains("..")
        && !trimmed.contains('/')
        && !trimmed.contains('\\')
        && trimmed.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_' | '+')
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(version: &str) -> UpdateInfo {
        UpdateInfo {
            current_version: "0.1.0".into(),
            latest_version: version.into(),
            available: true,
            release_name: format!("Lumina v{version}"),
            released_at: None,
            html_url: "https://github.com/Hyska-Software/LuminaAi/releases".into(),
            asset: Some(UpdateAsset {
                name: "Lumina-Setup-0.2.0-windows-x64.exe".into(),
                size: 3,
                sha256: "a".repeat(64),
                download_url: "https://github.com/Hyska-Software/LuminaAi/releases/download/v0.2.0/Lumina-Setup-0.2.0-windows-x64.exe".into(),
                platform_label: "Windows x64".into(),
                kind: "setup".into(),
            }),
            checked_at: 1,
            stale: false,
        }
    }

    fn state(dir: &tempfile::TempDir) -> UpdateState {
        UpdateState::new(dir.path().to_path_buf())
    }

    #[test]
    fn status_exposes_only_a_newer_cached_version() {
        let dir = tempfile::tempdir().expect("tempdir");
        let state = state(&dir);
        state
            .record_check("0.1.0", Some(info("0.2.0")))
            .expect("gravar");
        let status = state.status("0.1.0");
        assert_eq!(
            status
                .info
                .as_ref()
                .map(|info| info.latest_version.as_str()),
            Some("0.2.0")
        );
        assert!(state.status("0.2.0").info.is_none());
        assert!(state.status("0.3.0").info.is_none());
    }

    #[test]
    fn skipped_version_is_hidden_until_cleared() {
        let dir = tempfile::tempdir().expect("tempdir");
        let state = state(&dir);
        state
            .record_check("0.1.0", Some(info("0.2.0")))
            .expect("gravar");
        state.set_skipped(Some("0.2.0".into())).expect("ignorar");
        assert!(state.status("0.1.0").info.is_none());
        state.set_skipped(None).expect("mostrar");
        assert!(state.status("0.1.0").info.is_some());
    }

    #[test]
    fn a_newer_version_supersedes_the_skipped_one() {
        let dir = tempfile::tempdir().expect("tempdir");
        let state = state(&dir);
        state.set_skipped(Some("0.2.0".into())).expect("ignorar");
        state
            .record_check("0.1.0", Some(info("0.3.0")))
            .expect("gravar");
        let status = state.status("0.1.0");
        assert_eq!(
            status
                .info
                .as_ref()
                .map(|info| info.latest_version.as_str()),
            Some("0.3.0")
        );
    }

    #[test]
    fn detects_a_complete_download_and_ignores_a_different_size() {
        let dir = tempfile::tempdir().expect("tempdir");
        let state = state(&dir);
        state
            .record_check("0.1.0", Some(info("0.2.0")))
            .expect("gravar");
        let path = state
            .download_path("0.2.0", "Lumina-Setup-0.2.0-windows-x64.exe")
            .expect("caminho");
        std::fs::create_dir_all(path.parent().expect("pai")).expect("pasta");
        std::fs::write(&path, b"abc").expect("gravar");
        assert!(state.downloaded("0.2.0").is_some());
        std::fs::write(&path, b"abcd").expect("gravar");
        assert!(state.downloaded("0.2.0").is_none());
    }

    #[test]
    fn cleanup_keeps_only_the_pending_version() {
        let dir = tempfile::tempdir().expect("tempdir");
        let state = state(&dir);
        state
            .record_check("0.1.0", Some(info("0.2.0")))
            .expect("gravar");
        let old = state.updates_root().join("0.1.0");
        std::fs::create_dir_all(&old).expect("pasta antiga");
        let pending = state
            .download_path("0.2.0", "Lumina-Setup-0.2.0-windows-x64.exe")
            .expect("caminho");
        std::fs::create_dir_all(pending.parent().expect("pai")).expect("pasta");
        std::fs::write(pending.with_extension("exe.partial"), b"parcial").expect("parcial");
        let _ = UpdateState::new(dir.path().to_path_buf());
        assert!(!old.exists());
        assert!(!pending.with_extension("exe.partial").exists());
    }

    #[test]
    fn rejects_unsafe_path_components() {
        let dir = tempfile::tempdir().expect("tempdir");
        let state = state(&dir);
        assert!(state.download_path("../0.2.0", "x.exe").is_none());
        assert!(state.download_path("0.2.0", "../x.exe").is_none());
        assert!(state.download_path("0.2.0", "x/y.exe").is_none());
        assert!(state
            .download_path("0.2.0-beta.1", "Lumina-Setup-0.2.0.exe")
            .is_some());
    }

    #[test]
    fn busy_guards_allow_one_operation_at_a_time() {
        let dir = tempfile::tempdir().expect("tempdir");
        let state = state(&dir);
        assert!(state.begin_check());
        assert!(!state.begin_check());
        state.end_check();
        assert!(state.begin_check());
        state.end_check();

        assert!(state.begin_download());
        assert!(!state.begin_download());
        state.request_cancel();
        assert!(state.cancel_requested());
        state.end_download();
        assert!(state.begin_download());
        assert!(!state.cancel_requested());
    }
}
