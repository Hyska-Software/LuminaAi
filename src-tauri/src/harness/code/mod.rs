//! Perfil **Code** do harness de código.
//!
//! O loop é o mesmo de `harness::run_turn`; este módulo concentra o que muda no
//! perfil de código:
//! - `prompt`: system prompt próprio (ambiente, política, tools, projeto);
//! - `context`: contexto do turno (workspace, git, projeto, AGENTS.md, árvore);
//! - `session`: projeções sobre `code_events` (plano, tarefas, contexto);
//! - `observed`: política de leitura antes da escrita (CAS por hash);
//! - `tools`: execução das tools de código (aprovação, journal, spill, shell).
//!
//! Preenchimento incremental (docs/goals/code-harness/PLAN.md §7–§8).

pub mod context;
pub mod observed;
pub mod prompt;
pub mod session;
pub mod tools;
