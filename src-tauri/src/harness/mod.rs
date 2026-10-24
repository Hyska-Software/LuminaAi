//! Agent harness: builds context, runs the tool loop and persists messages.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Instant;

use anyhow::anyhow;
use base64::prelude::{Engine as _, BASE64_STANDARD};
use futures_util::future::{join_all, BoxFuture};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::catalog::{CatalogFile, ModelInfo, ProviderInfo};
use crate::db::{Db, StoredAttachment};
use crate::domain::{
    now_ms, AttachmentInfo, ChatMessage, Citation, MessageRole, MessageStatus, ReasoningMode,
    ReasoningSelection, Settings, ToolCallRecord, ToolCallStatus, TraceStep, TurnOptions,
    TurnPayload, TurnResult, UsageInfo, MAX_STEPS_LIMIT,
};
use crate::events::TurnEvent;
use crate::providers::{
    self, CompletionRequest, EventSink, HistoryMessage, HistoryRole, HistoryToolCall, ImagePart,
    ProviderConfig, ProviderEvent, ReasoningRequest, WireProtocol,
};
use crate::tools::{self, ToolOutcome, ToolRuntime};

pub mod prompt;

/// Tool calls executed concurrently per step.
const MAX_PARALLEL_TOOLS: usize = 4;
/// Upper bound of tool call indexes accepted from a provider stream.
const MAX_STREAMED_TOOL_CALLS: usize = 64;
/// Auto generated conversation titles are short.
const TITLE_MAX_CHARS: usize = 48;
/// Per-attachment and per-message limits when injecting extracted text.
const MAX_ATTACHMENT_TEXT_CHARS_PER_FILE: usize = 60_000;
const MAX_ATTACHMENT_TEXT_CHARS_PER_MESSAGE: usize = 150_000;
/// Total base64 budget for images replayed from the conversation history.
const MAX_HISTORY_IMAGE_BASE64_CHARS: usize = 16_000_000;
/// Single image payload limit (providers reject very large inline images).
const MAX_INLINE_IMAGE_BYTES: usize = 10 * 1024 * 1024;
/// Tool result text sent to the renderer (the model gets a larger budget).
const MAX_EVENT_TOOL_RESULT_CHARS: usize = 8_000;
/// Tool result text sent to the model — keeps the context window sane when a
/// fetched page or spreadsheet is huge.
const MAX_MODEL_TOOL_RESULT_CHARS: usize = 24_000;

/// Injectable provider transport used by the agent-loop tests: it replaces the
/// real HTTP streaming with a deterministic fake, so the loop (tool execution,
/// step limits, forced final answers, cancellation) is unit-testable.
/// Receives harness events. Production wires this to a `tauri::ipc::Channel`;
/// tests use an in-memory collector, which keeps the agent loop independent from
/// the webview runtime.
pub trait EventEmitter: Send + Sync + 'static {
    fn emit(&self, event: TurnEvent);
}

impl EventEmitter for tauri::ipc::Channel<TurnEvent> {
    fn emit(&self, event: TurnEvent) {
        let _ = self.send(event);
    }
}

pub type ProviderStreamer = Arc<
    dyn Fn(CompletionRequest, EventSink) -> BoxFuture<'static, anyhow::Result<()>>
        + Send
        + Sync,
>;

#[derive(Clone)]
pub struct HarnessDeps {
    /// Missing in unit tests (no Tauri app available).
    pub app: Option<tauri::AppHandle>,
    pub db: Arc<Db>,
    pub http: reqwest::Client,
    /// Browser-like client used by the web tools (`AppState::search_http`):
    /// search engines reject the plain API client.
    pub search_http: reqwest::Client,
    pub catalog: CatalogFile,
    /// Test hook: when set, replaces `providers::stream_completion`.
    pub streamer: Option<ProviderStreamer>,
    /// Test hook: resolves the API key without a Tauri AppHandle.
    pub api_key_override: Option<String>,
}

/// Runs the real provider stream unless a test streamer is installed.
async fn run_provider_stream(
    streamer: Option<ProviderStreamer>,
    http: reqwest::Client,
    request: CompletionRequest,
    sink: EventSink,
) -> anyhow::Result<()> {
    match streamer {
        Some(stream) => stream(request, sink).await,
        None => providers::stream_completion(&http, request, sink).await,
    }
}

