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
}
