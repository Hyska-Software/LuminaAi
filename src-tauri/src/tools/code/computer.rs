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
    "computer_drag",
    "computer_scroll",
    "computer_move",
    "computer_wait",
    "computer_clipboard",
    "computer_type",
    "computer_key",
    "computer_focus",
    "browser_open",
    "browser_navigate",
    "browser_snapshot",
    "browser_click",
    "browser_type",
    "browser_press",
    "browser_scroll",
    "browser_hover",
    "browser_select",
    "browser_upload",
    "browser_wait",
    "browser_extract",
    "browser_tabs",
    "browser_download",
];

pub fn tool_names() -> &'static [&'static str] {
    TOOL_NAMES
}

pub fn is_computer_tool(name: &str) -> bool {
    TOOL_NAMES.contains(&name)
}

pub fn is_browser_tool(name: &str) -> bool {
    name.starts_with("browser_")
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
            name: "computer_drag".to_string(),
            description: "Drag from one screen coordinate to another. Requires explicit approval."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "fromX": { "type": "integer" },
                    "fromY": { "type": "integer" },
                    "toX": { "type": "integer" },
                    "toY": { "type": "integer" },
                    "button": { "type": "string", "enum": ["left", "right"] }
                },
                "required": ["fromX", "fromY", "toX", "toY"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "computer_scroll".to_string(),
            description: "Scroll at a screen coordinate. Positive delta scrolls up, negative down. Requires explicit approval."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "x": { "type": "integer" },
                    "y": { "type": "integer" },
                    "delta": { "type": "integer", "minimum": -2400, "maximum": 2400 }
                },
                "required": ["x", "y", "delta"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "computer_move".to_string(),
            description: "Move the pointer without clicking. Requires explicit approval."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": { "x": { "type": "integer" }, "y": { "type": "integer" } },
                "required": ["x", "y"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "computer_wait".to_string(),
            description: "Wait 50–5000 ms for the UI to settle. No approval required."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": { "ms": { "type": "integer", "minimum": 50, "maximum": 5000 } },
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "computer_clipboard".to_string(),
            description: "Read or write the clipboard. Requires explicit approval; write shows only the length, read returns the text to the model."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["read", "write"] },
                    "text": { "type": "string" }
                },
                "required": ["action"],
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
            description: "Open an http(s) URL in the controlled local Chromium/Edge session. The \
                          session uses an isolated profile and a loopback CDP port. Requires explicit \
                          approval."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": { "url": { "type": "string" } },
                "required": ["url"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "browser_navigate".to_string(),
            description: "Navigate the controlled browser to an http(s) URL. Requires explicit approval."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string" },
                    "tabId": { "type": "string", "description": "Target tab; defaults to the active one." }
                },
                "required": ["url"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "browser_snapshot".to_string(),
            description: "Read the active page: URL, title, accessibility elements with stable refs \
                          (e1, e2, …) and a screenshot. Use a ref with browser_click/browser_type."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": { "tabId": { "type": "string" } },
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "browser_click".to_string(),
            description: "Click an element by ref from the latest browser_snapshot. Requires explicit approval."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "ref": { "type": "string" },
                    "tabId": { "type": "string" }
                },
                "required": ["ref"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "browser_type".to_string(),
            description: "Type text into an element by ref. Requires explicit approval; the card \
                          shows only the text length."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "ref": { "type": "string" },
                    "text": { "type": "string" },
                    "tabId": { "type": "string" }
                },
                "required": ["ref", "text"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "browser_press".to_string(),
            description: "Press Enter/Tab/Escape/Backspace/arrow/Space in the controlled browser. \
                          Requires explicit approval."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "key": { "type": "string" },
                    "tabId": { "type": "string" }
                },
                "required": ["key"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "browser_scroll".to_string(),
            description: "Scroll the controlled page by delta pixels (negative scrolls down)."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "delta": { "type": "integer", "minimum": -5000, "maximum": 5000 },
                    "tabId": { "type": "string" }
                },
                "required": ["delta"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "browser_hover".to_string(),
            description: "Move the mouse over an element by ref (read-only interaction)."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "ref": { "type": "string" },
                    "tabId": { "type": "string" }
                },
                "required": ["ref"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "browser_select".to_string(),
            description: "Set the value of a select/input by ref. Requires explicit approval."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "ref": { "type": "string" },
                    "value": { "type": "string" },
                    "tabId": { "type": "string" }
                },
                "required": ["ref", "value"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "browser_upload".to_string(),
            description: "Attach a workspace file to a file input by ref. Requires explicit approval."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "ref": { "type": "string" },
                    "path": { "type": "string" },
                    "tabId": { "type": "string" }
                },
                "required": ["ref", "path"],
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "browser_wait".to_string(),
            description: "Wait 50–5000 ms for the page to settle. No approval required."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": { "ms": { "type": "integer", "minimum": 50, "maximum": 5000 } },
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "browser_extract".to_string(),
            description: "Extract the visible text and metadata of the active page (read-only)."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": { "tabId": { "type": "string" } },
                "additionalProperties": false
            }),
        },
        ToolDefinition {
            name: "browser_tabs".to_string(),
            description: "List open browser tabs (read-only)."
                .to_string(),
            parameters: json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        },
        ToolDefinition {
            name: "browser_download".to_string(),
            description: "Click an element that starts a download and wait for the file in the \
                          session download folder. Requires explicit approval."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "ref": { "type": "string" },
                    "tabId": { "type": "string" }
                },
                "required": ["ref"],
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
    let title = match crate::computer::active_window_title(
        &ctx.settings,
        &ctx.data_dir,
        &ctx.conversation_id,
    )
    .await
    {
        Ok(title) => title,
        Err(error) => {
            return Err(ToolOutcome::error(format!(
                "COMPUTER_SENSITIVE_CHECK_FAILED: {error:#}"
            )))
        }
    };
    if crate::computer::is_sensitive_title(&title) {
        return Err(ToolOutcome::error(format!(
            "COMPUTER_SENSITIVE_WINDOW: a janela ativa (`{title}`) está na denylist e não pode receber automação"
        )));
    }
    let app = crate::computer::active_window_app(
        &ctx.settings,
        &ctx.data_dir,
        &ctx.conversation_id,
    )
    .await
    .unwrap_or_default()
    .to_ascii_lowercase();
    let matches = |rule: &String| {
        let rule = rule.to_ascii_lowercase();
        !rule.is_empty() && (app.contains(&rule) || title.to_ascii_lowercase().contains(&rule))
    };
    if ctx.settings.computer_blocked_apps.iter().any(matches) {
        return Err(ToolOutcome::error(format!(
            "COMPUTER_APP_FORBIDDEN: `{app}` está na denylist de apps"
        )));
    }
    if !ctx.settings.computer_allowed_apps.is_empty()
        && !ctx.settings.computer_allowed_apps.iter().any(matches)
    {
        return Err(ToolOutcome::error(format!(
            "COMPUTER_APP_FORBIDDEN: `{app}` não está na allowlist de apps"
        )));
    }
    Ok(())
}

