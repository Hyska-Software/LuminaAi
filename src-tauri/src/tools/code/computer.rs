//! Computer-use tools (Code profile).
//!
//! Read-only observation (screenshot/window list) is capability-gated. Every
//! input action goes through `policy_check` with `RiskClass::Computer`, so it
//! always requires an explicit approval, including in Autonomous mode.

use base64::Engine;
use serde_json::{json, Value};

use crate::domain::{ApprovalDetail, RiskClass};
use crate::providers::ToolDefinition;
use crate::tools::registry::ToolCtx;
use crate::tools::{ToolImage, ToolOutcome};

const TOOL_NAMES: &[&str] = &[
    "computer_screenshot",
    "computer_windows",
    "computer_ui_tree",
    "computer_click",
    "computer_type",
    "computer_key",
    "computer_focus",
    "browser_open",
];

pub fn tool_names() -> &'static [&'static str] {
    TOOL_NAMES
}

pub fn is_computer_tool(name: &str) -> bool {
    TOOL_NAMES.contains(&name)
}

pub fn definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "computer_screenshot".to_string(),
            description: "Capture the local screen (or the Docker graphical session) to a PNG. \
                          Returns the absolute path and dimensions. The user can inspect the file; \
                          use `computer_windows` for window targets."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "display": { "type": "string", "description": "Optional display hint." }
                },
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "computer_windows".to_string(),
            description: "List visible windows with id, title and application. Use the id with \
                          `computer_focus`."
                .to_string(),
            parameters: json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        },
        ToolDefinition {
            name: "computer_ui_tree".to_string(),
            description: "Read the accessibility tree of the accessible desktop: element names, \
                          control types, bounds and automation ids. Use this as the text fallback \
                          when the model cannot inspect the screenshot; then click the element's \
                          center coordinates."
                .to_string(),
            parameters: json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        },
        ToolDefinition {
            name: "computer_click".to_string(),
            description: "Move the mouse to (x, y) and click. Requires explicit approval."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "x": { "type": "integer" },
                    "y": { "type": "integer" },
                    "button": { "type": "string", "enum": ["left", "right", "middle"] },
                    "clicks": { "type": "integer", "minimum": 1, "maximum": 3 }
                },
                "required": ["x", "y"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "computer_type".to_string(),
            description: "Type text into the focused window. Requires explicit approval; the \
                          approval shows only the length, never the text."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": { "text": { "type": "string" } },
                "required": ["text"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "computer_key".to_string(),
            description: "Press a key combination in the focused window (e.g. CTRL+S, ENTER). \
                          Requires explicit approval."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": { "key": { "type": "string" } },
                "required": ["key"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "computer_focus".to_string(),
            description: "Focus a visible window by id. Requires explicit approval."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": { "windowId": { "type": "string" } },
                "required": ["windowId"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "browser_open".to_string(),
            description: "Open an http(s) URL in the local default browser or in Chromium inside \
                          the Docker desktop. The page is then controlled with computer_screenshot/\
                          computer_ui_tree/computer_click/computer_type. Requires explicit approval."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": { "url": { "type": "string" } },
                "required": ["url"],
                "additionalProperties": false
            }),
        },
    ]
}

fn int_arg(args: &Value, key: &str) -> Option<i64> {
    args.get(key).and_then(Value::as_i64)
}

