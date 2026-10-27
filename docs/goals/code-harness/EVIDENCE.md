# EVIDENCE — harness de código do Lumina

> **Fase 1 (planejamento, 2026-10-27):** pesquisa + plano completo.
> **Fase 2 (implementação, branch `feat/code-harness`):** implementação real com testes; evidência
> por etapa abaixo. Este arquivo é atualizado a cada rodada.

---

# PARTE I — Planejamento (concluído)

> **Natureza:** planejamento + pesquisa; nenhuma linha de código foi alterada naquela fase.

## 1. Entregáveis

| Arquivo | Conteúdo |
| --- | --- |
| `GOAL.md` | pedido, ponto de partida, decisões de produto, escopo, critérios de pronto |
| `PLAN.md` | decisões D1–D14, arquitetura, contratos, fases F0–F8, ownership, deps, riscos |
| `HARNESS.md` | loop/perfis, checkpoints, pipeline de tools, permissões, workspace/FS, execução, git, contexto, persistência, eventos, segurança |
| `TOOLS.md` | catálogo de tools, convenções, orçamentos, erros estáveis, testes |
| `WORKBENCH.md` | anatomia do layout, fluxos, estados, a11y, microcopy, testes de UI |

Pesquisa (5 documentos em `docs/research/`, ~190 KB): `dsh-harness-map.md` (DSH empacotado),
`paseo-workbench.md` (Paseo), `agent-harness-patterns.md` (benchmark de 8 harnesses + protocolos),
`workspace-runtime-options.md` (viabilidade Rust/Windows), `lumina-harness-integration-map.md`
(mapa do código, `arquivo:linha`).

---

# PARTE II — Implementação (branch `feat/code-harness`)

## 2. Backend Rust — o que está implementado

| Área | Arquivos | Testes |
| --- | --- | --- |
| Contratos | `domain.rs` (`TurnProfile`, `PermissionMode`, `Workspace`, `ApprovalRequest/Rule`, `TodoItem`, `PlanView`, `ContextStats`, `FileChange/ChangesSummary`, `JobView`, `CodeSessionState`, `WorkspaceFileEntry/Content`, `WorkspaceGitStatus/Commit`, `ToolCallRecord.presentation`), `events.rs` (12 eventos novos), `state.rs` (`approvals`, `observed`, `jobs`, dirs), `lib.rs` (registro dos comandos) | contrato/serde |
| Migrações/CRUD | `db.rs`: `workspaces`, `code_events`, `file_journal`, `session_summaries`, `approval_rules` + 3 colunas em `conversations`; ~20 funções CRUD; `config.rs` com clamps e parse tolerante | db 44, config 34 |
| Runtime | `workspace/{safe_path,exec,project,git,journal}.rs` — confinamento de path, runner de processos (timeout/cancel/kill-tree/env saneado/streaming), perfil de projeto, git CLI (porcelain v2), object store + diff | 39 |
| Política | `policy/mod.rs` (matriz de decisão, regras, glob, modo Plano), `policy/approval.rs` (registry, `request_interactive`, cancelamento por sessão) | 15 |
| Tools | `tools/registry.rs` (ToolSpec/ToolCtx/catálogo Chat 9 + Code 17), `tools/pipeline.rs` (scheduler Safe/PathLocked/Exclusive, anti-repetição), `tools/code/*` (execução real: fs, shell, jobs, git read, todo, plano, spill, observação/CAS, journal, aprovação) | tools 227 (inclui 54 de `tools::code`) |
| Harness Code | `harness/code/{prompt,context,session,observed,compaction,tools}.rs`; `harness/batch.rs`; `harness/mod.rs` (dispatch por perfil, prompt com contexto, registry no wire, aprovação, journal, `ToolProgress`, medidor, compactação automática, `WorkspaceChanges`, `turn/ended`, cancelamento de aprovações) | integração 2 (perfil Code real com `read_file`; recusa de sessão Chat) + compaction 5 + batch 2 |
| Comandos | `commands/workspace.rs` (12), `commands/code.rs` (16: sessão, permissões, aprovações, regras, diff, revert, compactação, jobs), `commands/git.rs` (10 + sugestão de commit por IA com fallback local) | testes de mapeamento |
| Jobs | `jobs/mod.rs` (ring buffer 256 KB, cursor, limite 8/conversa, promoção de foreground, kill) | 6 |

