//! Sign in with ChatGPT — OAuth core (ChatGPT plan usage).
//!
//! This module owns the credential lifecycle only; all disk I/O goes through
//! [`crate::config`] (single writer of the app secrets file). Public surface:
//!
//! - [`login_start`] / [`login_wait`] / [`login_cancel`] — two-phase loopback login
//! - [`ensure_bearer`] / [`force_refresh`] — refresh-aware access token
//! - [`sign_out`] — revoke the renewable session, keep the account mapping
//! - [`statuses`] — renderer-facing auth status (never tokens)
//!
//! External contract: `https://developers.openai.com/siwc/`.

pub mod jwt;
pub mod loopback;
pub mod pkce;
pub mod siwc;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use parking_lot::{Mutex, RwLock};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio_util::sync::CancellationToken;

use crate::catalog::{CatalogFile, OAuthProviderInfo, ProviderInfo};
use crate::config::{self, OAuthStore, StoredOAuthRegistration};
use crate::domain::{LoginChallenge, ProviderAuthStatus};

/// Lifetime of one login attempt (browser + consent).
pub const LOGIN_TTL: Duration = Duration::from_secs(10 * 60);
const DISCOVERY_TTL_SECS: i64 = 6 * 60 * 60;
const JWKS_TTL_SECS: i64 = 60 * 60;
const REFRESH_WINDOW_MS: i64 = 60_000;
const DEFAULT_EXPIRES_IN: u64 = 3_600;

/// Typed auth failure; `code` is copied to `TurnEvent::Error.code` so the UI can
/// offer "sign in" instead of a generic error.
#[derive(Debug, Clone)]
pub struct AuthError {
    pub code: &'static str,
    pub message: String,
    pub reauth_required: bool,
}

impl AuthError {
    pub fn missing(message: impl Into<String>) -> Self {
        Self {
            code: "missing_credentials",
            message: message.into(),
            reauth_required: false,
        }
    }

    pub fn reauth(message: impl Into<String>) -> Self {
        Self {
            code: "reauth_required",
            message: message.into(),
            reauth_required: true,
        }
    }

    pub fn network(message: impl Into<String>) -> Self {
        Self {
            code: "auth_network",
            message: message.into(),
            reauth_required: false,
        }
    }

    pub fn plan_disabled(message: impl Into<String>) -> Self {
        Self {
            code: "plan_disabled",
            message: message.into(),
            reauth_required: false,
        }
    }
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for AuthError {}

fn auth_error(error: AuthError) -> anyhow::Error {
    anyhow::Error::new(error)
}

/* ------------------------------------------------------------------ */
/* Shared state                                                        */
/* ------------------------------------------------------------------ */

struct PendingLogin {
    attempt_id: String,
    provider_id: String,
    expires_at: i64,
    cancel: CancellationToken,
    notify: Arc<tokio::sync::Notify>,
    result: Arc<Mutex<Option<Result<ProviderAuthStatus, String>>>>,
}

/// OAuth state kept in `AppState`: at most one pending login, single-flight
/// refresh locks, cached discovery/JWKS and a reset epoch.
#[derive(Default)]
pub struct OAuthState {
    pending: Mutex<Option<PendingLogin>>,
    discovery: RwLock<Option<(siwc::Discovery, i64)>>,
    jwks: RwLock<Option<(Vec<jwt::Jwk>, i64)>>,
    refresh_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    epoch: AtomicU64,
}

impl OAuthState {
    pub fn new() -> Self {
        Self::default()
    }

    fn refresh_lock(&self, provider_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self.refresh_locks.lock();
        locks
            .entry(provider_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::SeqCst)
    }
}

/// Cancels any in-flight login and invalidates outstanding refresh writes
/// (used by sign-out and by "apagar dados").
pub fn cancel_all(state: &OAuthState) {
    state.epoch.fetch_add(1, Ordering::SeqCst);
    if let Some(pending) = state.pending.lock().take() {
        pending.cancel.cancel();
        *pending.result.lock() = Some(Err("login cancelado".to_string()));
        pending.notify.notify_waiters();
    }
}

fn cancel_other_login(state: &OAuthState) {
    if let Some(pending) = state.pending.lock().take() {
        pending.cancel.cancel();
        *pending.result.lock() = Some(Err("login substituto iniciado".to_string()));
        pending.notify.notify_waiters();
    }
}

/* ------------------------------------------------------------------ */
/* Catalog helpers                                                     */
/* ------------------------------------------------------------------ */

fn provider<'a>(catalog: &'a CatalogFile, provider_id: &str) -> Result<&'a ProviderInfo> {
    catalog
        .provider(provider_id)
        .ok_or_else(|| anyhow!("provedor desconhecido: {provider_id}"))
}

