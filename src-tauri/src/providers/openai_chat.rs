//! OpenAI Chat Completions protocol adapter (SSE).
//!
//! Used by GLM, DeepSeek, Kimi (chat), Qwen, MiMo, LongCat, Step, … Reasoning
//! arrives as `delta.reasoning_content`; tool calls arrive as argument deltas
//! indexed by `tool_calls[].index`; usage is sent in the last chunk when
//! `stream_options.include_usage` is requested.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use crate::domain::UsageInfo;

use super::sse;
use super::{
    as_u32, emit, endpoint, image_data_url, make_usage, max_output_tokens, normalize_arguments,
    pointer_u32, reasoning, send_stream, system_text, to_provider_error, valid_json_arguments,
    CompletionRequest, EventSink, HistoryMessage, HistoryRole, ProviderError, ProviderEvent,
    ProviderResult, WireProtocol, CHAT_PATH,
};

pub(crate) async fn stream(
    http: &reqwest::Client,
    request: &CompletionRequest,
    sink: &EventSink,
) -> ProviderResult<()> {
    let url = endpoint(&request.config.base_url, CHAT_PATH);
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
    let system = system_text(request);
    if !system.is_empty() {
        messages.push(json!({"role": "system", "content": system}));
    }
    for message in &request.history {
        match message.role {
            HistoryRole::System => {}
            HistoryRole::User => messages.push(user_message(message)),
            HistoryRole::Assistant => {
                if let Some(entry) = assistant_message(message) {
                    messages.push(entry);
                }
            }
            HistoryRole::Tool => messages.push(tool_message(message)),
        }
    }

    let mut body = json!({
        "model": model.id,
        "messages": messages,
        "stream": true,
        // Ask for the usage block in the final chunk (OpenAI compatible).
        "stream_options": {"include_usage": true},
        "max_tokens": max_output_tokens(request),
    });
    if let Some(temperature) = request.temperature {
        body["temperature"] = json!(temperature);
    }
    if !request.tools.is_empty() {
        let tools: Vec<Value> = request
            .tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.parameters,
                    }
                })
            })
            .collect();
        body["tools"] = json!(tools);
    }
    reasoning::apply(WireProtocol::OpenaiChat, model, &request.reasoning, &mut body);
    body
}

fn user_message(message: &HistoryMessage) -> Value {
    if message.images.is_empty() {
        return json!({"role": "user", "content": message.text});
    }
    let mut parts: Vec<Value> = Vec::new();
    if !message.text.trim().is_empty() {
        parts.push(json!({"type": "text", "text": message.text}));
    }
    for image in &message.images {
        parts.push(json!({
            "type": "image_url",
            "image_url": {"url": image_data_url(image)},
        }));
    }
    json!({"role": "user", "content": parts})
}

fn assistant_message(message: &HistoryMessage) -> Option<Value> {
    let tool_calls = chat_tool_calls(message);
    let has_text = !message.text.trim().is_empty();
    if tool_calls.is_empty() {
        if !has_text {
            return None;
        }
        return Some(json!({"role": "assistant", "content": message.text}));
    }
    let content = if has_text { json!(message.text) } else { Value::Null };
    Some(json!({
        "role": "assistant",
        "content": content,
        "tool_calls": tool_calls,
    }))
}

/// OpenAI-style tool calls for replay: prefer the verbatim `provider_state`
/// captured in the previous step, fall back to the neutral history fields.
fn chat_tool_calls(message: &HistoryMessage) -> Vec<Value> {
    if let Some(Value::Object(state)) = &message.provider_state {
        if let Some(Value::Array(calls)) = state.get("tool_calls") {
            let mapped: Vec<Value> = calls
                .iter()
                .filter_map(normalize_chat_tool_call)
                .collect();
            if !mapped.is_empty() {
                return mapped;
            }
        }
    }
    message
        .tool_calls
        .iter()
        .map(|call| {
            json!({
                "id": call.id,
                "type": "function",
                "function": {
                    "name": call.name,
                    "arguments": valid_json_arguments(&call.arguments),
                }
            })
        })
        .collect()
}

fn normalize_chat_tool_call(raw: &Value) -> Option<Value> {
    let function = raw.get("function")?;
    let name = function
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if name.is_empty() {
        return None;
    }
    let id = raw.get("id").and_then(Value::as_str).unwrap_or_default();
    let arguments = function
        .get("arguments")
        .and_then(Value::as_str)
        .unwrap_or("{}");
    Some(json!({
        "id": id,
        "type": "function",
        "function": {"name": name, "arguments": valid_json_arguments(arguments)},
    }))
}

fn tool_message(message: &HistoryMessage) -> Value {
    json!({
        "role": "tool",
        "tool_call_id": message.tool_call_id.clone().unwrap_or_default(),
        "content": message.text,
    })
}

/* ------------------------------------------------------------------ */
/* Streaming                                                           */
/* ------------------------------------------------------------------ */

#[derive(Default)]
struct ChatToolCall {
    id: String,
    name: String,
    arguments: String,
}

