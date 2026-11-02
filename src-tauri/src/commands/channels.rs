//! Shared agent channels.
//!
//! A channel is one thread several agents read and write. A user post is
//! appended to the shared history, then each member gets a normal turn in its
//! own hidden channel thread with the shared history injected as context. The
//! replies are appended back to the channel, so the next member sees them.

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};
use tokio_util::sync::CancellationToken;

use crate::agents::{AgentChannel, AgentChannelInput, AgentChannelMessage};
use crate::domain::{TurnKind, TurnOptions, TurnPayload, TurnProfile};
use crate::events::TurnEvent;
use crate::harness::{self, EventEmitter, HarnessDeps};
use crate::state::AppState;

fn to_error(error: impl std::fmt::Display) -> String {
    format!("{error:#}")
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

struct SilentEmitter;
impl EventEmitter for SilentEmitter {
    fn emit(&self, _event: TurnEvent) {}
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentChannelPostResult {
    pub messages: Vec<AgentChannelMessage>,
    pub errors: Vec<String>,
}

#[tauri::command]
pub fn list_agent_channels(state: State<'_, AppState>) -> Result<Vec<AgentChannel>, String> {
    state.db.list_agent_channels().map_err(to_error)
}

#[tauri::command]
pub fn create_agent_channel(
    state: State<'_, AppState>,
    input: AgentChannelInput,
) -> Result<AgentChannel, String> {
    let input = input.normalize()?;
    state
        .db
        .create_agent_channel(&input, now_ms())
        .map_err(to_error)
}

#[tauri::command]
pub fn update_agent_channel(
    state: State<'_, AppState>,
    channel_id: String,
    input: AgentChannelInput,
) -> Result<AgentChannel, String> {
    let input = input.normalize()?;
    state
        .db
        .update_agent_channel(&channel_id, &input, now_ms())
        .map_err(to_error)
}

#[tauri::command]
pub fn delete_agent_channel(
    state: State<'_, AppState>,
    channel_id: String,
) -> Result<(), String> {
    state.db.delete_agent_channel(&channel_id).map_err(to_error)
}

#[tauri::command]
pub fn list_agent_channel_messages(
    state: State<'_, AppState>,
    channel_id: String,
) -> Result<Vec<AgentChannelMessage>, String> {
    state
        .db
        .list_agent_channel_messages(&channel_id, Some(300))
        .map_err(to_error)
}

/// Posts one user message and asks every member agent for a reply, in order.
#[tauri::command]
pub async fn post_agent_channel_message(
    app: AppHandle,
    state: State<'_, AppState>,
    channel_id: String,
    content: String,
) -> Result<AgentChannelPostResult, String> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("AGENT_CHANNEL_INVALID: a mensagem não pode ser vazia.".to_string());
    }
    if content.chars().count() > 16_000 {
        return Err("AGENT_CHANNEL_INVALID: a mensagem passa de 16.000 caracteres.".to_string());
    }
    let channel = state
        .db
        .get_agent_channel(&channel_id)
        .map_err(to_error)?
        .ok_or_else(|| format!("AGENT_CHANNEL_NOT_FOUND: canal `{channel_id}` não existe"))?;
    if channel.member_ids.is_empty() {
        return Err("AGENT_CHANNEL_EMPTY: adicione pelo menos um agente ao canal.".to_string());
    }

    let _ = state
        .db
        .append_agent_channel_message(&channel_id, "user", None, &content, now_ms())
        .map_err(to_error)?;

    let mut errors = Vec::new();
    let db = state.db.clone();
    let deps = HarnessDeps {
        app: Some(app.clone()),
        db: db.clone(),
        http: state.http.clone(),
        search_http: state.search_http.clone(),
        catalog: state.catalog.clone(),
        data_dir: None,
        skills_roots: None,
        // Unattended channel replies cannot answer approval/question cards.
        approvals: None,
        observed: Some(state.observed.clone()),
        jobs: Some(state.jobs.clone()),
        questions: None,
        mcp: Some(state.mcp.clone()),
        streamer: None,
        api_key_override: None,
        credential_override: None,
        refresh_override: None,
        model_source: None,
    };
    let settings = crate::config::load_settings(&app);

    for agent_id in &channel.member_ids {
        let agent = match db.get_agent(agent_id) {
            Ok(Some(agent)) => agent,
            Ok(None) => {
                errors.push(format!("Agente `{agent_id}` não existe."));
                continue;
            }
            Err(error) => {
                errors.push(format!("Falha ao ler o agente `{agent_id}`: {error:#}"));
                continue;
            }
        };
        if agent.is_archived() {
            errors.push(format!("Agente `{}` está arquivado.", agent.name));
            continue;
        }
        let conversation = match db.get_or_create_channel_conversation(
            &channel.id,
            &agent.id,
            &format!("#{} · {}", channel.name, agent.name),
        ) {
            Ok(conversation) => conversation,
            Err(error) => {
                errors.push(format!("Falha ao criar a thread de {}: {error:#}", agent.name));
                continue;
            }
        };
        let history = db
            .list_agent_channel_messages(&channel.id, Some(24))
            .unwrap_or_default();
        let mut history_text = history
            .iter()
            .map(|message| {
                let author = match message.role.as_str() {
                    "user" => "Usuário".to_string(),
                    "agent" => message
                        .agent_id
                        .as_deref()
                        .and_then(|id| db.get_agent(id).ok().flatten())
                        .map(|agent| agent.name)
                        .unwrap_or_else(|| "Agente".to_string()),
                    other => other.to_string(),
                };
                format!("[{author}] {}", message.content)
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        // Keep the shared channel context bounded even with long replies.
        const MAX_CHANNEL_CONTEXT_CHARS: usize = 12_000;
        let history_chars = history_text.chars().count();
        if history_chars > MAX_CHANNEL_CONTEXT_CHARS {
            history_text = history_text
                .chars()
                .skip(history_chars - MAX_CHANNEL_CONTEXT_CHARS)
                .collect();
        }
        let prompt = format!(
            "Você está no canal compartilhado #{name}. Os participantes são: {members}.\n\n\
             Histórico recente do canal (mais antigo primeiro):\n\n{history}\n\n\
             Responda como {agent_name}, considerando o que os outros participantes já disseram. \
             Seja breve, não repita o histórico e não invente ações que você não executou.",
            name = channel.name,
            members = channel
                .member_ids
                .iter()
                .filter_map(|id| db.get_agent(id).ok().flatten())
                .map(|agent| agent.name)
                .collect::<Vec<_>>()
                .join(", "),
            history = history_text,
            agent_name = agent.name,
        );
        let profile = if conversation.workspace_id.is_some() {
            TurnProfile::Code
        } else {
            TurnProfile::Chat
        };
        let payload = TurnPayload {
            conversation_id: conversation.id,
            content: prompt,
            attachment_ids: Vec::new(),
            provider_id: agent.provider_id.clone(),
            model_id: agent.model_id.clone(),
            reasoning: agent.reasoning.clone(),
            options: TurnOptions::default(),
            profile,
            turn_kind: TurnKind::User,
            goal_request: false,
            turn_id: Some(uuid::Uuid::new_v4().to_string()),
        };
        match harness::run_turn(
            deps.clone(),
            payload,
            settings.clone(),
            Arc::new(SilentEmitter),
            CancellationToken::new(),
        )
        .await
        {
            Ok(result) => {
                let reply = result.assistant_message.content.trim().to_string();
                if reply.is_empty() {
                    errors.push(format!("{} não devolveu texto.", agent.name));
                } else {
                    let _ = db.append_agent_channel_message(
                        &channel.id,
                        "agent",
                        Some(&agent.id),
                        &reply,
                        now_ms(),
                    );
                }
            }
            Err(error) => {
                errors.push(format!("{} falhou: {error:#}", agent.name));
            }
        }
    }

    let messages = db
        .list_agent_channel_messages(&channel_id, Some(300))
        .map_err(to_error)?;
    Ok(AgentChannelPostResult { messages, errors })
}
