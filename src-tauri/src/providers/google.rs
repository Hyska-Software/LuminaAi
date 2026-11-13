//! Google Generative Language protocol adapter (SSE).
//!
//! `POST {base}{endpoint}` where the catalog endpoint substitutes `{model}` and
//! the adapter appends `:streamGenerateContent?alt=sse`.
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
    let outcome = sse::stream_sse(response, &request.cancel, &request.timeouts, |event, data| {
        handler.on_event(event, data)
    })
    .await;
    if let Err(error) = outcome {
        return Err(to_provider_error(error));
    }
    if request.cancel.is_cancelled() {
        return Ok(());
    }
    if handler.finish_reason.is_none() {
        return Err(ProviderError::StreamInterrupted(
            "stream ended without finishReason".to_string(),
        ));
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
            HistoryRole::Tool => {
                push_content(&mut contents, "user", tool_parts(message, !request.config.is_opencode()))
            }
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
                let mut declaration = json!({
                    "name": tool.name,
                    "description": tool.description,
                });
                if request.config.is_opencode() {
                    // Gateway keeps the existing OpenAPI-subset field.
                    declaration["parameters"] = tool.parameters.clone();
                } else {
                    // Direct Gemini accepts full JSON Schema (additionalProperties,
                    // maxLength, etc.), avoiding a lossy converter.
                    declaration["parametersJsonSchema"] = tool.parameters.clone();
                }
                declaration
            })
            .collect();
        body["tools"] = json!([{"functionDeclarations": declarations}]);
    }
    reasoning::apply(WireProtocol::Google, model, &request.reasoning, &mut body);
    apply_thinking_config(request, &mut body);
    body
}

