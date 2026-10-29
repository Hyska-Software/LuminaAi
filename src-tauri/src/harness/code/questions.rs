//! Perguntas estruturadas ao usuário (`ask_user`).
//!
//! Mesmo padrão do seam de aprovação: o pedido é registrado (para a UI), um
//! evento `question_requested` chega à timeline, o usuário responde pelo card e
//! o comando `respond_question` resolve o canal que a tool aguarda.
//!
//! Timeout/cancelamento **não** respondem por aprovação: devolvem
//! `skipped = true` (o modelo segue com o que sabe). Contrato:
//! `docs/goals/code-harness/HARNESS.md` §6.3 e `TOOLS.md` §2.5.

use std::collections::HashMap;

use parking_lot::Mutex;
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use crate::domain::{AskUserAnswer, AskUserRequest, AskUserResponse};
use crate::events::TurnEvent;
use crate::harness::EventEmitter;

struct PendingQuestion {
    request: AskUserRequest,
    sender: oneshot::Sender<AskUserResponse>,
}

/// Registro de perguntas pendentes (compartilhado no `AppState`).
#[derive(Default)]
pub struct QuestionRegistry {
    pending: Mutex<HashMap<String, PendingQuestion>>,
}

impl QuestionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registra o pedido e devolve o receptor que a tool deve aguardar.
    pub fn register_request(&self, request: AskUserRequest) -> oneshot::Receiver<AskUserResponse> {
        let (tx, rx) = oneshot::channel();
        let id = request.id.clone();
        self.pending.lock().insert(
            id,
            PendingQuestion {
                request,
                sender: tx,
            },
        );
        rx
    }

    /// Resolve um pedido pendente (resposta do usuário).
    pub fn resolve(&self, response: AskUserResponse) -> bool {
        let pending = self.pending.lock().remove(&response.request_id);
        match pending {
            Some(entry) => entry.sender.send(response).is_ok(),
            None => false,
        }
    }

    /// Pedidos pendentes (snapshot para `get_code_session_state`).
    pub fn pending_requests(&self) -> Vec<AskUserRequest> {
        let mut requests: Vec<AskUserRequest> = self
            .pending
            .lock()
            .values()
            .map(|entry| entry.request.clone())
            .collect();
        requests.sort_by(|left, right| left.created_at.cmp(&right.created_at));
        requests
    }

    #[allow(dead_code)]
    pub fn has_pending(&self, request_id: &str) -> bool {
        self.pending.lock().contains_key(request_id)
    }

    /// Cancela todos os pedidos de uma sessão (fim do turno Code).
    #[allow(dead_code)]
    pub fn cancel_for_conversation(&self, conversation_id: &str) -> usize {
        let mut pending = self.pending.lock();
        let ids: Vec<String> = pending
            .iter()
            .filter(|(_, entry)| entry.request.conversation_id == conversation_id)
            .map(|(id, _)| id.clone())
            .collect();
        let count = ids.len();
        for id in ids {
            if let Some(entry) = pending.remove(&id) {
                let _ = entry.sender.send(AskUserResponse {
                    request_id: id,
                    answers: Vec::new(),
                    skipped: true,
                });
            }
        }
        count
    }

    #[allow(dead_code)]
    pub fn cancel_all(&self) -> usize {
        let pending: Vec<(String, PendingQuestion)> = self.pending.lock().drain().collect();
        let count = pending.len();
        for (id, entry) in pending {
            let _ = entry.sender.send(AskUserResponse {
                request_id: id,
                answers: Vec::new(),
                skipped: true,
            });
        }
        count
    }
}

/// Pergunta ao usuário de forma interativa: registra, emite
/// `question_requested`, aguarda resposta (ou timeout/cancelamento) e emite
/// `question_resolved`. Nunca pausa o turno além do timeout configurado.
pub async fn request_user_answers(
    registry: &QuestionRegistry,
    emit: Option<std::sync::Arc<dyn EventEmitter>>,
    request: AskUserRequest,
    timeout: std::time::Duration,
    cancel: &CancellationToken,
) -> AskUserResponse {
    let id = request.id.clone();
    let conversation_id = request.conversation_id.clone();
    let receiver = registry.register_request(request.clone());
    if let Some(emit) = &emit {
        emit.emit(TurnEvent::QuestionRequested {
            request: request.clone(),
        });
    }
    let response = tokio::select! {
        biased;
        _ = cancel.cancelled() => AskUserResponse { request_id: id.clone(), answers: Vec::new(), skipped: true },
        result = tokio::time::timeout(timeout, receiver) => match result {
            Ok(Ok(response)) => response,
            Ok(Err(_)) => AskUserResponse { request_id: id.clone(), answers: Vec::new(), skipped: true },
            Err(_) => {
                let _ = registry.resolve(AskUserResponse {
                    request_id: id.clone(),
                    answers: Vec::new(),
                    skipped: true,
                });
                AskUserResponse { request_id: id.clone(), answers: Vec::new(), skipped: true }
            }
        },
    };
    let _ = conversation_id;
    if let Some(emit) = &emit {
        emit.emit(TurnEvent::QuestionResolved {
            request_id: id,
            answers: response.answers.clone(),
            skipped: response.skipped,
        });
    }
    response
}

