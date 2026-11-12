//! Managed per-user installation and the self-update helper.
//!
//! The bootstrap script writes `managed-install.json` into the app-data
//! directory and installs the payload under the user's home. The app only
//! treats the installation as managed when the marker, the expected target and
//! the running executable all agree. Applying an update copies the app binary
//! to `managed-update/helper/`, starts it with `--apply-managed-update <job>`,
//! waits for its `ready` file and lets the command layer exit the app. The
//! helper waits for the app to disappear, replaces the payload, writes a
//! result for the next launch and reopens the app.

use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use super::download::sha256_file;
use super::{safe_component, UpdateAsset, UpdateState};
use crate::domain::now_ms;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

pub const MARKER_FILE: &str = "managed-install.json";
pub const WORK_DIR: &str = "managed-update";
pub const HELPER_DIR: &str = "helper";
pub const JOB_FILE: &str = "job.json";
pub const READY_FILE: &str = "ready";
pub const RESULT_FILE: &str = "result.json";
pub const LOG_FILE: &str = "install.log";
pub const HELPER_FLAG: &str = "--apply-managed-update";

const MARKER_LIMIT: u64 = 64 * 1024;
const RESULT_LIMIT: u64 = 64 * 1024;
const JOB_LIMIT: u64 = 64 * 1024;
const LOG_LIMIT: u64 = 1024 * 1024;
const READY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const PARENT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ManagedMode {
    Managed,
    Manual,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedStatus {
    pub mode: ManagedMode,
    pub install_path: Option<String>,
    pub installed_version: Option<String>,
    pub supported: bool,
    pub reason: Option<String>,
}

impl ManagedStatus {
    pub fn manual(reason: &str) -> Self {
        Self {
            mode: ManagedMode::Manual,
            install_path: None,
            installed_version: None,
            supported: false,
            reason: Some(reason.to_string()),
        }
    }

    fn managed(marker: &ManagedMarker) -> Self {
        Self {
            mode: ManagedMode::Managed,
            install_path: Some(marker.install_path.clone()),
            installed_version: Some(marker.version.clone()),
            supported: true,
            reason: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedMarker {
    pub schema_version: u32,
    pub method: String,
    pub platform: String,
    pub arch: String,
    pub install_path: String,
    pub version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ManagedResultStatus {
    Installed,
    RolledBack,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedInstallResult {
    pub schema_version: u32,
    pub version: String,
    pub status: ManagedResultStatus,
    #[serde(default)]
    pub message: Option<String>,
    pub completed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallJob {
    pub schema_version: u32,
    pub version: String,
    pub platform: String,
    pub arch: String,
    pub home: String,
    pub data_dir: String,
    pub artifact_path: String,
    pub artifact_size: u64,
    pub artifact_sha256: String,
    pub install_path: String,
    pub marker_path: String,
    pub result_path: String,
    pub log_path: String,
    pub ready_path: String,
    pub parent_pid: u32,
}

pub fn current_target() -> (String, String) {
    let platform = std::env::consts::OS.to_string();
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64".to_string(),
        "aarch64" => "arm64".to_string(),
        other => other.to_string(),
    };
    (platform, arch)
}

pub fn supported_target(platform: &str, arch: &str) -> bool {
    matches!((platform, arch), ("linux", "x64") | ("macos", "arm64"))
}

pub fn expected_install_path(home: &Path, platform: &str) -> Option<PathBuf> {
    match platform {
        "linux" => Some(
            home.join(".local")
                .join("opt")
                .join("zylara")
                .join("Zylara.AppImage"),
        ),
        "macos" => Some(home.join("Applications").join("Zylara.app")),
        _ => None,
    }
}

/// Reads the marker without failing the app. An unreadable or invalid marker is
/// treated as absent by the caller.
pub fn read_marker(data_dir: &Path) -> Option<ManagedMarker> {
    load_marker(data_dir).ok().flatten()
}

fn load_marker(data_dir: &Path) -> std::result::Result<Option<ManagedMarker>, ()> {
    let path = data_dir.join(MARKER_FILE);
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
    };
    if !metadata.is_file() || metadata.len() > MARKER_LIMIT {
        return Err(());
    }
    let bytes = fs::read(&path).map_err(|_| ())?;
    serde_json::from_slice(&bytes).map(Some).map_err(|_| ())
}

pub fn read_result(data_dir: &Path) -> Option<ManagedInstallResult> {
    let path = data_dir.join(WORK_DIR).join(RESULT_FILE);
    let metadata = fs::metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() > RESULT_LIMIT {
        return None;
    }
    let bytes = fs::read(&path).ok()?;
    let result: ManagedInstallResult = serde_json::from_slice(&bytes).ok()?;
    if result.schema_version != 1 || result.version.trim().is_empty() {
        return None;
    }
    Some(result)
}

pub fn acknowledge_result(data_dir: &Path) -> Result<()> {
    let path = data_dir.join(WORK_DIR).join(RESULT_FILE);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| format!("failed to remove {}", path.display())),
    }
}

/// Removes per-run helper files from a previous launch while preserving the
/// result and the log. Runs during app startup.
pub fn cleanup_work_dir(data_dir: &Path) {
    let work = data_dir.join(WORK_DIR);
    let _ = fs::remove_file(work.join(JOB_FILE));
    let _ = fs::remove_file(work.join(READY_FILE));
    let _ = fs::remove_dir_all(work.join(HELPER_DIR));
}

pub fn detect(data_dir: &Path, home: &Path) -> ManagedStatus {
    let (platform, arch) = current_target();
    let current_exe = std::env::current_exe().ok();
    let appimage = std::env::var_os("APPIMAGE").map(PathBuf::from);
    detect_with(
        data_dir,
        home,
        &platform,
        &arch,
        current_exe.as_deref(),
        appimage.as_deref(),
    )
}

pub(crate) fn detect_with(
    data_dir: &Path,
    home: &Path,
    platform: &str,
    arch: &str,
    current_exe: Option<&Path>,
    appimage: Option<&Path>,
) -> ManagedStatus {
    if home.as_os_str().is_empty() {
        return ManagedStatus::manual("missing-home");
    }
    if !supported_target(platform, arch) {
        return ManagedStatus::manual("unsupported-platform");
    }
    let marker = match load_marker(data_dir) {
        Ok(Some(marker)) => marker,
        Ok(None) => return ManagedStatus::manual("no-marker"),
        Err(()) => return ManagedStatus::manual("invalid-marker"),
    };
    let Some(current_exe) = current_exe else {
        return ManagedStatus::manual("missing-running-path");
    };
    let Some(running) = running_install_path(platform, current_exe, appimage) else {
        return ManagedStatus::manual("missing-running-path");
    };
    match validate_marker(&marker, home, platform, arch, Some(&running)) {
        Ok(marker) => ManagedStatus::managed(&marker),
        Err(reason) => ManagedStatus::manual(reason),
    }
}

pub fn bundle_from_exe(exe: &Path) -> Option<PathBuf> {
    for ancestor in exe.ancestors() {
        if ancestor
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
        {
            return Some(ancestor.to_path_buf());
        }
    }
    None
}

pub fn running_install_path(
    platform: &str,
    current_exe: &Path,
    appimage: Option<&Path>,
) -> Option<PathBuf> {
    match platform {
        "linux" => {
            let appimage = appimage?;
            if !appimage.is_absolute() {
                return None;
            }
            fs::canonicalize(appimage).ok()
        }
        "macos" => {
            let bundle = bundle_from_exe(current_exe)?;
            let expected_dir = bundle.join("Contents").join("MacOS");
            let executable = fs::canonicalize(current_exe).ok()?;
            let expected_dir = fs::canonicalize(expected_dir).ok()?;
            if !executable.starts_with(&expected_dir) {
                return None;
            }
            fs::canonicalize(bundle).ok()
        }
        _ => None,
    }
}

fn is_absolute_without_parent(path: &Path) -> bool {
    path.is_absolute()
        && !path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|character| character.is_ascii_hexdigit())
}

pub fn validate_marker(
    marker: &ManagedMarker,
    home: &Path,
    platform: &str,
    arch: &str,
    running: Option<&Path>,
) -> std::result::Result<ManagedMarker, &'static str> {
    if marker.schema_version != 1 || marker.method != "managed-script" {
        return Err("invalid-marker");
    }
    if !supported_target(platform, arch) {
        return Err("unsupported-platform");
    }
    if marker.platform != platform || marker.arch != arch {
        return Err("invalid-marker");
    }
    if !safe_component(&marker.version) || !is_absolute_without_parent(Path::new(&marker.install_path))
    {
        return Err("invalid-marker");
    }
    if home.as_os_str().is_empty() {
        return Err("missing-home");
    }
    let expected = expected_install_path(home, platform).ok_or("unsupported-platform")?;
    let target = Path::new(&marker.install_path);
    let metadata = fs::symlink_metadata(target).map_err(|_| "path-mismatch")?;
    if metadata.file_type().is_symlink() {
        return Err("path-mismatch");
    }
    if platform == "linux" && !metadata.is_file() {
        return Err("path-mismatch");
    }
    if platform == "macos" && !metadata.is_dir() {
        return Err("path-mismatch");
    }
    let canonical_target = fs::canonicalize(target).map_err(|_| "path-mismatch")?;
    let canonical_expected = fs::canonicalize(&expected).map_err(|_| "path-mismatch")?;
    if canonical_target != canonical_expected {
        return Err("path-mismatch");
    }
    let running = running.ok_or("missing-running-path")?;
    let canonical_running = fs::canonicalize(running).map_err(|_| "path-mismatch")?;
    if canonical_running != canonical_expected {
        return Err("path-mismatch");
    }
    Ok(marker.clone())
}

fn valid_install_name(name: &str, platform: &str) -> bool {
    let extension = match platform {
        "linux" => ".appimage",
        "macos" => ".dmg",
        _ => return false,
    };
    name.len() <= 160
        && safe_component(name)
        && name.to_ascii_lowercase().ends_with(extension)
}

pub fn validate_job_for(
    job: &InstallJob,
    platform: &str,
    arch: &str,
) -> std::result::Result<(), &'static str> {
    if job.schema_version != 1 {
        return Err("invalid-job");
    }
    if !supported_target(platform, arch) || job.platform != platform || job.arch != arch {
        return Err("unsupported-platform");
    }
    if !safe_component(&job.version) {
        return Err("invalid-job");
    }
    let home = Path::new(&job.home);
    let data_dir = Path::new(&job.data_dir);
    if !is_absolute_without_parent(home) || !is_absolute_without_parent(data_dir) {
        return Err("invalid-job");
    }
    let work = data_dir.join(WORK_DIR);
    if Path::new(&job.marker_path) != data_dir.join(MARKER_FILE) {
        return Err("invalid-job");
    }
    if Path::new(&job.result_path) != work.join(RESULT_FILE) {
        return Err("invalid-job");
    }
    if Path::new(&job.log_path) != work.join(LOG_FILE) {
        return Err("invalid-job");
    }
    if Path::new(&job.ready_path) != work.join(READY_FILE) {
        return Err("invalid-job");
    }
    let artifact = Path::new(&job.artifact_path);
    if !is_absolute_without_parent(artifact) {
        return Err("invalid-job");
    }
    let expected_dir = data_dir.join("updates").join(&job.version);
    if artifact.parent() != Some(expected_dir.as_path()) {
        return Err("invalid-job");
    }
    let Some(name) = artifact.file_name().and_then(|name| name.to_str()) else {
        return Err("invalid-job");
    };
    if !valid_install_name(name, platform) {
        return Err("invalid-job");
    }
    if job.artifact_size == 0 || !valid_sha256(&job.artifact_sha256) || job.parent_pid == 0 {
        return Err("invalid-job");
    }
    let expected = expected_install_path(home, platform).ok_or("unsupported-platform")?;
    if Path::new(&job.install_path) != expected {
        return Err("path-mismatch");
    }
    if let Ok(metadata) = fs::symlink_metadata(&expected) {
        if metadata.file_type().is_symlink() {
            return Err("path-mismatch");
        }
    }
    Ok(())
}