/// Runs a full conversational turn:
/// 1. persists the user message,
/// 2. builds context (system prompt + attachments + history),
/// 3. loops `model -> tool calls -> tool results` until a final answer,
/// 4. streams every phase through `on_event` and persists the assistant message.
pub async fn run_turn(
    deps: HarnessDeps,
    payload: TurnPayload,
    settings: Settings,
    on_event: Arc<dyn EventEmitter>,
    cancel: CancellationToken,
) -> anyhow::Result<TurnResult> {
    let started = Instant::now();
    let turn_id = payload
        .turn_id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    /* ---------------------------------------------------------------- */
    /* 1. Setup: conversation, provider, model and API key               */
    /* ---------------------------------------------------------------- */

    let conversation = deps
        .db
        .get_conversation(&payload.conversation_id)?
        .ok_or_else(|| anyhow!("conversa não encontrada: {}", payload.conversation_id))?;
    let provider = deps
        .catalog
        .provider(&payload.provider_id)
        .cloned()
        .ok_or_else(|| anyhow!("provedor desconhecido: {}", payload.provider_id))?;
    let model_id = if payload.model_id.trim().is_empty() {
        provider.default_model_id.clone()
    } else {
        payload.model_id.trim().to_string()
    };
    let model = deps
        .catalog
        .model(&provider.id, &model_id)
        .cloned()
        .ok_or_else(|| {
            anyhow!(
                "modelo `{model_id}` não está disponível no provedor `{}`",
                provider.id
            )
        })?;
    let api_key = match deps.api_key_override.clone() {
        Some(key) => key,
        None => {
            let app = deps
                .app
                .as_ref()
                .ok_or_else(|| anyhow!("AppHandle ausente para resolver a chave de API"))?;
            crate::config::api_key(app, &provider.id)
                .ok_or_else(|| anyhow!("nenhuma chave de API configurada para {}", provider.name))?
        }
    };
    let protocols = resolve_protocols(&provider, &model)?;

    if conversation.provider_id != provider.id || conversation.model_id != model.id {
        deps.db
            .update_conversation_model(&conversation.id, &provider.id, &model.id)?;
    }

    /* ---------------------------------------------------------------- */
    /* 2. Effective turn options                                         */
    /* ---------------------------------------------------------------- */

    let mut options = payload.options.clone();
    options.web_search = options.web_search && settings.web_search_enabled;
    options.create_files = options.create_files && settings.file_creation_enabled;
    options.max_steps = options.max_steps.clamp(1, MAX_STEPS_LIMIT);

    /* ---------------------------------------------------------------- */
    /* 3. Persist the user message (or reuse it when regenerating) and   */
    /*    the assistant placeholder.                                     */
    /* ---------------------------------------------------------------- */

    let (user_message, mut assistant_message) = if options.regenerate {
        prepare_regenerate(&deps, &payload, &provider, &model)?
    } else {
        prepare_new_turn(&deps, &payload, &provider, &model)?
    };

    emit(
        &on_event,
        TurnEvent::TurnStarted {
            turn_id,
            user_message_id: user_message.id.clone(),
            assistant_message_id: assistant_message.id.clone(),
        },
    );

    /* ---------------------------------------------------------------- */
    /* 4. Build the neutral history + system prompt                      */
    /* ---------------------------------------------------------------- */

    let supports_images = supports_images(&model);
    let messages = deps.db.list_messages(&payload.conversation_id)?;
    let mut history = build_history(
        &deps,
        &messages,
        &assistant_message.id,
        &settings,
        &model,
        supports_images,
    );
    let system_prompt = prompt::build_system_prompt(&model, &options, &settings);
    let tool_definitions = tools::definitions(&options);
    let reasoning = reasoning_request(payload.reasoning.as_ref(), &model);
    let temperature = temperature_request(&options, &settings, &model);
    let max_output_tokens = Some(model.max_output.clamp(1_024, 32_768));

    let runtime = ToolRuntime {
        app: deps.app.clone(),
        db: deps.db.clone(),
        http: deps.search_http.clone(),
        conversation_id: payload.conversation_id.clone(),
        message_id: assistant_message.id.clone(),
        options: options.clone(),
    };

    /* ---------------------------------------------------------------- */
    /* 5. Agent loop                                                     */
    /* ---------------------------------------------------------------- */

    let mut step_number = 0u32;
    let mut full_text = String::new();
    let mut full_reasoning = String::new();
    let mut trace: Vec<TraceStep> = Vec::new();
    let mut all_tool_calls: Vec<ToolCallRecord> = Vec::new();
    let mut citations: Vec<Citation> = Vec::new();
    let mut total_usage = UsageInfo::default();
    let mut provider_state: Option<Value> = None;
    let mut cancelled = false;
    let mut turn_error: Option<String> = None;

    while step_number < options.max_steps {
        if cancel.is_cancelled() {
            cancelled = true;
            break;
        }
        step_number += 1;
        emit(&on_event, TurnEvent::StepStarted { step: step_number });

        let request = CompletionRequest {
            config: ProviderConfig {
                provider_id: provider.id.clone(),
                provider_name: provider.name.clone(),
                base_url: provider.base_url.clone(),
                api_key: api_key.clone(),
                model: model.clone(),
                session_id: payload.conversation_id.clone(),
                user_agent: format!("Lumina/{}", env!("CARGO_PKG_VERSION")),
            },
            protocols: protocols.clone(),
            history: history.clone(),
            system_prompt: system_prompt.clone(),
            tools: tool_definitions.clone(),
            reasoning: reasoning.clone(),
            max_output_tokens,
            temperature,
            cancel: cancel.clone(),
        };

        let (sink, mut events) = tokio::sync::mpsc::unbounded_channel();
        let stream_task = {
            let streamer = deps.streamer.clone();
            let http = deps.http.clone();
            tokio::spawn(async move { run_provider_stream(streamer, http, request, sink).await })
        };

        let mut step_text = String::new();
        let mut step_reasoning = String::new();
        let mut step_state: Option<Value> = None;
        let mut step_usage: Option<UsageInfo> = None;
        let mut streaming_calls: Vec<StreamingToolCall> = Vec::new();
        let mut provider_error: Option<String> = None;

        loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => {
                    cancelled = true;
                    break;
                }
                event = events.recv() => {
                    let Some(event) = event else { break; };
                    match event {
                        ProviderEvent::ReasoningDelta(delta) => {
                            if !delta.is_empty() {
                                step_reasoning.push_str(&delta);
                                emit(&on_event, TurnEvent::ReasoningDelta { delta });
                            }
                        }
                        ProviderEvent::TextDelta(delta) => {
                            if !delta.is_empty() {
                                step_text.push_str(&delta);
                                emit(&on_event, TurnEvent::TextDelta { delta });
                            }
                        }
                        ProviderEvent::ToolCallStart { index, id, name } => {
                            if index >= MAX_STREAMED_TOOL_CALLS {
                                continue;
                            }
                            while streaming_calls.len() <= index {
                                streaming_calls.push(StreamingToolCall::default());
                            }
                            let call = &mut streaming_calls[index];
                            call.id = id.clone();
                            call.name = name.clone();
                            emit(
                                &on_event,
                                TurnEvent::ToolCallStarted {
                                    tool_call: ToolCallRecord::running(id, name),
                                },
                            );
                        }
                        ProviderEvent::ToolCallArgsDelta { index, delta } => {
                            if let Some(call) = streaming_calls.get_mut(index) {
                                call.arguments.push_str(&delta);
                                emit(
                                    &on_event,
                                    TurnEvent::ToolCallArgs {
                                        id: call.id.clone(),
                                        delta,
                                    },
                                );
                            }
                        }
                        ProviderEvent::ToolCallDone { index, arguments } => {
                            if let Some(call) = streaming_calls.get_mut(index) {
                                if !arguments.is_empty() {
                                    call.arguments = arguments;
                                }
                            }
                        }
                        ProviderEvent::Usage(usage) => step_usage = Some(usage),
                        ProviderEvent::ProviderState(state) => step_state = Some(state),
                        ProviderEvent::Done => {}
                    }
                }
            }
        }

        if cancelled {
            stream_task.abort();
            break;
        }
        match stream_task.await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => provider_error = Some(format!("{error:#}")),
            Err(join_error) => {
                provider_error = Some(format!("falha interna no streaming: {join_error}"))
            }
        }

        if !step_reasoning.is_empty() {
            emit(&on_event, TurnEvent::ReasoningDone);
        }

        if !step_reasoning.is_empty() {
            if !full_reasoning.is_empty() {
                full_reasoning.push_str("\n\n");
            }
            full_reasoning.push_str(&step_reasoning);
        }
        if step_state.is_some() {
            provider_state = step_state.clone();
        }
        if let Some(usage) = step_usage.take() {
            merge_usage(&mut total_usage, &usage);
        }

        if let Some(error) = provider_error {
            turn_error = Some(error);
            let mut failed = 0usize;
            for call in streaming_calls.drain(..).filter(|call| !call.id.is_empty()) {
                let mut record = tool_call_record(call);
                record.status = ToolCallStatus::Error;
                record.result = Some("Interrompida por um erro do provedor.".to_string());
                record.finished_at = Some(now_ms());
                all_tool_calls.push(record);
                failed += 1;
            }
            push_trace_step(&mut trace, &step_reasoning, failed);
            break;
        }

        let step_calls: Vec<ToolCallRecord> = streaming_calls
            .into_iter()
            .filter(|call| !call.id.is_empty())
            .map(tool_call_record)
            .collect();

        if step_calls.is_empty() {
            // The model produced a final answer. Intermediate narration from
            // tool-calling steps is intentionally not part of the final message.
            push_trace_step(&mut trace, &step_reasoning, 0);
            full_text = step_text.trim().to_string();
            break;
        }

        push_trace_step(&mut trace, &step_reasoning, step_calls.len());

        // Tools requested on the last allowed step still run: artifacts and other
        // deliverables must never be lost. A forced final-answer pass (below)
        // then summarizes what was collected.
        let outcomes = execute_tools(&runtime, &step_calls).await;
        let mut paired: Vec<(ToolCallRecord, ToolOutcome)> = Vec::new();
        for (mut call, outcome) in step_calls.into_iter().zip(outcomes.into_iter()) {
            call.status = if outcome.is_error {
                ToolCallStatus::Error
            } else {
                ToolCallStatus::Done
            };
            call.result = Some(outcome.content.clone());
            call.summary = outcome.summary.clone();
            call.finished_at = Some(now_ms());

            emit(
                &on_event,
                TurnEvent::ToolCallFinished {
                    id: call.id.clone(),
                    status: if outcome.is_error { "error" } else { "done" }.to_string(),
                    result: truncate_chars(&outcome.content, MAX_EVENT_TOOL_RESULT_CHARS),
                    summary: outcome.summary.clone(),
                    citations: outcome.citations.clone(),
                },
            );
            for artifact in &outcome.artifacts {
                emit(
                    &on_event,
                    TurnEvent::ArtifactCreated {
                        artifact: artifact.clone(),
                    },
                );
            }
            for citation in &outcome.citations {
                if !citations.iter().any(|existing| existing.url == citation.url) {
                    citations.push(citation.clone());
                }
            }
            paired.push((call, outcome));
        }

        // Replay the assistant tool-call turn + its results on the next step.
        let mut assistant_history = HistoryMessage::assistant(step_text.clone());
        assistant_history.reasoning =
            (!step_reasoning.trim().is_empty()).then(|| step_reasoning.clone());
        assistant_history.provider_state = step_state.clone();
        assistant_history.tool_calls = paired
            .iter()
            .map(|(call, _)| HistoryToolCall {
                id: call.id.clone(),
                name: call.name.clone(),
                arguments: call.arguments.clone(),
            })
            .collect();
        history.push(assistant_history);
        for (call, outcome) in &paired {
            history.push(HistoryMessage::tool_result(
                call.id.clone(),
                call.name.clone(),
                truncate_chars(&outcome.content, MAX_MODEL_TOOL_RESULT_CHARS),
            ));
        }
        for (call, _) in paired {
            all_tool_calls.push(call);
        }

        if step_number >= options.max_steps {
            // Force the final-answer pass below instead of ending the turn with
            // only intermediate narration.
            break;
        }

        if cancel.is_cancelled() {
            cancelled = true;
            break;
        }
    }

    /* ---------------------------------------------------------------- */
    /* 5b. Forced final answer when the loop ended without one            */
    /* ---------------------------------------------------------------- */

    if !cancelled && full_text.trim().is_empty() {
        emit(&on_event, TurnEvent::StepStarted { step: step_number + 1 });
        let forced_prompt = format!(
            "{system_prompt}\n\n# Encerramento\n\
             Você não pode chamar mais ferramentas nesta resposta. Responda agora, em Markdown, \
             usando apenas as informações já coletadas nos resultados acima. Se algum dado não \
             foi confirmado, deixe isso explícito. Não narre o processo: entregue a resposta final."
        );
        let forced_request = CompletionRequest {
            config: ProviderConfig {
                provider_id: provider.id.clone(),
                provider_name: provider.name.clone(),
                base_url: provider.base_url.clone(),
                api_key: api_key.clone(),
                model: model.clone(),
                session_id: payload.conversation_id.clone(),
                user_agent: format!("Lumina/{}", env!("CARGO_PKG_VERSION")),
            },
            protocols: protocols.clone(),
            history: history.clone(),
            system_prompt: forced_prompt,
            tools: Vec::new(),
            reasoning: reasoning.clone(),
            max_output_tokens,
            temperature,
            cancel: cancel.clone(),
        };
        let (forced_sink, mut forced_events) = tokio::sync::mpsc::unbounded_channel();
        let forced_task = {
            let streamer = deps.streamer.clone();
            let http = deps.http.clone();
            tokio::spawn(async move { run_provider_stream(streamer, http, forced_request, forced_sink).await })
        };
        let mut forced_text = String::new();
        let mut forced_reasoning = String::new();
        let mut forced_usage: Option<UsageInfo> = None;
        loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => {
                    cancelled = true;
                    break;
                }
                event = forced_events.recv() => {
                    let Some(event) = event else { break; };
                    match event {
                        ProviderEvent::TextDelta(delta) if !delta.is_empty() => {
                            forced_text.push_str(&delta);
                            emit(&on_event, TurnEvent::TextDelta { delta });
                        }
                        ProviderEvent::ReasoningDelta(delta) if !delta.is_empty() => {
                            forced_reasoning.push_str(&delta);
                            emit(&on_event, TurnEvent::ReasoningDelta { delta });
                        }
                        ProviderEvent::Usage(usage) => forced_usage = Some(usage),
                        ProviderEvent::ProviderState(state) => provider_state = Some(state),
                        ProviderEvent::ToolCallStart { .. }
                        | ProviderEvent::ToolCallArgsDelta { .. }
                        | ProviderEvent::ToolCallDone { .. }
                        | ProviderEvent::Done => {}
                        _ => {}
                    }
                }
            }
        }
        if cancelled {
            forced_task.abort();
        } else {
            match forced_task.await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    if turn_error.is_none() {
                        turn_error = Some(format!("Falha ao gerar a resposta final: {error:#}"));
                    }
                }
                Err(join_error) => {
                    if turn_error.is_none() {
                        turn_error = Some(format!("Falha interna ao gerar a resposta final: {join_error}"));
                    }
                }
            }
        }
        if let Some(usage) = forced_usage {
            merge_usage(&mut total_usage, &usage);
        }
        if !forced_reasoning.trim().is_empty() {
            if !full_reasoning.is_empty() {
                full_reasoning.push_str("\n\n");
            }
            full_reasoning.push_str(&forced_reasoning);
        }
        push_trace_step(&mut trace, &forced_reasoning, 0);
        if !forced_text.trim().is_empty() {
            full_text = forced_text.trim().to_string();
        } else if turn_error.is_none() {
            turn_error = Some("O modelo não produziu uma resposta final.".to_string());
        }
    }

    /* ---------------------------------------------------------------- */
    /* 6. Finalize the assistant message                                 */
    /* ---------------------------------------------------------------- */

    // Defense in depth: o renderer valida os blocos `ui` de novo e degrada JSON
    // inválido para código, mas logar os diagnósticos no backend (debug) torna
    // regressões de prompt/contrato visíveis durante o desenvolvimento.
    if cfg!(debug_assertions) {
        let contract = tools::genui::contract();
        let blocks = tools::genui::scan_markdown_blocks(&full_text);
        for (index, analysis) in blocks.iter().enumerate() {
            for diagnostic in &analysis.diagnostics {
                let severity = match diagnostic.severity {
                    tools::genui::Severity::Error => "erro",
                    tools::genui::Severity::Warning => "aviso",
                };
                let path = if diagnostic.path.is_empty() {
                    "(raiz)"
                } else {
                    diagnostic.path.as_str()
                };
                eprintln!(
                    "lumina: bloco `ui` #{} com {severity} {} em {path}: {}",
                    index + 1,
                    diagnostic.code,
                    diagnostic.message
                );
            }
        }
        if blocks.len() > contract.blocks.max_per_message {
            eprintln!(
                "lumina: resposta com {} blocos `ui` (máximo {} por mensagem)",
                blocks.len(),
                contract.blocks.max_per_message
            );
        }
    }

    let duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    total_usage.duration_ms = Some(duration_ms);
    if total_usage.total_tokens.is_none() {
        if let (Some(input), Some(output)) = (total_usage.input_tokens, total_usage.output_tokens) {
            total_usage.total_tokens = Some(input.saturating_add(output));
        }
    }
    let usage = total_usage;

    let status = if cancelled {
        MessageStatus::Cancelled
    } else if turn_error.is_some() {
        if full_text.trim().is_empty() {
            MessageStatus::Error
        } else {
            MessageStatus::Complete
        }
    } else {
        MessageStatus::Complete
    };

    assistant_message.content = full_text.trim_end().to_string();
    assistant_message.reasoning = (!full_reasoning.trim().is_empty()).then(|| full_reasoning.clone());
    assistant_message.status = status;
    assistant_message.tool_calls = all_tool_calls.clone();
    assistant_message.citations = citations.clone();
    assistant_message.usage = Some(usage.clone());
    assistant_message.provider_state = provider_state.clone();
    assistant_message.trace = trace.clone();
    assistant_message.model_id = Some(model.id.clone());
    assistant_message.provider_id = Some(provider.id.clone());
    deps.db.update_message(&assistant_message)?;

    if let Err(error) = deps.db.record_usage(
        &conversation.id,
        &assistant_message.id,
        &provider.id,
        &model.id,
        &usage,
    ) {
        eprintln!("lumina: falha ao registrar usage: {error:#}");
    }

    emit(&on_event, TurnEvent::Usage { usage: usage.clone() });
    emit(
        &on_event,
        TurnEvent::MessageUpdated {
            message: assistant_message.clone(),
        },
    );

    // Auto title: only when the conversation still has a placeholder title.
    if settings.auto_title && should_auto_title(&conversation.title) {
        let source = if user_message.content.trim().is_empty() {
            user_message
                .attachments
                .first()
                .map(|attachment| attachment.name.clone())
                .unwrap_or_default()
        } else {
            user_message.content.clone()
        };
        if let Some(title) = derive_title(&source) {
            if let Err(error) = deps.db.rename_conversation(&conversation.id, &title) {
                eprintln!("lumina: falha ao renomear conversa: {error:#}");
            } else {
                emit(
                    &on_event,
                    TurnEvent::TitleUpdated {
                        conversation_id: conversation.id.clone(),
                        title,
                    },
                );
            }
        }
    }
    let _ = deps.db.touch_conversation(&conversation.id);

    let updated_conversation = deps
        .db
        .get_conversation(&conversation.id)?
        .or(Some(conversation.clone()));

    let result = TurnResult {
        user_message: user_message.clone(),
        assistant_message: assistant_message.clone(),
        usage: Some(usage.clone()),
        error: turn_error.clone(),
        conversation: updated_conversation,
    };

    if cancelled {
        emit(&on_event, TurnEvent::Cancelled);
    } else if let Some(error) = &turn_error {
        emit(
            &on_event,
            TurnEvent::Error {
                message: error.clone(),
                code: None,
            },
        );
    } else {
        emit(&on_event, TurnEvent::Done { result: result.clone() });
    }

    Ok(result)
}

