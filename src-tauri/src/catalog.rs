//! Bundled model catalog (`data/catalog.json`) plus lookups.
//!
//! The catalog is generated offline by `scripts/build-catalog.mjs` from the
//! official OpenCode docs, models.dev metadata and live protocol probes.

use std::collections::HashMap;

use anyhow::Context;
use serde::{Deserialize, Serialize};

pub const CATALOG_JSON: &str = include_str!("../../data/catalog.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFile {
    pub version: u32,
    pub generated_at: String,
    #[serde(default)]
    pub sources: serde_json::Value,
    pub providers: Vec<ProviderInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub short_name: String,
    #[serde(default)]
    pub description: String,
    pub base_url: String,
    #[serde(default)]
    pub console_url: String,
    /// protocol key -> path suffix (google uses `{model}` placeholder)
    #[serde(default)]
    pub endpoints: HashMap<String, String>,
    #[serde(default)]
    pub auth_env: String,
    pub default_model_id: String,
    pub models: Vec<ModelInfo>,
    #[serde(default)]
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub family: String,
    #[serde(default)]
    pub protocols: Vec<String>,
    #[serde(default)]
    pub reasoning: bool,
    #[serde(default)]
    pub reasoning_options: Vec<ReasoningOption>,
    #[serde(default)]
    pub attachment: bool,
    #[serde(default)]
    pub modalities: Modalities,
    #[serde(default = "default_context")]
    pub context_window: u32,
    #[serde(default = "default_output")]
    pub max_output: u32,
    #[serde(default)]
    pub cost: Option<serde_json::Value>,
    #[serde(default)]
    pub release_date: Option<String>,
    #[serde(default)]
    pub knowledge: Option<String>,
    #[serde(default)]
    pub open_weights: bool,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// stable | beta | free | unavailable
    #[serde(default = "default_status")]
    pub status: String,
}

fn default_context() -> u32 {
    128_000
}
fn default_output() -> u32 {
    16_384
}
fn default_status() -> String {
    "stable".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Modalities {
    #[serde(default)]
    pub input: Vec<String>,
    #[serde(default)]
    pub output: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ReasoningOption {
    Toggle,
    Effort { values: Vec<String> },
    BudgetTokens {
        #[serde(default)]
        min: Option<u32>,
        #[serde(default)]
        max: Option<u32>,
    },
}

impl ReasoningOption {
    pub fn efforts(&self) -> Option<&Vec<String>> {
        match self {
            Self::Effort { values } => Some(values),
            _ => None,
        }
    }
}

impl CatalogFile {
    pub fn load() -> anyhow::Result<Self> {
        let catalog: Self =
            serde_json::from_str(CATALOG_JSON).context("embedded model catalog is not valid JSON")?;
        Ok(catalog)
    }

    pub fn provider(&self, id: &str) -> Option<&ProviderInfo> {
        self.providers.iter().find(|p| p.id == id)
    }

    pub fn model(&self, provider_id: &str, model_id: &str) -> Option<&ModelInfo> {
        self.provider(provider_id)?
            .models
            .iter()
            .find(|m| m.id == model_id)
    }

    pub fn models(&self, provider_id: &str) -> Vec<&ModelInfo> {
        self.provider(provider_id)
            .map(|p| p.models.iter().collect())
            .unwrap_or_default()
    }

    /// Resolve the provider a model belongs to when the client did not send one.
    pub fn find_provider_for_model(&self, model_id: &str) -> Option<&ProviderInfo> {
        self.providers
            .iter()
            .find(|p| p.models.iter().any(|m| m.id == model_id))
    }
}

impl ProviderInfo {
    pub fn endpoint_for(&self, protocol: &str, model_id: &str) -> Option<String> {
        let path = self.endpoints.get(protocol)?;
        Some(format!(
            "{}{}",
            self.base_url.trim_end_matches('/'),
            path.replace("{model}", model_id)
        ))
    }
}
