//! Google Generative Language protocol adapter (SSE).
//!
//! `POST {base}/google/v1beta/models/{model}:streamGenerateContent?alt=sse`.
//! Text/thought parts arrive as `candidates[0].content.parts`; function calls
//! arrive complete in a single part (`functionCall.args` is already an object);
//! usage is the cumulative `usageMetadata` block.

use serde_json::{json, Value};

use crate::domain::UsageInfo;

use super::sse;
use super::{
    emit, image_base64, make_usage, max_output_tokens, parse_arguments, pointer_u32, reasoning,
    send_stream, system_text, to_provider_error, CompletionRequest, EventSink, HistoryMessage,
    HistoryRole, ProviderError, ProviderEvent, ProviderResult, WireProtocol,
};

pub(crate) async fn stream(
    http: &reqwest::Client,
    request: &CompletionRequest,
    sink: &EventSink,
) -> ProviderResult<()> {
    let url = request.config.endpoint_for(WireProtocol::Google)?;
    let body = build_body(request);
    let Some(response) = send_stream(http, request, &url, &body).await? else {
        return Ok(());
    };
    let mut handler = Handler::new(sink);
    let outcome = sse::stream_sse(response, &request.cancel, |event, data| {
        handler.on_event(event, data)
    })
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
    let mut contents: Vec<Value> = Vec::new();
    for message in &request.history {
        match message.role {
            HistoryRole::System => {}
            HistoryRole::User => push_content(&mut contents, "user", user_parts(message)),
            HistoryRole::Assistant => {
                push_content(&mut contents, "model", assistant_parts(message))
            }
            HistoryRole::Tool => push_content(&mut contents, "user", tool_parts(message)),
        }
    }

    let mut body = json!({
        "contents": contents,
        "generationConfig": {"maxOutputTokens": max_output_tokens(request)},
    });
    let system = system_text(request);
    if !system.is_empty() {
        body["systemInstruction"] = json!({"parts": [{"text": system}]});
    }
    if let Some(temperature) = request.temperature {
        body["generationConfig"]["temperature"] = json!(temperature);
    }
    if !request.tools.is_empty() {
        let declarations: Vec<Value> = request
            .tools
            .iter()
            .map(|tool| {
                json!({
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                })
            })
            .collect();
        body["tools"] = json!([{"functionDeclarations": declarations}]);
    }
    reasoning::apply(WireProtocol::Google, model, &request.reasoning, &mut body);
    body
}

fn user_parts(message: &HistoryMessage) -> Vec<Value> {
    let mut parts: Vec<Value> = Vec::new();
    if !message.text.trim().is_empty() {
        parts.push(json!({"text": message.text}));
    }
    for image in &message.images {
        let (mime_type, data) = image_base64(image);
        parts.push(json!({"inlineData": {"mimeType": mime_type, "data": data}}));
    }
    parts
}

fn assistant_parts(message: &HistoryMessage) -> Vec<Value> {
    if let Some(state) = &message.provider_state {
        let parts = match state {
            Value::Array(parts) => Some(parts.clone()),
            Value::Object(map) => map.get("parts").and_then(Value::as_array).cloned(),
            _ => None,
        };
        if let Some(parts) = parts {
            if !parts.is_empty() {
                return parts;
            }
        }
    }
    let mut parts: Vec<Value> = Vec::new();
    if !message.text.trim().is_empty() {
        parts.push(json!({"text": message.text}));
    }
    for call in &message.tool_calls {
        parts.push(json!({
            "functionCall": {
                "name": call.name,
                "args": parse_arguments(&call.arguments),
            }
        }));
    }
    parts
}

fn tool_parts(message: &HistoryMessage) -> Vec<Value> {
    let name = message.tool_name.clone().unwrap_or_default();
    // `functionResponse.response` must be a JSON object: reuse the tool's JSON
    // result when possible, otherwise wrap the text in `{"result": …}`.
    let response = serde_json::from_str::<Value>(&message.text)
        .ok()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({"result": message.text}));
    vec![json!({
        "functionResponse": {
            "name": name,
            "response": response,
        }
    })]
}

fn push_content(contents: &mut Vec<Value>, role: &str, parts: Vec<Value>) {
    if parts.is_empty() {
        return;
    }
    if let Some(last) = contents.last_mut() {
        if last.get("role").and_then(Value::as_str) == Some(role) {
            if let Some(existing) = last.get_mut("parts").and_then(Value::as_array_mut) {
                existing.extend(parts);
                return;
            }
        }
    }
    contents.push(json!({"role": role, "parts": parts}));
}

/* ------------------------------------------------------------------ */
/* Streaming                                                           */
/* ------------------------------------------------------------------ */

struct Handler<'a> {
    sink: &'a EventSink,
    text: String,
    reasoning: String,
    reasoning_signature: Option<String>,
    text_signature: Option<String>,
    /// `functionCall` parts preserved verbatim (including thought signatures)
    /// so the next step can replay the model turn.
    calls: Vec<Value>,
    next_index: usize,
    usage: Option<UsageInfo>,
}

