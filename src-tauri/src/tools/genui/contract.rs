//! Contrato v2 da UI generativa, embutido no binário.
//!
//! `data/genui-contract.json` é a fonte única compartilhada entre o prompt
//! (Rust), o validador/ferramenta (Rust) e o renderer (TypeScript). Nada aqui
//! pode duplicar listas, limites ou regras: tudo é lido do contrato em tempo de
//! compilação (`include_str!`) para que o prompt e o validador nunca divirjam.
//!
//! `data/genui-example.json` é o exemplo canônico usado pelo system prompt e
//! pelos testes (precisa ser válido e lint-clean); `genui-example-minimal.json`
//! é a variante mínima usada em testes de documentação.

use std::collections::BTreeMap;

use once_cell::sync::Lazy;
use serde::Deserialize;
use serde_json::Value;

/// Contrato completo (fonte única).
pub const CONTRACT_JSON: &str = include_str!("../../../../data/genui-contract.json");
/// Exemplo canônico documentado no system prompt.
pub const EXAMPLE_JSON: &str = include_str!("../../../../data/genui-example.json");
/// Exemplo mínimo (usado nos testes de documentação).
#[cfg(test)]
pub const MINIMAL_EXAMPLE_JSON: &str =
    include_str!("../../../../data/genui-example-minimal.json");

static CONTRACT: Lazy<Contract> = Lazy::new(|| {
    let contract: Contract = serde_json::from_str(CONTRACT_JSON)
        .expect("data/genui-contract.json embutido é JSON inválido");
    validate_embedded_contract(&contract);
    contract
});

/// Valida a metainformação do contrato embutido uma única vez, na inicialização
/// do `Lazy`. O contrato é dado de engenharia versionado no repositório: se
/// estiver inconsistente, o correto é falhar rápido (como o `expect` acima) em
/// vez de gerar prompt/validador divergentes em tempo de execução.
fn validate_embedded_contract(contract: &Contract) {
    assert_eq!(
        contract.version, contract.format.version,
        "data/genui-contract.json: `version` e `format.version` divergem"
    );
    assert!(
        !contract.name.trim().is_empty(),
        "data/genui-contract.json: `name` vazio"
    );
    assert!(
        !contract.description.trim().is_empty(),
        "data/genui-contract.json: `description` vazia"
    );
    for rule in &contract.rules {
        assert!(
            matches!(rule.scope.as_str(), "block" | "message"),
            "data/genui-contract.json: regra `{}` com scope inesperado `{}`",
            rule.id,
            rule.scope
        );
        assert!(
            !rule.category.trim().is_empty(),
            "data/genui-contract.json: regra `{}` sem categoria",
            rule.id
        );
    }
    for component in &contract.components {
        for (name, prop) in &component.props {
            if prop.prop_type != "array" {
                continue;
            }
            let items = prop.items.as_ref().unwrap_or_else(|| {
                panic!(
                    "data/genui-contract.json: array `{}` do componente `{}` sem `items`",
                    name, component.typ
                )
            });
            assert_eq!(
                items.spec_type.as_deref(),
                Some("array"),
                "data/genui-contract.json: array `{name}` do componente `{}` deve declarar \
                 `items.type == \"array\"`",
                component.typ
            );
        }
    }
}

/// Contrato decodificado (estático, inicializado uma única vez).
pub fn contract() -> &'static Contract {
    &CONTRACT
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contract {
    pub version: u32,
    pub name: String,
    /// Metainformação de engenharia do contrato. NÃO vai para o system prompt.
    pub description: String,
    /// Texto introdutório voltado ao modelo (substitui `description` no prompt).
    #[serde(rename = "promptIntro")]
    pub prompt_intro: String,
    pub format: FormatSpec,
    pub blocks: BlocksSpec,
    pub limits: Limits,
    pub icons: Vec<String>,
    pub interactions: Interactions,
    pub components: Vec<ComponentSpec>,
    pub rules: Vec<RuleSpec>,
}

impl Contract {
    /// Especificação de um componente pelo nome do `type` (sem trim: o contrato
    /// usa nomes exatos).
    pub fn component(&self, type_name: &str) -> Option<&ComponentSpec> {
        self.components.iter().find(|component| component.typ == type_name)
    }

    /// Regra de design pelo id (`ui.*`).
    pub fn rule(&self, id: &str) -> Option<&RuleSpec> {
        self.rules.iter().find(|rule| rule.id == id)
    }

    /// Categorias na ordem de primeira aparição no contrato.
    pub fn categories(&self) -> Vec<&str> {
        let mut categories = Vec::new();
        for component in &self.components {
            if !categories.contains(&component.category.as_str()) {
                categories.push(component.category.as_str());
            }
        }
        categories
    }

