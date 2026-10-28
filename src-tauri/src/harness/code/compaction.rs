//! Compactação de contexto do perfil Code (`HARNESS.md` §10.3).
//!
//! Quando o histórico estimado passa do gatilho, o trecho antigo é resumido por
//! uma chamada auxiliar (não-streaming) e substituído no histórico do modelo por
//! uma única mensagem de resumo. O transcript real do usuário permanece no
//! banco; a UI mostra um card "Contexto compactado".
//!
//! O resumo é persistido em `session_summaries` (`from_seq = 1`,
//! `to_seq = nº de mensagens cobertas`) e aplicado no início dos próximos turnos.

use std::sync::Arc;

use tokio_util::sync::CancellationToken;

use crate::db::Db;
use crate::events::TurnEvent;
use crate::harness::{batch, EventEmitter, HarnessDeps};
use crate::providers::{HistoryMessage, HistoryRole};

use super::session;

/// Gatilho: fração da janela em que a compactação automática roda.
pub const TRIGGER_RATIO: f32 = 0.75;
/// Mantém ~30% do fim do histórico intacto (turns recentes).
const KEEP_RATIO: f32 = 0.3;
/// Nunca compacta um histórico curto.
pub const MIN_HISTORY_MESSAGES: usize = 6;
/// Cap de caracteres por mensagem no transcript que vai ao resumidor.
const TRANSCRIPT_MESSAGE_CAP: usize = 2_000;

/// Tokens estimados a partir dos caracteres (heurística `chars/4`).
pub fn estimate_tokens(chars: usize) -> u32 {
    ((chars / 4) as u32).max(1)
}

/// O histórico passou do gatilho de compactação?
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

/// Texto compacto do trecho a resumir.
pub fn transcript(history: &[HistoryMessage], cut: usize) -> String {
    let mut out = String::new();
    for message in &history[..cut.min(history.len())] {
        let role = match message.role {
            HistoryRole::User => "Usuário",
            HistoryRole::Assistant => "Assistente",
            HistoryRole::Tool => "Ferramenta",
            HistoryRole::System => "Sistema",
        };
        let text: String = message
            .text
            .chars()
            .take(TRANSCRIPT_MESSAGE_CAP)
            .collect();
        if text.trim().is_empty() {
            continue;
        }
        out.push_str(&format!("{role}: {text}\n\n"));
        if out.chars().count() > 24_000 {
            out.push_str("…[transcript truncado]\n");
            break;
        }
    }
    out
}

/// Prompt do resumidor (template de 8 seções adaptado do DSH).
pub fn summary_system_prompt() -> &'static str {
    "Você resume conversas de engenharia de software para continuar o trabalho \
     em um novo contexto. Escreva em português do Brasil, em Markdown, sem \
     opinião e sem mencionar que houve compactação. Preserve caminhos de arquivo, \
     comandos, nomes de símbolos e mensagens de erro literais. Estrutura fixa:\n\
     ## Pedido principal\n## Decisões e arquitetura\n## Arquivos e código\n\
     ## Erros e correções\n## Jobs/processos pendentes\n## Trabalho em andamento\n\
     ## Próximo passo\n## Contexto crítico\n\
     Seja específico e curto; não invente fatos que não estão no transcript."
}

/// Mensagem de resumo que substitui o trecho compactado no histórico.
pub fn summary_message(summary: &str) -> HistoryMessage {
    HistoryMessage::user(format!(
        "[Resumo da conversa anterior — gerado automaticamente; continue o trabalho a partir dele]\n{summary}"
    ))
}

/// Histórico compactado: resumo + trecho recente.
pub fn compacted_history(summary: &str, history: &[HistoryMessage], cut: usize) -> Vec<HistoryMessage> {
    let mut next = Vec::with_capacity(history.len() - cut + 1);
    next.push(summary_message(summary));
    next.extend(history[cut.min(history.len())..].iter().cloned());
    next
}

/// Resultado de uma compactação bem-sucedida.
pub struct CompactionOutcome {
    pub tokens_freed: u32,
    pub summary_chars: usize,
}

