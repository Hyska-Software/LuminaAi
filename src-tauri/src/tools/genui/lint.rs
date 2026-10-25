//! Lint de design da UI generativa (espelho de `src/lib/genui/lint.ts`).
//!
//! Diferente do validador estrutural (que impede a renderização), estas regras
//! são de **qualidade visual/UX**: todas viram avisos com `message`/`hint` do
//! contrato e são capadas por código (`limits.diagnosticsPerCode`). O linter só
//! roda quando a árvore normalizada não tem erros.

use std::collections::{BTreeMap, HashSet};

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{Map, Value};

use super::contract::Contract;
use super::{Diagnostic, Severity};

/// Props de texto "de interface" verificadas por regras de copy.
const TEXT_KEYS: [&str; 8] = [
    "title", "subtitle", "footer", "label", "caption", "cite", "hint", "text",
];

static EMOJI_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE0F}]")
        .expect("regex de emoji válida")
});

static MARKDOWN_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    [
        r"\*\*[^*\n]{1,80}\*\*",
        r"__[^_\n]{1,80}__",
        r"`[^`\n]{1,80}`",
        r"\[[^\]\n]{1,80}\]\([^)\n]{1,200}\)",
        r"(?:^|\n)\s{0,3}#{1,6}\s",
    ]
    .iter()
    .map(|pattern| Regex::new(pattern).expect("regex de Markdown válida"))
    .collect()
});

/// Roda todas as regras de design do contrato sobre uma árvore normalizada.
/// Devolve os diagnósticos já capados por código.
pub(crate) fn lint(contract: &Contract, spec: &Value) -> Vec<Diagnostic> {
    let mut state = LintState {
        contract,
        per_code: contract.limits.diagnostics_per_code,
        counts: BTreeMap::new(),
        diagnostics: Vec::new(),
    };
    let components = spec
        .get("components")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);

    if components.len() > rule_param(contract, "ui.root-count", "max", 4) as usize {
        push_rule(&mut state, "ui.root-count", "components");
    }

    let mut stats = Stats::default();
    visit_components(&mut state, components, 1, "components", None, &mut stats);

    let density_nodes = rule_param(contract, "ui.density", "nodes", 60) as usize;
    let density_depth = rule_param(contract, "ui.density", "depth", 5) as usize;
    if stats.nodes > density_nodes || stats.max_depth > density_depth {
        push_rule(&mut state, "ui.density", "components");
    }

    state.diagnostics
}

#[derive(Default)]
struct Stats {
    nodes: usize,
    max_depth: usize,
    cards: usize,
    dividers: usize,
}

struct LintState<'a> {
    contract: &'a Contract,
    per_code: usize,
    counts: BTreeMap<String, usize>,
    diagnostics: Vec<Diagnostic>,
}

fn push_rule(state: &mut LintState<'_>, id: &str, path: impl Into<String>) {
    let Some(rule) = state.contract.rule(id) else {
        return;
    };
    let count = state.counts.entry(id.to_string()).or_insert(0);
    if *count >= state.per_code {
        return;
    }
    *count += 1;
    state.diagnostics.push(Diagnostic {
        code: rule.id.clone(),
        severity: if rule.severity == "error" {
            Severity::Error
        } else {
            Severity::Warning
        },
        path: path.into(),
        message: rule.message.clone(),
        hint: Some(rule.hint.clone()),
    });
}

fn rule_param(contract: &Contract, id: &str, key: &str, fallback: u64) -> u64 {
    contract
        .rule(id)
        .and_then(|rule| rule.param_u64(key))
        .unwrap_or(fallback)
}

/// Limites de comprimento do `stat` declarados nos params da regra
/// `ui.stat-long` (label, value, hint). Fonte única: o contrato.
fn stat_limits(contract: &Contract) -> (usize, usize, usize) {
    (
        rule_param(contract, "ui.stat-long", "label", 32) as usize,
        rule_param(contract, "ui.stat-long", "value", 20) as usize,
        rule_param(contract, "ui.stat-long", "hint", 100) as usize,
    )
}

/* ------------------------------------------------------------------ */
/* Acessores de props (equivalentes a src/lib/genui/props.ts)          */
/* ------------------------------------------------------------------ */

