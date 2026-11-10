//! Decisões de render **congeladas** por mensagem (`render_decisions`, F6/B3).
//!
//! Imagem/anexo e o modo de replay de uma mensagem antiga não podem ser
//! recalculados a cada turno: o budget de imagens é compartilhado entre o
//! histórico e, se a decisão "imagem vs texto" mudasse, o prefixo cacheável
//! quebraria (D7). A primeira vez que uma mensagem entra no histórico decide e
//! grava a decisão; turnos/restarts seguintes **reusam** a decisão. Mensagens
//! novas continuam podendo consumir o budget restante.
//!
//! Decisões são gravadas em `render_decisions` (owner: `db`) com `kind`:
//! - `image`: `{ "include": bool }` — imagem inline ou texto de fallback;
//! - `attachment`: `{ "include": bool }` — anexos incluídos ou ocultos;
//! - `replay`: `{ "mode": "steps"|"raw"|"neutral", "providerId", "modelId" }`.
//!
//! O `digest` da decisão é o hash do conteúdo relevante da mensagem; se o
//! conteúdo mudar (não deveria: mensagens são imutáveis após o turno), a
//! decisão é refeita.

use std::collections::HashSet;

use serde_json::json;

use crate::db::Db;
use crate::domain::ChatMessage;
use crate::harness::cache::snapshot::stable_hash;

/// Kind da decisão de imagem inline vs texto.
pub const KIND_IMAGE: &str = "image";
/// Kind da decisão de incluir anexos da mensagem.
pub const KIND_ATTACHMENT: &str = "attachment";
/// Kind da decisão de modo de replay do provider (`provider_state`).
pub const KIND_REPLAY: &str = "replay";

/// Como a mensagem assistant é reconstruída no histórico.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplayMode {
    /// Replay passo-a-passo (envelope `provider_state` v2) — payload verbatim.
    Steps,
    /// Estado legado bruto (payload único) sem tool calls.
    Raw,
    /// Fallback neutro (texto + tool calls + tool results).
    Neutral,
}

impl ReplayMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Steps => "steps",
            Self::Raw => "raw",
            Self::Neutral => "neutral",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "steps" => Some(Self::Steps),
            "raw" => Some(Self::Raw),
            "neutral" => Some(Self::Neutral),
            _ => None,
        }
    }
}

fn attachment_digest(message: &ChatMessage) -> String {
    let mut canonical = String::new();
    for attachment in &message.attachments {
        canonical.push_str(&format!(
            "{}|{}|{}|{}|{};",
            attachment.id, attachment.kind, attachment.mime_type, attachment.size, attachment.name
        ));
    }
    stable_hash(&canonical)
}

fn image_cost(message: &ChatMessage) -> usize {
    message
        .attachments
        .iter()
        .filter(|attachment| attachment.kind == "image")
        .map(|attachment| {
            let bytes = usize::try_from(attachment.size.max(0)).unwrap_or(usize::MAX);
            bytes.saturating_mul(4) / 3 + 8
        })
        .sum()
}

fn has_image_attachment(message: &ChatMessage) -> bool {
    message
        .attachments
        .iter()
        .any(|attachment| attachment.kind == "image")
}

fn replay_digest(message: &ChatMessage) -> String {
    let state = message
        .provider_state
        .as_ref()
        .map(|state| state.to_string())
        .unwrap_or_default();
    let calls = message
        .tool_calls
        .iter()
        .map(|call| format!("{}:{}", call.id, call.name))
        .collect::<Vec<_>>()
        .join(";");
    stable_hash(&format!("{state}\u{1f}{calls}"))
}

fn load_decision(db: &Db, message_id: &str, kind: &str) -> Option<serde_json::Value> {
    match db.get_render_decision(message_id, kind) {
        Ok(Some(decision)) => serde_json::from_str(&decision.payload).ok(),
        Ok(None) => None,
        Err(error) => {
            eprintln!("zylara: falha ao ler decisão de render `{kind}`: {error:#}");
            None
        }
    }
}

