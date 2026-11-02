//! Agent↔agent delegation tools.
//!
//! Tools only create/transition durable tasks; the background scheduler in
//! `commands::tasks` runs them under the concurrency governor. A task is always
//! owned by one agent and lives in a channel (or a standalone task thread).

use serde_json::{json, Value};

use crate::agents::AgentTaskInput;
use crate::db::Db;
use crate::providers::ToolDefinition;
use crate::tools::{json_str, ToolOutcome};

const TOOL_NAMES: &[&str] = &[
    "delegate_task",
    "task_list",
    "task_get",
    "accept_task",
    "decline_task",
    "handoff_task",
    "update_task",
    "finish_task",
    "send_message",
];

pub fn definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "delegate_task".to_string(),
            description: "Delegate a scoped piece of work to another agent. The target owns \
                          the task in its own hidden thread; the scheduler runs it under the \
                          agent/channel budget. Use small tasks with explicit acceptance criteria."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "toAgentId": { "type": "string" },
                    "title": { "type": "string" },
                    "brief": { "type": "string" },
                    "acceptance": { "type": "string" },
                    "maxTurns": { "type": "integer", "minimum": 1, "maximum": 32 },
                    "maxTokens": { "type": "integer", "minimum": 1000, "maximum": 500000 },
                    "maxCost": { "type": "number", "minimum": 0.01, "maximum": 50 },
                    "deadlineMinutes": { "type": "integer", "minimum": 1, "maximum": 1440 }
                },
                "required": ["toAgentId", "title", "brief"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "task_list".to_string(),
            description: "List delegated tasks in the current channel or owned by an agent."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "status": { "type": "string" },
                    "ownerAgentId": { "type": "string" },
                    "channelId": { "type": "string" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 100 }
                },
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "task_get".to_string(),
            description: "Read one delegated task and its event history.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": { "taskId": { "type": "string" } },
                "required": ["taskId"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "accept_task".to_string(),
            description: "Accept a task delegated to this agent (queued → accepted).".to_string(),
            parameters: json!({
                "type": "object",
                "properties": { "taskId": { "type": "string" } },
                "required": ["taskId"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "decline_task".to_string(),
            description: "Decline a task delegated to this agent with a reason.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "taskId": { "type": "string" },
                    "reason": { "type": "string" }
                },
                "required": ["taskId", "reason"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "handoff_task".to_string(),
            description: "Hand a task to another agent. The target must accept it; handoffs are \
                          limited and audited."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "taskId": { "type": "string" },
                    "toAgentId": { "type": "string" },
                    "summary": { "type": "string" },
                    "nextSteps": { "type": "string" }
                },
                "required": ["taskId", "toAgentId", "summary"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "update_task".to_string(),
            description: "Report task progress/status as the owner: waiting_input, \
                          waiting_approval, review or running."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "taskId": { "type": "string" },
                    "status": { "type": "string" },
                    "progress": { "type": "string" }
                },
                "required": ["taskId", "status"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "finish_task".to_string(),
            description: "Finish a task you own with the result and evidence.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "taskId": { "type": "string" },
                    "result": { "type": "string" },
                    "artifactIds": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["taskId", "result"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "send_message".to_string(),
            description: "Post a message to a shared channel (optionally linked to a task)."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "channelId": { "type": "string" },
                    "content": { "type": "string" },
                    "taskId": { "type": "string" }
                },
                "required": ["channelId", "content"],
                "additionalProperties": false
            }),
        },
    ]
}

pub fn is_delegation_tool(name: &str) -> bool {
    TOOL_NAMES.contains(&name)
}

pub fn tool_names() -> &'static [&'static str] {
    TOOL_NAMES
}

fn ok_task(db: &Db, task_id: &str) -> ToolOutcome {
    match db.get_agent_task(task_id) {
        Ok(Some(task)) => ToolOutcome {
            content: serde_json::to_string_pretty(&task).unwrap_or_else(|_| "{}".to_string()),
            summary: Some(format!("Tarefa · {}", task.status)),
            ..Default::default()
        },
        Ok(None) => ToolOutcome::error(format!("AGENT_TASK_NOT_FOUND: tarefa `{task_id}` não existe")),
        Err(error) => ToolOutcome::error(format!("{error:#}")),
    }
}