## 3. Renderer — o que está implementado

| Área | Arquivos | Testes |
| --- | --- | --- |
| Contratos | `types.ts` (+~40 tipos e 12 eventos), `api.ts` (~37 wrappers), `store/uiStore.ts` (workspace ativo + abas persistidas), `store/chatStore.ts` (perfil do turno, eventos de código, progresso de tool, refresh pós-turno), `store/codeStore.ts` (projeções, aprovações, plano, tarefas, contexto, jobs, revert/compact) | store 6 |
| Workspaces | `components/code/{useWorkspaces,WorkspaceTrustDialog,CodeSidebar,CodeSessionHeader,CodeWelcomeScreen}` | 154 (code) |
| Painel direito | `components/code/{FileTree,FilePreview,DiffView,ChangesPanel,CommitBar,useWorkspacePanel}` + `CodePanel` integrado | 59 (code) + 12 (panel) |
| Cards | `components/agent/*` (ApprovalCard, PlanCard, TodoCard, AskUserCard, ContextMeter, JobsBar, TurnFooter) + `CodeAgentWidgets` (container na timeline/header/composer) | 47 |
| Composer | `components/composer/{commands,mentions,MentionMenu,SlashMenu,MentionChips,Composer}` — `@arquivos`, `/comandos`, chips, foco | 25 |
| Integração | `ChatView` (cards de sessão + jobs), `CodeSessionHeader` (medidor), `WorkspaceCenter`/`App` mantidos | — |

## 4. Verificação executada

| Comando | Resultado |
| --- | --- |
| `cd src-tauri && cargo check --all-targets` | **verde** |
| `cd src-tauri && cargo test --lib` | **678 passed, 0 failed, 10 ignored** |
| `pnpm typecheck` | **verde** |
| `pnpm build` | **verde** (Vite/Rolldown) |
| `pnpm test` (suíte completa) | 1708/1710; as **2 falhas são os flakes pré-existentes de `ModelPickerDialog.edge`** (passam isolados: 14/14 — confirmado nesta rodada; não foram tocados) |
| `pnpm test -- src/components/code` | 13/13 arquivos verdes |
| `cargo test --lib code_profile` | 2/2 (turno Code de ponta a ponta + recusa de sessão Chat) |

## 5. Docs atualizados nesta rodada

- `AGENTS.md`: novas áreas/donos (`policy`, `jobs`, `workspace` + `commands/{workspace,code,git}`,
  `components/agent`) e `tauri.conf.json` como arquivo do Lead.
- `docs/ARCHITECTURE.md`: §3 (harness real), §4 (perfis de turno/eventos), §5 (tabelas, arquivos,
  workspace), §8.3 (harness de código), §12 (comandos novos), §13 (segurança honesta, CSP dívida),
  §16 (decisões 18–23).
- `docs/FILES.md`: §14 v1.9 + §16 (contrato de workspace/tools/permissões/journal/contexto).
- `docs/DESIGN.md`: §5 (sidebar/centro/painel do Code reais) e microcopy v1.9.
- Estado do branch: commits incrementais em `feat/code-harness`.

## 6. Pendências conhecidas (próximas rodadas)

1. **`ask_user` estruturado** — stub honesto no backend; falta `QuestionRegistry` + eventos
   `question_requested/resolved` + comando + integração do `AskUserCard` (o card já existe e testado).
2. **Cards de apresentação por tool na timeline** (`presentation` de diff/todo/plano/job já é
   persistido e chega em `tool_call_finished`; falta renderizar dentro dos cards de `AgentSteps`).
3. **Terminal PTY** (F7/v1.1) — `portable-pty` + xterm.js no painel.
4. **Subagentes, MCP, hooks, checks do projeto** (F8/v1.2) — roadmap do PLAN.
5. **CSP restritiva** no `tauri.conf.json` — dívida pré-existente, requer validação manual no app
   empacotado; documentada em ARCHITECTURE §13.
6. **`ToolProgress.id`** usa `message_id` no `run_command` (o `ToolCtx` ainda não tem
   `tool_call_id` por chamada); evolução prevista.
7. **`/test`, `/review`, `/init`** do composer preenchem prompts (o backend de checks/revisão chega
   com F8); hoje degradam honestamente.
8. **`pnpm test` completo**: os 2 flakes de `components/models` precisam ser estabilizados (fora do
   escopo do harness; registrados para não confundir a verificação final).
