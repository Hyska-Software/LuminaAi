//! Launches the verified installer for the current platform.
//!
//! Windows reuses the branded Zylara setup wizard (it detects the existing
//! install, skips scope/location and preserves user data). macOS/Linux open the
//! DMG/package or reveal the AppImage; replacing a running bundle is out of
//! scope for v1.

use std::path::Path;

use anyhow::{bail, Context, Result};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use super::download;
use super::{UpdateAsset, UpdateState};

/// Re-hashes the file immediately before execution and refuses anything that
/// was modified, truncated or tampered with after the download.
pub fn verify_download(path: &Path, asset: &UpdateAsset) -> Result<()> {
    let metadata = std::fs::metadata(path)
        .with_context(|| {
            crate::i18n::t_args(
                "update.errors.downloadNotFoundAt",
                &[("path", &path.display().to_string())],
            )
        })?;
    if !metadata.is_file() {
        bail!(crate::i18n::t("update.errors.downloadNotFile"));
    }
    if metadata.len() != asset.size {
        bail!(
            "download incompleto: {} de {} bytes",
            metadata.len(),
            asset.size
        );
    }
    let digest = download::sha256_file(path)?;
    if !digest.eq_ignore_ascii_case(&asset.sha256) {
        bail!(crate::i18n::t("update.errors.hashMismatch"));
    }
    Ok(())
}

pub fn install(
    app: &AppHandle,
    state: &UpdateState,
    version: &str,
    asset: &UpdateAsset,
) -> Result<()> {
    let path = state
        .download_path(version, &asset.name)
        .context(crate::i18n::t("update.errors.invalidArtifactName"))?;
    verify_download(&path, asset)?;

    match asset.kind.as_str() {
        "setup" => {
            #[cfg(windows)]
            {
                launch_setup(&path)?;
                Ok(())
            }
            #[cfg(not(windows))]
            {
                bail!(crate::i18n::t("update.errors.windowsOnly"));
            }
        }
        "dmg" | "deb" | "rpm" => app
            .opener()
            .open_path(path.to_string_lossy().to_string(), None::<&str>)
            .map_err(|error| anyhow::anyhow!("falha ao abrir o instalador: {error}")),
        "appimage" => app
            .opener()
            .reveal_item_in_dir(&path)
            .map_err(|error| anyhow::anyhow!(crate::i18n::t_args(
                "update.errors.openUpdateFolder",
                &[("error", &error.to_string())],
            ))),
        other => bail!(crate::i18n::t_args(
            "update.errors.unknownKind",
            &[("kind", other)],
        )),
    }
}

#[cfg(windows)]
fn launch_setup(path: &Path) -> Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    std::process::Command::new(path)
        .current_dir(parent)
        .spawn()
        .with_context(|| format!("falha ao abrir o instalador {}", path.display()))?;
    Ok(())
}

pub fn reveal(
    app: &AppHandle,
    state: &UpdateState,
    version: &str,
    asset: &UpdateAsset,
) -> Result<()> {
    if let Some(path) = state.download_path(version, &asset.name) {
        if path.exists() {
            return app
                .opener()
                .reveal_item_in_dir(&path)
                .map_err(|error| anyhow::anyhow!("falha ao abrir a pasta: {error}"));
        }
    }
    let dir = state.updates_root().join(version);
    std::fs::create_dir_all(&dir).with_context(|| format!("falha ao criar {}", dir.display()))?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| anyhow::anyhow!("falha ao abrir a pasta: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(sha256: &str) -> UpdateAsset {
        UpdateAsset {
            name: "Zylara-Setup-0.2.0-windows-x64.exe".into(),
            size: 6,
            sha256: sha256.into(),
            download_url: "https://github.com/Hyska-Software/ZylaraAi/releases/download/v0.2.0/Zylara-Setup-0.2.0-windows-x64.exe".into(),
            platform_label: "Windows x64".into(),
            kind: "setup".into(),
        }
    }

    #[test]
    fn verifies_size_and_hash_before_installing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("setup.exe");
        std::fs::write(&path, b"zylara").expect("gravar");
        let digest = download::sha256_file(&path).expect("hash");

        verify_download(&path, &asset(&digest)).expect("hash correto");
        assert!(verify_download(&path, &asset(&"a".repeat(64))).is_err());

        std::fs::write(&path, b"zylara!").expect("gravar maior");
        assert!(verify_download(&path, &asset(&digest)).is_err());
    }

    #[test]
    fn rejects_missing_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("missing.exe");
        assert!(verify_download(&path, &asset(&"a".repeat(64))).is_err());
    }
}