fn persist_decision(
    db: &Db,
    message_id: &str,
    kind: &str,
    digest: &str,
    payload: serde_json::Value,
) {
    let mut payload = payload;
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "digest".to_string(),
            serde_json::Value::String(digest.to_string()),
        );
    }
    let decision = crate::db::RenderDecisionRecord {
        message_id: message_id.to_string(),
        kind: kind.to_string(),
        digest: digest.to_string(),
        payload: payload.to_string(),
        created_at: crate::domain::now_ms(),
    };
    if let Err(error) = db.upsert_render_decision(&decision) {
        eprintln!("zylara: falha ao congelar decisão de render `{kind}`: {error:#}");
    }
}

/// Decisão congelada de incluir a mensagem (com imagens inline) no histórico.
///
/// Mensagens com decisão válida mantêm o que foi decidido (uma mensagem antiga
/// nunca muda de imagem para texto). Mensagens novas consomem o budget
/// restante, mais novas primeiro, e têm a decisão gravada na primeira vez.
pub fn frozen_image_inclusions(
    db: &Db,
    messages: &[ChatMessage],
    supports_images: bool,
    budget: usize,
) -> HashSet<String> {
    let mut included = HashSet::new();
    if !supports_images {
        return included;
    }
    let mut remaining = budget;
    let mut undecided: Vec<&ChatMessage> = Vec::new();
    // 1) Decisões já congeladas reservam o budget (ordem de exibição).
    for message in messages {
        if message.role != crate::domain::MessageRole::User || !has_image_attachment(message) {
            continue;
        }
        let digest = attachment_digest(message);
        match load_decision(db, &message.id, KIND_IMAGE) {
            Some(payload)
                if payload.get("digest").and_then(|value| value.as_str()) == Some(&digest) =>
            {
                let include = payload
                    .get("include")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
                if include {
                    included.insert(message.id.clone());
                    remaining = remaining.saturating_sub(image_cost(message));
                }
            }
            _ => undecided.push(message),
        }
    }
    // 2) Novas mensagens: mais novas primeiro, consumindo o budget restante.
    for message in undecided.into_iter().rev() {
        let cost = image_cost(message);
        let include = cost > 0 && cost <= remaining;
        if include {
            included.insert(message.id.clone());
            remaining = remaining.saturating_sub(cost);
        }
        persist_decision(
            db,
            &message.id,
            KIND_IMAGE,
            &attachment_digest(message),
            json!({ "include": include }),
        );
    }
    included
}

/// Decisão congelada de incluir os anexos da mensagem (`include_attachments`).
pub fn frozen_include_attachments(db: &Db, message: &ChatMessage, current_setting: bool) -> bool {
    if message.attachments.is_empty() {
        return current_setting;
    }
    let digest = attachment_digest(message);
    if let Some(payload) = load_decision(db, &message.id, KIND_ATTACHMENT) {
        if payload.get("digest").and_then(|value| value.as_str()) == Some(&digest) {
            return payload
                .get("include")
                .and_then(|value| value.as_bool())
                .unwrap_or(current_setting);
        }
    }
    persist_decision(
        db,
        &message.id,
        KIND_ATTACHMENT,
        &digest,
        json!({ "include": current_setting }),
    );
    current_setting
}

