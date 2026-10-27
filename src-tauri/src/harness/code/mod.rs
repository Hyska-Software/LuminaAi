//! Perfil **Code** do harness de código.
//!
//! O loop é o mesmo de `harness::run_turn`; este módulo concentra o que muda no
//! perfil de código: prompt (aqui), contexto do projeto (`context.rs`), sessão
//! (`session.rs`) e as tools específicas (em `tools::code::*`).
//!
//! Preenchimento incremental (docs/goals/code-harness/PLAN.md §7–§8).

pub mod prompt;
