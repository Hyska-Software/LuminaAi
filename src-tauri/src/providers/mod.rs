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
/* Shared plumbing for the protocol adapters                           */
/* ------------------------------------------------------------------ */

/// Fixed gateway path per wire protocol (appended to `config.base_url`).
pub(crate) const CHAT_PATH: &str = "/openai/v1/chat/completions";
pub(crate) const RESPONSES_PATH: &str = "/openai/v1/responses";
pub(crate) const ANTHROPIC_PATH: &str = "/anthropic/v1/messages";
pub(crate) const GOOGLE_MODELS_PATH: &str = "/google/v1beta/models";

pub(crate) fn endpoint(base_url: &str, path: &str) -> String {
    format!("{}{}", base_url.trim_end_matches('/'), path)
}

/// Send one provider event, failing when the harness dropped the receiver
/// (turn cancelled / aborted).
pub(crate) fn emit(sink: &EventSink, event: ProviderEvent) -> anyhow::Result<()> {
    sink.send(event).map_err(|_| {
        anyhow::Error::new(ProviderError::Other(
            "canal de eventos fechado (turno cancelado?)".to_string(),
        ))
    })
}

/// Recover the typed provider error from a failure raised inside the SSE
/// callback (which is `anyhow` based).
pub(crate) fn to_provider_error(error: anyhow::Error) -> ProviderError {
    match error.downcast::<ProviderError>() {
        Ok(provider_error) => provider_error,
        Err(other) => ProviderError::Network(format!("{other:#}")),
    }
}

/// POST a JSON body and return the streaming response, or `None` when the turn
/// was cancelled before the response headers arrived.
pub(crate) async fn send_stream(
    http: &reqwest::Client,
    request: &CompletionRequest,
    url: &str,
    body: &Value,
) -> ProviderResult<Option<reqwest::Response>> {
    use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};

    if request.cancel.is_cancelled() {
        return Ok(None);
    }
    let mut builder = http
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .header(ACCEPT, "text/event-stream");
    if !request.config.api_key.is_empty() {
        builder = builder.header(AUTHORIZATION, format!("Bearer {}", request.config.api_key));
    }
    if !request.config.session_id.is_empty() {
        builder = builder.header("x-opencode-session", request.config.session_id.as_str());
    }
    if !request.config.user_agent.is_empty() {
        builder = builder.header(USER_AGENT, request.config.user_agent.as_str());
    }
    let response = tokio::select! {
        _ = request.cancel.cancelled() => return Ok(None),
        result = builder.json(body).send() => result.map_err(|error| {
            ProviderError::Network(format!("falha ao conectar no provedor: {error}"))
        })?,
    };
    let status = response.status();
    if !status.is_success() {
        let body_text = tokio::select! {
            _ = request.cancel.cancelled() => return Ok(None),
            text = response.text() => text.unwrap_or_default(),
        };
        return Err(ProviderError::from_http(status.as_u16(), &body_text));
    }
    Ok(Some(response))
}

/// System prompt plus any system message embedded in the neutral history.
pub(crate) fn system_text(request: &CompletionRequest) -> String {
    let mut parts: Vec<&str> = Vec::new();
    let base = request.system_prompt.trim();
    if !base.is_empty() {
        parts.push(base);
    }
    for message in &request.history {
        if matches!(message.role, HistoryRole::System) {
            let text = message.text.trim();
            if !text.is_empty() {
                parts.push(text);
            }
        }
    }
    parts.join("\n\n")
}

/// Splits an image part into `(mime_type, raw_base64)`, tolerating both raw
/// base64 and pre-built `data:` URLs.
pub(crate) fn image_base64(image: &ImagePart) -> (String, String) {
    let raw = image.data_base64.trim();
    if let Some(rest) = raw.strip_prefix("data:") {
        if let Some((header, data)) = rest.split_once(',') {
            let mime = header
                .split(';')
                .next()
                .filter(|mime| !mime.is_empty())
                .unwrap_or(image.mime_type.as_str());
            return (mime.to_string(), data.to_string());
        }
    }
    (image.mime_type.clone(), raw.to_string())
}

