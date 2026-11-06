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
    cache, emit, image_base64, make_usage, max_output_tokens, parse_arguments, pointer_u32,
    reasoning, system_text, to_provider_error, CompletionRequest, EventSink, HistoryMessage,
    HistoryRole, ProviderError, ProviderEvent, ProviderResult, WireProtocol,
};

pub(crate) async fn stream(
    http: &reqwest::Client,
    request: &CompletionRequest,
    sink: &EventSink,
) -> ProviderResult<()> {
    let url = request.config.endpoint_for(WireProtocol::Google)?;
    let mut body = build_body(request);
    // F4b: the harness-owned plan lands on the final wire body before the
    // digest (Google's implicit path is a no-op, kept for symmetry and for a
    // future explicit `cachedContent`). `digest(apply(body)) == digest(body)`.
    cache::apply(WireProtocol::Google, request.cache_plan.as_ref(), &mut body);
    super::emit_cache_digest(request, WireProtocol::Google, &body, sink)?;
    let Some(response) =
        super::send_stream_with_cache_fallback(http, request, &url, &body, || build_body(request))
            .await?
    else {
        return Ok(());
    };
    let mut handler = Handler::new(sink, request.config.provider_id.clone());
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
    let mut parts = vec![json!({
        "functionResponse": {
            "name": name,
            "response": response,
        }
    })];
    // Screenshots follow the function response as inline data in the same
    // user turn; Gemini accepts both parts in one content block.
    for image in &message.images {
        let (mime_type, data) = image_base64(image);
        parts.push(json!({"inlineData": {"mimeType": mime_type, "data": data}}));
    }
    parts
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
    /// Route that produced the request (used to gate the OpenCode gateway
    /// `usage.opencode.tokens` fallback).
    provider_id: String,
    text: String,
    reasoning: String,
    reasoning_signature: Option<String>,
    text_signature: Option<String>,
    /// `functionCall` parts preserved verbatim (including thought signatures)
    /// so the next step can replay the model turn.
    calls: Vec<Value>,
    next_index: usize,
    usage: Option<UsageInfo>,
    /// Verbatim `usageMetadata` block (safe excerpt is emitted as `UsageRaw`).
    raw_usage: Option<Value>,
}

impl<'a> Handler<'a> {
    fn new(sink: &'a EventSink, provider_id: String) -> Self {
        Self {
            sink,
            provider_id,
            text: String::new(),
            reasoning: String::new(),
            reasoning_signature: None,
            text_signature: None,
            calls: Vec::new(),
            next_index: 0,
            usage: None,
            raw_usage: None,
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
            self.raw_usage = Some(usage.clone());
            self.usage = Some(parse_usage(usage, &self.provider_id));
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
        // Safe raw usage excerpt for the diagnostics panel, before the state/Done.
        super::emit_usage_raw(self.sink, self.raw_usage.as_ref())?;
        emit(self.sink, ProviderEvent::ProviderState(Value::Array(parts)))
            .map_err(to_provider_error)?;
        emit(self.sink, ProviderEvent::Done).map_err(to_provider_error)?;
        Ok(())
    }
}

fn parse_usage(usage: &Value, provider_id: &str) -> UsageInfo {
    let input = pointer_u32(usage, "/promptTokenCount");
    let output = pointer_u32(usage, "/candidatesTokenCount");
    let reasoning = pointer_u32(usage, "/thoughtsTokenCount");
    let cached = pointer_u32(usage, "/cachedContentTokenCount");
    let total = pointer_u32(usage, "/totalTokenCount");
    let mut info = make_usage(input, output, reasoning, cached, total);
    // `cachedContentTokenCount` is a subset of `promptTokenCount`; the gateway
    // may report its own `cache_read`/`cache_write_*` block instead.
    cache::apply_usage(
        &mut info,
        &cache::normalize_usage(WireProtocol::Google, provider_id, usage),
    );
    info
}

/* ------------------------------------------------------------------ */
/* Usage parsing tests                                                 */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_image_is_appended_as_inline_data() {
        let mut message = HistoryMessage::tool_result("call-1", "computer_screenshot", "ok");
        message.images.push(crate::providers::ImagePart {
            mime_type: "image/jpeg".to_string(),
            data_base64: "abc".to_string(),
        });
        let parts = tool_parts(&message);
        assert_eq!(parts[0]["functionResponse"]["name"], json!("computer_screenshot"));
        assert_eq!(parts[1]["inlineData"]["mimeType"], json!("image/jpeg"));
    }

    #[test]
    fn parse_usage_fills_cached_content_tokens() {
        let usage = parse_usage(
            &json!({
                "promptTokenCount": 20_000,
                "candidatesTokenCount": 500,
                "cachedContentTokenCount": 18_000,
                "totalTokenCount": 20_500,
            }),
            "opencode-go",
        );
        assert!(usage.cache_reported);
        assert_eq!(usage.cached_tokens, Some(18_000), "alias legado");
        assert_eq!(usage.cache_read_tokens, Some(18_000));
        assert_eq!(usage.cache_write_tokens, None);
        assert_eq!(usage.uncached_input_tokens, Some(2_000));
        assert_eq!(usage.input_tokens, Some(20_000));
    }

