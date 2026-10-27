//! Global application state shared by every Tauri command.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::{Mutex, RwLock};
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

use crate::catalog::{CatalogFile, ModelInfo};
use crate::db::Db;
use crate::domain::ProviderAuthStatus;
use crate::oauth::OAuthState;
use crate::policy::approval::ApprovalRegistry;

/// Account-specific model list fetched from the provider (`/v1/models`).
#[derive(Debug, Clone)]
pub struct DynamicModels {
    pub fetched_at: i64,
    pub models: Vec<ModelInfo>,
}

pub struct AppState {
    pub started_at: i64,
    pub db: Arc<Db>,
    pub catalog: CatalogFile,
    pub http: reqwest::Client,
    pub search_http: reqwest::Client,
    pub data_dir: PathBuf,
    pub oauth: Arc<OAuthState>,
    /// Aprovações interativas pendentes do harness de código (por turno).
    pub approvals: Arc<ApprovalRegistry>,
    /// Arquivos observados nesta execução (read-before-write/CAS do harness).
    pub observed: Arc<crate::harness::code::observed::ObservedFiles>,
    dynamic_models: RwLock<HashMap<String, DynamicModels>>,
    turns: Mutex<HashMap<String, CancellationToken>>,
}

impl AppState {
    pub fn init(app: &AppHandle) -> anyhow::Result<Self> {
        let data_dir = crate::config::data_dir(app)?;
        let db_path = data_dir.join("lumina.db");
        let db = Db::open(&db_path)?;
        let catalog = CatalogFile::load()?;
        let state = Self {
            started_at: crate::domain::now_ms(),
            db: Arc::new(db),
            catalog,
            http: crate::http::client(),
            search_http: crate::http::search_client(),
            data_dir,
            oauth: Arc::new(OAuthState::new()),
            approvals: Arc::new(ApprovalRegistry::new()),
            observed: Arc::new(crate::harness::code::observed::ObservedFiles::new()),
            dynamic_models: RwLock::new(HashMap::new()),
            turns: Mutex::new(HashMap::new()),
        };
        state.restore_models_cache();
        Ok(state)
    }

    /// Restores the account model lists cached by the last `refresh_provider_models`
    /// so an account-only model stays selectable after a restart (offline too).
    fn restore_models_cache(&self) {
        let path = self.data_dir.join("models-cache.json");
        let Ok(raw) = std::fs::read_to_string(&path) else {
            return;
        };
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Entry {
            fetched_at: i64,
            models: Vec<ModelInfo>,
        }
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct File {
            #[serde(default)]
            providers: HashMap<String, Entry>,
        }
        let Ok(file) = serde_json::from_str::<File>(&raw) else {
            // A corrupt cache is not user data: ignore it and refetch later.
            return;
        };
        let mut guard = self.dynamic_models.write();
        for (provider_id, entry) in file.providers {
            if self.catalog.provider(&provider_id).is_some() {
                guard.insert(
                    provider_id,
                    DynamicModels {
                        fetched_at: entry.fetched_at,
                        models: entry.models,
                    },
                );
            }
        }
    }

    /* -------------------------------------------------------------- */
    /* Dynamic models (account-specific)                              */
    /* -------------------------------------------------------------- */

    /// Replaces the account model list for a provider.
    pub fn set_dynamic_models(&self, provider_id: &str, models: Vec<ModelInfo>, fetched_at: i64) {
        self.dynamic_models.write().insert(
            provider_id.to_string(),
            DynamicModels {
                fetched_at,
                models,
            },
        );
    }

    pub fn dynamic_models_for(&self, provider_id: &str) -> Option<DynamicModels> {
        self.dynamic_models.read().get(provider_id).cloned()
    }

    pub fn clear_dynamic_models(&self) {
        self.dynamic_models.write().clear();
    }

    /// Merged list: account list first (order preserved), catalog metadata where
    /// available, conservative entries for models only the account knows.
    pub fn models(&self, provider_id: &str) -> Vec<ModelInfo> {
        let Some(provider) = self.catalog.provider(provider_id) else {
            return Vec::new();
        };
        let Some(dynamic) = self.dynamic_models_for(provider_id) else {
            return provider.models.clone();
        };
        let mut merged: Vec<ModelInfo> = dynamic
            .models
            .iter()
            .map(|remote| {
                provider
                    .models
                    .iter()
                    .find(|model| model.id == remote.id)
                    .cloned()
                    .unwrap_or_else(|| remote.clone())
            })
            .collect();
        for model in &provider.models {
            if !merged.iter().any(|known| known.id == model.id) {
                merged.push(model.clone());
            }
        }
        merged
    }

    /// Model lookup used by the harness: dynamic (account) list first, then the
    /// bundled catalog.
    pub fn model(&self, provider_id: &str, model_id: &str) -> Option<ModelInfo> {
        self.catalog
            .model(provider_id, model_id)
            .cloned()
            .or_else(|| {
                self.dynamic_models_for(provider_id)?
                    .models
                    .into_iter()
                    .find(|model| model.id == model_id)
            })
    }

    /* -------------------------------------------------------------- */
    /* Auth                                                            */
    /* -------------------------------------------------------------- */

    pub async fn ensure_bearer(
        &self,
        app: &AppHandle,
        provider_id: &str,
    ) -> anyhow::Result<String> {
        crate::oauth::ensure_bearer(app, &self.oauth, &self.catalog, &self.http, provider_id)
            .await
    }

    pub async fn force_refresh(
        &self,
        app: &AppHandle,
        provider_id: &str,
    ) -> anyhow::Result<String> {
        crate::oauth::force_refresh(app, &self.oauth, &self.catalog, &self.http, provider_id).await
    }

    pub fn cancel_oauth(&self) {
        crate::oauth::cancel_all(&self.oauth);
    }

    pub fn auth_statuses(&self, app: &AppHandle) -> Vec<ProviderAuthStatus> {
        crate::oauth::statuses(app, &self.catalog)
    }

    pub fn auth_status(&self, app: &AppHandle, provider_id: &str) -> ProviderAuthStatus {
        crate::oauth::status(app, provider_id)
    }

    /* -------------------------------------------------------------- */
    /* Turns                                                           */
    /* -------------------------------------------------------------- */

    pub fn register_turn(&self, turn_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        self.turns.lock().insert(turn_id.to_string(), token.clone());
        token
    }

    pub fn finish_turn(&self, turn_id: &str) {
        self.turns.lock().remove(turn_id);
    }

    /// Cancel a running turn; returns true when a turn was found.
    pub fn cancel_turn(&self, turn_id: &str) -> bool {
        match self.turns.lock().get(turn_id) {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }

    pub fn cancel_all(&self) {
        for token in self.turns.lock().values() {
            token.cancel();
        }
    }
}

/// Ensure transient directories exist.
pub fn ensure_dirs(app: &AppHandle) -> anyhow::Result<()> {
    // `skills-bundled` não entra aqui: o módulo de skills o materializa (e
    // regrava) a cada inicialização; `skills` é a pasta do usuário.
    for sub in [
        "attachments",
        "artifacts",
        "logs",
        "code-runs",
        "skills",
        // Harness de código: checkpoints (journal) e spill de saídas longas.
        "checkpoints",
        "spill",
    ] {
        let dir = crate::config::data_dir(app)?.join(sub);
        std::fs::create_dir_all(dir)?;
    }
    let _ = app.package_info();
    Ok(())
}
