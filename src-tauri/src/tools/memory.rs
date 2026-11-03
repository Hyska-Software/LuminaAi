//! Durable agent memory tool.
//!
//! Available only for turns of an agent with `memory_enabled`. The tool writes
//! to `agent_memories`, which is shared by every conversation of that persona;
//! the harness injects the stored memories as a volatile `surface_item`, never
//! into the cached system prompt.

use serde_json::{json, Value};

use crate::agents::AgentMemoryInput;
use crate::providers::ToolDefinition;

use super::{json_str, ToolOutcome, ToolRuntime};

pub fn definition() -> ToolDefinition {
    ToolDefinition {
        name: "memory".to_string(),
        description: "Save, list or forget durable notes for this agent (shared by every \
                      conversation). Use it for stable facts, user preferences and procedures; \
                      never store secrets, credentials or transient state."
            .to_string(),
        parameters: json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list", "save", "update", "forget"],
                    "description": "list stored memories; save/update a note; forget one note."
                },
                "content": {
                    "type": "string",
                    "description": "Required for save. Short, specific, self-contained note."
                },
                "kind": {
                    "type": "string",
                    "enum": ["fact", "preference", "procedure", "note"],
                    "description": "Optional classification for save (default: fact)."
                },
                "scope": {
                    "type": "string",
                    "enum": ["private", "shared"],
                    "description": "private (default) or shared across agents with sharedMemory."
                },
                "pinned": {
                    "type": "boolean",
                    "description": "Optional: pin a saved memory so it is always shown first."
                },
                "id": {
                    "type": "string",
                    "description": "Required for forget: memory id returned by list/save."
                }
            },
            "required": ["action"],
            "additionalProperties": false
        }),
    }
}

pub fn run(rt: &ToolRuntime, args: &Value) -> ToolOutcome {
    let Some(agent_id) = rt.options.agent_id.as_deref() else {
        return ToolOutcome::error("a memória durável só existe em conversas de um agente");
    };
    if !rt.options.agent_memory {
        return ToolOutcome::error("a memória deste agente está desativada");
    }
    run_with(&rt.db, agent_id, &rt.conversation_id, args)
}

