//! Application settings + credentials.
//!
//! Settings live in `<app-data>/settings.json`; credentials live in
//! `<app-data>/secrets.json` (never sent to the renderer in plain text).
//!
//! `secrets.json` v2 holds both the provider API keys and the OAuth
//! ("Sign in with ChatGPT") registrations. This module is the **single writer**
//! of that file: every mutation goes through a global read-modify-write
//! [`Mutex`], reloads the file first (so concurrent writers never lose an
//! update), writes atomically with a unique temp file (`secrets.<uuid>.tmp`,
//! owner-only on Unix) and never overwrites a corrupt file — it records/returns
//! an error, keeps the original bytes and leaves a `secrets.bak` copy behind.
//!
//! As a convenience the backend also detects keys from the OpenCode CLI
//! (`~/.local/share/opencode/auth.json`) and from the provider environment
//! variable (`OPENAI_API_KEY` for OpenAI, `OPENCODE_API_KEY` for Go/Zen; the
//! latter is kept as the legacy fallback).

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use anyhow::{bail, Context};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::domain::{ProviderKeyStatus, Settings, MAX_STEPS_LIMIT};

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/// Limites do tempo máximo de execução de código (`codeTimeoutSecs`), expostos
/// no slider da tela de configuração e aplicados também pelo `run_code`.
pub const CODE_TIMEOUT_MIN_SECS: u32 = 10;
pub const CODE_TIMEOUT_MAX_SECS: u32 = 600;

/// Normaliza a lista de skills desativadas vinda do disco ou do renderer:
/// `trim`, descarta entradas vazias, remove duplicatas e ordena (a comparação
/// com o catálogo é por nome canônico). `skills_panel_enabled` é booleano e não
/// precisa de transformação.
pub(crate) fn normalize_disabled_skills(names: Vec<String>) -> Vec<String> {
    let mut names: Vec<String> = names
        .into_iter()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect();
    names.sort_unstable();
    names.dedup();
    names
}

/// Clamp/repair values coming from disk or from the renderer so the UI never
/// has to deal with out-of-range settings.
///
/// Booleanos de preferência (como `thinking_collapsed_by_default`) são
/// preservados como vieram do disco/renderer: não há transformação a aplicar.
fn normalize_settings(mut settings: Settings) -> Settings {
    let defaults = Settings::default();

    settings.max_steps = settings.max_steps.clamp(1, MAX_STEPS_LIMIT);

    if !settings.font_scale.is_finite() {
        settings.font_scale = defaults.font_scale;
    }
    settings.font_scale = settings.font_scale.clamp(0.85, 1.3);

    if !matches!(settings.theme.as_str(), "light" | "dark" | "system") {
        settings.theme = defaults.theme;
    }
    if !matches!(settings.locale.as_str(), "pt-BR" | "en") {
        settings.locale = defaults.locale;
    }
    if !matches!(settings.send_key.as_str(), "enter" | "ctrl+enter") {
        settings.send_key = defaults.send_key;
    }
    if !matches!(
        settings.reasoning_default.as_str(),
        "auto" | "off" | "low" | "medium" | "high" | "max"
    ) {
        settings.reasoning_default = defaults.reasoning_default;
    }
    if settings.default_provider.trim().is_empty() {
        settings.default_provider = defaults.default_provider;
    }
    if settings.default_model.trim().is_empty() {
        settings.default_model = defaults.default_model;
    }
    match settings.temperature {
        Some(value) if !value.is_finite() => settings.temperature = None,
        Some(value) => settings.temperature = Some(value.clamp(0.0, 2.0)),
        None => {}
    }
    settings.code_timeout_secs = settings
        .code_timeout_secs
        .clamp(CODE_TIMEOUT_MIN_SECS, CODE_TIMEOUT_MAX_SECS);
    settings.code_python_path = settings.code_python_path.trim().to_string();
    settings.code_node_path = settings.code_node_path.trim().to_string();
    settings.disabled_skills =
        normalize_disabled_skills(std::mem::take(&mut settings.disabled_skills));
    settings
}

pub fn load_settings(app: &AppHandle) -> Settings {
    let path = settings_path(app);
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str::<Settings>(&raw)
            .map(normalize_settings)
            .unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save_settings(app: &AppHandle, settings: &Settings) -> anyhow::Result<()> {
    let normalized = normalize_settings(settings.clone());
    let raw = serde_json::to_string_pretty(&normalized)
        .context("falha ao serializar as configurações")?;
    write_private(&settings_path(app), &raw)
}

/* ------------------------------------------------------------------ */
/* Private/atomic file writes                                          */
/* ------------------------------------------------------------------ */

/// Writes a file atomically and, where the platform supports it, with
/// owner-only permissions. On Windows `%APPDATA%` is already ACL-restricted to
/// the current user, so the default ACL is kept.
///
/// The temp file has a unique name so concurrent writers can never step on each
/// other's temporary file. A crash between create and rename may leave one
/// behind; [`reset_credentials_at`] removes those leftovers.
fn write_private(path: &Path, contents: &str) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("falha ao criar {}", parent.display()))?;
        }
    }
    let file_name = path
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("caminho inválido: {}", path.display()))?;
    let tmp = path.with_file_name(format!(
        "{}.{}.tmp",
        file_name.to_string_lossy(),
        uuid::Uuid::new_v4()
    ));

    let result = match write_private_tmp(&tmp, contents) {
        Ok(()) => {
            if std::fs::rename(&tmp, path).is_err() {
                // Same-volume rename is atomic on Windows and Unix; the fallback
                // only exists for exotic filesystems.
                let fallback = std::fs::write(path, contents)
                    .with_context(|| format!("falha ao gravar {}", path.display()));
                let _ = std::fs::remove_file(&tmp);
                fallback.map(|_| tighten_permissions(path))
            } else {
                Ok(())
            }
        }
        Err(error) => Err(error),
    };
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

fn write_private_tmp(tmp: &Path, contents: &str) -> anyhow::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(tmp)
        .with_context(|| format!("falha ao escrever {}", tmp.display()))?;
    file.write_all(contents.as_bytes())?;
    file.sync_all()?;
    Ok(())
}

#[cfg(unix)]
fn tighten_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn tighten_permissions(_path: &Path) {}

