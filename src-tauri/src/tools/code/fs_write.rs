//! Edição: `write_file` e `edit_file` (TOOLS.md §2.2).
//!
//! F0: schemas e metadados definitivos; execução é stub `not_wired`.

use serde_json::{json, Value};

use crate::domain::{RiskClass, TurnProfile};
use crate::providers::ToolDefinition;
use crate::tools::code::{definition_of, not_wired};
use crate::tools::registry::{ParallelClass, ToolCtx, ToolSpec};
use crate::tools::ToolOutcome;

pub static WRITE_FILE_SPEC: ToolSpec = ToolSpec {
    name: "write_file",
    description: "Create a file or replace its whole content. Creating is unconditional; overwriting an existing file requires reading it first in this session.",
    schema: write_file_schema,
    parallel: ParallelClass::PathLocked,
    risk: RiskClass::Write,
    mutating: true,
    requires_workspace: true,
    profiles: &[TurnProfile::Code],
    guidance: "Read an existing file before overwriting it with `write_file` (the policy requires a prior read and a fresh version). For targeted changes prefer `edit_file`.",
};

pub static EDIT_FILE_SPEC: ToolSpec = ToolSpec {
    name: "edit_file",
    description: "Replace a unique literal snippet in a file (or all occurrences with replace_all). Requires reading the file first; fails when the file changed since that read.",
    schema: edit_file_schema,
    parallel: ParallelClass::PathLocked,
    risk: RiskClass::Write,
    mutating: true,
    requires_workspace: true,
    profiles: &[TurnProfile::Code],
    guidance: "Use `edit_file` for surgical changes: `old_string` must be unique (or use `replace_all`). Include enough context to avoid matching similar snippets and reread the file if you get FS_STALE_VERSION.",
};

pub fn definition() -> ToolDefinition {
    definition_of(spec())
}

pub fn spec() -> &'static ToolSpec {
    &WRITE_FILE_SPEC
}

pub async fn run(_ctx: &ToolCtx, _args: Value) -> ToolOutcome {
    not_wired("write_file")
}

fn write_file_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "File path, relative to the workspace (or absolute inside it)."
            },
            "content": {
                "type": "string",
                "description": "Complete file content (maximum 2 MB)."
            },
            "justification": {
                "type": "string",
                "description": "Short reason shown in the diff card (5-10 words, active voice)."
            }
        },
        "required": ["path", "content"],
        "additionalProperties": false
    })
}

fn edit_file_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "File path, relative to the workspace (or absolute inside it)."
            },
            "old_string": {
                "type": "string",
                "description": "Exact literal text to replace; must occur exactly once unless replace_all is true."
            },
            "new_string": {
                "type": "string",
                "description": "Replacement text; empty removes the snippet."
            },
            "replace_all": {
                "type": "boolean",
                "description": "Replace every occurrence. Defaults to false."
            }
        },
        "required": ["path", "old_string", "new_string"],
        "additionalProperties": false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mutation_schemas_are_strict_objects() {
        for spec in [&WRITE_FILE_SPEC, &EDIT_FILE_SPEC] {
            let schema = (spec.schema)();
            assert_eq!(schema["type"], "object", "{}", spec.name);
            assert_eq!(schema["additionalProperties"], false, "{}", spec.name);
            assert!(schema["properties"].is_object(), "{}", spec.name);
        }
    }
}
