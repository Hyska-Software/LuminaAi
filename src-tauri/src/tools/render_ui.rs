//! Validation helper for the declarative generative UI format.
//!
//! The model writes fenced blocks with the `ui` language containing JSON like
//! `{ "components": [ ... ] }`. The renderer only accepts a whitelist of
//! primitives, so the harness/backend validates the tree before it reaches the
//! webview (defense in depth: the renderer validates again). No JS is ever
//! evaluated.

use serde_json::{Map, Value};

/// Primitive components the renderer knows how to draw.
pub const ALLOWED_TYPES: &[&str] = &[
    "card", "stack", "grid", "tabs", "table", "chart", "stat", "progress", "timeline", "steps",
    "callout", "quote", "code", "list", "image", "badge", "divider", "link", "keyvalue",
];

/// Containers that may nest other components.
const CONTAINER_TYPES: &[&str] = &["card", "stack", "grid", "tabs", "callout"];

const CHART_TYPES: &[&str] = &["bar", "line", "pie"];
const MAX_DEPTH: usize = 8;
const MAX_NODES: usize = 300;
const MAX_STRING_CHARS: usize = 100_000;
const MAX_DOCUMENT_CHARS: usize = 200_000;

/// Parse + validate a raw `ui` block. Returns the JSON when it is safe.
pub fn validate_ui_json(raw: &str) -> Result<Value, String> {
    if raw.chars().count() > MAX_DOCUMENT_CHARS {
        return Err(format!(
            "bloco `ui` grande demais (máximo {MAX_DOCUMENT_CHARS} caracteres)"
        ));
    }
    let value: Value =
        serde_json::from_str(raw).map_err(|error| format!("bloco `ui` com JSON inválido: {error}"))?;
    validate_tree(&value)?;
    Ok(value)
}

/// Validate a parsed component tree (`{ "components": [...] }`).
pub fn validate_tree(root: &Value) -> Result<(), String> {
    let object = root
        .as_object()
        .ok_or_else(|| "o bloco `ui` deve ser um objeto JSON".to_string())?;
    let components = object
        .get("components")
        .and_then(Value::as_array)
        .ok_or_else(|| "o campo `components` (array) é obrigatório".to_string())?;
    if components.is_empty() {
        return Err("`components` está vazio".to_string());
    }
    let mut count = 0usize;
    for component in components {
        validate_node(component, 1, &mut count)?;
    }
    Ok(())
}

fn validate_node(node: &Value, depth: usize, count: &mut usize) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Err(format!(
            "profundidade máxima de {MAX_DEPTH} níveis excedida na UI generativa"
        ));
    }
    *count += 1;
    if *count > MAX_NODES {
        return Err(format!(
            "número máximo de {MAX_NODES} componentes excedido na UI generativa"
        ));
    }

    let object = node
        .as_object()
        .ok_or_else(|| format!("componente no nível {depth} não é um objeto JSON"))?;
    let kind = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| "todo componente precisa de `type` (string)".to_string())?;
    if !ALLOWED_TYPES.contains(&kind) {
        return Err(format!(
            "componente não permitido: `{kind}`. Use apenas: {}",
            ALLOWED_TYPES.join(", ")
        ));
    }

    let props = match object.get("props") {
        Some(Value::Object(props)) => Some(props),
        Some(Value::Null) | None => None,
        Some(_) => return Err(format!("`props` de `{kind}` deve ser um objeto")),
    };
    if let Some(props) = props {
        validate_props(kind, props)?;
        for (_, value) in props {
            validate_string_sizes(value, kind)?;
        }
    }

    let children = match object.get("children") {
        Some(Value::Array(children)) => Some(children),
        Some(Value::Null) | None => None,
        Some(_) => return Err(format!("`children` de `{kind}` deve ser um array")),
    };
    if children.is_some() && !CONTAINER_TYPES.contains(&kind) {
        return Err(format!(
            "`{kind}` não aceita `children`; use um container (card/stack/grid/tabs/callout)"
        ));
    }
    if let Some(children) = children {
        for child in children {
            validate_node(child, depth + 1, count)?;
        }
    }

    if kind == "tabs" {
        validate_tabs_children(object, props)?;
    }
    Ok(())
}

