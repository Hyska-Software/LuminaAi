//! Computer-use tools (Code profile).
//!
//! Read-only observation (screenshot/window list) is capability-gated. Every
//! input action goes through `policy_check` with `RiskClass::Computer`, so it
//! always requires an explicit approval, including in Autonomous mode.

use serde_json::{json, Value};

use crate::domain::{ApprovalDetail, RiskClass};
use crate::providers::ToolDefinition;
use crate::tools::registry::ToolCtx;
use crate::tools::ToolOutcome;

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

async fn approve(ctx: &ToolCtx, tool: &str, text: String) -> Result<(), ToolOutcome> {
    super::exec::policy_check(
        ctx,
        tool,
        RiskClass::Computer,
        true,
        None,
        false,
        None,
        ApprovalDetail::Other { text },
        "Controlar o computador?",
    )
    .await
}

pub async fn run(ctx: &ToolCtx, tool: &str, args: &Value) -> ToolOutcome {
    match tool {
        "computer_screenshot" => match crate::computer::screenshot(
            &ctx.settings,
            &ctx.data_dir,
            &ctx.conversation_id,
        )
        .await
        {
            Ok(shot) => ToolOutcome {
                content: serde_json::to_string_pretty(&shot).unwrap_or_else(|_| "{}".to_string()),
                summary: Some(format!("Screenshot {}×{}", shot.width, shot.height)),
                ..Default::default()
            },
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
            if let Err(outcome) =
                approve(ctx, tool, format!("Abrir `{url_value}` no navegador")).await
            {
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
            if let Err(outcome) = approve(
                ctx,
                tool,
                format!(
                    "Clique {}x no botão {} em ({x}, {y})",
                    clicks, button
                ),
            )
            .await
            {
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
            if let Err(outcome) = approve(
                ctx,
                tool,
                format!("Digitar {} caractere(s) na janela focada", text.chars().count()),
            )
            .await
            {
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
            if let Err(outcome) =
                approve(ctx, tool, format!("Pressionar `{combo}` na janela focada")).await
            {
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
            if let Err(outcome) =
                approve(ctx, tool, format!("Focar a janela `{window_id}`")).await
            {
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
