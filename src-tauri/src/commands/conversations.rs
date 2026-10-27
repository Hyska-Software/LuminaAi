//! Conversation CRUD commands (implemented by the storage module).

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::domain::{Conversation, ConversationDetail, MessageRole, MessageStatus, ToolCallStatus};
use crate::state::AppState;

fn to_error(error: impl std::fmt::Display) -> String {
    format!("{error:#}")
}

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

/// Resolves provider/model picking sane catalog defaults when the renderer
/// does not send one (or sends a combination that is not in the catalog).
fn resolve_defaults(
    state: &AppState,
    provider_id: Option<String>,
    model_id: Option<String>,
) -> (String, String) {
    let clean = |value: Option<String>| {
        value
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let mut provider_id = clean(provider_id);
    let model_id = clean(model_id);

    if provider_id.is_none() {
        if let Some(model) = model_id.as_deref() {
            provider_id = state
                .catalog
                .find_provider_for_model(model)
                .map(|provider| provider.id.clone());
        }
    }
    if provider_id.is_none() {
        provider_id = state
            .catalog
            .providers
            .first()
            .map(|provider| provider.id.clone());
    }

    let provider = provider_id
        .as_deref()
        .and_then(|id| state.catalog.provider(id));
    let provider_id = match provider {
        Some(provider) => provider.id.clone(),
        None => provider_id.unwrap_or_else(|| "opencode-go".to_string()),
    };
    let model_id = match (model_id, provider) {
        (Some(model), Some(provider)) => {
            if provider
                .models
                .iter()
                .any(|candidate| candidate.id == model)
            {
                model
            } else {
                provider.default_model_id.clone()
            }
        }
        (Some(model), None) => model,
        (None, Some(provider)) => provider.default_model_id.clone(),
        (None, None) => "glm-5.3-flash".to_string(),
    };
    (provider_id, model_id)
}

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub fn list_conversations(state: State<'_, AppState>) -> Result<Vec<Conversation>, String> {
    state.db.list_conversations().map_err(to_error)
}

#[tauri::command]
pub fn create_conversation(
    state: State<'_, AppState>,
    title: Option<String>,
    provider_id: Option<String>,
    model_id: Option<String>,
    mode: Option<String>,
) -> Result<Conversation, String> {
    let title = title
        .map(|title| title.trim().to_string())
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| "Nova conversa".to_string());
    let (provider_id, model_id) = resolve_defaults(&state, provider_id, model_id);
    // `mode` ausente/inválido cai no layout padrão (Chat).
    let mode = crate::domain::conversation_mode_or_default(mode.as_deref());
    state
        .db
        .create_conversation_with_mode(&title, &provider_id, &model_id, &mode)
        .map_err(to_error)
}

#[tauri::command]
pub fn get_conversation(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<ConversationDetail>, String> {
    state.db.get_conversation_detail(&id).map_err(to_error)
}

#[tauri::command]
pub fn rename_conversation(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> Result<(), String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("o título da conversa não pode ficar vazio".to_string());
    }
    state.db.rename_conversation(&id, title).map_err(to_error)
}

#[tauri::command]
pub fn delete_conversation(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_conversation(&id).map_err(to_error)
}

#[tauri::command]
pub fn set_conversation_pinned(
    state: State<'_, AppState>,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    state.db.set_pinned(&id, pinned).map_err(to_error)
}

/// Compartilha uma sessão do Chat com o layout Code (`linked = true`) ou
/// desfaz o vínculo (`linked = false`). Só sessões criadas no Chat podem ser
/// compartilhadas; o backend devolve a conversa atualizada.
#[tauri::command]
pub fn set_conversation_code_linked(
    state: State<'_, AppState>,
    id: String,
    linked: bool,
) -> Result<Conversation, String> {
    state
        .db
        .set_conversation_code_linked(&id, linked)
        .map_err(to_error)
}

#[tauri::command]
pub fn search_conversations(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<Conversation>, String> {
    state.db.search_conversations(&query).map_err(to_error)
}

#[tauri::command]
pub fn truncate_conversation(
    state: State<'_, AppState>,
    conversation_id: String,
    from_message_id: String,
) -> Result<(), String> {
    state
        .db
        .delete_messages_from(&conversation_id, &from_message_id)
        .map_err(to_error)
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

fn format_timestamp(ms: i64) -> String {
    use chrono::TimeZone;
    chrono::Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|datetime| datetime.format("%d/%m/%Y %H:%M").to_string())
        .unwrap_or_default()
}

fn role_label(role: MessageRole) -> &'static str {
    match role {
        MessageRole::User => "Usuário",
        MessageRole::Assistant => "Assistente",
        MessageRole::System => "Sistema",
    }
}

