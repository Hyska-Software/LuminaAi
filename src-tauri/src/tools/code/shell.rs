//! Execução: `run_command` (TOOLS.md §2.3).
//!
//! F0: schema e metadados definitivos; execução é stub `not_wired`.

use serde_json::{json, Value};

use crate::domain::{RiskClass, TurnProfile};
use crate::providers::ToolDefinition;
use crate::tools::code::{definition_of, not_wired};
use crate::tools::registry::{ParallelClass, ToolCtx, ToolSpec};
use crate::tools::ToolOutcome;

pub static RUN_COMMAND_SPEC: ToolSpec = ToolSpec {
    name: "run_command",
    description: "Run a shell command in the workspace and return exit code, stdout and stderr. Non-zero exits are normal results. Destructive commands always require approval.",
    schema: run_command_schema,
    parallel: ParallelClass::Exclusive,
    risk: RiskClass::Shell,
    mutating: true,
    requires_workspace: true,
    profiles: &[TurnProfile::Code],
    guidance: "Use `run_command` para compilar, testar, rodar linters e rodar git de leitura. Prefira os comandos de verificação do projeto; nunca rode comandos destrutivos sem necessidade. Saída longa volta truncada com id de spill.",
};

pub static RUN_CHECKS_SPEC: ToolSpec = ToolSpec {
    name: "run_checks",
    description: "Run the project's detected verification commands (test/lint/build) and return the output. Use it after editing code, before claiming the task is done.",
    schema: run_checks_schema,
    parallel: ParallelClass::Exclusive,
    risk: RiskClass::Shell,
    mutating: true,
    requires_workspace: true,
    profiles: &[TurnProfile::Code],
    guidance: "Use `run_checks` para rodar a verificação detectada do projeto (test/lint/build). Sem `check`, roda a primeira (teste). Os ids/labels aparecem no contexto do projeto; o resultado traz exit code e saída. Comandos próprios continuam em `run_command`.",
};

pub fn run_checks_definition() -> ToolDefinition {
    definition_of(&RUN_CHECKS_SPEC)
}

fn run_checks_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "check": {
                "type": "string",
                "description": "Optional check id from the project profile (e.g. `npm:test`, `cargo:test`, `npm:lint`). Defaults to the first detected check."
            },
            "timeout_ms": {
                "type": "integer",
                "description": "Timeout in milliseconds. Defaults to 600000, maximum 600000.",
                "minimum": 1000,
                "maximum": 600000
            }
        },
        "additionalProperties": false
    })
}
pub fn definition() -> ToolDefinition {
    definition_of(spec())
}

pub fn spec() -> &'static ToolSpec {
    &RUN_COMMAND_SPEC
}

pub async fn run(_ctx: &ToolCtx, _args: Value) -> ToolOutcome {
    not_wired("run_command")
}

fn run_command_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "Shell command to run (bash on Unix, PowerShell on Windows)."
            },
            "workdir": {
                "type": "string",
                "description": "Working directory relative to the workspace. Defaults to the workspace root."
            },
            "timeout_ms": {
                "type": "integer",
                "description": "Timeout in milliseconds. Defaults to 120000, maximum 600000.",
                "minimum": 1000,
                "maximum": 600000
            },
            "description": {
                "type": "string",
                "description": "Short summary of what the command does (5-10 words, active voice)."
            }
        },
        "required": ["command", "description"],
        "additionalProperties": false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_schema_is_a_strict_object() {
        let schema = (RUN_COMMAND_SPEC.schema)();
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(schema["required"][0], "command");
        assert_eq!(schema["required"][1], "description");
    }
}