struct Handler<'a> {
    sink: &'a EventSink,
    usage: Option<UsageInfo>,
    tools: BTreeMap<usize, ChatToolCall>,
}

impl<'a> Handler<'a> {
    fn new(sink: &'a EventSink) -> Self {
        Self {
            sink,
            usage: None,
            tools: BTreeMap::new(),
        }
    }

    fn on_event(&mut self, _event: Option<&str>, data: &str) -> anyhow::Result<()> {
        let Ok(value) = serde_json::from_str::<Value>(data) else {
            // Providers occasionally send keep-alive/proprietary frames.
            return Ok(());
        };
        if let Some(error) = value.get("error") {
            return Err(anyhow::Error::new(ProviderError::Other(format!(
                "erro do provedor: {error}"
            ))));
        }
        if let Some(usage) = value.get("usage").filter(|usage| !usage.is_null()) {
            self.usage = Some(parse_usage(usage));
        }
        let Some(choices) = value.get("choices").and_then(Value::as_array) else {
            return Ok(());
        };
        for choice in choices {
            if let Some(delta) = choice.get("delta") {
                if let Some(text) = delta.get("content").and_then(Value::as_str) {
                    if !text.is_empty() {
                        emit(self.sink, ProviderEvent::TextDelta(text.to_string()))?;
                    }
                }
                let reasoning = delta
                    .get("reasoning_content")
                    .or_else(|| delta.get("reasoning"))
                    .and_then(Value::as_str);
                if let Some(text) = reasoning {
                    if !text.is_empty() {
                        emit(self.sink, ProviderEvent::ReasoningDelta(text.to_string()))?;
                    }
                }
                if let Some(tool_calls) = delta.get("tool_calls").and_then(Value::as_array) {
                    for tool_call in tool_calls {
                        self.on_tool_delta(tool_call)?;
                    }
                }
            }
        }
        Ok(())
    }

    fn on_tool_delta(&mut self, delta: &Value) -> anyhow::Result<()> {
        let index = delta.get("index").and_then(as_u32).unwrap_or(0) as usize;
        let id = delta.get("id").and_then(Value::as_str).unwrap_or_default();
        let function = delta.get("function");
        let name = function
            .and_then(|function| function.get("name"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let arguments = function
            .and_then(|function| function.get("arguments"))
            .and_then(Value::as_str)
            .unwrap_or_default();

        if !self.tools.contains_key(&index) {
            let id = if id.is_empty() {
                format!("call_{index}")
            } else {
                id.to_string()
            };
            emit(
                self.sink,
                ProviderEvent::ToolCallStart {
                    index,
                    id: id.clone(),
                    name: name.to_string(),
                },
            )?;
            self.tools.insert(
                index,
                ChatToolCall {
                    id,
                    name: name.to_string(),
                    arguments: String::new(),
                },
            );
        } else if let Some(tool) = self.tools.get_mut(&index) {
            if tool.name.is_empty() && !name.is_empty() {
                tool.name = name.to_string();
            }
        }

        if !arguments.is_empty() {
            if let Some(tool) = self.tools.get_mut(&index) {
                tool.arguments.push_str(arguments);
            }
            emit(
                self.sink,
                ProviderEvent::ToolCallArgsDelta {
                    index,
                    delta: arguments.to_string(),
                },
            )?;
        }
        Ok(())
    }

    fn finish(mut self) -> ProviderResult<()> {
        let mut state_calls: Vec<Value> = Vec::new();
        for (index, tool) in std::mem::take(&mut self.tools) {
            let arguments = normalize_arguments(&tool.arguments);
            emit(
                self.sink,
                ProviderEvent::ToolCallDone {
                    index,
                    arguments: arguments.clone(),
                },
            )
            .map_err(to_provider_error)?;
            state_calls.push(json!({
                "id": tool.id,
                "type": "function",
                "function": {
                    "name": tool.name,
                    "arguments": valid_json_arguments(&arguments),
                }
            }));
        }
        if let Some(usage) = self.usage.take() {
            emit(self.sink, ProviderEvent::Usage(usage)).map_err(to_provider_error)?;
        }
        // Verbatim assistant payload for replays (needed to round-trip tool calls).
        emit(
            self.sink,
            ProviderEvent::ProviderState(json!({"tool_calls": state_calls})),
        )
        .map_err(to_provider_error)?;
        emit(self.sink, ProviderEvent::Done).map_err(to_provider_error)?;
        Ok(())
    }
}

fn parse_usage(usage: &Value) -> UsageInfo {
    let input = pointer_u32(usage, "/prompt_tokens");
    let output = pointer_u32(usage, "/completion_tokens");
    let reasoning = pointer_u32(usage, "/completion_tokens_details/reasoning_tokens")
        .or_else(|| pointer_u32(usage, "/reasoning_tokens"));
    let cached = pointer_u32(usage, "/prompt_tokens_details/cached_tokens")
        .or_else(|| pointer_u32(usage, "/cache_read_input_tokens"));
    let total = pointer_u32(usage, "/total_tokens");
    make_usage(input, output, reasoning, cached, total)
}
