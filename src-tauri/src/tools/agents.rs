//! Tools available only inside the Agentes layout.
//!
//! These tools operate on the local agent roster, usage and routines. They are
//! added to the catalog only when the turn resolves to an agent conversation,
//! and routine mutations additionally require the `automation` capability.

use serde_json::{json, Value};

use crate::agents::{Agent, AgentRoutineInput};
use crate::db::Db;
use crate::domain::Settings;
use crate::providers::ToolDefinition;
use crate::tools::{json_str, AgentHooks, ToolOutcome};

const BASE_TOOLS: &[&str] = &[
    "agent_directory",
    "agent_usage",
    "agent_inbox",
    "agent_message",
];
const ROUTINE_TOOLS: &[&str] = &[
    "routine_list",
    "routine_create",
    "routine_update",
    "routine_delete",
];

pub fn is_agent_tool(name: &str) -> bool {
    BASE_TOOLS.contains(&name) || ROUTINE_TOOLS.contains(&name)
}

pub fn definitions(agent: &Agent) -> Vec<ToolDefinition> {
    let mut tools = vec![
        ToolDefinition {
            name: "agent_directory".to_string(),
            description: "List the active agents on this machine and the shared channels you \
                          belong to. Use it before delegating or asking another agent for help; \
                          instructions and memories of other agents are not exposed."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "agent_usage".to_string(),
            description: "Show this agent's all-time and local-day token/cost usage and the \
                          remaining daily budget."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "agent_inbox".to_string(),
            description: "Read this agent's durable direct-message inbox. `list` returns queued \
                          and recent deliveries; `read` returns the last messages of one DM channel."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["list", "read"] },
                    "channelId": { "type": "string" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 50 }
                },
                "additionalProperties": false
            }),
        },
    ];
    if agent.capabilities.delegation {
        tools.push(ToolDefinition {
            name: "agent_message".to_string(),
            description: "Send a direct message to another active agent. Creates or reuses the \
                          private DM channel and queues one delivery; it does not start the target \
                          turn immediately. Use `agent_inbox` to read the reply."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "toAgentId": { "type": "string" },
                    "content": { "type": "string", "maxLength": 16000 }
                },
                "required": ["toAgentId", "content"],
                "additionalProperties": false
            }),
        });
    }
    if agent.capabilities.automation {
        tools.push(ToolDefinition {
            name: "routine_list".to_string(),
            description: "List the routines owned by this agent.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        });
        tools.push(ToolDefinition {
            name: "routine_create".to_string(),
            description: "Create a recurring routine owned by this agent. Schedules are \
                          `interval` (minutes, minimum 5) or `daily` (local hour/minute). \
                          The routine runs unattended in its own thread."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string", "maxLength": 80 },
                    "prompt": { "type": "string", "maxLength": 8192 },
                    "scheduleKind": { "type": "string", "enum": ["interval", "daily"] },
                    "intervalMinutes": { "type": "integer", "minimum": 5, "maximum": 10080 },
                    "hour": { "type": "integer", "minimum": 0, "maximum": 23 },
                    "minute": { "type": "integer", "minimum": 0, "maximum": 59 },
                    "enabled": { "type": "boolean" },
                    "triggerKind": { "type": "string", "enum": ["schedule", "event"] },
                    "eventKind": { "type": "string", "enum": ["channel.message", "task.status"] },
                    "eventFilter": { "type": "string" }
                },
                "required": ["title", "prompt", "scheduleKind"],
                "additionalProperties": false
            }),
        });
        tools.push(ToolDefinition {
            name: "routine_update".to_string(),
            description: "Update a routine owned by this agent. Omitted fields keep their \
                          current value."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "routineId": { "type": "string" },
                    "title": { "type": "string", "maxLength": 80 },
                    "prompt": { "type": "string", "maxLength": 8192 },
                    "scheduleKind": { "type": "string", "enum": ["interval", "daily"] },
                    "intervalMinutes": { "type": "integer", "minimum": 5, "maximum": 10080 },
                    "hour": { "type": "integer", "minimum": 0, "maximum": 23 },
                    "minute": { "type": "integer", "minimum": 0, "maximum": 59 },
                    "enabled": { "type": "boolean" },
                    "triggerKind": { "type": "string", "enum": ["schedule", "event"] },
                    "eventKind": { "type": "string", "enum": ["channel.message", "task.status"] },
                    "eventFilter": { "type": "string" }
                },
                "required": ["routineId"],
                "additionalProperties": false
            }),
        });
        tools.push(ToolDefinition {
            name: "routine_delete".to_string(),
            description: "Delete a routine owned by this agent.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": { "routineId": { "type": "string" } },
                "required": ["routineId"],
                "additionalProperties": false
            }),
        });
    }
    tools
}

