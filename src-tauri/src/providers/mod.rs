//! Provider layer: one neutral request model, four wire protocols.
//!
//! Adapters (`openai_chat`, `openai_responses`, `anthropic`, `google`) translate
//! the neutral request below into the provider wire format, stream SSE events
//! and emit `ProviderEvent`s. `stream_completion` is responsible for protocol
//! fallback (the OpenCode gateway answers `ModelProtocolUnsupported` when a
//! model does not accept the requested protocol).

pub mod anthropic;
pub mod google;
pub mod openai_chat;
pub mod openai_responses;
pub mod reasoning;
pub mod sse;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::catalog::ModelInfo;
use crate::domain::UsageInfo;

/* ------------------------------------------------------------------ */
/* Protocol                                                            */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WireProtocol {
    OpenaiChat,
    OpenaiResponses,
    Anthropic,
    Google,
}

impl WireProtocol {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::OpenaiChat => "openai-chat",
            Self::OpenaiResponses => "openai-responses",
            Self::Anthropic => "anthropic",
            Self::Google => "google",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "openai-chat" => Some(Self::OpenaiChat),
            "openai-responses" => Some(Self::OpenaiResponses),
            "anthropic" => Some(Self::Anthropic),
            "google" => Some(Self::Google),
            _ => None,
        }
    }
}

/* ------------------------------------------------------------------ */
/* Neutral conversation model                                          */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HistoryRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone)]
pub struct ImagePart {
    pub mime_type: String,
    pub data_base64: String,
}

#[derive(Debug, Clone)]
pub struct HistoryToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone)]
pub struct HistoryMessage {
    pub role: HistoryRole,
    pub text: String,
    pub images: Vec<ImagePart>,
    pub reasoning: Option<String>,
    /// Anthropic thinking signature (replayed to keep extended thinking valid).
    pub reasoning_signature: Option<String>,
    pub tool_calls: Vec<HistoryToolCall>,
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    /// Verbatim provider payload from the previous assistant turn.
    pub provider_state: Option<Value>,
}

impl HistoryMessage {
    pub fn system(text: impl Into<String>) -> Self {
        Self {
            role: HistoryRole::System,
            text: text.into(),
            images: Vec::new(),
            reasoning: None,
            reasoning_signature: None,
            tool_calls: Vec::new(),
            tool_call_id: None,
            tool_name: None,
            provider_state: None,
        }
    }

    pub fn user(text: impl Into<String>) -> Self {
        Self {
            role: HistoryRole::User,
            text: text.into(),
            images: Vec::new(),
            reasoning: None,
            reasoning_signature: None,
            tool_calls: Vec::new(),
            tool_call_id: None,
            tool_name: None,
            provider_state: None,
        }
    }

    pub fn assistant(text: impl Into<String>) -> Self {
        Self {
            role: HistoryRole::Assistant,
            text: text.into(),
            images: Vec::new(),
            reasoning: None,
            reasoning_signature: None,
            tool_calls: Vec::new(),
            tool_call_id: None,
            tool_name: None,
            provider_state: None,
        }
    }

    pub fn tool_result(
        tool_call_id: impl Into<String>,
        tool_name: impl Into<String>,
        content: impl Into<String>,
    ) -> Self {
        Self {
            role: HistoryRole::Tool,
            text: content.into(),
            images: Vec::new(),
            reasoning: None,
            reasoning_signature: None,
            tool_calls: Vec::new(),
            tool_call_id: Some(tool_call_id.into()),
            tool_name: Some(tool_name.into()),
            provider_state: None,
        }
    }
}

/* ------------------------------------------------------------------ */
/* Request                                                             */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone)]
pub struct ProviderConfig {
    pub provider_id: String,
    pub provider_name: String,
    pub base_url: String,
    pub api_key: String,
    pub model: ModelInfo,
    /// Stable id sent as `x-opencode-session` for routing / prompt caching.
    pub session_id: String,
    pub user_agent: String,
}

#[derive(Debug, Clone)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Debug, Clone)]
pub enum ReasoningRequest {
    /// Let the provider default decide (no explicit parameter).
    Auto,
    Off,
    Effort(String),
    Budget(u32),
}

impl ReasoningRequest {
    pub fn is_auto(&self) -> bool {
        matches!(self, Self::Auto)
    }
}

#[derive(Debug, Clone)]
pub struct CompletionRequest {
    pub config: ProviderConfig,
    /// Protocols to try, in order.
    pub protocols: Vec<WireProtocol>,
    pub history: Vec<HistoryMessage>,
    pub system_prompt: String,
    pub tools: Vec<ToolDefinition>,
    pub reasoning: ReasoningRequest,
    pub max_output_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub cancel: CancellationToken,
}

/* ------------------------------------------------------------------ */
/* Streaming events                                                    */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone)]
pub enum ProviderEvent {
    ReasoningDelta(String),
    TextDelta(String),
    ToolCallStart {
        index: usize,
        id: String,
        name: String,
    },
    ToolCallArgsDelta {
        index: usize,
        delta: String,
    },
    ToolCallDone {
        index: usize,
        arguments: String,
    },
    Usage(UsageInfo),
    /// Raw assistant payload used for stateless replay in the next step.
    ProviderState(Value),
    Done {
        stop_reason: Option<String>,
    },
}

pub type EventSink = tokio::sync::mpsc::UnboundedSender<ProviderEvent>;

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("model does not support this protocol")]
    UnsupportedProtocol(String),
    #[error("unauthorized: {0}")]
    Unauthorized(String),
    #[error("rate limited: {0}")]
    RateLimited(String),
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("provider error: {0}")]
    Other(String),
}

pub type ProviderResult<T> = Result<T, ProviderError>;

impl ProviderError {
    /// Build a typed error from an HTTP status + response body.
    pub fn from_http(status: u16, body: &str) -> Self {
        let lower = body.to_lowercase();
        if lower.contains("modelprotocolunsupported") || lower.contains("does not support this protocol") {
            return Self::UnsupportedProtocol(body.to_string());
        }
        match status {
            401 | 403 => Self::Unauthorized(body.to_string()),
            429 => Self::RateLimited(body.to_string()),
            400 | 404 | 422 => Self::BadRequest(body.to_string()),
            402 => Self::BadRequest(format!("saldo/créditos insuficientes: {body}")),
            _ if (500..600).contains(&status) => Self::Other(body.to_string()),
            _ => Self::Other(body.to_string()),
        }
    }

    pub fn is_unsupported_protocol(&self) -> bool {
        matches!(self, Self::UnsupportedProtocol(_))
    }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/// Stream a completion, trying every protocol in `request.protocols` until one
/// succeeds. Emits into `sink`; returns after the stream ends.
pub async fn stream_completion(
    http: &reqwest::Client,
    request: CompletionRequest,
    sink: EventSink,
) -> anyhow::Result<()> {
    let _ = http;
    let _ = request;
    let _ = sink;
    todo!("implemented by the providers module")
}

/// Dispatch to a single protocol adapter.
pub(crate) async fn stream_one(
    http: &reqwest::Client,
    request: &CompletionRequest,
    protocol: WireProtocol,
    sink: &EventSink,
) -> ProviderResult<()> {
    let _ = http;
    let _ = request;
    let _ = protocol;
    let _ = sink;
    todo!("implemented by the providers module")
}