fn oauth_info<'a>(provider: &'a ProviderInfo) -> Result<&'a OAuthProviderInfo> {
    provider
        .oauth
        .as_ref()
        .ok_or_else(|| anyhow!("provedor {} não suporta login ChatGPT", provider.id))
}

/* ------------------------------------------------------------------ */
/* Status (read-only, derived from the store; never touches the network)*/
/* ------------------------------------------------------------------ */

fn mask(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= 12 {
        return Some("••••".to_string());
    }
    let head: String = chars[..8].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    Some(format!("{head}…{tail}"))
}

fn registration_status(
    provider_id: &str,
    registration: Option<&StoredOAuthRegistration>,
) -> ProviderAuthStatus {
    let Some(registration) = registration else {
        return ProviderAuthStatus {
            provider_id: provider_id.to_string(),
            mode: "oauth".to_string(),
            state: "signed-out".to_string(),
            account_label: None,
            plan_usage: false,
            expires_at: None,
            scopes: Vec::new(),
            client_id_masked: None,
            host_id_masked: None,
            hint: None,
        };
    };

    let has_refresh = !registration.refresh_token.is_empty();
    let (state, hint) = if registration.disconnected || !has_refresh {
        (
            "reauth-required",
            Some("Entre novamente com o ChatGPT para renovar a sessão.".to_string()),
        )
    } else if !registration.plan_usage {
        (
            "plan-disabled",
            Some(
                "Sua conta está conectada, mas o uso do plano ChatGPT não foi autorizado."
                    .to_string(),
            ),
        )
    } else {
        ("signed-in", None)
    };

    ProviderAuthStatus {
        provider_id: provider_id.to_string(),
        mode: "oauth".to_string(),
        state: state.to_string(),
        account_label: registration
            .email
            .clone()
            .filter(|email| !email.trim().is_empty()),
        plan_usage: registration.plan_usage && !registration.disconnected && has_refresh,
        expires_at: Some(
            registration.saved_at
                + i64::try_from(registration.expires_in.saturating_mul(1_000)).unwrap_or(i64::MAX),
        ),
        scopes: registration.scopes.clone(),
        client_id_masked: mask(Some(&registration.client_id)),
        host_id_masked: mask(Some(&registration.ext_agent_host_id)),
        hint,
    }
}

fn active_registration<'a>(
    store: &'a OAuthStore,
    provider_id: &str,
) -> Option<&'a StoredOAuthRegistration> {
    let client_id = store.active.get(provider_id)?;
    store
        .registrations
        .get(provider_id)
        .and_then(|registrations| registrations.get(client_id))
}

/// Auth status for every provider in the catalog (uniform shape for the UI):
/// OAuth providers derive from the registration store, API-key providers from
/// the configured key (secrets → env → OpenCode CLI), with no network access.
pub fn statuses(app: &AppHandle, catalog: &CatalogFile) -> Vec<ProviderAuthStatus> {
    let (store, _) = config::oauth_snapshot(app);
    catalog
        .providers
        .iter()
        .map(|provider| {
            if provider.supports_oauth() {
                registration_status(&provider.id, active_registration(&store, &provider.id))
            } else {
                api_key_status(app, provider)
            }
        })
        .collect()
}

fn api_key_status(app: &AppHandle, provider: &ProviderInfo) -> ProviderAuthStatus {
    let has_key = config::api_key_from_secrets(app, &provider.id).is_some()
        || config::api_key_from_env(&provider.id, &provider.auth_env).is_some()
        || config::api_key_from_opencode_cli(&provider.id).is_some();
    ProviderAuthStatus {
        provider_id: provider.id.clone(),
        mode: "api-key".to_string(),
        state: if has_key { "signed-in" } else { "signed-out" }.to_string(),
        account_label: None,
        plan_usage: false,
        expires_at: None,
        scopes: Vec::new(),
        client_id_masked: None,
        host_id_masked: None,
        hint: None,
    }
}

/// Auth status for one provider (signed-out when it has no OAuth registration).
pub fn status(app: &AppHandle, provider_id: &str) -> ProviderAuthStatus {
    let (store, _) = config::oauth_snapshot(app);
    registration_status(provider_id, active_registration(&store, provider_id))
}

/* ------------------------------------------------------------------ */
/* Discovery / JWKS caches                                             */
/* ------------------------------------------------------------------ */

