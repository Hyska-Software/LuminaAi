//! Sign in with ChatGPT — OAuth protocol details.
//!
//! External contract: `https://developers.openai.com/siwc/` (open-source /
//! locally hosted apps, "ChatGPT plan usage"). Dynamic registration starts with
//! `client_id=dynamic_agent_client`; the callback returns the issued
//! `oaiapp_…` client id that must be reused on later sign-ins.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

use super::pkce::PkceCodes;
use crate::catalog::OAuthProviderInfo;

/// Endpoints resolved from the OIDC discovery document (with the documented
/// production values as fallback).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Discovery {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub revocation_endpoint: String,
    pub jwks_uri: String,
}

pub fn fallback_discovery(info: &OAuthProviderInfo) -> Discovery {
    let issuer = info.issuer.trim_end_matches('/');
    Discovery {
        issuer: issuer.to_string(),
        authorization_endpoint: format!("{issuer}/api/accounts/authorize"),
        token_endpoint: format!("{issuer}/api/accounts/oauth/token"),
        revocation_endpoint: format!("{issuer}/api/accounts/oauth/revoke"),
        jwks_uri: format!("{issuer}/.well-known/jwks.json"),
    }
}

#[derive(Debug, Deserialize)]
struct RawDiscovery {
    issuer: Option<String>,
    authorization_endpoint: Option<String>,
    token_endpoint: Option<String>,
    revocation_endpoint: Option<String>,
    jwks_uri: Option<String>,
}

/// Loads the discovery document; unknown fields fall back to the documented
/// production endpoints so a transient/partial document never bricks sign-in.
pub async fn load_discovery(
    http: &reqwest::Client,
    info: &OAuthProviderInfo,
) -> Result<Discovery> {
    let fallback = fallback_discovery(info);
    if info.discovery_url.trim().is_empty() {
        return Ok(fallback);
    }
    let response = match http
        .get(info.discovery_url.trim())
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => response,
        _ => return Ok(fallback),
    };
    let raw: RawDiscovery = match response.json().await {
        Ok(value) => value,
        Err(_) => return Ok(fallback),
    };
    Ok(Discovery {
        issuer: raw.issuer.unwrap_or(fallback.issuer),
        authorization_endpoint: raw
            .authorization_endpoint
            .unwrap_or(fallback.authorization_endpoint),
        token_endpoint: raw.token_endpoint.unwrap_or(fallback.token_endpoint),
        revocation_endpoint: raw
            .revocation_endpoint
            .unwrap_or(fallback.revocation_endpoint),
        jwks_uri: raw.jwks_uri.unwrap_or(fallback.jwks_uri),
    })
}

/* ------------------------------------------------------------------ */
/* Authorization request                                               */
/* ------------------------------------------------------------------ */

pub struct AuthorizationParams<'a> {
    pub info: &'a OAuthProviderInfo,
    pub discovery: &'a Discovery,
    pub client_id: &'a str,
    pub redirect_uri: &'a str,
    pub host_id: &'a str,
    pub pkce: &'a PkceCodes,
    pub state: &'a str,
    pub nonce: &'a str,
    /// Only on the first dynamic registration (the user can edit it).
    pub agent_name_hint: Option<&'a str>,
    /// Reauthorization hints; never sent as credentials anywhere else.
    pub id_token_hint: Option<&'a str>,
    pub login_hint: Option<&'a str>,
    /// `prompt=consent` when the user is explicitly enabling plan usage.
    pub force_consent: bool,
}

