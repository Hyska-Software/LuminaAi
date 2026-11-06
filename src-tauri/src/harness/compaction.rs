//! Compactação de contexto cache-safe dos perfis Chat e Code (`HARNESS.md` §10.3, PLAN §4.6/F2c/F3b).
//!
//! Quando o histórico estimado passa do gatilho, o trecho antigo é resumido e
//! substituído no histórico do modelo por uma única mensagem de resumo. O
//! transcript real do usuário permanece no banco; a UI mostra um card "Contexto
//! compactado".
//!
//! **Cache-safe (F3b):** a chamada de resumo reusa o request normal como
//! prefixo — mesmo `system_prompt`, mesmas `tool_definitions`, mesmo histórico —
//! e só anexa uma instrução de sumarização como mensagem final de user. Assim o
//! provider lê o prefixo cacheado em vez de pagar o prompt inteiro.
//!
//! A fronteira persistida (`session_summaries.to_seq`) é a contagem de
//! **mensagens** cobertas (ordinal estável em `messages`), não o índice do
//! histórico neutro (que expande cada assistant em N passos) — correção do D15.

use std::collections::HashSet;
use std::sync::Arc;

use tokio_util::sync::CancellationToken;

use crate::db::{Db, RenderDecisionRecord};
use crate::domain::now_ms;
use crate::events::TurnEvent;
use crate::harness::cache::snapshot::stable_hash;
use crate::harness::{
    batch, build_history, cache_plan_for, code_prompt_snapshot, code_tool_definitions_with_mcp,
    load_surface_items, mcp_tools_prompt_section, provider_config, resolve_credential,
    resolve_model, resolve_protocols, supports_images, EventEmitter, HarnessDeps,
};
use crate::providers::{CompletionRequest, HistoryMessage, HistoryRole};

use crate::harness::code::session;

/// Gatilho: fração da janela em que a compactação automática roda.
pub const TRIGGER_RATIO: f32 = 0.75;
/// Mantém ~30% do fim do histórico intacto (turns recentes).
const KEEP_RATIO: f32 = 0.3;
/// Nunca compacta um histórico curto.
pub const MIN_HISTORY_MESSAGES: usize = 6;
/// Cap de caracteres por mensagem no transcript que vai ao resumidor.
const TRANSCRIPT_MESSAGE_CAP: usize = 2_000;
/// Marcador do início de um `surface_item` renderizado no histórico; nunca é
/// candidato a fronteira de corte (é contexto, não mensagem do usuário).
const SURFACE_RENDER_PREFIX: &str = "<contexto-da-sessao";
/// Máximo de tokens pedidos ao resumidor.
const SUMMARY_MAX_TOKENS: u32 = 1_200;

/// Kind da decisão de render que congela um tool result podado (`render_decisions`).
pub const RENDER_KIND_TOOL_RESULT: &str = "tool_result";
/// Tool results acima deste limite no trecho **mantido** são podados na
/// compactação (head+tail+marker). Abaixo do limite ficam intactos.
pub const KEPT_TOOL_RESULT_MAX_CHARS: usize = 8_000;
/// Cabeça preservada do tool result podado.
const PRUNED_HEAD_CHARS: usize = 2_000;
/// Cauda preservada do tool result podado.
const PRUNED_TAIL_CHARS: usize = 1_000;
/// Marcador que identifica um texto já podado (idempotência do replay).
const PRUNED_MARKER: &str = "[… saída podada na compactação";

/// Gera o render podado de um tool result grande (head + marcador + tail).
///
/// Retorna `None` quando o texto é curto o bastante ou já está podado (assim a
/// poda é idempotente entre turnos/restart). O texto original continua no banco
/// (`ToolCallRecord.result`); a decisão congelada em `render_decisions` é a
/// fonte do replay.
pub fn prune_tool_result(text: &str) -> Option<String> {
    if text.contains(PRUNED_MARKER) {
        return None;
    }
    let chars = text.chars().count();
    if chars <= KEPT_TOOL_RESULT_MAX_CHARS {
        return None;
    }
    let head: String = text.chars().take(PRUNED_HEAD_CHARS).collect();
    let tail: String = text.chars().skip(chars - PRUNED_TAIL_CHARS).collect();
    let omitted = chars.saturating_sub(PRUNED_HEAD_CHARS + PRUNED_TAIL_CHARS);
    Some(format!(
        "{head}\n\n{PRUNED_MARKER}: {omitted} caracteres omitidos. O conteúdo completo continua no \
         arquivo/resultado original; releia o arquivo ou repita a consulta se precisar dele.]\n\n\
         {tail}"
    ))
}