async fn approval_preview(ctx: &ToolCtx) -> Option<String> {
    crate::computer::screenshot(&ctx.settings, &ctx.data_dir, &ctx.conversation_id)
        .await
        .ok()
        .map(|shot| shot.path)
}

fn can_skip_browser_approval(has_approval: bool, allow_unattended: bool, tool: &str) -> bool {
    !has_approval && allow_unattended && is_browser_tool(tool)
}

async fn approve(
    ctx: &ToolCtx,
    tool: &str,
    detail: ApprovalDetail,
) -> Result<(), ToolOutcome> {
    // Unattended routines/tasks have no approval card. Browser actions can be
    // explicitly pre-authorized (domain policy still applies) while desktop
    // input remains fail-closed.
    if can_skip_browser_approval(
        ctx.approval.is_some(),
        ctx.settings.computer_allow_unattended_browser,
        tool,
    ) {
        return Ok(());
    }
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
        "computer_windows" => {
            match crate::computer::windows(&ctx.settings, &ctx.data_dir, &ctx.conversation_id).await {
                Ok(windows) => ToolOutcome {
                content: serde_json::to_string_pretty(&windows)
                    .unwrap_or_else(|_| "[]".to_string()),
                summary: Some(format!("{} janela(s)", windows.len())),
                ..Default::default()
            },
            Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        },
        "computer_ui_tree" => {
            match crate::computer::ui_tree(&ctx.settings, &ctx.data_dir, &ctx.conversation_id).await {
                Ok(value) => ToolOutcome {
                    content: serde_json::to_string_pretty(&value)
                        .unwrap_or_else(|_| "[]".to_string()),
                    summary: Some("Árvore de acessibilidade".to_string()),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "browser_open" | "browser_navigate" | "browser_snapshot" | "browser_click"
        | "browser_type" | "browser_press" | "browser_scroll" | "browser_hover"
        | "browser_select" | "browser_upload" | "browser_wait" | "browser_extract"
        | "browser_tabs" | "browser_download" => run_browser(ctx, tool, args).await,
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
                &ctx.conversation_id,
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
        "computer_drag" => {
            let (Some(from_x), Some(from_y), Some(to_x), Some(to_y)) = (
                int_arg(args, "fromX"),
                int_arg(args, "fromY"),
                int_arg(args, "toX"),
                int_arg(args, "toY"),
            ) else {
                return ToolOutcome::error(
                    "os argumentos `fromX`, `fromY`, `toX` e `toY` são obrigatórios",
                );
            };
            let button = str_arg(args, "button").unwrap_or_else(|| "left".to_string());
            if let Err(outcome) = guard_sensitive(ctx).await {
                return outcome;
            }
            let detail = ApprovalDetail::ComputerAction {
                action: "drag".to_string(),
                target: format!("({from_x}, {from_y}) → ({to_x}, {to_y}) botão {button}"),
                screenshot_path: approval_preview(ctx).await,
                text_length: None,
                sensitive: false,
            };
            if let Err(outcome) = approve(ctx, tool, detail).await {
                return outcome;
            }
            match crate::computer::drag(
                &ctx.settings,
                &ctx.data_dir,
                &ctx.conversation_id,
                from_x as i32,
                from_y as i32,
                to_x as i32,
                to_y as i32,
                &button,
            )
            .await
            {
                Ok(()) => ToolOutcome {
                    content: format!("dragged ({from_x}, {from_y}) to ({to_x}, {to_y})"),
                    summary: Some("Arrasto executado".to_string()),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "computer_scroll" => {
            let (Some(x), Some(y), Some(delta)) = (
                int_arg(args, "x"),
                int_arg(args, "y"),
                int_arg(args, "delta"),
            ) else {
                return ToolOutcome::error(
                    "os argumentos `x`, `y` e `delta` são obrigatórios",
                );
            };
            if let Err(outcome) = guard_sensitive(ctx).await {
                return outcome;
            }
            let detail = ApprovalDetail::ComputerAction {
                action: "scroll".to_string(),
                target: format!("({x}, {y}) delta {delta}"),
                screenshot_path: approval_preview(ctx).await,
                text_length: None,
                sensitive: false,
            };
            if let Err(outcome) = approve(ctx, tool, detail).await {
                return outcome;
            }
            match crate::computer::scroll(
                &ctx.settings,
                &ctx.data_dir,
                &ctx.conversation_id,
                x as i32,
                y as i32,
                delta as i32,
            )
            .await
            {
                Ok(()) => ToolOutcome {
                    content: format!("scrolled at ({x}, {y}) by {delta}"),
                    summary: Some("Scroll executado".to_string()),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "computer_move" => {
            let (Some(x), Some(y)) = (int_arg(args, "x"), int_arg(args, "y")) else {
                return ToolOutcome::error("os argumentos `x` e `y` são obrigatórios");
            };
            if let Err(outcome) = guard_sensitive(ctx).await {
                return outcome;
            }
            let detail = ApprovalDetail::ComputerAction {
                action: "move".to_string(),
                target: format!("({x}, {y})"),
                screenshot_path: approval_preview(ctx).await,
                text_length: None,
                sensitive: false,
            };
            if let Err(outcome) = approve(ctx, tool, detail).await {
                return outcome;
            }
            match crate::computer::move_pointer(
                &ctx.settings,
                &ctx.data_dir,
                &ctx.conversation_id,
                x as i32,
                y as i32,
            )
            .await
            {
                Ok(()) => ToolOutcome {
                    content: format!("moved pointer to ({x}, {y})"),
                    summary: Some("Ponteiro movido".to_string()),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(format!("{error:#}")),
            }
        }
        "computer_wait" => {
            let ms = int_arg(args, "ms").unwrap_or(500).clamp(50, 5_000) as u64;
            tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
            ToolOutcome {
                content: format!("waited {ms} ms"),
                summary: Some(format!("Espera de {ms} ms")),
                ..Default::default()
            }
        }
        "computer_clipboard" => {
            let Some(action) = str_arg(args, "action") else {
                return ToolOutcome::error("o argumento `action` é obrigatório");
            };
            if action == "read" {
                let detail = ApprovalDetail::ComputerAction {
                    action: "clipboard_read".to_string(),
                    target: "clipboard".to_string(),
                    screenshot_path: None,
                    text_length: None,
                    sensitive: true,
                };
                if let Err(outcome) = approve(ctx, tool, detail).await {
                    return outcome;
                }
                match crate::computer::clipboard_read(
                    &ctx.settings,
                    &ctx.data_dir,
                    &ctx.conversation_id,
                )
                .await
                {
                    Ok(text) => ToolOutcome {
                        content: text.chars().take(20_000).collect(),
                        summary: Some("Clipboard lido".to_string()),
                        ..Default::default()
                    },
                    Err(error) => ToolOutcome::error(format!("{error:#}")),
                }
            } else if action == "write" {
                let Some(text) = args.get("text").and_then(Value::as_str) else {
                    return ToolOutcome::error("o argumento `text` é obrigatório para write");
                };
                let detail = ApprovalDetail::ComputerAction {
                    action: "clipboard_write".to_string(),
                    target: "clipboard".to_string(),
                    screenshot_path: None,
                    text_length: Some(text.chars().count() as u32),
                    sensitive: true,
                };
                if let Err(outcome) = approve(ctx, tool, detail).await {
                    return outcome;
                }
                match crate::computer::clipboard_write(
                    &ctx.settings,
                    &ctx.data_dir,
                    &ctx.conversation_id,
                    text,
                )
                .await
                {
                    Ok(()) => ToolOutcome {
                        content: format!("wrote {} characters to the clipboard", text.chars().count()),
                        summary: Some("Clipboard atualizado".to_string()),
                        ..Default::default()
                    },
                    Err(error) => ToolOutcome::error(format!("{error:#}")),
                }
            } else {
                ToolOutcome::error("action inválida: use read ou write")
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
            match crate::computer::type_text(
                &ctx.settings,
                &ctx.data_dir,
                &ctx.conversation_id,
                &text,
            )
            .await
            {
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
            match crate::computer::key(
                &ctx.settings,
                &ctx.data_dir,
                &ctx.conversation_id,
                &combo,
            )
            .await
            {
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
            match crate::computer::focus(
                &ctx.settings,
                &ctx.data_dir,
                &ctx.conversation_id,
                &window_id,
            )
            .await
            {
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

async fn run_browser(ctx: &ToolCtx, tool: &str, args: &Value) -> ToolOutcome {
    let Some(manager) = crate::computer::browser::global() else {
        return ToolOutcome::error("BROWSER_NOT_INITIALIZED: sessão de navegador indisponível");
    };
    let tab = str_arg(args, "tabId");
    let downloads = ctx
        .workspace
        .as_ref()
        .map(|workspace| workspace.root.join("downloads"));
    match tool {
        "browser_open" => {
            let Some(url) = str_arg(args, "url") else {
                return ToolOutcome::error("o argumento `url` é obrigatório");
            };
            let Ok(url) = crate::computer::browser::validate_with_policy(&ctx.settings, &url) else {
                return ToolOutcome::error("BROWSER_URL_FORBIDDEN: URL inválida ou não http(s)");
            };
            let detail = ApprovalDetail::ComputerAction {
                action: "browser_open".to_string(),
                target: url.clone(),
                screenshot_path: None,
                text_length: None,
                sensitive: false,
            };
            if let Err(outcome) = approve(ctx, tool, detail).await {
                return outcome;
            }
            match manager
                .ensure(&ctx.conversation_id, downloads.clone())
                .await
            {
                Ok(status) => match manager
                    .navigate(&ctx.conversation_id, status.active_tab.as_deref(), &url)
                    .await
                {
                    Ok(target) => ToolOutcome {
                        content: format!("opened {target} in the controlled browser"),
                        summary: Some("Navegador controlado".to_string()),
                        ..Default::default()
                    },
                    Err(error) => ToolOutcome::error(error),
                },
                Err(error) => ToolOutcome::error(error.to_string()),
            }
        }
        "browser_navigate" => {
            let Some(url) = str_arg(args, "url") else {
                return ToolOutcome::error("o argumento `url` é obrigatório");
            };
            let Ok(url) = crate::computer::browser::validate_with_policy(&ctx.settings, &url) else {
                return ToolOutcome::error("BROWSER_URL_FORBIDDEN: URL inválida ou não http(s)");
            };
            let detail = ApprovalDetail::ComputerAction {
                action: "browser_navigate".to_string(),
                target: url.clone(),
                screenshot_path: None,
                text_length: None,
                sensitive: false,
            };
            if let Err(outcome) = approve(ctx, tool, detail).await {
                return outcome;
            }
            match manager
                .navigate(&ctx.conversation_id, tab.as_deref(), &url)
                .await
            {
                Ok(target) => ToolOutcome {
                    content: format!("navigated to {target}"),
                    summary: Some("Página navegada".to_string()),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(error),
            }
        }
        "browser_snapshot" => match manager.snapshot(&ctx.conversation_id, tab.as_deref()).await {
            Ok(snapshot) => {
                let mut content = String::new();
                content.push_str(&format!("URL: {}\nTitle: {}\n\n", snapshot.url, snapshot.title));
                for element in &snapshot.elements {
                    content.push_str(&format!(
                        "[{}] {} \"{}\"{}{}\n",
                        element.reference,
                        element.role,
                        element.name,
                        if element.value.is_empty() {
                            String::new()
                        } else {
                            format!(" value=\"{}\"", element.value)
                        },
                        if element.disabled { " (disabled)" } else { "" }
                    ));
                }
                let image = snapshot.screenshot.map(|data| ToolImage {
                    mime_type: "image/jpeg".to_string(),
                    data_base64: data,
                    width: snapshot.width,
                    height: snapshot.height,
                });
                ToolOutcome {
                    content,
                    summary: Some(format!(
                        "{} · {} elemento(s)",
                        snapshot.title,
                        snapshot.elements.len()
                    )),
                    images: image.into_iter().collect(),
                    ..Default::default()
                }
            }
            Err(error) => ToolOutcome::error(error),
        },
        "browser_click" => {
            let Some(reference) = str_arg(args, "ref") else {
                return ToolOutcome::error("o argumento `ref` é obrigatório");
            };
            let detail = ApprovalDetail::ComputerAction {
                action: "browser_click".to_string(),
                target: reference.clone(),
                screenshot_path: None,
                text_length: None,
                sensitive: false,
            };
            if let Err(outcome) = approve(ctx, tool, detail).await {
                return outcome;
            }
            match manager
                .click(&ctx.conversation_id, tab.as_deref(), &reference)
                .await
            {
                Ok(element) => ToolOutcome {
                    content: format!("clicked {} \"{}\"", element.role, element.name),
                    summary: Some(format!("Clique: {}", element.name)),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(error),
            }
        }
        "browser_type" => {
            let Some(reference) = str_arg(args, "ref") else {
                return ToolOutcome::error("o argumento `ref` é obrigatório");
            };
            let Some(text) = args.get("text").and_then(Value::as_str) else {
                return ToolOutcome::error("o argumento `text` é obrigatório");
            };
            let detail = ApprovalDetail::ComputerAction {
                action: "browser_type".to_string(),
                target: reference.clone(),
                screenshot_path: None,
                text_length: Some(text.chars().count() as u32),
                sensitive: false,
            };
            if let Err(outcome) = approve(ctx, tool, detail).await {
                return outcome;
            }
            match manager
                .type_text(&ctx.conversation_id, tab.as_deref(), &reference, text)
                .await
            {
                Ok(element) => ToolOutcome {
                    content: format!(
                        "typed {} characters into {} \"{}\"",
                        text.chars().count(),
                        element.role,
                        element.name
                    ),
                    summary: Some(format!("Texto em {}", element.name)),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(error),
            }
        }
        "browser_press" => {
            let Some(key) = str_arg(args, "key") else {
                return ToolOutcome::error("o argumento `key` é obrigatório");
            };
            let detail = ApprovalDetail::ComputerAction {
                action: "browser_press".to_string(),
                target: key.clone(),
                screenshot_path: None,
                text_length: None,
                sensitive: false,
            };
            if let Err(outcome) = approve(ctx, tool, detail).await {
                return outcome;
            }
            match manager
                .press(&ctx.conversation_id, tab.as_deref(), &key)
                .await
            {
                Ok(()) => ToolOutcome {
                    content: format!("pressed {key}"),
                    summary: Some(format!("Tecla {key}")),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(error),
            }
        }
        "browser_scroll" => {
            let delta = int_arg(args, "delta").unwrap_or(0).clamp(-5_000, 5_000) as i32;
            match manager
                .scroll(&ctx.conversation_id, tab.as_deref(), delta)
                .await
            {
                Ok(()) => ToolOutcome {
                    content: format!("scrolled the page by {delta}"),
                    summary: Some(format!("Scroll {delta}")),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(error),
            }
        }
        "browser_hover" => {
            let Some(reference) = str_arg(args, "ref") else {
                return ToolOutcome::error("o argumento `ref` é obrigatório");
            };
            match manager
                .hover(&ctx.conversation_id, tab.as_deref(), &reference)
                .await
            {
                Ok(element) => ToolOutcome {
                    content: format!("hovered {} \"{}\"", element.role, element.name),
                    summary: Some(format!("Hover: {}", element.name)),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(error),
            }
        }
        "browser_select" => {
            let Some(reference) = str_arg(args, "ref") else {
                return ToolOutcome::error("o argumento `ref` é obrigatório");
            };
            let Some(value) = args.get("value").and_then(Value::as_str) else {
                return ToolOutcome::error("o argumento `value` é obrigatório");
            };
            let detail = ApprovalDetail::ComputerAction {
                action: "browser_select".to_string(),
                target: reference.clone(),
                screenshot_path: None,
                text_length: None,
                sensitive: false,
            };
            if let Err(outcome) = approve(ctx, tool, detail).await {
                return outcome;
            }
            match manager
                .select(&ctx.conversation_id, tab.as_deref(), &reference, value)
                .await
            {
                Ok(element) => ToolOutcome {
                    content: format!("selected {value} in {} \"{}\"", element.role, element.name),
                    summary: Some(format!("Seleção em {}", element.name)),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(error),
            }
        }
        "browser_upload" => {
            let Some(reference) = str_arg(args, "ref") else {
                return ToolOutcome::error("o argumento `ref` é obrigatório");
            };
            let Some(path) = str_arg(args, "path") else {
                return ToolOutcome::error("o argumento `path` é obrigatório");
            };
            let Some(workspace) = ctx.workspace.as_ref() else {
                return ToolOutcome::error(
                    "BROWSER_UPLOAD_NO_WORKSPACE: vincule um workspace para enviar arquivos",
                );
            };
            let root = match workspace.root.canonicalize() {
                Ok(root) => root,
                Err(error) => {
                    return ToolOutcome::error(format!("BROWSER_UPLOAD_WORKSPACE: {error}"))
                }
            };
            let file = match std::fs::canonicalize(&path) {
                Ok(file) => file,
                Err(error) => {
                    return ToolOutcome::error(format!("BROWSER_UPLOAD_FILE: {error}"))
                }
            };
            if !file.starts_with(&root) || !file.is_file() {
                return ToolOutcome::error(
                    "BROWSER_UPLOAD_FORBIDDEN: o arquivo precisa estar dentro do workspace",
                );
            }
            let detail = ApprovalDetail::ComputerAction {
                action: "browser_upload".to_string(),
                target: path.clone(),
                screenshot_path: None,
                text_length: None,
                sensitive: false,
            };
            if let Err(outcome) = approve(ctx, tool, detail).await {
                return outcome;
            }
            match manager
                .upload(
                    &ctx.conversation_id,
                    tab.as_deref(),
                    &reference,
                    &file.to_string_lossy(),
                )
                .await
            {
                Ok(element) => ToolOutcome {
                    content: format!("uploaded {path} into {} \"{}\"", element.role, element.name),
                    summary: Some("Arquivo anexado".to_string()),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(error),
            }
        }
        "browser_wait" => {
            let ms = int_arg(args, "ms").unwrap_or(500).clamp(50, 5_000) as u64;
            tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
            ToolOutcome {
                content: format!("waited {ms} ms"),
                summary: Some(format!("Espera de {ms} ms")),
                ..Default::default()
            }
        }
        "browser_extract" => match manager.extract(&ctx.conversation_id, tab.as_deref()).await {
            Ok(value) => ToolOutcome {
                content: serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string()),
                summary: Some("Conteúdo extraído".to_string()),
                ..Default::default()
            },
            Err(error) => ToolOutcome::error(error),
        },
        "browser_tabs" => match manager.tabs(&ctx.conversation_id).await {
            Ok(tabs) => ToolOutcome {
                content: serde_json::to_string_pretty(&tabs).unwrap_or_else(|_| "[]".to_string()),
                summary: Some(format!("{} aba(s)", tabs.len())),
                ..Default::default()
            },
            Err(error) => ToolOutcome::error(error),
        },
        "browser_download" => {
            let Some(reference) = str_arg(args, "ref") else {
                return ToolOutcome::error("o argumento `ref` é obrigatório");
            };
            let detail = ApprovalDetail::ComputerAction {
                action: "browser_download".to_string(),
                target: reference.clone(),
                screenshot_path: None,
                text_length: None,
                sensitive: false,
            };
            if let Err(outcome) = approve(ctx, tool, detail).await {
                return outcome;
            }
            match manager
                .wait_download(&ctx.conversation_id, tab.as_deref(), &reference)
                .await
            {
                Ok(value) => ToolOutcome {
                    content: serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string()),
                    summary: Some("Download concluído".to_string()),
                    ..Default::default()
                },
                Err(error) => ToolOutcome::error(error),
            }
        }
        other => ToolOutcome::error(format!("ferramenta de navegador desconhecida: {other}")),
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
        "computer_drag" => json!({
            "fromX": args.get("fromX"),
            "fromY": args.get("fromY"),
            "toX": args.get("toX"),
            "toY": args.get("toY"),
            "button": args.get("button"),
        }),
        "computer_scroll" => json!({
            "x": args.get("x"),
            "y": args.get("y"),
            "delta": args.get("delta"),
        }),
        "computer_move" => json!({
            "x": args.get("x"),
            "y": args.get("y"),
        }),
        "computer_clipboard" => json!({
            "action": args.get("action"),
            "textLength": if args.get("action").and_then(Value::as_str) == Some("write") {
                args.get("text")
                    .and_then(Value::as_str)
                    .map(|text| text.chars().count())
                    .unwrap_or(0)
            } else {
                0
            },
        }),
        "computer_focus" => json!({ "windowId": args.get("windowId") }),
        "browser_open" | "browser_navigate" => json!({ "url": args.get("url") }),
        "browser_type" => json!({
            "ref": args.get("ref"),
            "textLength": args
                .get("text")
                .and_then(Value::as_str)
                .map(|text| text.chars().count())
                .unwrap_or(0),
        }),
        "browser_click" | "browser_download" => json!({ "ref": args.get("ref") }),
        "browser_hover" => json!({ "ref": args.get("ref") }),
        "browser_select" => json!({
            "ref": args.get("ref"),
            "valueLength": args
                .get("value")
                .and_then(Value::as_str)
                .map(|value| value.chars().count())
                .unwrap_or(0),
        }),
        "browser_scroll" => json!({ "delta": args.get("delta") }),
        "browser_upload" => json!({
            "ref": args.get("ref"),
            "path": args.get("path"),
        }),
        "browser_press" => json!({ "key": args.get("key") }),
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
    if !is_browser_tool(tool) && !crate::computer::desktop_enabled(&ctx.settings) {
        return ToolOutcome::error(
            "COMPUTER_DISABLED: o ambiente de computador está desligado ou em modo navegador",
        );
    }
    if tool != "browser_open" {
        if let Ok((paused, taken_over)) = ctx.db.computer_control(&ctx.conversation_id) {
            if paused || taken_over {
                return ToolOutcome::error(
                    "COMPUTER_PAUSED: o usuário assumiu o controle do computador",
                );
            }
        }
    }
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
    let backend = match crate::computer::backend(&ctx.settings) {
        crate::computer::ComputerBackend::Docker => "docker",
        crate::computer::ComputerBackend::Local => "local",
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
    let redacted_text_len = args
        .get("text")
        .and_then(Value::as_str)
        .map(|text| text.chars().count() as i64);
    let initiator = match ctx.turn_kind {
        crate::domain::TurnKind::GoalRound => "goal_round",
        _ => "human",
    };
    let pending = match ctx.db.begin_computer_action(
        &session.id,
        agent_id.as_deref(),
        &ctx.conversation_id,
        &ctx.turn_id,
        tool,
        tool,
        &audit_target(tool, args),
        redacted_text_len,
        initiator,
        now,
    ) {
        Ok(action) => action,
        Err(error) => {
            // Audit failure is a hard stop: never execute an action without a
            // durable pending row.
            return ToolOutcome::error(format!(
                "COMPUTER_AUDIT_FAILED: não foi possível registrar a ação antes de executar: {error:#}"
            ));
        }
    };
    let outcome = run_inner(ctx, tool, args).await;
    let decision = decision_of(&outcome);
    let _ = ctx.db.finish_computer_action(
        &pending.id,
        if outcome.is_error { "error" } else { "ok" },
        error_code_of(&outcome).as_deref(),
        outcome
            .is_error
            .then(|| outcome.content.chars().take(300).collect::<String>())
            .as_deref(),
        decision.as_deref(),
        Some(if decision.is_some() { "once" } else { "read" }),
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

        let browser = audit_target(
            "browser_type",
            &json!({ "ref": "e1", "text": "cartao-1234" }),
        );
        assert_eq!(browser["textLength"], json!(11));
        assert!(!browser.to_string().contains("cartao"));

        let clipboard = audit_target(
            "computer_clipboard",
            &json!({ "action": "write", "text": "segredo-123" }),
        );
        assert_eq!(clipboard["textLength"], json!(11));
        assert!(!clipboard.to_string().contains("segredo"));
    }

    #[test]
    fn browser_tools_are_separate_from_desktop_tools() {
        assert!(is_browser_tool("browser_navigate"));
        assert!(is_browser_tool("browser_snapshot"));
        assert!(!is_browser_tool("computer_click"));
        assert!(is_computer_tool("computer_drag"));
        assert!(is_computer_tool("computer_clipboard"));
    }

    #[test]
    fn unattended_browser_policy_only_skips_browser_actions() {
        assert!(can_skip_browser_approval(
            false,
            true,
            "browser_navigate"
        ));
        assert!(!can_skip_browser_approval(
            true,
            true,
            "browser_navigate"
        ));
        assert!(!can_skip_browser_approval(
            false,
            false,
            "browser_navigate"
        ));
        assert!(!can_skip_browser_approval(false, true, "computer_click"));
    }
}