pub fn build_authorize_url(params: &AuthorizationParams<'_>) -> Result<String> {
    let mut url = Url::parse(&params.discovery.authorization_endpoint)
        .map_err(|error| anyhow!("endpoint de autorização inválido: {error}"))?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("response_type", "code")
            .append_pair("client_id", params.client_id)
            .append_pair("redirect_uri", params.redirect_uri)
            .append_pair("scope", &params.info.scopes.join(" "))
            .append_pair("resource", &params.info.resource)
            .append_pair("state", params.state)
            .append_pair("nonce", params.nonce)
            .append_pair("code_challenge", &params.pkce.challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("ext_agent_host_id", params.host_id);
        if let Some(hint) = params.agent_name_hint {
            query.append_pair("agent_name_hint", hint);
        }
        if let Some(hint) = params.id_token_hint {
            query.append_pair("id_token_hint", hint);
        }
        if let Some(hint) = params.login_hint {
            query.append_pair("login_hint", hint);
        }
        if params.force_consent {
            query.append_pair("prompt", "consent");
        }
    }
    Ok(url.to_string())
}

/* ------------------------------------------------------------------ */
/* Token endpoint                                                      */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct TokenResponse {
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub id_token: Option<String>,
    #[serde(default)]
    pub token_type: Option<String>,
    /// Some issuers send a number, others a numeric string.
    #[serde(default, deserialize_with = "de_opt_u64")]
    pub expires_in: Option<u64>,
    /// OIDC scope may be a space-separated string or an array of strings.
    #[serde(default, deserialize_with = "de_opt_scope")]
    pub scope: Option<String>,
    /// OpenAI returns this as a Unix timestamp (integer); other issuers use an
    /// ISO-8601 string. Accept both instead of failing the whole exchange.
    #[serde(default, deserialize_with = "de_opt_scalar_string")]
    pub earliest_refresh_at: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub error_description: Option<String>,
}

/// Scalar JSON value accepted where the OAuth responses are inconsistent
/// between string/number representations.
#[derive(Deserialize)]
#[serde(untagged)]
enum ScalarValue {
    String(String),
    Integer(i64),
    Unsigned(u64),
    Float(f64),
    Bool(bool),
}

fn de_opt_scalar_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<ScalarValue>::deserialize(deserializer)?;
    Ok(value.map(|value| match value {
        ScalarValue::String(value) => value,
        ScalarValue::Integer(value) => value.to_string(),
        ScalarValue::Unsigned(value) => value.to_string(),
        ScalarValue::Float(value) => value.to_string(),
        ScalarValue::Bool(value) => value.to_string(),
    }))
}

fn de_opt_u64<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<ScalarValue>::deserialize(deserializer)?;
    Ok(match value {
        None => None,
        Some(ScalarValue::Unsigned(value)) => Some(value),
        Some(ScalarValue::Integer(value)) => u64::try_from(value).ok(),
        Some(ScalarValue::Float(value)) if value.is_finite() && value >= 0.0 => Some(value as u64),
        Some(ScalarValue::String(value)) => value.trim().parse::<u64>().ok(),
        Some(ScalarValue::Float(_) | ScalarValue::Bool(_)) => None,
    })
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ScopeValue {
    String(String),
    List(Vec<String>),
}

fn de_opt_scope<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<ScopeValue>::deserialize(deserializer)?;
    Ok(value.map(|value| match value {
        ScopeValue::String(value) => value,
        ScopeValue::List(values) => values.join(" "),
    }))
}

impl TokenResponse {
    pub fn scopes(&self) -> Vec<String> {
        self.scope
            .as_deref()
            .map(|scope| {
                scope
                    .split_whitespace()
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    }
}

/// OAuth token-endpoint rejection.
#[derive(Debug, Clone)]
pub struct TokenError {
    pub status: u16,
    pub code: Option<String>,
    pub description: Option<String>,
    pub body: String,
}

impl TokenError {
    /// Errors that mean the refresh token can never be used again.
    pub fn is_permanent_refresh_failure(&self) -> bool {
        match self.code.as_deref() {
            Some(
                "invalid_grant"
                | "invalid_refresh_token"
                | "token_expired"
                | "refresh_token_expired"
                | "refresh_token_invalidated"
                | "refresh_token_reused"
                | "invalid_client",
            ) => true,
            _ => self.status == 400 && self.code.is_none(),
        }
    }

    pub fn message(&self) -> String {
        match (&self.code, &self.description) {
            (Some(code), Some(description)) => format!("{code}: {description}"),
            (Some(code), None) => code.clone(),
            (None, Some(description)) => description.clone(),
            (None, None) => format!("HTTP {}: {}", self.status, self.body.trim()),
        }
    }
}

impl std::fmt::Display for TokenError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "token endpoint: {}", self.message())
    }
}

