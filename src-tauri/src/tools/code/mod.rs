//! Tools do perfil Code (harness de código nativo).
//!
//! Cada submodule declara os metadados (`ToolSpec`), o schema JSON e o corpo de
//! execução das ferramentas que o modelo vê no layout Code. Nesta fase (F0) os
//! corpos são **stubs documentados** que devolvem um erro acionável — a lógica
//! real entra nas tarefas seguintes, sem mudar nomes/schemas/contrato.
//!
//! Contrato: `docs/goals/code-harness/TOOLS.md` §2 e §3.
//! O registry central (perfis, definições e orientações) fica em
//! [`crate::tools::registry`]; aqui só mora a implementação por tool.

pub mod fs_read;
pub mod fs_write;
pub mod git_read;
pub mod plan;
pub mod shell;

use crate::providers::ToolDefinition;
use crate::tools::registry::ToolSpec;
use crate::tools::ToolOutcome;

/// Monta a definição wire (`name`/`description`/`parameters`) a partir do spec.
///
/// O `guidance` não vai no wire: ele é consumido pelo prompt do perfil
/// (`registry::guidance_sections`) para não pagar tokens em dobro.
pub(crate) fn definition_of(spec: &ToolSpec) -> ToolDefinition {
    ToolDefinition {
        name: spec.name.to_string(),
        description: spec.description.to_string(),
        parameters: (spec.schema)(),
    }
}

/// Resultado padrão de uma tool ainda não cabeada.
///
/// Nunca entra em panic: o modelo recebe um erro acionável com o nome da tool e
/// o turno continua (erro de tool não encerra o turno). O Lead troca este stub
/// pelo executor real sem alterar o call site.
pub(crate) fn not_wired(name: &str) -> ToolOutcome {
    ToolOutcome {
        content: format!("Error: tool \"{name}\" not wired yet"),
        summary: Some(format!("{name} · não implementada")),
        is_error: true,
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_wired_returns_actionable_error_without_panicking() {
        let outcome = not_wired("read_file");
        assert!(outcome.is_error);
        assert!(outcome.content.starts_with("Error: tool \"read_file\" not wired yet"));
        assert_eq!(outcome.presentation, None);
    }
}