fn status_label(status: MessageStatus) -> &'static str {
    match status {
        MessageStatus::Streaming => "em andamento",
        MessageStatus::Complete => "completa",
        MessageStatus::Error => "erro",
        MessageStatus::Cancelled => "cancelada",
    }
}

fn tool_status_label(status: ToolCallStatus) -> &'static str {
    match status {
        ToolCallStatus::Running => "executando",
        ToolCallStatus::Done => "concluída",
        ToolCallStatus::Error => "erro",
    }
}

/// One-line, length-capped text for tool call results in the markdown export.
fn summarize(text: &str, limit: usize) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= limit {
        collapsed
    } else {
        let mut truncated: String = collapsed.chars().take(limit).collect();
        truncated.push('…');
        truncated
    }
}

fn export_markdown(detail: &ConversationDetail) -> String {
    let conversation = &detail.conversation;
    let mut out = String::new();
    out.push_str(&format!("# {}\n\n", conversation.title));
    out.push_str(&format!(
        "- **Criada em:** {}\n",
        format_timestamp(conversation.created_at)
    ));
    out.push_str(&format!(
        "- **Atualizada em:** {}\n",
        format_timestamp(conversation.updated_at)
    ));
    out.push_str(&format!("- **Provedor:** {}\n", conversation.provider_id));
    out.push_str(&format!("- **Modelo:** {}\n", conversation.model_id));
    out.push_str(&format!(
        "- **Mensagens:** {}\n",
        conversation.message_count
    ));
    out.push_str("\n---\n");

    for message in &detail.messages {
        out.push_str(&format!(
            "\n## {} — {}\n\n",
            role_label(message.role),
            format_timestamp(message.created_at)
        ));
        if message.status != MessageStatus::Complete {
            out.push_str(&format!("_Status: {}_\n\n", status_label(message.status)));
        }
        if !message.content.trim().is_empty() {
            out.push_str(message.content.trim_end());
            out.push_str("\n\n");
        }
        if let Some(reasoning) = message
            .reasoning
            .as_deref()
            .filter(|reasoning| !reasoning.trim().is_empty())
        {
            out.push_str("<details>\n<summary>Raciocínio</summary>\n\n");
            out.push_str(reasoning.trim());
            out.push_str("\n\n</details>\n\n");
        }
        if !message.attachments.is_empty() {
            out.push_str("**Anexos:**\n");
            for attachment in &message.attachments {
                out.push_str(&format!(
                    "- {} ({}, {} bytes)\n",
                    attachment.name, attachment.kind, attachment.size
                ));
            }
            out.push('\n');
        }
        if !message.tool_calls.is_empty() {
            out.push_str("**Ferramentas:**\n");
            for call in &message.tool_calls {
                let mut line = format!("- `{}` ({})", call.name, tool_status_label(call.status));
                if let Some(summary) = call
                    .summary
                    .as_deref()
                    .map(|summary| summarize(summary, 160))
                    .filter(|summary| !summary.is_empty())
                {
                    line.push_str(&format!(" — {summary}"));
                } else if let Some(result) = call
                    .result
                    .as_deref()
                    .map(|result| summarize(result, 160))
                    .filter(|result| !result.is_empty())
                {
                    line.push_str(&format!(" — {result}"));
                }
                out.push_str(&line);
                out.push('\n');
            }
            out.push('\n');
        }
        if !message.citations.is_empty() {
            out.push_str("**Citações:**\n");
            for citation in &message.citations {
                out.push_str(&format!("- [{}]({})\n", citation.title, citation.url));
            }
            out.push('\n');
        }
        if let Some(usage) = &message.usage {
            let mut parts: Vec<String> = Vec::new();
            if let Some(value) = usage.input_tokens {
                parts.push(format!("entrada {value}"));
            }
            if let Some(value) = usage.output_tokens {
                parts.push(format!("saída {value}"));
            }
            if let Some(value) = usage.reasoning_tokens {
                parts.push(format!("raciocínio {value}"));
            }
            if !parts.is_empty() {
                out.push_str(&format!("_Uso de tokens: {}_\n\n", parts.join(", ")));
            }
        }
        out.push_str("---\n");
    }

    out.push_str(&format!(
        "\n_Exportado por Lumina {} em {}._\n",
        env!("CARGO_PKG_VERSION"),
        format_timestamp(crate::domain::now_ms())
    ));
    out
}

/// Turns a conversation title into a safe file stem.
fn file_stem(title: &str) -> String {
    let mut stem = String::new();
    let mut last_was_separator = false;
    for character in title.trim().chars() {
        if character.is_alphanumeric() {
            stem.push(character);
            last_was_separator = false;
        } else if !last_was_separator && !stem.is_empty() {
            stem.push('-');
            last_was_separator = true;
        }
    }
    let stem = stem.trim_matches('-');
    let stem: String = stem.chars().take(60).collect();
    if stem.is_empty() {
        "conversa-lumina".to_string()
    } else {
        stem
    }
}