pub fn guidance(agent: &Agent) -> Vec<(&'static str, &'static str)> {
    let mut items = vec![
        (
            "agent_directory",
            "The directory is read-only. Use ids from it for delegation and channel messages; \
             do not assume another agent has access to your workspace or memory.",
        ),
        (
            "agent_usage",
            "Check your own spend before long autonomous work. The daily budget is local-day and \
             shared by every thread of this agent.",
        ),
        (
            "agent_inbox",
            "Direct messages are delivered as a turn by the scheduler. Read the DM history before \
             replying; replies are explicit, not an infinite chat loop.",
        ),
    ];
    if agent.capabilities.delegation {
        items.push((
            "agent_message",
            "Use direct messages for a short, targeted question to one agent. For owned work with \
             acceptance criteria, use `delegate_task` instead.",
        ));
    }
    if agent.capabilities.automation {
        items.push((
            "routine_create",
            "Create a routine only for recurring work with a clear finish line. Keep the prompt \
             self-contained and include what to do when a source is missing or stale.",
        ));
        items.push((
            "routine_update",
            "Pause a routine with `enabled: false` instead of deleting it when you only need to \
             stop it temporarily.",
        ));
    }
    items
}

fn agent_json(agent: &Agent, channel_ids: &[String]) -> Value {
    json!({
        "id": agent.id,
        "name": agent.name,
        "role": agent.role,
        "description": agent.description,
        "emoji": agent.emoji,
        "department": agent.department,
        "providerId": agent.provider_id,
        "modelId": agent.model_id,
        "fallbackProviderId": agent.fallback_provider_id,
        "fallbackModelId": agent.fallback_model_id,
        "permissionMode": agent.permission_mode,
        "workspaceId": agent.workspace_id,
        "capabilities": agent.capabilities,
        "threadCount": agent.thread_count,
        "lastActiveAt": agent.last_active_at,
        "channelIds": channel_ids,
    })
}

fn require_automation(agent: &Agent) -> Result<(), ToolOutcome> {
    if agent.capabilities.automation {
        Ok(())
    } else {
        Err(ToolOutcome::error(
            "AGENT_CAPABILITY_DENIED: a capability `automation` não está habilitada para este agente",
        ))
    }
}

fn routine_id(args: &Value) -> Result<String, ToolOutcome> {
    json_str(args, "routineId").ok_or_else(|| ToolOutcome::error("o argumento `routineId` é obrigatório"))
}

fn routine_input(args: &Value, current: Option<&crate::agents::AgentRoutine>) -> Result<AgentRoutineInput, String> {
    let title = json_str(args, "title")
        .or_else(|| current.map(|routine| routine.title.clone()))
        .unwrap_or_default();
    let prompt = json_str(args, "prompt")
        .or_else(|| current.map(|routine| routine.prompt.clone()))
        .unwrap_or_default();
    let schedule_kind = json_str(args, "scheduleKind")
        .or_else(|| current.map(|routine| routine.schedule_kind.clone()))
        .unwrap_or_else(|| "interval".to_string());
    let interval_minutes = args
        .get("intervalMinutes")
        .and_then(Value::as_i64)
        .or_else(|| current.map(|routine| routine.interval_minutes))
        .unwrap_or(60);
    let hour = args
        .get("hour")
        .and_then(Value::as_u64)
        .map(|value| value as u32)
        .or_else(|| current.map(|routine| routine.hour))
        .unwrap_or(9);
    let minute = args
        .get("minute")
        .and_then(Value::as_u64)
        .map(|value| value as u32)
        .or_else(|| current.map(|routine| routine.minute))
        .unwrap_or(0);
    let enabled = args
        .get("enabled")
        .and_then(Value::as_bool)
        .or_else(|| current.map(|routine| routine.enabled))
        .unwrap_or(true);
    let trigger_kind = json_str(args, "triggerKind")
        .or_else(|| current.map(|routine| routine.trigger_kind.clone()))
        .unwrap_or_else(|| "schedule".to_string());
    let event_kind = json_str(args, "eventKind")
        .or_else(|| current.map(|routine| routine.event_kind.clone()))
        .unwrap_or_default();
    let event_filter_json = json_str(args, "eventFilter")
        .or_else(|| current.map(|routine| routine.event_filter_json.clone()))
        .unwrap_or_else(|| "{}".to_string());
    AgentRoutineInput {
        title,
        prompt,
        schedule_kind,
        interval_minutes,
        hour,
        minute,
        enabled,
        trigger_kind,
        event_kind,
        event_filter_json,
    }
    .normalize()
}

