//! GitHub REST/GraphQL client used by the PR and Issue surfaces.
//!
//! The token never leaves the backend: commands resolve it from
//! `secrets.json`/environment/`gh` CLI and every request is built here. Errors
//! are mapped to localized messages so the renderer only has to show them.

pub mod filters;
pub mod map;
pub mod remote;
pub mod wire;

use std::time::Duration;

use reqwest::{Method, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};

pub use remote::{parse_remote_url, GitHubRepoRef};

const ACCEPT: &str = "application/vnd.github+json";
const API_VERSION: &str = "2022-11-28";
/// Read calls are cheap but can be slow on big repositories.
const READ_TIMEOUT: Duration = Duration::from_secs(30);
/// Mutations wait for GitHub-side work (merge, checks).
const WRITE_TIMEOUT: Duration = Duration::from_secs(60);

/// Failure of a GitHub request, already classified for the UI.
#[derive(Debug)]
pub enum GitHubError {
    Network(String),
    Timeout,
    Unauthorized,
    Forbidden(String),
    /// Rate limit exhausted; `reset_ms` is the epoch in ms reported by GitHub.
    RateLimited { reset_ms: Option<i64> },
    NotFound,
    Conflict(String),
    Validation(String),
    Server(u16),
    /// Local precondition failed (no remote, no token, GHES without GraphQL…).
    Unsupported(String),
}

impl GitHubError {
    pub fn message(&self) -> String {
        use crate::i18n::{t, t_args};
        match self {
            Self::Network(detail) => t_args("github.errors.network", &[("detail", detail.as_str())]),
            Self::Timeout => t("github.errors.timeout"),
            Self::Unauthorized => t("github.errors.unauthorized"),
            Self::Forbidden(detail) => {
                t_args("github.errors.forbidden", &[("detail", detail.as_str())])
            }
            Self::RateLimited { reset_ms } => match reset_ms {
                Some(ms) => t_args(
                    "github.errors.rateLimitedUntil",
                    &[("time", crate::i18n::format_datetime(*ms).as_str())],
                ),
                None => t("github.errors.rateLimited"),
            },
            Self::NotFound => t("github.errors.notFound"),
            Self::Conflict(detail) => {
                t_args("github.errors.conflict", &[("detail", detail.as_str())])
            }
            Self::Validation(detail) => {
                t_args("github.errors.validation", &[("detail", detail.as_str())])
            }
            Self::Server(status) => {
                let status = status.to_string();
                t_args("github.errors.server", &[("status", status.as_str())])
            }
            Self::Unsupported(detail) => detail.clone(),
        }
    }
}

fn header_i64(response: &Response, name: &str) -> Option<i64> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<i64>().ok())
}

/// `Link: <…?page=2>; rel="next", <…?page=5>; rel="last"`.
fn link_has_next(value: &str) -> bool {
    value
        .split(',')
        .any(|part| part.contains("rel=\"next\""))
}

fn has_next_page(response: &Response) -> bool {
    response
        .headers()
        .get("link")
        .and_then(|value| value.to_str().ok())
        .map(link_has_next)
        .unwrap_or(false)
}

