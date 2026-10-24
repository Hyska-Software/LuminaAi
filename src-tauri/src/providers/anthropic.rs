//! Anthropic Messages protocol adapter (SSE).
//!
//! Used by Claude, MiniMax, Kimi K3/K3.1 and some Qwen models. Streaming events:
//! `message_start` (usage), `content_block_start/delta/stop` (`text_delta`,
//! `thinking_delta`, `signature_delta`, `input_json_delta`), `message_delta`
//! (usage + stop reason) and `message_stop`. The assembled assistant content
//! blocks (including thinking blocks with their signatures) are emitted as
//! `ProviderState` so the next tool-loop step can replay them verbatim.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::sse;
use super::{
    as_u32, emit, endpoint, image_base64, make_usage, max_output_tokens, normalize_arguments,
    parse_arguments, reasoning, send_stream, system_text, to_provider_error, CompletionRequest,
    EventSink, HistoryMessage, HistoryRole, ProviderError, ProviderEvent, ProviderResult,
    WireProtocol, ANTHROPIC_PATH,
};

pub(crate) async fn stream(
    http: &reqwest::Client,
    request: &CompletionRequest,
    sink: &EventSink,
) -> ProviderResult<()> {
    let url = endpoint(&request.config.base_url, ANTHROPIC_PATH);
    let body = build_body(request);
    let Some(response) = send_stream(http, request, &url, &body).await? else {
        return Ok(());
    };
    let mut handler = Handler::new(sink);
    let outcome =
        sse::stream_sse(response, &request.cancel, |event, data| handler.on_event(event, data))
            .await;
    if let Err(error) = outcome {
        return Err(to_provider_error(error));
    }
    if request.cancel.is_cancelled() {
        return Ok(());
    }
    handler.finish()
}

/* ------------------------------------------------------------------ */
/* Request                                                             */
/* ------------------------------------------------------------------ */

fn build_body(request: &CompletionRequest) -> Value {
    let model = &request.config.model;
    let mut messages: Vec<Value> = Vec::new();
    for message in &request.history {
        match message.role {
            HistoryRole::System => {}
            HistoryRole::User => {
                let blocks = user_blocks(message);
                if !blocks.is_empty() {
                    push_blocks(&mut messages, "user", blocks);
                }
            }
            HistoryRole::Assistant => {
                if let Some(blocks) = assistant_blocks(message) {
                    push_blocks(&mut messages, "assistant", blocks);
                }
            }
            HistoryRole::Tool => push_tool_result(&mut messages, message),
        }
    }

    let mut body = json!({
        "model": model.id,
        "stream": true,
        "max_tokens": max_output_tokens(request),
        "messages": messages,
    });
    let system = system_text(request);
    if !system.is_empty() {
        body["system"] = json!(system);
    }
    if !request.tools.is_empty() {
        let tools: Vec<Value> = request
            .tools
            .iter()
            .map(|tool| {
                json!({
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.parameters,
                })
            })
            .collect();
        body["tools"] = json!(tools);
    }
    reasoning::apply(WireProtocol::Anthropic, model, &request.reasoning, &mut body);

    // With extended thinking enabled `max_tokens` must exceed `budget_tokens`.
    if let Some(budget) = body
        .pointer("/thinking/budget_tokens")
        .and_then(as_u32)
    {
        let required = budget.saturating_add(1_024);
        let current = body.get("max_tokens").and_then(as_u32).unwrap_or(0);
        if current < required {
            body["max_tokens"] = json!(required);
        }
    }
    // Thinking and custom temperature are mutually exclusive on Anthropic.
    if body.get("thinking").is_none() {
        if let Some(temperature) = request.temperature {
            body["temperature"] = json!(temperature);
        }
    }
    body
}

fn user_blocks(message: &HistoryMessage) -> Vec<Value> {
    let mut blocks: Vec<Value> = Vec::new();
    if !message.text.trim().is_empty() {
        blocks.push(json!({"type": "text", "text": message.text}));
    }
    for image in &message.images {
        let (media_type, data) = image_base64(image);
        blocks.push(json!({
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": data},
        }));
    }
    blocks
}

fn assistant_blocks(message: &HistoryMessage) -> Option<Vec<Value>> {
    if let Some(state) = &message.provider_state {
        let blocks = match state {
            Value::Array(blocks) => Some(blocks.clone()),
            Value::Object(map) => map.get("content").and_then(Value::as_array).cloned(),
            _ => None,
        };
        if let Some(blocks) = blocks {
            if !blocks.is_empty() {
                return Some(blocks);
            }
        }
    }
    let mut blocks: Vec<Value> = Vec::new();
    if let (Some(reasoning), Some(signature)) = (&message.reasoning, &message.reasoning_signature) {
        if !reasoning.trim().is_empty() && !signature.trim().is_empty() {
            blocks.push(json!({
                "type": "thinking",
                "thinking": reasoning,
                "signature": signature,
            }));
        }
    }
    if !message.text.trim().is_empty() {
        blocks.push(json!({"type": "text", "text": message.text}));
    }
    for call in &message.tool_calls {
        blocks.push(json!({
            "type": "tool_use",
            "id": call.id,
            "name": call.name,
            "input": parse_arguments(&call.arguments),
        }));
    }
    if blocks.is_empty() {
        None
    } else {
        Some(blocks)
    }
}