/* ------------------------------------------------------------------ */
/* Message persistence                                                 */
/* ------------------------------------------------------------------ */

fn prepare_new_turn(
    deps: &HarnessDeps,
    payload: &TurnPayload,
    provider: &ProviderInfo,
    model: &ModelInfo,
) -> anyhow::Result<(ChatMessage, ChatMessage)> {
    let mut user_message = ChatMessage::user(&payload.conversation_id, payload.content.clone());
    user_message.model_id = Some(model.id.clone());
    user_message.provider_id = Some(provider.id.clone());
    user_message.attachments = resolve_attachment_infos(&deps.db, &payload.attachment_ids);
    deps.db.insert_message(&user_message)?;

    let mut assistant_message = ChatMessage::assistant(&payload.conversation_id);
    assistant_message.model_id = Some(model.id.clone());
    assistant_message.provider_id = Some(provider.id.clone());
    deps.db.insert_message(&assistant_message)?;

    Ok((user_message, assistant_message))
}

fn prepare_regenerate(
    deps: &HarnessDeps,
    payload: &TurnPayload,
    provider: &ProviderInfo,
    model: &ModelInfo,
) -> anyhow::Result<(ChatMessage, ChatMessage)> {
    let messages = deps.db.list_messages(&payload.conversation_id)?;
    let last_user_index = messages
        .iter()
        .rposition(|message| message.role == MessageRole::User)
        .ok_or_else(|| anyhow!("nada para regenerar: não há mensagem do usuário na conversa"))?;
    let user_message = messages[last_user_index].clone();

    // Drop everything the previous attempt produced after the user message.
    if let Some(next_message) = messages.get(last_user_index + 1) {
        deps.db
            .delete_messages_from(&payload.conversation_id, &next_message.id)?;
    }

    let mut assistant_message = ChatMessage::assistant(&payload.conversation_id);
    assistant_message.model_id = Some(model.id.clone());
    assistant_message.provider_id = Some(provider.id.clone());
    deps.db.insert_message(&assistant_message)?;

    Ok((user_message, assistant_message))
}

