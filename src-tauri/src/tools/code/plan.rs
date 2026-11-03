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
    description: "Replace the session todo list. Use it to plan multi-step work, mark the active task and check tasks off as they finish. Send an empty list to clear it.",
    schema: todo_write_schema,
    parallel: ParallelClass::Exclusive,
    // Estado de sessão (não muta o workspace): permitido no modo Plano e sem
    // gate de política (PLAN.md D8).
    risk: RiskClass::Read,
    mutating: false,
    requires_workspace: false,
    profiles: &[TurnProfile::Code],
    guidance: "Keep the task list up to date with `todo_write` (it replaces the whole list): at most one `in_progress` task, short and concrete items, mark `completed` as soon as you finish and send `[]` to clear the list.",
};

pub static SUBMIT_PLAN_SPEC: ToolSpec = ToolSpec {
    name: "submit_plan",
    description: "Submit an implementation-ready plan for human review while Plan mode is active. The plan must let another engineer execute it without re-deciding the design. The turn pauses until the user approves or asks for changes.",
    schema: submit_plan_schema,
    parallel: ParallelClass::Exclusive,
    risk: RiskClass::Ask,
    mutating: false,
    requires_workspace: false,
    profiles: &[TurnProfile::Code],
    guidance: "Use `submit_plan` only in Plan mode, once the plan is implementation-ready. Investigate the repository first; never invent paths. Required: goal, current context with exact files/symbols, in/out scope, changes per file, ordered steps with observable completion criteria, tests/commands with expected results, risks/rollback and an acceptance checklist. Be concise (2-6k chars typical; 20k max, 300 min): no filler, no restating the request, no full implementation or diff; code only for ambiguous interfaces (max 10 lines). On feedback, address every point and resubmit.",
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
    guidance: "Use `ask_user` only when a user decision blocks the work (real ambiguity); offer short options with the recommended one first and optional free text.",
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
                "description": "Implementation-ready plan in Markdown, in the response language. Required outline (merge sections only for trivial changes): short title and one-sentence goal; current context with exact files/symbols, constraints and assumptions; in/out scope; changes per file (table: file, symbol/area, change, why); ordered steps that each name files/symbols and an observable completion criterion; tests and verification with commands, cases and expected results; risks, edge cases, compatibility/migration and rollback; acceptance checklist. Be concise: 2-6k chars typical (max 20k, min 300), no filler, no restating the request, no full implementation or diff; code only for ambiguous interfaces (max 10 lines)."
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
                            "description": "Short heading for the question card. For a request that the user intervene in the agent's computer, use exactly computer_desktop or computer_browser; this offers a link to the matching panel, but never grants control or answers the question. Ask the user to take control, finish the step, return control, and then answer. Include a selectable completion option; free-text answers are disabled for these requests. Never request credentials or codes in chat."
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

    #[test]
    fn submit_plan_contract_requires_an_implementation_ready_plan() {
        let guidance = SUBMIT_PLAN_SPEC.guidance;
        for needle in [
            "implementation-ready",
            "exact files/symbols",
            "observable completion criteria",
            "tests/commands",
            "risks/rollback",
            "acceptance checklist",
            "2-6k",
            "300 min",
        ] {
            assert!(guidance.contains(needle), "missing {needle:?}: {guidance}");
        }
        assert!(
            guidance.chars().count() <= crate::harness::code::prompt::MAX_TOOL_GUIDANCE_CHARS,
            "guidance acima do cap do prompt: {} chars",
            guidance.chars().count()
        );
        assert!(SUBMIT_PLAN_SPEC.description.contains("implementation-ready"));

        let schema = (SUBMIT_PLAN_SPEC.schema)();
        let description = schema["properties"]["plan"]["description"]
            .as_str()
            .expect("descrição do plano");
        for needle in [
            "exact files/symbols",
            "observable completion criterion",
            "tests and verification",
            "risks",
            "acceptance checklist",
            "2-6k",
            "min 300",
        ] {
            assert!(
                description.contains(needle),
                "plan description sem {needle:?}: {description}"
            );
        }
    }
}
