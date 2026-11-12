//! Delegação: `task` (subagente somente leitura; F8).
//!
//! O filho explora/revisa o workspace em uma conversa efêmera e devolve um
//! resumo; ver `harness/code/subagent.rs` e `docs/goals/code-harness/TOOLS.md`.

use serde_json::{json, Value};

use crate::domain::{RiskClass, TurnProfile};
use crate::providers::ToolDefinition;
use crate::tools::code::definition_of;
use crate::tools::registry::{ParallelClass, ToolSpec};

pub static TASK_SPEC: ToolSpec = ToolSpec {
    name: "task",
    description: "Delegate an exploration or review to a read-only subagent and return its summary. The child sees the same workspace but cannot edit files, run shell commands or use MCP; it can read/search and inspect git. Maximum one level of delegation.",
    schema: task_schema,
    parallel: ParallelClass::Safe,
    risk: RiskClass::Read,
    mutating: false,
    requires_workspace: true,
    profiles: &[TurnProfile::Code],
    guidance: "Use `task` for broad, independent exploration instead of reading everything \
               yourself. When two or more areas can be investigated separately (layers, modules, \
               docs), launch 2-4 `task` calls in the same step — they run in parallel; give each \
               a self-contained question and the exact report you need. `subagent_type`: \
               `explore` (map/answer), `review` (critique the diff) or `general`. The child is \
               read-only: no edits, shell, MCP, questions or nested delegation; you implement its \
               findings. Optional `model` (`provider/model`) and `effort`. Keep your own reads \
               targeted; never delegate a task you can finish with one or two targeted reads.",
};

pub fn definition() -> ToolDefinition {
    definition_of(&TASK_SPEC)
}

fn task_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "description": {
                "type": "string",
                "description": "Short description of the delegated work (5-10 words, active voice)."
            },
            "prompt": {
                "type": "string",
                "description": "Complete, self-contained instruction for the subagent (what to inspect and what to return)."
            },
            "subagent_type": {
                "type": "string",
                "description": "Kind of subagent: explore (map/answer), review (critique changes) or general.",
                "enum": ["explore", "review", "general"]
            },
            "model": {
                "type": "string",
                "description": "Optional subagent model: `provider/model` or a model id from the parent provider. Omit to inherit the parent route."
            },
            "effort": {
                "type": "string",
                "description": "Optional reasoning effort for the child (model-declared value, e.g. low/medium/high, or `off`/`auto`). Omit to use the model default."
            }
        },
        "required": ["description", "prompt"],
        "additionalProperties": false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_is_strict_and_has_enum() {
        let schema = (TASK_SPEC.schema)();
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(schema["required"][0], "description");
        assert_eq!(schema["properties"]["subagent_type"]["enum"][1], "review");
        assert!(schema["properties"]["model"]["type"] == "string");
        assert!(schema["properties"]["effort"]["type"] == "string");
        assert!(!TASK_SPEC.mutating);
        assert_eq!(
            TASK_SPEC.parallel,
            crate::tools::registry::ParallelClass::Safe
        );
        assert!(TASK_SPEC.guidance.contains("in the same step"));
        assert!(TASK_SPEC.guidance.contains("run in parallel"));
        assert!(
            TASK_SPEC.guidance.chars().count()
                <= crate::harness::code::prompt::MAX_TOOL_GUIDANCE_CHARS,
            "guidance acima do cap do prompt: {} chars",
            TASK_SPEC.guidance.chars().count()
        );
    }
}
