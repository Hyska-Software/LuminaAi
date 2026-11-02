//! Delegated agent tasks (agent↔agent collaboration).
//!
//! A task is a durable unit of work with one owner, a brief/acceptance
//! contract, budget and a dedicated hidden conversation. The scheduler runs
//! queued tasks in the background under the global concurrency governor. Human
//! tasks and tool-created tasks share the same state machine.

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio_util::sync::CancellationToken;

use crate::agents::{AgentTask, AgentTaskEvent, AgentTaskInput};
use crate::domain::{TurnKind, TurnOptions, TurnPayload, TurnProfile};
use crate::events::TurnEvent;
use crate::harness::{self, EventEmitter, HarnessDeps};
use crate::state::AppState;

fn to_error(error: impl std::fmt::Display) -> String {
    format!("{error:#}")
}

struct SilentEmitter;
impl EventEmitter for SilentEmitter {
    fn emit(&self, _event: TurnEvent) {}
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskDetail {
    pub task: AgentTask,
    pub events: Vec<AgentTaskEvent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskUpdatedEvent {
    pub task_id: String,
    pub owner_agent_id: String,
    pub status: String,
    pub title: String,
}

#[tauri::command]
pub fn list_agent_tasks(
    state: State<'_, AppState>,
    status: Option<String>,
    owner_agent_id: Option<String>,
    channel_id: Option<String>,
) -> Result<Vec<AgentTask>, String> {
    state
        .db
        .list_agent_tasks(
            status.as_deref(),
            owner_agent_id.as_deref(),
            channel_id.as_deref(),
            Some(200),
        )
        .map_err(to_error)
}

#[tauri::command]
pub fn get_agent_task(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<AgentTaskDetail, String> {
    let task = state
        .db
        .get_agent_task(&task_id)
        .map_err(to_error)?
        .ok_or_else(|| format!("AGENT_TASK_NOT_FOUND: tarefa `{task_id}` não existe"))?;
    let events = state.db.list_agent_task_events(&task_id).map_err(to_error)?;
    Ok(AgentTaskDetail { task, events })
}

/// User-created task from the task board / channel composer.
#[tauri::command]
pub fn create_agent_task(
    state: State<'_, AppState>,
    input: AgentTaskInput,
) -> Result<AgentTask, String> {
    let input = input.normalize()?;
    state
        .db
        .create_agent_task(&input, None, true, crate::domain::now_ms())
        .map_err(to_error)
}

#[tauri::command]
pub fn cancel_agent_task(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<AgentTask, String> {
    let task = state
        .db
        .get_agent_task(&task_id)
        .map_err(to_error)?
        .ok_or_else(|| format!("AGENT_TASK_NOT_FOUND: tarefa `{task_id}` não existe"))?;
    if let Some(conversation_id) = task.conversation_id.as_deref() {
        // Stop the actual harness before changing the durable status. The
        // runner checks the status before writing a terminal transition.
        state.cancel_conversation(conversation_id);
        let _ = state
            .db
            .end_computer_session(conversation_id, "stopped", crate::domain::now_ms());
    }
    state
        .db
        .transition_agent_task(
            &task_id,
            "cancelled",
            "user",
            serde_json::json!({ "reason": "cancelada pelo usuário" }),
            None,
            None,
            crate::domain::now_ms(),
        )
        .map_err(to_error)
}

#[tauri::command]
pub fn reassign_agent_task(
    state: State<'_, AppState>,
    task_id: String,
    to_agent_id: String,
) -> Result<AgentTask, String> {
    state
        .db
        .handoff_agent_task(
            &task_id,
            &to_agent_id,
            "user",
            "Reatribuída pelo usuário",
            crate::domain::now_ms(),
        )
        .map_err(to_error)
}

#[tauri::command]
pub async fn run_agent_task_now(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
) -> Result<AgentTask, String> {
    let task = state
        .db
        .get_agent_task(&task_id)
        .map_err(to_error)?
        .ok_or_else(|| format!("AGENT_TASK_NOT_FOUND: tarefa `{task_id}` não existe"))?;
    execute_task(&app, task).await?;
    state
        .db
        .get_agent_task(&task_id)
        .map_err(to_error)?
        .ok_or_else(|| format!("AGENT_TASK_NOT_FOUND: tarefa `{task_id}` não existe"))
}

/// One scheduler pass. Called by the background loop and safe to invoke from a
/// command. Leaves tasks queued when the concurrency slots are full.
pub async fn scheduler_tick(app: AppHandle) {
    let due = {
        let state = app.state::<AppState>();
        match state
            .db
            .list_queued_agent_tasks(crate::domain::now_ms(), 12)
        {
            Ok(tasks) => tasks,
            Err(error) => {
                eprintln!("lumina: falha ao listar tarefas: {error:#}");
                return;
            }
        }
    };
    for task in due {
        if let Err(error) = execute_task(&app, task).await {
            eprintln!("lumina: tarefa falhou: {error}");
        }
    }
}

async fn execute_task(app: &AppHandle, task: AgentTask) -> Result<(), String> {
    let state = app.state::<AppState>();
    let settings = crate::config::load_settings(app);
    let limits = crate::concurrency::TurnLimits {
        global: settings.max_concurrent_turns.max(1) as usize,
        per_agent: settings.max_concurrent_turns_per_agent.max(1) as usize,
    };
    let Some(_permit) = state
        .governor
        .try_acquire(Some(task.owner_agent_id.clone()), limits)
    else {
        return Ok(());
    };
    let task = state
        .db
        .claim_agent_task(&task.id, crate::domain::now_ms())
        .map_err(to_error)?;
    let agent = match state.db.get_agent(&task.owner_agent_id).map_err(to_error)? {
        Some(agent) if !agent.is_archived() => agent,
        Some(_) => {
            return finish_failure(app, &task, "o agente dono está arquivado");
        }
        None => {
            return finish_failure(app, &task, "o agente dono não existe");
        }
    };

    let conversation = match task.conversation_id.as_deref() {
        Some(id) => match state.db.get_conversation(id).map_err(to_error)? {
            Some(conversation) => conversation,
            None => {
                return finish_failure(app, &task, "a conversa da tarefa não existe");
            }
        },
        None => {
            let conversation = state
                .db
                .create_agent_conversation(&agent.id, &format!("Tarefa: {}", task.title))
                .map_err(to_error)?;
            state
                .db
                .set_agent_task_conversation(
                    &task.id,
                    &conversation.id,
                    crate::domain::now_ms(),
                )
                .map_err(to_error)?;
            conversation
        }
    };

    if let Some(limit) = settings.agent_daily_cost_limit_usd {
        if let Ok(usage) = state.db.get_agent_usage(&agent.id) {
            if usage.cost >= limit {
                return finish_failure(
                    app,
                    &task,
                    &format!(
                        "AGENT_TASK_BUDGET: o agente já usou US$ {:.2} do limite diário de US$ {:.2}",
                        usage.cost, limit
                    ),
                );
            }
        }
    }
    let turn_id = uuid::Uuid::new_v4().to_string();
    let cancel = state.register_turn(&turn_id, &conversation.id);
    let heartbeat = {
        let db = state.db.clone();
        let task_id = task.id.clone();
        let lease_cancel = cancel.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(5 * 60)).await;
                match db.renew_agent_task_lease(&task_id, crate::domain::now_ms()) {
                    Ok(true) => {}
                    _ => {
                        // Another runner took over or the task was cancelled:
                        // stop the harness instead of writing a stale result.
                        lease_cancel.cancel();
                        break;
                    }
                }
            }
        })
    };