/// Decisão congelada do modo de replay do assistant.
///
/// O modo só é reusado quando o provider/modelo continuam os mesmos da decisão;
/// uma troca de modelo é um epoch novo e cai no fallback neutro (o payload
/// verbatim de outro protocolo é inválido). A decisão persistida **não** é
/// reescrita por isso — voltar ao modelo original restaura o mesmo replay.
pub fn frozen_replay_mode(
    db: &Db,
    message: &ChatMessage,
    provider_id: &str,
    model_id: &str,
) -> ReplayMode {
    let same_model = message.provider_id.as_deref() == Some(provider_id)
        && message.model_id.as_deref() == Some(model_id);
    let has_steps = message
        .provider_state
        .as_ref()
        .and_then(crate::harness::parse_provider_state_v2)
        .is_some();
    let suggested = if !same_model {
        ReplayMode::Neutral
    } else if has_steps {
        ReplayMode::Steps
    } else if !message.tool_calls.is_empty() {
        ReplayMode::Neutral
    } else if message.provider_state.is_some() {
        ReplayMode::Raw
    } else {
        ReplayMode::Neutral
    };
    let digest = replay_digest(message);
    if let Some(payload) = load_decision(db, &message.id, KIND_REPLAY) {
        let same_digest = payload.get("digest").and_then(|value| value.as_str()) == Some(&digest);
        let same_route = payload.get("providerId").and_then(|value| value.as_str())
            == Some(provider_id)
            && payload.get("modelId").and_then(|value| value.as_str()) == Some(model_id);
        if same_digest {
            if !same_route {
                return ReplayMode::Neutral;
            }
            if let Some(mode) = payload
                .get("mode")
                .and_then(|value| value.as_str())
                .and_then(ReplayMode::parse)
            {
                return mode;
            }
        }
    }
    persist_decision(
        db,
        &message.id,
        KIND_REPLAY,
        &digest,
        json!({
            "mode": suggested.as_str(),
            "providerId": provider_id,
            "modelId": model_id,
        }),
    );
    suggested
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::domain::{AttachmentInfo, ChatMessage, ToolCallRecord};

    fn image_message(id: &str, size_mb: i64) -> ChatMessage {
        let mut message = ChatMessage::user("conv", "veja");
        message.id = id.to_string();
        message.attachments = vec![AttachmentInfo {
            id: format!("att-{id}"),
            name: "foto.png".to_string(),
            mime_type: "image/png".to_string(),
            size: size_mb * 1_000_000,
            kind: "image".to_string(),
            ..Default::default()
        }];
        message
    }

    #[test]
    fn frozen_image_budget_never_flips_an_old_decision() {
        let db = Db::open_in_memory().expect("db");
        let budget = 10_000_000usize;
        let old = image_message("old", 6);
        let new = image_message("new", 6);
        // Turno 1: a mensagem nova consome o budget primeiro; a antiga não cabe
        // no restante e é congelada como texto.
        let first = frozen_image_inclusions(&db, &[old.clone(), new.clone()], true, budget);
        assert!(first.contains("new"));
        assert!(!first.contains("old"));
        // Turno 2: chega uma mensagem ainda mais nova (7 MB). Decisões antigas
        // são congeladas; a nova não cabe no restante e fica em texto.
        let newer = image_message("newer", 7);
        let second = frozen_image_inclusions(&db, &[old.clone(), new.clone(), newer], true, budget);
        assert!(second.contains("new"));
        assert!(!second.contains("old"), "mensagem antiga nunca vira imagem");
        assert!(!second.contains("newer"));
        // O mesmo vale após "restart" (decisões vêm do banco).
        let third = frozen_image_inclusions(
            &db,
            &[old.clone(), new.clone(), image_message("newer", 7)],
            true,
            budget,
        );
        assert_eq!(second, third);
        // Fora do suporte a imagens: nada inline (sem congelar decisões).
        assert!(frozen_image_inclusions(&db, &[old], false, budget).is_empty());
    }

    #[test]
    fn frozen_attachment_include_survives_setting_change() {
        let db = Db::open_in_memory().expect("db");
        let mut message = ChatMessage::user("conv", "veja o doc");
        message.id = "m-att".to_string();
        message.attachments = vec![AttachmentInfo {
            id: "att-1".to_string(),
            name: "relatorio.docx".to_string(),
            mime_type: "application/docx".to_string(),
            size: 10,
            kind: "document".to_string(),
            ..Default::default()
        }];
        assert!(frozen_include_attachments(&db, &message, true));
        // Setting desligado depois: a mensagem antiga continua congelada.
        assert!(frozen_include_attachments(&db, &message, false));
        // Mensagem nova nasce com o setting atual.
        let mut newer = ChatMessage::user("conv", "outro");
        newer.id = "m-novo".to_string();
        newer.attachments = message.attachments.clone();
        assert!(!frozen_include_attachments(&db, &newer, false));
    }

    #[test]
    fn frozen_replay_mode_is_stable_and_falls_back_on_model_change() {
        let db = Db::open_in_memory().expect("db");
        let mut message = ChatMessage::assistant("conv");
        message.id = "a-1".to_string();
        message.provider_id = Some("p1".to_string());
        message.model_id = Some("m1".to_string());
        message.status = crate::domain::MessageStatus::Complete;
        message.tool_calls = vec![ToolCallRecord::running("call-1", "read_file")];
        assert_eq!(
            frozen_replay_mode(&db, &message, "p1", "m1"),
            ReplayMode::Neutral
        );
        // Mesma rota: decisão congelada reusada (não reescreve).
        assert_eq!(
            frozen_replay_mode(&db, &message, "p1", "m1"),
            ReplayMode::Neutral
        );
        // Troca de modelo: fallback neutro; voltar ao original restaura o modo.
        assert_eq!(
            frozen_replay_mode(&db, &message, "p2", "m2"),
            ReplayMode::Neutral
        );
        assert_eq!(
            frozen_replay_mode(&db, &message, "p1", "m1"),
            ReplayMode::Neutral
        );

        // Envelope v2 → Steps congelado.
        let mut v2 = ChatMessage::assistant("conv");
        v2.id = "a-2".to_string();
        v2.provider_id = Some("p1".to_string());
        v2.model_id = Some("m1".to_string());
        v2.status = crate::domain::MessageStatus::Complete;
        v2.provider_state = Some(serde_json::json!({
            "version": 2,
            "steps": [{ "state": {"output": []}, "text": "ok", "toolCallIds": [] }]
        }));
        assert_eq!(frozen_replay_mode(&db, &v2, "p1", "m1"), ReplayMode::Steps);
        assert_eq!(frozen_replay_mode(&db, &v2, "p1", "m1"), ReplayMode::Steps);
    }

    /// Dois turnos com o budget de imagens estourando + restart: a decisão da
    /// mensagem antiga não muda (render determinístico entre turnos/restart) e
    /// as novas mensagens consomem o budget restante. Como o render (imagem vs
    /// texto) da mensagem antiga é idêntico, o prefixo cacheável não quebra.
    #[test]
    fn image_render_is_deterministic_across_turns_and_restart() {
        let path =
            std::env::temp_dir().join(format!("zylara-render-decisions-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let budget = 10_000_000usize;
        let old = image_message("old", 6);
        let current = image_message("cur", 6);

        let (first_signature, old_decision_created_at) = {
            let db = Db::open(&path).expect("db turno 1");
            let first = frozen_image_inclusions(&db, &[old.clone(), current.clone()], true, budget);
            let decision = db
                .get_render_decision("old", KIND_IMAGE)
                .expect("decisão")
                .expect("decisão da mensagem antiga");
            (first, decision.created_at)
        };
        // Turno 2: chega uma mensagem nova (6 MB); a antiga continua congelada.
        let (second_signature, second_created_at) = {
            let db = Db::open(&path).expect("db turno 2");
            let newer = image_message("newer", 6);
            let second =
                frozen_image_inclusions(&db, &[old.clone(), current.clone(), newer], true, budget);
            let decision = db
                .get_render_decision("old", KIND_IMAGE)
                .expect("decisão")
                .expect("decisão da mensagem antiga");
            (second, decision.created_at)
        };
        // Restart: reabre o DB e reusa exatamente as mesmas decisões.
        let third = {
            let db = Db::open(&path).expect("db restart");
            frozen_image_inclusions(
                &db,
                &[old.clone(), current.clone(), image_message("newer", 6)],
                true,
                budget,
            )
        };
        assert_eq!(
            first_signature, second_signature,
            "decisão de imagem das antigas é congelada entre turnos"
        );
        assert_eq!(second_signature, third, "restart reusa as decisões");
        assert_eq!(
            old_decision_created_at, second_created_at,
            "decisão não é reescrita (render byte-a-byte)"
        );
        assert!(!first_signature.contains("old"));
        // A mensagem ainda mais nova não entra: o budget está esgotado.
        assert!(!third.contains("newer"));
        let _ = std::fs::remove_file(&path);
    }
}
