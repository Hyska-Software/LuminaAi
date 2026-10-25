//! Settings, API keys, app info and code environment/skills commands
//! (implemented by the storage module).

use std::path::Path;
use std::time::Duration;

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::config;
use crate::domain::{
    AppInfo, CodeEnvironmentStatus, ProviderValidation, Settings, SettingsView,
};
use crate::state::AppState;

fn to_error(error: impl std::fmt::Display) -> String {
    format!("{error:#}")
}

fn settings_view(app: &AppHandle, state: &AppState) -> SettingsView {
    let provider_ids: Vec<String> = state
        .catalog
        .providers
        .iter()
        .map(|provider| provider.id.clone())
        .collect();
    SettingsView {
        settings: config::load_settings(app),
        keys: config::all_key_status(app, &provider_ids),
    }
}

/* ------------------------------------------------------------------ */
/* Settings + keys                                                     */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub fn get_settings(app: AppHandle, state: State<'_, AppState>) -> Result<SettingsView, String> {
    Ok(settings_view(&app, &state))
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<SettingsView, String> {
    config::save_settings(&app, &settings).map_err(to_error)?;
    Ok(settings_view(&app, &state))
}

#[tauri::command]
pub fn set_provider_key(
    app: AppHandle,
    state: State<'_, AppState>,
    provider_id: String,
    key: Option<String>,
) -> Result<SettingsView, String> {
    if state.catalog.provider(&provider_id).is_none() {
        return Err(format!("provedor desconhecido: {provider_id}"));
    }
    let key = key
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty());
    if let Some(key) = key.as_deref() {
        let length = key.chars().count();
        if length < 20 {
            return Err(format!(
                "a chave informada parece inválida ({length} caracteres; esperado pelo menos 20). \
                 Copie a API key completa do OpenCode Console."
            ));
        }
        if key.chars().any(char::is_whitespace) {
            return Err("a API key não pode conter espaços ou quebras de linha".to_string());
        }
    }
    config::set_api_key(&app, &provider_id, key.as_deref()).map_err(to_error)?;
    Ok(settings_view(&app, &state))
}