async fn discovery(
    state: &OAuthState,
    http: &reqwest::Client,
    info: &OAuthProviderInfo,
) -> Result<siwc::Discovery> {
    let now = crate::domain::now_ms() / 1_000;
    if let Some((cached, fetched_at)) = state.discovery.read().clone() {
        if now - fetched_at < DISCOVERY_TTL_SECS {
            return Ok(cached);
        }
    }
    let loaded = siwc::load_discovery(http, info).await?;
    *state.discovery.write() = Some((loaded.clone(), now));
    Ok(loaded)
}

async fn jwks(
    state: &OAuthState,
    http: &reqwest::Client,
    discovery: &siwc::Discovery,
) -> Result<Vec<jwt::Jwk>> {
    let now = crate::domain::now_ms() / 1_000;
    if let Some((cached, fetched_at)) = state.jwks.read().clone() {
        if now - fetched_at < JWKS_TTL_SECS {
            return Ok(cached);
        }
    }
    let response = http
        .get(&discovery.jwks_uri)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|error| anyhow!("falha ao buscar JWKS: {error}"))?;
    if !response.status().is_success() {
        return Err(anyhow!("JWKS respondeu HTTP {}", response.status()));
    }
    let document = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| anyhow!("JWKS inválido: {error}"))?;
    let keys = jwt::parse_jwks(&document)?;
    *state.jwks.write() = Some((keys.clone(), now));
    Ok(keys)
}

/* ------------------------------------------------------------------ */
/* Login: start / wait / cancel                                        */
/* ------------------------------------------------------------------ */

struct LoginPlan {
    provider_id: String,
    info: OAuthProviderInfo,
    discovery: siwc::Discovery,
    host_id: String,
    client_id: String,
    is_new_registration: bool,
    redirect_uri: String,
    pkce: pkce::PkceCodes,
    oauth_state: String,
    nonce: String,
    previous_subject: Option<String>,
}

/// Starts a login attempt: binds the loopback listener, opens the system
/// browser and returns the challenge (the URL is also useful if the browser
/// fails to open).
pub async fn login_start(
    app: &AppHandle,
    oauth_state: Arc<OAuthState>,
    http: &reqwest::Client,
    catalog: &CatalogFile,
    provider_id: &str,
    force_consent: bool,
) -> Result<LoginChallenge> {
    let provider = provider(catalog, provider_id)?;
    let info = oauth_info(provider)?.clone();
    let state = &*oauth_state;

    let host_id = config::ensure_host_id(app)?;
    let (store, load_error) = config::oauth_snapshot(app);
    if let Some(error) = load_error {
        return Err(anyhow!("arquivo de credenciais inválido: {error}"));
    }

    let existing = active_registration(&store, provider_id);
    let client_id = existing
        .map(|registration| registration.client_id.clone())
        .unwrap_or_else(|| info.registration_client_id.clone());
    let is_new_registration = existing.is_none();
    let previous_subject = existing.map(|registration| registration.subject.clone());

    let pkce_codes = pkce::generate_pkce()?;
    let oauth_state_token = pkce::generate_state()?;
    let nonce = pkce::generate_nonce()?;

    // The listener must exist before the browser opens.
    let (listener, port) = loopback::bind(&info.loopback_host).await?;
    let redirect_uri = format!(
        "http://{}:{}{}",
        info.loopback_host, port, info.callback_path
    );

    let discovery = discovery(state, http, &info).await?;
    let authorize_url = siwc::build_authorize_url(&siwc::AuthorizationParams {
        info: &info,
        discovery: &discovery,
        client_id: &client_id,
        redirect_uri: &redirect_uri,
        host_id: &host_id,
        pkce: &pkce_codes,
        state: &oauth_state_token,
        nonce: &nonce,
        agent_name_hint: is_new_registration.then_some(info.agent_name_hint.as_str()),
        id_token_hint: existing
            .map(|registration| registration.id_token.as_str())
            .filter(|token| !token.trim().is_empty()),
        login_hint: existing
            .and_then(|registration| registration.email.as_deref())
            .filter(|email| !email.trim().is_empty()),
        force_consent,
    })?;

    let attempt_id = uuid::Uuid::new_v4().to_string();
    let expires_at = crate::domain::now_ms() + LOGIN_TTL.as_millis() as i64;
    let cancel = CancellationToken::new();
    let notify = Arc::new(tokio::sync::Notify::new());
    let result: Arc<Mutex<Option<Result<ProviderAuthStatus, String>>>> =
        Arc::new(Mutex::new(None));

    cancel_other_login(state);
    *state.pending.lock() = Some(PendingLogin {
        attempt_id: attempt_id.clone(),
        provider_id: provider_id.to_string(),
        expires_at,
        cancel: cancel.clone(),
        notify: notify.clone(),
        result: result.clone(),
    });

    let task_app = app.clone();
    let task_http = http.clone();
    let task_oauth_state = oauth_state.clone();
    let plan = LoginPlan {
        provider_id: provider_id.to_string(),
        info,
        discovery,
        host_id,
        client_id,
        is_new_registration,
        redirect_uri,
        pkce: pkce_codes,
        oauth_state: oauth_state_token,
        nonce,
        previous_subject,
    };
    let task_cancel = cancel.clone();
    tauri::async_runtime::spawn(async move {
        let outcome =
            run_login_task(task_app, task_http, task_oauth_state, plan, listener, task_cancel).await;
        *result.lock() = Some(outcome.map_err(|error| format!("{error:#}")));
        notify.notify_waiters();
    });

    // Opening the browser is best-effort: the UI always receives the URL.
    let _ = app.opener().open_url(&authorize_url, None::<&str>);

    Ok(LoginChallenge {
        attempt_id,
        auth_url: authorize_url,
        expires_at,
    })
}