fn owner_check(
    db: &Db,
    task_id: &str,
    agent_id: &str,
) -> Result<crate::agents::AgentTask, ToolOutcome> {
    let task = db
        .get_agent_task(task_id)
        .map_err(|error| ToolOutcome::error(format!("{error:#}")))?
        .ok_or_else(|| {
            ToolOutcome::error(format!("AGENT_TASK_NOT_FOUND: tarefa `{task_id}` não existe"))
        })?;
    if task.owner_agent_id != agent_id {
        return Err(ToolOutcome::error(
            "AGENT_TASK_FORBIDDEN: só o agente dono pode alterar esta tarefa",
        ));
    }
    Ok(task)
}

pub fn run(
    db: &Db,
    agent_id: &str,
    conversation_id: &str,
    tool: &str,
    args: &Value,
) -> ToolOutcome {
    let agent = match db.get_agent(agent_id) {
        Ok(Some(agent)) => agent,
        Ok(None) => return ToolOutcome::error("AGENT_NOT_FOUND: agente não existe"),
        Err(error) => return ToolOutcome::error(format!("{error:#}")),
    };
    if !agent.capabilities.delegation {
        return ToolOutcome::error(
            "AGENT_CAPABILITY_DENIED: a delegação não está habilitada para este agente",
        );
    }
    let conversation = match db.get_conversation(conversation_id) {
        Ok(Some(conversation)) => conversation,
        Ok(None) => return ToolOutcome::error("AGENT_TASK_INVALID: conversa não encontrada"),
        Err(error) => return ToolOutcome::error(format!("{error:#}")),
    };
    let now = crate::domain::now_ms();
    match tool {
        "delegate_task" => {
            let Some(to_agent) = json_str(args, "toAgentId") else {
                return ToolOutcome::error("o argumento `toAgentId` é obrigatório");
            };
            let Some(title) = json_str(args, "title") else {
                return ToolOutcome::error("o argumento `title` é obrigatório");
            };
            let Some(brief) = json_str(args, "brief") else {
                return ToolOutcome::error("o argumento `brief` é obrigatório");
            };
            let input = AgentTaskInput {
                to_agent_id: to_agent,
                title,
                brief,
                acceptance: json_str(args, "acceptance").unwrap_or_default(),
                channel_id: conversation.channel_id.clone(),
                parent_task_id: conversation.task_id.clone(),
                max_turns: args.get("maxTurns").and_then(Value::as_u64).map(|v| v as u32),
                max_tokens: args.get("maxTokens").and_then(Value::as_u64).map(|v| v as u32),
                max_cost: args.get("maxCost").and_then(Value::as_f64),
                deadline_minutes: args
                    .get("deadlineMinutes")
                    .and_then(Value::as_u64)
                    .map(|v| v as u32),
            };
            let input = match input.normalize() {
                Ok(input) => input,
                Err(error) => return ToolOutcome::error(error),
            };
            match db.create_agent_task(&input, Some(agent_id), false, now) {
                Ok(task) => ToolOutcome {
                    content: serde_json::to_string_pretty(&task).unwrap_or_else(|_| "{}".to_string()),
                    summary: Some(format!("Delegada para {}", task.owner_agent_id)),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "task_list" => {
            let status = json_str(args, "status");
            let owner = json_str(args, "ownerAgentId");
            let channel = conversation.channel_id.as_deref().map(str::to_string);
            match db.list_agent_tasks(
                status.as_deref(),
                owner.as_deref(),
                json_str(args, "channelId").as_deref().or(channel.as_deref()),
                Some(
                    args.get("limit")
                        .and_then(Value::as_u64)
                        .unwrap_or(50)
                        .clamp(1, 100) as u32,
                ),
            ) {
                Ok(tasks) => ToolOutcome {
                    content: serde_json::to_string_pretty(&tasks)
                        .unwrap_or_else(|_| "[]".to_string()),
                    summary: Some(format!("{} tarefa(s)", tasks.len())),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "task_get" => {
            let Some(task_id) = json_str(args, "taskId") else {
                return ToolOutcome::error("o argumento `taskId` é obrigatório");
            };
            match db.get_agent_task(&task_id) {
                Ok(Some(task)) => match db.list_agent_task_events(&task_id) {
                    Ok(events) => ToolOutcome {
                        content: serde_json::to_string_pretty(&json!({
                            "task": task,
                            "events": events,
                        }))
                        .unwrap_or_else(|_| "{}".to_string()),
                        summary: Some(format!("Tarefa · {}", task.status)),
                        ..Default::default()
                    },
                    Err(error) => ToolOutcome::error(format!("{error:#}")),
                },
                Ok(None) => ToolOutcome::error(format!(
                    "AGENT_TASK_NOT_FOUND: tarefa `{task_id}` não existe"
                )),
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "accept_task" => {
            let Some(task_id) = json_str(args, "taskId") else {
                return ToolOutcome::error("o argumento `taskId` é obrigatório");
            };
            if let Err(outcome) = owner_check(db, &task_id, agent_id) {
                return outcome;
            }
            match db.transition_agent_task(
                &task_id,
                "accepted",
                "agent",
                json!({ "acceptedBy": agent_id }),
                None,
                None,
                now,
            ) {
                Ok(_) => ok_task(db, &task_id),
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "decline_task" => {
            let Some(task_id) = json_str(args, "taskId") else {
                return ToolOutcome::error("o argumento `taskId` é obrigatório");
            };
            if let Err(outcome) = owner_check(db, &task_id, agent_id) {
                return outcome;
            }
            let reason = json_str(args, "reason").unwrap_or_else(|| "sem motivo".to_string());
            match db.transition_agent_task(
                &task_id,
                "declined",
                "agent",
                json!({ "reason": reason }),
                Some(&reason),
                None,
                now,
            ) {
                Ok(_) => ok_task(db, &task_id),
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "handoff_task" => {
            let Some(task_id) = json_str(args, "taskId") else {
                return ToolOutcome::error("o argumento `taskId` é obrigatório");
            };
            if let Err(outcome) = owner_check(db, &task_id, agent_id) {
                return outcome;
            }
            let Some(to_agent) = json_str(args, "toAgentId") else {
                return ToolOutcome::error("o argumento `toAgentId` é obrigatório");
            };
            let summary = json_str(args, "summary").unwrap_or_default();
            let next_steps = json_str(args, "nextSteps").unwrap_or_default();
            let combined = format!("{summary}\n\nPróximos passos: {next_steps}");
            match db.handoff_agent_task(&task_id, &to_agent, "agent", &combined, now) {
                Ok(_) => ok_task(db, &task_id),
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "update_task" => {
            let Some(task_id) = json_str(args, "taskId") else {
                return ToolOutcome::error("o argumento `taskId` é obrigatório");
            };
            if let Err(outcome) = owner_check(db, &task_id, agent_id) {
                return outcome;
            }
            let Some(status) = json_str(args, "status") else {
                return ToolOutcome::error("o argumento `status` é obrigatório");
            };
            if !matches!(
                status.as_str(),
                "running" | "waiting_input" | "waiting_approval" | "review"
            ) {
                return ToolOutcome::error(
                    "status inválido: use running, waiting_input, waiting_approval ou review",
                );
            }
            let progress = json_str(args, "progress").unwrap_or_default();
            match db.transition_agent_task(
                &task_id,
                &status,
                "agent",
                json!({ "progress": progress }),
                None,
                None,
                now,
            ) {
                Ok(_) => ok_task(db, &task_id),
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "finish_task" => {
            let Some(task_id) = json_str(args, "taskId") else {
                return ToolOutcome::error("o argumento `taskId` é obrigatório");
            };
            if let Err(outcome) = owner_check(db, &task_id, agent_id) {
                return outcome;
            }
            let Some(result) = json_str(args, "result") else {
                return ToolOutcome::error("o argumento `result` é obrigatório");
            };
            if result.trim().is_empty() {
                return ToolOutcome::error("o resultado não pode ser vazio");
            }
            let artifacts: Vec<String> = args
                .get("artifactIds")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            match db.transition_agent_task(
                &task_id,
                "done",
                "agent",
                json!({ "result": result }),
                Some(&result),
                Some(&artifacts),
                now,
            ) {
                Ok(_) => ok_task(db, &task_id),
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "send_message" => {
            let Some(channel_id) = json_str(args, "channelId") else {
                return ToolOutcome::error("o argumento `channelId` é obrigatório");
            };
            let Some(content) = json_str(args, "content") else {
                return ToolOutcome::error("o argumento `content` é obrigatório");
            };
            if content.trim().is_empty() {
                return ToolOutcome::error("a mensagem não pode ser vazia");
            }
            match db.get_agent_channel(&channel_id) {
                Ok(Some(channel)) => {
                    if !channel.member_ids.iter().any(|id| id == agent_id) {
                        return ToolOutcome::error(
                            "AGENT_TASK_FORBIDDEN: este agente não participa do canal",
                        );
                    }
                }
                Ok(None) => return ToolOutcome::error("AGENT_TASK_INVALID: canal não encontrado"),
                Err(error) => return ToolOutcome::error(format!("{error:#}")),
            }
            match db.append_agent_channel_message(
                &channel_id,
                "agent",
                Some(agent_id),
                content.trim(),
                now,
            ) {
                Ok(message) => ToolOutcome {
                    content: serde_json::to_string_pretty(&message)
                        .unwrap_or_else(|_| "{}".to_string()),
                    summary: Some("Mensagem publicada".to_string()),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        other => ToolOutcome::error(format!("ferramenta de tarefa desconhecida: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::{AgentCapabilities, AgentInput};
    use crate::domain::PermissionMode;

    fn agent(db: &Db, name: &str, delegation: bool) -> crate::agents::Agent {
        db.create_agent(&AgentInput {
            name: name.to_string(),
            role: "Engenheiro".to_string(),
            description: String::new(),
            emoji: "🛠️".to_string(),
            department: "Geral".to_string(),
            provider_id: "opencode-go".to_string(),
            model_id: "deepseek-v4.1-flash".to_string(),
            fallback_provider_id: None,
            fallback_model_id: None,
            reasoning: None,
            instructions: String::new(),
            starters: Vec::new(),
            capabilities: AgentCapabilities {
                delegation,
                ..AgentCapabilities::default()
            },
            memory_enabled: false,
            workspace_id: None,
            permission_mode: PermissionMode::Edit,
            docker_image: None,
        })
        .expect("agent")
    }

    fn task_status(db: &Db, id: &str) -> String {
        db.get_agent_task(id).expect("task").expect("exists").status
    }

    #[test]
    fn delegate_accept_finish_round_trip() {
        let db = Db::open_in_memory().expect("db");
        let first = agent(&db, "Ana", true);
        let second = agent(&db, "Bia", true);
        let conversation = db
            .create_agent_conversation(&first.id, "Coordenação")
            .expect("conversation");
        let delegated = run(
            &db,
            &first.id,
            &conversation.id,
            "delegate_task",
            &serde_json::json!({
                "toAgentId": second.id,
                "title": "Revisar o relatório",
                "brief": "Leia e liste riscos.",
                "acceptance": "Lista com páginas.",
            }),
        );
        assert!(!delegated.is_error, "{}", delegated.content);
        let value: serde_json::Value = serde_json::from_str(&delegated.content).expect("json");
        let task_id = value["id"].as_str().expect("id").to_string();
        assert_eq!(task_status(&db, &task_id), "queued");

        let accepted = run(
            &db,
            &second.id,
            &conversation.id,
            "accept_task",
            &serde_json::json!({ "taskId": task_id }),
        );
        assert!(!accepted.is_error, "{}", accepted.content);
        assert_eq!(task_status(&db, &task_id), "accepted");

        let finished = run(
            &db,
            &second.id,
            &conversation.id,
            "finish_task",
            &serde_json::json!({
                "taskId": task_id,
                "result": "Três riscos encontrados com referência.",
            }),
        );
        assert!(!finished.is_error, "{}", finished.content);
        assert_eq!(task_status(&db, &task_id), "done");
    }

    #[test]
    fn handoff_waits_for_target_acceptance_and_is_not_scheduled() {
        let db = Db::open_in_memory().expect("db");
        let first = agent(&db, "Ana", true);
        let second = agent(&db, "Bia", true);
        let third = agent(&db, "Caio", true);
        let conversation = db
            .create_agent_conversation(&first.id, "Handoff")
            .expect("conversation");
        let delegated = run(
            &db,
            &first.id,
            &conversation.id,
            "delegate_task",
            &serde_json::json!({
                "toAgentId": second.id,
                "title": "Preparar entrega",
                "brief": "Prepare o pacote.",
            }),
        );
        assert!(!delegated.is_error, "{}", delegated.content);
        let value: serde_json::Value = serde_json::from_str(&delegated.content).expect("json");
        let task_id = value["id"].as_str().expect("id").to_string();
        let accepted = run(
            &db,
            &second.id,
            &conversation.id,
            "accept_task",
            &serde_json::json!({ "taskId": task_id }),
        );
        assert!(!accepted.is_error, "{}", accepted.content);

        let handoff = run(
            &db,
            &second.id,
            &conversation.id,
            "handoff_task",
            &serde_json::json!({
                "taskId": task_id,
                "toAgentId": third.id,
                "summary": "Precisa da revisão final.",
                "nextSteps": "Revisar e publicar.",
            }),
        );
        assert!(!handoff.is_error, "{}", handoff.content);
        assert_eq!(task_status(&db, &task_id), "handoff_pending");
        assert!(db
            .list_queued_agent_tasks(crate::domain::now_ms(), 10)
            .expect("queued")
            .iter()
            .all(|entry| entry.id != task_id));
        let wrong_owner = run(
            &db,
            &second.id,
            &conversation.id,
            "accept_task",
            &serde_json::json!({ "taskId": task_id }),
        );
        assert!(wrong_owner.is_error);
        assert!(wrong_owner.content.contains("AGENT_TASK_FORBIDDEN"));

        let accepted = run(
            &db,
            &third.id,
            &conversation.id,
            "accept_task",
            &serde_json::json!({ "taskId": task_id }),
        );
        assert!(!accepted.is_error, "{}", accepted.content);
        assert_eq!(task_status(&db, &task_id), "accepted");

        let second_handoff = run(
            &db,
            &third.id,
            &conversation.id,
            "handoff_task",
            &serde_json::json!({
                "taskId": task_id,
                "toAgentId": second.id,
                "summary": "Devolvendo com dúvida.",
            }),
        );
        assert!(!second_handoff.is_error, "{}", second_handoff.content);
        assert_eq!(task_status(&db, &task_id), "handoff_pending");
        let declined = run(
            &db,
            &second.id,
            &conversation.id,
            "decline_task",
            &serde_json::json!({ "taskId": task_id, "reason": "sem contexto" }),
        );
        assert!(!declined.is_error, "{}", declined.content);
        assert_eq!(task_status(&db, &task_id), "declined");
    }

    #[test]
    fn delegation_requires_the_capability_and_ownership() {
        let db = Db::open_in_memory().expect("db");
        let first = agent(&db, "Ana", false);
        let second = agent(&db, "Bia", true);
        let third = agent(&db, "Caio", true);
        let conversation = db
            .create_agent_conversation(&first.id, "Sem capability")
            .expect("conversation");
        let denied = run(
            &db,
            &first.id,
            &conversation.id,
            "delegate_task",
            &serde_json::json!({
                "toAgentId": second.id,
                "title": "Tarefa",
                "brief": "Faça.",
            }),
        );
        assert!(denied.is_error);
        assert!(denied.content.contains("AGENT_CAPABILITY_DENIED"));

        let delegated = run(
            &db,
            &second.id,
            &conversation.id,
            "delegate_task",
            &serde_json::json!({
                "toAgentId": second.id,
                "title": "Própria",
                "brief": "Faça.",
            }),
        );
        assert!(!delegated.is_error, "{}", delegated.content);
        let value: serde_json::Value = serde_json::from_str(&delegated.content).expect("json");
        let task_id = value["id"].as_str().expect("id").to_string();
        let forbidden = run(
            &db,
            &third.id,
            &conversation.id,
            "finish_task",
            &serde_json::json!({ "taskId": task_id, "result": "não sou o dono" }),
        );
        assert!(forbidden.is_error);
        assert!(forbidden.content.contains("AGENT_TASK_FORBIDDEN"));
    }
}
