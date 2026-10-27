//! Planejamento e interação: `todo_write`, `submit_plan` e `ask_user`
//! (TOOLS.md §2.5).
//!
//! F0: schemas e metadados definitivos; execução é stub `not_wired`.

use serde_json::{json, Value};

use crate::domain::{RiskClass, TurnProfile};
use crate::providers::ToolDefinition;
use crate::tools::code::{definition_of, not_wired};
use crate::tools::registry::{ParallelClass, ToolCtx, ToolSpec};
use crate::tools::ToolOutcome;

pub static TODO_WRITE_SPEC: ToolSpec = ToolSpec {
    name: "todo_write",
    description: "Replace the session todo list. Use it to plan multi-step work, mark the active task and check tasks off as they finish.",
    schema: todo_write_schema,
    parallel: ParallelClass::Exclusive,
    risk: RiskClass::Write,
    mutating: true,
    requires_workspace: false,
    profiles: &[TurnProfile::Code],
    guidance: "Mantenha a lista de tarefas viva com `todo_write` (substitui a lista inteira): no máximo uma tarefa `in_progress`, itens curtos e concretos, e marque `completed` assim que terminar.",
};

pub static SUBMIT_PLAN_SPEC: ToolSpec = ToolSpec {
    name: "submit_plan",
    description: "Submit an implementation plan for human review while Plan mode is active. The turn pauses until the user approves or asks for changes.",
    schema: submit_plan_schema,
    parallel: ParallelClass::Exclusive,
    risk: RiskClass::Ask,
    mutating: false,
    requires_workspace: false,
    profiles: &[TurnProfile::Code],
    guidance: "No modo Plano, use `submit_plan` para apresentar o plano antes de executar: comece com um heading, liste arquivos a tocar, passos, riscos e como verificar. Não inclua a implementação completa.",
};

pub static ASK_USER_SPEC: ToolSpec = ToolSpec {
    name: "ask_user",
    description: "Ask the user a structured question with optional choices. Blocks the turn until answered; timeouts never count as approval.",
    schema: ask_user_schema,
    parallel: ParallelClass::Exclusive,
    risk: RiskClass::Ask,
    mutating: false,
    requires_workspace: false,
    profiles: &[TurnProfile::Code],
    guidance: "Use `ask_user` só quando uma decisão do usuário bloquear o trabalho (ambiguidade real); ofereça opções curtas com a recomendada primeiro e texto livre opcional.",
};

pub fn definition() -> ToolDefinition {
    definition_of(spec())
}

pub fn spec() -> &'static ToolSpec {
    &TODO_WRITE_SPEC
}

pub async fn run(_ctx: &ToolCtx, _args: Value) -> ToolOutcome {
    not_wired("todo_write")
}

fn todo_write_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "todos": {
                "type": "array",
                "description": "Complete todo list; replaces the previous one.",
                "items": {
                    "type": "object",
                    "properties": {
                        "content": {
                            "type": "string",
                            "description": "Short, concrete task description."
                        },
                        "status": {
                            "type": "string",
                            "enum": ["pending", "in_progress", "completed"],
                            "description": "Task status."
                        }
                    },
                    "required": ["content", "status"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["todos"],
        "additionalProperties": false
    })
}

fn submit_plan_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "plan": {
                "type": "string",
                "description": "Plan in Markdown: context, files to change, steps, risks and verification."
            }
        },
        "required": ["plan"],
        "additionalProperties": false
    })
}

fn ask_user_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "questions": {
                "type": "array",
                "description": "Questions to ask in one batch.",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {
                            "type": "string",
                            "description": "Stable id used to correlate the answer."
                        },
                        "header": {
                            "type": "string",
                            "description": "Short heading for the question card."
                        },
                        "question": {
                            "type": "string",
                            "description": "Question text."
                        },
                        "options": {
                            "type": "array",
                            "description": "Selectable options; put the recommended one first.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "label": { "type": "string" },
                                    "description": { "type": "string" }
                                },
                                "required": ["label"]
                            }
                        },
                        "multi_select": {
                            "type": "boolean",
                            "description": "Allow selecting more than one option. Defaults to false."
                        }
                    },
                    "required": ["id", "question"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["questions"],
        "additionalProperties": false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn planning_schemas_are_strict_objects() {
        for spec in [&TODO_WRITE_SPEC, &SUBMIT_PLAN_SPEC, &ASK_USER_SPEC] {
            let schema = (spec.schema)();
            assert_eq!(schema["type"], "object", "{}", spec.name);
            assert_eq!(schema["additionalProperties"], false, "{}", spec.name);
        }
        let schema = (TODO_WRITE_SPEC.schema)();
        assert_eq!(schema["properties"]["todos"]["items"]["properties"]["status"]["enum"][1], "in_progress");
    }
}
