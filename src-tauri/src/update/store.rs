//! Persistence of update preferences and the last successful check.
//!
//! `updates.json` lives in the app-data directory next to `settings.json`. It is
//! not user data and not a secret: a corrupt file is discarded and rebuilt with
//! defaults instead of blocking the app.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use super::{UpdateInfo, UpdatePreferences};

pub const FILE_NAME: &str = "updates.json";
const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateFile {
    pub schema_version: u32,
    pub preferences: UpdatePreferences,
    /// Last successful check that found a newer version. Notes are not cached
    /// (they are loaded on demand); the asset metadata is needed to resume a
    /// download after a restart.
    pub cached: Option<UpdateInfo>,
}

impl Default for UpdateFile {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            preferences: UpdatePreferences::default(),
            cached: None,
        }
    }
}

pub fn path_in(data_dir: &Path) -> PathBuf {
    data_dir.join(FILE_NAME)
}

/// Reads and normalizes the file. Missing, corrupt or partial files fall back
/// to defaults so an update never blocks startup.
pub fn load_at(path: &Path) -> UpdateFile {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return UpdateFile::default(),
    };
    let mut file: UpdateFile = match serde_json::from_str(&raw) {
        Ok(file) => file,
        Err(error) => {
            eprintln!("[update] updates.json corrompido, usando padrões: {error}");
            return UpdateFile::default();
        }
    };
    normalize(&mut file);
    file
}

fn normalize(file: &mut UpdateFile) {
    file.schema_version = file.schema_version.max(1);
    file.preferences.skipped_version = clean(file.preferences.skipped_version.take());
    file.preferences.notified_version = clean(file.preferences.notified_version.take());
    file.cached = file
        .cached
        .take()
        .filter(|info| info.available && !info.latest_version.trim().is_empty());
}

fn clean(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Writes atomically (temp file + rename) so a crash never leaves a truncated
/// preferences file.
pub fn save_at(path: &Path, file: &UpdateFile) -> Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("falha ao criar {}", parent.display()))?;
        }
    }
    let raw = serde_json::to_string_pretty(file).context("serializar updates.json")?;
    let tmp = path.with_file_name(format!(
        "{}.{}.tmp",
        path.file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| FILE_NAME.to_string()),
        uuid::Uuid::new_v4()
    ));
    std::fs::write(&tmp, format!("{raw}\n"))
        .with_context(|| format!("falha ao gravar {}", tmp.display()))?;
    if let Err(error) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(error).with_context(|| format!("falha ao mover para {}", path.display()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::update::{UpdateAsset, UpdateInfo};

    fn data_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("tempdir")
    }

    fn info(version: &str) -> UpdateInfo {
        UpdateInfo {
            current_version: "0.1.0".into(),
            latest_version: version.into(),
            available: true,
            release_name: format!("Lumina v{version}"),
            released_at: None,
            html_url: "https://github.com/Hyska-Software/LuminaAi/releases/tag/v0.2.0".into(),
            asset: Some(UpdateAsset {
                name: "Lumina-Setup-0.2.0-windows-x64.exe".into(),
                size: 10,
                sha256: "a".repeat(64),
                download_url: "https://github.com/Hyska-Software/LuminaAi/releases/download/v0.2.0/Lumina-Setup-0.2.0-windows-x64.exe".into(),
                platform_label: "Windows x64".into(),
                kind: "setup".into(),
            }),
            checked_at: 123,
            stale: false,
        }
    }

    #[test]
    fn missing_file_uses_defaults_with_auto_check_on() {
        let dir = data_dir();
        let file = load_at(&path_in(dir.path()));
        assert!(file.preferences.auto_check);
        assert!(file.preferences.last_check_at.is_none());
        assert!(file.preferences.skipped_version.is_none());
        assert!(file.cached.is_none());
    }

    #[test]
    fn roundtrips_preferences_and_cached_release() {
        let dir = data_dir();
        let path = path_in(dir.path());
        let mut file = UpdateFile::default();
        file.preferences.auto_check = false;
        file.preferences.last_check_at = Some(42);
        file.preferences.skipped_version = Some("0.2.0".into());
        file.preferences.notified_version = Some("0.2.0".into());
        file.cached = Some(info("0.2.0"));
        save_at(&path, &file).expect("gravar");

        let loaded = load_at(&path);
        assert!(!loaded.preferences.auto_check);
        assert_eq!(loaded.preferences.last_check_at, Some(42));
        assert_eq!(loaded.preferences.skipped_version.as_deref(), Some("0.2.0"));
        assert_eq!(
            loaded.preferences.notified_version.as_deref(),
            Some("0.2.0")
        );
        let cached = loaded.cached.expect("cache");
        assert_eq!(cached.latest_version, "0.2.0");
        assert!(cached.asset.is_some());
    }

    #[test]
    fn corrupt_file_falls_back_to_defaults() {
        let dir = data_dir();
        let path = path_in(dir.path());
        std::fs::write(&path, "{ not json").expect("gravar corrompido");
        let file = load_at(&path);
        assert!(file.preferences.auto_check);
        assert!(file.cached.is_none());
    }

    #[test]
    fn partial_and_legacy_files_use_defaults_for_missing_fields() {
        let dir = data_dir();
        let path = path_in(dir.path());
        std::fs::write(
            &path,
            r#"{"schemaVersion":1,"preferences":{"autoCheck":false}}"#,
        )
        .expect("gravar parcial");
        let file = load_at(&path);
        assert!(!file.preferences.auto_check);
        assert!(file.preferences.last_check_at.is_none());
        assert!(file.preferences.skipped_version.is_none());

        std::fs::write(&path, r#"{"schemaVersion":1}"#).expect("gravar legado");
        assert!(load_at(&path).preferences.auto_check);
    }

    #[test]
    fn trims_blank_skip_and_notified_values() {
        let dir = data_dir();
        let path = path_in(dir.path());
        std::fs::write(
            &path,
            r#"{"schemaVersion":1,"preferences":{"skippedVersion":"   ","notifiedVersion":" 0.2.0 "}}"#,
        )
        .expect("gravar");
        let file = load_at(&path);
        assert!(file.preferences.skipped_version.is_none());
        assert_eq!(file.preferences.notified_version.as_deref(), Some("0.2.0"));
    }

    #[test]
    fn drops_unavailable_cache_entries() {
        let dir = data_dir();
        let path = path_in(dir.path());
        let mut file = UpdateFile::default();
        let mut cached = info("0.2.0");
        cached.available = false;
        file.cached = Some(cached);
        save_at(&path, &file).expect("gravar");
        assert!(load_at(&path).cached.is_none());
    }

    #[test]
    fn writes_no_temporary_files_behind() {
        let dir = data_dir();
        let path = path_in(dir.path());
        save_at(&path, &UpdateFile::default()).expect("gravar");
        let leftovers = std::fs::read_dir(dir.path())
            .expect("listar")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(leftovers, 0);
    }
}