    /// Componentes de uma categoria, na ordem do contrato.
    pub fn components_by_category(&self, category: &str) -> Vec<&ComponentSpec> {
        self.components
            .iter()
            .filter(|component| component.category == category)
            .collect()
    }

    /// Valor padrão declarado para uma prop (o renderer aplica defaults; o
    /// normalizador não materializa — exceto enum inválido com default).
    pub fn prop_default(&self, type_name: &str, prop_name: &str) -> Option<&Value> {
        self.component(type_name)?
            .props
            .get(prop_name)?
            .default
            .as_ref()
    }

    /// Cap do rótulo de aba declarado pelo contrato (`tabs.props.label.maxChars`).
    /// O `label` é metadado de cada painel, não uma prop do componente-filho; o
    /// normalizador lê o limite daqui em vez de fixar um número no código.
    pub fn tab_label_max_chars(&self) -> Option<usize> {
        self.component("tabs")?
            .props
            .get("label")?
            .max_chars
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatSpec {
    pub root: String,
    pub version: u32,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlocksSpec {
    pub max_per_message: usize,
    pub recommended_per_message: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    pub source_chars: usize,
    pub depth: usize,
    pub nodes: usize,
    pub props: usize,
    pub array_items: usize,
    pub string_chars: usize,
    pub diagnostics_per_code: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Interactions {
    pub description: String,
    pub action_kinds: Vec<ActionKind>,
    pub rules: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionKind {
    pub kind: String,
    pub label: String,
    pub description: String,
    pub max_chars: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentSpec {
    #[serde(rename = "type")]
    pub typ: String,
    /// `container` aceita `children`; `leaf` não aceita.
    pub kind: String,
    pub category: String,
    pub summary: String,
    /// Documentação curta das props (mesmo texto usado no prompt).
    pub doc: String,
    pub accepts_children: bool,
    #[serde(default)]
    pub props: BTreeMap<String, PropSpec>,
}

impl ComponentSpec {
    pub fn is_container(&self) -> bool {
        self.accepts_children
    }
}

/// Especificação de uma prop de componente (`text`, `enum`, `array`, ...).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropSpec {
    #[serde(rename = "type")]
    pub prop_type: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub max_chars: Option<usize>,
    #[serde(default)]
    pub min: Option<f64>,
    #[serde(default)]
    pub max: Option<f64>,
    #[serde(default)]
    pub default: Option<Value>,
    #[serde(default)]
    pub values: Vec<String>,
    /// Para props `array`: limites da lista e especificação do elemento.
    #[serde(default)]
    pub items: Option<ArraySpec>,
}

/// Especificação de um array: limites e o descritor de cada elemento.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArraySpec {
    #[serde(rename = "type", default)]
    pub spec_type: Option<String>,
    #[serde(default)]
    pub min_items: Option<usize>,
    #[serde(default)]
    pub max_items: Option<usize>,
    #[serde(default)]
    pub item: Option<ItemSpec>,
}

/// Descritor de um elemento de array. Pode ser `text`, `number`, `scalar`,
/// `object` (com `props`) ou um array aninhado (com `minItems`/`maxItems`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSpec {
    #[serde(rename = "type", default)]
    pub prop_type: String,
    #[serde(default)]
    pub max_chars: Option<usize>,
    #[serde(default)]
    pub min: Option<f64>,
    #[serde(default)]
    pub max: Option<f64>,
    #[serde(default)]
    pub min_items: Option<usize>,
    #[serde(default)]
    pub max_items: Option<usize>,
    #[serde(default)]
    pub props: Option<BTreeMap<String, PropSpec>>,
    #[serde(default)]
    pub item: Option<Box<ItemSpec>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleSpec {
    pub id: String,
    pub severity: String,
    pub scope: String,
    pub category: String,
    #[serde(default)]
    pub params: BTreeMap<String, Value>,
    pub message: String,
    pub hint: String,
    /// Regra resumida em uma linha, usada no system prompt.
    pub prompt: String,
}

impl RuleSpec {
    pub fn param_u64(&self, key: &str) -> Option<u64> {
        self.params.get(key).and_then(Value::as_u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embeds_a_valid_v2_contract() {
        let contract = contract();
        assert_eq!(contract.version, 2);
        assert_eq!(contract.format.version, 2);
        assert!(!contract.description.trim().is_empty());
        assert!(
            !contract.prompt_intro.trim().is_empty(),
            "o contrato precisa de um promptIntro voltado ao modelo"
        );
        assert_ne!(
            contract.prompt_intro.trim(),
            contract.description.trim(),
            "promptIntro e description têm papéis diferentes"
        );
        assert!(!contract.components.is_empty());
        assert_eq!(contract.rules.len(), 27, "o contrato declara 27 regras de design");
        assert!(contract.limits.depth > 0);
        assert!(contract.limits.nodes > contract.limits.depth);
        assert!(contract.limits.diagnostics_per_code > 0);
        assert!(!contract.icons.is_empty());
    }

    #[test]
    fn every_component_is_fully_documented() {
        let contract = contract();
        let mut types = std::collections::HashSet::new();
        for component in &contract.components {
            assert!(
                types.insert(component.typ.clone()),
                "tipo duplicado no contrato: {}",
                component.typ
            );
            assert!(!component.summary.trim().is_empty(), "{} sem summary", component.typ);
            assert!(!component.doc.trim().is_empty(), "{} sem doc", component.typ);
            assert!(
                matches!(component.kind.as_str(), "container" | "leaf"),
                "{} tem kind inesperado: {}",
                component.typ,
                component.kind
            );
            assert_eq!(
                component.is_container(),
                component.kind == "container",
                "{}: kind e acceptsChildren divergem",
                component.typ
            );
            for (name, prop) in &component.props {
                assert!(!name.trim().is_empty());
                assert!(
                    matches!(
                        prop.prop_type.as_str(),
                        "text" | "enum" | "number" | "boolean" | "array" | "url" | "imageSrc"
                            | "icon"
                    ),
                    "{}: prop `{}` tem tipo desconhecido `{}`",
                    component.typ,
                    name,
                    prop.prop_type
                );
                if prop.prop_type == "enum" {
                    assert!(!prop.values.is_empty(), "{}: enum `{}` sem values", component.typ, name);
                }
                if prop.prop_type == "array" {
                    let items = prop
                        .items
                        .as_ref()
                        .unwrap_or_else(|| panic!("{}: array `{}` sem itens", component.typ, name));
                    assert!(items.spec_type.as_deref() == Some("array"));
                    let item = items
                        .item
                        .as_ref()
                        .unwrap_or_else(|| panic!("{}: array `{}` sem item", component.typ, name));
                    assert!(
                        matches!(
                            item.prop_type.as_str(),
                            "text" | "number" | "scalar" | "object" | "array"
                        ),
                        "{}: array `{}` com item `{}` inesperado",
                        component.typ,
                        name,
                        item.prop_type
                    );
                }
            }
        }
    }

    #[test]
    fn every_rule_is_a_warning_with_prompt_text() {
        let contract = contract();
        let mut ids = std::collections::HashSet::new();
        for rule in &contract.rules {
            assert!(ids.insert(rule.id.clone()), "regra duplicada: {}", rule.id);
            assert_eq!(rule.severity, "warning", "{}: severidade inesperada", rule.id);
            assert!(!rule.message.trim().is_empty(), "{}: message vazia", rule.id);
            assert!(!rule.hint.trim().is_empty(), "{}: hint vazio", rule.id);
            assert!(!rule.prompt.trim().is_empty(), "{}: prompt vazio", rule.id);
            assert!(
                matches!(rule.scope.as_str(), "block" | "message"),
                "{}: scope inesperado",
                rule.id
            );
        }
    }

    #[test]
    fn embeds_valid_examples() {
        for raw in [EXAMPLE_JSON, MINIMAL_EXAMPLE_JSON] {
            let value: Value = serde_json::from_str(raw).expect("exemplo embutido é JSON válido");
            assert!(value.get("components").and_then(Value::as_array).is_some());
        }
    }

    #[test]
    fn exposes_helpers_and_optional_values() {
        let contract = contract();
        assert_eq!(
            contract.prop_default("grid", "columns").and_then(Value::as_u64),
            Some(2)
        );
        assert!(contract.component("card").is_some());
        assert!(contract.component("nao-existe").is_none());
        assert!(contract.rule("ui.root-count").is_some());
        assert!(contract.rule("ui.block-count").is_none(), "block-count não é regra de lint");
        assert!(contract.categories().contains(&"data"));
        // O cap do metadado de aba vem do contrato, não de um hardcode.
        assert_eq!(contract.tab_label_max_chars(), Some(80));
        // `chart.title` é recomendado no contrato (regra de design), não required.
        let chart = contract.component("chart").expect("chart");
        assert!(!chart.props["title"].required);
        assert!(chart.props["type"].required);
        assert!(chart.props["data"].required);
    }
}