fn resolve_attachment_infos(db: &Db, ids: &[String]) -> Vec<AttachmentInfo> {
    ids.iter()
        .filter_map(|id| db.get_attachment(id).ok().flatten().map(|stored| stored.info()))
        .collect()
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

fn build_history(
    deps: &HarnessDeps,
    messages: &[ChatMessage],
    current_assistant_id: &str,
    settings: &Settings,
    model: &ModelInfo,
    supports_images: bool,
) -> Vec<HistoryMessage> {
    let allowed_images = image_enabled_messages(messages, supports_images);
    let mut groups: Vec<Vec<HistoryMessage>> = Vec::new();

    for message in messages {
        if message.id == current_assistant_id {
            continue;
        }
        match message.role {
            MessageRole::User => {
                let mut history_message = HistoryMessage::user(message.content.clone());
                if settings.include_attachments {
                    attach_user_attachments(
                        deps,
                        message,
                        &mut history_message,
                        supports_images && allowed_images.contains(&message.id),
                    );
                }
                if history_message.text.trim().is_empty() && history_message.images.is_empty() {
                    history_message.text = "(mensagem sem texto)".to_string();
                } else if history_message.text.trim().is_empty() {
                    history_message.text = "Analise o(s) anexo(s) a seguir.".to_string();
                }
                groups.push(vec![history_message]);
            }
            MessageRole::Assistant => {
                // Ignore placeholders left behind by an interrupted run.
                if message.status == MessageStatus::Streaming && message.content.is_empty() {
                    continue;
                }
                let mut history_message = HistoryMessage::assistant(message.content.clone());
                history_message.reasoning = message
                    .reasoning
                    .clone()
                    .filter(|reasoning| !reasoning.trim().is_empty());
                history_message.provider_state = message.provider_state.clone();
                history_message.tool_calls = message
                    .tool_calls
                    .iter()
                    .map(|call| HistoryToolCall {
                        id: call.id.clone(),
                        name: call.name.clone(),
                        arguments: call.arguments.clone(),
                    })
                    .collect();
                let mut group = vec![history_message];
                for call in &message.tool_calls {
                    if let Some(result) = &call.result {
                        group.push(HistoryMessage::tool_result(
                            call.id.clone(),
                            call.name.clone(),
                            result.clone(),
                        ));
                    }
                }
                groups.push(group);
            }
            MessageRole::System => {
                groups.push(vec![HistoryMessage::system(message.content.clone())]);
            }
        }
    }

    // Trim oldest turns until the estimated context fits the model window.
    let budget = history_budget(model);
    let mut total = 0usize;
    let mut keep_from = groups.len();
    for index in (0..groups.len()).rev() {
        let size: usize = groups[index].iter().map(history_message_size).sum();
        if keep_from < groups.len() && total + size > budget {
            break;
        }
        total += size;
        keep_from = index;
    }
    while keep_from < groups.len() {
        let starts_with_user_or_system = groups
            .get(keep_from)
            .and_then(|group| group.first())
            .map(|message| matches!(&message.role, HistoryRole::User | HistoryRole::System))
            .unwrap_or(true);
        if starts_with_user_or_system {
            break;
        }
        keep_from += 1;
    }

    groups.into_iter().skip(keep_from).flatten().collect()
}

fn history_budget(model: &ModelInfo) -> usize {
    let window = usize::try_from(model.context_window).unwrap_or(128_000);
    window.saturating_mul(3).clamp(40_000, 600_000)
}

fn history_message_size(message: &HistoryMessage) -> usize {
    let mut size = message.text.chars().count();
    size += message.reasoning.as_deref().map(str::len).unwrap_or(0);
    for call in &message.tool_calls {
        size += call.arguments.len() + 16;
    }
    for image in &message.images {
        size += image.data_base64.len();
    }
    size
}

fn image_enabled_messages(messages: &[ChatMessage], supports_images: bool) -> HashSet<String> {
    let mut enabled = HashSet::new();
    if !supports_images {
        return enabled;
    }
    // Newest messages get the budget first, so the current turn always wins.
    let mut remaining = MAX_HISTORY_IMAGE_BASE64_CHARS;
    for message in messages.iter().rev() {
        if message.role != MessageRole::User {
            continue;
        }
        let cost: usize = message
            .attachments
            .iter()
            .filter(|attachment| attachment.kind == "image")
            .map(estimated_image_chars)
            .sum();
        if cost > 0 && cost <= remaining {
            enabled.insert(message.id.clone());
            remaining = remaining.saturating_sub(cost);
        }
        if remaining < 64 * 1024 {
            break;
        }
    }
    enabled
}

fn estimated_image_chars(attachment: &AttachmentInfo) -> usize {
    let bytes = usize::try_from(attachment.size.max(0)).unwrap_or(usize::MAX);
    bytes.saturating_mul(4) / 3 + 8
}

fn attach_user_attachments(
    deps: &HarnessDeps,
    message: &ChatMessage,
    target: &mut HistoryMessage,
    include_images: bool,
) {
    let mut text_budget = MAX_ATTACHMENT_TEXT_CHARS_PER_MESSAGE;
    for info in &message.attachments {
        let stored = match deps.db.get_attachment(&info.id) {
            Ok(Some(stored)) => stored,
            _ => continue,
        };
        let kind = if stored.kind.is_empty() {
            info.kind.clone()
        } else {
            stored.kind.clone()
        };
        if kind == "image" || crate::documents::is_image_mime(&stored.mime_type) {
            if include_images {
                if let Some(bytes) = read_attachment_bytes(deps, &stored) {
                    let mime = attachment_image_mime(&stored, &bytes);
                    if crate::documents::image::is_raster_mime(&mime)
                        && bytes.len() <= MAX_INLINE_IMAGE_BYTES
                    {
                        target.images.push(ImagePart {
                            mime_type: mime,
                            data_base64: BASE64_STANDARD.encode(bytes),
                        });
                        continue;
                    }
                }
            }
            if !stored.text.trim().is_empty() {
                append_attachment_text(target, &stored, &mut text_budget);
            }
            continue;
        }
        append_attachment_text(target, &stored, &mut text_budget);
    }
}

fn append_attachment_text(
    target: &mut HistoryMessage,
    attachment: &StoredAttachment,
    budget: &mut usize,
) {
    let text = attachment.text.trim();
    if text.is_empty() {
        return;
    }
    let characters = text.chars().count();
    let take = characters
        .min(MAX_ATTACHMENT_TEXT_CHARS_PER_FILE)
        .min(*budget);
    if take == 0 {
        return;
    }
    let snippet: String = text.chars().take(take).collect();
    *budget = budget.saturating_sub(take);
    let name = attachment.name.replace('"', "'");
    target.text.push_str(&format!(
        "\n\n<anexo nome=\"{name}\" tipo=\"{}\">\n{snippet}",
        attachment.kind
    ));
    if take < characters {
        target.text.push_str("\n[... anexo truncado ...]");
    }
    target.text.push_str("\n</anexo>");
}

fn read_attachment_bytes(deps: &HarnessDeps, attachment: &StoredAttachment) -> Option<Vec<u8>> {
    if let Some(path) = attachment.file_path.as_deref() {
        if let Ok(bytes) = std::fs::read(path) {
            return Some(bytes);
        }
    }
    // Fall back to `<app-data>/attachments/<id>.<ext>`.
    let app = deps.app.as_ref()?;
    let directory = crate::config::data_dir(app).ok()?.join("attachments");
    for entry in std::fs::read_dir(directory).ok()?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(&attachment.id) {
            if let Ok(bytes) = std::fs::read(entry.path()) {
                return Some(bytes);
            }
        }
    }
    None
}