fn validate_props(kind: &str, props: &Map<String, Value>) -> Result<(), String> {
    let require = |key: &str| {
        props
            .get(key)
            .ok_or_else(|| format!("`{kind}` requer a prop `{key}`"))
    };

    match kind {
        "stat" => {
            require("label")?;
            require("value")?;
        }
        "progress" => {
            let value = require("value")?;
            if value.as_f64().is_none() && value.as_str().is_none() {
                return Err("`progress.value` deve ser um número (0-100)".to_string());
            }
        }
        "timeline" | "steps" => {
            let items = require("items")?;
            if !items.is_array() {
                return Err(format!("`{kind}.items` deve ser um array"));
            }
        }
        "quote" => {
            require("text")?;
        }
        "code" => {
            require("code")?;
        }
        "list" => {
            let items = require("items")?;
            if !items.is_array() && !items.is_string() {
                return Err("`list.items` deve ser um array de strings ou um texto".to_string());
            }
        }
        "image" => {
            validate_url(require("src")?, true)?;
        }
        "badge" => {
            require("label")?;
        }
        "link" => {
            validate_url(require("href")?, false)?;
            require("label")?;
        }
        "table" => {
            let columns = require("columns")?;
            let rows = require("rows")?;
            if !columns.is_array() {
                return Err("`table.columns` deve ser um array de strings".to_string());
            }
            if !rows.is_array() {
                return Err("`table.rows` deve ser um array de linhas".to_string());
            }
        }
        "chart" => {
            let chart_type = require("type")?;
            let chart_type = chart_type
                .as_str()
                .ok_or_else(|| "`chart.type` deve ser string".to_string())?;
            if !CHART_TYPES.contains(&chart_type) {
                return Err(format!(
                    "`chart.type` inválido: `{chart_type}`; use {}",
                    CHART_TYPES.join(", ")
                ));
            }
            if let Some(data) = props.get("data") {
                if !data.is_array() {
                    return Err("`chart.data` deve ser um array de `{label, value}`".to_string());
                }
            } else if !(props.get("labels").map(Value::is_array).unwrap_or(false)
                && props.get("values").map(Value::is_array).unwrap_or(false))
            {
                return Err(
                    "`chart` requer `data` ([{label, value}]) ou `labels` + `values`".to_string(),
                );
            }
        }
        "keyvalue" => {
            if let Some(items) = props.get("items") {
                if !items.is_array() && !items.is_object() {
                    return Err("`keyvalue.items` deve ser um array ou um objeto".to_string());
                }
            } else if !(props.get("labels").map(Value::is_array).unwrap_or(false)
                && props.get("values").map(Value::is_array).unwrap_or(false))
            {
                return Err("`keyvalue` requer `items` ou `labels` + `values`".to_string());
            }
        }
        "tabs" => {
            if let Some(tabs) = props.get("tabs") {
                if !tabs.is_array() {
                    return Err("`tabs.tabs` deve ser um array de `{id, label}`".to_string());
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_tabs_children(object: &Map<String, Value>, _props: Option<&Map<String, Value>>) -> Result<(), String> {
    // The renderer derives each tab label from the panel's `props.label` (or
    // `props.title`), so a tabs node only needs panel children with a label.
    let Some(children) = object.get("children").and_then(Value::as_array) else {
        return Err("`tabs` precisa de pelo menos um painel em `children`".to_string());
    };
    if children.is_empty() {
        return Err("`tabs` precisa de pelo menos um painel em `children`".to_string());
    }
    for (index, child) in children.iter().enumerate() {
        let label = child
            .get("props")
            .and_then(|props| props.get("label").or_else(|| props.get("title")))
            .and_then(Value::as_str)
            .unwrap_or("");
        if label.trim().is_empty() {
            return Err(format!(
                "o {}-º painel de `tabs` precisa de `props.label` com o nome da aba",
                index + 1
            ));
        }
    }
    Ok(())
}

fn validate_url(value: &Value, allow_data_image: bool) -> Result<(), String> {
    let text = value
        .as_str()
        .ok_or_else(|| "a URL deve ser uma string".to_string())?;
    let lower = text.trim().to_ascii_lowercase();
    if allow_data_image && lower.starts_with("data:image/") {
        let allowed = ["data:image/png", "data:image/jpeg", "data:image/webp", "data:image/gif"];
        if allowed.iter().any(|prefix| lower.starts_with(prefix)) {
            return Ok(());
        }
        return Err("apenas data:image/png|jpeg|webp|gif é permitido em `image.src`".to_string());
    }
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return Ok(());
    }
    Err("URLs de UI generativa devem começar com http:// ou https://".to_string())
}

fn validate_string_sizes(value: &Value, kind: &str) -> Result<(), String> {
    match value {
        Value::String(text) => {
            if text.chars().count() > MAX_STRING_CHARS {
                return Err(format!(
                    "um valor de texto em `{kind}` é grande demais (máximo {MAX_STRING_CHARS} caracteres)"
                ));
            }
        }
        Value::Array(items) => {
            for item in items {
                validate_string_sizes(item, kind)?;
            }
        }
        Value::Object(map) => {
            for (_, item) in map {
                validate_string_sizes(item, kind)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Fenced `ui` blocks found in markdown, validated. Used by the harness to log
/// invalid blocks while a turn is still in progress.
pub fn markdown_ui_blocks(text: &str) -> Vec<Result<Value, String>> {
    let mut blocks = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("```ui") {
        let after = &rest[start + 5..];
        let after = after.strip_prefix('\n').unwrap_or(after);
        let after = after.strip_prefix('\r').unwrap_or(after);
        match after.find("\n```") {
            Some(end) => {
                blocks.push(validate_ui_json(&after[..end]));
                rest = &after[end + 4..];
            }
            None => {
                blocks.push(Err("bloco ```ui não foi fechado".to_string()));
                break;
            }
        }
    }
    blocks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_block() -> &'static str {
        r#"{
          "components": [
            { "type": "card", "props": { "title": "Resumo" }, "children": [
              { "type": "stat", "props": { "label": "Receita", "value": "R$ 12.400" } },
              { "type": "badge", "props": { "label": "novo" } },
              { "type": "table", "props": { "columns": ["A", "B"], "rows": [["1", "2"]] } }
            ]}
          ]
        }"#
    }

    #[test]
    fn accepts_whitelisted_tree() {
        assert!(validate_ui_json(valid_block()).is_ok());
    }

    #[test]
    fn rejects_unknown_component() {
        let raw = r#"{"components":[{"type":"iframe","props":{}}]}"#;
        assert!(validate_ui_json(raw).unwrap_err().contains("não permitido"));
    }

    #[test]
    fn rejects_deep_nesting() {
        let mut node = r#"{"type":"stat","props":{"label":"a","value":"b"}}"#.to_string();
        for _ in 0..9 {
            node = format!(r#"{{"type":"card","children":[{node}]}}"#);
        }
        let raw = format!(r#"{{"components":[{node}]}}"#);
        assert!(validate_ui_json(&raw).unwrap_err().contains("profundidade"));
    }

    #[test]
    fn rejects_javascript_links() {
        let raw = r#"{"components":[{"type":"link","props":{"href":"javascript:alert(1)","label":"x"}}]}"#;
        assert!(validate_ui_json(raw).is_err());
    }

    #[test]
    fn rejects_missing_required_props() {
        let raw = r#"{"components":[{"type":"stat","props":{"label":"sem valor"}}]}"#;
        assert!(validate_ui_json(raw).unwrap_err().contains("value"));
    }

    #[test]
    fn rejects_bad_chart_type() {
        let raw = r#"{"components":[{"type":"chart","props":{"type":"pie3d","data":[]}}]}"#;
        assert!(validate_ui_json(raw).unwrap_err().contains("inválido"));
    }

    #[test]
    fn validates_tabs_children() {
        let good = r#"{"components":[{"type":"tabs","children":[{"type":"stack","props":{"label":"A"},"children":[]}]}]}"#;
        assert!(validate_ui_json(good).is_ok());
        let bad = r#"{"components":[{"type":"tabs","children":[{"type":"stack","props":{},"children":[]}]}]}"#;
        assert!(validate_ui_json(bad).is_err());
    }

    #[test]
    fn accepts_chart_data_and_keyvalue() {
        let raw = r#"{"components":[
            {"type":"chart","props":{"type":"bar","data":[{"label":"Jan","value":3.2}]}},
            {"type":"keyvalue","props":{"items":[{"label":"Uptime","value":"99,9%"}]}}
        ]}"#;
        assert!(validate_ui_json(raw).is_ok());
    }

    #[test]
    fn scans_markdown_blocks() {
        let text = format!("Veja:\n```ui\n{}\n```\nfim", valid_block());
        let blocks = markdown_ui_blocks(&text);
        assert_eq!(blocks.len(), 1);
        assert!(blocks[0].is_ok());

        let broken = "texto\n```ui\n{\"components\":[}\n```";
        let blocks = markdown_ui_blocks(broken);
        assert_eq!(blocks.len(), 1);
        assert!(blocks[0].is_err());
    }
}