async fn run_login_task(
    app: AppHandle,
    http: reqwest::Client,
    state: Arc<OAuthState>,
    plan: LoginPlan,
    listener: tokio::net::TcpListener,
    cancel: CancellationToken,
) -> Result<ProviderAuthStatus> {
    let params = loopback::serve_once(listener, cancel).await?;
    complete_login(app, http, &state, plan, params).await
}

/// Pure callback validation (state -> error -> code -> issued client id).
///
/// Returns the client id to use in the token exchange: the issued `oaiapp_…`
/// on first registration, or the stored one on reauthorization.
fn validate_callback(
    expected_state: &str,
    expected_client_id: &str,
    is_new_registration: bool,
    params: &loopback::CallbackParams,
) -> Result<String> {
    if params.state.as_deref() != Some(expected_state) {
        return Err(anyhow!("callback com `state` inválido (possível CSRF)"));
    }
    if let Some(error) = params.error.as_deref() {
        let description = params
            .error_description
            .as_deref()
            .unwrap_or("autorização recusada");
        return Err(anyhow!("login não autorizado: {error} ({description})"));
    }
    if params
        .code
        .as_deref()
        .map(str::trim)
        .filter(|code| !code.is_empty())
        .is_none()
    {
        return Err(anyhow!("callback sem código de autorização"));
    }
    match params.client_id.as_deref() {
        Some(issued) if !issued.is_empty() => {
            if !is_new_registration && issued != expected_client_id {
                return Err(anyhow!(
                    "callback trouxe um client_id diferente do registro selecionado"
                ));
            }
            Ok(issued.to_string())
        }
        _ if is_new_registration => Err(anyhow!(
            "registro incompleto: o callback não trouxe o client_id emitido"
        )),
        _ => Ok(expected_client_id.to_string()),
    }
}