fn prop_string(props: Option<&Map<String, Value>>, key: &str, fallback: &str) -> String {
    match props.and_then(|props| props.get(key)) {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Number(number)) => number_to_text(number),
        _ => fallback.to_string(),
    }
}

fn prop_number(props: Option<&Map<String, Value>>, key: &str, fallback: f64) -> f64 {
    match props.and_then(|props| props.get(key)) {
        Some(Value::Number(number)) => number.as_f64().unwrap_or(fallback),
        Some(Value::String(text)) if !text.trim().is_empty() => {
            text.trim().parse::<f64>().unwrap_or(fallback)
        }
        _ => fallback,
    }
}

fn prop_array<'a>(props: Option<&'a Map<String, Value>>, key: &str) -> &'a [Value] {
    props
        .and_then(|props| props.get(key))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn as_string_array(value: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|entry| match entry {
            Value::String(text) => Some(text.clone()),
            Value::Number(number) => Some(number_to_text(number)),
            _ => None,
        })
        .collect()
}

fn prop_object_array<'a>(
    props: Option<&'a Map<String, Value>>,
    key: &str,
) -> Vec<&'a Map<String, Value>> {
    prop_array(props, key)
        .iter()
        .filter_map(Value::as_object)
        .collect()
}

fn number_to_text(number: &serde_json::Number) -> String {
    if let Some(value) = number.as_i64() {
        return value.to_string();
    }
    if let Some(value) = number.as_u64() {
        return value.to_string();
    }
    let value = number.as_f64().unwrap_or(0.0);
    if value.fract() == 0.0 && value.abs() <= 9_007_199_254_740_992.0 {
        (value as i64).to_string()
    } else {
        value.to_string()
    }
}

/* ------------------------------------------------------------------ */
/* Traversal                                                           */
/* ------------------------------------------------------------------ */

fn visit_components(
    state: &mut LintState<'_>,
    components: &[Value],
    depth: usize,
    prefix: &str,
    parent_type: Option<&str>,
    stats: &mut Stats,
) {
    for (index, node) in components.iter().enumerate() {
        visit_node(
            state,
            node,
            depth,
            &format!("{prefix}[{index}]"),
            parent_type,
            stats,
        );
    }
}

