//! Git somente leitura: `git_status`, `git_diff` e `git_log` (TOOLS.md §2.4).
//!
//! F0: schemas e metadados definitivos; execução é stub `not_wired`. O modelo
//! não recebe tools de git que mutam (stage/commit/push) na v1.

use serde_json::{json, Value};

use crate::domain::{RiskClass, TurnProfile};
use crate::providers::ToolDefinition;
use crate::tools::code::{definition_of, not_wired};
use crate::tools::registry::{ParallelClass, ToolCtx, ToolSpec};
use crate::tools::ToolOutcome;

pub static GIT_STATUS_SPEC: ToolSpec = ToolSpec {
    name: "git_status",
    description: "Show the workspace git status: branch, upstream/ahead, staged/unstaged/untracked files and conflicts.",
    schema: git_status_schema,
    parallel: ParallelClass::Safe,
    risk: RiskClass::Read,
    mutating: false,
    requires_workspace: true,
    profiles: &[TurnProfile::Code],
    guidance: "Use `git_status` to see what changed before editing or committing; it is read-only and does not alter the repository.",
};

pub static GIT_DIFF_SPEC: ToolSpec = ToolSpec {
    name: "git_diff",
    description: "Show a unified diff for the working tree or staged changes, optionally limited to specific paths.",
    schema: git_diff_schema,
    parallel: ParallelClass::Safe,
    risk: RiskClass::Read,
    mutating: false,
    requires_workspace: true,
    profiles: &[TurnProfile::Code],
    guidance: "Use `git_diff` to review changes before wrapping up; limit with `paths` when the diff is large.",
};

pub static GIT_LOG_SPEC: ToolSpec = ToolSpec {
    name: "git_log",
    description: "Show recent commits in a compact one-line format, optionally filtered by path.",
    schema: git_log_schema,
    parallel: ParallelClass::Safe,
    risk: RiskClass::Read,
    mutating: false,
    requires_workspace: true,
    profiles: &[TurnProfile::Code],
    guidance: "Use `git_log` to understand the recent history and the style of commit messages before proposing changes.",
};

pub fn definition() -> ToolDefinition {
    definition_of(spec())
}

pub fn spec() -> &'static ToolSpec {
    &GIT_STATUS_SPEC
}

pub async fn run(_ctx: &ToolCtx, _args: Value) -> ToolOutcome {
    not_wired("git_status")
}

fn git_status_schema() -> Value {
    json!({
        "type": "object",
        "properties": {},
        "additionalProperties": false
    })
}

fn git_diff_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "paths": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Paths relative to the workspace to limit the diff. Omit for everything."
            },
            "staged": {
                "type": "boolean",
                "description": "Show staged changes instead of the working tree. Defaults to false."
            },
            "context": {
                "type": "integer",
                "description": "Unified context lines (0-10). Defaults to 3.",
                "minimum": 0,
                "maximum": 10
            }
        },
        "additionalProperties": false
    })
}

fn git_log_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Number of commits (1-50). Defaults to 20.",
                "minimum": 1,
                "maximum": 50
            },
            "path": {
                "type": "string",
                "description": "Only commits touching this path (relative to the workspace)."
            }
        },
        "additionalProperties": false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_schemas_are_strict_objects() {
        for spec in [&GIT_STATUS_SPEC, &GIT_DIFF_SPEC, &GIT_LOG_SPEC] {
            let schema = (spec.schema)();
            assert_eq!(schema["type"], "object", "{}", spec.name);
            assert_eq!(schema["additionalProperties"], false, "{}", spec.name);
        }
        assert!(GIT_STATUS_SPEC.requires_workspace);
    }
}