fn attachment_image_mime(attachment: &StoredAttachment, bytes: &[u8]) -> String {
    let mime = attachment.mime_type.trim().to_lowercase();
    if mime.starts_with("image/") {
        if mime == "image/jpg" {
            return "image/jpeg".to_string();
        }
        return mime;
    }
    infer::get(bytes)
        .map(|kind| kind.mime_type().to_string())
        .unwrap_or_else(|| "image/png".to_string())
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

#[derive(Default)]
struct StreamingToolCall {
    id: String,
    name: String,
    arguments: String,
}

fn tool_call_record(call: StreamingToolCall) -> ToolCallRecord {
    ToolCallRecord {
        id: call.id,
        name: call.name,
        arguments: call.arguments,
        result: None,
        status: ToolCallStatus::Running,
        summary: None,
        started_at: Some(now_ms()),
        finished_at: None,
    }
}

/// Appends one step of the agent loop to the persisted thinking trace. Steps
/// without visible reasoning and without tool calls are ignored.
fn push_trace_step(trace: &mut Vec<TraceStep>, reasoning: &str, tool_calls: usize) {
    let reasoning = reasoning.trim();
    if reasoning.is_empty() && tool_calls == 0 {
        return;
    }
    trace.push(TraceStep {
        reasoning: (!reasoning.is_empty()).then(|| reasoning.to_string()),
        tool_calls: u32::try_from(tool_calls).unwrap_or(u32::MAX),
    });
}

async fn execute_tools(runtime: &ToolRuntime, calls: &[ToolCallRecord]) -> Vec<ToolOutcome> {
    let permits = Arc::new(tokio::sync::Semaphore::new(MAX_PARALLEL_TOOLS));
    let futures = calls.iter().map(|call| {
        let runtime = runtime.clone();
        let call = call.clone();
        let permits = permits.clone();
        async move {
            let _permit = permits.acquire_owned().await.ok();
            tools::execute(&runtime, &call).await
        }
    });
    join_all(futures).await
}

/* ------------------------------------------------------------------ */
/* Misc helpers                                                        */
/* ------------------------------------------------------------------ */

fn resolve_protocols(
    provider: &ProviderInfo,
    model: &ModelInfo,
) -> anyhow::Result<Vec<WireProtocol>> {
    let mut protocols: Vec<WireProtocol> = model
        .protocols
        .iter()
        .filter_map(|protocol| WireProtocol::parse(protocol))
        .collect();
    if protocols.is_empty() {
        for key in provider.endpoints.keys() {
            if let Some(protocol) = WireProtocol::parse(key) {
                protocols.push(protocol);
            }
        }
    }
    protocols.dedup();
    if protocols.is_empty() {
        return Err(anyhow!(
            "o modelo `{}` não declara nenhum protocolo suportado",
            model.id
        ));
    }
    Ok(protocols)
}

fn reasoning_request(
    selection: Option<&ReasoningSelection>,
    model: &ModelInfo,
) -> ReasoningRequest {
    match selection {
        None => ReasoningRequest::Auto,
        Some(selection) => match selection.mode {
            ReasoningMode::Off => ReasoningRequest::Off,
            // Toggle-only models have no effort list: let the provider decide.
            ReasoningMode::Effort => match selection.effort.as_deref().map(str::trim) {
                Some(effort) if !effort.is_empty() => {
                    ReasoningRequest::Effort(effort.to_string())
                }
                _ => ReasoningRequest::Auto,
            },
            ReasoningMode::Budget => {
                let maximum = model.max_output.max(1_024);
                let budget = selection
                    .budget
                    .unwrap_or(8_192)
                    .clamp(1_024, maximum);
                ReasoningRequest::Budget(budget)
            }
        },
    }
}

/// Temperature is only sent to model families that accept it. Claude/GPT
/// reasoning models reject (or silently ignore) the parameter.
fn temperature_request(
    options: &TurnOptions,
    settings: &Settings,
    model: &ModelInfo,
) -> Option<f32> {
    let family = model.family.to_ascii_lowercase();
    let id = model.id.to_ascii_lowercase();
    let rejects_temperature = family.contains("claude")
        || family.contains("gpt")
        || id.contains("claude")
        || id.contains("gpt");
    if rejects_temperature {
        return None;
    }
    options.temperature.or(settings.temperature)
}

fn supports_images(model: &ModelInfo) -> bool {
    if !model.attachment {
        return false;
    }
    model.modalities.input.is_empty()
        || model
            .modalities
            .input
            .iter()
            .any(|modality| modality == "image")
}

fn merge_usage(target: &mut UsageInfo, source: &UsageInfo) {
    target.input_tokens = add_tokens(target.input_tokens, source.input_tokens);
    target.output_tokens = add_tokens(target.output_tokens, source.output_tokens);
    target.reasoning_tokens = add_tokens(target.reasoning_tokens, source.reasoning_tokens);
    target.cached_tokens = add_tokens(target.cached_tokens, source.cached_tokens);
    target.total_tokens = add_tokens(target.total_tokens, source.total_tokens);
    target.cost = match (target.cost, source.cost) {
        (Some(left), Some(right)) => Some(left + right),
        (left, None) => left,
        (None, right) => right,
    };
}

fn add_tokens(left: Option<u32>, right: Option<u32>) -> Option<u32> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.saturating_add(right)),
        (Some(left), None) => Some(left),
        (None, right) => right,
    }
}