fn visit_node(
    state: &mut LintState<'_>,
    node: &Value,
    depth: usize,
    path: &str,
    parent_type: Option<&str>,
    stats: &mut Stats,
) {
    stats.nodes += 1;
    stats.max_depth = stats.max_depth.max(depth);

    let props = node.get("props").and_then(Value::as_object);
    let children = node
        .get("children")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let node_type = node.get("type").and_then(Value::as_str).unwrap_or_default();

    match node_type {
        "card" => {
            if depth == 1 && prop_string(props, "title", "").trim().is_empty() {
                push_rule(state, "ui.card-title", format!("{path}.props.title"));
            }
            if parent_type == Some("card") {
                push_rule(state, "ui.card-nested", path);
            }
            stats.cards += 1;
            if stats.cards > rule_param(state.contract, "ui.cards-count", "max", 4) as usize {
                push_rule(state, "ui.cards-count", path);
            }
        }
        "grid" => {
            let columns = prop_number(props, "columns", 2.0).round().clamp(1.0, 4.0) as usize;
            if !children.is_empty() && children.len() % columns != 0 {
                push_rule(state, "ui.grid-orphans", path);
            }
            let factor = rule_param(state.contract, "ui.grid-crowded", "factor", 3) as usize;
            if children.len() > columns.saturating_mul(factor) {
                push_rule(state, "ui.grid-crowded", path);
            }
        }
        "divider" => {
            stats.dividers += 1;
            if stats.dividers > rule_param(state.contract, "ui.divider-count", "max", 2) as usize {
                push_rule(state, "ui.divider-count", path);
            }
        }
        "chart" => {
            let chart_type = prop_string(props, "type", "bar");
            let data = prop_array(props, "data");
            if prop_string(props, "title", "").trim().is_empty() {
                push_rule(state, "ui.chart-title", format!("{path}.props.title"));
            }
            let min_points = rule_param(state.contract, "ui.chart-points-min", "min", 2) as usize;
            if data.len() < min_points {
                push_rule(state, "ui.chart-points-min", path);
            }
            let max_slices = rule_param(state.contract, "ui.chart-pie-slices", "max", 7) as usize;
            if chart_type == "pie" && data.len() > max_slices {
                push_rule(state, "ui.chart-pie-slices", path);
            }
        }
        "table" => {
            let columns = as_string_array(props.and_then(|props| props.get("columns")));
            let max_columns = rule_param(state.contract, "ui.table-columns", "max", 8) as usize;
            if columns.len() > max_columns {
                push_rule(state, "ui.table-columns", path);
            }
            let rows = prop_array(props, "rows");
            for (row_index, row) in rows.iter().enumerate() {
                if let Value::Array(cells) = row {
                    if cells.len() != columns.len() {
                        push_rule(
                            state,
                            "ui.table-arity",
                            format!("{path}.props.rows[{row_index}]"),
                        );
                    }
                }
            }
        }
        "stat" => {
            let (max_label, max_value, max_hint) = stat_limits(state.contract);
            if prop_string(props, "label", "").chars().count() > max_label
                || prop_string(props, "value", "").chars().count() > max_value
                || prop_string(props, "hint", "").chars().count() > max_hint
            {
                push_rule(state, "ui.stat-long", path);
            }
        }
        "list" => {
            if prop_array(props, "items").len()
                > rule_param(state.contract, "ui.list-long", "max", 20) as usize
            {
                push_rule(state, "ui.list-long", path);
            }
        }
        "timeline" => {
            if prop_array(props, "items").len()
                > rule_param(state.contract, "ui.timeline-long", "max", 12) as usize
            {
                push_rule(state, "ui.timeline-long", path);
            }
        }
        "steps" => {
            if prop_array(props, "items").len()
                > rule_param(state.contract, "ui.steps-long", "max", 10) as usize
            {
                push_rule(state, "ui.steps-long", path);
            }
        }
        "keyvalue" => {
            if prop_array(props, "items").len()
                > rule_param(state.contract, "ui.keyvalue-long", "max", 12) as usize
            {
                push_rule(state, "ui.keyvalue-long", path);
            }
        }
        "tabs" => {
            if children.len() > rule_param(state.contract, "ui.tabs-count", "max", 6) as usize {
                push_rule(state, "ui.tabs-count", path);
            }
        }
        "actions" => {
            lint_actions(state, props, path);
        }
        "callout" => {
            push_rule(state, "ui.callout-style", path);
        }
        "section" => {
            // Seção sem cabeçalho (nem `title`, nem `eyebrow` não-vazios) não
            // agrega hierarquia; use `stack` se não houver título.
            if prop_string(props, "title", "").trim().is_empty()
                && prop_string(props, "eyebrow", "").trim().is_empty()
            {
                push_rule(state, "ui.section-header", path);
            }
        }
        "choices" => {
            if prop_string(props, "submitLabel", "").trim().is_empty() {
                push_rule(state, "ui.choices-submit", path);
            }
        }
        _ => {}
    }

    if matches!(node_type, "card" | "stack" | "grid" | "reveal") && children.is_empty() {
        push_rule(state, "ui.empty-container", path);
    }

    lint_copy(state, node_type, props, path);

    if !children.is_empty() {
        visit_components(
            state,
            children,
            depth + 1,
            &format!("{path}.children"),
            Some(node_type),
            stats,
        );
    }
}

fn lint_actions(state: &mut LintState<'_>, props: Option<&Map<String, Value>>, path: &str) {
    let items = prop_object_array(props, "items");

    let labels: Vec<String> = items
        .iter()
        .map(|item| {
            let label = prop_string(Some(item), "label", "");
            if label.trim().is_empty() {
                prop_string(Some(item), "title", "").trim().to_string()
            } else {
                label.trim().to_string()
            }
        })
        .filter(|label| !label.is_empty())
        .collect();
    let mut seen: HashSet<String> = HashSet::new();
    for label in labels {
        let key = label.to_lowercase();
        if !seen.insert(key) {
            push_rule(state, "ui.duplicate-action", format!("{path}.props.items"));
            break;
        }
    }

    let primaries = items
        .iter()
        .filter(|item| prop_string(Some(item), "tone", "") == "primary")
        .count();
    if primaries > 1 {
        push_rule(state, "ui.action-primary", format!("{path}.props.items"));
    }

    let max_label = rule_param(state.contract, "ui.action-label-long", "max", 40) as usize;
    for (index, item) in items.iter().enumerate() {
        let label = prop_string(Some(item), "label", "");
        let label_path = format!("{path}.props.items[{index}].label");
        if label.chars().count() > max_label {
            push_rule(state, "ui.action-label-long", &label_path);
        }
        if ends_with_period(&label) {
            push_rule(state, "ui.label-period", &label_path);
        }
        if has_emoji(&label) {
            push_rule(state, "ui.emoji", &label_path);
        }
        if is_shouting(&label) {
            push_rule(state, "ui.shouting", &label_path);
        }
    }
}