fn routine_json(routine: &crate::agents::AgentRoutine) -> Value {
    json!({
        "id": routine.id,
        "agentId": routine.agent_id,
        "title": routine.title,
        "prompt": routine.prompt,
        "scheduleKind": routine.schedule_kind,
        "intervalMinutes": routine.interval_minutes,
        "hour": routine.hour,
        "minute": routine.minute,
        "enabled": routine.enabled,
        "conversationId": routine.conversation_id,
        "nextRunAt": routine.next_run_at,
        "lastRunAt": routine.last_run_at,
        "lastStatus": routine.last_status,
        "lastError": routine.last_error,
    })
}

fn directory(db: &Db, agent_id: &str) -> Result<ToolOutcome, ToolOutcome> {
    let agents = db
        .list_agents(false)
        .map_err(|error| ToolOutcome::error(format!("{error:#}")))?;
    let channels = db
        .list_agent_channels()
        .map_err(|error| ToolOutcome::error(format!("{error:#}")))?;
    let caller_channels: std::collections::HashSet<&str> = channels
        .iter()
        .filter(|channel| channel.member_ids.iter().any(|id| id == agent_id))
        .map(|channel| channel.id.as_str())
        .collect();
    let mut channel_ids: std::collections::HashMap<&str, Vec<String>> =
        std::collections::HashMap::new();
    for channel in &channels {
        if !caller_channels.contains(channel.id.as_str()) {
            continue;
        }
        for member in &channel.member_ids {
            channel_ids
                .entry(member.as_str())
                .or_default()
                .push(channel.id.clone());
        }
    }
    let agents_json: Vec<Value> = agents
        .iter()
        .map(|agent| {
            agent_json(
                agent,
                channel_ids
                    .get(agent.id.as_str())
                    .map(Vec::as_slice)
                    .unwrap_or(&[]),
            )
        })
        .collect();
    let channels_json: Vec<Value> = channels
        .iter()
        .filter(|channel| caller_channels.contains(channel.id.as_str()))
        .map(|channel| {
            json!({
                "id": channel.id,
                "name": channel.name,
                "kind": channel.kind,
                "memberIds": channel.member_ids,
            })
        })
        .collect();
    Ok(ToolOutcome {
        content: serde_json::to_string_pretty(&json!({
            "agents": agents_json,
            "channels": channels_json,
        }))
        .unwrap_or_else(|_| "{}".to_string()),
        summary: Some(format!("{} agente(s), {} canal(is)", agents.len(), channels_json.len())),
        ..Default::default()
    })
}

fn usage(db: &Db, agent_id: &str, settings: &Settings) -> ToolOutcome {
    let all = match db.get_agent_usage(agent_id) {
        Ok(usage) => usage,
        Err(error) => return ToolOutcome::error(format!("{error:#}")),
    };
    let today = match db.agent_usage_since(
        agent_id,
        crate::domain::local_day_start_ms(crate::domain::now_ms()),
    ) {
        Ok(usage) => usage,
        Err(error) => return ToolOutcome::error(format!("{error:#}")),
    };
    let limit = settings.agent_daily_cost_limit_usd;
    ToolOutcome {
        content: serde_json::to_string_pretty(&json!({
            "agentId": agent_id,
            "allTime": all,
            "today": today,
            "dailyLimitUsd": limit,
            "remainingTodayUsd": limit.map(|limit| (limit - today.cost).max(0.0)),
        }))
        .unwrap_or_else(|_| "{}".to_string()),
        summary: Some(format!("Hoje: US$ {:.2}", today.cost)),
        ..Default::default()
    }
}