fn remove_stale_temp_files(path: &Path) {
    let (Some(parent), Some(file_name)) = (path.parent(), path.file_name()) else {
        return;
    };
    let prefix = format!("{}.", file_name.to_string_lossy());
    let Ok(entries) = std::fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(&prefix) && name.ends_with(".tmp") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/* ------------------------------------------------------------------ */
/* Secrets (v2 — the single writer of `<app-data>/secrets.json`)       */
/* ------------------------------------------------------------------ */

/// Current on-disk credentials schema. v1 files (no `version`/`oauth`) are
/// loaded transparently and rewritten as v2 on the next mutation.
pub const SECRETS_VERSION: u32 = 2;

/// Placeholder used by `Debug` implementations so tokens can never leak into a
/// log line through `{credentials:?}`.
const REDACTED: &str = "<redacted>";

/// `<app-data>/secrets.json`:
///
/// ```json
/// {
///   "version": 2,
///   "providers": { "opencode-go": "sk-…" },
///   "oauth": {
///     "hostId": "urn:uuid:…",
///     "active": { "openai": "oaiapp_…" },
///     "registrations": {
///       "openai": {
///         "oaiapp_…": {
///           "email": "user@example.com", "issuer": "https://auth.openai.com",
///           "subject": "…", "clientId": "oaiapp_…",
///           "extAgentHostId": "urn:uuid:…", "idToken": "…",
///           "accessToken": "…", "refreshToken": "…", "tokenType": "Bearer",
///           "expiresIn": 3600, "scopes": ["…"],
///           "savedAt": 1700000000000, "earliestRefreshAt": null,
///           "planUsage": true, "disconnected": false
///         }
///       }
///     }
///   }
/// }
/// ```
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SecretsFile {
    pub version: u32,
    pub providers: BTreeMap<String, String>,
    pub oauth: OAuthStore,
}

impl Default for SecretsFile {
    fn default() -> Self {
        Self {
            version: SECRETS_VERSION,
            providers: BTreeMap::new(),
            oauth: OAuthStore::default(),
        }
    }
}

impl std::fmt::Debug for SecretsFile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SecretsFile")
            .field("version", &self.version)
            .field("providers", &self.providers.keys().collect::<Vec<_>>())
            .field("oauth", &self.oauth)
            .finish()
    }
}

/// OAuth block of `secrets.json`: one stable host id plus the registrations
/// keyed by provider and issued `client_id`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OAuthStore {
    /// `urn:uuid:<v4>` generated once per installation.
    pub host_id: Option<String>,
    /// provider id -> active `client_id` (`oaiapp_…`).
    pub active: BTreeMap<String, String>,
    /// provider id -> (`client_id` -> registration).
    pub registrations: BTreeMap<String, BTreeMap<String, StoredOAuthRegistration>>,
}

impl OAuthStore {
    pub fn active_client_id(&self, provider_id: &str) -> Option<&str> {
        self.active.get(provider_id).map(String::as_str)
    }

    pub fn registration(
        &self,
        provider_id: &str,
        client_id: &str,
    ) -> Option<&StoredOAuthRegistration> {
        self.registrations
            .get(provider_id)
            .and_then(|registrations| registrations.get(client_id))
    }

    /// Active registration of a provider (mapping is retained on sign-out).
    pub fn active_registration(&self, provider_id: &str) -> Option<&StoredOAuthRegistration> {
        let client_id = self.active_client_id(provider_id)?;
        self.registration(provider_id, client_id)
    }

    /// Inserts a registration and makes its `client_id` active. The mapping
    /// (email/subject/client id/host id) survives sign-out; only tokens go away.
    pub fn save_registration(
        &mut self,
        provider_id: &str,
        registration: StoredOAuthRegistration,
    ) -> anyhow::Result<()> {
        let client_id = registration.client_id.trim().to_string();
        if client_id.is_empty() {
            bail!("registro OAuth sem clientId");
        }
        self.active
            .insert(provider_id.to_string(), client_id.clone());
        self.registrations
            .entry(provider_id.to_string())
            .or_default()
            .insert(client_id, registration);
        Ok(())
    }

    /// Sign-out: deletes only the tokens and marks the account disconnected.
    /// Returns `false` when there is no active registration to clear.
    pub fn clear_tokens(&mut self, provider_id: &str) -> bool {
        let Some(client_id) = self.active.get(provider_id).cloned() else {
            return false;
        };
        let Some(registration) = self
            .registrations
            .get_mut(provider_id)
            .and_then(|registrations| registrations.get_mut(&client_id))
        else {
            return false;
        };
        registration.id_token.clear();
        registration.access_token.clear();
        registration.refresh_token.clear();
        registration.disconnected = true;
        true
    }
}

/// One credential set for one account/client id. Tokens are persisted here and
/// are **never** serialized to the renderer; `Debug` redacts them.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StoredOAuthRegistration {
    pub email: Option<String>,
    pub issuer: String,
    pub subject: String,
    pub client_id: String,
    pub ext_agent_host_id: String,
    pub id_token: String,
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub expires_in: u64,
    pub scopes: Vec<String>,
    /// Unix milliseconds when the tokens were obtained.
    pub saved_at: i64,
    /// Optional server hint; refresh is skipped before this instant.
    pub earliest_refresh_at: Option<String>,
    /// The `chatgpt.tokens.use.direct` scope was granted.
    pub plan_usage: bool,
    /// Signed out: tokens cleared, mapping retained.
    pub disconnected: bool,
}

impl Default for StoredOAuthRegistration {
    fn default() -> Self {
        Self {
            email: None,
            issuer: String::new(),
            subject: String::new(),
            client_id: String::new(),
            ext_agent_host_id: String::new(),
            id_token: String::new(),
            access_token: String::new(),
            refresh_token: String::new(),
            token_type: "Bearer".to_string(),
            expires_in: 0,
            scopes: Vec::new(),
            saved_at: 0,
            earliest_refresh_at: None,
            plan_usage: false,
            disconnected: false,
        }
    }
}

impl std::fmt::Debug for StoredOAuthRegistration {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StoredOAuthRegistration")
            .field("email", &self.email)
            .field("issuer", &self.issuer)
            .field("subject", &self.subject)
            .field("client_id", &self.client_id)
            .field("ext_agent_host_id", &self.ext_agent_host_id)
            .field("id_token", &REDACTED)
            .field("access_token", &REDACTED)
            .field("refresh_token", &REDACTED)
            .field("token_type", &self.token_type)
            .field("expires_in", &self.expires_in)
            .field("scopes", &self.scopes)
            .field("saved_at", &self.saved_at)
            .field("earliest_refresh_at", &self.earliest_refresh_at)
            .field("plan_usage", &self.plan_usage)
            .field("disconnected", &self.disconnected)
            .finish()
    }
}

impl StoredOAuthRegistration {
    /// True when the account can be refreshed without a new login.
    pub fn has_refresh_token(&self) -> bool {
        !self.refresh_token.trim().is_empty()
    }

    /// Absolute expiry (Unix ms) of the current access token, when known.
    pub fn expires_at_ms(&self) -> Option<i64> {
        if self.saved_at <= 0 || self.expires_in == 0 {
            return None;
        }
        let lifetime = i64::try_from(self.expires_in).ok()?.checked_mul(1000)?;
        self.saved_at.checked_add(lifetime)
    }
}

/// Last `secrets.json` load error, cached in memory because the read commands
/// (`get_settings`, `get_catalog`, `api_key`, …) are synchronous and infallible.
/// Set by a failed load; cleared only by an explicit reset.
fn secrets_error_slot() -> &'static Mutex<Option<String>> {
    static SLOT: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