/// Roda a compactação automática se o histórico estiver acima do gatilho.
///
/// Falhas são engolidas (com log): compactar é otimização — o turno continua com
/// o histórico original e a próxima iteração tenta de novo.
#[allow(clippy::too_many_arguments)]
pub async fn maybe_compact(
    deps: &HarnessDeps,
    provider_id: &str,
    model_id: &str,
    conversation_id: &str,
    turn_id: &str,
    covered_messages: u32,
    history: &mut Vec<HistoryMessage>,
    system_prompt: &str,
    window: u32,
    output_cap: u32,
    emit: &Arc<dyn EventEmitter>,
    cancel: &CancellationToken,
) -> Option<CompactionOutcome> {
    if cancel.is_cancelled() {
        return None;
    }
    let used = estimate_tokens(history_chars(history) + system_prompt.chars().count());
    // Deixa headroom para a resposta (output cap) além do gatilho.
    let usable = window.saturating_sub(output_cap.min(window / 2));
    let trigger = ((usable as f32) * TRIGGER_RATIO) as u32;
    if used < trigger {
        return None;
    }
    let cut = cut_index(history)?;
    let transcript = transcript(history, cut);
    if transcript.trim().len() < 500 {
        return None;
    }
    let user_prompt = format!("Resuma o transcript abaixo:\n\n{transcript}");
    let request = batch::BatchRequest {
        provider_id,
        model_id,
        system_prompt: summary_system_prompt(),
        user_text: &user_prompt,
        max_output_tokens: 1_200,
        temperature: None,
    };
    let summary = tokio::select! {
        _ = cancel.cancelled() => return None,
        result = tokio::time::timeout(std::time::Duration::from_secs(90), batch::complete_text(deps, request)) => {
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
    let before = estimate_tokens(history_chars(history));
    *history = compacted_history(&summary, history, cut);
    let after = estimate_tokens(history_chars(history));
    let tokens_freed = before.saturating_sub(after);
    let covered = covered_messages.max(1);
    if let Err(error) = deps
        .db
        .insert_session_summary(conversation_id, 1, i64::from(covered), &summary, Some(before))
    {
        eprintln!("lumina: falha ao persistir resumo de contexto: {error:#}");
    }
    // Evento próprio de compactação (`context/compacted`): o fold do medidor lê
    // só o total de mensagens cobertas daqui — reciclar `context/stats` com um
    // payload parcial envenenava a projeção do `ContextStats`.
    let _ = record_compaction(&deps.db, conversation_id, turn_id, covered, tokens_freed);
    emit.emit(TurnEvent::Compacted {
        messages: covered,
        tokens_freed: tokens_freed,
    });
    Some(CompactionOutcome {
        tokens_freed,
        summary_chars: summary.chars().count(),
    })
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
/// `covered` é o `to_seq` do último resumo; as mensagens cobertas não entram no
/// histórico do modelo (o resumo entra no lugar delas).
pub fn apply_stored_summary(
    db: &Db,
    conversation_id: &str,
    messages: &[crate::domain::ChatMessage],
) -> Option<(String, usize)> {
    let summary = db.latest_session_summary(conversation_id).ok().flatten()?;
    let cut = usize::try_from(summary.to_seq).ok()?;
    if cut < 2 || cut >= messages.len() {
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
    fn compacted_history_starts_with_the_summary() {
        let history = history();
        let cut = 4;
        let next = compacted_history("resumo", &history, cut);
        assert_eq!(next.len(), history.len() - cut + 1);
        assert!(next[0].text.contains("[Resumo da conversa anterior"));
        assert_eq!(next[1].text, history[cut].text);
    }

    #[test]
    fn transcript_marks_roles_and_caps_messages() {
        let history = history();
        let text = transcript(&history, 2);
        assert!(text.contains("Usuário: pedido 0"));
        assert!(text.contains("Assistente: resposta 0"));
        assert!(text.chars().count() <= 2 * (TRANSCRIPT_MESSAGE_CAP + 32) + 64);
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
}