fn str_arg(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

async fn guard_sensitive(ctx: &ToolCtx) -> Result<(), ToolOutcome> {
    match crate::computer::active_window_title(&ctx.settings, &ctx.data_dir).await {
        Ok(title) if crate::computer::is_sensitive_title(&title) => Err(ToolOutcome::error(
            format!(
                "COMPUTER_SENSITIVE_WINDOW: a janela ativa (`{}`) está na denylist e não pode receber automação",
                title
            ),
        )),
        Ok(_) => Ok(()),
        Err(error) => Err(ToolOutcome::error(format!(
            "COMPUTER_SENSITIVE_CHECK_FAILED: {error:#}"
        ))),
    }
}

async fn approval_preview(ctx: &ToolCtx) -> Option<String> {
    crate::computer::screenshot(&ctx.settings, &ctx.data_dir, &ctx.conversation_id)
        .await
        .ok()
        .map(|shot| shot.path)
}

async fn approve(
    ctx: &ToolCtx,
    tool: &str,
    detail: ApprovalDetail,
) -> Result<(), ToolOutcome> {
    super::exec::policy_check(
        ctx,
        tool,
        RiskClass::Computer,
        true,
        None,
        false,
        None,
        detail,
        "Controlar o computador?",
    )
    .await
}

async fn run_inner(ctx: &ToolCtx, tool: &str, args: &Value) -> ToolOutcome {
    match tool {
        "computer_screenshot" => match crate::computer::screenshot(
            &ctx.settings,
            &ctx.data_dir,
            &ctx.conversation_id,
        )
        .await
        {
            Ok(shot) => {
                let image = std::fs::read(&shot.path).ok().map(|bytes| ToolImage {
                    mime_type: "image/png".to_string(),
                    data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
                    width: shot.width,
                    height: shot.height,
                });
                ToolOutcome {
                    content: serde_json::to_string_pretty(&shot).unwrap_or_else(|_| "{}".to_string()),
                    summary: Some(format!("Screenshot {}×{}", shot.width, shot.height)),
                    images: image.into_iter().collect(),
                    ..Default::default()
                }
            }
            Err(error) => ToolOutcome::error(format!("{error:#}")),
        },
        "computer_windows" => match crate::computer::windows(&ctx.settings, &ctx.data_dir).await {
            Ok(windows) => ToolOutcome {
                content: serde_json::to_string_pretty(&windows)
                    .unwrap_or_else(|_| "[]".to_string()),
                summary: Some(format!("{} janela(s)", windows.len())),
                ..Default::default()
            },
            Err(error) => ToolOutcome::error(format!("{error:#}")),
        },
        "computer_ui_tree" => {
            match crate::computer::ui_tree(&ctx.settings, &ctx.data_dir).await {
                Ok(value) => ToolOutcome {
                    content: serde_json::to_string_pretty(&value)
                        .unwrap_or_else(|_| "[]".to_string()),
                    summary: Some("Árvore de acessibilidade".to_string()),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "browser_open" => {
            let Some(url_value) = str_arg(args, "url") else {
                return ToolOutcome::error("o argumento `url` é obrigatório");
            };
            let detail = ApprovalDetail::ComputerAction {
                action: "browser_open".to_string(),
                target: url_value.clone(),
                screenshot_path: approval_preview(ctx).await,
                text_length: None,
                sensitive: false,
            };
            if let Err(outcome) = approve(ctx, tool, detail).await {
                return outcome;
            }
            match crate::computer::open_url(&ctx.settings, &ctx.data_dir, &url_value).await {
                Ok(()) => ToolOutcome {
                    content: format!("opened {url_value} in the controlled browser"),
                    summary: Some("Navegador aberto".to_string()),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "computer_click" => {
            let Some(x) = int_arg(args, "x") else {
                return ToolOutcome::error("o argumento `x` é obrigatório");
            };
            let Some(y) = int_arg(args, "y") else {
                return ToolOutcome::error("o argumento `y` é obrigatório");
            };
            let button = str_arg(args, "button").unwrap_or_else(|| "left".to_string());
            let clicks = int_arg(args, "clicks").unwrap_or(1).clamp(1, 3) as u8;
            if let Err(outcome) = guard_sensitive(ctx).await {
                return outcome;
            }
            let detail = ApprovalDetail::ComputerAction {
                action: "click".to_string(),
                target: format!("({x}, {y}) botão {button} ×{clicks}"),
                screenshot_path: approval_preview(ctx).await,
                text_length: None,
                sensitive: false,
            };
            if let Err(outcome) = approve(ctx, tool, detail).await {
                return outcome;
            }
            match crate::computer::click(
                &ctx.settings,
                &ctx.data_dir,
                x as i32,
                y as i32,
                &button,
                clicks,
            )
            .await
            {
                Ok(()) => ToolOutcome {
                    content: format!("clicked ({x}, {y}) button={button} clicks={clicks}"),
                    summary: Some("Clique executado".to_string()),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "computer_type" => {
            let Some(text) = str_arg(args, "text") else {
                return ToolOutcome::error("o argumento `text` é obrigatório");
            };
            if let Err(outcome) = guard_sensitive(ctx).await {
                return outcome;
            }
            let detail = ApprovalDetail::ComputerAction {
                action: "type".to_string(),
                target: "janela focada".to_string(),
                screenshot_path: approval_preview(ctx).await,
                text_length: Some(text.chars().count() as u32),
                sensitive: false,
            };
            if let Err(outcome) = approve(ctx, tool, detail).await {
                return outcome;
            }
            match crate::computer::type_text(&ctx.settings, &ctx.data_dir, &text).await {
                Ok(()) => ToolOutcome {
                    content: format!(
                        "typed {} character(s) into the focused window",
                        text.chars().count()
                    ),
                    summary: Some("Texto digitado".to_string()),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "computer_key" => {
            let Some(combo) = str_arg(args, "key") else {
                return ToolOutcome::error("o argumento `key` é obrigatório");
            };
            if let Err(outcome) = guard_sensitive(ctx).await {
                return outcome;
            }
            let detail = ApprovalDetail::ComputerAction {
                action: "key".to_string(),
                target: combo.clone(),
                screenshot_path: approval_preview(ctx).await,
                text_length: None,
                sensitive: false,
            };
            if let Err(outcome) = approve(ctx, tool, detail).await {
                return outcome;
            }
            match crate::computer::key(&ctx.settings, &ctx.data_dir, &combo).await {
                Ok(()) => ToolOutcome {
                    content: format!("pressed {combo}"),
                    summary: Some("Tecla pressionada".to_string()),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "computer_focus" => {
            let Some(window_id) = str_arg(args, "windowId") else {
                return ToolOutcome::error("o argumento `windowId` é obrigatório");
            };
            if let Err(outcome) = guard_sensitive(ctx).await {
                return outcome;
            }
            let detail = ApprovalDetail::ComputerAction {
                action: "focus".to_string(),
                target: window_id.clone(),
                screenshot_path: approval_preview(ctx).await,
                text_length: None,
                sensitive: false,
            };
            if let Err(outcome) = approve(ctx, tool, detail).await {
                return outcome;
            }
            match crate::computer::focus(&ctx.settings, &ctx.data_dir, &window_id).await {
                Ok(()) => ToolOutcome {
                    content: format!("focused window {window_id}"),
                    summary: Some("Janela focada".to_string()),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        other => ToolOutcome::error(format!("ferramenta de computador desconhecida: {other}")),
    }
}

fn audit_target(tool: &str, args: &Value) -> Value {
    match tool {
        "computer_type" => json!({
            "textLength": args
                .get("text")
                .and_then(Value::as_str)
                .map(|text| text.chars().count())
                .unwrap_or(0),
        }),
        "computer_click" => json!({
            "x": args.get("x"),
            "y": args.get("y"),
            "button": args.get("button"),
            "clicks": args.get("clicks"),
        }),
        "computer_key" => json!({ "key": args.get("key") }),
        "computer_focus" => json!({ "windowId": args.get("windowId") }),
        "browser_open" => json!({ "url": args.get("url") }),
        "computer_screenshot" => json!({ "display": args.get("display") }),
        _ => json!({}),
    }
}

fn error_code_of(outcome: &ToolOutcome) -> Option<String> {
    if !outcome.is_error {
        return None;
    }
    let text = outcome.content.trim();
    let text = text.strip_prefix("ERROR:").unwrap_or(text).trim();
    let first = text.split(':').next().unwrap_or("TOOL_ERROR").trim();
    if first.is_empty() {
        Some("TOOL_ERROR".to_string())
    } else {
        Some(first.chars().take(80).collect())
    }
}

fn decision_of(outcome: &ToolOutcome) -> Option<String> {
    let code = error_code_of(outcome)?;
    if code.contains("APPROVAL_CANCEL") {
        Some("cancelled".to_string())
    } else if code.contains("APPROVAL_TIMEOUT") || code.contains("APPROVAL_EXPIRED") {
        Some("expired".to_string())
    } else if code.contains("APPROVAL") {
        Some("denied".to_string())
    } else {
        None
    }
}

pub async fn run(ctx: &ToolCtx, tool: &str, args: &Value) -> ToolOutcome {
    let conversation = ctx.db.get_conversation(&ctx.conversation_id).ok().flatten();
    let agent_id = conversation.as_ref().and_then(|value| value.agent_id.clone());
    let now = crate::domain::now_ms();
    if let Ok(count) = ctx
        .db
        .count_computer_actions_for_turn(&ctx.turn_id)
    {
        if count >= i64::from(ctx.settings.computer_max_actions_per_turn.max(1)) {
            return ToolOutcome::error(format!(
                "COMPUTER_RATE_LIMIT: limite de {} ações por turno atingido",
                ctx.settings.computer_max_actions_per_turn
            ));
        }
    }
    if let Some(agent_id) = agent_id.as_deref() {
        if let Ok(count) = ctx
            .db
            .count_computer_actions_for_agent_since(agent_id, now - 60 * 60 * 1000)
        {
            if count >= i64::from(ctx.settings.computer_max_actions_per_hour.max(1)) {
                return ToolOutcome::error(format!(
                    "COMPUTER_RATE_LIMIT: limite de {} ações por hora atingido",
                    ctx.settings.computer_max_actions_per_hour
                ));
            }
        }
    }
    let backend = if ctx.settings.execution_environment == "docker" {
        "docker"
    } else {
        "local"
    };
    let session = match ctx.db.get_or_create_computer_session(
        agent_id.as_deref(),
        &ctx.conversation_id,
        backend,
        now,
    ) {
        Ok(session) => session,
        Err(error) => return ToolOutcome::error(format!("{error:#}")),
    };
    let outcome = run_inner(ctx, tool, args).await;
    let redacted_text_len = args
        .get("text")
        .and_then(Value::as_str)
        .map(|text| text.chars().count() as i64);
    let decision = decision_of(&outcome);
    let _ = ctx.db.insert_computer_action(
        &session.id,
        agent_id.as_deref(),
        &ctx.conversation_id,
        &ctx.turn_id,
        tool,
        tool,
        &audit_target(tool, args),
        Some(if decision.is_some() { "once" } else { "read" }),
        decision.as_deref(),
        if outcome.is_error { "error" } else { "ok" },
        error_code_of(&outcome).as_deref(),
        outcome
            .is_error
            .then(|| outcome.content.chars().take(300).collect::<String>())
            .as_deref(),
        redacted_text_len,
        crate::domain::now_ms(),
    );
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_error_codes_skip_the_error_prefix_and_map_decisions() {
        assert_eq!(
            error_code_of(&ToolOutcome::error(
                "APPROVAL_DENIED: o usuário negou a ação"
            ))
            .as_deref(),
            Some("APPROVAL_DENIED")
        );
        assert_eq!(
            decision_of(&ToolOutcome::error(
                "APPROVAL_CANCELLED: a aprovação foi cancelada"
            ))
            .as_deref(),
            Some("cancelled")
        );
        assert_eq!(
            decision_of(&ToolOutcome::error("APPROVAL_DENIED: negado")).as_deref(),
            Some("denied")
        );
        assert_eq!(
            decision_of(&ToolOutcome::error("COMPUTER_RATE_LIMIT: limite")),
            None
        );
        assert!(error_code_of(&ToolOutcome {
            content: "ok".to_string(),
            ..Default::default()
        })
        .is_none());
    }

    #[test]
    fn audit_target_never_contains_typed_text() {
        let target = audit_target(
            "computer_type",
            &json!({ "text": "senha-secreta", "x": 1 }),
        );
        assert_eq!(target["textLength"], json!(13));
        let serialized = target.to_string();
        assert!(!serialized.contains("senha"));
    }
}
