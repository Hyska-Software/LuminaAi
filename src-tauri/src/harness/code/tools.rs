//! Execução das tools do perfil Code no loop de turno.
//!
//! O loop do harness (Lead) chama [`execute`] para cada `ToolCallRecord` quando
//! o perfil é `Code`. A implementação de cada tool vive em
//! [`crate::tools::code::exec`] (execução) e os metadados/schemas em
//! [`crate::tools::registry`] — este módulo só faz a ponte e o parsing de
//! argumentos, mantendo o loop independente das tools.

use serde_json::Value;

use crate::domain::ToolCallRecord;
use crate::tools::registry::{ToolCtx, ToolExec};
use crate::tools::ToolOutcome;

/// Parseia os argumentos JSON da chamada (objeto raiz).
pub fn parse_arguments(raw: &str) -> Result<Value, ToolOutcome> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(serde_json::json!({}));
    }
    match serde_json::from_str::<Value>(trimmed) {
        Ok(Value::Object(map)) => Ok(Value::Object(map)),
        Ok(Value::Null) => Ok(serde_json::json!({})),
        Ok(_) => Err(ToolOutcome::error(
            "TOOL_INVALID_ARGS: os argumentos da ferramenta devem ser um objeto JSON",
        )),
        Err(error) => Err(ToolOutcome::error(format!(
            "TOOL_INVALID_ARGS: argumentos da ferramenta não são JSON válido: {error}"
        ))),
    }
}

/// Timeout padrão por tool (o shell tem timeout próprio vindo dos argumentos).
fn default_timeout_ms(name: &str) -> Option<u64> {
    match name {
        "read_file" | "list_dir" | "search_files" | "search_text" | "read_tool_output"
        | "git_status" | "git_diff" | "git_log" => Some(30_000),
        "write_file" | "edit_file" => Some(30_000),
        "todo_write" | "submit_plan" => Some(60_000),
        // `run_command` aplica o `timeout_ms` dos argumentos dentro da tool.
        _ => None,
    }
}

/// Executa uma tool do perfil Code. Nunca entra em pânico: falhas viram
/// `ToolOutcome` de erro com código estável.
pub async fn execute(ctx: &ToolCtx, call: &ToolCallRecord) -> ToolOutcome {
    let Some(exec) = ToolExec::for_tool(&call.name) else {
        return ToolOutcome::error(format!("TOOL_UNKNOWN: ferramenta desconhecida: {}", call.name));
    };
    let args = match parse_arguments(&call.arguments) {
        Ok(args) => args,
        Err(outcome) => return outcome,
    };
    // Contexto por chamada: o id da tool call é usado por progresso, aprovação e
    // apresentação (`presentation`) do card correto.
    let mut call_ctx = ctx.clone();
    call_ctx.tool_call_id = call.id.clone();
    // Timeout do contrato aplicado pelo runtime (nunca "decorativo").
    match default_timeout_ms(&call.name) {
        Some(timeout) => {
            match tokio::time::timeout(
                std::time::Duration::from_millis(timeout),
                exec.execute(&call_ctx, args),
            )
            .await
            {
                Ok(outcome) => outcome,
                Err(_) => ToolOutcome::error(format!(
                    "TOOL_TIMEOUT: a ferramenta `{}` excedeu {timeout} ms",
                    call.name
                )),
            }
        }
        None => exec.execute(&call_ctx, args).await,
    }
}

/// Executa um lote de chamadas respeitando o scheduler do registry
/// (`Safe` em paralelo, `PathLocked` por arquivo, `Exclusive` como barreira) e
/// devolve os resultados na ordem original das chamadas.
pub async fn execute_batch(ctx: &ToolCtx, calls: &[ToolCallRecord]) -> Vec<ToolOutcome> {
    use crate::domain::TurnProfile;
    use crate::tools::pipeline::{plan, ToolCallRequest};
    use crate::tools::registry::find_spec;

    let mut indexed: Vec<(usize, ToolCallRequest)> = Vec::new();
    for (index, call) in calls.iter().enumerate() {
        if let Some(spec) = find_spec(TurnProfile::Code, &call.name) {
            indexed.push((index, ToolCallRequest::new(call.clone(), spec)));
        }
    }
    let mut outcomes: Vec<Option<ToolOutcome>> = vec![None; calls.len()];
    let requests: Vec<ToolCallRequest> = indexed
        .iter()
        .map(|(_, request)| request.clone())
        .collect();
    for batch in plan(&requests) {
        let batch_futures = batch.iter().map(|&request_index| {
            let call = indexed[request_index].1.call.clone();
            async move { (request_index, execute(ctx, &call).await) }
        });
        for (request_index, outcome) in futures_util::future::join_all(batch_futures).await {
            let (call_index, _) = &indexed[request_index];
            outcomes[*call_index] = Some(outcome);
        }
    }
    outcomes
        .into_iter()
        .enumerate()
        .map(|(index, outcome)| {
            outcome.unwrap_or_else(|| {
                ToolOutcome::error(format!(
                    "TOOL_UNKNOWN: ferramenta `{}` não está disponível no perfil Code",
                    calls[index].name
                ))
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_arguments_objects_only() {
        assert!(parse_arguments("").expect("vazio").is_object());
        assert!(parse_arguments("{\"a\":1}").expect("objeto").is_object());
        assert!(parse_arguments("[]").is_err());
        assert!(parse_arguments("{oops").is_err());
    }

    #[tokio::test]
    async fn unknown_tool_is_an_actionable_error() {
        let ctx = test_ctx();
        let mut call = ToolCallRecord::running("call-1", "nope");
        call.arguments = "{}".to_string();
        let outcome = execute(&ctx, &call).await;
        assert!(outcome.is_error);
        assert!(outcome.content.contains("TOOL_UNKNOWN"));
    }

    fn test_ctx() -> ToolCtx {
        ToolCtx {
            db: std::sync::Arc::new(crate::db::Db::open_in_memory().expect("db")),
            http: reqwest::Client::new(),
            conversation_id: "conv-1".into(),
            message_id: "msg-1".into(),
            tool_call_id: "call-1".into(),
            turn_id: "turn-1".into(),
            workspace: None,
            settings: crate::domain::Settings::default(),
            cancel: tokio_util::sync::CancellationToken::new(),
            data_dir: std::env::temp_dir().join("lumina-code-tools-test"),
            approval: None,
            observed: None,
            jobs: None,
            questions: None,
            emit: None,
            rules: Vec::new(),
            plan_mode: false,
        }
    }
}