/// Persiste (merge idempotente) a decisão de render podado de um tool result.
fn persist_tool_result_prune(
    db: &Db,
    assistant_message_id: &str,
    call_id: &str,
    original: &str,
    pruned: &str,
) {
    let mut payload: serde_json::Map<String, serde_json::Value> =
        match db.get_render_decision(assistant_message_id, RENDER_KIND_TOOL_RESULT) {
            Ok(Some(decision)) => serde_json::from_str(&decision.payload).unwrap_or_default(),
            _ => serde_json::Map::new(),
        };
    payload.insert(
        call_id.to_string(),
        serde_json::Value::String(pruned.to_string()),
    );
    let decision = RenderDecisionRecord {
        message_id: assistant_message_id.to_string(),
        kind: RENDER_KIND_TOOL_RESULT.to_string(),
        digest: stable_hash(original),
        payload: serde_json::Value::Object(payload).to_string(),
        created_at: now_ms(),
    };
    if let Err(error) = db.upsert_render_decision(&decision) {
        eprintln!("lumina: falha ao congelar tool result podado: {error:#}");
    }
}

/// Poda, no trecho **mantido** do histórico pós-compactação, os tool results
/// acima de [`KEPT_TOOL_RESULT_MAX_CHARS`]: aplica o render podado ao histórico
/// em memória e persiste a decisão para o replay byte-a-byte. O pareamento
/// tool_use/tool_result não muda (a mensagem continua existindo).
///
/// Nota: o transcript do resumo é montado **antes** desta poda e cobre apenas o
/// trecho removido — ele usa o texto original do trecho coberto; a poda da cauda
/// mantida só afeta o replay, nunca o resumo.
fn prune_kept_tail_tool_results(
    db: &Db,
    messages: &[crate::domain::ChatMessage],
    history: &mut [HistoryMessage],
    anchors: &[usize],
) {
    for (index, message) in history.iter_mut().enumerate() {
        if message.role != HistoryRole::Tool {
            continue;
        }
        let ordinal = anchors.get(index).copied().unwrap_or(0);
        if ordinal == 0 || ordinal > messages.len() {
            continue;
        }
        let Some(call_id) = message.tool_call_id.clone() else {
            continue;
        };
        let owner = &messages[ordinal - 1];
        let Some(call) = owner.tool_calls.iter().find(|call| call.id == call_id) else {
            continue;
        };
        let Some(original) = call.result.as_deref() else {
            continue;
        };
        let Some(pruned) = prune_tool_result(original) else {
            continue;
        };
        persist_tool_result_prune(db, &owner.id, &call_id, original, &pruned);
        message.text = pruned;
    }
}

/// Tokens estimados a partir dos caracteres (heurística `chars/4`).
pub fn estimate_tokens(chars: usize) -> u32 {
    ((chars / 4) as u32).max(1)
}

/// O histórico passou do gatilho de compactação? (helper de teste)
#[cfg(test)]
pub fn over_threshold(used_tokens: u32, window: u32) -> bool {
    window > 0 && used_tokens as f32 / window as f32 >= TRIGGER_RATIO
}

/// Soma de caracteres de um histórico neutral.
pub fn history_chars(history: &[HistoryMessage]) -> usize {
    history
        .iter()
        .map(|message| message.text.chars().count() + message.role_display_len())
        .sum()
}

trait RoleDisplayLen {
    fn role_display_len(&self) -> usize;
}

impl RoleDisplayLen for HistoryMessage {
    fn role_display_len(&self) -> usize {
        // Overhead pequeno por mensagem (papel/separadores no wire).
        16
    }
}

/// Posição de corte: do fim para o início, mantendo ~30% dos caracteres e
/// parando em uma fronteira de mensagem do usuário (nunca separa
/// assistant ↔ tool result, que os provedores exigem em par).
pub fn cut_index(history: &[HistoryMessage]) -> Option<usize> {
    if history.len() < MIN_HISTORY_MESSAGES {
        return None;
    }
    let total = history_chars(history);
    let keep_chars = ((total as f32) * KEEP_RATIO).ceil() as usize;
    let mut kept = 0usize;
    let mut cut = history.len();
    for (index, message) in history.iter().enumerate().rev() {
        kept += message.text.chars().count() + message.role_display_len();
        if kept >= keep_chars {
            cut = index;
            break;
        }
    }
    // Avança até uma mensagem do usuário (fronteira segura de turno).
    while cut > 0 && history[cut].role != HistoryRole::User {
        cut -= 1;
    }
    if cut == 0 {
        // Sem fronteira de usuário: corta no meio mesmo, desde que não separe
        // um tool result do assistant que o declarou (o corte pela metade é o
        // menor risco aqui; começamos pela segunda mensagem).
        cut = 1;
    }
    (cut < history.len()).then_some(cut)
}

