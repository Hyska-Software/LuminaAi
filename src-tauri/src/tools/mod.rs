//! Agent tools: web search, page fetching and file creation (artifacts).

use std::time::Duration;

use once_cell::sync::Lazy;
use serde_json::{json, Value};

use crate::db::Db;
use crate::domain::{Artifact, Citation, Settings, ToolCallRecord, TurnOptions};
use crate::providers::ToolDefinition;

pub mod create_file;
pub mod fetch_url;
pub mod render_ui;
pub mod web_search;

/// Upper bound for the text fed back to the model from a single tool call.
pub const MAX_TOOL_RESULT_CHARS: usize = 120_000;

pub(crate) const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
     AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

#[derive(Clone)]
pub struct ToolRuntime {
    /// Missing in unit tests that exercise the harness without a Tauri app.
    pub app: Option<tauri::AppHandle>,
    pub db: std::sync::Arc<Db>,
    pub http: reqwest::Client,
    pub conversation_id: String,
    pub message_id: String,
    pub settings: Settings,
    pub options: TurnOptions,
}

#[derive(Debug, Clone, Default)]
pub struct ToolOutcome {
    /// Text fed back to the model as the tool result.
    pub content: String,
    /// Short human readable summary shown on the tool card.
    pub summary: Option<String>,
    pub citations: Vec<Citation>,
    pub artifacts: Vec<Artifact>,
    pub is_error: bool,
}

impl ToolOutcome {
    pub fn text(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            ..Default::default()
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            content: format!("ERROR: {}", message.into()),
            is_error: true,
            ..Default::default()
        }
    }
}

/// Tool definitions exposed to the model for the current turn.
pub fn definitions(options: &TurnOptions) -> Vec<ToolDefinition> {
    let mut tools = Vec::new();
    if options.web_search {
        tools.push(web_search::definition());
    }
    tools.push(fetch_url::definition());
    if options.create_files {
        tools.push(create_file::definition());
    }
    tools
}

/// Execute a tool call. Must never panic: failures are returned as `ToolOutcome::error`.
pub async fn execute(rt: &ToolRuntime, call: &ToolCallRecord) -> ToolOutcome {
    let arguments = match parse_arguments(&call.arguments) {
        Ok(arguments) => arguments,
        Err(error) => return ToolOutcome::error(error),
    };

    let outcome = match call.name.as_str() {
        "web_search" if !rt.options.web_search => {
            ToolOutcome::error("a busca web está desativada nesta conversa")
        }
        "web_search" => web_search::run(rt, &arguments).await,
        "fetch_url" => fetch_url::run(rt, &arguments).await,
        "create_file" if !rt.options.create_files => {
            ToolOutcome::error("a criação de arquivos está desativada nesta conversa")
        }
        "create_file" => create_file::run(rt, &arguments).await,
        other => ToolOutcome::error(format!("ferramenta desconhecida: {other}")),
    };
    truncate_outcome(outcome)
}

fn parse_arguments(raw: &str) -> Result<Value, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(json!({}));
    }
    match serde_json::from_str::<Value>(trimmed) {
        Ok(Value::Null) => Ok(json!({})),
        Ok(Value::Object(map)) => Ok(Value::Object(map)),
        Ok(_) => Err("os argumentos da ferramenta devem ser um objeto JSON".to_string()),
        Err(error) => Err(format!("argumentos da ferramenta não são JSON válido: {error}")),
    }
}

fn truncate_outcome(mut outcome: ToolOutcome) -> ToolOutcome {
    if outcome.content.chars().count() > MAX_TOOL_RESULT_CHARS {
        outcome.content = truncate_chars(&outcome.content, MAX_TOOL_RESULT_CHARS);
        outcome.content.push_str("\n\n[resultado truncado para caber no contexto]");
    }
    outcome
}

/// Shared HTTP client for search and page fetching (browser-like headers).
pub(crate) fn browser_client() -> &'static reqwest::Client {
    static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
        reqwest::Client::builder()
            .user_agent(BROWSER_UA)
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::limited(6))
            .gzip(true)
            .brotli(true)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    });
    &CLIENT
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

pub(crate) fn json_str(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

pub(crate) fn json_u32(value: &Value, key: &str) -> Option<u32> {
    value
        .get(key)
        .and_then(|v| v.as_u64())
        .and_then(|v| u32::try_from(v).ok())
}

pub(crate) fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    text.chars().take(max).collect()
}

/// Collapse runs of whitespace into single spaces and trim the result.
pub(crate) fn clean_inline(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    for word in text.split_whitespace() {
        if !output.is_empty() {
            output.push(' ');
        }
        output.push_str(word);
    }
    output
}

/// Normalize extracted article text: single spaces inside lines, at most one
/// blank line between blocks.
pub(crate) fn normalize_blocks(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut blank_lines = 0usize;
    for line in text.lines() {
        let cleaned = clean_inline(line);
        if cleaned.is_empty() {
            blank_lines += 1;
            if blank_lines <= 1 && !output.is_empty() {
                output.push('\n');
            }
        } else {
            blank_lines = 0;
            output.push_str(&cleaned);
            output.push('\n');
        }
    }
    output.trim().to_string()
}

pub(crate) fn host_of(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let host = parsed.host_str()?;
    Some(host.trim_start_matches("www.").to_string())
}

/// Stable, unique citation id derived from the source URL.
pub(crate) fn citation_id(url: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    url.hash(&mut hasher);
    format!("src-{:016x}", hasher.finish())
}

pub(crate) fn selector(query: &str) -> Option<scraper::Selector> {
    scraper::Selector::parse(query).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::TurnOptions;

    #[test]
    fn definitions_respect_turn_options() {
        let mut options = TurnOptions::default();
        options.web_search = true;
        options.create_files = true;
        let names: Vec<String> = definitions(&options).into_iter().map(|tool| tool.name).collect();
        assert_eq!(names, vec!["web_search", "fetch_url", "create_file"]);

        options.web_search = false;
        options.create_files = false;
        let names: Vec<String> = definitions(&options).into_iter().map(|tool| tool.name).collect();
        assert_eq!(names, vec!["fetch_url"]);
    }

    #[test]
    fn parses_tool_arguments() {
        assert!(parse_arguments("").unwrap().is_object());
        assert!(parse_arguments("{\"query\":\"rust\"}").unwrap().is_object());
        assert!(parse_arguments("[1,2]").is_err());
        assert!(parse_arguments("{oops").is_err());
    }

    #[test]
    fn cleans_and_truncates_text() {
        assert_eq!(clean_inline("  olá   mundo \n"), "olá mundo");
        assert_eq!(truncate_chars("abcdef", 3), "abc");
        assert_eq!(host_of("https://www.example.com/a/b"), Some("example.com".to_string()));
    }
}