pub fn secrets_error() -> Option<String> {
    secrets_error_slot().lock().clone()
}

fn remember_secrets_error(message: impl Into<String>) {
    *secrets_error_slot().lock() = Some(message.into());
}

fn clear_secrets_error() {
    *secrets_error_slot().lock() = None;
}

fn credentials_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn is_not_found(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::NotFound
}

/// Reads and parses the credentials file.
///
/// * `Ok(None)` — the file does not exist yet (fresh install).
/// * `Err(_)` — unreadable or corrupt: callers must **not** write over it.
fn read_secrets_at(path: &Path) -> anyhow::Result<Option<SecretsFile>> {
    match std::fs::read_to_string(path) {
        Ok(raw) => {
            let secrets = serde_json::from_str::<SecretsFile>(&raw).with_context(|| {
                format!("{} não é um JSON de credenciais válido", path.display())
            })?;
            Ok(Some(secrets))
        }
        Err(error) if is_not_found(&error) => Ok(None),
        Err(error) => Err(error).with_context(|| format!("falha ao ler {}", path.display())),
    }
}

/// Best-effort copy of a corrupt file, created once (never overwritten) before
/// any future write could destroy the original bytes.
fn backup_corrupt_at(path: &Path) {
    if !path.exists() {
        return;
    }
    let backup = path.with_extension("bak");
    if backup.exists() {
        return;
    }
    let _ = std::fs::copy(path, backup);
}

/// Read for infallible call sites: corrupt content yields a default store (the
/// error is remembered for `SettingsView.secretsError`) and a `.bak` copy.
fn load_secrets_reporting(path: &Path) -> SecretsFile {
    match read_secrets_at(path) {
        Ok(Some(secrets)) => secrets,
        Ok(None) => SecretsFile::default(),
        Err(error) => {
            remember_secrets_error(format!("{error:#}"));
            backup_corrupt_at(path);
            SecretsFile::default()
        }
    }
}

fn load_secrets(app: &AppHandle) -> SecretsFile {
    load_secrets_reporting(&secrets_path(app))
}

/// Read for write paths: a corrupt file is reported as an error and preserved.
fn read_secrets_for_write_at(path: &Path) -> anyhow::Result<SecretsFile> {
    match read_secrets_at(path) {
        Ok(Some(secrets)) => Ok(secrets),
        Ok(None) => Ok(SecretsFile::default()),
        Err(error) => {
            let message = format!("{error:#}");
            remember_secrets_error(&message);
            backup_corrupt_at(path);
            bail!(
                "as credenciais estão corrompidas; nenhuma alteração foi gravada e o \
                 arquivo original foi preservado (cópia em .bak). Detalhe: {message}"
            )
        }
    }
}

fn save_secrets_at(path: &Path, secrets: &SecretsFile) -> anyhow::Result<()> {
    let raw =
        serde_json::to_string_pretty(secrets).context("falha ao serializar as credenciais")?;
    write_private(path, &raw)
}

/// Read-only view of the OAuth store for the sync IPC commands. The second
/// value is the corruption error (if any) so callers can surface it instead of
/// silently showing an empty store.
pub fn oauth_snapshot(app: &AppHandle) -> (OAuthStore, Option<String>) {
    oauth_snapshot_at(&secrets_path(app))
}

fn oauth_snapshot_at(path: &Path) -> (OAuthStore, Option<String>) {
    match read_secrets_at(path) {
        Ok(Some(secrets)) => (secrets.oauth, None),
        Ok(None) => (OAuthStore::default(), None),
        Err(error) => {
            let message = format!("{error:#}");
            remember_secrets_error(&message);
            backup_corrupt_at(path);
            (OAuthStore::default(), Some(message))
        }
    }
}

fn update_oauth_at<T>(
    path: &Path,
    f: impl FnOnce(&mut OAuthStore) -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    let _guard = credentials_lock().lock();
    let mut secrets = read_secrets_for_write_at(path)?;
    let value = f(&mut secrets.oauth)?;
    secrets.version = SECRETS_VERSION;
    save_secrets_at(path, &secrets)?;
    Ok(value)
}

/// Serialized read-modify-write of the OAuth block.
///
/// The file is reloaded **inside** the global lock, so two concurrent callers
/// (login finishing, token refresh, another IPC command) can never lose each
/// other's update. A corrupt file is never overwritten: the call fails and the
/// original bytes are preserved (plus a `.bak` copy).
pub fn update_oauth<T>(
    app: &AppHandle,
    f: impl FnOnce(&mut OAuthStore) -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    update_oauth_at(&secrets_path(app), f)
}

fn normalized_host_id(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn ensure_host_id_at(path: &Path) -> anyhow::Result<String> {
    // Fast path: never rewrite the file when the id is already persisted.
    if let Ok(Some(secrets)) = read_secrets_at(path) {
        if let Some(host_id) = normalized_host_id(secrets.oauth.host_id.as_deref()) {
            return Ok(host_id);
        }
    }
    update_oauth_at(path, |oauth| {
        if let Some(host_id) = normalized_host_id(oauth.host_id.as_deref()) {
            return Ok(host_id);
        }
        let host_id = format!("urn:uuid:{}", uuid::Uuid::new_v4());
        oauth.host_id = Some(host_id.clone());
        Ok(host_id)
    })
}

/// Stable, opaque `urn:uuid:<v4>` host id used as `ext_agent_host_id` in the
/// Sign in with ChatGPT flow. Persisted once and reused forever.
pub fn ensure_host_id(app: &AppHandle) -> anyhow::Result<String> {
    ensure_host_id_at(&secrets_path(app))
}

fn save_oauth_registration_at(
    path: &Path,
    provider_id: &str,
    mut registration: StoredOAuthRegistration,
) -> anyhow::Result<()> {
    update_oauth_at(path, |oauth| {
        if registration.ext_agent_host_id.trim().is_empty() {
            if let Some(host_id) = normalized_host_id(oauth.host_id.as_deref()) {
                registration.ext_agent_host_id = host_id;
            }
        }
        oauth.save_registration(provider_id, registration)
    })
}

/// Persists one OAuth registration and marks its `client_id` as active.
pub fn save_oauth_registration(
    app: &AppHandle,
    provider_id: &str,
    registration: StoredOAuthRegistration,
) -> anyhow::Result<()> {
    save_oauth_registration_at(&secrets_path(app), provider_id, registration)
}

fn clear_oauth_tokens_at(path: &Path, provider_id: &str) -> anyhow::Result<()> {
    update_oauth_at(path, |oauth| {
        oauth.clear_tokens(provider_id);
        Ok(())
    })
}

/// Sign-out primitive: revokes nothing (that is the OAuth module's job), only
/// clears the local tokens while retaining the account/client-id mapping.
pub fn clear_oauth_tokens(app: &AppHandle, provider_id: &str) -> anyhow::Result<()> {
    clear_oauth_tokens_at(&secrets_path(app), provider_id)
}

/// Active registration of a provider (the mapping is retained on sign-out), if
/// any. Never derives auth state; callers own that policy.
pub fn oauth_registration(app: &AppHandle, provider_id: &str) -> Option<StoredOAuthRegistration> {
    oauth_snapshot(app)
        .0
        .active_registration(provider_id)
        .cloned()
}

/// Active registration that can be used without a new login: needs a refresh
/// token and the ChatGPT plan-usage scope.
pub fn usable_oauth_registration(
    app: &AppHandle,
    provider_id: &str,
) -> Option<StoredOAuthRegistration> {
    oauth_registration(app, provider_id)
        .filter(|registration| registration.plan_usage && registration.has_refresh_token())
}

fn reset_credentials_at<T>(path: &Path, before: impl FnOnce() -> T) -> anyhow::Result<()> {
    let _guard = credentials_lock().lock();
    // Run cancellation hooks (pending OAuth login/refresh) while holding the
    // same lock writers need, so nothing can recreate credentials mid-reset.
    let _ = before();
    match std::fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if is_not_found(&error) => {}
        Err(error) => {
            return Err(error).with_context(|| format!("falha ao remover {}", path.display()))
        }
    }
    // An explicit reset is the only operation allowed to discard the preserved
    // copy of a corrupt file (it may contain credentials).
    let _ = std::fs::remove_file(path.with_extension("bak"));
    remove_stale_temp_files(path);
    clear_secrets_error();
    Ok(())
}