/// Merge consecutive blocks for the same role; the Messages API requires
/// alternating user/assistant turns and groups tool results in one user turn.
fn push_blocks(messages: &mut Vec<Value>, role: &str, blocks: Vec<Value>) {
    if blocks.is_empty() {
        return;
    }
    if let Some(last) = messages.last_mut() {
        if last.get("role").and_then(Value::as_str) == Some(role) {
            if let Some(content) = last.get_mut("content").and_then(Value::as_array_mut) {
                content.extend(blocks);
                return;
            }
        }
    }
    messages.push(json!({"role": role, "content": blocks}));
}

fn push_tool_result(messages: &mut Vec<Value>, message: &HistoryMessage) {
    let block = json!({
        "type": "tool_result",
        "tool_use_id": message.tool_call_id.clone().unwrap_or_default(),
        "content": message.text,
    });
    if let Some(last) = messages.last_mut() {
        if last.get("role").and_then(Value::as_str) == Some("user") {
            if let Some(content) = last.get_mut("content").and_then(Value::as_array_mut) {
                content.push(block);
                return;
            }
        }
    }
    messages.push(json!({"role": "user", "content": [block]}));
}

/* ------------------------------------------------------------------ */
/* Streaming                                                           */
/* ------------------------------------------------------------------ */

enum BlockState {
    Text(String),
    Thinking { text: String, signature: String },
    ToolUse { id: String, name: String, json: String, done: bool },
    Redacted(Value),
    Other,
}

struct Handler<'a> {
    sink: &'a EventSink,
    blocks: BTreeMap<usize, BlockState>,
    input_tokens: Option<u32>,
    output_tokens: Option<u32>,
    reasoning_tokens: Option<u32>,
    cached_tokens: Option<u32>,
    has_usage: bool,
}

impl<'a> Handler<'a> {
    fn new(sink: &'a EventSink) -> Self {
        Self {
            sink,
            blocks: BTreeMap::new(),
            input_tokens: None,
            output_tokens: None,
            reasoning_tokens: None,
            cached_tokens: None,
            has_usage: false,
        }
    }

    fn on_event(&mut self, event: Option<&str>, data: &str) -> anyhow::Result<()> {
        let Ok(value) = serde_json::from_str::<Value>(data) else {
            return Ok(());
        };
        let event_type = value
            .get("type")
            .and_then(Value::as_str)
            .or(event)
            .unwrap_or_default();
        match event_type {
            "message_start" => {
                if let Some(usage) = value.pointer("/message/usage") {
                    self.merge_usage(usage);
                }
            }
            "content_block_start" => {
                let index = value.get("index").and_then(as_u32).unwrap_or(0) as usize;
                let Some(block) = value.get("content_block") else {
                    return Ok(());
                };
                match block.get("type").and_then(Value::as_str) {
                    Some("text") => {
                        let text = block
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        self.blocks.insert(index, BlockState::Text(text));
                    }
                    Some("thinking") => {
                        let text = block
                            .get("thinking")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        let signature = block
                            .get("signature")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        self.blocks
                            .insert(index, BlockState::Thinking { text, signature });
                    }
                    Some("tool_use") => {
                        let id = block
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        let name = block
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        emit(
                            self.sink,
                            ProviderEvent::ToolCallStart {
                                index,
                                id: id.clone(),
                                name: name.clone(),
                            },
                        )?;
                        self.blocks.insert(
                            index,
                            BlockState::ToolUse {
                                id,
                                name,
                                json: String::new(),
                                done: false,
                            },
                        );
                    }
                    Some("redacted_thinking") => {
                        self.blocks.insert(index, BlockState::Redacted(block.clone()));
                    }
                    _ => {
                        self.blocks.insert(index, BlockState::Other);
                    }
                }
            }
            "content_block_delta" => {
                let index = value.get("index").and_then(as_u32).unwrap_or(0) as usize;
                let Some(delta) = value.get("delta") else {
                    return Ok(());
                };
                match delta.get("type").and_then(Value::as_str) {
                    Some("text_delta") => {
                        let text = delta
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        if !text.is_empty() {
                            if let Some(BlockState::Text(buffer)) = self.blocks.get_mut(&index) {
                                buffer.push_str(text);
                            }
                            emit(self.sink, ProviderEvent::TextDelta(text.to_string()))?;
                        }
                    }
                    Some("thinking_delta") => {
                        let thinking = delta
                            .get("thinking")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        if !thinking.is_empty() {
                            if let Some(BlockState::Thinking { text, .. }) =
                                self.blocks.get_mut(&index)
                            {
                                text.push_str(thinking);
                            }
                            emit(
                                self.sink,
                                ProviderEvent::ReasoningDelta(thinking.to_string()),
                            )?;
                        }
                    }
                    Some("signature_delta") => {
                        let signature = delta
                            .get("signature")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        if let Some(BlockState::Thinking { signature: store, .. }) =
                            self.blocks.get_mut(&index)
                        {
                            store.push_str(signature);
                        }
                    }
                    Some("input_json_delta") => {
                        let partial = delta
                            .get("partial_json")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        if let Some(BlockState::ToolUse { json: buffer, .. }) =
                            self.blocks.get_mut(&index)
                        {
                            buffer.push_str(partial);
                        }
                        if !partial.is_empty() {
                            emit(
                                self.sink,
                                ProviderEvent::ToolCallArgsDelta {
                                    index,
                                    delta: partial.to_string(),
                                },
                            )?;
                        }
                    }
                    _ => {}
                }
            }
            "content_block_stop" => {
                let index = value.get("index").and_then(as_u32).unwrap_or(0) as usize;
                self.finish_tool(index)?;
            }
            "message_delta" => {
                if let Some(usage) = value.get("usage") {
                    self.merge_usage(usage);
                }
            }
            "message_stop" => {}
            "ping" => {}
            "error" => {
                let detail = value
                    .get("error")
                    .cloned()
                    .unwrap_or_else(|| value.clone());
                return Err(anyhow::Error::new(ProviderError::Other(format!(
                    "erro do provedor: {detail}"
                ))));
            }
            _ => {}
        }
        Ok(())
    }

