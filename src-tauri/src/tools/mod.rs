//! Agent tools: web search, page fetching, file creation, code execution and
//! skills.

use std::path::PathBuf;

use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use crate::db::Db;
use crate::domain::{Artifact, Citation, Settings, ToolCallRecord, TurnOptions};
use crate::providers::ToolDefinition;

pub mod artifact_library;
pub mod artifacts;
pub mod code;
pub mod code_exec;
pub mod create_file;
pub mod fetch_url;
pub mod genui;
pub mod pipeline;
pub mod registry;
pub mod skills;
pub mod web_search;

/// Upper bound for the text fed back to the model from a single tool call.
pub const MAX_TOOL_RESULT_CHARS: usize = 120_000;

#[derive(Clone)]
pub struct ToolRuntime {
    pub db: std::sync::Arc<Db>,
    /// Shared browser-like client (`AppState::search_http`) used by the web
    /// tools: search engines and scraped pages reject the plain API client.
    pub http: reqwest::Client,
    pub conversation_id: String,
    pub message_id: String,
    pub options: TurnOptions,
    /// Effective settings for this turn (code interpreter paths, timeout, …).
    pub settings: Settings,
    /// Turn cancellation token: `run_code` kills the process tree on cancel.
    pub cancel: CancellationToken,
    /// Resolved `<app-data>` directory (artifacts, code-runs, skills).
    pub data_dir: PathBuf,
    /// External skills repositories (Codex/Claude/OpenCode/Agent Skills) read
    /// by the `list_skills`/`read_skill` tools; empty in most unit tests.
    pub skills_roots: Vec<skills::ExternalSkillRoot>,
}

#[derive(Debug, Clone, Default)]
pub struct ToolOutcome {
    /// Text fed back to the model as the tool result.
    pub content: String,
    /// Short human readable summary shown on the tool card.
    pub summary: Option<String>,
    pub citations: Vec<Citation>,
    pub artifacts: Vec<Artifact>,
    pub is_error: bool,
    /// Apresentação estruturada do resultado (diff, lista de tarefas, plano,
    /// job, aprovação) usada pelos cards do renderer e persistida em
    /// `ToolCallRecord.presentation`. JSON opaco versionado por `kind` — ver
    /// `docs/goals/code-harness/TOOLS.md` §1.1.
    pub presentation: Option<Value>,
}

impl ToolOutcome {
    pub fn error(message: impl Into<String>) -> Self {
        Self {
            content: format!("ERROR: {}", message.into()),
            is_error: true,
            ..Default::default()
        }
    }
}

/// Tool definitions exposed to the model for the current turn.
pub fn definitions(options: &TurnOptions) -> Vec<ToolDefinition> {
    let mut tools = Vec::new();
    if options.web_search {
        tools.push(web_search::definition());
    }
    tools.push(fetch_url::definition());
    if options.create_files {
        tools.push(create_file::definition());
    }
    if options.run_code {
        tools.push(code_exec::definition());
    }
    // Sempre disponíveis: skills não contam no orçamento de ferramentas de
    // dados e o agente precisa poder lê-las antes de gerar arquivos.
    tools.push(skills::list_definition());
    tools.push(skills::read_definition());
    // Sempre disponíveis: a biblioteca de artefatos do USUÁRIO (todas as
    // conversas) é somente leitura e resolve o caso de arquivos de turnos e
    // conversas anteriores (o histórico não carrega o conteúdo deles). Elas
    // contam no orçamento de ferramentas de dados, mas nunca são escondidas
    // pelas flags do turno.
    tools.push(artifact_library::list_definition());
    tools.push(artifact_library::read_definition());
    // Sempre disponível: o agente valida o JSON do bloco `ui` antes de emitir.
    tools.push(genui::definition());
    tools
}

/// Execute a tool call. Must never panic: failures are returned as `ToolOutcome::error`.
pub async fn execute(rt: &ToolRuntime, call: &ToolCallRecord) -> ToolOutcome {
    let arguments = match parse_arguments(&call.arguments) {
        Ok(arguments) => arguments,
        Err(error) => return ToolOutcome::error(error),
    };

    let outcome = match call.name.as_str() {
        "web_search" if !rt.options.web_search => {
            ToolOutcome::error("a busca web está desativada nesta conversa")
        }
        "web_search" => web_search::run(rt, &arguments).await,
        "fetch_url" => fetch_url::run(rt, &arguments).await,
        "create_file" if !rt.options.create_files => {
            ToolOutcome::error("a criação de arquivos está desativada nesta conversa")
        }
        "create_file" => create_file::run(rt, &arguments).await,
        "run_code" if !rt.options.run_code => {
            ToolOutcome::error("a execução de código está desativada nesta conversa")
        }
        "run_code" => code_exec::run(rt, &arguments).await,
        // Skills: sempre disponíveis, independentes das flags do turno.
        "list_skills" => skills::run_list(rt),
        "read_skill" => skills::run_read(rt, &arguments),
        // Biblioteca de artefatos do usuário (todas as conversas), somente
        // leitura; não depende das flags do turno.
        "list_artifacts" => artifact_library::run_list(rt, &arguments).await,
        "read_artifact" => artifact_library::run_read(rt, &arguments).await,
        // Validação local do bloco `ui`; não depende de flags do turno.
        "validate_ui" => genui::run(&arguments),
        other => ToolOutcome::error(format!("ferramenta desconhecida: {other}")),
    };
    truncate_outcome(outcome)
}

