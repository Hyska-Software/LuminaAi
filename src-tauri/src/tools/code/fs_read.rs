//! Leitura: `read_file`, `list_dir`, `search_files`, `search_text` e
//! `read_tool_output` (TOOLS.md §2.1).
//!
//! F0: schemas e metadados definitivos; execução é stub `not_wired` até a
//! tarefa de implementação das tools de leitura.

use serde_json::{json, Value};

use crate::domain::{RiskClass, TurnProfile};
use crate::providers::ToolDefinition;
use crate::tools::code::{definition_of, not_wired};
use crate::tools::registry::{ParallelClass, ToolCtx, ToolSpec};
use crate::tools::ToolOutcome;

pub static READ_FILE_SPEC: ToolSpec = ToolSpec {
    name: "read_file",
    description: "Read a text file. Relative paths resolve inside the workspace; absolute paths are allowed when the session has no project folder.",
    schema: read_file_schema,
    parallel: ParallelClass::Safe,
    risk: RiskClass::Read,
    mutating: false,
    requires_workspace: true,
    profiles: &[TurnProfile::Code],
    guidance: "Use `read_file` — not shell commands like `cat` — to inspect files. Continue with `offset`/`limit` on large files; read a file before editing it.",
};

pub static LIST_DIR_SPEC: ToolSpec = ToolSpec {
    name: "list_dir",
    description: "List a directory tree, respecting .gitignore and skipping build/VCS directories by default. Absolute paths are allowed when the session has no project folder.",
    schema: list_dir_schema,
    parallel: ParallelClass::Safe,
    risk: RiskClass::Read,
    mutating: false,
    requires_workspace: true,
    profiles: &[TurnProfile::Code],
    guidance: "Use `list_dir` to discover the structure before searching or editing; prefer `search_files`/`search_text` when you already know the target.",
};

pub static SEARCH_FILES_SPEC: ToolSpec = ToolSpec {
    name: "search_files",
    description: "Find files whose paths match a glob pattern (e.g. `**/*.test.ts`), ordered by path. `path` accepts a directory or a specific file. Absolute paths are allowed when the session has no project folder.",
    schema: search_files_schema,
    parallel: ParallelClass::Safe,
    risk: RiskClass::Read,
    mutating: false,
    requires_workspace: true,
    profiles: &[TurnProfile::Code],
    guidance: "Use `search_files` to locate files by name/pattern and `search_text` to locate content; set `path` to a directory or a specific file. Results are relative to the workspace, or absolute outside it.",
};

pub static SEARCH_TEXT_SPEC: ToolSpec = ToolSpec {
    name: "search_text",
    description: "Search file contents (literal or regex), grouped by file, optionally filtered by glob and with context lines. `path` accepts a directory or a specific file. Absolute paths are allowed when the session has no project folder.",
    schema: search_text_schema,
    parallel: ParallelClass::Safe,
    risk: RiskClass::Read,
    mutating: false,
    requires_workspace: true,
    profiles: &[TurnProfile::Code],
    guidance: "Use `search_text` with a short literal snippet or a regex to find the relevant code; set `path` to a specific file to search only it, or narrow a directory with `glob` instead of scanning the whole repository.",
};

pub static READ_TOOL_OUTPUT_SPEC: ToolSpec = ToolSpec {
    name: "read_tool_output",
    description: "Read the full output of an earlier tool call that was truncated, paging by characters using the spill id from the truncation footer.",
    schema: read_tool_output_schema,
    parallel: ParallelClass::Safe,
    risk: RiskClass::Read,
    mutating: false,
    requires_workspace: false,
    profiles: &[TurnProfile::Code],
    guidance: "When a result comes back truncated with a spill id, use `read_tool_output` to page through the rest instead of repeating the command.",
};

pub fn definition() -> ToolDefinition {
    definition_of(spec())
}

pub fn spec() -> &'static ToolSpec {
    &READ_FILE_SPEC
}

pub async fn run(_ctx: &ToolCtx, _args: Value) -> ToolOutcome {
    not_wired("read_file")
}

fn read_file_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "File path (relative to the workspace or absolute)."
            },
            "offset": {
                "type": "integer",
                "description": "1-based first line to read. Defaults to 1.",
                "minimum": 1
            },
            "limit": {
                "type": "integer",
                "description": "Number of lines to read. Defaults to 800, maximum 2000.",
                "minimum": 1,
                "maximum": 2000
            }
        },
        "required": ["path"],
        "additionalProperties": false
    })
}

fn list_dir_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Directory (relative to the workspace or absolute). Defaults to \".\"."
            },
            "depth": {
                "type": "integer",
                "description": "Maximum depth to list (1-4). Defaults to 2.",
                "minimum": 1,
                "maximum": 4
            },
            "include_hidden": {
                "type": "boolean",
                "description": "Include dotfiles/dot-directories. Defaults to false."
            },
            "limit": {
                "type": "integer",
                "description": "Maximum entries shown (1-2000). Defaults to 400.",
                "minimum": 1,
                "maximum": 2000
            }
        },
        "additionalProperties": false
    })
}

fn search_files_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "pattern": {
                "type": "string",
                "description": "Glob pattern such as `**/*.test.ts`; a pattern without `/` matches basenames at any depth."
            },
            "path": {
                "type": "string",
                "description": "File or directory to search under (relative to the workspace or absolute). Defaults to \".\"."
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum paths returned (1-1000). Defaults to 200.",
                "minimum": 1,
                "maximum": 1000
            }
        },
        "required": ["pattern"],
        "additionalProperties": false
    })
}

fn search_text_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Literal text or regular expression to search for."
            },
            "path": {
                "type": "string",
                "description": "File or directory to search under (relative to the workspace or absolute). Defaults to \".\"."
            },
            "glob": {
                "type": "string",
                "description": "Only search files matching this glob (e.g. `*.ts`)."
            },
            "is_regex": {
                "type": "boolean",
                "description": "Treat `query` as a regular expression. Defaults to false."
            },
            "case_sensitive": {
                "type": "boolean",
                "description": "Case-sensitive match. Defaults to false."
            },
            "context_lines": {
                "type": "integer",
                "description": "Lines of context before/after each match (0-5). Defaults to 0.",
                "minimum": 0,
                "maximum": 5
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum matches returned (1-1000). Defaults to 200.",
                "minimum": 1,
                "maximum": 1000
            }
        },
        "required": ["query"],
        "additionalProperties": false
    })
}

fn read_tool_output_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "id": {
                "type": "string",
                "description": "Spill id shown in the truncation footer of an earlier tool result."
            },
            "offset": {
                "type": "integer",
                "description": "0-based character offset. Defaults to 0.",
                "minimum": 0
            },
            "limit": {
                "type": "integer",
                "description": "Maximum characters returned (1-20000). Defaults to 4000.",
                "minimum": 1,
                "maximum": 20000
            }
        },
        "required": ["id"],
        "additionalProperties": false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schemas_are_strict_objects() {
        for spec in [
            &READ_FILE_SPEC,
            &LIST_DIR_SPEC,
            &SEARCH_FILES_SPEC,
            &SEARCH_TEXT_SPEC,
            &READ_TOOL_OUTPUT_SPEC,
        ] {
            let schema = (spec.schema)();
            assert_eq!(schema["type"], "object", "{}", spec.name);
            assert_eq!(schema["additionalProperties"], false, "{}", spec.name);
            assert!(schema["properties"].is_object(), "{}", spec.name);
        }
    }
}