    let channel_line = match task.channel_id.as_deref() {
        Some(channel_id) => state
            .db
            .get_agent_channel(channel_id)
            .ok()
            .flatten()
            .map(|channel| format!("\nCanal compartilhado: #{} (`{}`).", channel.name, channel.id))
            .unwrap_or_default(),
        None => String::new(),
    };
    let prompt = format!(
        "Você é {name} e é o dono da tarefa `{task_id}`.\n\n\
         Título: {title}\n\nBrief:\n{brief}\n\nCritério de aceite:\n{acceptance}\n\n\
         Orçamento: até {turns} turnos, {tokens} tokens e US$ {cost:.2}.{channel_line}\n\n\
         Trabalhe até concluir a tarefa. Registre o resultado com evidência real; \
         se precisar de outro agente, use `delegate_task` com escopo pequeno. \
         Se estiver bloqueado, explique o bloqueio em vez de inventar resultado.",
        name = agent.name,
        task_id = task.id,
        title = task.title,
        brief = task.brief,
        acceptance = if task.acceptance.trim().is_empty() {
            "(não informado)"
        } else {
            task.acceptance.as_str()
        },
        turns = task.max_turns,
        tokens = task.max_tokens,
        cost = task.max_cost,
        channel_line = channel_line,
    );
    let profile = if conversation.workspace_id.is_some() {
        TurnProfile::Code
    } else {
        TurnProfile::Chat
    };
    let deps = HarnessDeps {
        app: Some(app.clone()),
        db: state.db.clone(),
        http: state.http.clone(),
        search_http: state.search_http.clone(),
        catalog: state.catalog.clone(),
        data_dir: None,
        skills_roots: None,
        // Unattended task work cannot answer approval/question cards.
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
    let max_turns = task.max_turns.clamp(1, 32) as u32;
    let mut total_cost = 0.0f64;
    let mut total_tokens = 0i64;
    let mut last_text = String::new();
    let mut budget_error: Option<String> = None;
    let mut worker_error: Option<String> = None;
    let mut turns_run = 0u32;
    for index in 0..max_turns {
        if cancel.is_cancelled() {
            break;
        }
        let current = state.db.get_agent_task(&task.id).ok().flatten();
        if current.as_ref().is_some_and(|value| {
            matches!(value.status.as_str(), "cancelled" | "declined")
        }) {
            break;
        }
        if current.as_ref().is_some_and(|value| value.status == "done") {
            break;
        }
        let content = if index == 0 {
            prompt.clone()
        } else {
            format!(
                "Continuação {}/{} da tarefa `{}`.\n\nO trabalho ainda não foi concluído. \
                 Continue de onde parou, verifique o resultado com evidência real e chame \
                 `finish_task` quando o critério de aceite estiver cumprido. Não repita o que \
                 já está pronto e respeite o orçamento.",
                index + 1,
                max_turns,
                task.title
            )
        };
        let payload = TurnPayload {
            conversation_id: conversation.id.clone(),
            content,
            attachment_ids: Vec::new(),
            provider_id: agent.provider_id.clone(),
            model_id: agent.model_id.clone(),
            reasoning: agent.reasoning.clone(),
            options: TurnOptions {
                max_steps: 16,
                ..TurnOptions::default()
            },
            profile,
            turn_kind: TurnKind::User,
            goal_request: false,
            turn_id: Some(format!("{turn_id}-{}", index + 1)),
        };
        match harness::run_turn(
            deps.clone(),
            payload,
            settings.clone(),
            Arc::new(SilentEmitter),
            cancel.clone(),
        )
        .await
        {
            Ok(result) => {
                turns_run += 1;
                total_cost += result.usage.as_ref().and_then(|usage| usage.cost).unwrap_or(0.0);
                total_tokens += i64::from(
                    result
                        .usage
                        .as_ref()
                        .and_then(|usage| usage.total_tokens)
                        .unwrap_or(0),
                );
                last_text = result.assistant_message.content.trim().to_string();
                if total_cost > task.max_cost {
                    budget_error = Some(format!(
                        "AGENT_TASK_BUDGET: custo US$ {total_cost:.2} passou do limite US$ {:.2}",
                        task.max_cost
                    ));
                    break;
                }
                if total_tokens > task.max_tokens {
                    budget_error = Some(format!(
                        "AGENT_TASK_BUDGET: {} tokens passaram do limite {}",
                        total_tokens, task.max_tokens
                    ));
                    break;
                }
                let latest = state.db.get_agent_task(&task.id).ok().flatten();
                if latest.as_ref().is_some_and(|value| value.status == "done") {
                    break;
                }
            }
            Err(error) => {
                worker_error = Some(format!("{error:#}"));
                break;
            }
        }
    }
    heartbeat.abort();
    state.finish_turn(&turn_id);

    let mut latest = state.db.get_agent_task(&task.id).ok().flatten();
    if latest
        .as_ref()
        .is_some_and(|value| matches!(value.status.as_str(), "cancelled" | "declined"))
    {
        return Ok(());
    }
    if let Some(error) = budget_error {
        return finish_failure(app, &task, &error);
    }
    if let Some(error) = worker_error {
        return finish_failure(app, &task, &error);
    }
    let Some(mut current) = latest.take() else {
        return finish_failure(app, &task, "a tarefa sumiu durante a execução");
    };
    if current.status != "done" {
        if last_text.trim().is_empty() {
            return finish_failure(
                app,
                &task,
                &format!(
                    "AGENT_TASK_INCOMPLETE: a tarefa não foi concluída em {max_turns} turno(s) \
                     e não devolveu resultado"
                ),
            );
        }
        current = state
            .db
            .transition_agent_task(
                &task.id,
                "done",
                "agent",
                serde_json::json!({
                    "turns": turns_run,
                    "tokens": total_tokens,
                    "cost": total_cost,
                }),
                Some(&last_text),
                None,
                crate::domain::now_ms(),
            )
            .map_err(to_error)?;
    }
    let latest = current;
    let text = latest
        .result
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(last_text.as_str())
        .to_string();
    if let Some(channel_id) = task.channel_id.as_deref() {
        let message = if text.is_empty() {
            format!("Tarefa `{}` concluída sem texto de resultado.", task.title)
        } else {
            format!("Tarefa `{}` concluída:\n\n{}", task.title, text)
        };
        let _ = state.db.append_agent_channel_message(
            channel_id,
            "agent",
            Some(&agent.id),
            &message,
            crate::domain::now_ms(),
        );
    }
    emit_updated(app, &latest);
    Ok(())
}

fn finish_failure(app: &AppHandle, task: &AgentTask, message: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let updated = state
        .db
        .transition_agent_task(
            &task.id,
            "failed",
            "system",
            serde_json::json!({ "error": message }),
            Some(message),
            None,
            crate::domain::now_ms(),
        )
        .map_err(to_error)?;
    if let Some(channel_id) = task.channel_id.as_deref() {
        let _ = state.db.append_agent_channel_message(
            channel_id,
            "system",
            None,
            &format!("Tarefa `{}` falhou: {message}", task.title),
            crate::domain::now_ms(),
        );
    }
    emit_updated(app, &updated);
    Err(message.to_string())
}

fn emit_updated(app: &AppHandle, task: &AgentTask) {
    let _ = app.emit(
        "lumina:agent-task-updated",
        AgentTaskUpdatedEvent {
            task_id: task.id.clone(),
            owner_agent_id: task.owner_agent_id.clone(),
            status: task.status.clone(),
            title: task.title.clone(),
        },
    );
}