impl std::error::Error for TokenError {}

/// Parses either an OAuth error body (`{"error":..,"error_description":..}`) or
/// a plain `{"detail":..}` / text body.
pub fn parse_token_error(status: u16, body: &str) -> TokenError {
    let (code, description) = match serde_json::from_str::<Value>(body) {
        Ok(value) => {
            let code = value
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string);
            let description = value
                .get("error_description")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| {
                    value
                        .get("detail")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                });
            (code, description)
        }
        Err(_) => (None, None),
    };
    TokenError {
        status,
        code,
        description,
        body: body.to_string(),
    }
}

async fn post_form(
    http: &reqwest::Client,
    url: &str,
    form: &[(&str, &str)],
    timeout_secs: u64,
) -> Result<TokenResponse> {
    let response = http
        .post(url)
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .form(form)
        .send()
        .await
        .map_err(|error| anyhow!("falha de rede no token endpoint: {error}"))?;
    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err(anyhow::Error::new(parse_token_error(status, &body)));
    }
    if body.trim().is_empty() {
        return Ok(TokenResponse::default());
    }
    serde_json::from_str::<TokenResponse>(&body)
        .map_err(|error| anyhow!("resposta inválida do token endpoint: {error}"))
}

pub async fn exchange_code(
    http: &reqwest::Client,
    discovery: &Discovery,
    info: &OAuthProviderInfo,
    client_id: &str,
    redirect_uri: &str,
    code_verifier: &str,
    code: &str,
) -> Result<TokenResponse> {
    post_form(
        http,
        &discovery.token_endpoint,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("code", code),
            ("redirect_uri", redirect_uri),
            ("code_verifier", code_verifier),
            ("resource", info.resource.as_str()),
        ],
        20,
    )
    .await
}

pub async fn refresh_token(
    http: &reqwest::Client,
    discovery: &Discovery,
    info: &OAuthProviderInfo,
    client_id: &str,
    refresh_token: &str,
) -> Result<TokenResponse> {
    post_form(
        http,
        &discovery.token_endpoint,
        &[
            ("grant_type", "refresh_token"),
            ("client_id", client_id),
            ("refresh_token", refresh_token),
            ("resource", info.resource.as_str()),
        ],
        20,
    )
    .await
}