    fn merge_usage(&mut self, usage: &Value) {
        self.has_usage = true;
        if let Some(value) = super::pointer_u32(usage, "/input_tokens") {
            self.input_tokens = Some(value);
        }
        if let Some(value) = super::pointer_u32(usage, "/output_tokens") {
            self.output_tokens = Some(value);
        }
        if let Some(value) = super::pointer_u32(usage, "/output_tokens_details/thinking_tokens") {
            self.reasoning_tokens = Some(value);
        }
        if let Some(value) = super::pointer_u32(usage, "/cache_read_input_tokens") {
            self.cached_tokens = Some(value);
        }
    }

    fn finish_tool(&mut self, index: usize) -> anyhow::Result<()> {
        let Some(BlockState::ToolUse { json: buffer, done, .. }) = self.blocks.get_mut(&index)
        else {
            return Ok(());
        };
        if *done {
            return Ok(());
        }
        *done = true;
        let arguments = normalize_arguments(buffer);
        emit(
            self.sink,
            ProviderEvent::ToolCallDone { index, arguments },
        )?;
        Ok(())
    }

    fn finish(mut self) -> ProviderResult<()> {
        for index in self.blocks.keys().copied().collect::<Vec<_>>() {
            self.finish_tool(index).map_err(to_provider_error)?;
        }

        let mut state_blocks: Vec<Value> = Vec::new();
        for block in std::mem::take(&mut self.blocks).into_values() {
            match block {
                BlockState::Text(text) => {
                    if !text.is_empty() {
                        state_blocks.push(json!({"type": "text", "text": text}));
                    }
                }
                BlockState::Thinking { text, signature } => {
                    // Replaying a thinking block without a signature is rejected
                    // by the gateway; other models do not return signatures.
                    if !text.is_empty() && !signature.is_empty() {
                        state_blocks.push(json!({
                            "type": "thinking",
                            "thinking": text,
                            "signature": signature,
                        }));
                    }
                }
                BlockState::ToolUse { id, name, json, .. } => {
                    state_blocks.push(json!({
                        "type": "tool_use",
                        "id": id,
                        "name": name,
                        "input": parse_arguments(&json),
                    }));
                }
                BlockState::Redacted(value) => state_blocks.push(value),
                BlockState::Other => {}
            }
        }

        if self.has_usage {
            let usage = make_usage(
                self.input_tokens,
                self.output_tokens,
                self.reasoning_tokens,
                self.cached_tokens,
                None,
            );
            emit(self.sink, ProviderEvent::Usage(usage)).map_err(to_provider_error)?;
        }
        emit(
            self.sink,
            ProviderEvent::ProviderState(Value::Array(state_blocks)),
        )
        .map_err(to_provider_error)?;
        emit(self.sink, ProviderEvent::Done).map_err(to_provider_error)?;
        Ok(())
    }
}