/// Deletes `secrets.json` (API keys **and** OAuth registrations), its `.bak`
/// copy and any stale temp file, and clears the remembered load error.
pub fn reset_credentials(app: &AppHandle) -> anyhow::Result<()> {
    reset_credentials_with(app, || ())
}

/// Same as [`reset_credentials`], but runs `before` inside the credentials RMW
/// lock (used by `reset_app_data` to cancel pending OAuth work without
/// deadlocking on the same lock).
pub fn reset_credentials_with<T>(
    app: &AppHandle,
    before: impl FnOnce() -> T,
) -> anyhow::Result<()> {
    reset_credentials_at(&secrets_path(app), before)
}

/* ------------------------------------------------------------------ */
/* Key resolution (API keys)                                           */
/* ------------------------------------------------------------------ */

/// `~/.local/share/opencode/auth.json` (`%USERPROFILE%` on Windows).
fn opencode_auth_path() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .or_else(|| {
            let drive = std::env::var_os("HOMEDRIVE")?;
            let path = std::env::var_os("HOMEPATH")?;
            let mut combined = PathBuf::from(drive);
            combined.push(path);
            Some(combined.into_os_string())
        })?;
    Some(
        PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("opencode")
            .join("auth.json"),
    )
}

/// Maps a Lumina provider id to the entry id used by the OpenCode CLI.
fn cli_entry_ids(provider_id: &str) -> &'static [&'static str] {
    match provider_id {
        "opencode-go" => &["opencode-go"],
        "opencode-zen" => &["opencode", "opencode-zen"],
        _ => &[],
    }
}

/// Environment variable each provider uses by default when the catalog did not
/// provide one (`ProviderInfo.authEnv`). The legacy shared `OPENCODE_API_KEY`
/// remains the fallback for the Go/Zen gateways.
fn default_auth_env(provider_id: &str) -> &'static str {
    match provider_id {
        "openai" => "OPENAI_API_KEY",
        "anthropic" => "ANTHROPIC_API_KEY",
        _ => "OPENCODE_API_KEY",
    }
}

fn env_key(name: &str) -> Option<String> {
    let value = std::env::var(name).ok()?;
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn clean_key(value: Option<&String>) -> Option<String> {
    value
        .map(|key| key.trim())
        .filter(|key| !key.is_empty())
        .map(str::to_string)
}

/// API key stored in `secrets.json` for this provider.
pub fn api_key_from_secrets(app: &AppHandle, provider_id: &str) -> Option<String> {
    api_key_from_secrets_file(&load_secrets(app), provider_id)
}

fn api_key_from_secrets_file(secrets: &SecretsFile, provider_id: &str) -> Option<String> {
    clean_key(secrets.providers.get(provider_id))
}

/// Provider-aware env lookup. `auth_env` comes from `ProviderInfo.authEnv`; when
/// empty the built-in default for the provider is used. The OpenCode gateways
/// keep the legacy shared `OPENCODE_API_KEY` fallback.
pub fn api_key_from_env(provider_id: &str, auth_env: &str) -> Option<String> {
    let declared = auth_env.trim();
    let name = if declared.is_empty() {
        default_auth_env(provider_id)
    } else {
        declared
    };
    if let Some(key) = env_key(name) {
        return Some(key);
    }
    if name != "OPENCODE_API_KEY" && matches!(provider_id, "opencode-go" | "opencode-zen") {
        return env_key("OPENCODE_API_KEY");
    }
    None
}

/// Key detected from the OpenCode CLI login (`auth.json`); only Go/Zen have
/// entries there, every other provider returns `None`.
pub fn api_key_from_opencode_cli(provider_id: &str) -> Option<String> {
    let path = opencode_auth_path()?;
    let raw = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    for entry_id in cli_entry_ids(provider_id) {
        let Some(entry) = value.get(*entry_id) else {
            continue;
        };
        let key = entry
            .get("key")
            .and_then(|key| key.as_str())
            .or_else(|| entry.as_str())
            .map(str::trim)
            .filter(|key| !key.is_empty());
        if let Some(key) = key {
            return Some(key.to_string());
        }
    }
    None
}

/// Resolves a key and its origin: settings | env | opencode-cli | none.
fn resolve_key(app: &AppHandle, provider_id: &str) -> (Option<String>, &'static str) {
    let secrets = load_secrets(app);
    if let Some(key) = api_key_from_secrets_file(&secrets, provider_id) {
        return (Some(key), "settings");
    }
    if let Some(key) = api_key_from_env(provider_id, default_auth_env(provider_id)) {
        return (Some(key), "env");
    }
    if let Some(key) = api_key_from_opencode_cli(provider_id) {
        return (Some(key), "opencode-cli");
    }
    (None, "none")
}

/// Reads a key from the secrets file / environment / OpenCode CLI, in that order.
pub fn api_key(app: &AppHandle, provider_id: &str) -> Option<String> {
    resolve_key(app, provider_id).0
}

fn set_api_key_at(path: &Path, provider_id: &str, key: Option<&str>) -> anyhow::Result<()> {
    let _guard = credentials_lock().lock();
    let mut secrets = read_secrets_for_write_at(path)?;
    match key.map(str::trim).filter(|key| !key.is_empty()) {
        Some(key) => {
            secrets
                .providers
                .insert(provider_id.to_string(), key.to_string());
        }
        None => {
            secrets.providers.remove(provider_id);
        }
    }
    // v1 files are silently migrated to v2; the OAuth block is preserved.
    secrets.version = SECRETS_VERSION;
    save_secrets_at(path, &secrets)
}

/// Stores/removes the API key of a provider. The OAuth block is preserved.
pub fn set_api_key(app: &AppHandle, provider_id: &str, key: Option<&str>) -> anyhow::Result<()> {
    set_api_key_at(&secrets_path(app), provider_id, key)
}

/// Masked identifier shown in the UI. Keys are never logged or returned whole.
fn mask_key(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() < 16 {
        return "••••••".to_string();
    }
    let head: String = chars[..6].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}…{tail}")
}

