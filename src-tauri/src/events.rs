//! Streaming events emitted by the harness to the React renderer.
//!
//! Serialised as `{ "type": "...", ...camelCaseFields }` and delivered over a
//! `tauri::ipc::Channel`.

use serde::Serialize;

use crate::domain::{
    Artifact, ChatMessage, Citation, ToolCallRecord, TurnResult, UsageInfo,
};

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum TurnEvent {
    /// The user message was persisted and the assistant placeholder created.
    TurnStarted {
        turn_id: String,
        user_message_id: String,
        assistant_message_id: String,
    },
    /// A new model round started (step 1 = first completion, 2+ = after tools).
    StepStarted { step: u32 },
    /// Reasoning / thinking stream delta.
    ReasoningDelta { delta: String },
    ReasoningDone,
    /// Final answer text delta.
    TextDelta { delta: String },
    /// A tool call started streaming its arguments.
    ToolCallStarted { tool_call: ToolCallRecord },
    /// JSON arguments delta for a streaming tool call.
    ToolCallArgs { id: String, delta: String },
    /// Tool execution finished.
    ToolCallFinished {
        id: String,
        status: String,
        result: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
        #[serde(default)]
        citations: Vec<Citation>,
        /// Apresentação estruturada (diff/todo/plano/job) para o card ao vivo.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        presentation: Option<serde_json::Value>,
    },
    /// A file artifact was created by the agent.
    ArtifactCreated { artifact: Artifact },
    /// Token usage for the turn (may be emitted once at the end).
    Usage { usage: UsageInfo },
    /// A persisted message snapshot (used for resync / title updates).
    MessageUpdated { message: ChatMessage },
    /// Conversation title was auto-generated.
    TitleUpdated {
        conversation_id: String,
        title: String,
    },
    /// The turn finished successfully.
    Done { result: TurnResult },
    /// The user cancelled the turn.
    Cancelled,
    /// Something went wrong; the assistant message keeps partial content.
    Error {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        /// Actionable hint for the renderer (e.g. "Entre novamente para usar
        /// seu plano ChatGPT"), separate from the raw provider message.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hint: Option<String>,
    },

    /* ------------------------------------------------------------------ */
    /* Harness de código (docs/goals/code-harness/HARNESS.md §12)          */
    /* ------------------------------------------------------------------ */
    /// Uma tool pausou o turno pedindo permissão ao usuário.
    ApprovalRequested {
        approval: crate::domain::ApprovalRequest,
    },
    /// A aprovação pendente foi resolvida (pelo usuário, regra, timeout ou cancelamento).
    ApprovalResolved {
        approval_id: String,
        decision: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scope: Option<String>,
    },
    /// Saída incremental de uma tool (shell/job) para o card ao vivo.
    ToolProgress {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stream: Option<String>,
        delta: String,
    },
    /// Um arquivo foi criado/alterado/removido pelo agente neste turno.
    FileChanged {
        change: crate::domain::FileChange,
    },
    /// Resumo das alterações do turno (journal + working tree), emitido no fecho.
    WorkspaceChanges {
        summary: crate::domain::ChangesSummary,
    },
    /// Lista de tarefas do agente mudou (substituição integral).
    TodosUpdated {
        todos: Vec<crate::domain::TodoItem>,
    },
    /// Estado do modo Plano mudou (entrou, plano submetido, aprovado, saiu).
    PlanUpdated {
        plan: crate::domain::PlanView,
    },
    /// Medidor de contexto do turno (tokens estimados/janela).
    ContextStats {
        stats: crate::domain::ContextStats,
    },
    /// O contexto foi compactado (resumo aplicado à janela do modelo).
    Compacted {
        messages: u32,
        tokens_freed: u32,
    },
    /// Um job de processo em background mudou de estado.
    JobUpdated {
        job: crate::domain::JobView,
    },
    /// Perfil/modo da sessão mudou (permission mode, plan mode, profile).
    ProfileChanged {
        profile: String,
        permission_mode: String,
        plan_mode: bool,
    },
}