/// Extracts the human message GitHub sends in the error body.
fn api_error_detail(body: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(body) else {
        return body.trim().chars().take(200).collect();
    };
    let message = value
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let mut details: Vec<String> = value
        .get("errors")
        .and_then(Value::as_array)
        .map(|errors| {
            errors
                .iter()
                .filter_map(|entry| {
                    entry
                        .get("message")
                        .and_then(Value::as_str)
                        .or_else(|| entry.as_str())
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default();
    details.retain(|entry| !entry.trim().is_empty());
    if details.is_empty() {
        message
    } else if message.is_empty() {
        details.join("; ")
    } else {
        format!("{message} ({})", details.join("; "))
    }
}

async fn map_status(response: Response) -> GitHubError {
    let status = response.status();
    let remaining = header_i64(&response, "x-ratelimit-remaining");
    let reset = header_i64(&response, "x-ratelimit-reset");
    let body = response.text().await.unwrap_or_default();
    let detail = api_error_detail(&body);
    let rate_limited = status == StatusCode::TOO_MANY_REQUESTS
        || (status == StatusCode::FORBIDDEN && remaining == Some(0));
    if rate_limited {
        return GitHubError::RateLimited {
            reset_ms: reset.map(|seconds| seconds.saturating_mul(1000)),
        };
    }
    match status {
        StatusCode::UNAUTHORIZED => GitHubError::Unauthorized,
        StatusCode::FORBIDDEN => GitHubError::Forbidden(detail),
        StatusCode::NOT_FOUND => GitHubError::NotFound,
        StatusCode::CONFLICT | StatusCode::METHOD_NOT_ALLOWED => GitHubError::Conflict(detail),
        StatusCode::UNPROCESSABLE_ENTITY | StatusCode::BAD_REQUEST => {
            GitHubError::Validation(detail)
        }
        _ => GitHubError::Server(status.as_u16()),
    }
}

fn map_request_error(error: reqwest::Error) -> GitHubError {
    if error.is_timeout() {
        return GitHubError::Timeout;
    }
    GitHubError::Network(error.to_string())
}

fn parse_json<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, GitHubError> {
    serde_json::from_slice(bytes).map_err(|error| GitHubError::Network(error.to_string()))
}

/// Thin authenticated client bound to one API base and token.
#[derive(Clone)]
pub struct GitHubClient {
    http: reqwest::Client,
    base: String,
    token: String,
}

impl std::fmt::Debug for GitHubClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GitHubClient")
            .field("base", &self.base)
            .field("token", &"<redacted>")
            .finish()
    }
}

impl GitHubClient {
    pub fn new(http: reqwest::Client, base: impl Into<String>, token: impl Into<String>) -> Self {
        Self {
            http,
            base: base.into(),
            token: token.into(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base.trim_end_matches('/'), path)
    }

    fn builder(&self, method: Method, path: &str, timeout: Duration) -> reqwest::RequestBuilder {
        self.http
            .request(method, self.url(path))
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Accept", ACCEPT)
            .header("X-GitHub-Api-Version", API_VERSION)
            .timeout(timeout)
    }

    async fn execute(
        &self,
        method: Method,
        path: &str,
        query: &[(String, String)],
        body: Option<Value>,
        timeout: Duration,
    ) -> Result<Response, GitHubError> {
        let mut request = self.builder(method, path, timeout);
        if !query.is_empty() {
            request = request.query(query);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(map_request_error)?;
        if !response.status().is_success() {
            return Err(map_status(response).await);
        }
        Ok(response)
    }

    pub async fn get<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(String, String)],
    ) -> Result<T, GitHubError> {
        let response = self
            .execute(Method::GET, path, query, None, READ_TIMEOUT)
            .await?;
        let bytes = response.bytes().await.map_err(map_request_error)?;
        parse_json(&bytes)
    }

    /// GET a JSON envelope and the `Link` flag (`/search/issues` returns an
    /// object, unlike the bare arrays of the other list endpoints).
    pub async fn get_envelope<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(String, String)],
    ) -> Result<(T, bool), GitHubError> {
        let response = self
            .execute(Method::GET, path, query, None, READ_TIMEOUT)
            .await?;
        let has_next = has_next_page(&response);
        let bytes = response.bytes().await.map_err(map_request_error)?;
        Ok((parse_json(&bytes)?, has_next))
    }

    /// GET with the response headers (used to read `x-oauth-scopes`).
    pub async fn get_with_headers<T: DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<(T, reqwest::header::HeaderMap), GitHubError> {
        let response = self
            .execute(Method::GET, path, &[], None, READ_TIMEOUT)
            .await?;
        let headers = response.headers().clone();
        let bytes = response.bytes().await.map_err(map_request_error)?;
        Ok((parse_json(&bytes)?, headers))
    }

    async fn send_json<B: Serialize, T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: &B,
    ) -> Result<T, GitHubError> {
        let value =
            serde_json::to_value(body).map_err(|error| GitHubError::Network(error.to_string()))?;
        let response = self
            .execute(method, path, &[], Some(value), WRITE_TIMEOUT)
            .await?;
        let bytes = response.bytes().await.map_err(map_request_error)?;
        parse_json(&bytes)
    }

    pub async fn post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, GitHubError> {
        self.send_json(Method::POST, path, body).await
    }

    pub async fn patch<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, GitHubError> {
        self.send_json(Method::PATCH, path, body).await
    }

    pub async fn put<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, GitHubError> {
        self.send_json(Method::PUT, path, body).await
    }

    pub async fn delete(&self, path: &str) -> Result<(), GitHubError> {
        self.execute(Method::DELETE, path, &[], None, WRITE_TIMEOUT)
            .await
            .map(|_| ())
    }

    /// DELETE with a JSON body (`unrequest reviewers` requires it).
    pub async fn delete_with_body<B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<(), GitHubError> {
        let value =
            serde_json::to_value(body).map_err(|error| GitHubError::Network(error.to_string()))?;
        self.execute(Method::DELETE, path, &[], Some(value), WRITE_TIMEOUT)
            .await
            .map(|_| ())
    }

    /// GraphQL request (only used on github.com for draft/ready transitions).
    pub async fn graphql<T: DeserializeOwned>(
        &self,
        query: &str,
        variables: Value,
    ) -> Result<T, GitHubError> {
        let response = self
            .execute(
                Method::POST,
                "/graphql",
                &[],
                Some(json!({ "query": query, "variables": variables })),
                WRITE_TIMEOUT,
            )
            .await?;
        let bytes = response.bytes().await.map_err(map_request_error)?;
        let value: Value = parse_json(&bytes)?;
        if let Some(errors) = value.get("errors").and_then(Value::as_array) {
            let message = errors
                .iter()
                .filter_map(|entry| entry.get("message").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("; ");
            if !message.trim().is_empty() {
                return Err(GitHubError::Validation(message));
            }
        }
        let data = value.get("data").cloned().unwrap_or(Value::Null);
        serde_json::from_value(data).map_err(|error| GitHubError::Network(error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn link_header_detects_the_next_page() {
        assert!(link_has_next(
            "<https://api.github.com/repos/o/r/pulls?page=2>; rel=\"next\", \
             <https://api.github.com/repos/o/r/pulls?page=4>; rel=\"last\""
        ));
        assert!(!link_has_next(
            "<https://api.github.com/repos/o/r/pulls?page=1>; rel=\"prev\""
        ));
        assert!(!link_has_next(""));
    }

    #[test]
    fn api_error_detail_joins_message_and_errors() {
        let body = r#"{"message":"Validation Failed","errors":[{"message":"base is invalid"},{"message":"head is invalid"}]}"#;
        assert_eq!(
            api_error_detail(body),
            "Validation Failed (base is invalid; head is invalid)"
        );
        assert_eq!(api_error_detail(r#"{"message":"Not Found"}"#), "Not Found");
        assert_eq!(api_error_detail("plain text"), "plain text");
    }

    #[test]
    fn client_debug_never_prints_the_token() {
        let client = GitHubClient::new(
            reqwest::Client::new(),
            "https://api.github.com",
            "ghp_supersecret",
        );
        let rendered = format!("{client:?}");
        assert!(!rendered.contains("ghp_supersecret"));
        assert!(rendered.contains("<redacted>"));
    }

    #[test]
    fn unsupported_errors_carry_their_localized_message() {
        let error = GitHubError::Unsupported("no GitHub remote".to_string());
        assert_eq!(error.message(), "no GitHub remote");
    }
}