/// Ajusta o corte do histórico para o **início de um grupo de mensagem real**
/// (fronteira estável): precisa ser uma mensagem `user`, com ordinal de mensagem
/// conhecido, e não um `surface_item` renderizado.
pub fn align_cut(history: &[HistoryMessage], anchors: &[usize], cut: usize) -> Option<usize> {
    let mut index = cut;
    while index < history.len() {
        let message = &history[index];
        let known_message = anchors.get(index).copied().unwrap_or(0) > 0;
        let group_start = index == 0 || anchors.get(index - 1) != anchors.get(index);
        if known_message
            && group_start
            && message.role == HistoryRole::User
            && !message.text.starts_with(SURFACE_RENDER_PREFIX)
        {
            return Some(index);
        }
        index += 1;
    }
    None
}

/// Texto compacto do trecho a resumir (inclui os `surface_items` cobertos).
pub fn transcript(history: &[HistoryMessage], cut: usize) -> String {
    let mut out = String::new();
    for message in &history[..cut.min(history.len())] {
        let role = match message.role {
            HistoryRole::User => "User",
            HistoryRole::Assistant => "Assistant",
            HistoryRole::Tool => "Tool",
            HistoryRole::System => "System",
        };
        let text: String = message.text.chars().take(TRANSCRIPT_MESSAGE_CAP).collect();
        if text.trim().is_empty() {
            continue;
        }
        out.push_str(&format!("{role}: {text}\n\n"));
        if out.chars().count() > 24_000 {
            out.push_str("…[transcript truncated]\n");
            break;
        }
    }
    out
}

/// Instrução de sumarização anexada **ao fim do histórico normal** (o resto do
/// request é o prefixo cacheável reusado).
pub fn summary_instruction(transcript: &str) -> String {
    format!(
        "Summarize the transcript of this same conversation below so we can continue the work \
         in a new context. Write in English, in Markdown, without opinion and without mentioning \
         that compaction happened. Preserve file paths, commands, symbol names and literal error \
         messages. Fixed structure:\n\
         ## Main request\n## Decisions and architecture\n## Files and code\n\
         ## Errors and fixes\n## Pending jobs/processes\n## Work in progress\n\
         ## Next step\n## Critical context\n\
         Be specific and short; do not invent facts that are not in the transcript.\n\n\
         Transcript:\n\n{transcript}"
    )
}

/// Prompt de sumarização (compatibilidade com o `/compact` manual em
/// `commands/code.rs`, que ainda monta um request próprio). A compactação
/// automática usa [`summary_instruction`] no fim do request normal (cache-safe).
#[allow(dead_code)] // compat: mantido após a migração do /compact para o helper cache-safe
pub fn summary_system_prompt() -> &'static str {
    "You summarize software engineering conversations so work can continue in a new \
     context. Write in English, in Markdown, without opinion and without mentioning that \
     compaction happened. Preserve file paths, commands, symbol names and literal error \
     messages. Fixed structure:\n\
     ## Main request\n## Decisions and architecture\n## Files and code\n\
     ## Errors and fixes\n## Pending jobs/processes\n## Work in progress\n\
     ## Next step\n## Critical context\n\
     Be specific and short; do not invent facts that are not in the transcript."
}

/// Mensagem de resumo que substitui o trecho compactado no histórico.
pub fn summary_message(summary: &str) -> HistoryMessage {
    HistoryMessage::user(format!(
        "[Summary of the previous conversation — generated automatically; continue the work from it]\n{summary}"
    ))
}

/// Histórico compactado: resumo + trecho recente.
pub fn compacted_history(
    summary: &str,
    history: &[HistoryMessage],
    cut: usize,
) -> Vec<HistoryMessage> {
    let mut next = Vec::with_capacity(history.len() - cut + 1);
    next.push(summary_message(summary));
    next.extend(history[cut.min(history.len())..].iter().cloned());
    next
}

/// Resultado de uma compactação bem-sucedida.
pub struct CompactionOutcome {
    /// Mensagens persistidas cobertas (`to_seq` do resumo).
    pub covered_messages: u32,
}

/// Remove os `surface_items` ancorados em mensagens cobertas pela compactação
/// (o texto deles já entrou no transcript do resumo — PLAN §4.4).
fn prune_covered_surface_items(db: &Db, conversation_id: &str, covered_ids: &HashSet<&str>) {
    let Ok(items) = db.list_surface_items(conversation_id) else {
        return;
    };
    for item in items {
        let covered = item
            .after_message_id
            .as_deref()
            .is_some_and(|anchor| covered_ids.contains(anchor));
        if covered {
            if let Err(error) = db.delete_surface_item(conversation_id, &item.id) {
                eprintln!("lumina: falha ao remover surface_item coberto: {error:#}");
            }
        }
    }
}

