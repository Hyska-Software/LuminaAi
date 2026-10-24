//! Agent harness: builds context, runs the tool loop and persists messages.

use std::sync::Arc;

use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

use crate::catalog::CatalogFile;
use crate::db::Db;
use crate::domain::{Settings, TurnPayload, TurnResult};
use crate::events::TurnEvent;

pub mod prompt;

#[derive(Clone)]
pub struct HarnessDeps {
    pub app: tauri::AppHandle,
    pub db: Arc<Db>,
    pub http: reqwest::Client,
    pub catalog: CatalogFile,
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
    on_event: Channel<TurnEvent>,
    cancel: CancellationToken,
) -> anyhow::Result<TurnResult> {
    let _ = (deps, payload, settings, on_event, cancel);
    todo!("implemented by the harness module")
}
