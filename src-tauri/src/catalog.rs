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
    /// Authentication mode the provider primarily uses. Providers without the
    /// field (older catalogs) are API-key providers.
    #[serde(default)]
    pub auth: ProviderAuth,
    /// Wire-request profile per credential type (defaults to `standard`).
    #[serde(default)]
    pub request_profiles: RequestProfiles,
    /// OAuth client/host configuration (only for `auth = oauth` providers).
    #[serde(default)]
    pub oauth: Option<OAuthProviderInfo>,
    pub models: Vec<ModelInfo>,
    #[serde(default)]
    pub notes: Vec<String>,
}

impl ProviderInfo {
    /// Request profile to use with a concrete credential.
    pub fn request_profile(&self, auth: ProviderAuth) -> RequestProfile {
        match auth {
            ProviderAuth::Oauth => self.request_profiles.oauth.unwrap_or_default(),
            ProviderAuth::ApiKey => self.request_profiles.api_key.unwrap_or_default(),
        }
    }

    /// True when this provider supports the ChatGPT-plan OAuth flow.
    pub fn supports_oauth(&self) -> bool {
        matches!(self.auth, ProviderAuth::Oauth) && self.oauth.is_some()
    }
}

/// How a provider is authenticated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderAuth {
    /// `Authorization: Bearer <api-key>` (all non-OAuth providers).
    #[default]
    ApiKey,
    /// Sign in with ChatGPT (OAuth) with an API-key fallback.
    Oauth,
}

/// Wire-request constraints. `Standard` sends the full neutral request body;
/// `ChatgptPlan` applies the OpenAI plan-usage restrictions (`store: false`,
/// no `max_output_tokens`/`temperature`, `instructions` only, ...).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RequestProfile {
    #[default]
    Standard,
    ChatgptPlan,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RequestProfiles {
    pub oauth: Option<RequestProfile>,
    pub api_key: Option<RequestProfile>,
}