    #[test]
    fn parse_usage_without_cached_content_is_not_reported() {
        let usage = parse_usage(
            &json!({"promptTokenCount": 1_200, "candidatesTokenCount": 10}),
            "opencode-go",
        );
        assert!(!usage.cache_reported);
        assert_eq!(usage.cache_read_tokens, None);
        assert_eq!(usage.input_tokens, Some(1_200));
    }

    fn test_request() -> CompletionRequest {
        let catalog = crate::catalog::CatalogFile::load().expect("catalog.json carrega");
        let provider = catalog
            .provider("opencode-go")
            .expect("provider opencode-go");
        let model = catalog
            .model("opencode-go", "gemini-4-argon-contributor")
            .expect("gemini-4-argon-contributor")
            .clone();
        CompletionRequest {
            config: crate::providers::ProviderConfig {
                provider_id: provider.id.clone(),
                provider_name: provider.name.clone(),
                base_url: provider.base_url.clone(),
                api_key: "sk-test".to_string(),
                model,
                session_id: "session-1".to_string(),
                user_agent: "Lumina/test".to_string(),
                endpoints: provider.endpoints.clone(),
                request_profile: crate::catalog::RequestProfile::Standard,
                auth_mode: crate::catalog::ProviderAuth::ApiKey,
                extra_headers: Vec::new(),
            },
            protocols: vec![WireProtocol::Google],
            history: vec![HistoryMessage::user("oi")],
            system_prompt: "Você é o Lumina.".to_string(),
            tools: vec![crate::providers::ToolDefinition {
                name: "echo".to_string(),
                description: "Ecoa.".to_string(),
                parameters: json!({"type": "object"}),
            }],
            reasoning: crate::providers::ReasoningRequest::Auto,
            max_output_tokens: Some(64),
            temperature: None,
            cache_plan: None,
            cancel: tokio_util::sync::CancellationToken::new(),
        }
    }

    /// F4b: the Google adapter applies the plan (a no-op for the implicit
    /// cache) before the digest; the body stays byte-for-byte identical.
    #[test]
    fn cache_plan_keeps_the_google_body_unchanged() {
        let mut request = test_request();
        let plain = build_body(&request);

        let mut without_plan = build_body(&request);
        cache::apply(WireProtocol::Google, None, &mut without_plan);
        assert_eq!(without_plan, plain, "sem plano o body não muda");

        request.cache_plan = Some(cache::CachePlan {
            mode: cache::CacheMode::Auto,
            breakpoints: Vec::new(),
            prompt_cache_key: Some("c".repeat(64)),
            retention: None,
            ttl: Some("1h".to_string()),
        });
        let mut planned = build_body(&request);
        cache::apply(
            WireProtocol::Google,
            request.cache_plan.as_ref(),
            &mut planned,
        );
        assert_eq!(planned, plain, "Google implícito não tem campo no body");

        let digest_plain = cache::digest(WireProtocol::Google, "opencode-go", &plain);
        let digest_planned = cache::digest(WireProtocol::Google, "opencode-go", &planned);
        assert_eq!(digest_plain.segments, digest_planned.segments);
        assert_eq!(digest_plain.total_chars, digest_planned.total_chars);
    }

    /// B2: `UsageRaw` carries the safe `usageMetadata` excerpt after `Usage`.
    #[test]
    fn usage_raw_is_emitted_after_usage_with_a_safe_excerpt() {
        let (sink, mut events) = tokio::sync::mpsc::unbounded_channel();
        {
            let mut handler = Handler::new(&sink, "opencode-go".to_string());
            handler
                .on_event(
                    None,
                    r#"{"usageMetadata":{"promptTokenCount":20000,"candidatesTokenCount":500,
                        "cachedContentTokenCount":18000,"thoughtsTokenCount":12,
                        "content":"SEGREDO","secret":"x"}}"#,
                )
                .expect("chunk de usageMetadata");
            handler.finish().expect("finish");
        }

        let mut order: Vec<&'static str> = Vec::new();
        let mut raw = None;
        while let Ok(event) = events.try_recv() {
            match event {
                ProviderEvent::Usage(_) => order.push("usage"),
                ProviderEvent::UsageRaw(value) => {
                    order.push("usage_raw");
                    raw = Some(value);
                }
                ProviderEvent::Done => order.push("done"),
                _ => {}
            }
        }
        assert_eq!(order, vec!["usage", "usage_raw", "done"]);
        let raw = raw.expect("UsageRaw emitido");
        assert_eq!(raw["cachedContentTokenCount"], json!(18_000));
        assert_eq!(raw["promptTokenCount"], json!(20_000));
        let serialized = raw.to_string();
        assert!(!serialized.contains("SEGREDO"), "{serialized}");
        assert!(!serialized.contains("content"), "{serialized}");
        assert!(!serialized.contains("secret"), "{serialized}");
    }
}