/// Valida e normaliza as perguntas recebidas da tool (limites do contrato).
pub fn normalize_questions(
    raw: &serde_json::Value,
    conversation_id: &str,
    tool_call_id: &str,
) -> Result<AskUserRequest, String> {
    let questions = raw
        .get("questions")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "ASK_USER_INVALID: `questions` precisa ser uma lista".to_string())?;
    if questions.is_empty() {
        return Err("ASK_USER_INVALID: envie pelo menos uma pergunta".to_string());
    }
    if questions.len() > 4 {
        return Err("ASK_USER_INVALID: no máximo 4 perguntas por chamada".to_string());
    }
    let mut normalized = Vec::with_capacity(questions.len());
    let mut seen_ids = std::collections::HashSet::new();
    for (index, item) in questions.iter().enumerate() {
        let question = item
            .get("question")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "ASK_USER_INVALID: cada pergunta precisa de `question`".to_string())?;
        let id = item
            .get("id")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("q{}", index + 1));
        if !seen_ids.insert(id.clone()) {
            return Err(format!(
                "ASK_USER_INVALID: id de pergunta duplicado: `{id}`"
            ));
        }
        let mut options = Vec::new();
        if let Some(raw_options) = item.get("options").and_then(|value| value.as_array()) {
            for raw_option in raw_options.iter().take(6) {
                let label = raw_option
                    .get("label")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                let Some(label) = label else {
                    continue;
                };
                options.push(crate::domain::AskOption {
                    label: label.to_string(),
                    description: raw_option
                        .get("description")
                        .and_then(|value| value.as_str())
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string),
                });
            }
        }
        normalized.push(crate::domain::AskQuestion {
            id,
            question: question.chars().take(500).collect(),
            header: item
                .get("header")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.chars().take(80).collect()),
            options,
            multi_select: item
                .get("multi_select")
                .or_else(|| item.get("multiSelect"))
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
        });
    }
    Ok(AskUserRequest {
        id: format!("ask-{}", uuid::Uuid::new_v4()),
        conversation_id: conversation_id.to_string(),
        tool_call_id: tool_call_id.to_string(),
        questions: normalized,
        created_at: crate::domain::now_ms(),
    })
}

/// Serializa a resposta para o modelo (texto estável e compacto).
pub fn response_content(response: &AskUserResponse) -> String {
    if response.skipped && response.answers.is_empty() {
        return "O usuário preferiu não responder agora (skipped). Siga com a melhor decisão \
                possível e explique a suposição."
            .to_string();
    }
    let answers: Vec<AskUserAnswer> = response.answers.clone();
    match serde_json::to_string(&serde_json::json!({ "answers": answers })) {
        Ok(json) => format!("Respostas do usuário:\n{json}"),
        Err(_) => "Respostas do usuário: (formato inválido)".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{AskOption, AskQuestion};

    fn request(id: &str) -> AskUserRequest {
        AskUserRequest {
            id: id.to_string(),
            conversation_id: "conv-1".to_string(),
            tool_call_id: "call-1".to_string(),
            questions: vec![AskQuestion {
                id: "db".to_string(),
                question: "Qual banco usar?".to_string(),
                header: Some("Banco".to_string()),
                options: vec![AskOption {
                    label: "SQLite".to_string(),
                    description: None,
                }],
                multi_select: false,
            }],
            created_at: 1,
        }
    }

    #[tokio::test]
    async fn register_and_resolve_roundtrip() {
        let registry = QuestionRegistry::new();
        let rx = registry.register_request(request("ask-1"));
        assert_eq!(registry.pending_requests().len(), 1);
        let answer = AskUserResponse {
            request_id: "ask-1".to_string(),
            answers: vec![AskUserAnswer {
                question_id: "db".to_string(),
                selected: vec!["SQLite".to_string()],
                custom: None,
            }],
            skipped: false,
        };
        assert!(registry.resolve(answer));
        let response = rx.await.expect("resposta");
        assert_eq!(response.answers[0].selected, vec!["SQLite".to_string()]);
        assert!(!registry.has_pending("ask-1"));
    }

    #[tokio::test]
    async fn cancel_for_conversation_marks_skipped() {
        let registry = QuestionRegistry::new();
        let rx = registry.register_request(request("ask-2"));
        assert_eq!(registry.cancel_for_conversation("conv-1"), 1);
        let response = rx.await.expect("resposta");
        assert!(response.skipped);
    }

    #[test]
    fn normalizes_and_validates_questions() {
        let raw = serde_json::json!({
            "questions": [
                {
                    "id": "db",
                    "header": "Banco",
                    "question": "Qual banco devo usar?",
                    "options": [
                        { "label": "SQLite (Recommended)", "description": "Local-first" },
                        { "label": "Postgres" }
                    ],
                    "multi_select": false
                }
            ]
        });
        let request = normalize_questions(&raw, "conv-1", "call-9").expect("válido");
        assert_eq!(request.questions.len(), 1);
        assert_eq!(request.questions[0].options.len(), 2);
        assert_eq!(request.tool_call_id, "call-9");

        let empty = serde_json::json!({ "questions": [] });
        assert!(normalize_questions(&empty, "conv-1", "call-9").is_err());
        let duplicate = serde_json::json!({
            "questions": [
                { "id": "a", "question": "A?" },
                { "id": "a", "question": "B?" }
            ]
        });
        assert!(normalize_questions(&duplicate, "conv-1", "call-9").is_err());
    }

    #[test]
    fn serializes_skipped_and_answered_responses() {
        let skipped = AskUserResponse {
            request_id: "ask".to_string(),
            answers: Vec::new(),
            skipped: true,
        };
        assert!(response_content(&skipped).contains("skipped"));
        let answered = AskUserResponse {
            request_id: "ask".to_string(),
            answers: vec![AskUserAnswer {
                question_id: "db".to_string(),
                selected: vec!["SQLite".to_string()],
                custom: Some("ou arquivo".to_string()),
            }],
            skipped: false,
        };
        let text = response_content(&answered);
        assert!(text.contains("SQLite"));
        assert!(text.contains("ou arquivo"));
    }
}