fn agent_message(
    db: &Db,
    agent_id: &str,
    target_id: &str,
    content: &str,
    hooks: Option<&dyn AgentHooks>,
) -> ToolOutcome {
    let target_id = target_id.trim();
    if target_id.is_empty() {
        return ToolOutcome::error("o argumento `toAgentId` é obrigatório");
    }
    if target_id == agent_id {
        return ToolOutcome::error("AGENT_DM_SELF: não é possível enviar mensagem para si mesmo");
    }
    let content = content.trim();
    if content.is_empty() {
        return ToolOutcome::error("o argumento `content` é obrigatório");
    }
    if content.chars().count() > 16_000 {
        return ToolOutcome::error("AGENT_DM_INVALID: a mensagem passa de 16.000 caracteres");
    }
    let target = match db.get_agent(target_id) {
        Ok(Some(target)) if !target.is_archived() => target,
        Ok(Some(_)) => {
            return ToolOutcome::error("AGENT_DM_TARGET_ARCHIVED: o agente destino está arquivado");
        }
        Ok(None) => return ToolOutcome::error("AGENT_DM_INVALID: agente destino não existe"),
        Err(error) => return ToolOutcome::error(format!("{error:#}")),
    };
    let channel = match db.get_or_create_dm_channel(agent_id, &target.id, crate::domain::now_ms()) {
        Ok(channel) => channel,
        Err(error) => return ToolOutcome::error(format!("{error:#}")),
    };
    let message = match db.append_agent_channel_message(
        &channel.id,
        "agent",
        Some(agent_id),
        content,
        crate::domain::now_ms(),
    ) {
        Ok(message) => message,
        Err(error) => return ToolOutcome::error(format!("{error:#}")),
    };
    if let Err(error) =
        db.enqueue_agent_inbox(&target.id, Some(agent_id), &channel.id, &message.id, crate::domain::now_ms())
    {
        return ToolOutcome::error(format!("{error:#}"));
    }
    if let Some(hooks) = hooks {
        hooks.channel_updated(&channel.id);
    }
    ToolOutcome {
        content: json!({
            "queued": true,
            "channelId": channel.id,
            "messageId": message.id,
            "toAgentId": target.id,
            "toAgentName": target.name,
        })
        .to_string(),
        summary: Some(format!("Mensagem direta para {}", target.name)),
        ..Default::default()
    }
}

