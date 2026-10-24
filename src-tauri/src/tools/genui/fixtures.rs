//! Teste de paridade Rust ↔ TypeScript (`data/genui-fixtures.json`).
//!
//! O fixture é o corpus compartilhado: cada caso é executado pelo núcleo TS
//! (`src/lib/genui`) e por este pipeline. `errors`/`warnings` são os códigos
//! esperados (comparados como multiconjunto ordenado, repetições contam) e
//! `normalized` é a árvore canônica esperada (deep-equal).
//!
//! O arquivo é lido em runtime (não vai para o binário). Enquanto ele não
//! existir, o teste é pulado; quando existir, qualquer divergência aponta o caso
//! exato.

use std::path::PathBuf;

use serde::Deserialize;
use serde_json::Value;

use super::analyze;

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("data")
        .join("genui-fixtures.json")
}

#[derive(Debug, Deserialize)]
struct FixtureFile {
    #[serde(default)]
    version: Option<u32>,
    #[serde(default)]
    description: Option<String>,
    cases: Vec<FixtureCase>,
}

#[derive(Debug, Deserialize)]
struct FixtureCase {
    name: String,
    source: String,
    /// Códigos de erro esperados; ausente = nenhum.
    #[serde(default)]
    errors: Option<Vec<String>>,
    /// Códigos de aviso esperados; ausente = nenhum.
    #[serde(default)]
    warnings: Option<Vec<String>>,
    /// Árvore canônica esperada (`{ "components": [...] }`).
    #[serde(default)]
    normalized: Option<Value>,
}

#[test]
fn rust_and_typescript_core_agree_on_the_shared_fixtures() {
    let path = fixture_path();
    if !path.exists() {
        eprintln!(
            "data/genui-fixtures.json ausente em {} — teste de paridade pulado",
            path.display()
        );
        return;
    }
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("não foi possível ler {}: {error}", path.display()));
    let fixtures: FixtureFile = serde_json::from_str(&raw)
        .unwrap_or_else(|error| panic!("{} não é um fixture válido: {error}", path.display()));
    assert_eq!(fixtures.version, Some(2), "fixture deve declarar version 2");
    assert!(
        !fixtures.description.clone().unwrap_or_default().trim().is_empty(),
        "o fixture deve documentar o formato no cabeçalho"
    );
    assert!(!fixtures.cases.is_empty(), "o fixture de paridade está vazio");

    let mut failures: Vec<String> = Vec::new();
    for case in &fixtures.cases {
        let analysis = analyze(&case.source);

        let mut got_errors: Vec<String> = analysis
            .errors()
            .map(|diagnostic| diagnostic.code.clone())
            .collect();
        got_errors.sort();
        let mut expected_errors = case.errors.clone().unwrap_or_default();
        expected_errors.sort();

        let mut got_warnings: Vec<String> = analysis
            .warnings()
            .map(|diagnostic| diagnostic.code.clone())
            .collect();
        got_warnings.sort();
        let mut expected_warnings = case.warnings.clone().unwrap_or_default();
        expected_warnings.sort();

        let diagnostics: Vec<String> = analysis
            .diagnostics
            .iter()
            .map(|diagnostic| format!("{}@{}: {}", diagnostic.code, diagnostic.path, diagnostic.message))
            .collect();

        if got_errors != expected_errors {
            failures.push(format!(
                "caso `{}`: erros divergem\n  esperado: {:?}\n  obtido:   {:?}\n  diagnósticos: {:#?}",
                case.name, expected_errors, got_errors, diagnostics
            ));
        }
        if got_warnings != expected_warnings {
            failures.push(format!(
                "caso `{}`: avisos divergem\n  esperado: {:?}\n  obtido:   {:?}\n  diagnósticos: {:#?}",
                case.name, expected_warnings, got_warnings, diagnostics
            ));
        }

        if expected_errors.is_empty() {
            match &case.normalized {
                Some(expected) => {
                    if analysis.normalized.as_ref() != Some(expected) {
                        failures.push(format!(
                            "caso `{}`: árvore normalizada divergente\n  esperado: {}\n  obtido:   {}",
                            case.name,
                            serde_json::to_string(expected).unwrap_or_default(),
                            serde_json::to_string(&analysis.normalized).unwrap_or_default()
                        ));
                    }
                }
                None => {
                    if analysis.normalized.is_none() {
                        failures.push(format!(
                            "caso `{}`: sem erros, mas o pipeline não devolveu spec normalizado",
                            case.name
                        ));
                    }
                }
            }
        } else if analysis.normalized.is_some() {
            failures.push(format!(
                "caso `{}`: havia erros ({expected_errors:?}) mas o pipeline devolveu spec",
                case.name
            ));
        }
    }

    assert!(
        failures.is_empty(),
        "paridade Rust↔TS falhou em {} de {} casos:\n\n{}",
        failures.len(),
        fixtures.cases.len(),
        failures.join("\n\n")
    );
}
