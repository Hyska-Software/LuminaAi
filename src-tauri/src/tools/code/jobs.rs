//! Jobs de processo em background: `job_list`, `job_output` e `job_kill`
//! (TOOLS.md §2.3).
//!
//! As definições/schemas vivem aqui; a execução concreta está em
//! [`crate::tools::code::exec`] e o estado no [`crate::jobs::JobRegistry`].

use serde_json::{json, Value};

use crate::domain::{RiskClass, TurnProfile};
use crate::providers::ToolDefinition;
use crate::tools::code::definition_of;
use crate::tools::registry::{ParallelClass, ToolSpec};

pub static JOB_LIST_SPEC: ToolSpec = ToolSpec {
    name: "job_list",
    description: "List the background jobs started in this session with id, command, status, duration and output preview.",
    schema: job_list_schema,
    parallel: ParallelClass::Safe,
    risk: RiskClass::Read,
    mutating: false,
    requires_workspace: false,
    profiles: &[TurnProfile::Code],
    guidance: "Use `job_list` para ver jobs em background e o status de cada um; prefira `job_output` para acompanhar a saída de um job específico.",
};

pub static JOB_OUTPUT_SPEC: ToolSpec = ToolSpec {
    name: "job_output",
    description: "Read a background job's output from an absolute cursor, optionally waiting for more output or for the job to settle.",
    schema: job_output_schema,
    parallel: ParallelClass::Safe,
    risk: RiskClass::Read,
    mutating: false,
    requires_workspace: false,
    profiles: &[TurnProfile::Code],
    guidance: "Use `job_output` com o `cursor` devolvido na chamada anterior para ler só o que é novo; `wait: true` espera até o timeout (padrão 30s, máximo 10min).",
};

pub static JOB_KILL_SPEC: ToolSpec = ToolSpec {
    name: "job_kill",
    description: "Stop a background job and its process tree. Requires approval in Edit mode (it is a shell action).",
    schema: job_kill_schema,
    parallel: ParallelClass::Exclusive,
    risk: RiskClass::Shell,
    mutating: true,
    requires_workspace: false,
    profiles: &[TurnProfile::Code],
    guidance: "Use `job_kill` quando a saída do job mostrar que ele não é mais necessário; o processo e os filhos são terminados.",
};

pub fn definition() -> ToolDefinition {
    definition_of(spec())
}

pub fn spec() -> &'static ToolSpec {
    &JOB_LIST_SPEC
}

fn job_list_schema() -> Value {
    json!({
        "type": "object",
        "properties": {},
        "additionalProperties": false
    })
}

fn job_output_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "job_id": {
                "type": "string",
                "description": "Job id returned by run_command or job_list."
            },
            "cursor": {
                "type": "integer",
                "description": "Absolute byte cursor returned by the previous job_output call. Defaults to 0.",
                "minimum": 0
            },
            "wait": {
                "type": "boolean",
                "description": "Wait for new output or settlement up to timeout_ms. Defaults to false."
            },
            "timeout_ms": {
                "type": "integer",
                "description": "Maximum wait in milliseconds when wait is true (1000-600000). Defaults to 30000.",
                "minimum": 1000,
                "maximum": 600000
            }
        },
        "required": ["job_id"],
        "additionalProperties": false
    })
}

fn job_kill_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "job_id": {
                "type": "string",
                "description": "Job id returned by run_command or job_list."
            },
            "reason": {
                "type": "string",
                "description": "Short reason shown in the UI (optional)."
            }
        },
        "required": ["job_id"],
        "additionalProperties": false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_schemas_are_strict_objects() {
        for spec in [&JOB_LIST_SPEC, &JOB_OUTPUT_SPEC, &JOB_KILL_SPEC] {
            let schema = (spec.schema)();
            assert_eq!(schema["type"], "object", "{}", spec.name);
            assert_eq!(schema["additionalProperties"], false, "{}", spec.name);
        }
        assert_eq!((JOB_OUTPUT_SPEC.schema)()["required"][0], "job_id");
    }
}