fn agent_inbox(db: &Db, agent_id: &str, args: &Value) -> ToolOutcome {
    let action = json_str(args, "action")
        .unwrap_or_else(|| "list".to_string())
        .trim()
        .to_ascii_lowercase();
    match action.as_str() {
        "list" => {
            let limit = args
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(20)
                .clamp(1, 50) as u32;
            match db.list_agent_inbox(agent_id, limit) {
                Ok(items) => ToolOutcome {
                    content: serde_json::to_string_pretty(&items)
                        .unwrap_or_else(|_| "[]".to_string()),
                    summary: Some(format!("{} mensagem(ns) direta(s)", items.len())),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "read" => {
            let Some(channel_id) = json_str(args, "channelId") else {
                return ToolOutcome::error("o argumento `channelId` é obrigatório para read");
            };
            let channel = match db.get_agent_channel(&channel_id) {
                Ok(Some(channel)) => channel,
                Ok(None) => return ToolOutcome::error("AGENT_INBOX_NOT_FOUND: canal não encontrado"),
                Err(error) => return ToolOutcome::error(format!("{error:#}")),
            };
            if channel.kind != "dm" {
                return ToolOutcome::error("AGENT_INBOX_INVALID: o canal não é uma conversa direta");
            }
            if !channel.member_ids.iter().any(|id| id == agent_id) {
                return ToolOutcome::error("AGENT_INBOX_NOT_FOUND: você não participa deste canal");
            }
            let limit = args
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(50)
                .clamp(1, 50) as u32;
            match db.list_agent_channel_messages(&channel.id, Some(limit)) {
                Ok(messages) => ToolOutcome {
                    content: serde_json::to_string_pretty(&messages)
                        .unwrap_or_else(|_| "[]".to_string()),
                    summary: Some(format!("{} mensagem(ns)", messages.len())),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        _ => ToolOutcome::error("action inválida: use list ou read"),
    }
}

pub fn run(
    db: &Db,
    agent_id: &str,
    tool: &str,
    args: &Value,
    settings: &Settings,
) -> ToolOutcome {
    run_with_hooks(db, agent_id, tool, args, settings, None)
}

pub fn run_with_hooks(
    db: &Db,
    agent_id: &str,
    tool: &str,
    args: &Value,
    settings: &Settings,
    hooks: Option<&dyn AgentHooks>,
) -> ToolOutcome {
    let agent = match db.get_agent(agent_id) {
        Ok(Some(agent)) => agent,
        Ok(None) => return ToolOutcome::error("AGENT_NOT_FOUND: agente não existe"),
        Err(error) => return ToolOutcome::error(format!("{error:#}")),
    };
    match tool {
        "agent_directory" => directory(db, agent_id).unwrap_or_else(|outcome| outcome),
        "agent_usage" => usage(db, agent_id, settings),
        "agent_inbox" => agent_inbox(db, agent_id, args),
        "agent_message" => {
            if !agent.capabilities.delegation {
                return ToolOutcome::error(
                    "AGENT_CAPABILITY_DENIED: a delegação não está habilitada para este agente",
                );
            }
            let Some(target) = json_str(args, "toAgentId") else {
                return ToolOutcome::error("o argumento `toAgentId` é obrigatório");
            };
            let Some(content) = json_str(args, "content") else {
                return ToolOutcome::error("o argumento `content` é obrigatório");
            };
            agent_message(db, agent_id, &target, &content, hooks)
        }
        "routine_list" => {
            if let Err(outcome) = require_automation(&agent) {
                return outcome;
            }
            match db.list_agent_routines(agent_id) {
                Ok(routines) => ToolOutcome {
                    content: serde_json::to_string_pretty(
                        &routines.iter().map(routine_json).collect::<Vec<_>>(),
                    )
                    .unwrap_or_else(|_| "[]".to_string()),
                    summary: Some(format!("{} rotina(s)", routines.len())),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "routine_create" => {
            if let Err(outcome) = require_automation(&agent) {
                return outcome;
            }
            let input = match routine_input(args, None) {
                Ok(input) => input,
                Err(error) => return ToolOutcome::error(error),
            };
            match db.create_agent_routine(agent_id, &input, crate::domain::now_ms()) {
                Ok(routine) => ToolOutcome {
                    content: serde_json::to_string_pretty(&routine_json(&routine))
                        .unwrap_or_else(|_| "{}".to_string()),
                    summary: Some(format!("Rotina criada: {}", routine.title)),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "routine_update" => {
            if let Err(outcome) = require_automation(&agent) {
                return outcome;
            }
            let routine_id = match routine_id(args) {
                Ok(id) => id,
                Err(outcome) => return outcome,
            };
            let current = match db.get_agent_routine(&routine_id) {
                Ok(Some(routine)) if routine.agent_id == agent_id => routine,
                Ok(Some(_)) => {
                    return ToolOutcome::error(
                        "AGENT_ROUTINE_FORBIDDEN: a rotina pertence a outro agente",
                    );
                }
                Ok(None) => {
                    return ToolOutcome::error("AGENT_ROUTINE_NOT_FOUND: rotina não encontrada");
                }
                Err(error) => return ToolOutcome::error(format!("{error:#}")),
            };
            let input = match routine_input(args, Some(&current)) {
                Ok(input) => input,
                Err(error) => return ToolOutcome::error(error),
            };
            match db.update_agent_routine(&routine_id, &input, crate::domain::now_ms()) {
                Ok(routine) => ToolOutcome {
                    content: serde_json::to_string_pretty(&routine_json(&routine))
                        .unwrap_or_else(|_| "{}".to_string()),
                    summary: Some(format!("Rotina atualizada: {}", routine.title)),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "routine_delete" => {
            if let Err(outcome) = require_automation(&agent) {
                return outcome;
            }
            let routine_id = match routine_id(args) {
                Ok(id) => id,
                Err(outcome) => return outcome,
            };
            match db.get_agent_routine(&routine_id) {
                Ok(Some(routine)) if routine.agent_id == agent_id => {}
                Ok(Some(_)) => {
                    return ToolOutcome::error(
                        "AGENT_ROUTINE_FORBIDDEN: a rotina pertence a outro agente",
                    );
                }
                Ok(None) => {
                    return ToolOutcome::error("AGENT_ROUTINE_NOT_FOUND: rotina não encontrada");
                }
                Err(error) => return ToolOutcome::error(format!("{error:#}")),
            }
            match db.delete_agent_routine(&routine_id) {
                Ok(()) => ToolOutcome {
                    content: json!({ "deleted": true, "routineId": routine_id }).to_string(),
                    summary: Some("Rotina removida".to_string()),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        other => ToolOutcome::error(format!("ferramenta de agente desconhecida: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::{AgentCapabilities, AgentInput};
    use crate::domain::PermissionMode;

    fn agent(db: &Db, name: &str, automation: bool) -> Agent {
        db.create_agent(&AgentInput {
            name: name.to_string(),
            role: "Assistente".to_string(),
            description: String::new(),
            emoji: "🤖".to_string(),
            department: "Geral".to_string(),
            provider_id: "opencode-go".to_string(),
            model_id: "deepseek-v4.1-flash".to_string(),
            fallback_provider_id: None,
            fallback_model_id: None,
            reasoning: None,
            instructions: String::new(),
            starters: Vec::new(),
            capabilities: AgentCapabilities {
                automation,
                delegation: true,
                ..AgentCapabilities::default()
            },
            memory_enabled: false,
            workspace_id: None,
            permission_mode: PermissionMode::Edit,
            docker_image: None,
            computer_environment: "auto".to_string(),
        })
        .expect("agent")
    }

    #[test]
    fn definitions_gate_routines_by_automation() {
        let db = Db::open_in_memory().expect("db");
        let plain = agent(&db, "Ana", false);
        let names: Vec<String> = definitions(&plain).into_iter().map(|tool| tool.name).collect();
        assert!(names.contains(&"agent_directory".to_string()));
        assert!(names.contains(&"agent_usage".to_string()));
        assert!(!names.contains(&"routine_list".to_string()));

        let automation = agent(&db, "Bia", true);
        let names: Vec<String> = definitions(&automation)
            .into_iter()
            .map(|tool| tool.name)
            .collect();
        assert!(names.contains(&"routine_create".to_string()));
        assert!(names.contains(&"routine_delete".to_string()));
    }

    #[test]
    fn agent_message_queues_and_inbox_reads_the_dm() {
        let db = Db::open_in_memory().expect("db");
        let sender = agent(&db, "Ana", false);
        let recipient = agent(&db, "Bia", false);
        let sent = run(
            &db,
            &sender.id,
            "agent_message",
            &json!({ "toAgentId": recipient.id, "content": "Revise o rascunho?" }),
            &Settings::default(),
        );
        assert!(!sent.is_error, "{}", sent.content);
        let value: serde_json::Value = serde_json::from_str(&sent.content).expect("json");
        let channel_id = value["channelId"].as_str().expect("channel").to_string();
        assert_eq!(
            db.list_pending_agent_inbox(10).expect("pending").len(),
            1
        );
        let inbox = run(
            &db,
            &recipient.id,
            "agent_inbox",
            &json!({ "action": "list" }),
            &Settings::default(),
        );
        assert!(!inbox.is_error, "{}", inbox.content);
        assert!(inbox.content.contains("Revise o rascunho?"));
        let read = run(
            &db,
            &recipient.id,
            "agent_inbox",
            &json!({ "action": "read", "channelId": channel_id }),
            &Settings::default(),
        );
        assert!(!read.is_error, "{}", read.content);
        assert!(read.content.contains("Ana"));
        let self_message = run(
            &db,
            &sender.id,
            "agent_message",
            &json!({ "toAgentId": sender.id, "content": "oi" }),
            &Settings::default(),
        );
        assert!(self_message.is_error);
        assert!(self_message.content.contains("AGENT_DM_SELF"));
    }

    #[test]
    fn directory_lists_agents_and_shared_channels_without_instructions() {
        let db = Db::open_in_memory().expect("db");
        let first = agent(&db, "Ana", false);
        let second = agent(&db, "Bia", false);
        let channel = db
            .create_agent_channel(
                &crate::agents::AgentChannelInput {
                    name: "Entrega".to_string(),
                    member_ids: vec![first.id.clone(), second.id.clone()],
                },
                crate::domain::now_ms(),
            )
            .expect("channel");
        let outcome = run(
            &db,
            &first.id,
            "agent_directory",
            &json!({}),
            &Settings::default(),
        );
        assert!(!outcome.is_error, "{}", outcome.content);
        assert!(outcome.content.contains("Ana"));
        assert!(outcome.content.contains("Bia"));
        assert!(outcome.content.contains("Entrega"));
        assert!(outcome.content.contains(&channel.id));
        assert!(!outcome.content.contains("instructions"));
    }

    #[test]
    fn routine_tools_require_automation_and_only_own_routines() {
        let db = Db::open_in_memory().expect("db");
        let first = agent(&db, "Ana", false);
        let second = agent(&db, "Bia", true);
        let denied = run(
            &db,
            &first.id,
            "routine_list",
            &json!({}),
            &Settings::default(),
        );
        assert!(denied.is_error);
        assert!(denied.content.contains("AGENT_CAPABILITY_DENIED"));

        let created = run(
            &db,
            &second.id,
            "routine_create",
            &json!({
                "title": "Resumo diário",
                "prompt": "Resuma as novidades.",
                "scheduleKind": "daily",
                "hour": 9,
                "minute": 0,
                "enabled": true,
            }),
            &Settings::default(),
        );
        assert!(!created.is_error, "{}", created.content);
        let value: serde_json::Value = serde_json::from_str(&created.content).expect("json");
        let routine_id = value["id"].as_str().expect("id").to_string();
        assert_eq!(value["scheduleKind"], "daily");

        let listed = run(
            &db,
            &second.id,
            "routine_list",
            &json!({}),
            &Settings::default(),
        );
        assert!(!listed.is_error, "{}", listed.content);
        assert!(listed.content.contains(&routine_id));

        let forbidden = run(
            &db,
            &first.id,
            "routine_delete",
            &json!({ "routineId": routine_id }),
            &Settings::default(),
        );
        assert!(forbidden.is_error);
        assert!(forbidden.content.contains("AGENT_CAPABILITY_DENIED"));

        let deleted = run(
            &db,
            &second.id,
            "routine_delete",
            &json!({ "routineId": routine_id }),
            &Settings::default(),
        );
        assert!(!deleted.is_error, "{}", deleted.content);
        assert!(db
            .list_agent_routines(&second.id)
            .expect("routines")
            .is_empty());
    }

    #[test]
    fn usage_reports_all_time_today_and_remaining_budget() {
        let db = Db::open_in_memory().expect("db");
        let current = agent(&db, "Ana", false);
        let conversation = db
            .create_agent_conversation(&current.id, "Uso")
            .expect("conversation");
        db.record_usage(
            &conversation.id,
            "m1",
            "opencode-go",
            "deepseek-v4.1-flash",
            &crate::domain::UsageInfo {
                total_tokens: Some(100),
                cost: Some(0.25),
                ..crate::domain::UsageInfo::default()
            },
        )
        .expect("usage");
        let outcome = run(
            &db,
            &current.id,
            "agent_usage",
            &json!({}),
            &Settings {
                agent_daily_cost_limit_usd: Some(1.0),
                ..Settings::default()
            },
        );
        assert!(!outcome.is_error, "{}", outcome.content);
        assert!(outcome.content.contains("\"allTime\""));
        assert!(outcome.content.contains("\"today\""));
        assert!(outcome.content.contains("\"remainingTodayUsd\": 0.75"));
    }
}