/// Static (catalog) part of the "Sign in with ChatGPT" configuration. The
/// dynamic endpoints (authorize/token/jwks/revoke) are resolved from
/// [`Self::discovery_url`] at runtime, with these values as fallback.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthProviderInfo {
    pub issuer: String,
    #[serde(default)]
    pub discovery_url: String,
    pub registration_client_id: String,
    pub agent_name_hint: String,
    pub resource: String,
    pub scopes: Vec<String>,
    pub plan_usage_scope: String,
    pub callback_path: String,
    pub loopback_host: String,
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
    /// Capabilities were inferred (model discovered from the provider account,
    /// not present in the bundled catalog).
    #[serde(default)]
    pub estimated: bool,
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

    /// Resolve the provider a model belongs to when the client did not send one.
    ///
    /// This is a *fallback only*: model ids can exist in more than one provider
    /// (e.g. `gpt-6-luna` in OpenCode Zen and OpenAI), so every action that has
    /// a provider available must use the explicit `(provider_id, model_id)` pair.
    pub fn find_provider_for_model(&self, model_id: &str) -> Option<&ProviderInfo> {
        self.providers
            .iter()
            .find(|p| p.models.iter().any(|m| m.id == model_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn embedded() -> CatalogFile {
        CatalogFile::load().expect("catalog.json carrega")
    }

    #[test]
    fn embedded_catalog_has_the_openai_provider() {
        let catalog = embedded();
        let openai = catalog.provider("openai").expect("provedor openai presente");
        assert_eq!(openai.name, "OpenAI (ChatGPT)");
        assert_eq!(openai.auth, ProviderAuth::Oauth);
        assert!(openai.supports_oauth());
        assert_eq!(openai.base_url, "https://api.openai.com/v1");
        assert_eq!(
            openai.endpoints.get("openai-responses").map(String::as_str),
            Some("/responses")
        );
        assert_eq!(openai.endpoints.get("models").map(String::as_str), Some("/models"));
        assert_eq!(openai.auth_env, "OPENAI_API_KEY");
        assert_eq!(
            openai.request_profile(ProviderAuth::Oauth),
            RequestProfile::ChatgptPlan
        );
        assert_eq!(
            openai.request_profile(ProviderAuth::ApiKey),
            RequestProfile::Standard
        );

        let oauth = openai.oauth.as_ref().expect("oauth config");
        assert_eq!(oauth.issuer, "https://auth.openai.com");
        assert_eq!(oauth.registration_client_id, "dynamic_agent_client");
        assert_eq!(oauth.resource, "https://api.openai.com/v1");
        assert_eq!(oauth.plan_usage_scope, "chatgpt.tokens.use.direct");
        assert_eq!(oauth.callback_path, "/auth/callback");
        assert!(oauth.scopes.iter().any(|s| s == "chatgpt.tokens.use.direct"));
        assert!(oauth.scopes.iter().any(|s| s == "offline_access"));
    }

    #[test]
    fn openai_models_are_responses_only_and_family_gpt() {
        let catalog = embedded();
        let openai = catalog.provider("openai").expect("provedor openai");
        assert!(!openai.models.is_empty());
        assert!(
            openai.models.iter().any(|m| m.id == "gpt-6.1-sol"),
            "seed precisa do modelo de exemplo da doc"
        );
        assert!(
            openai.models.iter().any(|m| m.id == openai.default_model_id),
            "defaultModelId precisa existir no provider"
        );
        for model in &openai.models {
            assert_eq!(model.protocols, vec!["openai-responses".to_string()]);
            assert_eq!(model.family, "gpt", "{} fora da família gpt", model.id);
            assert!(!model.estimated);
            assert!(model.reasoning_options.len() > 0, "{} sem raciocínio", model.id);
        }
        let mut ids: Vec<&str> = openai.models.iter().map(|m| m.id.as_str()).collect();
        ids.sort_unstable();
        let before = ids.len();
        ids.dedup();
        assert_eq!(before, ids.len(), "ids duplicados dentro do provedor");
    }

    #[test]
    fn legacy_provider_json_without_auth_fields_still_parses() {
        // Catálogo v1 (Go/Zen) não tem auth/requestProfiles/oauth/estimated.
        let raw = r#"{
            "id": "opencode-go",
            "name": "OpenCode Go",
            "shortName": "Go",
            "baseUrl": "https://opencode.ai/inference/go",
            "authEnv": "OPENCODE_API_KEY",
            "defaultModelId": "m1",
            "endpoints": {"openai-chat": "/openai/v1/chat/completions"},
            "models": [{"id": "m1", "name": "M1", "protocols": ["openai-chat"]}]
        }"#;
        let provider: ProviderInfo = serde_json::from_str(raw).expect("provider legado");
        assert_eq!(provider.auth, ProviderAuth::ApiKey);
        assert!(!provider.supports_oauth());
        assert_eq!(
            provider.request_profile(ProviderAuth::ApiKey),
            RequestProfile::Standard
        );
        assert!(provider.request_profiles.api_key.is_none());
        assert!(provider.oauth.is_none());
        assert!(!provider.models[0].estimated);

        let catalog_raw = format!(r#"{{"version":1,"generatedAt":"x","providers":[{raw}]}}"#);
        let catalog: CatalogFile = serde_json::from_str(&catalog_raw).expect("catálogo legado");
        assert_eq!(catalog.providers.len(), 1);
    }

    #[test]
    fn model_lookup_is_provider_scoped() {
        let catalog = embedded();
        // `gpt-6-luna` existe no Zen e no provider OpenAI; a busca por modelo é
        // sempre qualificada pelo provedor.
        let zen = catalog.model("opencode-zen", "gpt-6-luna");
        let openai = catalog.model("openai", "gpt-6-luna");
        assert!(zen.is_some() || openai.is_some());
        assert!(catalog.model("openai", "modelo-que-nao-existe").is_none());
    }
}