/// Roda a compactação automática se o histórico estiver acima do gatilho.
///
/// O resumo reusa o request normal (system/tools/histórico) como prefixo e anexa
/// a instrução no fim. Falhas são engolidas (com log): compactar é otimização —
/// o turno continua com o histórico original e a próxima iteração tenta de novo.
#[allow(clippy::too_many_arguments)]
pub async fn maybe_compact(
    deps: &HarnessDeps,
    conversation_id: &str,
    turn_id: &str,
    request_template: &CompletionRequest,
    history: &mut Vec<HistoryMessage>,
    anchors: &mut Vec<usize>,
    messages: &[crate::domain::ChatMessage],
    window: u32,
    output_cap: u32,
    emit: &Arc<dyn EventEmitter>,
    cancel: &CancellationToken,
) -> Option<CompactionOutcome> {
    if cancel.is_cancelled() {
        return None;
    }
    let used =
        estimate_tokens(history_chars(history) + request_template.system_prompt.chars().count());
    // Deixa headroom para a resposta (output cap) além do gatilho.
    let usable = window.saturating_sub(output_cap.min(window / 2));
    let trigger = ((usable as f32) * TRIGGER_RATIO) as u32;
    if used < trigger {
        return None;
    }
    let cut = align_cut(history, anchors, cut_index(history)?)?;
    let covered = anchors.get(cut).copied().unwrap_or(0).saturating_sub(1);
    if covered == 0 || covered >= messages.len() {
        return None;
    }
    let transcript = transcript(history, cut);
    if transcript.trim().len() < 500 {
        return None;
    }

    // Request do resumo = request normal (prefixo cacheável) + instrução no fim.
    let mut summary_request = request_template.clone();
    summary_request.history = history.clone();
    summary_request
        .history
        .push(HistoryMessage::user(summary_instruction(&transcript)));
    summary_request.max_output_tokens = Some(
        summary_request
            .max_output_tokens
            .unwrap_or(SUMMARY_MAX_TOKENS)
            .min(SUMMARY_MAX_TOKENS),
    );
    let summary = tokio::select! {
        _ = cancel.cancelled() => return None,
        result = tokio::time::timeout(
            std::time::Duration::from_secs(90),
            batch::complete_request(deps, summary_request),
        ) => {
            match result {
                Ok(Ok(text)) => text,
                Ok(Err(error)) => {
                    eprintln!("lumina: compactação falhou (provedor): {error:#}");
                    return None;
                }
                Err(_) => {
                    eprintln!("lumina: compactação excedeu o tempo limite");
                    return None;
                }
            }
        }
    };
    if summary.trim().is_empty() {
        return None;
    }

    // Poda: os `surface_items` cobertos já estão no transcript e saem do replay.
    let covered_messages: u32 = u32::try_from(covered).unwrap_or(u32::MAX);
    let covered_ordinal = usize::try_from(covered).unwrap_or(usize::MAX);
    let covered_ids: HashSet<&str> = messages
        .iter()
        .take(covered_ordinal)
        .map(|message| message.id.as_str())
        .collect();
    prune_covered_surface_items(&deps.db, conversation_id, &covered_ids);

    let before = estimate_tokens(history_chars(history));
    *history = compacted_history(&summary, history, cut);
    *anchors = std::iter::once(0)
        .chain(anchors.iter().skip(cut).copied())
        .collect();
    // Poda determinística da cauda mantida (render congelado em
    // `render_decisions`; o replay do próximo turno/restart aplica a decisão).
    prune_kept_tail_tool_results(&deps.db, messages, history, anchors);
    let after = estimate_tokens(history_chars(history));
    let tokens_freed = before.saturating_sub(after);
    if let Err(error) = deps.db.insert_session_summary(
        conversation_id,
        1,
        i64::from(covered_messages),
        &summary,
        Some(before),
    ) {
        eprintln!("lumina: falha ao persistir resumo de contexto: {error:#}");
    }
    // Evento próprio de compactação (`context/compacted`): o fold do medidor lê
    // só o total de mensagens cobertas daqui — reciclar `context/stats` com um
    // payload parcial envenenava a projeção do `ContextStats`.
    let _ = record_compaction(
        &deps.db,
        conversation_id,
        turn_id,
        covered_messages,
        tokens_freed,
    );
    emit.emit(TurnEvent::Compacted {
        messages: covered_messages,
        tokens_freed,
    });
    Some(CompactionOutcome { covered_messages })
}