#[tauri::command]
pub fn export_conversation(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    format: String,
) -> Result<Option<String>, String> {
    let detail = state
        .db
        .get_conversation_detail(&id)
        .map_err(to_error)?
        .ok_or_else(|| format!("conversa não encontrada: {id}"))?;

    let format = format.trim().to_lowercase();
    let (contents, extension, filter_name) = match format.as_str() {
        "markdown" | "md" => (export_markdown(&detail), "md", "Markdown"),
        "json" => (
            serde_json::to_string_pretty(&detail).map_err(to_error)?,
            "json",
            "JSON",
        ),
        other => {
            return Err(format!(
                "formato de exportação não suportado: {other} (use \"markdown\" ou \"json\")"
            ))
        }
    };

    let file_name = format!("{}.{extension}", file_stem(&detail.conversation.title));
    let selected = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter(filter_name, &[extension])
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|error| format!("caminho de destino inválido: {error}"))?;
    std::fs::write(&path, contents)
        .map_err(|error| format!("falha ao gravar {}: {error}", path.display()))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Citation, UsageInfo};

    fn sample_detail() -> ConversationDetail {
        let mut user = crate::domain::ChatMessage::user("conv-1", "Qual é a receita?");
        user.created_at = 1_700_000_000_000;
        let mut assistant = crate::domain::ChatMessage::assistant("conv-1");
        assistant.created_at = 1_700_000_001_000;
        assistant.content = "Misture tudo e asse.".to_string();
        assistant.status = MessageStatus::Complete;
        assistant.reasoning = Some("O usuário quer uma receita simples.".to_string());
        assistant.tool_calls = vec![crate::domain::ToolCallRecord {
            id: "call-1".to_string(),
            name: "web_search".to_string(),
            arguments: "{}".to_string(),
            result: Some("resultado longo da busca".to_string()),
            status: ToolCallStatus::Done,
            summary: Some("Busca concluída".to_string()),
            started_at: None,
            finished_at: None,
        }];
        assistant.citations = vec![Citation {
            id: "cit-1".to_string(),
            title: "Receita simples".to_string(),
            url: "https://example.com/receita".to_string(),
            snippet: None,
            site_name: None,
        }];
        assistant.usage = Some(UsageInfo {
            input_tokens: Some(10),
            output_tokens: Some(20),
            ..UsageInfo::default()
        });

        ConversationDetail {
            conversation: Conversation {
                id: "conv-1".to_string(),
                title: "Receita de bolo".to_string(),
                created_at: 1_700_000_000_000,
                updated_at: 1_700_000_002_000,
                pinned: false,
                provider_id: "opencode-go".to_string(),
                model_id: "glm-5.3-flash".to_string(),
                message_count: 2,
                preview: None,
                mode: "chat".to_string(),
                code_linked: false,
            },
            messages: vec![user, assistant],
        }
    }

    #[test]
    fn markdown_export_includes_messages_reasoning_tools_and_citations() {
        let markdown = export_markdown(&sample_detail());
        assert!(markdown.starts_with("# Receita de bolo\n"));
        assert!(markdown.contains("## Usuário"));
        assert!(markdown.contains("## Assistente"));
        assert!(markdown.contains("Qual é a receita?"));
        assert!(markdown.contains("<summary>Raciocínio</summary>"));
        assert!(markdown.contains("Misture tudo e asse."));
        assert!(markdown.contains("**Ferramentas:**"));
        assert!(markdown.contains("`web_search` (concluída) — Busca concluída"));
        assert!(markdown.contains("**Citações:**"));
        assert!(markdown.contains("[Receita simples](https://example.com/receita)"));
        assert!(markdown.contains("Uso de tokens: entrada 10, saída 20"));
        assert!(markdown.contains("_Exportado por Lumina "));
    }

    #[test]
    fn file_stem_is_safe_and_bounded() {
        assert_eq!(file_stem("Receita de bolo"), "Receita-de-bolo");
        assert_eq!(file_stem("  ...  "), "conversa-lumina");
        assert_eq!(file_stem("a/b\\c:d*e?f"), "a-b-c-d-e-f");
        let long = file_stem(&"x".repeat(200));
        assert_eq!(long.chars().count(), 60);
        assert_eq!(file_stem("Café com pão"), "Café-com-pão");
    }

    #[test]
    fn summarize_collapses_whitespace_and_caps_length() {
        assert_eq!(summarize("  a\n\n b\t c ", 20), "a b c");
        let long = summarize(&"y".repeat(50), 10);
        assert!(long.ends_with('…'));
        assert_eq!(long.chars().count(), 11);
    }
}
