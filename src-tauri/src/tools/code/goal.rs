//! Tool `goal`: o modelo reporta progresso, conclui ou bloqueia o objetivo
//! persistente da sessão (PLAN §8.3).
//!
//! `create`/`edit` só valem em **turno humano** (o modelo não define nem
//! reescreve o objetivo sozinho); `progress`/`complete`/`blocked` valem em
//! qualquer turno. Pausar/retomar/armar/encerrar são ações da UI (D8).
//!
//! Metadados/schema são a fonte única do prompt (registry); a execução real fica
//! em [`crate::tools::code::exec`] e chama [`crate::harness::code::goal`].

use serde_json::{json, Value};

use crate::domain::{RiskClass, TurnProfile};
use crate::providers::ToolDefinition;
use crate::tools::code::definition_of;
use crate::tools::registry::{ParallelClass, ToolSpec};

pub static GOAL_SPEC: ToolSpec = ToolSpec {
    name: "goal",
    description: "Create the session objective from the user's request, report progress, mark it complete, or register a blocker. Creating or editing the objective is only allowed in a human turn.",
    schema: goal_schema,
    parallel: ParallelClass::Exclusive,
    // Metadado de sessão (como `todo_write`): não muta o workspace nem abre
    // caminho de escrita/shell (PLAN §8.4).
    risk: RiskClass::Read,
    mutating: false,
    requires_workspace: true,
    profiles: &[TurnProfile::Code],
    guidance: "When the runtime context says the user requested a goal with `/goal`, call `goal` with action \"create\" in that human turn: set `objective` from their message, a short `title`, an appropriate `max_rounds` and `auto_continue: true` so the agent keeps working in rounds. While working on an objective, finish each round with action \"progress\" and a one-line note; use \"complete\" only when the objective is fully met (list the evidence); use \"blocked\" only if the same real impediment persists for 3 rounds. Never use \"create\"/\"edit\" to move the goalposts to match work you already did.",
};

pub fn definition() -> ToolDefinition {
    definition_of(spec())
}

pub fn spec() -> &'static ToolSpec {
    &GOAL_SPEC
}

fn goal_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["create", "edit", "progress", "complete", "blocked"],
                "description": "What to do with the session objective."
            },
            "objective": {
                "type": "string",
                "description": "Long-term objective (create/edit; up to 4000 characters)."
            },
            "title": {
                "type": "string",
                "description": "Short title for the objective (create/edit; up to 120 characters)."
            },
            "max_rounds": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "description": "Round budget for automatic continuation (create/edit; 1..100, default 25)."
            },
            "auto_continue": {
                "type": "boolean",
                "description": "create: keep working automatically after the turn (default true when the user asked for the objective). The UI can disarm later."
            },
            "note": {
                "type": "string",
                "description": "One-line progress note (progress), completion summary (complete) or the real impediment (blocked, required)."
            }
        },
        "required": ["action"],
        "additionalProperties": false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_is_strict_and_matches_the_contract() {
        let schema = (GOAL_SPEC.schema)();
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(schema["required"], json!(["action"]));
        assert_eq!(
            schema["properties"]["action"]["enum"],
            json!(["create", "edit", "progress", "complete", "blocked"])
        );
        assert_eq!(schema["properties"]["max_rounds"]["minimum"], 1);
        assert_eq!(schema["properties"]["max_rounds"]["maximum"], 100);
        assert_eq!(schema["properties"]["auto_continue"]["type"], "boolean");
        assert!(schema["properties"]["objective"]["type"] == "string");
        assert!(schema["properties"]["note"]["type"] == "string");
    }

    #[test]
    fn spec_is_a_non_mutating_code_tool_that_requires_a_workspace() {
        assert_eq!(GOAL_SPEC.name, "goal");
        assert_eq!(GOAL_SPEC.parallel, ParallelClass::Exclusive);
        assert_eq!(GOAL_SPEC.risk, RiskClass::Read);
        assert!(!GOAL_SPEC.mutating);
        assert!(GOAL_SPEC.requires_workspace);
        assert!(GOAL_SPEC.profiles.contains(&TurnProfile::Code));
        assert!(!GOAL_SPEC.profiles.contains(&TurnProfile::Chat));
        assert!(!GOAL_SPEC.guidance.trim().is_empty());
    }
}
