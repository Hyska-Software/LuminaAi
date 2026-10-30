# Goal: sistema de Objetivos (Goal) no layout Code

Implementar o **sistema de Goal** do Lumina conforme
[`PLAN.md`](PLAN.md) (contrato completo, fases, donos, testes e evidências).

Pedido original (resumo):

1. Analisar a implementação atual do projeto e planejar um **sistema de Goal
   para o layout de Code**.
2. Inspirar-se em sistemas open source equivalentes: **DeepSeek Harness (DSH)**
   (`dsh-goal`/`dsh-goal-round-driver`/`dsh-tool-goal`), **Codex** (sessão
   retomável/plano/compactação) e **Paseo** (estado explícito de turno e
   heartbeat que reenvia prompt ao mesmo agente) — ver
   `docs/research/dsh-harness-map.md`, `docs/research/agent-harness-patterns.md`
   e `docs/research/paseo-workbench.md`.
3. Definir **arquitetura, contratos, fases, testes e interface gráfica**
   completos antes de implementar.

Regras:

- O objetivo é **estado persistente da sessão de código** e as rodadas são
  turnos normais do harness (`turnKind = goal_round`), nunca um segundo loop de
  agente.
- Rodadas automáticas são **opt-in explícito** (`autoContinue`), com orçamento
  (default 25, hard cap 100), pausa por erro/estol/limite e sem retomada
  automática após reiniciar o app.
- Política de permissões, aprovação interativa, modo Plano, confinamento de
  workspace, journal e revisão por diff continuam valendo sem exceção.
- O estado do objetivo vai para o **contexto volátil** do turno (surface item),
  nunca para o system prompt congelado (preservar prefix cache).
- A funcionalidade é **aditiva**: chat, sessões do Code, plano, tarefas,
  aprovações, jobs, terminal e artefatos continuam funcionando igual.
- Sem automação de navegador/screenshot como evidência; a verificação é
  `cargo check`, `cargo test --lib`, `pnpm typecheck`, `pnpm test` e
  `pnpm build`.
- Respeitar `AGENTS.md`: propriedade de arquivos por área, tokens do design
  system, texto de interface em pt-BR, acessibilidade e TDD.
