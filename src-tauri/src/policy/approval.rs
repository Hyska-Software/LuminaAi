//! Seam de aprovação interativa: pedido → evento no renderer → decisão.
//!
//! O `ApprovalRegistry` guarda o pedido (para a UI/snapshot) e um
//! `oneshot::Sender` por aprovação pendente. Quem executa a tool aguarda o
//! `oneshot::Receiver`; o comando Tauri `respond_approval` resolve o canal.
//! Timeout/cancelamento resolvem como `Cancelled`/`Expired` (falha fechada) —
//! nunca como aprovação.
//!
//! Contrato: `docs/goals/code-harness/HARNESS.md` §6.3.

use std::collections::HashMap;

use parking_lot::Mutex;
use tokio::sync::oneshot;

use crate::domain::{ApprovalDecision, ApprovalRequest, ApprovalScope};

/// Resultado de uma aprovação.
#[derive(Debug, Clone)]
pub struct ApprovalOutcome {
    pub decision: ApprovalDecision,
    pub scope: Option<ApprovalScope>,
    pub feedback: Option<String>,
    /// Escolha do gate do plano: `approve_run` | `approve_review` |
    /// `approve_goal` (None nas demais aprovações).
    pub choice: Option<String>,
    /// Markdown revisado pelo usuário antes de aprovar o plano.
    pub plan_markdown: Option<String>,
}

impl ApprovalOutcome {
    pub fn approved(scope: Option<ApprovalScope>) -> Self {
        Self {
            decision: ApprovalDecision::Approved,
            scope,
            feedback: None,
            choice: None,
            plan_markdown: None,
        }
    }

    /// Aprovação do gate de plano, carregando a escolha (`approve_run` /
    /// `approve_review` / `approve_goal`) e o eventual markdown revisado.
    pub fn approved_plan(choice: Option<String>, plan_markdown: Option<String>) -> Self {
        Self {
            decision: ApprovalDecision::Approved,
            scope: None,
            feedback: None,
            choice,
            plan_markdown,
        }
    }

    pub fn denied(feedback: Option<String>) -> Self {
        Self {
            decision: ApprovalDecision::Denied,
            scope: None,
            feedback,
            choice: None,
            plan_markdown: None,
        }
    }

    pub fn cancelled() -> Self {
        Self {
            decision: ApprovalDecision::Cancelled,
            scope: None,
            feedback: None,
            choice: None,
            plan_markdown: None,
        }
    }

    pub fn expired() -> Self {
        Self {
            decision: ApprovalDecision::Expired,
            scope: None,
            feedback: None,
            choice: None,
            plan_markdown: None,
        }
    }

    pub fn is_approved(&self) -> bool {
        self.decision == ApprovalDecision::Approved
    }

    /// `true` quando o usuário escolheu "Aprovar e revisar cada edição".
    pub fn review_each_edit(&self) -> bool {
        self.choice.as_deref() == Some("approve_review")
    }

    /// `true` quando o usuário escolheu "Executar como Objetivo": aprova o
    /// plano, preserva o modo de permissão e deixa a primeira rodada do Goal
    /// executá-lo.
    pub fn execute_as_goal(&self) -> bool {
        self.choice.as_deref() == Some("approve_goal")
    }
}

struct PendingApproval {
    request: ApprovalRequest,
    sender: oneshot::Sender<ApprovalOutcome>,
}

/// Registro de aprovações pendentes (compartilhado no `AppState`).
#[derive(Default)]
pub struct ApprovalRegistry {
    pending: Mutex<HashMap<String, PendingApproval>>,
}

impl ApprovalRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registra o pedido (para o snapshot/UI) e devolve o receptor que a tool
    /// deve aguardar.
    pub fn register_request(
        &self,
        request: ApprovalRequest,
    ) -> oneshot::Receiver<ApprovalOutcome> {
        let (tx, rx) = oneshot::channel();
        let id = request.id.clone();
        self.pending.lock().insert(
            id,
            PendingApproval {
                request,
                sender: tx,
            },
        );
        rx
    }

    /// Resolve um pedido pendente. Retorna `false` quando não existe (já foi
    /// resolvido, cancelado ou o app reiniciou).
    pub fn resolve(&self, approval_id: &str, outcome: ApprovalOutcome) -> bool {
        let pending = self.pending.lock().remove(approval_id);
        match pending {
            Some(entry) => entry.sender.send(outcome).is_ok(),
            None => false,
        }
    }

    /// Pedidos pendentes (snapshot para `get_code_session_state`).
    pub fn pending_requests(&self) -> Vec<ApprovalRequest> {
        let mut requests: Vec<ApprovalRequest> = self
            .pending
            .lock()
            .values()
            .map(|entry| entry.request.clone())
            .collect();
        requests.sort_by(|left, right| left.created_at.cmp(&right.created_at));
        requests
    }

    /// Pedido por id (para derivar a regra "sempre permitir" da UI).
    pub fn request(&self, approval_id: &str) -> Option<ApprovalRequest> {
        self.pending
            .lock()
            .get(approval_id)
            .map(|entry| entry.request.clone())
    }

    /// Cancela apenas os pedidos de uma sessão (fim do turno Code).
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
                let _ = entry.sender.send(ApprovalOutcome::cancelled());
            }
        }
        count
    }

    /// Cancela todos os pedidos pendentes (fim de turno/cancelamento/app).
    pub fn cancel_all(&self) -> usize {
        let pending: Vec<(String, PendingApproval)> = self.pending.lock().drain().collect();
        let count = pending.len();
        for (_, entry) in pending {
            let _ = entry.sender.send(ApprovalOutcome::cancelled());
        }
        count
    }

    pub fn pending_ids(&self) -> Vec<String> {
        self.pending.lock().keys().cloned().collect()
    }

    pub fn has_pending(&self, approval_id: &str) -> bool {
        self.pending.lock().contains_key(approval_id)
    }
}