/// Pedido do resumo do `/compact` manual, montado pelo comando consumidor.
///
/// O helper não persiste nada: o comando decide quando gravar
/// `session_summaries`, emitir evento e substituir o histórico.
#[allow(dead_code)] // consumido pelo /compact manual (task-29, commands/code.rs)
pub struct ManualSummaryRequest<'a> {
    /// Conversa dona da compactação (id usado como sessão/chave de cache).
    pub conversation: &'a crate::domain::Conversation,
    pub provider_id: &'a str,
    pub model_id: &'a str,
    /// Histórico neutral do **request normal** da conversa (prefixo cacheável).
    pub history: &'a [HistoryMessage],
    /// System prompt congelado do perfil (o mesmo do request normal).
    pub system_prompt: &'a str,
    /// Tool definitions do request normal.
    pub tools: &'a [crate::providers::ToolDefinition],
    /// Índice do histórico onde o resumo corta (mantém `history[cut..]`).
    pub cut: usize,
    /// Plano de cache do request normal (F4); reusado no request de resumo.
    pub cache_plan: Option<crate::providers::cache::CachePlan>,
    pub max_output_tokens: u32,
}

/// Resultado do resumo manual (`/compact`).
#[derive(Debug, Clone)]
#[allow(dead_code)] // consumido pelo /compact manual (task-29, commands/code.rs)
pub struct ManualSummaryOutcome {
    pub summary: String,
    /// Mensagens cobertas (`= cut`, ordinal estável em `messages`) → `to_seq`.
    pub covered: u32,
    /// Tokens estimados liberados ao substituir o trecho pelo resumo.
    pub tokens_freed: u32,
    /// SHA-256 do system prompt congelado usado no prefixo (link com
    /// `cache_state.prompt_snapshot_hash`).
    pub system_prompt_hash: String,
}

/// Finaliza um resumo manual: anexa [`summary_instruction`] ao histórico normal,
/// chama o provider e calcula `tokens_freed`. Nada é persistido.
#[allow(dead_code)]
async fn finish_manual_summary(
    deps: &HarnessDeps,
    mut completion: CompletionRequest,
    history: &[HistoryMessage],
    cut: usize,
    covered: u32,
    system_prompt_hash: String,
) -> anyhow::Result<ManualSummaryOutcome> {
    if cut == 0 || cut >= history.len() {
        anyhow::bail!("corte de compactação inválido: {cut}");
    }
    let transcript = transcript(history, cut);
    if transcript.trim().len() < 500 {
        anyhow::bail!("trecho antigo pequeno demais para resumir");
    }
    completion.history = history.to_vec();
    completion
        .history
        .push(HistoryMessage::user(summary_instruction(&transcript)));
    completion.max_output_tokens = Some(
        completion
            .max_output_tokens
            .unwrap_or(SUMMARY_MAX_TOKENS)
            .min(SUMMARY_MAX_TOKENS),
    );
    let summary = batch::complete_request(deps, completion).await?;
    let summary = summary.trim().to_string();
    if summary.is_empty() {
        anyhow::bail!("o modelo não devolveu resumo");
    }
    let before = estimate_tokens(history_chars(history));
    let after = estimate_tokens(history_chars(&compacted_history(&summary, history, cut)));
    Ok(ManualSummaryOutcome {
        summary,
        covered,
        tokens_freed: before.saturating_sub(after),
        system_prompt_hash,
    })
}

/// Resume manualmente (cache-safe) o trecho `history[..cut]` para o `/compact`.
///
/// O request reusa **system prompt + tools + histórico normal** como prefixo e
/// anexa [`summary_instruction`] como última mensagem de user — o provedor lê o
/// prefixo cacheado em vez de pagar o prompt inteiro. O `cache_plan` do request
/// normal (F4) deve ser repassado. Nada é persistido aqui: o comando grava o
/// resumo/evento e aplica `[resumo]+cauda` no histórico.
///
/// Para o `/compact` real use [`summarize_manual_for_conversation`], que monta o
/// prefixo normal sozinho (snapshot/anchors/surface/plano) sem duplicar lógica.
#[allow(dead_code)] // helper de baixo nível; o comando usa o de alto nível
pub async fn summarize_manual(
    deps: &HarnessDeps,
    request: ManualSummaryRequest<'_>,
) -> anyhow::Result<ManualSummaryOutcome> {
    if request.cut == 0 || request.cut >= request.history.len() {
        anyhow::bail!("corte de compactação inválido: {}", request.cut);
    }
    let provider = deps
        .catalog
        .provider(request.provider_id)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("provedor desconhecido: {}", request.provider_id))?;
    let model = resolve_model(deps, &provider, request.model_id).ok_or_else(|| {
        anyhow::anyhow!(
            "modelo `{}` indisponível no provedor `{}`",
            request.model_id,
            provider.id
        )
    })?;
    let credential = resolve_credential(deps, &provider)
        .await
        .map_err(|error| anyhow::anyhow!("credencial indisponível: {error}"))?;
    let protocols = resolve_protocols(&provider, &model)?;
    let system_prompt_hash = stable_hash(request.system_prompt);

    let completion = CompletionRequest {
        config: provider_config(&provider, &model, &credential, &request.conversation.id),
        protocols,
        history: Vec::new(),
        system_prompt: request.system_prompt.to_string(),
        tools: request.tools.to_vec(),
        reasoning: crate::providers::ReasoningRequest::Auto,
        max_output_tokens: Some(request.max_output_tokens.clamp(256, 4_096)),
        temperature: None,
        cancel: CancellationToken::new(),
        cache_plan: request.cache_plan.clone(),
    };
    finish_manual_summary(
        deps,
        completion,
        request.history,
        request.cut,
        u32::try_from(request.cut).unwrap_or(u32::MAX),
        system_prompt_hash,
    )
    .await
}

