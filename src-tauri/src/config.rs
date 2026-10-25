//! Application settings + provider API keys.
//!
//! Settings live in `<app-data>/settings.json`; keys live in
//! `<app-data>/secrets.json` (never sent to the renderer in plain text).
//! As a convenience the backend also detects keys from the OpenCode CLI
//! (`~/.local/share/opencode/auth.json`) and from `OPENCODE_API_KEY`.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::Context;
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
    settings.disabled_skills = normalize_disabled_skills(std::mem::take(&mut settings.disabled_skills));
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
/* Secrets                                                             */
/* ------------------------------------------------------------------ */

/// `<app-data>/secrets.json` shape:
/// `{"providers":{"opencode-go":"sk-...","opencode-zen":"sk-..."}}`
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SecretsFile {
    #[serde(default)]
    providers: BTreeMap<String, String>,
}

fn load_secrets(app: &AppHandle) -> SecretsFile {
    match std::fs::read_to_string(secrets_path(app)) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => SecretsFile::default(),
    }
}

fn save_secrets(app: &AppHandle, secrets: &SecretsFile) -> anyhow::Result<()> {
    let raw =
        serde_json::to_string_pretty(secrets).context("falha ao serializar as chaves de API")?;
    write_private(&secrets_path(app), &raw)
}

/// Writes a file atomically and, where the platform supports it, with
/// owner-only permissions. On Windows `%APPDATA%` is already ACL-restricted to
/// the current user, so the default ACL is kept.
fn write_private(path: &Path, contents: &str) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("falha ao criar {}", parent.display()))?;
        }
    }
    let tmp = path.with_extension("tmp");
    {
        let mut file = std::fs::File::create(&tmp)
            .with_context(|| format!("falha ao escrever {}", tmp.display()))?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    if std::fs::rename(&tmp, path).is_err() {
        // Same-volume rename is atomic on both Windows and Unix; the fallback
        // only exists for exotic filesystems.
        std::fs::write(path, contents)
            .with_context(|| format!("falha ao gravar {}", path.display()))?;
        let _ = std::fs::remove_file(&tmp);
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Key resolution                                                      */
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

fn key_from_opencode_cli(provider_id: &str) -> Option<String> {
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

fn key_from_env(_provider_id: &str) -> Option<String> {
    // A single `OPENCODE_API_KEY` is shared by the Go and Zen gateways.
    let value = std::env::var("OPENCODE_API_KEY").ok()?;
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

/// Resolves a key and its origin: settings | env | opencode-cli | none.
fn resolve_key(app: &AppHandle, provider_id: &str) -> (Option<String>, &'static str) {
    if let Some(key) = load_secrets(app)
        .providers
        .get(provider_id)
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
    {
        return (Some(key), "settings");
    }
    if let Some(key) = key_from_env(provider_id) {
        return (Some(key), "env");
    }
    if let Some(key) = key_from_opencode_cli(provider_id) {
        return (Some(key), "opencode-cli");
    }
    (None, "none")
}

/// Reads a key from the secrets file / environment / OpenCode CLI, in that order.
pub fn api_key(app: &AppHandle, provider_id: &str) -> Option<String> {
    resolve_key(app, provider_id).0
}

pub fn set_api_key(app: &AppHandle, provider_id: &str, key: Option<&str>) -> anyhow::Result<()> {
    let mut secrets = load_secrets(app);
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
    save_secrets(app, &secrets)
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

pub fn key_status(app: &AppHandle, provider_id: &str) -> ProviderKeyStatus {
    let (key, source) = resolve_key(app, provider_id);
    match key {
        Some(key) => ProviderKeyStatus {
            provider_id: provider_id.to_string(),
            has_key: true,
            masked: Some(mask_key(&key)),
            source: source.to_string(),
        },
        None => ProviderKeyStatus {
            provider_id: provider_id.to_string(),
            has_key: false,
            masked: None,
            source: "none".to_string(),
        },
    }
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
    fn defaults_to_64_steps() {
        assert_eq!(Settings::default().max_steps, crate::domain::MAX_STEPS_DEFAULT);
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
            disabled_skills: vec![
                "  zeta ".into(),
                "pdf".into(),
                "pdf".into(),
                String::new(),
            ],
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
    }

    #[test]
    fn skill_settings_default_to_safe_values() {
        let defaults = Settings::default();
        // O item "Skills" da sidebar aparece por padrão.
        assert!(defaults.skills_panel_enabled);
        assert!(defaults.disabled_skills.is_empty());
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