/// Shared implementation for the Chat and Code profiles.
pub fn run_with(
    db: &crate::db::Db,
    agent_id: &str,
    conversation_id: &str,
    args: &Value,
) -> ToolOutcome {
    let action = json_str(args, "action")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let scope = json_str(args, "scope")
        .unwrap_or_else(|| "private".to_string())
        .trim()
        .to_ascii_lowercase();
    if !matches!(scope.as_str(), "private" | "shared") {
        return ToolOutcome::error("scope inválido: use private ou shared");
    }
    let shared_allowed = || -> Result<(), ToolOutcome> {
        match db.get_agent(agent_id) {
            Ok(Some(agent))
                if agent.memory_enabled && agent.capabilities.shared_memory =>
            {
                Ok(())
            }
            Ok(Some(_)) => Err(ToolOutcome::error(
                "AGENT_CAPABILITY_DENIED: memória compartilhada não está habilitada para este agente",
            )),
            Ok(None) => Err(ToolOutcome::error("AGENT_NOT_FOUND: agente não existe")),
            Err(error) => Err(ToolOutcome::error(format!("{error:#}"))),
        }
    };
    match action.as_str() {
        "list" => {
            if scope == "shared" {
                if let Err(outcome) = shared_allowed() {
                    return outcome;
                }
                return match db.list_agent_shared_memories() {
                    Ok(memories) => ToolOutcome {
                        content: serde_json::to_string_pretty(&memories)
                            .unwrap_or_else(|_| "[]".to_string()),
                        summary: Some(format!("{} memória(s) compartilhada(s)", memories.len())),
                        ..Default::default()
                    },
                    Err(error) => {
                        ToolOutcome::error(format!("não foi possível ler as memórias: {error:#}"))
                    }
                };
            }
            match db.list_agent_memories(agent_id) {
                Ok(memories) => ToolOutcome {
                    content: serde_json::to_string_pretty(&memories)
                        .unwrap_or_else(|_| "[]".to_string()),
                    summary: Some(if memories.len() == 1 {
                        "1 memória".to_string()
                    } else {
                        format!("{} memórias", memories.len())
                    }),
                    ..Default::default()
                },
                Err(error) => {
                    ToolOutcome::error(format!("não foi possível ler as memórias: {error:#}"))
                }
            }
        }
        "save" => {
            let Some(content) = json_str(args, "content") else {
                return ToolOutcome::error("o argumento `content` é obrigatório para salvar");
            };
            let input = AgentMemoryInput {
                kind: json_str(args, "kind").unwrap_or_else(|| "fact".to_string()),
                content,
                source_conversation_id: Some(conversation_id.to_string()),
                pinned: args.get("pinned").and_then(Value::as_bool).unwrap_or(false),
            };
            let input = match input.normalize() {
                Ok(input) => input,
                Err(error) => return ToolOutcome::error(error),
            };
            if scope == "shared" {
                if let Err(outcome) = shared_allowed() {
                    return outcome;
                }
                return match db.create_agent_shared_memory(agent_id, &input) {
                    Ok(memory) => ToolOutcome {
                        content: serde_json::to_string_pretty(&json!({
                            "saved": true,
                            "scope": "shared",
                            "id": memory.id,
                            "kind": memory.kind,
                        }))
                        .unwrap_or_else(|_| "{\"saved\":true}".to_string()),
                        summary: Some("Memória compartilhada salva".to_string()),
                        ..Default::default()
                    },
                    Err(error) => {
                        ToolOutcome::error(format!("não foi possível salvar: {error:#}"))
                    }
                };
            }
            match db.create_agent_memory(agent_id, &input) {
                Ok(memory) => ToolOutcome {
                    content: serde_json::to_string_pretty(&json!({
                        "saved": true,
                        "scope": "private",
                        "id": memory.id,
                        "kind": memory.kind,
                    }))
                    .unwrap_or_else(|_| "{\"saved\":true}".to_string()),
                    summary: Some("Memória salva".to_string()),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("não foi possível salvar: {error:#}")),
            }
        }
        "update" => {
            let Some(id) = json_str(args, "id") else {
                return ToolOutcome::error("o argumento `id` é obrigatório para atualizar");
            };
            let Some(content) = json_str(args, "content") else {
                return ToolOutcome::error("o argumento `content` é obrigatório para atualizar");
            };
            if scope == "shared" {
                if let Err(outcome) = shared_allowed() {
                    return outcome;
                }
                let existing = match db.get_agent_shared_memory(id.trim()) {
                    Ok(Some(memory)) if memory.source_agent_id.as_deref() == Some(agent_id) => {
                        memory
                    }
                    Ok(Some(_)) => {
                        return ToolOutcome::error(
                            "AGENT_MEMORY_FORBIDDEN: a memória foi criada por outro agente",
                        );
                    }
                    Ok(None) => {
                        return ToolOutcome::error("memória compartilhada não encontrada");
                    }
                    Err(error) => {
                        return ToolOutcome::error(format!(
                            "não foi possível ler a memória: {error:#}"
                        ));
                    }
                };
                let input = AgentMemoryInput {
                    kind: json_str(args, "kind").unwrap_or(existing.kind),
                    content,
                    source_conversation_id: Some(conversation_id.to_string()),
                    pinned: args
                        .get("pinned")
                        .and_then(Value::as_bool)
                        .unwrap_or(existing.pinned),
                };
                let input = match input.normalize() {
                    Ok(input) => input,
                    Err(error) => return ToolOutcome::error(error),
                };
                return match db.update_agent_shared_memory(id.trim(), agent_id, &input) {
                    Ok(memory) => ToolOutcome {
                        content: serde_json::to_string_pretty(&json!({
                            "updated": true,
                            "scope": "shared",
                            "id": memory.id,
                            "kind": memory.kind,
                        }))
                        .unwrap_or_else(|_| "{\"updated\":true}".to_string()),
                        summary: Some("Memória compartilhada atualizada".to_string()),
                        ..Default::default()
                    },
                    Err(error) => {
                        ToolOutcome::error(format!("não foi possível atualizar: {error:#}"))
                    }
                };
            }
            let existing = match db.get_agent_memory(agent_id, id.trim()) {
                Ok(Some(memory)) => memory,
                Ok(None) => {
                    return ToolOutcome::error("memória não encontrada para este agente");
                }
                Err(error) => {
                    return ToolOutcome::error(format!("não foi possível ler a memória: {error:#}"));
                }
            };
            let input = AgentMemoryInput {
                kind: json_str(args, "kind").unwrap_or(existing.kind),
                content,
                source_conversation_id: Some(conversation_id.to_string()),
                pinned: args
                    .get("pinned")
                    .and_then(Value::as_bool)
                    .unwrap_or(existing.pinned),
            };
            let input = match input.normalize() {
                Ok(input) => input,
                Err(error) => return ToolOutcome::error(error),
            };
            match db.update_agent_memory(agent_id, id.trim(), &input) {
                Ok(memory) => ToolOutcome {
                    content: serde_json::to_string_pretty(&json!({
                        "updated": true,
                        "scope": "private",
                        "id": memory.id,
                        "kind": memory.kind,
                    }))
                    .unwrap_or_else(|_| "{\"updated\":true}".to_string()),
                    summary: Some("Memória atualizada".to_string()),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("não foi possível atualizar: {error:#}")),
            }
        }
        "forget" => {
            let Some(id) = json_str(args, "id") else {
                return ToolOutcome::error("o argumento `id` é obrigatório para esquecer");
            };
            if scope == "shared" {
                if let Err(outcome) = shared_allowed() {
                    return outcome;
                }
                return match db.delete_agent_shared_memory(id.trim(), agent_id) {
                    Ok(()) => ToolOutcome {
                        content: json!({
                            "forgotten": true,
                            "scope": "shared",
                            "id": id.trim()
                        })
                        .to_string(),
                        summary: Some("Memória compartilhada removida".to_string()),
                        ..Default::default()
                    },
                    Err(error) => {
                        ToolOutcome::error(format!("não foi possível remover: {error:#}"))
                    }
                };
            }
            match db.delete_agent_memory(agent_id, id.trim()) {
                Ok(()) => ToolOutcome {
                    content: json!({
                        "forgotten": true,
                        "scope": "private",
                        "id": id.trim()
                    })
                    .to_string(),
                    summary: Some("Memória removida".to_string()),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("não foi possível remover: {error:#}")),
            }
        }
        _ => ToolOutcome::error("action inválida: use list, save, update ou forget"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Settings, TurnOptions};
    use crate::tools::skills::ExternalSkillRoot;
    use std::path::PathBuf;
    use tokio_util::sync::CancellationToken;

    fn runtime(agent_id: Option<&str>, memory: bool) -> ToolRuntime {
        let db = crate::db::Db::open_in_memory().expect("db");
        let mut options = TurnOptions::default();
        options.agent_id = agent_id.map(str::to_string);
        options.agent_memory = memory;
        ToolRuntime {
            db: std::sync::Arc::new(db),
            http: reqwest::Client::new(),
            conversation_id: "conversation-1".to_string(),
            message_id: "message-1".to_string(),
            options,
            settings: Settings::default(),
            cancel: CancellationToken::new(),
            agent_hooks: None,
            data_dir: PathBuf::new(),
            skills_roots: Vec::<ExternalSkillRoot>::new(),
        }
    }

    #[test]
    fn memory_requires_an_agent_turn() {
        let rt = runtime(None, true);
        let outcome = run(&rt, &json!({ "action": "list" }));
        assert!(outcome.is_error);
        assert!(outcome.content.contains("conversas de um agente"));
    }

    #[test]
    fn memory_saves_lists_and_forgets() {
        let rt = runtime(Some("agent-1"), true);
        let input = AgentMemoryInput {
            kind: "fact".to_string(),
            content: "Prefere respostas curtas.".to_string(),
            source_conversation_id: None,
            pinned: false,
        };
        // The DB method validates the agent exists; create it through the same
        // schema used by production.
        let agent = crate::agents::AgentInput {
            name: "Irineu".to_string(),
            role: "Engenheiro".to_string(),
            description: String::new(),
            emoji: "🤖".to_string(),
            department: "Geral".to_string(),
            provider_id: "opencode-go".to_string(),
            model_id: "glm-5.3-flash".to_string(),
            fallback_provider_id: None,
            fallback_model_id: None,
            reasoning: None,
            instructions: String::new(),
            starters: Vec::new(),
            capabilities: crate::agents::AgentCapabilities::default(),
            memory_enabled: true,
            workspace_id: None,
            permission_mode: crate::domain::PermissionMode::Edit,
            docker_image: None,
            computer_environment: "auto".to_string(),
        };
        let agent = rt.db.create_agent(&agent).expect("agent");
        let rt = ToolRuntime {
            options: {
                let mut options = rt.options.clone();
                options.agent_id = Some(agent.id.clone());
                options
            },
            ..rt
        };
        let saved = run(&rt, &json!({ "action": "save", "content": input.content }));
        assert!(!saved.is_error, "{}", saved.content);
        let listed = run(&rt, &json!({ "action": "list" }));
        assert!(listed.content.contains("Prefere respostas curtas."));
        let id = serde_json::from_str::<Value>(&saved.content)
            .ok()
            .and_then(|value| value.get("id").and_then(Value::as_str).map(str::to_string))
            .expect("id");
        let updated = run(
            &rt,
            &json!({
                "action": "update",
                "id": id,
                "content": "Prefere respostas curtas e cita fontes."
            }),
        );
        assert!(!updated.is_error, "{}", updated.content);
        assert!(run(&rt, &json!({ "action": "list" }))
            .content
            .contains("cita fontes"));
        let forgotten = run(&rt, &json!({ "action": "forget", "id": id }));
        assert!(!forgotten.is_error, "{}", forgotten.content);
        assert!(run(&rt, &json!({ "action": "list" }))
            .content
            .contains("[]"));
    }
}