/* ------------------------------------------------------------------ */
/* App info                                                            */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub fn app_info(app: AppHandle, state: State<'_, AppState>) -> Result<AppInfo, String> {
    let _ = &app;
    Ok(AppInfo {
        name: "Lumina".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        tauri_version: tauri::VERSION.to_string(),
        platform: std::env::consts::OS.to_string(),
        started_at: state.started_at,
        data_dir: state.data_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn open_data_dir(app: AppHandle) -> Result<(), String> {
    let dir = config::data_dir(&app).map_err(to_error)?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| format!("falha ao abrir a pasta de dados: {error}"))
}

/* ------------------------------------------------------------------ */
/* Code environment & skills                                           */
/* ------------------------------------------------------------------ */

/// Detects Python/Node, optional packages and available skills.
///
/// The detection spawns interpreter processes (`--version`, `find_spec`), so it
/// runs on a blocking thread instead of the async IPC executor.
#[tauri::command]
pub async fn get_code_environment(app: AppHandle) -> Result<CodeEnvironmentStatus, String> {
    let data_dir = config::data_dir(&app).map_err(to_error)?;
    let settings = config::load_settings(&app);
    tauri::async_runtime::spawn_blocking(move || {
        crate::tools::code_exec::environment_status(&data_dir, &settings)
    })
    .await
    .map_err(|error| format!("falha ao verificar o ambiente de código: {error}"))
}

/// Opens `<app-data>/skills` (the user skills folder) in the OS file manager,
/// creating it first so the folder always exists when the explorer opens.
#[tauri::command]
pub fn open_skills_dir(app: AppHandle) -> Result<(), String> {
    let dir = config::data_dir(&app).map_err(to_error)?.join("skills");
    std::fs::create_dir_all(&dir).map_err(|error| {
        format!(
            "falha ao criar a pasta de skills ({}): {error}",
            dir.display()
        )
    })?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| format!("falha ao abrir a pasta de skills: {error}"))
}

/* ------------------------------------------------------------------ */
/* Reset                                                               */
/* ------------------------------------------------------------------ */

fn clear_dir(path: &Path) -> std::io::Result<()> {
    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    for entry in entries {
        let entry = entry?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            std::fs::remove_dir_all(&entry_path)?;
        } else {
            std::fs::remove_file(&entry_path)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn reset_app_data(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // Cancela turnos em andamento antes de apagar o banco: impede que o harness
    // grave linhas obsoletas no meio do reset.
    state.cancel_all();
    state.db.reset().map_err(to_error)?;
    let data_dir = config::data_dir(&app).map_err(to_error)?;
    for sub in ["attachments", "artifacts"] {
        clear_dir(&data_dir.join(sub)).map_err(|error| {
            format!(
                "falha ao limpar a pasta {}: {error}",
                data_dir.join(sub).display()
            )
        })?;
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Provider validation                                                 */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn validate_provider(
    app: AppHandle,
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<ProviderValidation, String> {
    let base_url = state
        .catalog
        .provider(&provider_id)
        .ok_or_else(|| format!("provedor desconhecido: {provider_id}"))?
        .base_url
        .trim_end_matches('/')
        .to_string();

    let Some(key) = config::api_key(&app, &provider_id) else {
        return Ok(ProviderValidation {
            provider_id,
            ok: false,
            message: Some(
                "Nenhuma API key configurada para este provedor. Adicione uma chave em \
                 Configurações → Provedores."
                    .to_string(),
            ),
            latency_ms: None,
            models: 0,
        });
    };

    let url = format!("{base_url}/v1/models");
    let started = std::time::Instant::now();
    let response = state
        .http
        .get(&url)
        .header("Authorization", format!("Bearer {key}"))
        .header("User-Agent", concat!("Lumina/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(15))
        .send()
        .await;
    let latency_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);

    match response {
        Ok(response) if response.status().is_success() => {
            let models = response
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|json| {
                    json.get("data")
                        .and_then(|data| data.as_array())
                        .map(|models| models.len())
                })
                .unwrap_or(0);
            let models = u32::try_from(models).unwrap_or(u32::MAX);
            Ok(ProviderValidation {
                provider_id,
                ok: true,
                message: Some(format!(
                    "Conexão validada — {models} modelos disponíveis no gateway."
                )),
                latency_ms: Some(latency_ms),
                models,
            })
        }
        Ok(response) => {
            let status = response.status();
            let message = match status.as_u16() {
                401 => {
                    "API key inválida ou expirada (401). Gere uma nova chave no OpenCode Console."
                        .to_string()
                }
                402 => "Pagamento necessário (402). Verifique os créditos do OpenCode Zen ou a \
                        assinatura do OpenCode Go."
                    .to_string(),
                403 => {
                    "Acesso negado (403): esta chave não tem permissão para o provedor.".to_string()
                }
                404 => "Endpoint /v1/models não encontrado (404). A URL base do provedor pode ter \
                        mudado; atualize o catálogo."
                    .to_string(),
                429 => {
                    "Muitas requisições (429). Aguarde um instante e tente novamente.".to_string()
                }
                _ if status.is_server_error() => {
                    format!("O gateway respondeu {status}. Tente novamente mais tarde.")
                }
                _ => format!("O gateway respondeu {status}."),
            };
            Ok(ProviderValidation {
                provider_id,
                ok: false,
                message: Some(message),
                latency_ms: Some(latency_ms),
                models: 0,
            })
        }
        Err(error) => {
            let message = if error.is_timeout() {
                "Tempo esgotado ao contatar o provedor (15s).".to_string()
            } else if error.is_connect() {
                format!("Não foi possível conectar a {base_url}. Verifique a rede.")
            } else {
                format!("Falha de rede ao contatar o provedor: {error}")
            };
            Ok(ProviderValidation {
                provider_id,
                ok: false,
                message: Some(message),
                latency_ms: Some(latency_ms),
                models: 0,
            })
        }
    }
}