pub async fn revoke(
    http: &reqwest::Client,
    discovery: &Discovery,
    client_id: &str,
    refresh_token: &str,
) -> Result<()> {
    let response = http
        .post(&discovery.revocation_endpoint)
        .timeout(std::time::Duration::from_secs(15))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("token", refresh_token),
            ("token_type_hint", "refresh_token"),
            ("client_id", client_id),
        ])
        .send()
        .await
        .map_err(|error| anyhow!("falha de rede na revogação: {error}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(anyhow!("revogação recusada com HTTP {}", response.status()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info() -> OAuthProviderInfo {
        OAuthProviderInfo {
            issuer: "https://auth.openai.com".into(),
            discovery_url: String::new(),
            registration_client_id: "dynamic_agent_client".into(),
            agent_name_hint: "Lumina".into(),
            resource: "https://api.openai.com/v1".into(),
            scopes: vec![
                "openid".into(),
                "profile".into(),
                "email".into(),
                "offline_access".into(),
                "resource.invoke".into(),
                "chatgpt.tokens.use.direct".into(),
            ],
            plan_usage_scope: "chatgpt.tokens.use.direct".into(),
            callback_path: "/auth/callback".into(),
            loopback_host: "127.0.0.1".into(),
        }
    }

    fn pkce() -> PkceCodes {
        PkceCodes {
            verifier: "verifier".into(),
            challenge: "challenge".into(),
        }
    }

    fn query_map(url: &str) -> std::collections::HashMap<String, String> {
        Url::parse(url)
            .expect("url")
            .query_pairs()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect()
    }

    #[test]
    fn authorize_url_has_every_required_parameter() {
        let info = info();
        let discovery = fallback_discovery(&info);
        let pkce = pkce();
        let url = build_authorize_url(&AuthorizationParams {
            info: &info,
            discovery: &discovery,
            client_id: "dynamic_agent_client",
            redirect_uri: "http://127.0.0.1:4321/auth/callback",
            host_id: "urn:uuid:host",
            pkce: &pkce,
            state: "state-1",
            nonce: "nonce-1",
            agent_name_hint: Some("Lumina"),
            id_token_hint: None,
            login_hint: None,
            force_consent: false,
        })
        .expect("url");
        let query = query_map(&url);
        assert_eq!(query["response_type"], "code");
        assert_eq!(query["client_id"], "dynamic_agent_client");
        assert_eq!(query["redirect_uri"], "http://127.0.0.1:4321/auth/callback");
        assert_eq!(
            query["scope"],
            "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
        );
        assert_eq!(query["resource"], "https://api.openai.com/v1");
        assert_eq!(query["state"], "state-1");
        assert_eq!(query["nonce"], "nonce-1");
        assert_eq!(query["code_challenge"], "challenge");
        assert_eq!(query["code_challenge_method"], "S256");
        assert_eq!(query["ext_agent_host_id"], "urn:uuid:host");
        assert_eq!(query["agent_name_hint"], "Lumina");
        assert!(!query.contains_key("prompt"));
        assert!(!query.contains_key("id_token_hint"));
    }

    #[test]
    fn reauthorization_omits_agent_name_and_can_force_consent() {
        let info = info();
        let discovery = fallback_discovery(&info);
        let pkce = pkce();
        let url = build_authorize_url(&AuthorizationParams {
            info: &info,
            discovery: &discovery,
            client_id: "oaiapp_123",
            redirect_uri: "http://127.0.0.1:1/auth/callback",
            host_id: "urn:uuid:host",
            pkce: &pkce,
            state: "state-2",
            nonce: "nonce-2",
            agent_name_hint: None,
            id_token_hint: Some("id-token"),
            login_hint: Some("user@example.com"),
            force_consent: true,
        })
        .expect("url");
        let query = query_map(&url);
        assert_eq!(query["client_id"], "oaiapp_123");
        assert!(!query.contains_key("agent_name_hint"));
        assert_eq!(query["id_token_hint"], "id-token");
        assert_eq!(query["login_hint"], "user@example.com");
        assert_eq!(query["prompt"], "consent");
    }

    #[test]
    fn discovery_fallback_matches_the_documented_production_endpoints() {
        let discovery = fallback_discovery(&info());
        assert_eq!(discovery.issuer, "https://auth.openai.com");
        assert_eq!(
            discovery.authorization_endpoint,
            "https://auth.openai.com/api/accounts/authorize"
        );
        assert_eq!(
            discovery.token_endpoint,
            "https://auth.openai.com/api/accounts/oauth/token"
        );
        assert_eq!(
            discovery.revocation_endpoint,
            "https://auth.openai.com/api/accounts/oauth/revoke"
        );
        assert_eq!(
            discovery.jwks_uri,
            "https://auth.openai.com/.well-known/jwks.json"
        );
    }

    #[test]
    fn classifies_refresh_failures() {
        let permanent = parse_token_error(
            400,
            r#"{"error":"invalid_grant","error_description":"used"}"#,
        );
        assert_eq!(permanent.code.as_deref(), Some("invalid_grant"));
        assert!(permanent.is_permanent_refresh_failure());

        let reused = parse_token_error(400, r#"{"error":"refresh_token_reused"}"#);
        assert!(reused.is_permanent_refresh_failure());

        let transient = parse_token_error(503, r#"{"detail":"unavailable"}"#);
        assert!(!transient.is_permanent_refresh_failure());
        assert_eq!(transient.description.as_deref(), Some("unavailable"));
    }

    #[test]
    fn token_response_scopes_are_split_on_whitespace() {
        let response = TokenResponse {
            scope: Some("openid profile chatgpt.tokens.use.direct".into()),
            ..TokenResponse::default()
        };
        assert_eq!(
            response.scopes(),
            vec![
                "openid".to_string(),
                "profile".to_string(),
                "chatgpt.tokens.use.direct".to_string()
            ]
        );
    }

    /// Regression: the real Sign in with ChatGPT token response sends
    /// `earliest_refresh_at` as a Unix timestamp (number). Failing to accept it
    /// aborted the exchange with `invalid type: integer, expected a string`.
    #[test]
    fn token_response_accepts_integer_earliest_refresh_at() {
        let raw = r#"{
            "access_token": "access",
            "refresh_token": "refresh",
            "id_token": "id",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid offline_access chatgpt.tokens.use.direct",
            "earliest_refresh_at": 1793045353
        }"#;
        let tokens: TokenResponse = serde_json::from_str(raw).expect("token response");
        assert_eq!(tokens.access_token.as_deref(), Some("access"));
        assert_eq!(tokens.expires_in, Some(3_600));
        assert_eq!(tokens.earliest_refresh_at.as_deref(), Some("1793045353"));
        assert!(tokens
            .scopes()
            .contains(&"chatgpt.tokens.use.direct".to_string()));
    }

    #[test]
    fn token_response_tolerates_string_expires_in_and_scope_array() {
        let raw = r#"{
            "access_token": "access",
            "refresh_token": "refresh",
            "expires_in": "3600",
            "scope": ["openid", "offline_access", "chatgpt.tokens.use.direct"],
            "earliest_refresh_at": "2026-10-26T00:00:00Z"
        }"#;
        let tokens: TokenResponse = serde_json::from_str(raw).expect("token response");
        assert_eq!(tokens.expires_in, Some(3_600));
        assert_eq!(
            tokens.earliest_refresh_at.as_deref(),
            Some("2026-10-26T00:00:00Z")
        );
        assert_eq!(
            tokens.scopes(),
            vec![
                "openid".to_string(),
                "offline_access".to_string(),
                "chatgpt.tokens.use.direct".to_string()
            ]
        );
    }

    #[test]
    fn token_response_rejects_bad_expires_in_instead_of_panicking() {
        let raw = r#"{"access_token":"a","refresh_token":"r","expires_in":"not-a-number"}"#;
        let tokens: TokenResponse = serde_json::from_str(raw).expect("token response");
        assert_eq!(tokens.expires_in, None);
        // O restante do payload (tokens) continua utilizável.
        assert_eq!(tokens.access_token.as_deref(), Some("a"));
    }

    /* -------------------------------------------------------------- */
    /* HTTP behavior against a one-shot local server                    */
    /* -------------------------------------------------------------- */

    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn one_shot_server(
        status: u16,
        body: &'static str,
    ) -> (String, tokio::task::JoinHandle<String>) {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let url = format!("http://127.0.0.1:{port}/endpoint");
        let handle = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept");
            let mut buffer = Vec::new();
            let mut chunk = [0_u8; 1024];
            loop {
                let read = stream.read(&mut chunk).await.expect("read");
                if read == 0 {
                    break;
                }
                buffer.extend_from_slice(&chunk[..read]);
                let text = String::from_utf8_lossy(&buffer).to_string();
                if let Some(position) = text.find("\r\n\r\n") {
                    let length = text[..position]
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|value| value.trim().parse::<usize>().unwrap_or(0))
                        })
                        .unwrap_or(0);
                    if buffer.len() >= position + 4 + length {
                        break;
                    }
                }
            }
            let response = format!(
                "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream
                .write_all(response.as_bytes())
                .await
                .expect("write response");
            let text = String::from_utf8_lossy(&buffer).to_string();
            text.split_once("\r\n\r\n")
                .map(|(_, body)| body.to_string())
                .unwrap_or_default()
        });
        (url, handle)
    }

    #[tokio::test]
    async fn exchange_code_posts_the_documented_form_and_parses_tokens() {
        let (url, server) = one_shot_server(
            200,
            r#"{"access_token":"access","refresh_token":"refresh","id_token":"id","token_type":"Bearer","expires_in":3600,"scope":"openid offline_access chatgpt.tokens.use.direct","earliest_refresh_at":"2026-10-26T00:00:00Z"}"#,
        )
        .await;
        let discovery = Discovery {
            token_endpoint: url.clone(),
            ..fallback_discovery(&info())
        };
        let tokens = exchange_code(
            &reqwest::Client::new(),
            &discovery,
            &info(),
            "oaiapp_x",
            "http://127.0.0.1:4321/auth/callback",
            "verifier-value",
            "code-value",
        )
        .await
        .expect("token exchange");
        assert_eq!(tokens.access_token.as_deref(), Some("access"));
        assert_eq!(tokens.refresh_token.as_deref(), Some("refresh"));
        assert_eq!(tokens.expires_in, Some(3_600));
        assert_eq!(tokens.earliest_refresh_at.as_deref(), Some("2026-10-26T00:00:00Z"));
        assert!(tokens
            .scopes()
            .iter()
            .any(|scope| scope == "chatgpt.tokens.use.direct"));

        let posted = server.await.expect("server");
        assert!(posted.contains("grant_type=authorization_code"));
        assert!(posted.contains("client_id=oaiapp_x"));
        assert!(posted.contains("code=code-value"));
        assert!(posted.contains("code_verifier=verifier-value"));
        assert!(posted.contains("resource=https%3A%2F%2Fapi.openai.com%2Fv1"));
    }

    #[tokio::test]
    async fn token_errors_are_classified_from_the_response_body() {
        let (url, _server) = one_shot_server(
            400,
            r#"{"error":"invalid_grant","error_description":"code expired"}"#,
        )
        .await;
        let discovery = Discovery {
            token_endpoint: url,
            ..fallback_discovery(&info())
        };
        let error = exchange_code(
            &reqwest::Client::new(),
            &discovery,
            &info(),
            "oaiapp_x",
            "http://127.0.0.1:1/auth/callback",
            "verifier",
            "code",
        )
        .await
        .expect_err("token error");
        let typed = error.downcast_ref::<TokenError>().expect("TokenError");
        assert_eq!(typed.code.as_deref(), Some("invalid_grant"));
        assert!(typed.is_permanent_refresh_failure());
    }

    #[tokio::test]
    async fn refresh_posts_refresh_grant_without_scope() {
        let (url, server) = one_shot_server(
            200,
            r#"{"access_token":"new-access","refresh_token":"new-refresh","expires_in":3600,"scope":"openid chatgpt.tokens.use.direct"}"#,
        )
        .await;
        let discovery = Discovery {
            token_endpoint: url,
            ..fallback_discovery(&info())
        };
        let tokens = refresh_token(
            &reqwest::Client::new(),
            &discovery,
            &info(),
            "oaiapp_x",
            "old-refresh",
        )
        .await
        .expect("refresh");
        assert_eq!(tokens.access_token.as_deref(), Some("new-access"));
        assert_eq!(tokens.refresh_token.as_deref(), Some("new-refresh"));
        let posted = server.await.expect("server");
        assert!(posted.contains("grant_type=refresh_token"));
        assert!(posted.contains("refresh_token=old-refresh"));
        assert!(posted.contains("client_id=oaiapp_x"));
        assert!(!posted.contains("scope="));
    }

    #[tokio::test]
    async fn revoke_posts_the_refresh_token_hint() {
        let (url, server) = one_shot_server(200, "").await;
        let discovery = Discovery {
            revocation_endpoint: url,
            ..fallback_discovery(&info())
        };
        revoke(&reqwest::Client::new(), &discovery, "oaiapp_x", "refresh-token")
            .await
            .expect("revoke");
        let posted = server.await.expect("server");
        assert!(posted.contains("token=refresh-token"));
        assert!(posted.contains("token_type_hint=refresh_token"));
        assert!(posted.contains("client_id=oaiapp_x"));
    }
}
