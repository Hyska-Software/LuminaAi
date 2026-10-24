//! OpenAI Responses protocol adapter (SSE).
//!
//! Used by GPT, Grok and Muse. Text/reasoning arrive as named events
//! (`response.output_text.delta`, `response.reasoning_summary_text.delta`), tool
//! calls as `response.function_call_arguments.delta` items and the final
//! `response.completed` event carries the full output (used as `provider_state`)
//! plus the usage block.

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::domain::UsageInfo;

use super::sse;
use super::{
    emit, endpoint, image_data_url, make_usage, max_output_tokens, pointer_u32, reasoning,
    send_stream, system_text, to_provider_error, valid_json_arguments, CompletionRequest, EventSink,
    HistoryMessage, HistoryRole, ProviderError, ProviderEvent, ProviderResult, ReasoningRequest,
    WireProtocol, RESPONSES_PATH,
};

pub(crate) async fn stream(
    http: &reqwest::Client,
    request: &CompletionRequest,
    sink: &EventSink,
) -> ProviderResult<()> {
    let url = endpoint(&request.config.base_url, RESPONSES_PATH);
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
    let mut input: Vec<Value> = Vec::new();
    for message in &request.history {
        match message.role {
            HistoryRole::System => {}
            HistoryRole::User => input.push(user_item(message)),
            HistoryRole::Assistant => append_assistant(message, &mut input),
            HistoryRole::Tool => input.push(json!({
                "type": "function_call_output",
                "call_id": message.tool_call_id.clone().unwrap_or_default(),
                "output": message.text,
            })),
        }
    }

    let mut body = json!({
        "model": model.id,
        "input": input,
        "stream": true,
        "max_output_tokens": max_output_tokens(request),
    });
    let system = system_text(request);
    if !system.is_empty() {
        body["instructions"] = json!(system);
    }
    if !request.tools.is_empty() {
        let tools: Vec<Value> = request
            .tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "function",
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                })
            })
            .collect();
        body["tools"] = json!(tools);
    }
    // Reasoning models reject a custom temperature; only send it when the
    // caller is not explicitly steering reasoning.
    if let Some(temperature) = request.temperature {
        if matches!(request.reasoning, ReasoningRequest::Auto | ReasoningRequest::Off) {
            body["temperature"] = json!(temperature);
        }
    }
    reasoning::apply(
        WireProtocol::OpenaiResponses,
        model,
        &request.reasoning,
        &mut body,
    );
    body
}

fn user_item(message: &HistoryMessage) -> Value {
    if message.images.is_empty() {
        return json!({"role": "user", "content": message.text});
    }
    let mut content: Vec<Value> = Vec::new();
    if !message.text.trim().is_empty() {
        content.push(json!({"type": "input_text", "text": message.text}));
    }
    for image in &message.images {
        content.push(json!({"type": "input_image", "image_url": image_data_url(image)}));
    }
    json!({"role": "user", "content": content})
}

fn append_assistant(message: &HistoryMessage, input: &mut Vec<Value>) {
    if let Some(state) = &message.provider_state {
        let items = match state {
            Value::Array(items) => Some(items.clone()),
            Value::Object(map) => map.get("output").and_then(Value::as_array).cloned(),
            _ => None,
        };
        if let Some(items) = items {
            let replayable: Vec<Value> = items
                .into_iter()
                .filter(replayable_output_item)
                .collect();
            if !replayable.is_empty() {
                input.extend(replayable);
                return;
            }
        }
    }
    if !message.text.trim().is_empty() {
        input.push(json!({
            "type": "message",
            "role": "assistant",
            "content": [{"type": "output_text", "text": message.text}],
        }));
    }
    for call in &message.tool_calls {
        input.push(json!({
            "type": "function_call",
            "call_id": call.id,
            "name": call.name,
            "arguments": valid_json_arguments(&call.arguments),
        }));
    }
}

/// Reasoning items can only be replayed statelessly when they carry their
/// encrypted content; everything else in `response.output` is round-trippable.
fn replayable_output_item(item: &Value) -> bool {
    if item.get("type").and_then(Value::as_str) == Some("reasoning") {
        return item
            .get("encrypted_content")
            .and_then(Value::as_str)
            .map(|content| !content.is_empty())
            .unwrap_or(false);
    }
    true
}

/* ------------------------------------------------------------------ */
/* Streaming                                                           */
/* ------------------------------------------------------------------ */

