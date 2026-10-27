# GOAL — Harness de código do Lumina (layout Code)

> Status: **planejamento** (2026-10-27). Este documento é o pedido consolidado e os
> critérios de pronto; a implementação está descrita em `PLAN.md` (arquitetura/fases),
> `HARNESS.md` (design do loop/política/contexto), `TOOLS.md` (catálogo de ferramentas) e
> `WORKBENCH.md` (UI/UX). Pesquisa que fundamenta as decisões: `docs/research/`.

## Pedido do usuário (2026-10-27)

> "Quero fazer o desenvolvimento do harness do Lumina. Analise como o harness de outros apps
> como DeepSeek Harness e Paseo funcionam para usar de base, analise todo o código e todas as
> documentações necessárias e depois faça todo o planejamento para a implementação do harness
> para o layout Code do nosso app. Quero todo o planejamento de todas as funcionalidades,
> tools, arquitetura etc. Seja criativo."

Traduzido para o produto: o modo **Code** do Lumina deixa de ser um workbench vazio e passa a
executar de verdade um **agente de código local-first**, capaz de ler e editar um workspace em
disco, rodar comandos e testes, revisar e commitar alterações — com as mesmas promessas do modo
Chat (streaming, raciocínio visível, cancelamento, persistência, segurança) e com a experiência
de um workbench de agentes moderna (Paseo) por cima.

## O que existe hoje (ponto de partida)

- **Chat** completo: loop de agente em Rust (`harness/mod.rs`), 4 protocolos de provedor, streaming
  por `Channel`, tools (`web_search`, `fetch_url`, `create_file`, `run_code`, skills, biblioteca de
  artefatos, `validate_ui`), UI generativa, anexos, artefatos, biblioteca, paleta de comandos.
- **Layout Code fase 1** (concluído): seletor `Chat | Code`, sidebar de sessões, abas, header de
  sessão, composer reaproveitado e painel **Arquivos / Alterações** — porém com **estados vazios
  honestos**: não há workspace, árvore de arquivos, diff, commit nem agente de código.
- **Sessões separadas por layout** (`conversations.mode`) + vínculo compartilhado (`code_linked`).
- Documentação de referência já auditada: `docs/ARCHITECTURE.md` (§3, §8), `docs/FILES.md` (§7–8),
  `docs/DESIGN.md` (§5, §14), `docs/GENUI.md`, `docs/MODELS.md`, `docs/goals/chat-code-*/`.

## Resultado esperado (v1.0)

Um usuário abre uma pasta/repositório no modo Code, descreve uma tarefa e o agente:

1. **explora** o workspace com leitura e busca seguras (sem escrever nada);
2. **planeja** quando o pedido é grande (modo Plano com plano revisável);
3. **edita** arquivos com diffs claros, respeitando o escopo do workspace e a política de
   permissões escolhida;
4. **executa** comandos, testes e builds, com aprovação para o que é destrutivo e jobs em
   background para o que demora;
5. **revisa** o que mudou (painel Alterações, ± linhas, por arquivo), **reverte** turnos/arquivos
   e **commita** com o usuário no controle;
6. termina com o workspace consistente, o histórico persistido e a auditoria de cada ação.

Tudo isso no mesmo app, sem servidor, sem CLI externa obrigatória, com o Chat intacto.

## Decisões de produto (recomendadas; detalhes e alternativas em `PLAN.md` §3)

| # | Tema | Decisão |
| --- | --- | --- |
| P1 | Onde o agente roda | **Nativo no Rust do Lumina**, reaproveitando provedores/streaming/DB/tools existentes. Nada de subprocessar Codex/Claude Code por padrão. |
| P2 | Workspace | Workspace = pasta em disco (com git opcional). Sessão do Code pertence a um workspace; abrir pasta é o primeiro gesto do modo Code. |
| P3 | Escopo de escrita | Confinado ao workspace por padrão. Fora dele, só leitura? Não: escrita fora exige aprovação explícita por chamada. |
| P4 | Permissões | Três modos de sessão: **Leitura**, **Editar** (padrão), **Autônomo**; mais o overlay **Plano** (somente leitura) e aprovações interativas para comandos sensíveis. |
| P5 | Shell | `pwsh` no Windows (e `bash` quando disponível), com timeout, teto de saída, morte de árvore de processos e jobs em background. Terminal PTY persistente como painel (fase 4). |
| P6 | Git | Git do usuário via CLI (sem libgit2 embutida), com painel de status/diff/stage/commit; operações destrutivas exigem aprovação. Sem commit automático. |
| P7 | Revisão | Todo turno tem **checkpoint** (journal de arquivos) → "Reverter turno" e "Reverter arquivo" são sempre possíveis. |
| P8 | Extensibilidade | Sessões têm `agentKind` (`lumina` hoje; `acp:<agente>` no futuro) — o workbench é agnóstico ao motor. MCP/hooks/agentes externos entram como fases posteriores. |
| P9 | Escopo dos modelos | O harness de código usa o mesmo catálogo e os mesmos provedores; a UI sugere modelos com boa capacidade de ferramentas, mas não bloqueia. |

## Fora do escopo da v1.0 (roadmap em `PLAN.md` §11)

- Edição colaborativa/multiusuário, servidor remoto, sandbox de SO real no Windows.
- LSP completo, depuração interativa, agendamentos (cron), PR automático.
- Suporte a macOS/Linux além do que o código compartilhado já garante (Windows é a plataforma alvo;
  nada deve impedir portar depois).

## Critérios de pronto (v1.0)

1. **Workspace real**: abrir/trocar/fechar pasta no modo Code; sessão vinculada; header com branch,
   caminho e modo de permissão; estado vazio honesto quando não há workspace.
2. **Loop de código**: perfil de turno próprio (prompt, tools, limites, eventos), streaming
   incremental, cancelamento, persistência e retomada após reabrir o app.
3. **Tools v1**: leitura (arquivo/pasta/glob/busca), edição (write/edit com observação), shell
   (comando + jobs), git leitura, todo, plano, pergunta ao usuário, web/skills reaproveitadas —
   cada uma com política, limites, saída para o modelo e testes.
4. **Segurança**: nenhuma escrita fora do workspace sem aprovação; comandos destrutivos exigem
   aprovação; segredos não vazam para o modelo/saída; toda ação mutante auditada.
5. **Revisão**: painel Alterações com diff por arquivo e ± linhas; reverter arquivo/turno; commit
   com mensagem (sugerida pela IA, confirmada pelo usuário) e histórico.
6. **Contexto**: medidor de contexto, compactação automática e poda de resultados de tool; sessão
   longa continua funcionando.
7. **UX**: plan mode com revisão, lista de tarefas, cards de aprovação, jobs em background,
   `@arquivos` e `/comandos` no composer, notificações de fim de turno.
8. **Sem regressão**: Chat idêntico; `pnpm typecheck`, `pnpm test`, `pnpm build`, `cargo check` e
   `cargo test --lib` verdes; documentação atualizada (`ARCHITECTURE`, `FILES`, `DESIGN`, `AGENTS`).

## Definition of done por fase

Cada fase de `PLAN.md` só termina com: contrato publicado → implementação → testes da matriz →
`cargo check`/`pnpm typecheck`/`pnpm test` verdes → `EVIDENCE.md` da fase com comandos e resultados →
revisão do Lead contra o plano. Nada de "quase pronto" sem teste; nada de mock de funcionalidade real.
