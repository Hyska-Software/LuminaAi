//! Model catalog surface for the UI.

use tauri::{AppHandle, State};

use crate::config;
use crate::domain::CatalogView;
use crate::state::AppState;

fn catalog_view(app: &AppHandle, state: &AppState) -> CatalogView {
    let provider_ids: Vec<String> = state
        .catalog
        .providers
        .iter()
        .map(|p| p.id.clone())
        .collect();
    CatalogView {
        catalog: state.catalog.clone(),
        keys: config::all_key_status(app, &provider_ids),
        remote_refreshed_at: None,
    }
}

#[tauri::command]
pub fn get_catalog(app: AppHandle, state: State<'_, AppState>) -> CatalogView {
    catalog_view(&app, &state)
}

/// Fetches the live model list from the gateway and reports ids that are not in
/// the bundled catalog (informational only — the bundled catalog stays the
/// source of truth for wire protocols and capabilities).
#[tauri::command]
pub async fn refresh_catalog(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CatalogView, String> {
    let mut view = catalog_view(&app, &state);
    let mut any = false;
    for provider in &state.catalog.providers {
        if config::api_key(&app, &provider.id).is_none() {
            continue;
        }
        let base = provider.base_url.trim_end_matches('/');
        let url = format!("{base}/v1/models");
        let key = config::api_key(&app, &provider.id).unwrap_or_default();
        let req = state
            .http
            .get(url)
            .header("Authorization", format!("Bearer {key}"))
            .header("User-Agent", concat!("Lumina/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(20));
        if let Ok(resp) = req.send().await {
            if resp.status().is_success() {
                any = true;
            }
        }
    }
    if any {
        view.remote_refreshed_at = Some(crate::domain::now_ms());
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
        .ok_or_else(|| format!("provedor desconhecido: {provider_id}"))?;
    let key = config::api_key(&app, &provider_id)
        .ok_or_else(|| "nenhuma API key configurada para este provedor".to_string())?;
    let url = format!("{}/v1/models", provider.base_url.trim_end_matches('/'));
    let resp = state
        .http
        .get(url)
        .header("Authorization", format!("Bearer {key}"))
        .header("User-Agent", concat!("Lumina/", env!("CARGO_PKG_VERSION")))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("gateway respondeu {}", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let ids = json
        .get("data")
        .and_then(|d| d.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(|id| id.as_str()).map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(ids)
}
