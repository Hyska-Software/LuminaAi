//! Loopback OAuth callback server.
//!
//! Binds `127.0.0.1:<ephemeral>` (only the port may vary, per the Sign in with
//! ChatGPT contract), serves exactly one `/auth/callback` request and returns
//! its query parameters. Every other path gets a 404 and the loop continues, so
//! browser favicon/probe requests cannot consume the callback.

use std::collections::HashMap;
use std::time::Duration;

use anyhow::{anyhow, Result};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_util::sync::CancellationToken;

const CALLBACK_PATH: &str = "/auth/callback";
const MAX_REQUEST_BYTES: usize = 16 * 1024;
const MAX_CONNECTIONS: usize = 16;

/// Parameters received on the loopback callback.
#[derive(Debug, Default, Clone)]
pub struct CallbackParams {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
    /// Issued client id, present on first-time dynamic registration.
    pub client_id: Option<String>,
    pub scope: Option<String>,
}

impl CallbackParams {
    fn from_query(query: &str) -> Self {
        let map = parse_query(query);
        Self {
            code: map.get("code").cloned(),
            state: map.get("state").cloned(),
            error: map.get("error").cloned(),
            error_description: map.get("error_description").cloned(),
            client_id: map.get("client_id").cloned(),
            scope: map.get("scope").cloned(),
        }
    }
}

/// Starts a listener on `127.0.0.1` with an ephemeral port.
pub async fn bind(host: &str) -> Result<(TcpListener, u16)> {
    let listener = TcpListener::bind((host, 0))
        .await
        .map_err(|error| {
            anyhow!(crate::i18n::t_args(
                "oauth.errors.callbackBind",
                &[("host", host), ("error", &error.to_string())],
            ))
        })?;
    let port = listener
        .local_addr()
        .map_err(|error| {
            anyhow!(crate::i18n::t_args(
                "oauth.errors.callbackNoPort",
                &[("error", &error.to_string())],
            ))
        })?
        .port();
    Ok((listener, port))
}

/// Serves until one matching callback arrives (or the attempt is cancelled).
pub async fn serve_once(
    listener: TcpListener,
    cancel: CancellationToken,
) -> Result<CallbackParams> {
    for _ in 0..MAX_CONNECTIONS {
        let (mut stream, _) = tokio::select! {
            _ = cancel.cancelled() => return Err(anyhow!(crate::i18n::t("oauth.errors.loginCancelled"))),
            accepted = listener.accept() => match accepted {
                Ok(value) => value,
                Err(error) => return Err(anyhow!(crate::i18n::t_args(
                    "oauth.errors.callbackAccept",
                    &[("error", &error.to_string())],
                ))),
            },
        };

        let request = match read_request(&mut stream).await {
            Ok(request) => request,
            Err(_) => {
                respond(
                    &mut stream,
                    400,
                    &crate::i18n::t("oauth.callback.invalidRequest"),
                    None,
                )
                .await;
                continue;
            }
        };

        let Some((path, query)) = split_target(&request) else {
            respond(&mut stream, 404, &crate::i18n::t("oauth.callback.notFound"), None).await;
            continue;
        };

        if path != CALLBACK_PATH {
            respond(&mut stream, 404, &crate::i18n::t("oauth.callback.notFound"), None).await;
            continue;
        }

        let params = CallbackParams::from_query(&query);
        let (title, message) = if params.error.is_some() {
            (
                crate::i18n::t("oauth.callback.loginFailedTitle"),
                params
                    .error_description
                    .clone()
                    .unwrap_or_else(|| crate::i18n::t("oauth.callback.denied")),
            )
        } else {
            (
                crate::i18n::t("oauth.callback.connectedTitle"),
                crate::i18n::t("oauth.callback.connectedBody"),
            )
        };
        respond(&mut stream, 200, &title, Some(&message)).await;
        return Ok(params);
    }
    Err(anyhow!(crate::i18n::t("oauth.errors.noValidCallback")))
}

async fn read_request(stream: &mut TcpStream) -> Result<String> {
    let mut buffer = vec![0_u8; MAX_REQUEST_BYTES];
    let read = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buffer))
        .await
        .map_err(|_| anyhow!(crate::i18n::t("oauth.errors.callbackTimeout")))?
        .map_err(|error| {
            anyhow!(crate::i18n::t_args(
                "oauth.errors.callbackRead",
                &[("error", &error.to_string())],
            ))
        })?;
    let text = String::from_utf8_lossy(&buffer[..read]).to_string();
    // Only the request line is needed; the browser may send headers after it.
    let first = text
        .lines()
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .ok_or_else(|| anyhow!(crate::i18n::t("oauth.errors.callbackEmpty")))?;
    Ok(first.to_string())
}

