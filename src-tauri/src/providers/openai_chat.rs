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
    as_u32, cache, emit, image_data_url, make_usage, max_output_tokens, normalize_arguments,
    pointer_u32, reasoning, system_text, to_provider_error, valid_json_arguments,
    CompletionRequest, EventSink, HistoryMessage, HistoryRole, ProviderError, ProviderEvent,
    ProviderResult, WireProtocol,
};

pub(crate) async fn stream(
    http: &reqwest::Client,
    request: &CompletionRequest,
    sink: &EventSink,
) -> ProviderResult<()> {
    let url = request.config.endpoint_for(WireProtocol::OpenaiChat)?;
    let mut body = build_body(request);
    // F4b: the harness-owned plan lands on the final wire body before the
    // digest; `digest(apply(body)) == digest(body)` is a contract (cache
    // metadata is outside the hash), so the emitted digest stays valid.
    cache::apply(
        WireProtocol::OpenaiChat,
        request.cache_plan.as_ref(),
        &mut body,
    );
    super::emit_cache_digest(request, WireProtocol::OpenaiChat, &body, sink)?;
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
            HistoryRole::Tool => {
                messages.push(tool_message(message));
                // Chat Completions tool messages are text-only in several
                // gateways. Images travel in a labelled user message right
                // after the tool result so vision models still see them.
                if let Some(followup) = tool_image_followup(message) {
                    messages.push(followup);
                }
            }
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
    reasoning::apply(
        WireProtocol::OpenaiChat,
        model,
        &request.reasoning,
        &mut body,
    );
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
    let content = if has_text {
        json!(message.text)
    } else {
        Value::Null
    };
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
            let mapped: Vec<Value> = calls.iter().filter_map(normalize_chat_tool_call).collect();
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

fn tool_image_followup(message: &HistoryMessage) -> Option<Value> {
    if message.images.is_empty() {
        return None;
    }
    let tool = message.tool_name.clone().unwrap_or_else(|| "tool".to_string());
    let mut parts = vec![json!({
        "type": "text",
        "text": format!("Imagem retornada pela ferramenta `{tool}`:"),
    })];
    for image in &message.images {
        parts.push(json!({
            "type": "image_url",
            "image_url": {"url": image_data_url(image)},
        }));
    }
    Some(json!({"role": "user", "content": parts}))
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
    /// Route that produced the request (used to gate the OpenCode gateway
    /// `usage.opencode.tokens` fallback).
    provider_id: String,
    usage: Option<UsageInfo>,
    /// Verbatim final usage block (safe excerpt is emitted as `UsageRaw`).
    raw_usage: Option<Value>,
    tools: BTreeMap<usize, ChatToolCall>,
}

impl<'a> Handler<'a> {
    fn new(sink: &'a EventSink, provider_id: String) -> Self {
        Self {
            sink,
            provider_id,
            usage: None,
            raw_usage: None,
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
            self.raw_usage = Some(usage.clone());
            self.usage = Some(parse_usage(usage, &self.provider_id));
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
        // Safe raw usage excerpt for the diagnostics panel, right after the
        // normalized usage and before the assistant state/Done.
        super::emit_usage_raw(self.sink, self.raw_usage.as_ref())?;
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

fn parse_usage(usage: &Value, provider_id: &str) -> UsageInfo {
    let input = pointer_u32(usage, "/prompt_tokens");
    let output = pointer_u32(usage, "/completion_tokens");
    let reasoning = pointer_u32(usage, "/completion_tokens_details/reasoning_tokens")
        .or_else(|| pointer_u32(usage, "/reasoning_tokens"));
    let cached = pointer_u32(usage, "/prompt_tokens_details/cached_tokens")
        .or_else(|| pointer_u32(usage, "/cache_read_input_tokens"));
    let total = pointer_u32(usage, "/total_tokens");
    let mut info = make_usage(input, output, reasoning, cached, total);
    // Normalized cache counters: OpenAI cached/write, DeepSeek hit/miss,
    // Zai/DigitalOcean aliases and the OpenCode gateway block.
    cache::apply_usage(
        &mut info,
        &cache::normalize_usage(WireProtocol::OpenaiChat, provider_id, usage),
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
    fn tool_image_goes_to_a_labelled_followup_user_message() {
        let mut message = HistoryMessage::tool_result("call-1", "computer_screenshot", "ok");
        message.images.push(crate::providers::ImagePart {
            mime_type: "image/jpeg".to_string(),
            data_base64: "abc".to_string(),
        });
        let followup = tool_image_followup(&message).expect("followup");
        assert_eq!(followup["role"], json!("user"));
        assert_eq!(followup["content"][1]["type"], json!("image_url"));
        assert!(followup["content"][0]["text"]
            .as_str()
            .expect("text")
            .contains("computer_screenshot"));
    }

    #[test]
    fn parse_usage_fills_openai_cache_counters() {
        let usage = parse_usage(
            &json!({
                "prompt_tokens": 12_000,
                "completion_tokens": 300,
                "prompt_tokens_details": {
                    "cached_tokens": 4_000,
                    "cache_write_tokens": 7_000,
                },
            }),
            "openai",
        );
        assert!(usage.cache_reported);
        assert_eq!(usage.cached_tokens, Some(4_000), "alias legado");
        assert_eq!(usage.cache_read_tokens, Some(4_000));
        assert_eq!(usage.cache_write_tokens, Some(7_000));
        assert_eq!(usage.uncached_input_tokens, Some(1_000));
        assert_eq!(usage.input_tokens, Some(12_000));
    }

    #[test]
    fn parse_usage_fills_deepseek_hit_and_miss_counters() {
        let usage = parse_usage(
            &json!({
                "prompt_tokens": 10_000,
                "completion_tokens": 500,
                "prompt_cache_hit_tokens": 9_000,
                "prompt_cache_miss_tokens": 1_000,
            }),
            "opencode-go",
        );
        assert!(usage.cache_reported);
        assert_eq!(usage.cache_read_tokens, Some(9_000));
        assert_eq!(usage.cached_tokens, Some(9_000), "alias legado preenchido");
        assert_eq!(usage.cache_write_tokens, None);
        assert_eq!(usage.uncached_input_tokens, Some(1_000));
    }

    #[test]
    fn parse_usage_reads_the_opencode_gateway_block() {
        let usage = parse_usage(
            &json!({
                "prompt_tokens": 1_200,
                "completion_tokens": 300,
                "opencode": {
                    "tokens": {
                        "input": 1_200,
                        "cache_read": 8_000,
                        "cache_write_5m": 0,
                        "cache_write_1h": 2_000,
                    }
                }
            }),
            "opencode-go",
        );
        assert!(usage.cache_reported);
        assert_eq!(usage.cache_read_tokens, Some(8_000));
        assert_eq!(usage.cache_write_tokens, Some(2_000));
        assert_eq!(usage.uncached_input_tokens, Some(1_200));
    }

    #[test]
    fn parse_usage_without_cache_counters_is_not_reported() {
        let usage = parse_usage(
            &json!({"prompt_tokens": 100, "completion_tokens": 10}),
            "openai",
        );
        assert!(!usage.cache_reported);
        assert_eq!(usage.cache_read_tokens, None);
        assert_eq!(usage.uncached_input_tokens, Some(100));
    }

    fn test_request() -> CompletionRequest {
        let catalog = crate::catalog::CatalogFile::load().expect("catalog.json carrega");
        let provider = catalog
            .provider("opencode-go")
            .expect("provider opencode-go");
        let model = catalog
            .model("opencode-go", "glm-5.3-flash")
            .expect("glm-5.3-flash")
            .clone();
        CompletionRequest {
            config: crate::providers::ProviderConfig {
                provider_id: provider.id.clone(),
                provider_name: provider.name.clone(),
                base_url: provider.base_url.clone(),
                api_key: "sk-test".to_string(),
                model,
                session_id: "session-1".to_string(),
                user_agent: "Zylara/test".to_string(),
                endpoints: provider.endpoints.clone(),
                request_profile: crate::catalog::RequestProfile::Standard,
                auth_mode: crate::catalog::ProviderAuth::ApiKey,
                extra_headers: Vec::new(),
            },
            protocols: vec![WireProtocol::OpenaiChat],
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
            cancel: tokio_util::sync::CancellationToken::new(),
        }
    }

    /// F4b: plan applied after `build_body` and before the digest; `None` keeps
    /// the body byte-for-byte and the key/retention do not change the digest.
    #[test]
    fn cache_plan_is_applied_before_the_digest() {
        let mut request = test_request();
        let plain = build_body(&request);
        let mut without_plan = build_body(&request);
        cache::apply(WireProtocol::OpenaiChat, None, &mut without_plan);
        assert_eq!(without_plan, plain, "sem plano o body não muda");

        request.cache_plan = Some(cache::CachePlan {
            mode: cache::CacheMode::Auto,
            breakpoints: Vec::new(),
            prompt_cache_key: Some("b".repeat(64)),
            retention: Some("24h".to_string()),
            ttl: None,
        });
        let mut planned = build_body(&request);
        cache::apply(
            WireProtocol::OpenaiChat,
            request.cache_plan.as_ref(),
            &mut planned,
        );
        assert_eq!(planned["prompt_cache_key"], json!("b".repeat(64)));
        assert_eq!(planned["prompt_cache_retention"], json!("24h"));

        let digest_plain = cache::digest(WireProtocol::OpenaiChat, "opencode-go", &plain);
        let digest_planned = cache::digest(WireProtocol::OpenaiChat, "opencode-go", &planned);
        assert_eq!(digest_plain.segments, digest_planned.segments);
        assert_eq!(digest_plain.total_chars, digest_planned.total_chars);
    }

    /// B2: `UsageRaw` carries the safe usage excerpt, emitted once right after
    /// `Usage` and before `Done`, never exposing prompt/content/secrets.
    #[test]
    fn usage_raw_is_emitted_after_usage_with_a_safe_excerpt() {
        let (sink, mut events) = tokio::sync::mpsc::unbounded_channel();
        {
            let mut handler = Handler::new(&sink, "opencode-go".to_string());
            handler
                .on_event(
                    None,
                    r#"{"choices":[],"usage":{"prompt_tokens":1200,"completion_tokens":30,
                        "prompt_tokens_details":{"cached_tokens":900},
                        "prompt_cache_hit_tokens":900,"prompt_cache_miss_tokens":300,
                        "opencode":{"tokens":{"input":1200,"cache_read":8000,"cache_write_1h":0}},
                        "prompt":"SEGREDO","authorization":"Bearer sk-secret"}}"#,
                )
                .expect("chunk de usage");
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
        assert_eq!(raw["prompt_tokens_details"]["cached_tokens"], json!(900));
        assert_eq!(raw["opencode"]["tokens"]["cache_read"], json!(8000));
        assert_eq!(raw["prompt_cache_hit_tokens"], json!(900));
        let serialized = raw.to_string();
        assert!(!serialized.contains("SEGREDO"), "{serialized}");
        assert!(!serialized.contains("sk-secret"), "{serialized}");
        assert!(!serialized.contains("authorization"), "{serialized}");
    }

    #[test]
    fn usage_raw_is_skipped_when_there_is_no_usage_block() {
        let (sink, mut events) = tokio::sync::mpsc::unbounded_channel();
        {
            let mut handler = Handler::new(&sink, "opencode-go".to_string());
            handler
                .on_event(None, r#"{"choices":[{"delta":{"content":"oi"}}]}"#)
                .expect("chunk de texto");
            handler.finish().expect("finish");
        }
        let mut saw_usage_raw = false;
        while let Ok(event) = events.try_recv() {
            if matches!(event, ProviderEvent::UsageRaw(_)) {
                saw_usage_raw = true;
            }
        }
        assert!(!saw_usage_raw, "sem usage não deve haver UsageRaw");
    }
}