fn should_auto_title(title: &str) -> bool {
    let title = title.trim();
    if title.is_empty() {
        return true;
    }
    matches!(
        title.to_lowercase().as_str(),
        "nova conversa" | "novo chat" | "new chat" | "untitled" | "sem título" | "sem titulo"
    )
}

fn derive_title(text: &str) -> Option<String> {
    let mut cleaned = String::new();
    let mut in_fence = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence || trimmed.is_empty() {
            continue;
        }
        let line = trimmed.trim_start_matches(|character: char| {
            matches!(character, '#' | '>' | '-' | '*' | ' ' | '+' | '|')
        });
        if line.is_empty() {
            continue;
        }
        if !cleaned.is_empty() {
            cleaned.push(' ');
        }
        cleaned.push_str(line);
        if cleaned.chars().count() > TITLE_MAX_CHARS * 3 {
            break;
        }
    }
    let cleaned: String = cleaned
        .chars()
        .filter(|character| !matches!(character, '*' | '`' | '_' | '[' | ']' | '#'))
        .collect();
    let mut collapsed = String::with_capacity(cleaned.len());
    for word in cleaned.split_whitespace() {
        if !collapsed.is_empty() {
            collapsed.push(' ');
        }
        collapsed.push_str(word);
    }
    if collapsed.is_empty() {
        return None;
    }
    let total = collapsed.chars().count();
    let mut title: String = collapsed.chars().take(TITLE_MAX_CHARS).collect();
    if total > TITLE_MAX_CHARS {
        if let Some(index) = title.rfind(' ') {
            if index >= 16 {
                title.truncate(index);
            }
        }
        title.push('…');
    }
    let title = title.trim().to_string();
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut output: String = text.chars().take(max).collect();
    output.push('…');
    output
}

fn emit(emitter: &Arc<dyn EventEmitter>, event: TurnEvent) {
    // A closed window must not abort the turn: the state is persisted anyway.
    emitter.emit(event);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{Modalities, ReasoningOption};

    fn model() -> ModelInfo {
        ModelInfo {
            id: "glm-5.3-flash".to_string(),
            name: "GLM 5.3 Flash".to_string(),
            family: "glm".to_string(),
            protocols: vec!["openai-chat".to_string()],
            reasoning: true,
            reasoning_options: Vec::<ReasoningOption>::new(),
            attachment: true,
            modalities: Modalities {
                input: vec!["text".into(), "image".into()],
                output: vec!["text".into()],
            },
            context_window: 128_000,
            max_output: 16_384,
            cost: None,
            release_date: None,
            knowledge: None,
            open_weights: false,
            description: None,
            tags: Vec::new(),
            status: "stable".to_string(),
        }
    }

    fn provider() -> ProviderInfo {
        ProviderInfo {
            id: "opencode-go".into(),
            name: "OpenCode Go".into(),
            short_name: "Go".into(),
            description: String::new(),
            base_url: "https://opencode.ai/inference/go".into(),
            console_url: String::new(),
            endpoints: [("openai-chat".to_string(), "/openai/v1/chat/completions".to_string())]
                .into_iter()
                .collect(),
            auth_env: "OPENCODE_API_KEY".into(),
            default_model_id: "glm-5.3-flash".into(),
            models: Vec::new(),
            notes: Vec::new(),
        }
    }

    #[test]
    fn protocols_come_from_the_model_then_from_endpoints() {
        let mut model = model();
        assert_eq!(
            resolve_protocols(&provider(), &model).unwrap(),
            vec![WireProtocol::OpenaiChat]
        );
        model.protocols.clear();
        assert_eq!(
            resolve_protocols(&provider(), &model).unwrap(),
            vec![WireProtocol::OpenaiChat]
        );
    }

    #[test]
    fn maps_reasoning_selection() {
        let model = model();
        assert!(reasoning_request(None, &model).is_auto());
        assert!(matches!(
            reasoning_request(
                Some(&ReasoningSelection {
                    mode: ReasoningMode::Off,
                    effort: None,
                    budget: None,
                }),
                &model
            ),
            ReasoningRequest::Off
        ));
        assert!(matches!(
            reasoning_request(
                Some(&ReasoningSelection {
                    mode: ReasoningMode::Effort,
                    effort: Some("max".into()),
                    budget: None,
                }),
                &model
            ),
            ReasoningRequest::Effort(value) if value == "max"
        ));
        // Toggle-only models: no effort value -> provider default.
        assert!(reasoning_request(
            Some(&ReasoningSelection {
                mode: ReasoningMode::Effort,
                effort: None,
                budget: None,
            }),
            &model
        )
        .is_auto());
        assert!(matches!(
            reasoning_request(
                Some(&ReasoningSelection {
                    mode: ReasoningMode::Budget,
                    effort: None,
                    budget: Some(4_096),
                }),
                &model
            ),
            ReasoningRequest::Budget(value) if value == 4_096
        ));
        // Budget is clamped to [1024, model.max_output].
        assert!(matches!(
            reasoning_request(
                Some(&ReasoningSelection {
                    mode: ReasoningMode::Budget,
                    effort: None,
                    budget: Some(999_999),
                }),
                &model
            ),
            ReasoningRequest::Budget(value) if value == model.max_output
        ));
        assert!(matches!(
            reasoning_request(
                Some(&ReasoningSelection {
                    mode: ReasoningMode::Budget,
                    effort: None,
                    budget: Some(1),
                }),
                &model
            ),
            ReasoningRequest::Budget(value) if value == 1_024
        ));
    }

    #[test]
    fn temperature_is_omitted_for_claude_and_gpt() {
        let options = TurnOptions {
            temperature: Some(0.3),
            ..Default::default()
        };
        let settings = Settings::default();
        let mut model = model();
        assert_eq!(temperature_request(&options, &settings, &model), Some(0.3));
        model.family = "claude".into();
        assert_eq!(temperature_request(&options, &settings, &model), None);
        model.family = "gpt".into();
        assert_eq!(temperature_request(&options, &settings, &model), None);
    }

    #[test]
    fn detects_vision_models() {
        let mut model = model();
        assert!(supports_images(&model));
        model.modalities.input = vec!["text".into()];
        assert!(!supports_images(&model));
        model.modalities.input.clear();
        assert!(supports_images(&model));
        model.attachment = false;
        assert!(!supports_images(&model));
    }

    #[test]
    fn derives_titles() {
        assert!(should_auto_title("Nova conversa"));
        assert!(should_auto_title("  "));
        assert!(!should_auto_title("Planejamento financeiro"));
        assert_eq!(
            derive_title("## Como **investir** melhor\n\nSegunda linha"),
            Some("Como investir melhor Segunda linha".to_string())
        );
        let long = "a".repeat(120);
        let title = derive_title(&long).expect("title");
        assert!(title.chars().count() <= TITLE_MAX_CHARS + 1);
        assert!(title.ends_with('…'));
    }

    #[test]
    fn merges_usage() {
        let mut total = UsageInfo::default();
        merge_usage(
            &mut total,
            &UsageInfo {
                input_tokens: Some(10),
                output_tokens: Some(5),
                cost: Some(0.01),
                ..Default::default()
            },
        );
        merge_usage(
            &mut total,
            &UsageInfo {
                input_tokens: Some(3),
                output_tokens: Some(2),
                reasoning_tokens: Some(1),
                cost: Some(0.02),
                ..Default::default()
            },
        );
        assert_eq!(total.input_tokens, Some(13));
        assert_eq!(total.output_tokens, Some(7));
        assert_eq!(total.reasoning_tokens, Some(1));
        assert!((total.cost.unwrap() - 0.03).abs() < 1e-9);
    }

    #[test]
    fn image_budget_prefers_newest_messages() {
        let mut messages = Vec::new();
        for index in 0..3 {
            let mut message = ChatMessage::user("c", format!("msg {index}"));
            message.attachments = vec![AttachmentInfo {
                id: format!("a{index}"),
                name: "foto.png".into(),
                mime_type: "image/png".into(),
                size: 8 * 1024 * 1024,
                kind: "image".into(),
                ..Default::default()
            }];
            messages.push(message);
        }
        let enabled = image_enabled_messages(&messages, true);
        // Each 8 MB image costs ~10.7M base64 chars, so only one fits the 16M budget.
        assert_eq!(enabled.len(), 1);
        assert!(enabled.contains(&messages[2].id));
        assert!(!enabled.contains(&messages[0].id));
    }
}