/// `GET /path?query HTTP/1.1` -> (`/path`, `query`).
fn split_target(request_line: &str) -> Option<(String, String)> {
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?;
    if !method.eq_ignore_ascii_case("GET") {
        return None;
    }
    let target = parts.next()?;
    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path, query),
        None => (target, ""),
    };
    Some((path.to_string(), query.to_string()))
}

fn parse_query(query: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        map.insert(percent_decode(key), percent_decode(value));
    }
    map
}

fn percent_decode(value: &str) -> String {
    let bytes = value.replace('+', " ");
    let bytes = bytes.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = (bytes[index + 1] as char).to_digit(16);
            let low = (bytes[index + 2] as char).to_digit(16);
            if let (Some(high), Some(low)) = (high, low) {
                out.push((high * 16 + low) as u8);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

async fn respond(stream: &mut TcpStream, status: u16, title: &str, message: Option<&str>) {
    let body = page(title, message);
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        _ => "Not Found",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;
}

fn page(title: &str, message: Option<&str>) -> String {
    let language = crate::i18n::language();
    let title = escape_html(title);
    let message = message
        .map(|message| format!("<p>{}</p>", escape_html(message)))
        .unwrap_or_default();
    format!(
        "<!doctype html><html lang=\"{language}\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>{title}</title><style>body{{font-family:system-ui,sans-serif;background:#0b0d12;color:#e6e8ee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}}main{{max-width:420px;padding:32px;text-align:center}}h1{{font-size:20px;margin:0 0 12px}}p{{color:#9aa3b2;font-size:14px;line-height:1.5}}</style></head><body><main><h1>{title}</h1>{message}</main></body></html>"
    )
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt as _;

    #[test]
    fn parses_the_request_line_and_query() {
        let (path, query) =
            split_target("GET /auth/callback?code=abc&state=x%2Fy HTTP/1.1").expect("parse");
        assert_eq!(path, "/auth/callback");
        let params = CallbackParams::from_query(&query);
        assert_eq!(params.code.as_deref(), Some("abc"));
        assert_eq!(params.state.as_deref(), Some("x/y"));
    }

    #[test]
    fn rejects_non_get_methods_and_decodes_plus_as_space() {
        assert!(split_target("POST /auth/callback HTTP/1.1").is_none());
        let params = CallbackParams::from_query("error=access_denied&error_description=User+denied");
        assert_eq!(params.error.as_deref(), Some("access_denied"));
        assert_eq!(params.error_description.as_deref(), Some("User denied"));
    }

    #[test]
    fn escapes_html_in_the_callback_page() {
        let html = page("<script>", Some("a & b"));
        assert!(html.contains("&lt;script&gt;"));
        assert!(html.contains("a &amp; b"));
        assert!(!html.contains("<script>"));
    }

    #[tokio::test]
    async fn serves_the_callback_over_tcp_and_returns_its_parameters() {
        let (listener, port) = bind("127.0.0.1").await.expect("bind");
        let server = tokio::spawn(serve_once(listener, CancellationToken::new()));
        let mut client = TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("connect");
        client
            .write_all(b"GET /auth/callback?code=abc&state=s1&client_id=oaiapp_x HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            .await
            .expect("write");
        let mut response = String::new();
        client
            .read_to_string(&mut response)
            .await
            .expect("read response");
        assert!(response.starts_with("HTTP/1.1 200"));
        assert!(response.contains("Conta conectada"));
        let params = server.await.expect("server task").expect("params");
        assert_eq!(params.code.as_deref(), Some("abc"));
        assert_eq!(params.client_id.as_deref(), Some("oaiapp_x"));
    }

    #[tokio::test]
    async fn ignores_other_paths_until_the_callback_arrives() {
        let (listener, port) = bind("127.0.0.1").await.expect("bind");
        let server = tokio::spawn(serve_once(listener, CancellationToken::new()));

        let mut favicon = TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("connect");
        favicon
            .write_all(b"GET /favicon.ico HTTP/1.1\r\n\r\n")
            .await
            .expect("write favicon");
        let mut ignored = String::new();
        let _ = favicon.read_to_string(&mut ignored).await;
        assert!(ignored.starts_with("HTTP/1.1 404"));

        let mut client = TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("connect");
        client
            .write_all(b"GET /auth/callback?code=ok HTTP/1.1\r\n\r\n")
            .await
            .expect("write");
        let params = server.await.expect("server task").expect("params");
        assert_eq!(params.code.as_deref(), Some("ok"));
    }

    #[tokio::test]
    async fn cancellation_stops_the_server() {
        let (listener, _port) = bind("127.0.0.1").await.expect("bind");
        let cancel = CancellationToken::new();
        cancel.cancel();
        let error = serve_once(listener, cancel).await.expect_err("cancelado");
        assert!(format!("{error}").contains("cancelado"));
    }
}