struct ResponsesTool {
    call_id: String,
    name: String,
    arguments: String,
    done: bool,
}

struct Handler<'a> {
    sink: &'a EventSink,
    text: String,
    usage: Option<UsageInfo>,
    output: Option<Value>,
    tools: Vec<ResponsesTool>,
    item_to_index: HashMap<String, usize>,
}

impl<'a> Handler<'a> {
    fn new(sink: &'a EventSink) -> Self {
        Self {
            sink,
            text: String::new(),
            usage: None,
            output: None,
            tools: Vec::new(),
            item_to_index: HashMap::new(),
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
            "response.output_text.delta" | "response.refusal.delta" => {
                if let Some(delta) = value.get("delta").and_then(Value::as_str) {
                    if !delta.is_empty() {
                        self.text.push_str(delta);
                        emit(self.sink, ProviderEvent::TextDelta(delta.to_string()))?;
                    }
                }
            }
            "response.reasoning_summary_text.delta" | "response.reasoning_text.delta" => {
                if let Some(delta) = value.get("delta").and_then(Value::as_str) {
                    if !delta.is_empty() {
                        emit(self.sink, ProviderEvent::ReasoningDelta(delta.to_string()))?;
                    }
                }
            }
            "response.output_item.added" => self.on_item_added(&value)?,
            "response.function_call_arguments.delta" => self.on_arguments_delta(&value)?,
            "response.function_call_arguments.done" => self.on_arguments_done(&value)?,
            "response.output_item.done" => self.on_item_done(&value)?,
            "response.completed" | "response.incomplete" => self.on_completed(&value)?,
            "response.failed" => {
                let detail = value
                    .pointer("/response/error")
                    .or_else(|| value.get("error"))
                    .cloned()
                    .unwrap_or(value.clone());
                return Err(anyhow::Error::new(ProviderError::Other(format!(
                    "resposta falhou: {detail}"
                ))));
            }
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

    fn on_item_added(&mut self, value: &Value) -> anyhow::Result<()> {
        let Some(item) = value.get("item") else {
            return Ok(());
        };
        if item.get("type").and_then(Value::as_str) != Some("function_call") {
            return Ok(());
        }
        let item_id = item
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let call_id = item
            .get("call_id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .filter(|id| !id.is_empty())
            .unwrap_or_else(|| item_id.clone());
        let name = item
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let index = self.tools.len();
        if !item_id.is_empty() {
            self.item_to_index.insert(item_id, index);
        }
        emit(
            self.sink,
            ProviderEvent::ToolCallStart {
                index,
                id: call_id.clone(),
                name: name.clone(),
            },
        )?;
        self.tools.push(ResponsesTool {
            call_id,
            name,
            arguments: String::new(),
            done: false,
        });
        Ok(())
    }

    fn on_arguments_delta(&mut self, value: &Value) -> anyhow::Result<()> {
        let item_id = value
            .get("item_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let delta = value
            .get("delta")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let index = match self.item_to_index.get(&item_id) {
            Some(index) => *index,
            None => self.ensure_tool(&item_id)?,
        };
        if let Some(tool) = self.tools.get_mut(index) {
            tool.arguments.push_str(delta);
        }
        if !delta.is_empty() {
            emit(
                self.sink,
                ProviderEvent::ToolCallArgsDelta {
                    index,
                    delta: delta.to_string(),
                },
            )?;
        }
        Ok(())
    }

    fn on_arguments_done(&mut self, value: &Value) -> anyhow::Result<()> {
        let item_id = value
            .get("item_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let index = match self.item_to_index.get(&item_id) {
            Some(index) => *index,
            None => self.ensure_tool(&item_id)?,
        };
        if let Some(arguments) = value.get("arguments").and_then(Value::as_str) {
            if !arguments.is_empty() {
                if let Some(tool) = self.tools.get_mut(index) {
                    tool.arguments = arguments.to_string();
                }
            }
        }
        self.finish_tool(index)
    }

    fn on_item_done(&mut self, value: &Value) -> anyhow::Result<()> {
        let Some(item) = value.get("item") else {
            return Ok(());
        };
        match item.get("type").and_then(Value::as_str) {
            Some("function_call") => {
                let item_id = item
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let index = match self.item_to_index.get(&item_id) {
                    Some(index) => *index,
                    None => self.ensure_tool(&item_id)?,
                };
                if let Some(tool) = self.tools.get_mut(index) {
                    if let Some(arguments) = item.get("arguments").and_then(Value::as_str) {
                        if !arguments.is_empty() {
                            tool.arguments = arguments.to_string();
                        }
                    }
                    if tool.name.is_empty() {
                        if let Some(name) = item.get("name").and_then(Value::as_str) {
                            tool.name = name.to_string();
                        }
                    }
                }
                self.finish_tool(index)
            }
            Some("message") => {
                // Some gateways skip the incremental deltas; recover the text
                // from the finished output item when nothing was streamed.
                if self.text.is_empty() {
                    if let Some(content) = item.get("content").and_then(Value::as_array) {
                        for part in content {
                            if part.get("type").and_then(Value::as_str) == Some("output_text") {
                                if let Some(text) = part.get("text").and_then(Value::as_str) {
                                    if !text.is_empty() {
                                        self.text.push_str(text);
                                        emit(
                                            self.sink,
                                            ProviderEvent::TextDelta(text.to_string()),
                                        )?;
                                    }
                                }
                            }
                        }
                    }
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    fn on_completed(&mut self, value: &Value) -> anyhow::Result<()> {
        let Some(response) = value.get("response") else {
            return Ok(());
        };
        if let Some(output) = response.get("output") {
            if output.is_array() {
                self.output = Some(output.clone());
            }
        }
        if let Some(usage) = response.get("usage").filter(|usage| !usage.is_null()) {
            self.usage = Some(parse_usage(usage));
        }
        if let Some(error) = response.get("error").filter(|error| !error.is_null()) {
            return Err(anyhow::Error::new(ProviderError::Other(format!(
                "resposta falhou: {error}"
            ))));
        }
        Ok(())
    }

    fn ensure_tool(&mut self, item_id: &str) -> anyhow::Result<usize> {
        let index = self.tools.len();
        let call_id = if item_id.is_empty() {
            format!("call_{index}")
        } else {
            item_id.to_string()
        };
        if !item_id.is_empty() {
            self.item_to_index.insert(item_id.to_string(), index);
        }
        emit(
            self.sink,
            ProviderEvent::ToolCallStart {
                index,
                id: call_id.clone(),
                name: String::new(),
            },
        )?;
        self.tools.push(ResponsesTool {
            call_id,
            name: String::new(),
            arguments: String::new(),
            done: false,
        });
        Ok(index)
    }

    fn finish_tool(&mut self, index: usize) -> anyhow::Result<()> {
        let Some(tool) = self.tools.get_mut(index) else {
            return Ok(());
        };
        if tool.done {
            return Ok(());
        }
        tool.done = true;
        let arguments = super::normalize_arguments(&tool.arguments);
        emit(
            self.sink,
            ProviderEvent::ToolCallDone { index, arguments },
        )?;
        Ok(())
    }

    fn finish(mut self) -> ProviderResult<()> {
        for index in 0..self.tools.len() {
            self.finish_tool(index).map_err(to_provider_error)?;
        }

        let state = match self.output.take() {
            Some(output) => output,
            None => self.build_fallback_output(),
        };
        if let Some(usage) = self.usage.take() {
            emit(self.sink, ProviderEvent::Usage(usage)).map_err(to_provider_error)?;
        }
        emit(self.sink, ProviderEvent::ProviderState(state)).map_err(to_provider_error)?;
        emit(self.sink, ProviderEvent::Done).map_err(to_provider_error)?;
        Ok(())
    }

    fn build_fallback_output(&self) -> Value {
        let mut output: Vec<Value> = Vec::new();
        if !self.text.is_empty() {
            output.push(json!({
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": self.text}],
            }));
        }
        for tool in &self.tools {
            output.push(json!({
                "type": "function_call",
                "call_id": tool.call_id,
                "name": tool.name,
                "arguments": valid_json_arguments(&tool.arguments),
            }));
        }
        Value::Array(output)
    }
}

fn parse_usage(usage: &Value) -> UsageInfo {
    let input = pointer_u32(usage, "/input_tokens");
    let output = pointer_u32(usage, "/output_tokens");
    let reasoning = pointer_u32(usage, "/output_tokens_details/reasoning_tokens");
    let cached = pointer_u32(usage, "/input_tokens_details/cached_tokens");
    let total = pointer_u32(usage, "/total_tokens");
    make_usage(input, output, reasoning, cached, total)
}
