//! Model catalog surface for the UI.
//!
//! The bundled catalog (`data/catalog.json`) is the source of truth for wire
//! protocols/capabilities. Providers that expose an account-specific model list
//! (OpenAI / ChatGPT plan) are refreshed through `refresh_provider_models` and
//! merged here, so the renderer, the picker and the harness see the same list.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::catalog::{ModelInfo, ProviderInfo};
use crate::config;
use crate::domain::CatalogView;
use crate::state::AppState;

const CACHE_FILE: &str = "models-cache.json";
const CACHE_VERSION: u32 = 1;

/* ------------------------------------------------------------------ */
/* Remote list                                                         */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteModel {
    pub id: String,
    pub display_name: Option<String>,
    pub visibility: Option<String>,
}

/// Parses both documented shapes: OpenAI plan usage returns
/// `{"models":[{"slug","display_name","visibility"}]}`, the platform API returns
/// `{"data":[{"id"}]}`.
pub fn parse_remote_models(document: &Value) -> Vec<RemoteModel> {
    let array = document
        .get("models")
        .and_then(Value::as_array)
        .or_else(|| document.get("data").and_then(Value::as_array));
    let Some(array) = array else {
        return Vec::new();
    };
    array
        .iter()
        .filter_map(|item| {
            let id = item
                .get("id")
                .or_else(|| item.get("slug"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|id| !id.is_empty())?
                .to_string();
            let display_name = item
                .get("display_name")
                .or_else(|| item.get("name"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_string);
            let visibility = item
                .get("visibility")
                .and_then(Value::as_str)
                .map(str::to_string);
            Some(RemoteModel {
                id,
                display_name,
                visibility,
            })
        })
        .filter(|model| model.visibility.as_deref().map_or(true, |visibility| visibility == "list"))
        .collect()
}

fn models_endpoint(provider: &ProviderInfo) -> String {
    let path = provider
        .endpoints
        .get("models")
        .map(String::as_str)
        .unwrap_or("/models");
    format!("{}{}", provider.base_url.trim_end_matches('/'), path)
}

fn api_key_for(app: &AppHandle, provider: &ProviderInfo) -> Option<String> {
    config::api_key_from_secrets(app, &provider.id)
        .or_else(|| config::api_key_from_env(&provider.id, &provider.auth_env))
        .or_else(|| config::api_key_from_opencode_cli(&provider.id))
}

/// Bearer credential for a provider: OAuth access token when the provider uses
/// the ChatGPT plan, otherwise (or as fallback) an API key.
async fn bearer_for(
    app: &AppHandle,
    state: &AppState,
    provider: &ProviderInfo,
) -> Result<String, String> {
    let mut oauth_error: Option<String> = None;
    if provider.supports_oauth() {
        match state.ensure_bearer(app, &provider.id).await {
            Ok(token) => return Ok(token),
            Err(error) => oauth_error = Some(format!("{error:#}")),
        }
    }
    if let Some(key) = api_key_for(app, provider) {
        return Ok(key);
    }
    Err(oauth_error.unwrap_or_else(|| {
        format!(
            "nenhuma credencial configurada para {} (conecte o ChatGPT ou adicione uma API key)",
            provider.name
        )
    }))
}

async fn fetch_remote_models(
    app: &AppHandle,
    state: &AppState,
    provider: &ProviderInfo,
) -> Result<Vec<RemoteModel>, String> {
    let bearer = bearer_for(app, state, provider).await?;
    let response = state
        .http
        .get(models_endpoint(provider))
        .header("Authorization", format!("Bearer {bearer}"))
        .header("User-Agent", concat!("Lumina/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(25))
        .send()
        .await
        .map_err(|error| format!("falha ao listar modelos de {}: {error}", provider.name))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "{} respondeu {status} ao listar modelos: {}",
            provider.name,
            body.chars().take(300).collect::<String>()
        ));
    }
    let document: Value = response
        .json()
        .await
        .map_err(|error| format!("resposta inválida de {}: {error}", provider.name))?;
    let models = parse_remote_models(&document);
    if models.is_empty() {
        return Err(format!(
            "{} não devolveu modelos disponíveis para esta conta",
            provider.name
        ));
    }
    Ok(models)
}

/// Conservative metadata for a model that only the account exposes.
fn estimated_model(provider: &ProviderInfo, remote: &RemoteModel) -> ModelInfo {
    let protocols = provider
        .models
        .first()
        .map(|model| model.protocols.clone())
        .unwrap_or_else(|| vec!["openai-responses".to_string()]);
    let family = if provider.id == "openai" {
        "gpt".to_string()
    } else {
        provider
            .models
            .first()
            .map(|model| model.family.clone())
            .unwrap_or_default()
    };
    ModelInfo {
        id: remote.id.clone(),
        name: remote
            .display_name
            .clone()
            .unwrap_or_else(|| remote.id.clone()),
        family,
        protocols,
        reasoning: true,
        reasoning_options: vec![crate::catalog::ReasoningOption::Effort {
            values: vec![
                "low".into(),
                "medium".into(),
                "high".into(),
                "xhigh".into(),
            ],
        }],
        attachment: true,
        modalities: crate::catalog::Modalities {
            input: vec!["text".into(), "image".into()],
            output: vec!["text".into()],
        },
        context_window: 400_000,
        max_output: 32_768,
        cost: None,
        release_date: None,
        knowledge: None,
        open_weights: false,
        description: None,
        tags: Vec::new(),
        status: "stable".into(),
        estimated: true,
    }
}

/// Merges the account list with the bundled metadata (account order wins).
pub fn merge_models(provider: &ProviderInfo, remote: &[RemoteModel]) -> Vec<ModelInfo> {
    let mut merged: Vec<ModelInfo> = remote
        .iter()
        .map(|remote_model| {
            provider
                .models
                .iter()
                .find(|model| model.id == remote_model.id)
                .cloned()
                .unwrap_or_else(|| estimated_model(provider, remote_model))
        })
        .collect();
    for model in &provider.models {
        if !merged.iter().any(|known| known.id == model.id) {
            merged.push(model.clone());
        }
    }
    merged
}

/* ------------------------------------------------------------------ */
/* Disk cache (survives restart; never contains credentials)           */
/* ------------------------------------------------------------------ */

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheEntry {
    fetched_at: i64,
    models: Vec<ModelInfo>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheFile {
    version: u32,
    #[serde(default)]
    providers: std::collections::BTreeMap<String, CacheEntry>,
}

fn cache_path(state: &AppState) -> PathBuf {
    state.data_dir.join(CACHE_FILE)
}

fn save_models_cache(app: &AppHandle, state: &AppState) -> anyhow::Result<()> {
    let mut providers = std::collections::BTreeMap::new();
    for provider in &state.catalog.providers {
        if let Some(dynamic) = state.dynamic_models_for(&provider.id) {
            providers.insert(
                provider.id.clone(),
                CacheEntry {
                    fetched_at: dynamic.fetched_at,
                    models: dynamic.models,
                },
            );
        }
    }
    let file = CacheFile {
        version: CACHE_VERSION,
        providers,
    };
    let raw = serde_json::to_string_pretty(&file)?;
    let tmp = cache_path(state).with_extension("json.tmp");
    std::fs::write(&tmp, raw)?;
    std::fs::rename(&tmp, cache_path(state))?;
    let _ = app;
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

fn refreshed_at(state: &AppState) -> Option<i64> {
    state
        .catalog
        .providers
        .iter()
        .filter_map(|provider| state.dynamic_models_for(&provider.id))
        .map(|dynamic| dynamic.fetched_at)
        .max()
}

pub fn catalog_view(app: &AppHandle, state: &AppState) -> CatalogView {
    let mut catalog = state.catalog.clone();
    for provider in &mut catalog.providers {
        provider.models = state.models(&provider.id);
    }
    let provider_ids: Vec<String> = catalog.providers.iter().map(|p| p.id.clone()).collect();
    CatalogView {
        catalog,
        keys: config::all_key_status(app, &provider_ids),
        auth: crate::oauth::statuses(app, &state.catalog),
        remote_refreshed_at: refreshed_at(state),
    }
}

#[tauri::command]
pub fn get_catalog(app: AppHandle, state: State<'_, AppState>) -> CatalogView {
    catalog_view(&app, &state)
}

/// Refreshes the account model list of one provider and returns the merged view.
pub async fn refresh_provider_models_impl(
    app: &AppHandle,
    state: &AppState,
    provider_id: &str,
) -> anyhow::Result<CatalogView> {
    let provider = state
        .catalog
        .provider(provider_id)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("provedor desconhecido: {provider_id}"))?;
    let remote = fetch_remote_models(app, state, &provider)
        .await
        .map_err(anyhow::Error::msg)?;
    let merged = merge_models(&provider, &remote);
    state.set_dynamic_models(provider_id, merged, crate::domain::now_ms());
    save_models_cache(app, state)?;
    Ok(catalog_view(app, state))
}

/// Fetches the live model list from every configured provider and reports when
/// the refresh happened (informational; the bundled metadata is preserved).
#[tauri::command]
pub async fn refresh_catalog(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CatalogView, String> {
    let providers = state.catalog.providers.clone();
    let mut refreshed = false;
    for provider in providers {
        if !provider.endpoints.contains_key("models") {
            continue;
        }
        match fetch_remote_models(&app, &state, &provider).await {
            Ok(remote) => {
                let merged = merge_models(&provider, &remote);
                state.set_dynamic_models(&provider.id, merged, crate::domain::now_ms());
                refreshed = true;
            }
            Err(error) => {
                // A missing credential is expected for unconfigured providers;
                // real failures stay visible in the provider validation UI.
                if !error.contains("nenhuma credencial") {
                    eprintln!("[catalog] {}: {error}", provider.id);
                }
            }
        }
    }
    if refreshed {
        let _ = save_models_cache(&app, &state);
    }
    let mut view = catalog_view(&app, &state);
    if !refreshed {
        view.remote_refreshed_at = refreshed_at(&state);
    }
    Ok(view)
}

#[tauri::command]
pub async fn list_remote_models(
    app: AppHandle,
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<Vec<String>, String> {
    let provider = state
        .catalog
        .provider(&provider_id)
        .cloned()
        .ok_or_else(|| format!("provedor desconhecido: {provider_id}"))?;
    let remote = fetch_remote_models(&app, &state, &provider).await?;
    Ok(remote.into_iter().map(|model| model.id).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_the_account_shape_and_filters_visibility() {
        let document = json!({
            "models": [
                {"slug": "gpt-6.1-sol", "display_name": "GPT-6.1 Sol", "visibility": "list"},
                {"slug": "gpt-internal", "display_name": "Internal", "visibility": "hidden"},
                {"slug": "gpt-minimal"}
            ]
        });
        let models = parse_remote_models(&document);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gpt-6.1-sol");
        assert_eq!(models[0].display_name.as_deref(), Some("GPT-6.1 Sol"));
        assert_eq!(models[1].id, "gpt-minimal");
    }

    #[test]
    fn parses_the_platform_api_shape() {
        let document = json!({"data": [{"id": "gpt-6-luna"}, {"id": "gpt-6-sol"}]});
        let models = parse_remote_models(&document);
        assert_eq!(
            models.iter().map(|model| model.id.as_str()).collect::<Vec<_>>(),
            vec!["gpt-6-luna", "gpt-6-sol"]
        );
    }

    #[test]
    fn merge_keeps_catalog_metadata_and_marks_unknown_models_estimated() {
        let catalog = crate::catalog::CatalogFile::load().expect("catalog");
        let provider = catalog.provider("openai").expect("openai");
        let merged = merge_models(
            provider,
            &[
                RemoteModel {
                    id: "gpt-6.1-sol".into(),
                    display_name: Some("GPT-6.1 Sol (conta)".into()),
                    visibility: None,
                },
                RemoteModel {
                    id: "gpt-6.2-future".into(),
                    display_name: Some("GPT-6.2 Future".into()),
                    visibility: None,
                },
            ],
        );
        let known = merged
            .iter()
            .find(|model| model.id == "gpt-6.1-sol")
            .expect("modelo do catálogo");
        assert!(!known.estimated);
        // Catalog metadata wins over the account display name.
        assert_eq!(known.name, "GPT-6.1 Sol");
        let unknown = merged
            .iter()
            .find(|model| model.id == "gpt-6.2-future")
            .expect("modelo da conta");
        assert!(unknown.estimated);
        assert_eq!(unknown.family, "gpt");
        assert_eq!(unknown.protocols, vec!["openai-responses".to_string()]);
        // Catalog-only models stay available as fallback.
        assert!(merged.iter().any(|model| model.id == "gpt-5.3-codex"));
    }
}