/// `data:<mime>;base64,<data>` URL used by the OpenAI protocols.
pub(crate) fn image_data_url(image: &ImagePart) -> String {
    let raw = image.data_base64.trim();
    if raw.starts_with("data:") {
        raw.to_string()
    } else {
        format!("data:{};base64,{}", image.mime_type, raw)
    }
}

pub(crate) fn max_output_tokens(request: &CompletionRequest) -> u32 {
    request
        .max_output_tokens
        .unwrap_or(request.config.model.max_output)
        .max(1)
}

pub(crate) fn as_u32(value: &Value) -> Option<u32> {
    match value {
        Value::Number(number) => number.as_u64().and_then(|n| u32::try_from(n).ok()),
        Value::String(text) => text.trim().parse().ok(),
        _ => None,
    }
}

pub(crate) fn pointer_u32(value: &Value, pointer: &str) -> Option<u32> {
    value.pointer(pointer).and_then(as_u32)
}

/// Tool call arguments as a JSON string, defaulting to `{}` when the provider
/// streamed nothing (or an empty payload).
pub(crate) fn normalize_arguments(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        "{}".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Arguments guaranteed to be valid JSON, suitable for `provider_state`.
pub(crate) fn valid_json_arguments(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() || serde_json::from_str::<Value>(trimmed).is_err() {
        "{}".to_string()
    } else {
        trimmed.to_string()
    }
}

pub(crate) fn parse_arguments(raw: &str) -> Value {
    serde_json::from_str::<Value>(raw.trim())
        .unwrap_or_else(|_| Value::Object(Default::default()))
}

pub(crate) fn make_usage(
    input: Option<u32>,
    output: Option<u32>,
    reasoning: Option<u32>,
    cached: Option<u32>,
    total: Option<u32>,
) -> UsageInfo {
    let total = total.or_else(|| match (input, output) {
        (Some(input), Some(output)) => Some(input.saturating_add(output)),
        _ => None,
    });
    UsageInfo {
        input_tokens: input,
        output_tokens: output,
        reasoning_tokens: reasoning,
        cached_tokens: cached,
        total_tokens: total,
        cost: None,
        duration_ms: None,
    }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/// Stream a completion, trying every protocol in `request.protocols` until one
/// succeeds. Emits into `sink`; returns after the stream ends.
///
/// Only [`ProviderError::UnsupportedProtocol`] moves on to the next protocol
/// (the gateway answers it when a model does not accept the requested wire
/// protocol); every other error is returned to the caller.
pub async fn stream_completion(
    http: &reqwest::Client,
    request: CompletionRequest,
    sink: EventSink,
) -> anyhow::Result<()> {
    if request.cancel.is_cancelled() {
        return Ok(());
    }
    let mut protocols = request.protocols.clone();
    if protocols.is_empty() {
        protocols = request
            .config
            .model
            .protocols
            .iter()
            .filter_map(|protocol| WireProtocol::parse(protocol))
            .collect();
    }
    if protocols.is_empty() {
        anyhow::bail!(
            "modelo {} não declara nenhum protocolo de wire utilizável",
            request.config.model.id
        );
    }

    let mut last_error: Option<ProviderError> = None;
    let mut attempted: Vec<&str> = Vec::new();
    for protocol in protocols {
        if request.cancel.is_cancelled() {
            return Ok(());
        }
        attempted.push(protocol.as_str());
        match stream_one(http, &request, protocol, &sink).await {
            Ok(()) => return Ok(()),
            Err(ProviderError::UnsupportedProtocol(detail)) => {
                eprintln!(
                    "[providers] protocolo {} não suportado pelo modelo {}: {}",
                    protocol.as_str(),
                    request.config.model.id,
                    detail
                );
                last_error = Some(ProviderError::UnsupportedProtocol(detail));
            }
            Err(error) => return Err(anyhow::Error::new(error)),
        }
    }

    let last = last_error
        .map(|error| error.to_string())
        .unwrap_or_else(|| "nenhum protocolo tentado".to_string());
    anyhow::bail!(
        "nenhum protocolo aceito pelo gateway para o modelo {} (tentados: {}; última falha: {})",
        request.config.model.id,
        attempted.join(", "),
        last
    )
}

/// Dispatch to a single protocol adapter.
pub(crate) async fn stream_one(
    http: &reqwest::Client,
    request: &CompletionRequest,
    protocol: WireProtocol,
    sink: &EventSink,
) -> ProviderResult<()> {
    match protocol {
        WireProtocol::OpenaiChat => openai_chat::stream(http, request, sink).await,
        WireProtocol::OpenaiResponses => openai_responses::stream(http, request, sink).await,
        WireProtocol::Anthropic => anthropic::stream(http, request, sink).await,
        WireProtocol::Google => google::stream(http, request, sink).await,
    }
}

/* ------------------------------------------------------------------ */
/* Real gateway smoke tests                                            */
/* ------------------------------------------------------------------ */

/// These tests hit the real OpenCode Go gateway with the local OpenCode CLI
/// credentials (`%USERPROFILE%\.local\share\opencode\auth.json`). They are
/// ignored by default so a normal `cargo test` / `cargo check` never touches
/// the network:
///
/// ```text
/// cd src-tauri
/// cargo test --lib providers::smoke -- --ignored --nocapture --test-threads=1
/// ```
#[cfg(test)]
mod smoke {
    use std::collections::HashMap;

    use serde_json::{json, Value};

    use super::*;
    use crate::catalog::{CatalogFile, ProviderInfo};

    #[derive(Debug, Default)]
    struct Call {
        id: String,
        name: String,
        arguments: String,
    }

    #[derive(Debug, Default)]
    struct StreamResult {
        text: String,
        reasoning: String,
        calls: Vec<Call>,
        state: Option<Value>,
        usage: Option<UsageInfo>,
        stop_reason: Option<String>,
        trace: Vec<String>,
    }

    fn auth_key() -> Option<String> {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .ok()?;
        let path = std::path::PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("opencode")
            .join("auth.json");
        let raw = std::fs::read_to_string(path).ok()?;
        let parsed: Value = serde_json::from_str(&raw).ok()?;
        parsed
            .get("opencode-go")?
            .get("key")?
            .as_str()
            .map(str::to_string)
    }

    fn provider_config(
        provider: &ProviderInfo,
        model: &ModelInfo,
        key: &str,
    ) -> ProviderConfig {
        ProviderConfig {
            provider_id: provider.id.clone(),
            provider_name: provider.name.clone(),
            base_url: provider.base_url.clone(),
            api_key: key.to_string(),
            model: model.clone(),
            session_id: format!("lumina-smoke-{}", uuid::Uuid::new_v4()),
            user_agent: concat!("Lumina/", env!("CARGO_PKG_VERSION")).to_string(),
        }
    }

    fn echo_tool() -> ToolDefinition {
        ToolDefinition {
            name: "echo".to_string(),
            description: "Echo text back to the user. Use it when asked to call echo.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {"text": {"type": "string", "description": "Text to echo"}},
                "required": ["text"],
            }),
        }
    }

    fn tool_call_instructions() -> &'static str {
        "Chame a ferramenta echo exatamente uma vez com o argumento {\"text\":\"ping\"}. \
         Depois de receber o resultado da ferramenta, responda apenas com o texto recebido."
    }

    async fn collect(
        config: ProviderConfig,
        protocols: Vec<WireProtocol>,
        history: Vec<HistoryMessage>,
        tools: Vec<ToolDefinition>,
        reasoning: ReasoningRequest,
    ) -> anyhow::Result<StreamResult> {
        collect_with_cancel(config, protocols, history, tools, reasoning, CancellationToken::new())
            .await
    }

    async fn collect_with_cancel(
        config: ProviderConfig,
        protocols: Vec<WireProtocol>,
        history: Vec<HistoryMessage>,
        tools: Vec<ToolDefinition>,
        reasoning: ReasoningRequest,
        cancel: CancellationToken,
    ) -> anyhow::Result<StreamResult> {
        let (sink, mut events) = tokio::sync::mpsc::unbounded_channel();
        let request = CompletionRequest {
            config,
            protocols,
            history,
            system_prompt: String::new(),
            tools,
            reasoning,
            max_output_tokens: Some(1_024),
            temperature: None,
            cancel,
        };
        let http = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(20))
            .timeout(std::time::Duration::from_secs(180))
            .build()
            .expect("smoke HTTP client");
        let task = tokio::spawn(async move { stream_completion(&http, request, sink).await });

        let mut result = StreamResult::default();
        let mut open: HashMap<usize, Call> = HashMap::new();
        let mut completed: std::collections::BTreeMap<usize, Call> = Default::default();
        while let Some(event) = events.recv().await {
            match event {
                ProviderEvent::TextDelta(delta) => {
                    result.trace.push(format!("text({})", delta.chars().count()));
                    result.text.push_str(&delta);
                }
                ProviderEvent::ReasoningDelta(delta) => {
                    result.trace.push(format!("reasoning({})", delta.chars().count()));
                    result.reasoning.push_str(&delta);
                }
                ProviderEvent::ToolCallStart { index, id, name } => {
                    result.trace.push(format!("tool_start({name})"));
                    open.insert(
                        index,
                        Call {
                            id,
                            name,
                            arguments: String::new(),
                        },
                    );
                }
                ProviderEvent::ToolCallArgsDelta { index, delta } => {
                    result.trace.push(format!("tool_args({})", delta.chars().count()));
                    if let Some(call) = open.get_mut(&index) {
                        call.arguments.push_str(&delta);
                    }
                }
                ProviderEvent::ToolCallDone { index, arguments } => {
                    result.trace.push("tool_done".to_string());
                    if let Some(mut call) = open.remove(&index) {
                        call.arguments = arguments;
                        completed.insert(index, call);
                    }
                }
                ProviderEvent::ProviderState(state) => {
                    result.trace.push("state".to_string());
                    result.state = Some(state);
                }
                ProviderEvent::Usage(usage) => {
                    result.trace.push("usage".to_string());
                    result.usage = Some(usage);
                }
                ProviderEvent::Done { stop_reason } => {
                    result.trace.push("done".to_string());
                    result.stop_reason = stop_reason;
                }
            }
        }
        let outcome = task.await.expect("stream task panicked");
        outcome?;
        // Keep tool calls in provider order even if some `Done` event was lost.
        for (index, call) in open {
            completed.entry(index).or_insert(call);
        }
        result.calls = completed.into_values().collect();
        Ok(result)
    }

    async fn run_once(
        config: ProviderConfig,
        protocol: WireProtocol,
        history: Vec<HistoryMessage>,
        tools: Vec<ToolDefinition>,
        reasoning: ReasoningRequest,
    ) -> StreamResult {
        collect(config, vec![protocol], history, tools, reasoning)
            .await
            .unwrap_or_else(|error| panic!("stream falhou: {error:#}"))
    }

    fn assistant_replay(first: &StreamResult) -> HistoryMessage {
        HistoryMessage {
            role: HistoryRole::Assistant,
            text: first.text.clone(),
            images: Vec::new(),
            reasoning: Some(first.reasoning.clone()),
            reasoning_signature: first
                .state
                .as_ref()
                .and_then(|state| state.get(0))
                .and_then(|block| block.get("signature"))
                .and_then(Value::as_str)
                .map(str::to_string),
            tool_calls: first
                .calls
                .iter()
                .map(|call| HistoryToolCall {
                    id: call.id.clone(),
                    name: call.name.clone(),
                    arguments: call.arguments.clone(),
                })
                .collect(),
            tool_call_id: None,
            tool_name: None,
            provider_state: first.state.clone(),
        }
    }

    #[tokio::test]
    #[ignore = "real gateway smoke test (needs ~/.local/share/opencode/auth.json)"]
    async fn smoke_text_streaming_all_protocols() {
        let Some(key) = auth_key() else {
            eprintln!("SKIP smoke_text_streaming_all_protocols: auth.json sem chave opencode-go");
            return;
        };
        let catalog = CatalogFile::load().expect("catalog");
        let provider = catalog.provider("opencode-go").expect("provider opencode-go");
        let cases = [
            ("glm-5.3-flash", WireProtocol::OpenaiChat, "low"),
            ("deepseek-v4.1-flash", WireProtocol::OpenaiChat, "low"),
            ("kimi-k2.6", WireProtocol::OpenaiChat, "high"),
            ("qwen3.8-flash", WireProtocol::OpenaiChat, "high"),
            ("gpt-6-luna", WireProtocol::OpenaiResponses, "low"),
            ("grok-4.7", WireProtocol::OpenaiResponses, "low"),
            ("claude-haiku-5-5", WireProtocol::Anthropic, "high"),
            ("minimax-m3", WireProtocol::Anthropic, "high"),
            ("gemini-4-argon-contributor", WireProtocol::Google, "low"),
        ];
        for (model_id, protocol, effort) in cases {
            let model = catalog
                .model("opencode-go", model_id)
                .expect("model in catalog");
            let config = provider_config(provider, model, &key);
            let result = run_once(
                config,
                protocol,
                vec![HistoryMessage::user("Responda apenas: ok")],
                Vec::new(),
                ReasoningRequest::Effort(effort.to_string()),
            )
            .await;
            eprintln!(
                "[{}] protocolo={} texto={:?} reasoning_chars={} usage={:?} stop={:?}",
                model_id,
                protocol.as_str(),
                result.text.trim(),
                result.reasoning.chars().count(),
                result.usage,
                result.stop_reason
            );
            assert!(
                !result.text.trim().is_empty(),
                "{}: stream de texto vazio",
                model_id
            );
        }
    }

    /// Product requirement: every automated integration check uses
    /// `deepseek-v4.1-flash` from OpenCode Go with the maximum reasoning effort.
    #[tokio::test]
    #[ignore = "real gateway smoke test (needs ~/.local/share/opencode/auth.json)"]
    async fn smoke_deepseek_v4_1_flash_max_effort() {
        let Some(key) = auth_key() else {
            eprintln!("SKIP smoke_deepseek_v4_1_flash_max_effort: auth.json sem chave opencode-go");
            return;
        };
        let catalog = CatalogFile::load().expect("catalog");
        let provider = catalog.provider("opencode-go").expect("provider opencode-go");
        let model = catalog
            .model("opencode-go", "deepseek-v4.1-flash")
            .expect("deepseek-v4.1-flash no catálogo");
        assert!(
            model.protocols.iter().any(|protocol| protocol == "openai-chat"),
            "deepseek-v4.1-flash deve falar openai-chat"
        );

        let first = run_once(
            provider_config(provider, model, &key),
            WireProtocol::OpenaiChat,
            vec![
                HistoryMessage::system("Pense com cuidado antes de responder, em português."),
                HistoryMessage::user("Explique em duas frases por que o céu é azul."),
            ],
            Vec::new(),
            ReasoningRequest::Effort("max".to_string()),
        )
        .await;

        eprintln!(
            "[deepseek-v4.1-flash max] texto={:?} reasoning_chars={} usage={:?}",
            first.text.trim(),
            first.reasoning.chars().count(),
            first.usage
        );
        assert!(!first.text.trim().is_empty(), "resposta final vazia");
        assert!(
            !first.reasoning.trim().is_empty(),
            "com esforço máximo o DeepSeek deve expor raciocínio"
        );
        assert!(
            first
                .usage
                .as_ref()
                .and_then(|usage| usage.output_tokens)
                .unwrap_or(0)
                > 0,
            "usage de tokens de saída ausente"
        );

        // Second step reuses the provider state (multi-turn replay) and must answer.
        let follow_up = run_once(
            provider_config(provider, model, &key),
            WireProtocol::OpenaiChat,
            vec![
                HistoryMessage::system("Pense com cuidado antes de responder, em português."),
                HistoryMessage::user("Explique em duas frases por que o céu é azul."),
                assistant_replay(&first),
                HistoryMessage::user("Agora resuma em exatamente 3 palavras."),
            ],
            Vec::new(),
            ReasoningRequest::Effort("max".to_string()),
        )
        .await;
        eprintln!("[deepseek-v4.1-flash max replay] texto={:?}", follow_up.text.trim());
        assert!(
            !follow_up.text.trim().is_empty(),
            "resposta de continuação vazia (replay do provider_state falhou)"
        );
    }

    #[tokio::test]
    #[ignore = "real gateway smoke test (needs ~/.local/share/opencode/auth.json)"]
    async fn smoke_tool_call_and_provider_state_replay() {
        let Some(key) = auth_key() else {
            eprintln!("SKIP smoke_tool_call_and_provider_state_replay: auth.json sem chave opencode-go");
            return;
        };
        let catalog = CatalogFile::load().expect("catalog");
        let provider = catalog.provider("opencode-go").expect("provider opencode-go");
        let cases = [
            ("glm-5.3-flash", WireProtocol::OpenaiChat),
            ("gpt-6-luna", WireProtocol::OpenaiResponses),
            ("claude-haiku-5-5", WireProtocol::Anthropic),
            ("gemini-4-argon-contributor", WireProtocol::Google),
        ];
        for (model_id, protocol) in cases {
            let model = catalog
                .model("opencode-go", model_id)
                .expect("model in catalog");
            let tool = echo_tool();
            let first = run_once(
                provider_config(provider, model, &key),
                protocol,
                vec![HistoryMessage::user(tool_call_instructions())],
                vec![tool.clone()],
                ReasoningRequest::Auto,
            )
            .await;
            eprintln!(
                "[{}] tool_calls={:?} state={}",
                model_id,
                first.calls.iter().map(|call| call.name.as_str()).collect::<Vec<_>>(),
                first
                    .state
                    .as_ref()
                    .map(|state| state.to_string().chars().take(160).collect::<String>())
                    .unwrap_or_else(|| "<none>".to_string())
            );
            assert!(
                !first.calls.is_empty(),
                "{}: o modelo não chamou a ferramenta",
                model_id
            );
            assert!(first.state.is_some(), "{}: sem provider_state", model_id);

            let mut history = vec![
                HistoryMessage::user(tool_call_instructions()),
                assistant_replay(&first),
            ];
            for call in &first.calls {
                history.push(HistoryMessage::tool_result(
                    call.id.clone(),
                    call.name.clone(),
                    json!({"ok": true, "echo": "ping"}).to_string(),
                ));
            }
            let second = run_once(
                provider_config(provider, model, &key),
                protocol,
                history,
                vec![tool.clone()],
                ReasoningRequest::Auto,
            )
            .await;
            eprintln!(
                "[{}] replay texto={:?} stop={:?} calls={:?} trace={:?} state={}",
                model_id,
                second.text.trim(),
                second.stop_reason,
                second
                    .calls
                    .iter()
                    .map(|call| call.name.as_str())
                    .collect::<Vec<_>>(),
                second.trace,
                second
                    .state
                    .as_ref()
                    .map(|state| state.to_string().chars().take(800).collect::<String>())
                    .unwrap_or_else(|| "<none>".to_string())
            );
            assert!(
                !second.text.trim().is_empty() || !second.calls.is_empty(),
                "{}: replay do tool loop não produziu resposta",
                model_id
            );
        }
    }

    #[tokio::test]
    #[ignore = "real gateway smoke test (needs ~/.local/share/opencode/auth.json)"]
    async fn smoke_protocol_fallback() {
        let Some(key) = auth_key() else {
            eprintln!("SKIP smoke_protocol_fallback: auth.json sem chave opencode-go");
            return;
        };
        let catalog = CatalogFile::load().expect("catalog");
        let provider = catalog.provider("opencode-go").expect("provider opencode-go");
        let claude = catalog
            .model("opencode-go", "claude-haiku-5-5")
            .expect("claude-haiku-5-5 in catalog");

        // The gateway answers `Model does not support this protocol` for the
        // chat protocol; `stream_completion` must fall back to anthropic.
        let result = collect(
            provider_config(provider, claude, &key),
            vec![WireProtocol::OpenaiChat, WireProtocol::Anthropic],
            vec![HistoryMessage::user("Responda apenas: ok")],
            Vec::new(),
            ReasoningRequest::Auto,
        )
        .await
        .unwrap_or_else(|error| panic!("fallback deveria ter sucesso: {error:#}"));
        eprintln!(
            "fallback chat->anthropic texto={:?} stop={:?}",
            result.text.trim(),
            result.stop_reason
        );
        assert!(!result.text.trim().is_empty());

        // When every declared protocol is rejected the error must be explicit.
        let error = collect(
            provider_config(provider, claude, &key),
            vec![WireProtocol::OpenaiChat, WireProtocol::OpenaiResponses],
            vec![HistoryMessage::user("Responda apenas: ok")],
            Vec::new(),
            ReasoningRequest::Auto,
        )
        .await
        .expect_err("todos os protocolos deveriam falhar");
        let message = format!("{error:#}");
        eprintln!("erro final: {message}");
        assert!(
            message.contains("nenhum protocolo aceito"),
            "mensagem de erro inesperada: {message}"
        );
    }

    #[tokio::test]
    #[ignore = "real gateway smoke test (needs ~/.local/share/opencode/auth.json)"]
    async fn smoke_http_error_mapping() {
        let Some(key) = auth_key() else {
            eprintln!("SKIP smoke_http_error_mapping: auth.json sem chave opencode-go");
            return;
        };
        let catalog = CatalogFile::load().expect("catalog");
        let provider = catalog.provider("opencode-go").expect("provider opencode-go");
        let model = catalog
            .model("opencode-go", "glm-5.3-flash")
            .expect("glm-5.3-flash in catalog");
        let mut config = provider_config(provider, model, &key);
        config.api_key = "chave-invalida-lumina".to_string();
        let error = collect(
            config,
            vec![WireProtocol::OpenaiChat],
            vec![HistoryMessage::user("oi")],
            Vec::new(),
            ReasoningRequest::Auto,
        )
        .await
        .expect_err("chave inválida deveria falhar");
        let message = format!("{error:#}");
        eprintln!("erro mapeado: {message}");
        assert!(
            message.contains("unauthorized"),
            "esperava ProviderError::Unauthorized: {message}"
        );
    }

    #[tokio::test]
    #[ignore = "real gateway smoke test (needs ~/.local/share/opencode/auth.json)"]
    async fn smoke_cancellation_stops_without_done() {
        let Some(key) = auth_key() else {
            eprintln!("SKIP smoke_cancellation_stops_without_done: auth.json sem chave opencode-go");
            return;
        };
        let catalog = CatalogFile::load().expect("catalog");
        let provider = catalog.provider("opencode-go").expect("provider opencode-go");
        let model = catalog
            .model("opencode-go", "glm-5.3-flash")
            .expect("glm-5.3-flash in catalog");
        let cancel = CancellationToken::new();
        let request = CompletionRequest {
            config: provider_config(provider, model, &key),
            protocols: vec![WireProtocol::OpenaiChat],
            history: vec![HistoryMessage::user(
                "Conte de 1 a 200, um número por linha, sem nenhum texto extra.",
            )],
            system_prompt: String::new(),
            tools: Vec::new(),
            reasoning: ReasoningRequest::Auto,
            max_output_tokens: Some(1_024),
            temperature: None,
            cancel: cancel.clone(),
        };
        let http = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(20))
            .timeout(std::time::Duration::from_secs(180))
            .build()
            .expect("smoke HTTP client");
        let (sink, mut events) = tokio::sync::mpsc::unbounded_channel();
        let task = tokio::spawn(async move { stream_completion(&http, request, sink).await });

        let mut deltas = 0usize;
        let mut saw_done = false;
        while let Some(event) = events.recv().await {
            match event {
                ProviderEvent::TextDelta(delta) => {
                    deltas += 1;
                    if deltas == 3 {
                        cancel.cancel();
                    }
                    eprintln!("delta#{deltas}: {delta:?}");
                }
                ProviderEvent::Done { .. } => saw_done = true,
                _ => {}
            }
        }
        let outcome = task.await.expect("stream task panicked");
        eprintln!("cancel: deltas={deltas} done={saw_done} resultado={outcome:?}");
        assert!(outcome.is_ok(), "cancelamento deveria retornar Ok");
        assert!(deltas >= 3, "esperava pelo menos 3 deltas antes de cancelar");
        assert!(!saw_done, "cancelamento não deve emitir Done");
    }
}