fn parse_arguments(raw: &str) -> Result<Value, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(json!({}));
    }
    match serde_json::from_str::<Value>(trimmed) {
        Ok(Value::Null) => Ok(json!({})),
        Ok(Value::Object(map)) => Ok(Value::Object(map)),
        Ok(_) => Err("os argumentos da ferramenta devem ser um objeto JSON".to_string()),
        Err(error) => Err(format!("argumentos da ferramenta não são JSON válido: {error}")),
    }
}

fn truncate_outcome(mut outcome: ToolOutcome) -> ToolOutcome {
    if outcome.content.chars().count() > MAX_TOOL_RESULT_CHARS {
        outcome.content = truncate_chars(&outcome.content, MAX_TOOL_RESULT_CHARS);
        outcome.content.push_str("\n\n[resultado truncado para caber no contexto]");
    }
    outcome
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

pub(crate) fn json_str(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

pub(crate) fn json_u32(value: &Value, key: &str) -> Option<u32> {
    value
        .get(key)
        .and_then(|v| v.as_u64())
        .and_then(|v| u32::try_from(v).ok())
}

pub(crate) fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    text.chars().take(max).collect()
}

/// Collapse runs of whitespace into single spaces and trim the result.
pub(crate) fn clean_inline(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    for word in text.split_whitespace() {
        if !output.is_empty() {
            output.push(' ');
        }
        output.push_str(word);
    }
    output
}

/// Normalize extracted article text: single spaces inside lines, at most one
/// blank line between blocks.
pub(crate) fn normalize_blocks(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut blank_lines = 0usize;
    for line in text.lines() {
        let cleaned = clean_inline(line);
        if cleaned.is_empty() {
            blank_lines += 1;
            if blank_lines <= 1 && !output.is_empty() {
                output.push('\n');
            }
        } else {
            blank_lines = 0;
            output.push_str(&cleaned);
            output.push('\n');
        }
    }
    output.trim().to_string()
}

pub(crate) fn host_of(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let host = parsed.host_str()?;
    Some(host.trim_start_matches("www.").to_string())
}

/// Stable, unique citation id derived from the source URL.
pub(crate) fn citation_id(url: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    url.hash(&mut hasher);
    format!("src-{:016x}", hasher.finish())
}

pub(crate) fn selector(query: &str) -> Option<scraper::Selector> {
    scraper::Selector::parse(query).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::TurnOptions;

    #[test]
    fn definitions_respect_turn_options() {
        let mut options = TurnOptions::default();
        options.web_search = true;
        options.create_files = true;
        options.run_code = true;
        let names: Vec<String> = definitions(&options).into_iter().map(|tool| tool.name).collect();
        assert_eq!(
            names,
            vec![
                "web_search",
                "fetch_url",
                "create_file",
                "run_code",
                "list_skills",
                "read_skill",
                "list_artifacts",
                "read_artifact",
                "validate_ui"
            ]
        );

        options.web_search = false;
        options.create_files = false;
        options.run_code = false;
        let names: Vec<String> = definitions(&options).into_iter().map(|tool| tool.name).collect();
        // `list_skills`, `read_skill`, `list_artifacts`, `read_artifact` e
        // `validate_ui` são sempre expostas; apenas as duas primeiras e a
        // validação de UI não entram no orçamento de ferramentas de dados.
        assert_eq!(
            names,
            vec![
                "fetch_url",
                "list_skills",
                "read_skill",
                "list_artifacts",
                "read_artifact",
                "validate_ui"
            ]
        );
    }

    #[tokio::test]
    async fn artifact_library_tools_are_dispatched_without_turn_flags() {
        // As duas tools são somente leitura: nenhuma flag do turno as desativa.
        let mut options = TurnOptions::default();
        options.web_search = false;
        options.create_files = false;
        options.run_code = false;
        let names: Vec<String> = definitions(&options).into_iter().map(|tool| tool.name).collect();
        for name in ["list_artifacts", "read_artifact"] {
            assert!(names.contains(&name.to_string()), "tool `{name}` ausente");
        }

        let runtime = ToolRuntime {
            db: std::sync::Arc::new(Db::open_in_memory().expect("banco em memória")),
            http: reqwest::Client::new(),
            conversation_id: "conv-1".to_string(),
            message_id: "msg-1".to_string(),
            options,
            settings: Settings::default(),
            cancel: tokio_util::sync::CancellationToken::new(),
            data_dir: std::env::temp_dir().join(format!(
                "lumina-tools-dispatch-{}",
                uuid::Uuid::new_v4()
            )),
            skills_roots: Vec::new(),
        };
        let mut list_call = ToolCallRecord::running("call-1", "list_artifacts");
        list_call.arguments = "{}".to_string();
        let list = execute(&runtime, &list_call).await;
        assert!(!list.is_error, "erro inesperado: {}", list.content);
        assert_eq!(list.summary.as_deref(), Some("nenhum artefato"));

        let mut read_call = ToolCallRecord::running("call-2", "read_artifact");
        read_call.arguments = "{}".to_string();
        let read = execute(&runtime, &read_call).await;
        assert!(read.is_error, "sem id/nome deve ser erro orientativo");
        assert!(read.content.contains("`id`"));
    }

    #[test]
    fn parses_tool_arguments() {
        assert!(parse_arguments("").unwrap().is_object());
        assert!(parse_arguments("{\"query\":\"rust\"}").unwrap().is_object());
        assert!(parse_arguments("[1,2]").is_err());
        assert!(parse_arguments("{oops").is_err());
    }

    #[test]
    fn cleans_and_truncates_text() {
        assert_eq!(clean_inline("  olá   mundo \n"), "olá mundo");
        assert_eq!(truncate_chars("abcdef", 3), "abc");
        assert_eq!(host_of("https://www.example.com/a/b"), Some("example.com".to_string()));
    }
}