async fn complete_login(
    app: AppHandle,
    http: reqwest::Client,
    state: &OAuthState,
    plan: LoginPlan,
    params: loopback::CallbackParams,
) -> Result<ProviderAuthStatus> {
    if params.state.as_deref() != Some(plan.oauth_state.as_str()) {
        return Err(anyhow!("callback com `state` inválido (possível CSRF)"));
    }
    if let Some(error) = params.error.as_deref() {
        let description = params
            .error_description
            .as_deref()
            .unwrap_or("autorização recusada");
        return Err(anyhow!("login não autorizado: {error} ({description})"));
    }
    let code = params
        .code
        .as_deref()
        .filter(|code| !code.is_empty())
        .ok_or_else(|| anyhow!("callback sem código de autorização"))?;

    let issued_client_id = validate_callback(
        &plan.oauth_state,
        &plan.client_id,
        plan.is_new_registration,
        &params,
    )?;

    let tokens = siwc::exchange_code(
        &http,
        &plan.discovery,
        &plan.info,
        &issued_client_id,
        &plan.redirect_uri,
        &plan.pkce.verifier,
        code,
    )
    .await?;

    let access_token = tokens
        .access_token
        .clone()
        .filter(|token| !token.is_empty())
        .ok_or_else(|| anyhow!("token endpoint não devolveu access_token"))?;
    let refresh_token = tokens
        .refresh_token
        .clone()
        .filter(|token| !token.is_empty())
        .ok_or_else(|| anyhow!("token endpoint não devolveu refresh_token"))?;
    let id_token = tokens
        .id_token
        .clone()
        .filter(|token| !token.is_empty())
        .ok_or_else(|| anyhow!("token endpoint não devolveu id_token"))?;

    let keys = jwks(state, &http, &plan.discovery).await?;
    let claims = jwt::verify(
        &id_token,
        &keys,
        &plan.discovery.issuer,
        &issued_client_id,
        &plan.nonce,
    )?;
    let subject = claims.subject()?.to_string();
    if let Some(previous_subject) = plan.previous_subject.as_deref() {
        if previous_subject != subject {
            return Err(anyhow!(
                "a conta autenticada não é a mesma do registro selecionado; login abortado"
            ));
        }
    }

    let scopes = tokens.scopes();
    let plan_usage = scopes.iter().any(|scope| scope == &plan.info.plan_usage_scope);
    let registration = StoredOAuthRegistration {
        email: claims.email().map(str::to_string),
        issuer: plan.discovery.issuer.clone(),
        subject,
        client_id: issued_client_id.clone(),
        ext_agent_host_id: plan.host_id.clone(),
        id_token,
        access_token,
        refresh_token,
        token_type: tokens
            .token_type
            .clone()
            .unwrap_or_else(|| "Bearer".to_string()),
        expires_in: tokens.expires_in.unwrap_or(DEFAULT_EXPIRES_IN),
        scopes,
        saved_at: crate::domain::now_ms(),
        earliest_refresh_at: tokens.earliest_refresh_at.clone(),
        plan_usage,
        disconnected: false,
    };

    let provider_id = plan.provider_id.clone();
    config::update_oauth(&app, |store| {
        store
            .registrations
            .entry(provider_id.clone())
            .or_default()
            .insert(issued_client_id.clone(), registration.clone());
        store
            .active
            .insert(provider_id.clone(), issued_client_id.clone());
        Ok(())
    })?;

    Ok(registration_status(
        &provider_id,
        Some(&registration),
    ))
}

/// Waits for the pending login result (bounded by [`LOGIN_TTL`]).
pub async fn login_wait(
    state: &OAuthState,
    attempt_id: &str,
) -> Result<ProviderAuthStatus> {
    let (result, notify, expires_at, cancel) = {
        let pending = state.pending.lock();
        let Some(pending) = pending.as_ref() else {
            return Err(anyhow!("nenhum login em andamento"));
        };
        if pending.attempt_id != attempt_id {
            return Err(anyhow!("tentativa de login desconhecida"));
        }
        (
            pending.result.clone(),
            pending.notify.clone(),
            pending.expires_at,
            pending.cancel.clone(),
        )
    };

    loop {
        if let Some(outcome) = result.lock().take() {
            return match outcome {
                Ok(status) => Ok(status),
                Err(message) => Err(anyhow!(message)),
            };
        }
        if cancel.is_cancelled() {
            return Err(anyhow!("login cancelado"));
        }
        if crate::domain::now_ms() > expires_at {
            cancel.cancel();
            return Err(anyhow!("tempo esgotado aguardando o login no navegador"));
        }
        tokio::select! {
            _ = notify.notified() => {}
            _ = tokio::time::sleep(Duration::from_millis(150)) => {}
        }
    }
}