fn key_status_with<F>(secrets: &SecretsFile, provider_id: &str, fallback: F) -> ProviderKeyStatus
where
    F: FnOnce() -> Option<(String, &'static str)>,
{
    // Credential order (PLAN §2.4): an active OAuth registration shadows the API
    // key for status purposes. `has_key` only means "usable without network"
    // (refresh token present), never "access token valid right now" (SF-10).
    if let Some(registration) = secrets.oauth.active_registration(provider_id) {
        let has_key = registration.has_refresh_token();
        return ProviderKeyStatus {
            provider_id: provider_id.to_string(),
            has_key,
            masked: None,
            source: if has_key { "chatgpt" } else { "none" }.to_string(),
            mode: "oauth".to_string(),
        };
    }
    if let Some(key) = api_key_from_secrets_file(secrets, provider_id) {
        return ProviderKeyStatus {
            provider_id: provider_id.to_string(),
            has_key: true,
            masked: Some(mask_key(&key)),
            source: "settings".to_string(),
            mode: "api-key".to_string(),
        };
    }
    match fallback() {
        Some((key, source)) => ProviderKeyStatus {
            provider_id: provider_id.to_string(),
            has_key: true,
            masked: Some(mask_key(&key)),
            source: source.to_string(),
            mode: "api-key".to_string(),
        },
        None => ProviderKeyStatus {
            provider_id: provider_id.to_string(),
            has_key: false,
            masked: None,
            source: "none".to_string(),
            mode: "api-key".to_string(),
        },
    }
}

/// Status of the credential(s) of one provider (`has_key` = usable offline).
pub fn key_status(app: &AppHandle, provider_id: &str) -> ProviderKeyStatus {
    let secrets = load_secrets(app);
    key_status_with(&secrets, provider_id, || {
        api_key_from_env(provider_id, default_auth_env(provider_id))
            .map(|key| (key, "env"))
            .or_else(|| api_key_from_opencode_cli(provider_id).map(|key| (key, "opencode-cli")))
    })
}

pub fn all_key_status(app: &AppHandle, providers: &[String]) -> Vec<ProviderKeyStatus> {
    providers.iter().map(|p| key_status(app, p)).collect()
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("lumina-config-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).expect("criar pasta temporária");
            Self { path }
        }

        fn secrets(&self) -> PathBuf {
            self.path.join("secrets.json")
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    /// Serializes the tests that mutate/observe the process-wide `secrets_error`
    /// slot and starts each one from a clean slot. Without this, a parallel test
    /// that calls `reset_credentials_at` (which clears the slot) can clear it
    /// between a corrupt-read `remember_secrets_error` and its assertion.
    fn error_slot_guard() -> parking_lot::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        let guard = LOCK.get_or_init(|| Mutex::new(())).lock();
        clear_secrets_error();
        guard
    }

    fn registration(client_id: &str) -> StoredOAuthRegistration {
        StoredOAuthRegistration {
            email: Some("user@example.com".to_string()),
            issuer: "https://auth.openai.com".to_string(),
            subject: "subject-123".to_string(),
            client_id: client_id.to_string(),
            ext_agent_host_id: "urn:uuid:11111111-2222-3333-4444-555555555555".to_string(),
            id_token: "id-token-secret".to_string(),
            access_token: "access-token-secret".to_string(),
            refresh_token: "refresh-token-secret".to_string(),
            token_type: "Bearer".to_string(),
            expires_in: 3600,
            scopes: vec![
                "openid".to_string(),
                "chatgpt.tokens.use.direct".to_string(),
            ],
            saved_at: 1_700_000_000_000,
            earliest_refresh_at: Some("2026-01-01T00:00:00Z".to_string()),
            plan_usage: true,
            disconnected: false,
        }
    }

    #[test]
    fn masks_keys_without_revealing_them() {
        let key = "sk-opencode-1234567890abcdef";
        let masked = mask_key(key);
        assert!(masked.starts_with("sk-ope"));
        assert!(masked.ends_with("cdef"));
        assert!(!masked.contains("1234567890"));
        assert_eq!(mask_key("short"), "••••••");
    }

    #[test]
    fn v1_secrets_file_loads_and_migrates_to_v2() {
        let temp = TempDir::new();
        let path = temp.secrets();
        std::fs::write(&path, r#"{"providers":{"opencode-go":"sk-go-123"}}"#).expect("gravar v1");

        let file = read_secrets_at(&path)
            .expect("v1 deve desserializar")
            .expect("arquivo existe");
        assert_eq!(file.version, SECRETS_VERSION);
        assert_eq!(
            file.providers.get("opencode-go").map(String::as_str),
            Some("sk-go-123")
        );
        assert!(file.oauth.active.is_empty());
        assert!(file.oauth.registrations.is_empty());

        update_oauth_at(&path, |oauth| {
            oauth.host_id = Some("urn:uuid:migrated".to_string());
            Ok(())
        })
        .expect("migrar para v2");

        let raw = std::fs::read_to_string(&path).expect("ler arquivo migrado");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("JSON válido");
        assert_eq!(value["version"].as_u64(), Some(u64::from(SECRETS_VERSION)));
        assert_eq!(value["providers"]["opencode-go"], "sk-go-123");
        assert_eq!(value["oauth"]["hostId"], "urn:uuid:migrated");
    }

    #[test]
    fn empty_secrets_file_uses_v2_defaults() {
        let secrets: SecretsFile = serde_json::from_str("{}").expect("{ } é válido");
        assert_eq!(secrets.version, SECRETS_VERSION);
        assert!(secrets.providers.is_empty());
        assert!(secrets.oauth.host_id.is_none());
    }

    #[test]
    fn concurrent_rmw_does_not_lose_updates() {
        let temp = TempDir::new();
        let path = std::sync::Arc::new(temp.secrets());
        std::fs::write(path.as_path(), r#"{"providers":{"opencode-go":"sk-go"}}"#)
            .expect("gravar semente");

        std::thread::scope(|scope| {
            for worker in 0..2 {
                let path = std::sync::Arc::clone(&path);
                scope.spawn(move || {
                    for turn in 0..10 {
                        update_oauth_at(path.as_path(), |oauth| {
                            let client_id = format!("client-{worker}-{turn}");
                            let mut entry = registration(&client_id);
                            entry.client_id = client_id.clone();
                            oauth
                                .registrations
                                .entry("openai".to_string())
                                .or_default()
                                .insert(client_id, entry);
                            Ok(())
                        })
                        .expect("RMW concorrente");
                    }
                });
            }
        });

        let file = read_secrets_at(path.as_path())
            .expect("ler credenciais")
            .expect("arquivo existe");
        let registrations = file
            .oauth
            .registrations
            .get("openai")
            .expect("provedor openai presente");
        assert_eq!(
            registrations.len(),
            20,
            "atualização perdida entre threads: {registrations:?}"
        );
        assert_eq!(
            file.providers.get("opencode-go").map(String::as_str),
            Some("sk-go")
        );
    }

    #[test]
    fn corrupt_file_is_preserved_and_backed_up() {
        let _guard = error_slot_guard();
        let temp = TempDir::new();
        let path = temp.secrets();
        let original = "{ isto não é json";
        std::fs::write(&path, original).expect("gravar corrompido");

        assert!(read_secrets_at(&path).is_err());
        let error = update_oauth_at(&path, |_| Ok(())).expect_err("gravação deve ser recusada");
        assert!(format!("{error:#}").contains("corrompid"));
        assert_eq!(
            std::fs::read_to_string(&path).expect("original preservado"),
            original
        );
        let backup = path.with_extension("bak");
        assert_eq!(
            std::fs::read_to_string(&backup).expect(".bak criado"),
            original
        );
        // The remembered error feeds `SettingsView.secretsError`.
        assert!(secrets_error().is_some());

        // A second attempt does not overwrite the preserved .bak either.
        let _ = update_oauth_at(&path, |_| Ok(()));
        assert_eq!(
            std::fs::read_to_string(&backup).expect(".bak preservado"),
            original
        );

        // An explicit reset is the only path that discards both files.
        reset_credentials_at(&path, || ()).expect("reset");
        assert!(!path.exists());
        assert!(!backup.exists());
        assert!(secrets_error().is_none());
    }

    #[test]
    fn atomic_write_leaves_no_temp_files() {
        let temp = TempDir::new();
        let path = temp.secrets();
        save_oauth_registration_at(&path, "openai", registration("oaiapp_1"))
            .expect("gravar registro");

        let entries = std::fs::read_dir(&temp.path)
            .expect("listar pasta")
            .map(|entry| {
                entry
                    .expect("entrada")
                    .file_name()
                    .to_string_lossy()
                    .to_string()
            })
            .collect::<Vec<_>>();
        assert!(
            !entries.iter().any(|name| name.ends_with(".tmp")),
            "sobrou arquivo temporário: {entries:?}"
        );
        assert!(entries.iter().any(|name| name == "secrets.json"));
    }

    #[test]
    fn reset_removes_stale_temp_files() {
        // Reset clears the global error slot: serialize with the tests that
        // observe it (see `error_slot_guard`).
        let _guard = error_slot_guard();
        let temp = TempDir::new();
        let path = temp.secrets();
        let stale = path.with_file_name(format!("secrets.json.{}.tmp", uuid::Uuid::new_v4()));
        std::fs::write(&stale, "resto-de-escrita").expect("gravar tmp antigo");

        reset_credentials_at(&path, || ()).expect("reset");
        assert!(!stale.exists(), "tmp órfão deve ser removido no reset");
    }

    #[test]
    fn sign_out_keeps_mapping_and_clears_tokens() {
        let temp = TempDir::new();
        let path = temp.secrets();
        save_oauth_registration_at(&path, "openai", registration("oaiapp_1"))
            .expect("salvar login");

        clear_oauth_tokens_at(&path, "openai").expect("sign-out");

        let secrets = read_secrets_at(&path)
            .expect("ler credenciais")
            .expect("arquivo existe");
        assert_eq!(
            secrets.oauth.active.get("openai").map(String::as_str),
            Some("oaiapp_1")
        );
        let registration = secrets
            .oauth
            .active_registration("openai")
            .expect("mapping retido");
        assert!(registration.access_token.is_empty());
        assert!(registration.refresh_token.is_empty());
        assert!(registration.id_token.is_empty());
        assert!(registration.disconnected);
        // The mapping needed by the next login is retained.
        assert_eq!(registration.client_id, "oaiapp_1");
        assert_eq!(registration.email.as_deref(), Some("user@example.com"));
        assert_eq!(registration.subject, "subject-123");
        assert_eq!(registration.issuer, "https://auth.openai.com");
        assert!(!registration.ext_agent_host_id.is_empty());
    }

    #[test]
    fn set_api_key_preserves_oauth_and_update_oauth_preserves_providers() {
        let temp = TempDir::new();
        let path = temp.secrets();

        save_oauth_registration_at(&path, "openai", registration("oaiapp_1"))
            .expect("salvar login");
        set_api_key_at(&path, "openai", Some("sk-openai-1234567890abcdef"))
            .expect("salvar API key");
        update_oauth_at(&path, |oauth| {
            assert_eq!(oauth.host_id, None, "ensure_host_id ainda não rodou");
            oauth.host_id = Some("urn:uuid:host".to_string());
            Ok(())
        })
        .expect("atualizar oauth");

        let secrets = read_secrets_at(&path)
            .expect("ler credenciais")
            .expect("arquivo existe");
        assert_eq!(
            secrets.providers.get("openai").map(String::as_str),
            Some("sk-openai-1234567890abcdef")
        );
        assert_eq!(secrets.oauth.host_id.as_deref(), Some("urn:uuid:host"));
        let registration = secrets
            .oauth
            .active_registration("openai")
            .expect("registro preservado");
        assert_eq!(registration.refresh_token, "refresh-token-secret");

        // Removing the API key must not touch the OAuth block either.
        set_api_key_at(&path, "openai", None).expect("remover API key");
        let secrets = read_secrets_at(&path)
            .expect("ler credenciais")
            .expect("arquivo existe");
        assert!(!secrets.providers.contains_key("openai"));
        assert!(secrets.oauth.active_registration("openai").is_some());
    }

    #[test]
    fn host_id_is_stable_and_well_formed() {
        let temp = TempDir::new();
        let path = temp.secrets();

        let first = ensure_host_id_at(&path).expect("gerar host id");
        let second = ensure_host_id_at(&path).expect("reusar host id");
        assert_eq!(first, second);
        let suffix = first.strip_prefix("urn:uuid:").expect("prefixo urn:uuid:");
        assert!(
            uuid::Uuid::parse_str(suffix).is_ok(),
            "host id não é uuid v4"
        );

        // A normal credential write must not rotate the host id.
        set_api_key_at(&path, "opencode-go", Some("sk-go-1234567890abcdef")).expect("chave");
        let after = ensure_host_id_at(&path).expect("host id após escrita");
        assert_eq!(after, first);
    }

    #[test]
    fn oauth_snapshot_reports_corruption_without_overwriting() {
        let _guard = error_slot_guard();
        let temp = TempDir::new();
        let path = temp.secrets();
        std::fs::write(&path, "corrompido").expect("gravar corrompido");

        let (store, error) = oauth_snapshot_at(&path);
        assert!(error.is_some());
        assert!(store.host_id.is_none());
        assert!(path.with_extension("bak").exists());
        assert_eq!(
            std::fs::read_to_string(&path).expect("original"),
            "corrompido"
        );
        assert!(secrets_error().is_some());
    }

    #[test]
    fn credential_debug_output_redacts_tokens() {
        let registration = registration("oaiapp_1");
        let debug = format!("{registration:?}");
        for secret in [
            "id-token-secret",
            "access-token-secret",
            "refresh-token-secret",
        ] {
            assert!(!debug.contains(secret), "token vazou no Debug: {debug}");
        }

        let mut secrets = SecretsFile::default();
        secrets
            .providers
            .insert("openai".to_string(), "sk-super-secret".to_string());
        secrets
            .oauth
            .save_registration("openai", registration)
            .expect("registro");
        let debug = format!("{secrets:?}");
        assert!(!debug.contains("sk-super-secret"));
        assert!(!debug.contains("refresh-token-secret"));
    }

    #[test]
    fn registration_serializes_camel_case_and_defaults() {
        let registration = registration("oaiapp_1");
        let value = serde_json::to_value(&registration).expect("serializar registro");
        assert_eq!(value["clientId"], "oaiapp_1");
        assert_eq!(
            value["extAgentHostId"],
            "urn:uuid:11111111-2222-3333-4444-555555555555"
        );
        assert_eq!(value["expiresIn"], 3600);
        assert_eq!(value["savedAt"], 1_700_000_000_000_i64);
        assert_eq!(value["planUsage"], true);
        assert_eq!(value["disconnected"], false);

        let minimal: StoredOAuthRegistration =
            serde_json::from_str(r#"{"clientId":"c1"}"#).expect("campos ausentes usam default");
        assert_eq!(minimal.client_id, "c1");
        assert_eq!(minimal.token_type, "Bearer");
        assert_eq!(minimal.expires_in, 0);
        assert!(!minimal.plan_usage);
        assert!(minimal.expires_at_ms().is_none());
        assert_eq!(registration.expires_at_ms(), Some(1_700_003_600_000));
    }

    #[test]
    fn key_status_prefers_oauth_and_reports_mode() {
        let mut secrets = SecretsFile::default();
        secrets.providers.insert(
            "openai".to_string(),
            "sk-openai-1234567890abcdef".to_string(),
        );

        // API key only.
        let status = key_status_with(&secrets, "openai", || None);
        assert!(status.has_key);
        assert_eq!(status.source, "settings");
        assert_eq!(status.mode, "api-key");
        assert!(status.masked.is_some());

        // OAuth registration shadows the API key; `masked` is never a token.
        secrets
            .oauth
            .save_registration("openai", registration("oaiapp_1"))
            .expect("registro");
        let status = key_status_with(&secrets, "openai", || Some(("sk-env".to_string(), "env")));
        assert!(status.has_key);
        assert_eq!(status.source, "chatgpt");
        assert_eq!(status.mode, "oauth");
        assert!(status.masked.is_none());

        // Sign-out keeps the mapping but is not a usable credential anymore.
        secrets.oauth.clear_tokens("openai");
        let status = key_status_with(&secrets, "openai", || None);
        assert!(!status.has_key);
        assert_eq!(status.source, "none");
        assert_eq!(status.mode, "oauth");

        // Env/CLI fallback is reported for non-OAuth providers.
        let status = key_status_with(&secrets, "opencode-go", || {
            Some(("sk-opencode-1234567890abcdef".to_string(), "env"))
        });
        assert!(status.has_key);
        assert_eq!(status.source, "env");
        assert_eq!(status.mode, "api-key");
    }

    #[test]
    fn provider_env_keys_are_provider_aware() {
        assert_eq!(default_auth_env("openai"), "OPENAI_API_KEY");
        assert_eq!(default_auth_env("anthropic"), "ANTHROPIC_API_KEY");
        assert_eq!(default_auth_env("opencode-go"), "OPENCODE_API_KEY");
        assert_eq!(default_auth_env("opencode-zen"), "OPENCODE_API_KEY");

        let name = "LUMINA_TEST_OPENAI_ENV_9F3C";
        std::env::set_var(name, "  sk-test-openai  ");
        assert_eq!(
            api_key_from_env("openai", name).as_deref(),
            Some("sk-test-openai")
        );
        std::env::remove_var(name);
        assert_eq!(api_key_from_env("openai", name), None);
        // Empty auth_env falls back to the built-in provider default (which is
        // not the bogus test variable); it must not panic and must not read the
        // OpenCode variable for OpenAI.
        assert_eq!(api_key_from_env("openai", ""), None);

        // The direct Anthropic provider has its own env var; it must never fall
        // back to the shared OpenCode key.
        let name = "LUMINA_TEST_ANTHROPIC_ENV_4A1B";
        std::env::set_var(name, "  sk-ant-test-anthropic  ");
        assert_eq!(
            api_key_from_env("anthropic", name).as_deref(),
            Some("sk-ant-test-anthropic")
        );
        std::env::remove_var(name);
        assert_eq!(api_key_from_env("anthropic", name), None);
    }

    #[test]
    fn opencode_cli_detection_is_scoped_to_the_gateways() {
        assert_eq!(cli_entry_ids("opencode-go"), &["opencode-go"]);
        assert_eq!(cli_entry_ids("opencode-zen"), &["opencode", "opencode-zen"]);
        assert!(cli_entry_ids("openai").is_empty());
        assert!(cli_entry_ids("algum-provedor").is_empty());
    }

    #[test]
    fn reset_credentials_does_not_recreate_the_file() {
        // Reset clears the global error slot (asserted below): serialize with
        // the tests that observe it.
        let _guard = error_slot_guard();
        let temp = TempDir::new();
        let path = temp.secrets();
        save_oauth_registration_at(&path, "openai", registration("oaiapp_1"))
            .expect("salvar login");
        remember_secrets_error("erro antigo de credenciais");
        assert!(secrets_error().is_some());

        let mut called = false;
        reset_credentials_at(&path, || {
            called = true;
        })
        .expect("reset");
        assert!(called, "hook de cancelamento precisa rodar sob o lock");
        assert!(!path.exists());
        assert!(
            secrets_error().is_none(),
            "reset explícito deve limpar o erro lembrado"
        );
    }

    #[cfg(unix)]
    #[test]
    fn credentials_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let temp = TempDir::new();
        let path = temp.secrets();
        save_oauth_registration_at(&path, "openai", registration("oaiapp_1"))
            .expect("gravar credenciais");
        let mode = std::fs::metadata(&path)
            .expect("metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn defaults_to_64_steps() {
        assert_eq!(
            Settings::default().max_steps,
            crate::domain::MAX_STEPS_DEFAULT
        );
        assert_eq!(Settings::default().max_steps, 64);
    }

    #[test]
    fn normalizes_out_of_range_settings() {
        let settings = Settings {
            max_steps: 5_000,
            font_scale: 4.0,
            theme: "neon".into(),
            locale: "xx".into(),
            send_key: "space".into(),
            reasoning_default: "turbo".into(),
            default_provider: "  ".into(),
            default_model: String::new(),
            temperature: Some(9.0),
            code_execution_enabled: true,
            code_timeout_secs: 5_000,
            code_python_path: "  C:\\Python313\\python.exe  ".into(),
            code_node_path: "   ".into(),
            skills_panel_enabled: false,
            thinking_collapsed_by_default: true,
            disabled_skills: vec!["  zeta ".into(), "pdf".into(), "pdf".into(), String::new()],
            ..Settings::default()
        };
        let normalized = normalize_settings(settings);
        assert_eq!(normalized.max_steps, MAX_STEPS_LIMIT);
        assert_eq!(normalized.font_scale, 1.3);
        assert_eq!(normalized.theme, "system");
        assert_eq!(normalized.locale, "pt-BR");
        assert_eq!(normalized.send_key, "enter");
        assert_eq!(normalized.reasoning_default, "max");
        assert_eq!(normalized.default_provider, "opencode-go");
        assert_eq!(normalized.default_model, "deepseek-v4.1-flash");
        assert_eq!(normalized.temperature, Some(2.0));
        assert!(normalized.code_execution_enabled);
        assert_eq!(normalized.code_timeout_secs, CODE_TIMEOUT_MAX_SECS);
        assert_eq!(normalized.code_python_path, "C:\\Python313\\python.exe");
        assert_eq!(normalized.code_node_path, "");
        assert!(!normalized.skills_panel_enabled);
        // Booleano de preferência não passa por "normalização": preserva o true.
        assert!(normalized.thinking_collapsed_by_default);
        assert_eq!(normalized.disabled_skills, vec!["pdf", "zeta"]);
    }

    #[test]
    fn normalizes_low_out_of_range_settings() {
        let settings = Settings {
            max_steps: 0,
            font_scale: 0.1,
            code_timeout_secs: 1,
            ..Settings::default()
        };
        let normalized = normalize_settings(settings);
        assert_eq!(normalized.max_steps, 1);
        assert_eq!(normalized.font_scale, 0.85);
        assert_eq!(normalized.code_timeout_secs, CODE_TIMEOUT_MIN_SECS);
    }

    #[test]
    fn code_settings_default_to_safe_values() {
        let defaults = Settings::default();
        // Execução de código é opt-in: default desligado.
        assert!(!defaults.code_execution_enabled);
        assert_eq!(defaults.code_timeout_secs, 120);
        // Vazio significa auto-detecção do interpretador no PATH.
        assert!(defaults.code_python_path.is_empty());
        assert!(defaults.code_node_path.is_empty());
    }

    #[test]
    fn legacy_settings_file_without_code_fields_uses_defaults() {
        // `settings.json` antigo, de antes dos campos de execução de código.
        let raw = r#"{"theme":"dark","maxSteps":10,"webSearchEnabled":false}"#;
        let parsed: Settings = serde_json::from_str(raw).expect("desserializar settings antigos");
        let normalized = normalize_settings(parsed);
        assert_eq!(normalized.theme, "dark");
        assert_eq!(normalized.max_steps, 10);
        assert!(!normalized.web_search_enabled);
        assert!(!normalized.code_execution_enabled);
        assert_eq!(normalized.code_timeout_secs, 120);
        assert_eq!(normalized.code_python_path, "");
        assert_eq!(normalized.code_node_path, "");
        // Campo novo (raciocínio recolhido) ausente no arquivo antigo: default
        // false, então o bloco continua abrindo durante o streaming.
        assert!(!normalized.thinking_collapsed_by_default);
    }

    #[test]
    fn skill_settings_default_to_safe_values() {
        let defaults = Settings::default();
        // O item "Skills" da sidebar aparece por padrão.
        assert!(defaults.skills_panel_enabled);
        assert!(defaults.disabled_skills.is_empty());
    }

    #[test]
    fn thinking_settings_default_to_safe_values() {
        // Default: o bloco de raciocínio/passos abre durante o streaming.
        assert!(!Settings::default().thinking_collapsed_by_default);
    }

    #[test]
    fn thinking_setting_round_trips_with_camel_case_key() {
        // Contrato IPC com o renderer: chave camelCase e booleano sem transformação.
        let parsed: Settings = serde_json::from_str(r#"{"thinkingCollapsedByDefault":true}"#)
            .expect("desserializar settings do renderer");
        assert!(parsed.thinking_collapsed_by_default);

        // normalize_settings não altera o booleano.
        let normalized = normalize_settings(parsed);
        assert!(normalized.thinking_collapsed_by_default);

        // save_settings serializa com o nome camelCase consumido pelo renderer.
        let value = serde_json::to_value(&normalized).expect("serializar settings");
        assert_eq!(value["thinkingCollapsedByDefault"], true);
        assert!(value.get("thinking_collapsed_by_default").is_none());

        // load_settings relê o mesmo valor gravado.
        let reparsed: Settings =
            serde_json::from_value(value).expect("reler settings serializados");
        assert!(reparsed.thinking_collapsed_by_default);
    }

    #[test]
    fn normalizes_disabled_skills_list() {
        let settings = Settings {
            disabled_skills: vec![
                " zeta".into(),
                "alfa".into(),
                "alfa ".into(),
                String::new(),
                "   ".into(),
            ],
            ..Settings::default()
        };
        let normalized = normalize_settings(settings);
        assert_eq!(normalized.disabled_skills, vec!["alfa", "zeta"]);
        // Sem transformação: o switch do painel é preservado.
        assert!(normalized.skills_panel_enabled);
    }

    #[test]
    fn legacy_settings_file_without_skill_fields_uses_defaults() {
        // `settings.json` antigo, de antes da gestão de skills.
        let raw = r#"{"theme":"light","codeExecutionEnabled":true}"#;
        let parsed: Settings = serde_json::from_str(raw).expect("desserializar settings antigos");
        let normalized = normalize_settings(parsed);
        assert!(normalized.skills_panel_enabled);
        assert!(normalized.disabled_skills.is_empty());
        assert!(normalized.code_execution_enabled);
    }

    #[test]
    fn code_timeout_accepts_boundaries() {
        let settings = Settings {
            code_timeout_secs: CODE_TIMEOUT_MIN_SECS,
            ..Settings::default()
        };
        assert_eq!(
            normalize_settings(settings).code_timeout_secs,
            CODE_TIMEOUT_MIN_SECS
        );
        let settings = Settings {
            code_timeout_secs: CODE_TIMEOUT_MAX_SECS,
            ..Settings::default()
        };
        assert_eq!(
            normalize_settings(settings).code_timeout_secs,
            CODE_TIMEOUT_MAX_SECS
        );
    }
}