/// Helper de **alto nível** do `/compact` manual: monta o prefixo normal da
/// conversa (snapshot do Code com a mesma `snapshot_key`, tools, histórico com
/// replay/surface/resumo aplicado, `cache_plan` do request normal) e resume o
/// trecho antigo reusando esse prefixo no provider.
///
/// - `Ok(None)` quando não há snapshot/histórico suficiente (curto demais ou
///   corte inválido): o comando pode manter o fallback/erro, nada é persistido;
/// - `Ok(Some(outcome))`: o comando grava `session_summaries` (`to_seq =
///   covered`), emite evento e aplica `[resumo]+cauda` (`cut` do histórico).
#[allow(dead_code)] // consumido pelo /compact manual (task-29, commands/code.rs)
pub async fn summarize_manual_for_conversation(
    deps: &HarnessDeps,
    conversation: &crate::domain::Conversation,
    settings: &crate::domain::Settings,
) -> anyhow::Result<Option<ManualSummaryOutcome>> {
    let provider = deps
        .catalog
        .provider(&conversation.provider_id)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("provedor desconhecido: {}", conversation.provider_id))?;
    let model = resolve_model(deps, &provider, &conversation.model_id).ok_or_else(|| {
        anyhow::anyhow!(
            "modelo `{}` indisponível no provedor `{}`",
            conversation.model_id,
            provider.id
        )
    })?;
    let credential = resolve_credential(deps, &provider)
        .await
        .map_err(|error| anyhow::anyhow!("credencial indisponível: {error}"))?;
    let protocols = resolve_protocols(&provider, &model)?;
    // Mesma configuração de um turno Code normal (gates do snapshot).
    let mut options = crate::domain::TurnOptions::default();
    let agent = if conversation.mode == crate::domain::CONVERSATION_MODE_AGENT {
        conversation
            .agent_id
            .as_deref()
            .and_then(|id| deps.db.get_agent(id).ok().flatten())
    } else {
        None
    };
    if let Some(agent) = agent.as_ref() {
        options.allowed_tools = agent.capabilities.tools.clone();
        options.allowed_skills = agent.capabilities.skills.clone();
        options.allowed_mcp_servers = agent.capabilities.mcp_servers.clone();
        options.agent_memory = agent.memory_enabled;
        options.agent_id = Some(agent.id.clone());
    }
    let ctx = crate::harness::code::context::build(&deps.db, conversation).await;
    let mcp_tools: Vec<_> = deps
        .mcp
        .as_ref()
        .map(|mcp| mcp.cached_tools())
        .unwrap_or_default()
        .into_iter()
        .filter(|tool| {
            agent
                .as_ref()
                .map_or(true, |agent| agent.capabilities.allows_mcp_server(&tool.server))
        })
        .collect();
    if let Some(agent) = agent.as_ref() {
        options.allowed_tools = Some(crate::harness::code_agent_allowed_tools(agent, &mcp_tools));
    }
    let mut tool_definitions =
        code_tool_definitions_with_mcp(&ctx, settings, options.delegation_depth, &mcp_tools);
    tool_definitions.retain(|tool| crate::tools::tool_allowed(&options, &tool.name));
    if agent
        .as_ref()
        .is_some_and(|agent| agent.memory_enabled)
        && crate::tools::tool_allowed(&options, "memory")
        && !tool_definitions.iter().any(|tool| tool.name == "memory")
    {
        tool_definitions.push(crate::tools::memory::definition());
    }
    if agent
        .as_ref()
        .is_some_and(|agent| agent.capabilities.delegation)
    {
        for definition in crate::tools::tasks::definitions() {
            if crate::tools::tool_allowed(&options, &definition.name)
                && !tool_definitions.iter().any(|tool| tool.name == definition.name)
            {
                tool_definitions.push(definition);
            }
        }
    }
    if agent.as_ref().is_some_and(|agent| {
        agent.capabilities.computer_use
            || agent.capabilities.screen_capture
            || agent.capabilities.browser_use
    }) {
        let read_only = ["computer_screenshot", "computer_windows", "computer_ui_tree"];
        for definition in crate::tools::code::computer::definitions() {
            let allowed_by_capability = agent.as_ref().is_some_and(|agent| {
                if definition.name == "browser_open" {
                    agent.capabilities.browser_use
                } else {
                    agent.capabilities.computer_use
                        || read_only.contains(&definition.name.as_str())
                }
            });
            if allowed_by_capability
                && crate::tools::tool_allowed(&options, &definition.name)
                && !tool_definitions.iter().any(|tool| tool.name == definition.name)
            {
                tool_definitions.push(definition);
            }
        }
    }
    let mcp_prompt_section = mcp_tools_prompt_section(&mcp_tools, options.delegation_depth);
    let mut tool_prompts = super::code_tool_prompts(&ctx, settings, options.delegation_depth);
    tool_prompts.retain(|prompt| crate::tools::tool_allowed(&options, prompt.name));
    let snapshot = code_prompt_snapshot(
        &deps.db,
        conversation,
        &provider,
        &model,
        &ctx,
        settings,
        &options,
        &tool_definitions,
        &tool_prompts,
        &mcp_prompt_section,
        agent.as_ref(),
    );

    // Histórico normal do perfil Code (resumo persistido + superfície + replay).
    let messages = deps.db.list_messages(&conversation.id)?;
    let stored_summary = apply_stored_summary(&deps.db, &conversation.id, &messages);
    let surface_items = load_surface_items(&deps.db, &conversation.id);
    let images = supports_images(&model);
    let (history, anchors) = match stored_summary {
        Some((summary, message_cut)) => {
            let (tail, tail_anchors) = build_history(
                deps,
                &messages[message_cut.min(messages.len())..],
                // Não há placeholder de assistant num /compact manual.
                "",
                &provider.id,
                settings,
                &model,
                images,
                &surface_items,
                message_cut.saturating_add(1),
            );
            let mut compacted = vec![summary_message(&summary)];
            compacted.extend(tail);
            let mut anchors = vec![0];
            anchors.extend(tail_anchors);
            (compacted, anchors)
        }
        None => build_history(
            deps,
            &messages,
            "",
            &provider.id,
            settings,
            &model,
            images,
            &surface_items,
            1,
        ),
    };
    let Some(cut) =
        cut_index(&history).and_then(|candidate| align_cut(&history, &anchors, candidate))
    else {
        eprintln!("lumina: /compact manual sem histórico suficiente para resumir");
        return Ok(None);
    };
    let covered_ordinal = anchors.get(cut).copied().unwrap_or(0);
    let covered = covered_ordinal.saturating_sub(1);
    if covered == 0 || covered >= messages.len() {
        eprintln!("lumina: /compact manual com fronteira inválida ({covered})");
        return Ok(None);
    }

    let mut completion = CompletionRequest {
        config: provider_config(&provider, &model, &credential, &conversation.id),
        protocols: protocols.clone(),
        history: Vec::new(),
        system_prompt: snapshot.system_prompt.clone(),
        tools: snapshot.tool_definitions.clone(),
        reasoning: crate::providers::ReasoningRequest::Auto,
        max_output_tokens: Some(model.max_output.clamp(1_024, 32_768)),
        temperature: None,
        cancel: CancellationToken::new(),
        cache_plan: None,
    };
    completion.cache_plan =
        cache_plan_for(&provider, &model, &protocols, &completion, &settings.cache);
    finish_manual_summary(
        deps,
        completion,
        &history,
        cut,
        u32::try_from(covered).unwrap_or(u32::MAX),
        snapshot.stable_hash,
    )
    .await
    .map(Some)
}