fn lint_copy(
    state: &mut LintState<'_>,
    node_type: &str,
    props: Option<&Map<String, Value>>,
    path: &str,
) {
    let Some(props) = props else {
        return;
    };

    // Markdown não é renderizado dentro de props; `code` é o caso legítimo de
    // texto com sintaxe (inclusive crases) e fica de fora.
    if node_type != "code" {
        let mut strings = Vec::new();
        collect_strings(Some(&Value::Object(props.clone())), &mut strings, 0);
        if strings.iter().any(|text| has_markdown(text)) {
            push_rule(state, "ui.markdown-in-props", format!("{path}.props"));
        }
    }

    for key in TEXT_KEYS {
        let Some(Value::String(value)) = props.get(key) else {
            continue;
        };
        if value.trim().is_empty() {
            continue;
        }
        if key == "title" || key == "label" {
            if ends_with_period(value) {
                push_rule(state, "ui.label-period", format!("{path}.props.{key}"));
            }
            if has_emoji(value) {
                push_rule(state, "ui.emoji", format!("{path}.props.{key}"));
            }
            if is_shouting(value) {
                push_rule(state, "ui.shouting", format!("{path}.props.{key}"));
            }
        }
    }
}

fn collect_strings(value: Option<&Value>, into: &mut Vec<String>, depth: usize) {
    if depth > 4 {
        return;
    }
    let Some(value) = value else {
        return;
    };
    match value {
        Value::String(text) => into.push(text.clone()),
        Value::Array(items) => {
            for entry in items {
                collect_strings(Some(entry), into, depth + 1);
            }
        }
        Value::Object(map) => {
            for entry in map.values() {
                collect_strings(Some(entry), into, depth + 1);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

fn has_markdown(text: &str) -> bool {
    MARKDOWN_PATTERNS.iter().any(|pattern| pattern.is_match(text))
}

fn has_emoji(text: &str) -> bool {
    EMOJI_PATTERN.is_match(text)
}

fn ends_with_period(text: &str) -> bool {
    text.trim().ends_with('.')
}

fn is_shouting(text: &str) -> bool {
    let letters: Vec<char> = text.chars().filter(|character| character.is_alphabetic()).collect();
    if letters.len() < 8 {
        return false;
    }
    let upper = letters
        .iter()
        .filter(|character| character.is_uppercase())
        .count();
    (upper as f64) / (letters.len() as f64) > 0.7
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::genui::{analyze, contract, Severity};

    fn warning_ids(source: &str) -> Vec<String> {
        let analysis = analyze(source);
        assert!(analysis.is_ok(), "a UI de teste precisa ser válida");
        let mut ids: Vec<String> = analysis
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.severity == Severity::Warning)
            .map(|diagnostic| diagnostic.code.clone())
            .collect();
        ids.sort();
        ids
    }

    #[test]
    fn each_rule_fires_for_its_canonical_case() {
        let cases: [(&str, &str); 20] = [
            ("ui.root-count", r#"{"components":[{"type":"badge","props":{"label":"a"}},{"type":"badge","props":{"label":"b"}},{"type":"badge","props":{"label":"c"}},{"type":"badge","props":{"label":"d"}},{"type":"badge","props":{"label":"e"}}]}"#),
            ("ui.card-title", r#"{"components":[{"type":"card","children":[{"type":"badge","props":{"label":"x"}}]}]}"#),
            ("ui.card-nested", r#"{"components":[{"type":"card","props":{"title":"a"},"children":[{"type":"card","props":{"title":"b"},"children":[{"type":"badge","props":{"label":"x"}}]}]}]}"#),
            ("ui.cards-count", r#"{"components":[{"type":"card","props":{"title":"a"},"children":[{"type":"badge","props":{"label":"x"}}]},{"type":"card","props":{"title":"b"},"children":[{"type":"badge","props":{"label":"x"}}]},{"type":"card","props":{"title":"c"},"children":[{"type":"badge","props":{"label":"x"}}]},{"type":"card","props":{"title":"d"},"children":[{"type":"badge","props":{"label":"x"}}]},{"type":"card","props":{"title":"e"},"children":[{"type":"badge","props":{"label":"x"}}]}]}"#),
            ("ui.grid-orphans", r#"{"components":[{"type":"grid","props":{"columns":2},"children":[{"type":"badge","props":{"label":"1"}},{"type":"badge","props":{"label":"2"}},{"type":"badge","props":{"label":"3"}}]}]}"#),
            ("ui.grid-crowded", r#"{"components":[{"type":"grid","props":{"columns":1},"children":[{"type":"badge","props":{"label":"1"}},{"type":"badge","props":{"label":"2"}},{"type":"badge","props":{"label":"3"}},{"type":"badge","props":{"label":"4"}}]}]}"#),
            ("ui.divider-count", r#"{"components":[{"type":"divider"},{"type":"divider"},{"type":"divider"}]}"#),
            ("ui.empty-container", r#"{"components":[{"type":"stack","children":[]}]}"#),
            ("ui.chart-title", r#"{"components":[{"type":"chart","props":{"type":"bar","data":[{"label":"A","value":1},{"label":"B","value":2}]}}]}"#),
            ("ui.chart-points-min", r#"{"components":[{"type":"chart","props":{"type":"bar","title":"t","data":[{"label":"A","value":1}]}}]}"#),
            ("ui.chart-pie-slices", r#"{"components":[{"type":"chart","props":{"type":"pie","title":"t","data":[{"label":"a","value":1},{"label":"b","value":2},{"label":"c","value":3},{"label":"d","value":4},{"label":"e","value":5},{"label":"f","value":6},{"label":"g","value":7},{"label":"h","value":8}]}}]}"#),
            ("ui.table-columns", r#"{"components":[{"type":"table","props":{"columns":["1","2","3","4","5","6","7","8","9"],"rows":[["x"]]}}]}"#),
            ("ui.table-arity", r#"{"components":[{"type":"table","props":{"columns":["A","B"],"rows":[["1","2","3"]]}}]}"#),
            ("ui.stat-long", r#"{"components":[{"type":"stat","props":{"label":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","value":"1"}}]}"#),
            ("ui.list-long", r#"{"components":[{"type":"list","props":{"items":[{"text":"a"},{"text":"b"},{"text":"c"},{"text":"d"},{"text":"e"},{"text":"f"},{"text":"g"},{"text":"h"},{"text":"i"},{"text":"j"},{"text":"k"},{"text":"l"},{"text":"m"},{"text":"n"},{"text":"o"},{"text":"p"},{"text":"q"},{"text":"r"},{"text":"s"},{"text":"t"},{"text":"u"}]}}]}"#),
            ("ui.timeline-long", r#"{"components":[{"type":"timeline","props":{"items":[{"title":"1"},{"title":"2"},{"title":"3"},{"title":"4"},{"title":"5"},{"title":"6"},{"title":"7"},{"title":"8"},{"title":"9"},{"title":"10"},{"title":"11"},{"title":"12"},{"title":"13"}]}}]}"#),
            ("ui.steps-long", r#"{"components":[{"type":"steps","props":{"items":[{"title":"1"},{"title":"2"},{"title":"3"},{"title":"4"},{"title":"5"},{"title":"6"},{"title":"7"},{"title":"8"},{"title":"9"},{"title":"10"},{"title":"11"}]}}]}"#),
            ("ui.keyvalue-long", r#"{"components":[{"type":"keyvalue","props":{"items":[{"label":"1","value":"a"},{"label":"2","value":"a"},{"label":"3","value":"a"},{"label":"4","value":"a"},{"label":"5","value":"a"},{"label":"6","value":"a"},{"label":"7","value":"a"},{"label":"8","value":"a"},{"label":"9","value":"a"},{"label":"10","value":"a"},{"label":"11","value":"a"},{"label":"12","value":"a"},{"label":"13","value":"a"}]}}]}"#),
            ("ui.tabs-count", r#"{"components":[{"type":"tabs","children":[{"type":"stack","props":{"label":"1"},"children":[{"type":"badge","props":{"label":"x"}}]},{"type":"stack","props":{"label":"2"},"children":[{"type":"badge","props":{"label":"x"}}]},{"type":"stack","props":{"label":"3"},"children":[{"type":"badge","props":{"label":"x"}}]},{"type":"stack","props":{"label":"4"},"children":[{"type":"badge","props":{"label":"x"}}]},{"type":"stack","props":{"label":"5"},"children":[{"type":"badge","props":{"label":"x"}}]},{"type":"stack","props":{"label":"6"},"children":[{"type":"badge","props":{"label":"x"}}]},{"type":"stack","props":{"label":"7"},"children":[{"type":"badge","props":{"label":"x"}}]}]}]}"#),
            ("ui.density", r#"{"components":[{"type":"stack","children":[{"type":"badge","props":{"label":"1"}},{"type":"badge","props":{"label":"2"}},{"type":"badge","props":{"label":"3"}},{"type":"badge","props":{"label":"4"}},{"type":"badge","props":{"label":"5"}},{"type":"badge","props":{"label":"6"}},{"type":"badge","props":{"label":"7"}},{"type":"badge","props":{"label":"8"}},{"type":"badge","props":{"label":"9"}},{"type":"badge","props":{"label":"10"}},{"type":"badge","props":{"label":"11"}},{"type":"badge","props":{"label":"12"}},{"type":"badge","props":{"label":"13"}},{"type":"badge","props":{"label":"14"}},{"type":"badge","props":{"label":"15"}},{"type":"badge","props":{"label":"16"}},{"type":"badge","props":{"label":"17"}},{"type":"badge","props":{"label":"18"}},{"type":"badge","props":{"label":"19"}},{"type":"badge","props":{"label":"20"}},{"type":"badge","props":{"label":"21"}},{"type":"badge","props":{"label":"22"}},{"type":"badge","props":{"label":"23"}},{"type":"badge","props":{"label":"24"}},{"type":"badge","props":{"label":"25"}},{"type":"badge","props":{"label":"26"}},{"type":"badge","props":{"label":"27"}},{"type":"badge","props":{"label":"28"}},{"type":"badge","props":{"label":"29"}},{"type":"badge","props":{"label":"30"}},{"type":"badge","props":{"label":"31"}},{"type":"badge","props":{"label":"32"}},{"type":"badge","props":{"label":"33"}},{"type":"badge","props":{"label":"34"}},{"type":"badge","props":{"label":"35"}},{"type":"badge","props":{"label":"36"}},{"type":"badge","props":{"label":"37"}},{"type":"badge","props":{"label":"38"}},{"type":"badge","props":{"label":"39"}},{"type":"badge","props":{"label":"40"}},{"type":"badge","props":{"label":"41"}},{"type":"badge","props":{"label":"42"}},{"type":"badge","props":{"label":"43"}},{"type":"badge","props":{"label":"44"}},{"type":"badge","props":{"label":"45"}},{"type":"badge","props":{"label":"46"}},{"type":"badge","props":{"label":"47"}},{"type":"badge","props":{"label":"48"}},{"type":"badge","props":{"label":"49"}},{"type":"badge","props":{"label":"50"}},{"type":"badge","props":{"label":"51"}},{"type":"badge","props":{"label":"52"}},{"type":"badge","props":{"label":"53"}},{"type":"badge","props":{"label":"54"}},{"type":"badge","props":{"label":"55"}},{"type":"badge","props":{"label":"56"}},{"type":"badge","props":{"label":"57"}},{"type":"badge","props":{"label":"58"}},{"type":"badge","props":{"label":"59"}},{"type":"badge","props":{"label":"60"}},{"type":"badge","props":{"label":"61"}},{"type":"badge","props":{"label":"62"}},{"type":"badge","props":{"label":"63"}}]}]}"#),
        ];
        for (rule, source) in cases {
            let ids = warning_ids(source);
            assert!(
                ids.iter().any(|id| id == rule),
                "regra `{rule}` não disparou; avisos: {ids:?}"
            );
        }
    }

    #[test]
    fn copy_rules_fire_for_their_cases() {
        for (rule, source) in [
            (
                "ui.markdown-in-props",
                r#"{"components":[{"type":"stat","props":{"label":"Receita","value":"R$ 10","hint":"**forte**"}}]}"#,
            ),
            (
                "ui.emoji",
                r#"{"components":[{"type":"badge","props":{"label":"Novo 📊"}}]}"#,
            ),
            (
                "ui.label-period",
                r#"{"components":[{"type":"badge","props":{"label":"Novo."}}]}"#,
            ),
            (
                "ui.shouting",
                r#"{"components":[{"type":"badge","props":{"label":"ATENÇÃO GERAL"}}]}"#,
            ),
            (
                "ui.duplicate-action",
                r#"{"components":[{"type":"actions","props":{"items":[{"label":"Repetir","prompt":"a"},{"label":"Repetir","prompt":"b"}]}}]}"#,
            ),
            (
                "ui.action-primary",
                r#"{"components":[{"type":"actions","props":{"items":[{"label":"Abrir","prompt":"a","tone":"primary"},{"label":"Copiar","copy":"x","tone":"primary"}]}}]}"#,
            ),
            (
                "ui.action-label-long",
                r#"{"components":[{"type":"actions","props":{"items":[{"label":"Comparar todos os cenários de receita do trimestre","prompt":"a"}]}}]}"#,
            ),
        ] {
            let ids = warning_ids(source);
            assert!(ids.iter().any(|id| id == rule), "regra `{rule}` não disparou: {ids:?}");
        }
    }

    #[test]
    fn contract_example_is_lint_clean() {
        let analysis = analyze(super::super::contract::EXAMPLE_JSON);
        assert!(analysis.is_ok());
        assert_eq!(
            analysis
                .diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.severity == Severity::Warning)
                .count(),
            0,
            "o exemplo canônico não pode ter avisos de design"
        );
    }

    #[test]
    fn caps_warnings_per_code() {
        // Cinco cards no topo: a regra cards-count dispararia 1 vez; com 10
        // divisores, divider-count dispara 8 vezes e o cap segura em 3.
        let dividers: Vec<Value> = (0..10)
            .map(|_| serde_json::json!({"type":"divider"}))
            .collect();
        let source = serde_json::json!({ "components": dividers }).to_string();
        let analysis = analyze(&source);
        assert!(analysis.is_ok());
        let count = analysis
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.code == "ui.divider-count")
            .count();
        assert_eq!(count, contract().limits.diagnostics_per_code);
    }

    #[test]
    fn callout_style_fires_for_any_callout_anywhere() {
        // Qualquer `variant` (e mesmo sem props) gera o aviso de descontinuação.
        for source in [
            r#"{"components":[{"type":"callout","props":{"variant":"info","text":"ok"}}]}"#,
            r#"{"components":[{"type":"callout","props":{"variant":"warning","title":"Atenção"}}]}"#,
            r#"{"components":[{"type":"callout","props":{"variant":"success","text":"ok"}}]}"#,
            r#"{"components":[{"type":"callout","props":{"variant":"danger","text":"erro"}}]}"#,
            r#"{"components":[{"type":"callout","props":{}}]}"#,
        ] {
            let ids = warning_ids(source);
            assert!(
                ids.iter().any(|id| id == "ui.callout-style"),
                "todo callout deve gerar ui.callout-style; avisos: {ids:?}"
            );
        }

        // Vale em qualquer profundidade e o path é o do nó no documento.
        let nested = r#"{"components":[{"type":"card","props":{"title":"Resumo"},"children":[
            {"type":"stack","children":[{"type":"callout","props":{"text":"nota"}}]}
        ]}]}"#;
        let analysis = analyze(nested);
        assert!(
            analysis.is_ok(),
            "o aviso não bloqueia a renderização: {:?}",
            analysis
                .diagnostics
                .iter()
                .map(|diagnostic| diagnostic.code.clone())
                .collect::<Vec<_>>()
        );
        let diagnostic = analysis
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.code == "ui.callout-style")
            .expect("aviso de callout aninhado");
        assert_eq!(diagnostic.path, "components[0].children[0].children[0]");
        assert_eq!(diagnostic.severity, Severity::Warning);
        assert!(diagnostic.message.contains("não faz parte do padrão do chat"));
        assert!(diagnostic.hint.is_some());
    }

    #[test]
    fn callout_rule_prompt_is_documented_in_the_contract() {
        // O prompt é gerado do contrato: o `rule.prompt` novo entra sozinho.
        let rule = contract()
            .rule("ui.callout-style")
            .expect("regra ui.callout-style no contrato");
        assert_eq!(rule.severity, "warning");
        assert!(rule.prompt.contains("NUNCA use `callout`"));
    }

    #[test]
    fn section_header_rule_requires_title_or_eyebrow() {
        for source in [
            r#"{"components":[{"type":"section","props":{"title":"Notícias"},"children":[{"type":"badge","props":{"label":"x"}}]}]}"#,
            r#"{"components":[{"type":"section","props":{"eyebrow":"Mundo"},"children":[{"type":"badge","props":{"label":"x"}}]}]}"#,
        ] {
            assert!(
                !warning_ids(source).iter().any(|id| id == "ui.section-header"),
                "section com title/eyebrow não deve gerar ui.section-header"
            );
        }

        for source in [
            // Ausente.
            r#"{"components":[{"type":"section","children":[{"type":"badge","props":{"label":"x"}}]}]}"#,
            // Presente porém vazio (whitespace também não conta).
            r#"{"components":[{"type":"section","props":{"title":"  ","eyebrow":""},"children":[{"type":"badge","props":{"label":"x"}}]}]}"#,
        ] {
            let analysis = analyze(source);
            assert!(analysis.is_ok(), "o aviso não bloqueia a renderização");
            let diagnostic = analysis
                .diagnostics
                .iter()
                .find(|diagnostic| diagnostic.code == "ui.section-header")
                .expect("ui.section-header para section sem cabeçalho");
            assert_eq!(diagnostic.path, "components[0]");
            assert!(diagnostic.hint.is_some());
        }
    }

    #[test]
    fn choices_submit_rule_requires_submit_label() {
        let with_submit = r#"{"components":[{"type":"choices","props":{"options":[{"label":"A"},{"label":"B"}],"submitLabel":"Enviar"}}]}"#;
        assert!(!warning_ids(with_submit)
            .iter()
            .any(|id| id == "ui.choices-submit"));

        let without_submit = r#"{"components":[{"type":"choices","props":{"options":[{"label":"A"},{"label":"B"}]}}]}"#;
        let analysis = analyze(without_submit);
        assert!(analysis.is_ok(), "o aviso não bloqueia a renderização");
        let diagnostic = analysis
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.code == "ui.choices-submit")
            .expect("ui.choices-submit para choices sem submitLabel");
        assert_eq!(diagnostic.path, "components[0]");
        assert!(diagnostic.message.contains("sem ação de envio"));
        assert!(diagnostic.hint.is_some());

        // `submitLabel` vazio também conta como ausência.
        let empty_submit = r#"{"components":[{"type":"choices","props":{"options":[{"label":"A"},{"label":"B"}],"submitLabel":"   "}}]}"#;
        assert!(warning_ids(empty_submit)
            .iter()
            .any(|id| id == "ui.choices-submit"));
    }

    #[test]
    fn stat_long_thresholds_come_from_the_rule_params() {
        let contract = contract();
        let rule = contract.rule("ui.stat-long").expect("regra ui.stat-long");
        let (max_label, max_value, max_hint) = stat_limits(contract);
        assert_eq!(Some(max_label as u64), rule.param_u64("label"));
        assert_eq!(Some(max_value as u64), rule.param_u64("value"));
        assert_eq!(Some(max_hint as u64), rule.param_u64("hint"));

        // Exatamente no limite não dispara; um code point acima dispara.
        let at_limit = serde_json::json!({
            "components": [{
                "type": "stat",
                "props": {
                    "label": "a".repeat(max_label),
                    "value": "1",
                    "hint": "b".repeat(max_hint)
                }
            }]
        })
        .to_string();
        assert!(
            !warning_ids(&at_limit).iter().any(|id| id == "ui.stat-long"),
            "stat no limite não deve gerar ui.stat-long"
        );

        let over = serde_json::json!({
            "components": [{
                "type": "stat",
                "props": { "label": "a".repeat(max_label + 1), "value": "1" }
            }]
        })
        .to_string();
        assert!(
            warning_ids(&over).iter().any(|id| id == "ui.stat-long"),
            "stat acima do param `label` deve gerar ui.stat-long"
        );
    }
}