impl<'a> Handler<'a> {
    fn new(sink: &'a EventSink) -> Self {
        Self {
            sink,
            text: String::new(),
            reasoning: String::new(),
            reasoning_signature: None,
            text_signature: None,
            calls: Vec::new(),
            next_index: 0,
            usage: None,
        }
    }

    fn on_event(&mut self, _event: Option<&str>, data: &str) -> anyhow::Result<()> {
        let Ok(value) = serde_json::from_str::<Value>(data) else {
            return Ok(());
        };
        if let Some(error) = value.get("error") {
            return Err(anyhow::Error::new(ProviderError::Other(format!(
                "erro do provedor: {error}"
            ))));
        }
        if let Some(usage) = value.get("usageMetadata").filter(|usage| !usage.is_null()) {
            self.usage = Some(parse_usage(usage));
        }
        let Some(candidates) = value.get("candidates").and_then(Value::as_array) else {
            return Ok(());
        };
        let Some(candidate) = candidates.first() else {
            return Ok(());
        };
        let Some(parts) = candidate
            .pointer("/content/parts")
            .and_then(Value::as_array)
        else {
            return Ok(());
        };
        for part in parts {
            self.on_part(part)?;
        }
        Ok(())
    }

    fn on_part(&mut self, part: &Value) -> anyhow::Result<()> {
        let signature = part.get("thoughtSignature").and_then(Value::as_str);
        if let Some(call) = part.get("functionCall") {
            let name = call
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let args = call.get("args").cloned().unwrap_or_else(|| json!({}));
            let arguments = serde_json::to_string(&args).unwrap_or_else(|_| "{}".to_string());
            let index = self.next_index;
            self.next_index += 1;
            let id = format!("call_{index}");
            emit(
                self.sink,
                ProviderEvent::ToolCallStart {
                    index,
                    id,
                    name: name.clone(),
                },
            )?;
            emit(
                self.sink,
                ProviderEvent::ToolCallArgsDelta {
                    index,
                    delta: arguments.clone(),
                },
            )?;
            emit(self.sink, ProviderEvent::ToolCallDone { index, arguments })?;
            let mut state_part = json!({"functionCall": {"name": name, "args": args}});
            if let Some(signature) = part.get("thoughtSignature") {
                state_part["thoughtSignature"] = signature.clone();
            }
            self.calls.push(state_part);
            return Ok(());
        }
        if let Some(text) = part.get("text").and_then(Value::as_str) {
            if text.is_empty() {
                return Ok(());
            }
            let is_thought = part
                .get("thought")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if is_thought {
                self.reasoning.push_str(text);
                if let Some(signature) = signature.filter(|signature| !signature.is_empty()) {
                    self.reasoning_signature = Some(signature.to_string());
                }
                emit(self.sink, ProviderEvent::ReasoningDelta(text.to_string()))?;
            } else {
                self.text.push_str(text);
                if let Some(signature) = signature.filter(|signature| !signature.is_empty()) {
                    self.text_signature = Some(signature.to_string());
                }
                emit(self.sink, ProviderEvent::TextDelta(text.to_string()))?;
            }
        }
        Ok(())
    }

    fn finish(mut self) -> ProviderResult<()> {
        let mut parts: Vec<Value> = Vec::new();
        // Thought parts are exposed only by some models; their signature is
        // preserved so the model turn can be replayed.
        if !self.reasoning.is_empty() {
            let mut part = json!({"text": self.reasoning, "thought": true});
            if let Some(signature) = self.reasoning_signature.take() {
                part["thoughtSignature"] = json!(signature);
            }
            parts.push(part);
        }
        if !self.text.is_empty() {
            let mut part = json!({"text": self.text});
            if let Some(signature) = self.text_signature.take() {
                part["thoughtSignature"] = json!(signature);
            }
            parts.push(part);
        }
        parts.extend(std::mem::take(&mut self.calls));

        if let Some(usage) = self.usage.take() {
            emit(self.sink, ProviderEvent::Usage(usage)).map_err(to_provider_error)?;
        }
        emit(self.sink, ProviderEvent::ProviderState(Value::Array(parts)))
            .map_err(to_provider_error)?;
        emit(self.sink, ProviderEvent::Done).map_err(to_provider_error)?;
        Ok(())
    }
}

fn parse_usage(usage: &Value) -> UsageInfo {
    let input = pointer_u32(usage, "/promptTokenCount");
    let output = pointer_u32(usage, "/candidatesTokenCount");
    let reasoning = pointer_u32(usage, "/thoughtsTokenCount");
    let cached = pointer_u32(usage, "/cachedContentTokenCount");
    let total = pointer_u32(usage, "/totalTokenCount");
    make_usage(input, output, reasoning, cached, total)
}