/// Gemini only returns thought summaries when `includeThoughts` is set, and the
/// direct REST API documents lowercase `thinkingLevel` names.
fn apply_thinking_config(request: &CompletionRequest, body: &mut Value) {
    if request.config.model.reasoning_options.is_empty() {
        return;
    }
    let Some(generation) = body.get_mut("generationConfig").and_then(Value::as_object_mut) else {
        return;
    };
    let thinking = generation
        .entry("thinkingConfig")
        .or_insert_with(|| json!({}));
    if !thinking.is_object() {
        *thinking = json!({});
    }
    let Some(thinking) = thinking.as_object_mut() else {
        return;
    };
    thinking.entry("includeThoughts").or_insert(json!(true));
    if !request.config.is_opencode() {
        let level = thinking
            .get("thinkingLevel")
            .and_then(Value::as_str)
            .map(str::to_ascii_lowercase);
        if let Some(level) = level {
            thinking.insert("thinkingLevel".to_string(), json!(level));
        }
    }
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

fn tool_parts(message: &HistoryMessage, direct: bool) -> Vec<Value> {
    let name = message.tool_name.clone().unwrap_or_default();
    // `functionResponse.response` must be a JSON object: reuse the tool's JSON
    // result when possible, otherwise wrap the text in `{"result": …}`.
    let mut response = serde_json::from_str::<Value>(&message.text)
        .ok()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({"result": message.text}));
    let synthetic_id = message
        .tool_call_id
        .as_deref()
        .and_then(|id| id.strip_prefix("call_"))
        .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()));

    let mut nested: Vec<Value> = Vec::new();
    if direct {
        // Gemini 3/4 expect multimodal function responses nested in the
        // functionResponse part, referenced by displayName from the response.
        for (index, image) in message.images.iter().enumerate() {
            let (mime_type, data) = image_base64(image);
            let display = format!("image_{index}");
            response[&display] = json!({"$ref": display});
            nested.push(json!({
                "inlineData": {
                    "mimeType": mime_type,
                    "data": data,
                    "displayName": display,
                }
            }));
        }
    }

    let mut function_response = json!({
        "name": name,
        "response": response,
    });
    if let Some(id) = message.tool_call_id.as_deref() {
        if !id.is_empty() && !synthetic_id {
            function_response["id"] = json!(id);
        }
    }
    if direct && !nested.is_empty() {
        function_response["parts"] = json!(nested);
    }

    let mut parts = vec![json!({"functionResponse": function_response})];
    if !direct {
        // Gateway shape: screenshots follow the function response as inline
        // data in the same user turn.
        for image in &message.images {
            let (mime_type, data) = image_base64(image);
            parts.push(json!({"inlineData": {"mimeType": mime_type, "data": data}}));
        }
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
    /// Signature that arrived in a part with no text/functionCall.
    pending_signature: Option<String>,
    /// Last non-empty `candidate.finishReason`.
    finish_reason: Option<String>,
    /// `promptFeedback.blockReason`, when the prompt is blocked.
    block_reason: Option<String>,
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
            pending_signature: None,
            finish_reason: None,
            block_reason: None,
            usage: None,
            raw_usage: None,
        }
    }

    fn on_event(&mut self, _event: Option<&str>, data: &str) -> anyhow::Result<()> {
        let Ok(value) = serde_json::from_str::<Value>(data) else {
            return Ok(());
        };
        if let Some(error) = value.get("error") {
            return Err(anyhow::Error::new(ProviderError::from_stream_error(error)));
        }
        if let Some(usage) = value.get("usageMetadata").filter(|usage| !usage.is_null()) {
            self.raw_usage = Some(usage.clone());
            self.usage = Some(parse_usage(usage, &self.provider_id));
        }
        if let Some(block) = value
            .pointer("/promptFeedback/blockReason")
            .and_then(Value::as_str)
            .filter(|block| !block.trim().is_empty())
        {
            self.block_reason = Some(block.to_string());
        }
        let Some(candidates) = value.get("candidates").and_then(Value::as_array) else {
            return Ok(());
        };
        let Some(candidate) = candidates.first() else {
            return Ok(());
        };
        if let Some(reason) = candidate
            .get("finishReason")
            .and_then(Value::as_str)
            .filter(|reason| !reason.is_empty())
        {
            self.finish_reason = Some(reason.to_string());
        }
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
        let signature = part
            .get("thoughtSignature")
            .and_then(Value::as_str)
            .filter(|signature| !signature.is_empty())
            .map(str::to_string);
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
            let provider_call_id = call
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(str::to_string);
            let id = provider_call_id
                .clone()
                .unwrap_or_else(|| format!("call_{index}"));
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
            let mut call_state = json!({"name": name, "args": args});
            if let Some(id) = provider_call_id.as_ref() {
                call_state["id"] = json!(id);
            }
            let mut state_part = json!({"functionCall": call_state});
            let signature = signature.or_else(|| self.pending_signature.take());
            if let Some(signature) = signature {
                state_part["thoughtSignature"] = json!(signature);
            }
            self.calls.push(state_part);
            return Ok(());
        }
        if let Some(text) = part.get("text").and_then(Value::as_str) {
            if text.is_empty() {
                return Ok(());
            }
            let signature = signature.or_else(|| self.pending_signature.take());
            let is_thought = part
                .get("thought")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if is_thought {
                self.reasoning.push_str(text);
                if let Some(signature) = signature {
                    self.reasoning_signature = Some(signature);
                }
                emit(self.sink, ProviderEvent::ReasoningDelta(text.to_string()))?;
            } else {
                self.text.push_str(text);
                if let Some(signature) = signature {
                    self.text_signature = Some(signature);
                }
                emit(self.sink, ProviderEvent::TextDelta(text.to_string()))?;
            }
            return Ok(());
        }
        // Signature-only part: hold it for the next content part (or for the
        // first call / last text part at finish time).
        if let Some(signature) = signature {
            self.pending_signature = Some(signature);
        }
        Ok(())
    }

    fn finish(mut self) -> ProviderResult<()> {
        let has_content =
            !self.text.is_empty() || !self.reasoning.is_empty() || !self.calls.is_empty();
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

        // A signature that arrived in its own part belongs to the first call
        // (or, for text-only responses, the last text part). Never overwrite an
        // existing signature and never attach it to a later parallel call.
        if let Some(signature) = self.pending_signature.take() {
            if let Some(first_call) = parts
                .iter_mut()
                .find(|part| part.get("functionCall").is_some())
            {
                if first_call.get("thoughtSignature").is_none() {
                    first_call["thoughtSignature"] = json!(signature);
                }
            } else if let Some(text_part) = parts
                .iter_mut()
                .rev()
                .find(|part| part.get("text").is_some())
            {
                if text_part.get("thoughtSignature").is_none() {
                    text_part["thoughtSignature"] = json!(signature);
                }
            }
        }

        if let Some(usage) = self.usage.take() {
            emit(self.sink, ProviderEvent::Usage(usage)).map_err(to_provider_error)?;
        }
        // Safe raw usage excerpt for the diagnostics panel, before the state/Done.
        super::emit_usage_raw(self.sink, self.raw_usage.as_ref())?;

        if let Some(reason) = self.finish_reason.as_deref() {
            if reason == "CONTINUATION" {
                return Err(ProviderError::Other(crate::i18n::t(
                    "providers.errors.geminiContinuation",
                )));
            }
        }
        if !has_content {
            if let Some(block) = self.block_reason.as_deref() {
                return Err(ProviderError::Other(crate::i18n::t_args(
                    "providers.errors.geminiBlocked",
                    &[("reason", block)],
                )));
            }
            if let Some(reason) = self.finish_reason.as_deref() {
                if matches!(
                    reason,
                    "SAFETY"
                        | "PROHIBITED_CONTENT"
                        | "BLOCKLIST"
                        | "RECITATION"
                        | "SPII"
                        | "MALFORMED_FUNCTION_CALL"
                        | "MISSING_THOUGHT_SIGNATURE"
                ) {
                    return Err(ProviderError::Other(crate::i18n::t_args(
                        "providers.errors.geminiFinish",
                        &[("reason", reason)],
                    )));
                }
            }
        }

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
    fn gateway_appends_tool_image_as_inline_data() {
        let mut message = HistoryMessage::tool_result("call-1", "computer_screenshot", "ok");
        message.images.push(crate::providers::ImagePart {
            mime_type: "image/jpeg".to_string(),
            data_base64: "abc".to_string(),
        });
        let parts = tool_parts(&message, false);
        assert_eq!(parts[0]["functionResponse"]["name"], json!("computer_screenshot"));
        assert_eq!(parts[1]["inlineData"]["mimeType"], json!("image/jpeg"));
    }

    #[test]
    fn direct_provider_nests_tool_images_in_the_function_response() {
        let mut message = HistoryMessage::tool_result("call-1", "computer_screenshot", "ok");
        message.images.push(crate::providers::ImagePart {
            mime_type: "image/jpeg".to_string(),
            data_base64: "abc".to_string(),
        });
        let parts = tool_parts(&message, true);
        assert_eq!(parts.len(), 1, "sem inlineData irmão");
        let response = &parts[0]["functionResponse"];
        assert_eq!(response["name"], json!("computer_screenshot"));
        assert_eq!(response["response"]["image_0"]["$ref"], json!("image_0"));
        assert_eq!(
            response["parts"][0]["inlineData"]["displayName"],
            json!("image_0")
        );
        assert_eq!(
            response["parts"][0]["inlineData"]["mimeType"],
            json!("image/jpeg")
        );
    }

    #[test]
    fn function_response_replays_provider_ids_but_drops_synthetic_ones() {
        let message = HistoryMessage::tool_result("abc", "echo", "ok");
        let parts = tool_parts(&message, true);
        assert_eq!(parts[0]["functionResponse"]["id"], json!("abc"));

        let legacy = HistoryMessage::tool_result("call_3", "echo", "ok");
        let parts = tool_parts(&legacy, true);
        assert!(
            parts[0]["functionResponse"].get("id").is_none(),
            "ids sintéticos não são enviados ao Gemini"
        );
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

    fn request_for(provider_id: &str, model_id: &str) -> CompletionRequest {
        let catalog = crate::catalog::CatalogFile::load().expect("catalog.json carrega");
        let provider = catalog
            .provider(provider_id)
            .unwrap_or_else(|| panic!("provider {provider_id}"));
        let model = catalog
            .model(provider_id, model_id)
            .unwrap_or_else(|| panic!("{model_id} em {provider_id}"))
            .clone();
        CompletionRequest {
            config: crate::providers::ProviderConfig {
                provider_id: provider.id.clone(),
                provider_name: provider.name.clone(),
                base_url: provider.base_url.clone(),
                api_key: "sk-test".to_string(),
                auth_header: provider.auth_header.clone(),
                auth_prefix: provider.auth_prefix.clone(),
                model,
                session_id: "session-1".to_string(),
                user_agent: "Zylara/test".to_string(),
                endpoints: provider.endpoints.clone(),
                request_profile: crate::catalog::RequestProfile::Standard,
                auth_mode: crate::catalog::ProviderAuth::ApiKey,
                extra_headers: Vec::new(),
            },
            protocols: vec![WireProtocol::Google],
            history: vec![HistoryMessage::user("oi")],
            system_prompt: "Você é o Zylara.".to_string(),
            tools: vec![crate::providers::ToolDefinition {
                name: "echo".to_string(),
                description: "Ecoa.".to_string(),
                parameters: json!({"type": "object"}),
            }],
            reasoning: crate::providers::ReasoningRequest::Auto,
            max_output_tokens: Some(64),
            temperature: None,
            cache_plan: None,
            timeouts: crate::providers::StreamTimeouts::default(),
            cancel: tokio_util::sync::CancellationToken::new(),
        }
    }

    fn test_request() -> CompletionRequest {
        request_for("opencode-go", "gemini-4-argon-contributor")
    }

    fn direct_request() -> CompletionRequest {
        request_for("gemini", "gemini-3.8-flash")
    }

    #[test]
    fn direct_provider_uses_parameters_json_schema() {
        let mut request = direct_request();
        request.tools[0].parameters = json!({
            "type": "object",
            "properties": {"text": {"type": "string", "maxLength": 20}},
            "required": ["text"],
            "additionalProperties": false
        });
        let body = build_body(&request);
        let declaration = &body["tools"][0]["functionDeclarations"][0];
        assert!(declaration.get("parameters").is_none());
        assert_eq!(
            declaration["parametersJsonSchema"]["additionalProperties"],
            json!(false)
        );
        assert_eq!(
            declaration["parametersJsonSchema"]["properties"]["text"]["maxLength"],
            json!(20)
        );
    }

    #[test]
    fn gateway_keeps_the_parameters_field() {
        let body = build_body(&test_request());
        let declaration = &body["tools"][0]["functionDeclarations"][0];
        assert!(declaration.get("parametersJsonSchema").is_none());
        assert_eq!(declaration["parameters"]["type"], json!("object"));
    }

    #[test]
    fn thinking_config_includes_thoughts_and_lowercase_level_for_direct() {
        let mut request = direct_request();
        request.reasoning = crate::providers::ReasoningRequest::Effort("medium".into());
        let body = build_body(&request);
        assert_eq!(
            body["generationConfig"]["thinkingConfig"]["includeThoughts"],
            json!(true)
        );
        assert_eq!(
            body["generationConfig"]["thinkingConfig"]["thinkingLevel"],
            json!("medium")
        );

        let mut gateway = test_request();
        gateway.reasoning = crate::providers::ReasoningRequest::Effort("medium".into());
        let body = build_body(&gateway);
        assert_eq!(
            body["generationConfig"]["thinkingConfig"]["thinkingLevel"],
            json!("MEDIUM")
        );
    }

    #[test]
    fn max_output_tokens_uses_the_catalog_cap() {
        for model_id in ["gemini-4-carbon", "gemini-4-argon", "gemini-3.8-flash"] {
            let mut request = request_for("gemini", model_id);
            request.max_output_tokens = None;
            let body = build_body(&request);
            assert_eq!(
                body["generationConfig"]["maxOutputTokens"],
                json!(65_536),
                "{model_id}"
            );
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

    fn collect_provider_state(
        handler: Handler<'_>,
        events: &mut tokio::sync::mpsc::UnboundedReceiver<ProviderEvent>,
    ) -> Value {
        handler.finish().expect("finish");
        let mut state = None;
        while let Ok(event) = events.try_recv() {
            if let ProviderEvent::ProviderState(value) = event {
                state = Some(value);
            }
        }
        state.expect("ProviderState emitido")
    }

    #[test]
    fn signature_only_part_is_attached_to_the_last_text_part() {
        let (sink, mut events) = tokio::sync::mpsc::unbounded_channel();
        let mut handler = Handler::new(&sink, "gemini".to_string());
        handler
            .on_event(
                None,
                r#"{"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}"#,
            )
            .expect("texto");
        handler
            .on_event(
                None,
                r#"{"candidates":[{"content":{"parts":[{"thoughtSignature":"SIG"}]}}]}"#,
            )
            .expect("assinatura solta");
        let state = collect_provider_state(handler, &mut events);
        assert_eq!(state[0]["text"], json!("hi"));
        assert_eq!(state[0]["thoughtSignature"], json!("SIG"));
    }

    #[test]
    fn function_call_id_is_emitted_and_replayed() {
        let (sink, mut events) = tokio::sync::mpsc::unbounded_channel();
        let mut handler = Handler::new(&sink, "gemini".to_string());
        handler
            .on_event(
                None,
                r#"{"candidates":[{"content":{"parts":[{"functionCall":{"name":"echo","args":{"text":"x"},"id":"abc"},"thoughtSignature":"SIG"}]}}]}"#,
            )
            .expect("functionCall");
        handler.finish().expect("finish");

        let mut started_id = None;
        let mut state = None;
        while let Ok(event) = events.try_recv() {
            match event {
                ProviderEvent::ToolCallStart { id, .. } => started_id = Some(id),
                ProviderEvent::ProviderState(value) => state = Some(value),
                _ => {}
            }
        }
        assert_eq!(started_id.as_deref(), Some("abc"));
        let state = state.expect("ProviderState");
        assert_eq!(state[0]["functionCall"]["id"], json!("abc"));
        assert_eq!(state[0]["thoughtSignature"], json!("SIG"));
    }

    #[test]
    fn parallel_calls_keep_the_signature_on_the_first_call() {
        let (sink, mut events) = tokio::sync::mpsc::unbounded_channel();
        let mut handler = Handler::new(&sink, "gemini".to_string());
        handler
            .on_event(
                None,
                r#"{"candidates":[{"content":{"parts":[
                    {"functionCall":{"name":"echo","args":{"text":"a"},"id":"a"},"thoughtSignature":"SIG"},
                    {"functionCall":{"name":"echo","args":{"text":"b"},"id":"b"}}
                ]}}]}"#,
            )
            .expect("parallel calls");
        let state = collect_provider_state(handler, &mut events);
        assert_eq!(state.as_array().map(Vec::len), Some(2));
        assert_eq!(state[0]["thoughtSignature"], json!("SIG"));
        assert!(state[1].get("thoughtSignature").is_none());
        let signatures = state
            .as_array()
            .expect("array")
            .iter()
            .filter(|part| part.get("thoughtSignature").is_some())
            .count();
        assert_eq!(signatures, 1);
    }

    #[test]
    fn blocked_prompt_surfaces_an_error() {
        let (sink, _events) = tokio::sync::mpsc::unbounded_channel();
        let mut handler = Handler::new(&sink, "gemini".to_string());
        handler
            .on_event(None, r#"{"promptFeedback":{"blockReason":"SAFETY"}}"#)
            .expect("chunk de bloqueio");
        let error = handler.finish().expect_err("prompt bloqueado");
        assert!(error.to_string().contains("SAFETY"), "{error}");
    }

    #[test]
    fn continuation_finish_reason_surfaces_an_error() {
        let (sink, _events) = tokio::sync::mpsc::unbounded_channel();
        let mut handler = Handler::new(&sink, "gemini".to_string());
        handler
            .on_event(
                None,
                r#"{"candidates":[{"finishReason":"CONTINUATION"}]}"#,
            )
            .expect("chunk de continuação");
        assert!(handler.finish().is_err(), "long decode não é suportado");
    }
}