/// Pede aprovação de forma interativa: registra o pedido, emite
/// `ApprovalRequested`, aguarda decisão (usuário, timeout ou cancelamento) e
/// emite `ApprovalResolved`. Sempre resolve — falha fechada em `expired`.
pub async fn request_interactive(
    registry: &ApprovalRegistry,
    emit: Option<std::sync::Arc<dyn crate::harness::EventEmitter>>,
    request: ApprovalRequest,
    timeout: std::time::Duration,
    cancel: &tokio_util::sync::CancellationToken,
) -> ApprovalOutcome {
    let id = request.id.clone();
    let receiver = registry.register_request(request.clone());
    if let Some(emit) = &emit {
        emit.emit(crate::events::TurnEvent::ApprovalRequested {
            approval: request,
        });
    }
    let outcome = tokio::select! {
        biased;
        _ = cancel.cancelled() => {
            registry.resolve(&id, ApprovalOutcome::cancelled());
            ApprovalOutcome::cancelled()
        },
        result = tokio::time::timeout(timeout, receiver) => match result {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(_)) => ApprovalOutcome::expired(),
            Err(_) => {
                // Timeout: remove o pedido para a UI não mostrar um card morto.
                registry.resolve(&id, ApprovalOutcome::expired());
                ApprovalOutcome::expired()
            }
        },
    };
    if let Some(emit) = &emit {
        emit.emit(crate::events::TurnEvent::ApprovalResolved {
            approval_id: id,
            decision: outcome.decision.as_str().to_string(),
            scope: outcome.scope.map(|scope| scope.as_str().to_string()),
        });
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{ApprovalDetail, RiskClass};

    fn request(id: &str) -> ApprovalRequest {
        ApprovalRequest {
            id: id.to_string(),
            conversation_id: "conv-1".to_string(),
            tool_call_id: "call-1".to_string(),
            tool: "run_command".to_string(),
            title: "Executar comando?".to_string(),
            detail: ApprovalDetail::Command {
                command: "npm test".to_string(),
                workdir: ".".to_string(),
            },
            risk: RiskClass::Shell,
            preview: None,
            options: Vec::new(),
            created_at: 1,
        }
    }

    #[tokio::test]
    async fn register_and_resolve_roundtrip() {
        let registry = ApprovalRegistry::new();
        let rx = registry.register_request(request("apr-1"));
        assert!(registry.has_pending("apr-1"));
        assert_eq!(registry.pending_requests().len(), 1);
        assert!(registry.resolve("apr-1", ApprovalOutcome::approved(None)));
        let outcome = rx.await.expect("decisão enviada");
        assert!(outcome.is_approved());
        assert!(!registry.has_pending("apr-1"));
    }

    #[tokio::test]
    async fn cancelled_request_does_not_leave_a_stale_approval() {
        let registry = ApprovalRegistry::new();
        let cancel = tokio_util::sync::CancellationToken::new();
        cancel.cancel();
        let outcome = request_interactive(&registry, None, request("cancelled"), std::time::Duration::from_secs(1), &cancel).await;
        assert!(!outcome.is_approved());
        assert!(!registry.has_pending("cancelled"));
    }

    #[tokio::test]
    async fn resolve_unknown_id_returns_false() {
        let registry = ApprovalRegistry::new();
        assert!(!registry.resolve("nope", ApprovalOutcome::approved(None)));
    }

    #[tokio::test]
    async fn request_lookup_is_available_for_rule_creation() {
        let registry = ApprovalRegistry::new();
        let _rx = registry.register_request(request("apr-2"));
        let found = registry.request("apr-2").expect("pedido registrado");
        assert_eq!(found.tool, "run_command");
    }

    #[tokio::test]
    async fn cancel_all_resolves_every_pending_request() {
        let registry = ApprovalRegistry::new();
        let first = registry.register_request(request("a"));
        let second = registry.register_request(request("b"));
        assert_eq!(registry.cancel_all(), 2);
        assert_eq!(
            first.await.expect("a").decision,
            ApprovalDecision::Cancelled
        );
        assert_eq!(
            second.await.expect("b").decision,
            ApprovalDecision::Cancelled
        );
        assert!(registry.pending_ids().is_empty());
    }
}