pub fn helper_requested_from(args: &[String]) -> Option<PathBuf> {
    let index = args.iter().position(|arg| arg == HELPER_FLAG)?;
    if args.len() != index + 2 {
        return None;
    }
    Some(PathBuf::from(&args[index + 1]))
}

pub fn helper_requested() -> Option<PathBuf> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    helper_requested_from(&args)
}

/* ------------------------------------------------------------------ */
/* App-side launch                                                     */
/* ------------------------------------------------------------------ */

#[cfg(unix)]
pub fn launch(
    state: &UpdateState,
    version: &str,
    asset: &UpdateAsset,
    managed: &ManagedStatus,
) -> Result<()> {
    if managed.mode != ManagedMode::Managed || !managed.supported {
        bail!(crate::i18n::t("update.errors.managedUnsupported"));
    }
    let (platform, arch) = current_target();
    if !supported_target(&platform, &arch) {
        bail!(crate::i18n::t("update.errors.managedUnsupported"));
    }
    let expected_kind = if platform == "linux" { "appimage" } else { "dmg" };
    if asset.kind != expected_kind {
        bail!(crate::i18n::t("update.errors.managedAssetMismatch"));
    }
    let install_path = expected_install_path(state.home_dir(), &platform)
        .context(crate::i18n::t("update.errors.managedUnsupported"))?;
    let artifact_path = state
        .download_path(version, &asset.name)
        .context(crate::i18n::t("update.errors.invalidArtifactName"))?;
    super::install::verify_download(&artifact_path, asset)?;

    let work = state.data_dir().join(WORK_DIR);
    ensure_private_dir(&work)?;
    let helper_dir = work.join(HELPER_DIR);
    let _ = fs::remove_dir_all(&helper_dir);
    ensure_private_dir(&helper_dir)?;

    let job = InstallJob {
        schema_version: 1,
        version: version.to_string(),
        platform: platform.clone(),
        arch: arch.clone(),
        home: state.home_dir().to_string_lossy().to_string(),
        data_dir: state.data_dir().to_string_lossy().to_string(),
        artifact_path: artifact_path.to_string_lossy().to_string(),
        artifact_size: asset.size,
        artifact_sha256: asset.sha256.to_ascii_lowercase(),
        install_path: install_path.to_string_lossy().to_string(),
        marker_path: state
            .data_dir()
            .join(MARKER_FILE)
            .to_string_lossy()
            .to_string(),
        result_path: work.join(RESULT_FILE).to_string_lossy().to_string(),
        log_path: work.join(LOG_FILE).to_string_lossy().to_string(),
        ready_path: work.join(READY_FILE).to_string_lossy().to_string(),
        parent_pid: std::process::id(),
    };
    validate_job_for(&job, &platform, &arch)
        .map_err(|reason| anyhow::anyhow!("{}: {reason}", crate::i18n::t("update.errors.managedJobInvalid")))?;
    let job_path = work.join(JOB_FILE);
    write_json_atomic(&job_path, &job)?;
    let _ = fs::remove_file(&job.ready_path);

    let current_exe = std::env::current_exe().context(crate::i18n::t("update.errors.managedHelperStage"))?;
    let helper_path = helper_dir.join("zylara-apply");
    let mut candidates = Vec::new();
    match fs::copy(&current_exe, &helper_path) {
        Ok(_) => {
            let _ = fs::set_permissions(&helper_path, std::fs::Permissions::from_mode(0o700));
            candidates.push(helper_path);
        }
        Err(_) => {}
    }
    candidates.push(current_exe);

    let mut last_error = String::new();
    for candidate in candidates {
        let _ = fs::remove_file(&job.ready_path);
        let mut child = match std::process::Command::new(&candidate)
            .arg(HELPER_FLAG)
            .arg(&job_path)
            .current_dir(&work)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(error) => {
                last_error = format!("{error}");
                continue;
            }
        };
        match wait_for_ready(Path::new(&job.ready_path), &mut child, READY_TIMEOUT) {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = format!("{error}");
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
    bail!(
        "{}: {}",
        crate::i18n::t("update.errors.managedHelperStart"),
        last_error
    )
}

#[cfg(unix)]
fn ensure_private_dir(path: &Path) -> Result<()> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(unix)]
fn wait_for_ready(
    path: &Path,
    child: &mut std::process::Child,
    timeout: std::time::Duration,
) -> Result<()> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if path.exists() {
            return Ok(());
        }
        if let Some(status) = child.try_wait()? {
            bail!("helper exited before ready: {status}");
        }
        if std::time::Instant::now() >= deadline {
            bail!("helper did not become ready in time");
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

/* ------------------------------------------------------------------ */
/* Helper side                                                         */
/* ------------------------------------------------------------------ */

#[cfg(unix)]
pub fn run_helper(job_path: &Path) -> ! {
    let Some(job) = read_job(job_path) else {
        std::process::exit(1);
    };
    let expected_job = Path::new(&job.data_dir).join(WORK_DIR).join(JOB_FILE);
    if Path::new(job_path) != expected_job {
        std::process::exit(1);
    }
    if fs::write(&job.ready_path, b"ready\n").is_err() {
        std::process::exit(1);
    }
    let _ = fs::set_permissions(&job.ready_path, std::fs::Permissions::from_mode(0o600));

    if !wait_for_parent(job.parent_pid, PARENT_TIMEOUT) {
        let result = make_result(
            &job,
            ManagedResultStatus::Failed,
            Some("the app did not exit before the update timeout".to_string()),
        );
        let _ = write_json_atomic(Path::new(&job.result_path), &result);
        let _ = fs::remove_file(job_path);
        let _ = fs::remove_file(&job.ready_path);
        std::process::exit(0);
    }

    let (platform, arch) = current_target();
    let result = apply_job_for(&job, &platform, &arch);
    let _ = write_json_atomic(Path::new(&job.result_path), &result);
    let _ = fs::remove_file(job_path);
    let _ = fs::remove_file(&job.ready_path);

    let install_path = Path::new(&job.install_path);
    let expected = expected_install_path(Path::new(&job.home), &job.platform);
    if expected.as_deref() == Some(install_path) && install_path.exists() {
        launch_install(install_path, &job.platform);
    }
    std::process::exit(0);
}

#[cfg(unix)]
fn read_job(path: &Path) -> Option<InstallJob> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > JOB_LIMIT {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[cfg(unix)]
fn wait_for_parent(pid: u32, timeout: std::time::Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if !process_alive(pid) {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

#[cfg(unix)]
fn process_alive(pid: u32) -> bool {
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    if result == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(unix)]
fn launch_install(path: &Path, platform: &str) {
    if platform == "macos" {
        let _ = std::process::Command::new("/usr/bin/open")
            .arg(path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    } else {
        let _ = std::process::Command::new(path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
    }
}

#[cfg(unix)]
pub fn apply_job_for(job: &InstallJob, platform: &str, arch: &str) -> ManagedInstallResult {
    let mut log = Log::open(Path::new(&job.log_path));
    log.line(&format!("starting update to {}", job.version));
    if let Err(reason) = validate_job_for(job, platform, arch) {
        log.line(&format!("job rejected: {reason}"));
        return make_result(job, ManagedResultStatus::Failed, Some(reason.to_string()));
    }
    let artifact = Path::new(&job.artifact_path);
    let metadata = match fs::metadata(artifact) {
        Ok(metadata) if metadata.is_file() && metadata.len() == job.artifact_size => metadata,
        Ok(_) => {
            log.line("artifact size mismatch");
            return make_result(
                job,
                ManagedResultStatus::Failed,
                Some("the downloaded update is invalid".to_string()),
            );
        }
        Err(error) => {
            log.line(&format!("artifact missing: {error}"));
            return make_result(
                job,
                ManagedResultStatus::Failed,
                Some("the downloaded update is invalid".to_string()),
            );
        }
    };
    if metadata.len() != job.artifact_size {
        log.line("artifact size mismatch");
        return make_result(
            job,
            ManagedResultStatus::Failed,
            Some("the downloaded update is invalid".to_string()),
        );
    }
    match sha256_file(artifact) {
        Ok(digest) if digest.eq_ignore_ascii_case(&job.artifact_sha256) => {}
        Ok(_) => {
            log.line("artifact hash mismatch");
            return make_result(
                job,
                ManagedResultStatus::Failed,
                Some("the downloaded update is invalid".to_string()),
            );
        }
        Err(error) => {
            log.line(&format!("artifact hash failed: {error}"));
            return make_result(
                job,
                ManagedResultStatus::Failed,
                Some("the downloaded update is invalid".to_string()),
            );
        }
    }

    let outcome = if platform == "linux" {
        apply_linux(job, &mut log)
    } else {
        apply_macos(job, &mut log)
    };
    match outcome {
        Ok(message) => {
            log.line("update installed");
            make_result(job, ManagedResultStatus::Installed, message)
        }
        Err((status, message)) => {
            log.line(&format!("update failed: {message}"));
            make_result(job, status, Some(message))
        }
    }
}

type ApplyOutcome = std::result::Result<Option<String>, (ManagedResultStatus, String)>;

#[cfg(unix)]
fn apply_linux(job: &InstallJob, log: &mut Log) -> ApplyOutcome {
    use std::os::unix::fs::PermissionsExt;
    let target = Path::new(&job.install_path);
    let Some(parent) = target.parent() else {
        return Err((ManagedResultStatus::Failed, "invalid install path".to_string()));
    };
    let stage = parent.join(format!(".Zylara.AppImage.new.{}", std::process::id()));
    log.line("copying AppImage to staging");
    if let Err(error) = fs::copy(&job.artifact_path, &stage) {
        return Err((
            ManagedResultStatus::Failed,
            format!("failed to copy the AppImage: {error}"),
        ));
    }
    if let Err(error) = fs::set_permissions(&stage, fs::Permissions::from_mode(0o755)) {
        let _ = fs::remove_file(&stage);
        return Err((
            ManagedResultStatus::Failed,
            format!("failed to make the AppImage executable: {error}"),
        ));
    }
    if let Err(error) = fs::rename(&stage, target) {
        let _ = fs::remove_file(&stage);
        return Err((
            ManagedResultStatus::Failed,
            format!("failed to replace the AppImage: {error}"),
        ));
    }
    let message = write_marker(job, log).err();
    Ok(message)
}

#[cfg(unix)]
fn apply_macos(job: &InstallJob, log: &mut Log) -> ApplyOutcome {
    use std::os::unix::fs::PermissionsExt;

    let target = Path::new(&job.install_path);
    let Some(parent) = target.parent() else {
        return Err((ManagedResultStatus::Failed, "invalid install path".to_string()));
    };
    let mount_dir = std::env::temp_dir().join(format!("zylara-dmg-{}", std::process::id()));
    let _ = fs::remove_dir_all(&mount_dir);
    fs::create_dir_all(&mount_dir).map_err(|error| {
        (
            ManagedResultStatus::Failed,
            format!("failed to create the mount point: {error}"),
        )
    })?;
    let attach = std::process::Command::new("hdiutil")
        .arg("attach")
        .arg("-nobrowse")
        .arg("-readonly")
        .arg("-mountpoint")
        .arg(&mount_dir)
        .arg(&job.artifact_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    match attach {
        Ok(status) if status.success() => {}
        Ok(status) => {
            let _ = fs::remove_dir_all(&mount_dir);
            return Err((
                ManagedResultStatus::Failed,
                format!("hdiutil attach failed with {status}"),
            ));
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&mount_dir);
            return Err((
                ManagedResultStatus::Failed,
                format!("hdiutil attach failed: {error}"),
            ));
        }
    }
    let mount = DmgMount { path: mount_dir.clone() };

    let source_app = find_app(&mount.path).map_err(|message| (ManagedResultStatus::Failed, message))?;
    let bundle_id = plist_value(&source_app, "CFBundleIdentifier")
        .map_err(|message| (ManagedResultStatus::Failed, message))?;
    if bundle_id != "app.zylara.chat" {
        return Err((
            ManagedResultStatus::Failed,
            "the DMG does not contain a Zylara app".to_string(),
        ));
    }
    let executable = plist_value(&source_app, "CFBundleExecutable")
        .map_err(|message| (ManagedResultStatus::Failed, message))?;
    let executable_path = source_app
        .join("Contents")
        .join("MacOS")
        .join(&executable);
    let executable_ok = fs::metadata(&executable_path)
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false);
    if !executable_ok {
        return Err((
            ManagedResultStatus::Failed,
            "the DMG does not contain a valid app executable".to_string(),
        ));
    }
    verify_signature(&source_app).map_err(|message| (ManagedResultStatus::Failed, message))?;

    let stage_dir = parent.join(format!(".Zylara.app.stage.{}", std::process::id()));
    let _ = fs::remove_dir_all(&stage_dir);
    fs::create_dir_all(parent).map_err(|error| {
        (
            ManagedResultStatus::Failed,
            format!("failed to create the installation folder: {error}"),
        )
    })?;
    fs::create_dir_all(&stage_dir).map_err(|error| {
        (
            ManagedResultStatus::Failed,
            format!("failed to create the staging folder: {error}"),
        )
    })?;
    let staged_app = stage_dir.join("Zylara.app");
    log.line("copying app bundle to staging");
    let ditto = std::process::Command::new("ditto")
        .arg(&source_app)
        .arg(&staged_app)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    match ditto {
        Ok(status) if status.success() => {}
        Ok(status) => {
            let _ = fs::remove_dir_all(&stage_dir);
            return Err((
                ManagedResultStatus::Failed,
                format!("ditto failed with {status}"),
            ));
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&stage_dir);
            return Err((
                ManagedResultStatus::Failed,
                format!("ditto failed: {error}"),
            ));
        }
    }
    drop(mount);

    let backup = parent.join(format!(".Zylara.app.bak.{}", std::process::id()));
    let _ = fs::remove_dir_all(&backup);
    if target.exists() {
        if let Err(error) = fs::rename(target, &backup) {
            let _ = fs::remove_dir_all(&stage_dir);
            return Err((
                ManagedResultStatus::Failed,
                format!("failed to back up the current app: {error}"),
            ));
        }
    }
    if let Err(error) = fs::rename(&staged_app, target) {
        let restored = backup.exists() && fs::rename(&backup, target).is_ok();
        let _ = fs::remove_dir_all(&stage_dir);
        return Err((
            if restored {
                ManagedResultStatus::RolledBack
            } else {
                ManagedResultStatus::Failed
            },
            format!("failed to replace the app: {error}"),
        ));
    }
    let _ = fs::remove_dir_all(&stage_dir);
    let _ = fs::remove_dir_all(&backup);
    let message = write_marker(job, log).err();
    Ok(message)
}

#[cfg(unix)]
struct DmgMount {
    path: PathBuf,
}

#[cfg(unix)]
impl Drop for DmgMount {
    fn drop(&mut self) {
        let _ = std::process::Command::new("hdiutil")
            .arg("detach")
            .arg(&self.path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[cfg(unix)]
fn find_app(mount: &Path) -> std::result::Result<PathBuf, String> {
    let mut apps = Vec::new();
    let entries = fs::read_dir(mount).map_err(|error| format!("failed to read the DMG: {error}"))?;
    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        if path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
            && path.is_dir()
        {
            apps.push(path);
        }
    }
    if apps.len() != 1 {
        return Err("the DMG must contain exactly one app".to_string());
    }
    Ok(apps.remove(0))
}

#[cfg(unix)]
fn plist_value(app: &Path, key: &str) -> std::result::Result<String, String> {
    let plist = app.join("Contents").join("Info.plist");
    let output = std::process::Command::new("plutil")
        .arg("-extract")
        .arg(key)
        .arg("raw")
        .arg("-o")
        .arg("-")
        .arg(&plist)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .map_err(|error| format!("plutil failed: {error}"))?;
    if !output.status.success() {
        return Err(format!("missing {key} in Info.plist"));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(unix)]
fn verify_signature(app: &Path) -> std::result::Result<(), String> {
    let described = std::process::Command::new("codesign")
        .arg("-dv")
        .arg(app)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    let Ok(described) = described else {
        return Ok(());
    };
    if !described.success() {
        return Ok(());
    }
    let verified = std::process::Command::new("codesign")
        .arg("--verify")
        .arg("--deep")
        .arg("--strict")
        .arg(app)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|error| format!("codesign failed: {error}"))?;
    if verified.success() {
        Ok(())
    } else {
        Err("the app bundle signature is invalid".to_string())
    }
}

#[cfg(unix)]
fn write_marker(job: &InstallJob, log: &mut Log) -> std::result::Result<(), String> {
    let marker = ManagedMarker {
        schema_version: 1,
        method: "managed-script".to_string(),
        platform: job.platform.clone(),
        arch: job.arch.clone(),
        install_path: job.install_path.clone(),
        version: job.version.clone(),
    };
    match write_json_atomic(Path::new(&job.marker_path), &marker) {
        Ok(()) => Ok(()),
        Err(error) => {
            log.line(&format!("marker write failed: {error}"));
            Err(format!("could not write the managed-install marker: {error}"))
        }
    }
}

#[cfg(unix)]
struct Log {
    file: Option<fs::File>,
}

#[cfg(unix)]
impl Log {
    fn open(path: &Path) -> Self {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(metadata) = fs::metadata(path) {
            if metadata.len() > LOG_LIMIT {
                let rotated = path.with_file_name("install.log.1");
                let _ = fs::rename(path, rotated);
            }
        }
        let file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .ok();
        Self { file }
    }

    fn line(&mut self, message: &str) {
        if let Some(file) = self.file.as_mut() {
            let _ = writeln!(file, "{} {message}", now_ms());
        }
    }
}

fn make_result(
    job: &InstallJob,
    status: ManagedResultStatus,
    message: Option<String>,
) -> ManagedInstallResult {
    ManagedInstallResult {
        schema_version: 1,
        version: job.version.clone(),
        status,
        message,
        completed_at: now_ms(),
    }
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let parent = path
        .parent()
        .context("the update path has no parent directory")?;
    fs::create_dir_all(parent)?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("update");
    let temporary = parent.join(format!(".{name}.tmp.{}", std::process::id()));
    let bytes = serde_json::to_vec_pretty(value)?;
    fs::write(&temporary, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(windows)]
    let _ = fs::remove_file(path);
    fs::rename(&temporary, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tempfile::TempDir;

    fn write_file(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        fs::write(path, bytes).expect("write file");
    }

    fn write_marker_file(data_dir: &Path, marker: &ManagedMarker) {
        fs::create_dir_all(data_dir).expect("create data dir");
        fs::write(
            data_dir.join(MARKER_FILE),
            serde_json::to_vec_pretty(marker).expect("serialize marker"),
        )
        .expect("write marker");
    }

    fn linux_marker(home: &Path) -> ManagedMarker {
        ManagedMarker {
            schema_version: 1,
            method: "managed-script".to_string(),
            platform: "linux".to_string(),
            arch: "x64".to_string(),
            install_path: expected_install_path(home, "linux")
                .expect("linux path")
                .to_string_lossy()
                .to_string(),
            version: "0.8.0".to_string(),
        }
    }

    fn macos_marker(home: &Path) -> ManagedMarker {
        ManagedMarker {
            schema_version: 1,
            method: "managed-script".to_string(),
            platform: "macos".to_string(),
            arch: "arm64".to_string(),
            install_path: expected_install_path(home, "macos")
                .expect("macos path")
                .to_string_lossy()
                .to_string(),
            version: "0.8.0".to_string(),
        }
    }

    fn sample_job(dir: &TempDir, platform: &str, arch: &str) -> InstallJob {
        let data_dir = dir.path().join("data");
        let home = dir.path().join("home");
        let version = "0.8.1";
        let name = if platform == "linux" {
            "Zylara-0.8.1-linux-x64.AppImage"
        } else {
            "Zylara-0.8.1-macos-arm64.dmg"
        };
        let artifact_path = data_dir.join("updates").join(version).join(name);
        write_file(&artifact_path, b"new-payload");
        let install_path = expected_install_path(&home, platform).expect("install path");
        let work = data_dir.join(WORK_DIR);
        InstallJob {
            schema_version: 1,
            version: version.to_string(),
            platform: platform.to_string(),
            arch: arch.to_string(),
            home: home.to_string_lossy().to_string(),
            data_dir: data_dir.to_string_lossy().to_string(),
            artifact_path: artifact_path.to_string_lossy().to_string(),
            artifact_size: 11,
            artifact_sha256: sha256_file(&artifact_path).expect("hash"),
            install_path: install_path.to_string_lossy().to_string(),
            marker_path: data_dir.join(MARKER_FILE).to_string_lossy().to_string(),
            result_path: work.join(RESULT_FILE).to_string_lossy().to_string(),
            log_path: work.join(LOG_FILE).to_string_lossy().to_string(),
            ready_path: work.join(READY_FILE).to_string_lossy().to_string(),
            parent_pid: 1,
        }
    }

    #[test]
    fn knows_the_supported_targets_and_paths() {
        assert!(supported_target("linux", "x64"));
        assert!(supported_target("macos", "arm64"));
        assert!(!supported_target("linux", "arm64"));
        assert!(!supported_target("macos", "x64"));
        assert!(!supported_target("windows", "x64"));
        let home = Path::new("/home/ana");
        assert_eq!(
            expected_install_path(home, "linux").expect("linux"),
            home.join(".local/opt/zylara/Zylara.AppImage")
        );
        assert_eq!(
            expected_install_path(home, "macos").expect("macos"),
            home.join("Applications/Zylara.app")
        );
    }

    #[test]
    fn detects_a_valid_linux_marker() {
        let dir = tempfile::tempdir().expect("tempdir");
        let data = dir.path().join("data");
        let home = dir.path().join("home");
        let marker = linux_marker(&home);
        let target = PathBuf::from(&marker.install_path);
        write_file(&target, b"appimage");
        write_marker_file(&data, &marker);

        let status = detect_with(&data, &home, "linux", "x64", Some(&target), Some(&target));
        assert_eq!(status.mode, ManagedMode::Managed);
        assert!(status.supported);
        assert_eq!(status.install_path.as_deref(), Some(marker.install_path.as_str()));
        assert_eq!(status.installed_version.as_deref(), Some("0.8.0"));
        assert!(validate_marker(&marker, &home, "linux", "x64", Some(&target)).is_ok());
    }

    #[test]
    fn detects_a_valid_macos_marker() {
        let dir = tempfile::tempdir().expect("tempdir");
        let data = dir.path().join("data");
        let home = dir.path().join("home");
        let marker = macos_marker(&home);
        let bundle = PathBuf::from(&marker.install_path);
        let executable = bundle.join("Contents/MacOS/zylara");
        write_file(&executable, b"binary");
        write_marker_file(&data, &marker);

        let status = detect_with(&data, &home, "macos", "arm64", Some(&executable), None);
        assert_eq!(status.mode, ManagedMode::Managed);
        assert!(status.supported);
        let derived = bundle_from_exe(&executable).expect("bundle");
        assert_eq!(derived, bundle);
        assert!(validate_marker(&marker, &home, "macos", "arm64", Some(&bundle)).is_ok());
    }

    #[test]
    fn reports_detection_reasons() {
        let dir = tempfile::tempdir().expect("tempdir");
        let data = dir.path().join("data");
        let home = dir.path().join("home");
        assert_eq!(
            detect_with(&data, &home, "linux", "x64", None, None).reason.as_deref(),
            Some("no-marker")
        );
        assert_eq!(
            detect_with(&data, Path::new(""), "linux", "x64", None, None)
                .reason
                .as_deref(),
            Some("missing-home")
        );
        assert_eq!(
            detect_with(&data, &home, "windows", "x64", None, None)
                .reason
                .as_deref(),
            Some("unsupported-platform")
        );
        fs::create_dir_all(&data).expect("data");
        fs::write(data.join(MARKER_FILE), b"{").expect("invalid marker");
        assert_eq!(
            detect_with(&data, &home, "linux", "x64", None, None).reason.as_deref(),
            Some("invalid-marker")
        );

        let marker = linux_marker(&home);
        write_marker_file(&data, &marker);
        let target = PathBuf::from(&marker.install_path);
        write_file(&target, b"appimage");
        assert_eq!(
            detect_with(&data, &home, "linux", "x64", Some(&target), None)
                .reason
                .as_deref(),
            Some("missing-running-path")
        );
        let other = dir.path().join("other.AppImage");
        write_file(&other, b"other");
        assert_eq!(
            detect_with(&data, &home, "linux", "x64", Some(&target), Some(&other))
                .reason
                .as_deref(),
            Some("path-mismatch")
        );
    }

    #[test]
    fn rejects_invalid_markers() {
        let dir = tempfile::tempdir().expect("tempdir");
        let home = dir.path().join("home");
        let marker = linux_marker(&home);
        let target = PathBuf::from(&marker.install_path);
        write_file(&target, b"appimage");

        let mut invalid = marker.clone();
        invalid.schema_version = 2;
        assert_eq!(
            validate_marker(&invalid, &home, "linux", "x64", Some(&target)),
            Err("invalid-marker")
        );
        let mut invalid = marker.clone();
        invalid.method = "other".to_string();
        assert_eq!(
            validate_marker(&invalid, &home, "linux", "x64", Some(&target)),
            Err("invalid-marker")
        );
        let mut invalid = marker.clone();
        invalid.platform = "macos".to_string();
        assert_eq!(
            validate_marker(&invalid, &home, "linux", "x64", Some(&target)),
            Err("invalid-marker")
        );
        let mut invalid = marker.clone();
        invalid.arch = "arm64".to_string();
        assert_eq!(
            validate_marker(&invalid, &home, "linux", "x64", Some(&target)),
            Err("invalid-marker")
        );
        let mut invalid = marker.clone();
        invalid.version = "../0.8.0".to_string();
        assert_eq!(
            validate_marker(&invalid, &home, "linux", "x64", Some(&target)),
            Err("invalid-marker")
        );
        let mut invalid = marker.clone();
        invalid.install_path = "relative".to_string();
        assert_eq!(
            validate_marker(&invalid, &home, "linux", "x64", Some(&target)),
            Err("invalid-marker")
        );
        let outside = dir.path().join("outside.AppImage");
        write_file(&outside, b"outside");
        let mut invalid = marker.clone();
        invalid.install_path = outside.to_string_lossy().to_string();
        assert_eq!(
            validate_marker(&invalid, &home, "linux", "x64", Some(&target)),
            Err("path-mismatch")
        );
        let other = dir.path().join("other.AppImage");
        write_file(&other, b"other");
        assert_eq!(
            validate_marker(&marker, &home, "linux", "x64", Some(&other)),
            Err("path-mismatch")
        );
        assert_eq!(
            validate_marker(&marker, &home, "linux", "x64", None),
            Err("missing-running-path")
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_target() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().expect("tempdir");
        let home = dir.path().join("home");
        let marker = linux_marker(&home);
        let target = PathBuf::from(&marker.install_path);
        fs::create_dir_all(target.parent().expect("parent")).expect("parent");
        let real = dir.path().join("real.AppImage");
        write_file(&real, b"appimage");
        symlink(&real, &target).expect("symlink");
        assert_eq!(
            validate_marker(&marker, &home, "linux", "x64", Some(&target)),
            Err("path-mismatch")
        );
    }

    #[test]
    fn validates_the_install_job() {
        let dir = tempfile::tempdir().expect("tempdir");
        let job = sample_job(&dir, "linux", "x64");
        assert!(validate_job_for(&job, "linux", "x64").is_ok());

        let mut invalid = job.clone();
        invalid.platform = "macos".to_string();
        assert_eq!(
            validate_job_for(&invalid, "linux", "x64"),
            Err("unsupported-platform")
        );
        let mut invalid = job.clone();
        invalid.artifact_sha256 = "abc".to_string();
        assert_eq!(validate_job_for(&invalid, "linux", "x64"), Err("invalid-job"));
        let mut invalid = job.clone();
        invalid.artifact_size = 0;
        assert_eq!(validate_job_for(&invalid, "linux", "x64"), Err("invalid-job"));
        let mut invalid = job.clone();
        invalid.ready_path = job.result_path.clone();
        assert_eq!(validate_job_for(&invalid, "linux", "x64"), Err("invalid-job"));
        let mut invalid = job.clone();
        invalid.install_path = dir.path().join("elsewhere.AppImage").to_string_lossy().to_string();
        assert_eq!(
            validate_job_for(&invalid, "linux", "x64"),
            Err("path-mismatch")
        );
        let mut invalid = job.clone();
        invalid.artifact_path = dir.path().join("elsewhere.AppImage").to_string_lossy().to_string();
        assert_eq!(validate_job_for(&invalid, "linux", "x64"), Err("invalid-job"));

        let macos = sample_job(&dir, "macos", "arm64");
        assert!(validate_job_for(&macos, "macos", "arm64").is_ok());
    }

    #[test]
    fn reads_and_acknowledges_the_last_result() {
        let dir = tempfile::tempdir().expect("tempdir");
        let data = dir.path().join("data");
        let work = data.join(WORK_DIR);
        fs::create_dir_all(&work).expect("work");
        let result = ManagedInstallResult {
            schema_version: 1,
            version: "0.8.1".to_string(),
            status: ManagedResultStatus::RolledBack,
            message: Some("boom".to_string()),
            completed_at: 42,
        };
        write_json_atomic(&work.join(RESULT_FILE), &result).expect("write");
        assert_eq!(read_result(&data), Some(result));
        acknowledge_result(&data).expect("ack");
        assert_eq!(read_result(&data), None);
        acknowledge_result(&data).expect("ack missing");

        fs::write(work.join(RESULT_FILE), b"{").expect("invalid result");
        assert_eq!(read_result(&data), None);
        let invalid = ManagedInstallResult {
            schema_version: 2,
            ..ManagedInstallResult {
                schema_version: 1,
                version: "0.8.1".to_string(),
                status: ManagedResultStatus::Failed,
                message: None,
                completed_at: 1,
            }
        };
        write_json_atomic(&work.join(RESULT_FILE), &invalid).expect("write invalid");
        assert_eq!(read_result(&data), None);
    }

    #[test]
    fn parses_the_helper_argument() {
        assert_eq!(
            helper_requested_from(&[
                HELPER_FLAG.to_string(),
                "/tmp/managed-update/job.json".to_string(),
            ]),
            Some(PathBuf::from("/tmp/managed-update/job.json"))
        );
        assert_eq!(helper_requested_from(&[HELPER_FLAG.to_string()]), None);
        assert_eq!(
            helper_requested_from(&[
                HELPER_FLAG.to_string(),
                "/tmp/job.json".to_string(),
                "extra".to_string(),
            ]),
            None
        );
        assert_eq!(helper_requested_from(&[]), None);
    }

    #[cfg(unix)]
    #[test]
    fn waits_for_the_ready_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ready = dir.path().join(READY_FILE);
        let mut child = std::process::Command::new("sh")
            .arg("-c")
            .arg("sleep 2")
            .spawn()
            .expect("spawn");
        let writer = ready.clone();
        let thread = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            fs::write(writer, b"ready").expect("ready");
        });
        assert!(wait_for_ready(&ready, &mut child, Duration::from_secs(2)).is_ok());
        let _ = child.kill();
        let _ = child.wait();
        thread.join().expect("thread");
    }

    #[cfg(unix)]
    #[test]
    fn ready_timeout_is_reported() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ready = dir.path().join(READY_FILE);
        let mut child = std::process::Command::new("sh")
            .arg("-c")
            .arg("sleep 2")
            .spawn()
            .expect("spawn");
        assert!(wait_for_ready(&ready, &mut child, Duration::from_millis(50)).is_err());
        let _ = child.kill();
        let _ = child.wait();
    }

    #[cfg(unix)]
    #[test]
    fn parent_wait_observes_a_running_process() {
        assert!(process_alive(std::process::id()));
        assert!(!wait_for_parent(
            std::process::id(),
            Duration::from_millis(100)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn applies_a_linux_appimage_and_preserves_the_old_file_on_failure() {
        let dir = tempfile::tempdir().expect("tempdir");
        let job = sample_job(&dir, "linux", "x64");
        let target = PathBuf::from(&job.install_path);
        write_file(&target, b"old-payload");
        let result = apply_job_for(&job, "linux", "x64");
        assert_eq!(result.status, ManagedResultStatus::Installed);
        assert!(result.message.is_none());
        assert_eq!(fs::read(&target).expect("target"), b"new-payload");
        let marker = read_marker(Path::new(&job.data_dir)).expect("marker");
        assert_eq!(marker.version, "0.8.1");
        assert_eq!(marker.install_path, job.install_path);

        write_file(&target, b"old-payload");
        let mut missing = job.clone();
        missing.artifact_path = dir
            .path()
            .join("missing.AppImage")
            .to_string_lossy()
            .to_string();
        let result = apply_job_for(&missing, "linux", "x64");
        assert_eq!(result.status, ManagedResultStatus::Failed);
        assert_eq!(fs::read(&target).expect("target"), b"old-payload");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn applies_a_macos_dmg_through_the_helper() {
        let dir = tempfile::tempdir().expect("tempdir");
        let job = sample_job(&dir, "macos", "arm64");
        let source = dir.path().join("source");
        let app = source.join("Zylara.app");
        let executable = app.join("Contents/MacOS/zylara");
        write_file(
            &app.join("Contents/Info.plist"),
            br#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>app.zylara.chat</string>
<key>CFBundleExecutable</key><string>zylara</string>
</dict></plist>
"#,
        );
        write_file(&executable, b"#!/bin/sh\nexit 0\n");
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).expect("chmod");
        let dmg = PathBuf::from(&job.artifact_path);
        let created = std::process::Command::new("hdiutil")
            .args([
                "create",
                "-volname",
                "Zylara",
                "-srcfolder",
                source.to_str().expect("source"),
                "-ov",
                "-format",
                "UDZO",
                dmg.to_str().expect("dmg"),
            ])
            .status()
            .expect("hdiutil");
        assert!(created.success());
        let mut job = job;
        job.artifact_size = fs::metadata(&dmg).expect("dmg metadata").len();
        job.artifact_sha256 = sha256_file(&dmg).expect("dmg hash");
        let target = PathBuf::from(&job.install_path);
        write_file(&target.join("old.txt"), b"old");
        let result = apply_job_for(&job, "macos", "arm64");
        assert_eq!(result.status, ManagedResultStatus::Installed);
        assert!(target.join("Contents/Info.plist").exists());
        assert!(!target.join("old.txt").exists());
    }
}