/// Cancels a pending login attempt.
pub fn login_cancel(state: &OAuthState, attempt_id: &str) -> Result<()> {
    let mut pending = state.pending.lock();
    let Some(current) = pending.as_ref() else {
        return Ok(());
    };
    if current.attempt_id != attempt_id {
        return Ok(());
    }
    if let Some(current) = pending.take() {
        current.cancel.cancel();
        *current.result.lock() = Some(Err("login cancelado".to_string()));
        current.notify.notify_waiters();
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Credential resolution / refresh                                     */
/* ------------------------------------------------------------------ */

fn expires_at_ms(registration: &StoredOAuthRegistration) -> i64 {
    registration.saved_at
        + i64::try_from(registration.expires_in.saturating_mul(1_000)).unwrap_or(i64::MAX)
}

fn usable(registration: &StoredOAuthRegistration) -> bool {
    !registration.disconnected && !registration.refresh_token.is_empty()
}

/// Returns a valid access token, refreshing it when needed. Single-flight per
/// provider (serialized across turns and, with the single-instance plugin,
/// across app instances through the config RMW lock).
pub async fn ensure_bearer(
    app: &AppHandle,
    state: &OAuthState,
    catalog: &CatalogFile,
    http: &reqwest::Client,
    provider_id: &str,
) -> Result<String> {
    resolve_bearer(app, state, catalog, http, provider_id, false).await
}

/// Forces a refresh (used once after a 401 before giving up).
pub async fn force_refresh(
    app: &AppHandle,
    state: &OAuthState,
    catalog: &CatalogFile,
    http: &reqwest::Client,
    provider_id: &str,
) -> Result<String> {
    resolve_bearer(app, state, catalog, http, provider_id, true).await
}

async fn resolve_bearer(
    app: &AppHandle,
    state: &OAuthState,
    catalog: &CatalogFile,
    http: &reqwest::Client,
    provider_id: &str,
    force: bool,
) -> Result<String> {
    let provider = provider(catalog, provider_id)?;
    let info = oauth_info(provider)?.clone();

    let (store, load_error) = config::oauth_snapshot(app);
    if let Some(error) = load_error {
        return Err(auth_error(AuthError::reauth(format!(
            "arquivo de credenciais inválido: {error}"
        ))));
    }
    let Some(registration) = active_registration(&store, provider_id) else {
        return Err(auth_error(AuthError::missing(
            "Nenhuma conta ChatGPT conectada para este provedor.",
        )));
    };
    if !usable(registration) {
        return Err(auth_error(AuthError::reauth(
            "Sua sessão do ChatGPT não pode ser renovada; entre novamente.",
        )));
    }
    if !registration.plan_usage {
        return Err(auth_error(AuthError::plan_disabled(
            "O uso do plano ChatGPT não foi autorizado para esta conta.",
        )));
    }
    if !force && !registration.access_token.is_empty() {
        let now = crate::domain::now_ms();
        if now + REFRESH_WINDOW_MS < expires_at_ms(registration) {
            return Ok(registration.access_token.clone());
        }
    }

    let client_id = registration.client_id.clone();
    let refresh_token = registration.refresh_token.clone();
    let lock = state.refresh_lock(provider_id);
    let _guard = lock.lock().await;

    // Another task/instance may have refreshed while we waited.
    let (store, _) = config::oauth_snapshot(app);
    let Some(current) = active_registration(&store, provider_id) else {
        return Err(auth_error(AuthError::reauth(
            "Registro do ChatGPT removido; entre novamente.",
        )));
    };
    if !force
        && current.access_token != registration.access_token
        && crate::domain::now_ms() + REFRESH_WINDOW_MS < expires_at_ms(current)
    {
        return Ok(current.access_token.clone());
    }
    if current.refresh_token != refresh_token {
        // Rotated elsewhere (another process): prefer its access token.
        if crate::domain::now_ms() + REFRESH_WINDOW_MS < expires_at_ms(current) {
            return Ok(current.access_token.clone());
        }
        return Err(auth_error(AuthError::reauth(
            "A sessão foi renovada em outro processo; tente novamente.",
        )));
    }

    let discovery = discovery(state, http, &info).await?;
    let epoch = state.epoch();
    let refreshed = match siwc::refresh_token(http, &discovery, &info, &client_id, &refresh_token)
        .await
    {
        Ok(tokens) => tokens,
        Err(error) => {
            let permanent = error
                .downcast_ref::<siwc::TokenError>()
                .is_some_and(siwc::TokenError::is_permanent_refresh_failure);
            if permanent {
                let _ = config::update_oauth(app, |store| {
                    if let Some(registrations) = store.registrations.get_mut(provider_id) {
                        if let Some(registration) = registrations.get_mut(&client_id) {
                            registration.disconnected = true;
                            registration.access_token.clear();
                            registration.refresh_token.clear();
                        }
                    }
                    Ok(())
                });
                return Err(auth_error(AuthError::reauth(
                    "Sua sessão do ChatGPT expirou; entre novamente para renová-la.",
                )));
            }
            return Err(auth_error(AuthError::network(format!(
                "Não foi possível renovar a sessão do ChatGPT: {error}"
            ))));
        }
    };

    let access_token = refreshed
        .access_token
        .clone()
        .filter(|token| !token.is_empty())
        .ok_or_else(|| auth_error(AuthError::network("refresh sem access_token")))?;
    let new_refresh = refreshed
        .refresh_token
        .clone()
        .filter(|token| !token.is_empty())
        .unwrap_or_else(|| refresh_token.clone());
    let new_scopes = if refreshed.scopes().is_empty() {
        current.scopes.clone()
    } else {
        refreshed.scopes()
    };
    let plan_usage = new_scopes
        .iter()
        .any(|scope| scope == &info.plan_usage_scope);
    let updated = StoredOAuthRegistration {
        access_token: access_token.clone(),
        refresh_token: new_refresh,
        id_token: refreshed
            .id_token
            .clone()
            .filter(|token| !token.is_empty())
            .unwrap_or_else(|| current.id_token.clone()),
        token_type: refreshed
            .token_type
            .clone()
            .unwrap_or_else(|| current.token_type.clone()),
        expires_in: refreshed.expires_in.unwrap_or(DEFAULT_EXPIRES_IN),
        scopes: new_scopes,
        saved_at: crate::domain::now_ms(),
        earliest_refresh_at: refreshed
            .earliest_refresh_at
            .clone()
            .or_else(|| current.earliest_refresh_at.clone()),
        plan_usage,
        disconnected: false,
        ..current.clone()
    };

    if state.epoch() != epoch {
        return Err(auth_error(AuthError::reauth(
            "As credenciais foram apagadas durante a renovação; entre novamente.",
        )));
    }

    config::update_oauth(app, |store| {
        // Re-check under the config RMW lock: a reset (or sign-out) may have
        // happened between the refresh response and this write. Without this
        // guard the refresh would recreate credentials after "apagar dados".
        if state.epoch() != epoch {
            anyhow::bail!("credenciais apagadas durante a renovação; entre novamente");
        }
        if let Some(registrations) = store.registrations.get_mut(provider_id) {
            if let Some(registration) = registrations.get_mut(&client_id) {
                *registration = updated.clone();
            }
        }
        Ok(())
    })
    .map_err(|_| {
        auth_error(AuthError::reauth(
            "As credenciais foram apagadas durante a renovação; entre novamente.",
        ))
    })?;

    if !plan_usage {
        return Err(auth_error(AuthError::plan_disabled(
            "O uso do plano ChatGPT não está autorizado; reautorize em Configurações → Provedores.",
        )));
    }
    Ok(access_token)
}

/* ------------------------------------------------------------------ */
/* Sign out                                                            */
/* ------------------------------------------------------------------ */

/// Revokes the renewable session (best effort with bounded retries), clears the
/// tokens and keeps the account/client mapping for a later sign-in.
pub async fn sign_out(
    app: &AppHandle,
    state: &OAuthState,
    catalog: &CatalogFile,
    http: &reqwest::Client,
    provider_id: &str,
) -> Result<ProviderAuthStatus> {
    let provider = provider(catalog, provider_id)?;
    let info = oauth_info(provider)?.clone();
    cancel_all(state);

    let (store, _) = config::oauth_snapshot(app);
    let registration = active_registration(&store, provider_id).cloned();
    let mut revocation_confirmed = true;
    if let Some(registration) = registration.as_ref() {
        if !registration.refresh_token.is_empty() {
            revocation_confirmed = false;
            if let Ok(discovery) = discovery(state, http, &info).await {
                for attempt in 1..=3_u32 {
                    match siwc::revoke(
                        http,
                        &discovery,
                        &registration.client_id,
                        &registration.refresh_token,
                    )
                    .await
                    {
                        Ok(()) => {
                            revocation_confirmed = true;
                            break;
                        }
                        Err(_) if attempt < 3 => {
                            tokio::time::sleep(Duration::from_millis(300 * u64::from(attempt))).await;
                        }
                        Err(_) => break,
                    }
                }
            }
        }
    }

    config::clear_oauth_tokens(app, provider_id)?;
    let mut status = status(app, provider_id);
    if !revocation_confirmed {
        status.hint = Some(
            "Sessão encerrada localmente; a revogação remota não foi confirmada. Você pode desconectar o app em ChatGPT → Configurações."
                .to_string(),
        );
    }
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registration() -> StoredOAuthRegistration {
        StoredOAuthRegistration {
            email: Some("user@example.com".into()),
            issuer: "https://auth.openai.com".into(),
            subject: "user-sub".into(),
            client_id: "oaiapp_1234567890abcdef".into(),
            ext_agent_host_id: "urn:uuid:12345678-1234-1234-1234-1234567890ab".into(),
            id_token: "id.jwt.token".into(),
            access_token: "access-token-value".into(),
            refresh_token: "refresh-token-value".into(),
            token_type: "Bearer".into(),
            expires_in: 3_600,
            scopes: vec![
                "openid".into(),
                "offline_access".into(),
                "chatgpt.tokens.use.direct".into(),
            ],
            saved_at: 1_000_000,
            earliest_refresh_at: None,
            plan_usage: true,
            disconnected: false,
        }
    }

    #[test]
    fn signed_out_without_registration() {
        let status = registration_status("openai", None);
        assert_eq!(status.state, "signed-out");
        assert_eq!(status.mode, "oauth");
        assert!(!status.plan_usage);
        assert!(status.account_label.is_none());
        assert!(status.client_id_masked.is_none());
    }

    #[test]
    fn signed_in_status_masks_ids_and_computes_expiry() {
        let status = registration_status("openai", Some(&registration()));
        assert_eq!(status.state, "signed-in");
        assert!(status.plan_usage);
        assert_eq!(status.account_label.as_deref(), Some("user@example.com"));
        assert_eq!(status.expires_at, Some(1_000_000 + 3_600_000));
        assert_eq!(status.scopes.len(), 3);
        // Masked, never the raw credential/id.
        let client = status.client_id_masked.clone().expect("client mask");
        assert!(client.starts_with("oaiapp_1"));
        assert!(client.contains('…'));
        assert!(!client.contains("1234567890abcdef"));
        let host = status.host_id_masked.clone().expect("host mask");
        assert!(host.starts_with("urn:uuid"));
        assert!(!host.contains("12345678-1234"));
        let serialized = serde_json::to_string(&status).expect("serialize");
        for token in ["access-token-value", "refresh-token-value", "id.jwt.token"] {
            assert!(!serialized.contains(token), "token vazou: {token}");
        }
    }

    #[test]
    fn plan_disabled_requires_reenabling_plan_usage() {
        let mut registration = registration();
        registration.plan_usage = false;
        let status = registration_status("openai", Some(&registration));
        assert_eq!(status.state, "plan-disabled");
        assert!(!status.plan_usage);
        assert!(status.hint.is_some());
    }

    #[test]
    fn disconnected_or_missing_refresh_requires_reauth() {
        let mut disconnected = registration();
        disconnected.disconnected = true;
        let status = registration_status("openai", Some(&disconnected));
        assert_eq!(status.state, "reauth-required");
        assert!(!status.plan_usage);

        let mut no_refresh = registration();
        no_refresh.refresh_token.clear();
        let status = registration_status("openai", Some(&no_refresh));
        assert_eq!(status.state, "reauth-required");
    }

    #[test]
    fn mask_never_reveals_short_or_full_values() {
        assert_eq!(mask(None), None);
        assert_eq!(mask(Some("   ")), None);
        assert_eq!(mask(Some("short")), Some("••••".to_string()));
        let masked = mask(Some("oaiapp_abcdefghijklmnop")).expect("masked");
        assert_eq!(masked, "oaiapp_a…mnop");
    }

    #[test]
    fn validate_callback_enforces_state_error_code_and_client_id() {
        let params = |state: Option<&str>, code: Option<&str>, client: Option<&str>| {
            loopback::CallbackParams {
                code: code.map(str::to_string),
                state: state.map(str::to_string),
                error: None,
                error_description: None,
                client_id: client.map(str::to_string),
                scope: None,
            }
        };

        // Happy path, first registration: the issued id is returned.
        let first = params(Some("s1"), Some("code"), Some("oaiapp_new"));
        assert_eq!(
            validate_callback("s1", "dynamic_agent_client", true, &first).expect("ok"),
            "oaiapp_new"
        );

        // Reauthorization without a callback client id keeps the stored one.
        let reauth = params(Some("s1"), Some("code"), None);
        assert_eq!(
            validate_callback("s1", "oaiapp_old", false, &reauth).expect("ok"),
            "oaiapp_old"
        );

        // A different client id on reauthorization is rejected.
        let mismatch = params(Some("s1"), Some("code"), Some("oaiapp_other"));
        assert!(validate_callback("s1", "oaiapp_old", false, &mismatch).is_err());

        // CSRF: wrong state is rejected before anything else.
        let wrong_state = params(Some("evil"), Some("code"), Some("oaiapp_new"));
        assert!(validate_callback("s1", "dynamic_agent_client", true, &wrong_state).is_err());

        // access_denied stops the flow.
        let mut denied = params(Some("s1"), None, None);
        denied.error = Some("access_denied".into());
        denied.error_description = Some("user declined".into());
        assert!(validate_callback("s1", "dynamic_agent_client", true, &denied).is_err());

        // Missing code is rejected.
        let missing_code = params(Some("s1"), Some("   "), Some("oaiapp_new"));
        assert!(validate_callback("s1", "dynamic_agent_client", true, &missing_code).is_err());

        // First registration without the issued id is incomplete.
        let incomplete = params(Some("s1"), Some("code"), None);
        assert!(validate_callback("s1", "dynamic_agent_client", true, &incomplete).is_err());
    }
}
