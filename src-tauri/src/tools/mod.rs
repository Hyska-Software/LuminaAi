//! Agent tools: web search, page fetching and file creation (artifacts).

use crate::db::Db;
use crate::domain::{Artifact, Citation, Settings, ToolCallRecord, TurnOptions};
use crate::providers::ToolDefinition;

pub mod create_file;
pub mod fetch_url;
pub mod render_ui;
pub mod web_search;

#[derive(Clone)]
pub struct ToolRuntime {
    pub app: tauri::AppHandle,
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
    let _ = options;
    todo!("implemented by the tools module")
}

/// Execute a tool call. Must never panic: failures are returned as `ToolOutcome::error`.
pub async fn execute(rt: &ToolRuntime, call: &ToolCallRecord) -> ToolOutcome {
    let _ = (rt, call);
    todo!("implemented by the tools module")
}

/* ------------------------------------------------------------------ */
/* Shared helpers used by the concrete tools                           */
/* ------------------------------------------------------------------ */

pub(crate) fn json_str(value: &serde_json::Value, key: &str) -> Option<String> {
    value.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

pub(crate) fn json_u32(value: &serde_json::Value, key: &str) -> Option<u32> {
    value
        .get(key)
        .and_then(|v| v.as_u64())
        .and_then(|v| u32::try_from(v).ok())
}