/// Persiste o fato de compactação para a projeção do medidor
/// (`context/compacted` → [`session::compacted_messages`]). O evento
/// `TurnEvent::Compacted` para a UI é emitido pelo chamador.
pub fn record_compaction(
    db: &Db,
    conversation_id: &str,
    turn_id: &str,
    covered: u32,
    tokens_freed: u32,
) -> anyhow::Result<()> {
    session::append(
        db,
        conversation_id,
        Some(turn_id),
        session::KIND_CONTEXT_COMPACTED,
        &serde_json::json!({ "messages": covered, "tokensFreed": tokens_freed }),
    )
}

/// Aplica um resumo persistido ao histórico reconstruído no início do turno.
///
/// `to_seq` é a contagem de **mensagens** cobertas: o índice da primeira
/// mensagem mantida em `messages` (D15 corrigido). As mensagens cobertas não
/// entram no histórico do modelo (o resumo entra no lugar delas).
pub fn apply_stored_summary(
    db: &Db,
    conversation_id: &str,
    messages: &[crate::domain::ChatMessage],
) -> Option<(String, usize)> {
    let summary = db.latest_session_summary(conversation_id).ok().flatten()?;
    let cut = usize::try_from(summary.to_seq).ok()?;
    if cut == 0 || cut >= messages.len() {
        // Sem mensagens novas além do resumo: nada a ganhar (ou o histórico foi
        // truncado abaixo do ponto coberto).
        return None;
    }
    Some((summary.content, cut))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(role: HistoryRole, text: &str) -> HistoryMessage {
        HistoryMessage {
            role,
            ..HistoryMessage::user(text.to_string())
        }
    }

    fn history() -> Vec<HistoryMessage> {
        let mut history = Vec::new();
        for index in 0..6 {
            history.push(message(
                HistoryRole::User,
                &format!("pedido {index} {}", "x".repeat(400)),
            ));
            history.push(HistoryMessage::assistant(format!(
                "resposta {index} {}",
                "y".repeat(400)
            )));
        }
        history
    }

    fn anchors(history_len: usize) -> Vec<usize> {
        // 1-based ordinal da mensagem; pares user/assistant por índice.
        (0..history_len).map(|index| index / 2 + 1).collect()
    }

    #[test]
    fn cut_lands_on_a_user_boundary_and_keeps_the_tail() {
        let history = history();
        let cut = cut_index(&history).expect("corte");
        assert_eq!(history[cut].role, HistoryRole::User);
        assert!(cut > 0);
        assert!(cut < history.len());
    }

    #[test]
    fn short_history_is_not_compacted() {
        let history = history()[..4].to_vec();
        assert!(cut_index(&history).is_none());
    }

    #[test]
    fn align_cut_skips_surface_items_and_assistant_groups() {
        let mut history = history();
        let mut anchors = anchors(history.len());
        // Insere um surface_item (user marcado) depois do 3º elemento.
        history.insert(
            3,
            message(HistoryRole::User, "<contexto-da-sessao kind=\"runtime\">x"),
        );
        anchors.insert(3, 0);
        let cut = align_cut(&history, &anchors, 3).expect("fronteira");
        assert!(anchors[cut] > 0);
        assert_eq!(history[cut].role, HistoryRole::User);
        assert!(!history[cut].text.starts_with("<contexto-da-sessao"));
        assert!(cut == 0 || anchors[cut - 1] != anchors[cut]);
    }

    #[test]
    fn compacted_history_starts_with_the_summary() {
        let history = history();
        let cut = 4;
        let next = compacted_history("resumo", &history, cut);
        assert_eq!(next.len(), history.len() - cut + 1);
        assert!(next[0]
            .text
            .contains("[Summary of the previous conversation"));
        assert_eq!(next[1].text, history[cut].text);
    }

    #[test]
    fn transcript_marks_roles_and_caps_messages() {
        let history = history();
        let text = transcript(&history, 2);
        assert!(text.contains("User: pedido 0"));
        assert!(text.contains("Assistant: resposta 0"));
        assert!(text.chars().count() <= 2 * (TRANSCRIPT_MESSAGE_CAP + 32) + 64);
    }

    #[test]
    fn summary_instruction_mentions_the_structure_and_transcript() {
        let instruction = summary_instruction("User: oi");
        assert!(instruction.contains("## Critical context"));
        assert!(instruction.contains("Transcript:"));
        assert!(instruction.contains("User: oi"));
    }

    #[test]
    fn threshold_matches_the_window_ratio() {
        assert!(over_threshold(80_000, 100_000));
        assert!(!over_threshold(10_000, 100_000));
        assert!(!over_threshold(1, 0));
    }

    #[test]
    fn compaction_event_feeds_the_meter_projection_without_poisoning_stats() {
        let db = Db::open_in_memory().expect("db");
        assert_eq!(session::compacted_messages(&db, "conv-1"), 0);
        record_compaction(&db, "conv-1", "turn-1", 14, 900).expect("registrar compactação");
        assert_eq!(session::compacted_messages(&db, "conv-1"), 14);
        // O fold do medidor não trata o evento de compactação como `context/stats`.
        assert!(session::context_stats(&db, "conv-1").is_none());
    }

    #[test]
    fn prune_tool_result_keeps_head_tail_and_is_idempotent() {
        let long = format!(
            "{}{}{}",
            "a".repeat(5_000),
            "m".repeat(5_000),
            "z".repeat(5_000)
        );
        let pruned = prune_tool_result(&long).expect("tool result grande é podado");
        assert!(pruned.starts_with(&"a".repeat(PRUNED_HEAD_CHARS)));
        assert!(pruned.ends_with(&"z".repeat(PRUNED_TAIL_CHARS)));
        assert!(pruned.contains(PRUNED_MARKER));
        assert!(pruned.chars().count() < long.chars().count());
        // Idempotente: podar de novo não muda nada.
        assert_eq!(prune_tool_result(&pruned), None);
        // Curto fica intacto.
        assert_eq!(prune_tool_result("resultado curto"), None);
    }
}