#[cfg(test)]
mod agent_loop_tests {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use super::*;
    use crate::catalog::{ModelInfo, ProviderInfo};
    use crate::domain::{Conversation, MessageStatus, ToolCallStatus, TurnOptions, TurnPayload};

    struct TempDb {
        db: Arc<Db>,
        path: PathBuf,
    }

    impl TempDb {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "lumina-harness-test-{}.db",
                uuid::Uuid::new_v4()
            ));
            let db = Arc::new(Db::open(&path).expect("open temp db"));
            Self { db, path }
        }
    }

    impl Drop for TempDb {
        fn drop(&mut self) {
            for suffix in ["", "-wal", "-shm"] {
                let _ = std::fs::remove_file(format!("{}{suffix}", self.path.display()));
            }
        }
    }

    fn test_catalog() -> CatalogFile {
        let model = ModelInfo {
            id: "deepseek-v4.1-flash".to_string(),
            name: "DeepSeek V4.1 Flash".to_string(),
            family: "deepseek".to_string(),
            protocols: vec!["openai-chat".to_string()],
            reasoning: false,
            reasoning_options: Vec::new(),
            attachment: false,
            modalities: Default::default(),
            context_window: 100_000,
            max_output: 8_000,
            cost: None,
            release_date: None,
            knowledge: None,
            open_weights: true,
            description: None,
            tags: Vec::new(),
            status: "stable".to_string(),
        };
        let provider = ProviderInfo {
            id: "opencode-go".to_string(),
            name: "OpenCode Go".to_string(),
            short_name: "Go".to_string(),
            description: String::new(),
            base_url: "https://example.invalid".to_string(),
            console_url: String::new(),
            endpoints: HashMap::new(),
            auth_env: "OPENCODE_API_KEY".to_string(),
            default_model_id: model.id.clone(),
            models: vec![model],
            notes: Vec::new(),
        };
        CatalogFile {
            version: 1,
            generated_at: String::new(),
            sources: serde_json::Value::Null,
            providers: vec![provider],
        }
    }

    fn deps(db: Arc<Db>, streamer: ProviderStreamer) -> HarnessDeps {
        HarnessDeps {
            app: None,
            db,
            http: reqwest::Client::new(),
            search_http: reqwest::Client::new(),
            catalog: test_catalog(),
            streamer: Some(streamer),
            api_key_override: Some("test-key".to_string()),
        }
    }

    fn payload(conversation: &Conversation, max_steps: u32) -> TurnPayload {
        TurnPayload {
            conversation_id: conversation.id.clone(),
            content: "Explique MCP em duas frases".to_string(),
            attachment_ids: Vec::new(),
            provider_id: "opencode-go".to_string(),
            model_id: "deepseek-v4.1-flash".to_string(),
            reasoning: None,
            options: TurnOptions {
                max_steps,
                ..Default::default()
            },
            turn_id: Some(uuid::Uuid::new_v4().to_string()),
        }
    }

    #[derive(Clone)]
    struct CollectEvents {
        events: Arc<Mutex<Vec<String>>>,
    }

    impl EventEmitter for CollectEvents {
        fn emit(&self, event: TurnEvent) {
            if let Ok(json) = serde_json::to_string(&event) {
                self.events.lock().expect("events lock").push(json);
            }
        }
    }

    fn channel() -> (Arc<dyn EventEmitter>, Arc<Mutex<Vec<String>>>) {
        let events: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let emitter = CollectEvents {
            events: events.clone(),
        };
        (Arc::new(emitter), events)
    }

    fn has_event(events: &Arc<Mutex<Vec<String>>>, kind: &str) -> bool {
        events
            .lock()
            .expect("events lock")
            .iter()
            .any(|json| json.contains(&format!("\"type\":\"{kind}\"")))
    }

    fn emit(sink: &EventSink, event: ProviderEvent) {
        let _ = sink.send(event);
    }

    fn tool_call_stream(sink: &EventSink, id: &str, name: &str) {
        emit(sink, ProviderEvent::ToolCallStart { index: 0, id: id.to_string(), name: name.to_string() });
        emit(sink, ProviderEvent::ToolCallArgsDelta { index: 0, delta: "{}".to_string() });
        emit(sink, ProviderEvent::ToolCallDone { index: 0, arguments: "{}".to_string() });
        emit(sink, ProviderEvent::Done);
    }

    fn text_stream(sink: &EventSink, text: &str) {
        emit(sink, ProviderEvent::TextDelta(text.to_string()));
        emit(sink, ProviderEvent::Done);
    }

    #[tokio::test]
    async fn discards_intermediate_narration_and_executes_tool_calls() {
        let temp = TempDb::new();
        let conversation = temp
            .db
            .create_conversation("Nova conversa", "opencode-go", "deepseek-v4.1-flash")
            .expect("conversation");

        let calls: Arc<Mutex<Vec<bool>>> = Arc::new(Mutex::new(Vec::new()));
        let step = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let streamer: ProviderStreamer = {
            let calls = calls.clone();
            let step = step.clone();
            Arc::new(move |request, sink| {
                let has_tools = !request.tools.is_empty();
                calls.lock().expect("calls lock").push(has_tools);
                let current = step.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Box::pin(async move {
                    if current == 0 {
                        // First step: the model narrates and then calls a (fake) tool.
                        text_stream(&sink, "Narração intermediária que não deve virar resposta.");
                        tool_call_stream(&sink, "call-1", "ferramenta_inexistente");
                    } else {
                        // Second step: the model answers with text and no tool calls.
                        text_stream(&sink, "Resposta final em duas frases.");
                    }
                    Ok(())
                })
            })
        };

        let (channel, events) = channel();
        let result = run_turn(
            deps(temp.db.clone(), streamer),
            payload(&conversation, 4),
            Settings::default(),
            channel,
            CancellationToken::new(),
        )
        .await
        .expect("turn should complete");

        // Tools are offered on both steps; only the first one produces a tool call.
        assert_eq!(calls.lock().expect("calls lock").as_slice(), &[true, true]);
        assert_eq!(result.assistant_message.status, MessageStatus::Complete);
        assert_eq!(result.assistant_message.content, "Resposta final em duas frases.");
        assert!(!result.assistant_message.content.contains("Narração"));
        assert_eq!(result.assistant_message.tool_calls.len(), 1);
        assert_eq!(result.assistant_message.tool_calls[0].status, ToolCallStatus::Error);
        assert!(result.error.is_none());
        assert!(has_event(&events, "done"));
        assert!(has_event(&events, "tool_call_finished"));
        // One acting step in the thinking trace, without visible reasoning.
        assert_eq!(
            result.assistant_message.trace,
            vec![TraceStep {
                reasoning: None,
                tool_calls: 1,
            }]
        );

        let reloaded = temp
            .db
            .get_conversation(&conversation.id)
            .expect("conversation query")
            .expect("conversation exists");
        assert_eq!(reloaded.title, "Explique MCP em duas frases", "auto title");
    }

    #[tokio::test]
    async fn executes_tools_on_the_last_step_and_forces_a_final_answer() {
        let temp = TempDb::new();
        let conversation = temp
            .db
            .create_conversation("Nova conversa", "opencode-go", "deepseek-v4.1-flash")
            .expect("conversation");

        let calls: Arc<Mutex<Vec<bool>>> = Arc::new(Mutex::new(Vec::new()));
        let streamer: ProviderStreamer = {
            let calls = calls.clone();
            Arc::new(move |request, sink| {
                let has_tools = !request.tools.is_empty();
                calls.lock().expect("calls lock").push(has_tools);
                Box::pin(async move {
                    if has_tools {
                        tool_call_stream(&sink, "call-loop", "ferramenta_inexistente");
                    } else {
                        text_stream(&sink, "Resposta final baseada no que já foi coletado.");
                    }
                    Ok(())
                })
            })
        };

        let (channel, _events) = channel();
        let result = run_turn(
            deps(temp.db.clone(), streamer),
            payload(&conversation, 2),
            Settings::default(),
            channel,
            CancellationToken::new(),
        )
        .await
        .expect("turn should complete");

        // Two tool-calling steps + one forced final-answer step without tools.
        assert_eq!(calls.lock().expect("calls lock").as_slice(), &[true, true, false]);
        assert_eq!(
            result.assistant_message.content,
            "Resposta final baseada no que já foi coletado."
        );
        assert_eq!(result.assistant_message.tool_calls.len(), 2);
        assert_eq!(result.assistant_message.status, MessageStatus::Complete);
        assert_eq!(
            result.assistant_message.trace.len(),
            2,
            "one trace entry per acting step"
        );
        assert!(result.assistant_message.trace.iter().all(|step| step.reasoning.is_none()));
        assert!(result.assistant_message.trace.iter().all(|step| step.tool_calls == 1));
        assert!(result.error.is_none(), "forced answer must not surface an error");
    }

    #[tokio::test]
    async fn records_reasoning_and_tool_counts_per_step_in_the_trace() {
        let temp = TempDb::new();
        let conversation = temp
            .db
            .create_conversation("Nova conversa", "opencode-go", "deepseek-v4.1-flash")
            .expect("conversation");

        let step = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let streamer: ProviderStreamer = {
            let step = step.clone();
            Arc::new(move |_request, sink| {
                let current = step.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Box::pin(async move {
                    if current == 0 {
                        emit(
                            &sink,
                            ProviderEvent::ReasoningDelta("Vou buscar os dados.".to_string()),
                        );
                        tool_call_stream(&sink, "call-1", "ferramenta_inexistente");
                    } else {
                        emit(
                            &sink,
                            ProviderEvent::ReasoningDelta("Já tenho o que preciso.".to_string()),
                        );
                        text_stream(&sink, "Resposta final.");
                    }
                    Ok(())
                })
            })
        };

        let (channel, _events) = channel();
        let result = run_turn(
            deps(temp.db.clone(), streamer),
            payload(&conversation, 4),
            Settings::default(),
            channel,
            CancellationToken::new(),
        )
        .await
        .expect("turn should complete");

        assert_eq!(
            result.assistant_message.trace,
            vec![
                TraceStep {
                    reasoning: Some("Vou buscar os dados.".to_string()),
                    tool_calls: 1,
                },
                TraceStep {
                    reasoning: Some("Já tenho o que preciso.".to_string()),
                    tool_calls: 0,
                },
            ]
        );
        assert_eq!(
            result.assistant_message.reasoning.as_deref(),
            Some("Vou buscar os dados.\n\nJá tenho o que preciso.")
        );
        // The persisted message keeps the trace.
        let stored = temp
            .db
            .get_message(&result.assistant_message.id)
            .expect("get message")
            .expect("stored message");
        assert_eq!(stored.trace, result.assistant_message.trace);
    }

    #[tokio::test]
    async fn provider_failure_marks_the_turn_as_error_without_panicking() {
        let temp = TempDb::new();
        let conversation = temp
            .db
            .create_conversation("Nova conversa", "opencode-go", "deepseek-v4.1-flash")
            .expect("conversation");

        let streamer: ProviderStreamer = Arc::new(|_request, _sink| {
            Box::pin(async move { Err(anyhow::anyhow!("gateway indisponível")) })
        });

        let (channel, _events) = channel();
        let result = run_turn(
            deps(temp.db.clone(), streamer),
            payload(&conversation, 3),
            Settings::default(),
            channel,
            CancellationToken::new(),
        )
        .await
        .expect("turn resolves with an error payload");

        assert_eq!(result.assistant_message.status, MessageStatus::Error);
        assert!(result.assistant_message.content.is_empty());
        let error = result.error.expect("error message");
        assert!(error.contains("gateway indisponível"), "got {error}");
    }

    #[tokio::test]
    async fn cancellation_marks_the_partial_answer_as_cancelled() {
        let temp = TempDb::new();
        let conversation = temp
            .db
            .create_conversation("Nova conversa", "opencode-go", "deepseek-v4.1-flash")
            .expect("conversation");

        let streamer: ProviderStreamer = Arc::new(|_request, sink| {
            Box::pin(async move {
                let _ = sink.send(ProviderEvent::TextDelta("conteúdo parcial".to_string()));
                tokio::time::sleep(Duration::from_secs(5)).await;
                Ok(())
            })
        });

        let (channel, events) = channel();
        let cancel = CancellationToken::new();
        let cancel_handle = cancel.clone();
        let handle = tokio::spawn(async move {
            run_turn(
                deps(temp.db.clone(), streamer),
                payload(&conversation, 3),
                Settings::default(),
                channel,
                cancel,
            )
            .await
        });

        tokio::time::sleep(Duration::from_millis(150)).await;
        cancel_handle.cancel();
        let result = tokio::time::timeout(Duration::from_secs(3), handle)
            .await
            .expect("cancellation should not hang")
            .expect("join")
            .expect("turn resolves");

        assert_eq!(result.assistant_message.status, MessageStatus::Cancelled);
        assert!(has_event(&events, "cancelled"));
        assert!(!has_event(&events, "done"));
    }
}
