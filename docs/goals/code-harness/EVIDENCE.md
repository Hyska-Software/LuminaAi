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

## 6. Rodada 3 — perguntas estruturadas, cards de apresentação e ids de tool

- **`ask_user` completo**: `domain` (`AskOption/AskQuestion/AskUserRequest/Answer/Response`),
  eventos `question_requested/resolved`, `harness/code/questions.rs` (`QuestionRegistry`,
  `request_user_answers`, normalização/validação, cancelamento por sessão), comando
  `respond_question`, `AppState.questions`, `ToolCtx.questions`, execução real da tool (bloqueia
  no turno, timeout → `skipped`), testes de registry/normalização/resposta e integração do
  `AskUserCard` no `CodeSessionCards` (single/multi + texto livre + "Ignorar").
- **Cards de apresentação na timeline**: `components/agent/ToolPresentationCard.tsx` +
  integração no `AgentSteps` (fora do bloco recolhível) para `file_change` (diff expansível),
  `todos`, `plan`, `job`, `answers` e `changes`; o JSON `presentation` já persistido no
  `ToolCallRecord` agora vira UI.
- **`ToolProgress` por chamada**: `ToolCtx.tool_call_id` preenchido pelo dispatcher
  (`harness/code/tools.rs`), usado por `run_command` (progresso), aprovações e apresentação — o
  card certo recebe a saída ao vivo.
- Testes: `cargo test --lib` e `pnpm test` (áreas afetadas) verdes; suíte completa registrada no
  fecho da rodada.

## 7. Pendências conhecidas (próximas rodadas)

1. **Terminal PTY** (F7/v1.1) — `portable-pty` + renderer de terminal no painel.
2. **Subagentes, MCP, hooks, checks do projeto** (F8/v1.2) — roadmap do PLAN.
3. **CSP restritiva** no `tauri.conf.json` — dívida pré-existente, requer validação manual no app
   empacotado; documentada em ARCHITECTURE §13.
4. **`/test`, `/review`, `/init`** do composer preenchem prompts (o backend de checks/revisão chega
   com F8); hoje degradam honestamente.
5. **`pnpm test` completo**: os 2 flakes de `components/models` precisam ser estabilizados (fora do
   escopo do harness; registrados para não confundir a verificação final).
6. **Aprovação de shell no modo Editar**: hoje todo comando pede aprovação; uma allowlist de
   comandos de leitura ("git status", testes) pode reduzir fadiga — decisão de produto da v1.1.

## 8. Rodada 4 — terminal PTY (F7) e endurecimento do runner

- **Terminal PTY completo**: `src-tauri/src/terminal/mod.rs` (registro por sessão, `portable-pty`/ConPTY,
  cwd no workspace, env sem segredos, leitura → `Channel<TerminalEvent>`, resize, kill) + comandos
  `open_terminal`/`write_terminal`/`resize_terminal`/`close_terminal`/`list_terminals` +
  `AppState.terminals`; renderer com `@xterm/xterm` 6 + `@xterm/addon-fit` no painel (aba
  **Terminal**, abas por sessão, fit/resize, estados vazio/erro/limite). Testes: registry backend
  (env scrub, ciclo de vida), `TerminalPanel` (abrir/fechar/erro) e tab nova no `CodePanel`.
- **Job Object no runner**: `workspace/exec.rs` agora associa o processo a um Job Object
  (`KILL_ON_JOB_CLOSE`) no Windows, com `taskkill /T` como segunda barreira no cancelamento/timeout.
  O teste de kill de árvore passou a rodar 10/10 sem flake (antes falhava de forma intermitente).
- **Dependências**: `@xterm/xterm` + `@xterm/addon-fit` (pnpm 11, store do projeto),
  `portable-pty 0.8` e `windows 0.62` (features de Job Object).
- Verificação: `cargo check --all-targets` verde, `pnpm typecheck` verde, `pnpm build` verde,
  `cargo test --lib`/`pnpm test` conferidos no fecho da rodada.
## 9. Rodada 5 — verificação do projeto e subagentes (F8, parte 1)

- **`run_checks`**: nova tool do perfil Code que roda a verificação detectada do projeto
  (`workspace::project`) reutilizando o pipeline do `run_command` (política/aprovação, streaming,
  spill, exit code), com `check` opcional e erros `NO_CHECKS`/`CHECK_NOT_FOUND`. Catálogo Code passou
  a 19 tools (23 com web/skills reaproveitadas); testes cobrem ausência de checks, modo Plano e execução real (pulado sem shell).
- **`task` (subagente)**: delegação para um agente filho **somente leitura** (conversa efêmera no
  mesmo workspace, permissão `read_only`, catálogo reduzido a leitura, 24 passos, eventos
  descartados, conversa apagada ao final, profundidade máxima 1 com guarda `DELEGATION_DEPTH`).
  `TurnOptions.delegation_depth` filtra o catálogo do filho e encurta o orçamento; o prompt do
  filho recebe instruções extras via `system_prompt_override` (agora suportado no perfil Code).
  Testes: kinds/instruções, catálogo reduzido, guarda de profundidade e um turno filho real com
  provider falso (verifica o texto final e a exclusão da conversa efêmera). Card de apresentação
  “Subagente …” na timeline.
- **Composer**: `/test`, `/review` e `/init` agora preenchem prompts que citam `run_checks`,
  `task` (revisão delegada) e revisão do AGENTS.md antes de gravar.
- Docs atualizados (`TOOLS.md` §2.6, `ARCHITECTURE` §8.3, `FILES` §16). Verificação no fecho da
  rodada (`cargo check --all-targets`, `cargo test --lib`, `pnpm typecheck`, `pnpm test`, `pnpm build`).

Pendências para as próximas rodadas (F8 restante): cliente **MCP** (stdio) com tools dinâmicas,
hooks de ciclo de vida e a UI de "Verificações" no painel; depois CSP restritiva e allowlist de
comandos de leitura no modo Editar.
## 10. Rodada 6 — cliente MCP (F8, parte 2)

- **Cliente MCP stdio real** em `src-tauri/src/mcp/mod.rs`: config `<app-data>/mcp.json`,
  JSON-RPC 2.0 por linha, `initialize` → `notifications/initialized` → `tools/list` (cache) e
  `tools/call`; leitor/escritor em tasks, stderr drenado, timeout de 60 s por request e 30 s no
  handshake, kill ao dropar. `McpManager` conecta sob demanda e degrada por servidor.
- **Integração no perfil Code**: tools `mcp__servidor__tool` entram no wire depois das 19 estáticas
  (com `inputSchema` do servidor) e no prompt; execução fora do registry estático (aprovação
  explícita sempre, regras exact/prefix/glob, timeout 120 s, cancelamento, extração de
  `content[].text`, `MCP_ERROR`). `mcp_status` expõe servidores/tools; `mcp: None` nos testes e
  composer/deps atualizados.
- **Testes**: sanitização e parse wire, config tolerante, manager vazio, handshake + list/call
  contra servidor MCP **fake em Node** (pulado sem Node), erros `MCP_*` e regras de aprovação.
  Docs: `TOOLS.md` §2.6 (MCP), `FILES` §16, `ARCHITECTURE` §8.3.

Pendências: UI de MCP ("Servidores") na aba de configurações, hooks de ciclo de vida, UI de
"Verificações" no painel, CSP restritiva e allowlist de comandos de leitura.
## 11. Rodada 7 — hooks de projeto e allowlist de leitura

- **Hooks** (`.lumina/hooks.json` · `postWrite`): comandos configurados pelo usuário no workspace
  rodam após `write_file`/`edit_file` (até 4, `{path}` expansion, env higienizado, timeout 120 s,
  output limitado), com auditoria `hook/ran`; falha não desfaz a edição (aviso no resultado).
  Testes: parse string/objeto e execução real de hook (pulado sem shell).
- **Allowlist de leitura** no modo Editar (`workspace::exec::is_readonly_command`): `git status/diff/
  log/show/branch/…`, `ls`, `cat`, `rg`, `find`, `--version` rodam sem aprovação; composição
  (`;`, `&&`, `|`, `>`, `$(`) desqualifica; destrutivo continua sempre pedindo. Testado no
  classificador e ponta a ponta via `run_command` sem canal de aprovação.

## 12. Fecho — estado final vs. plano

Fases do `PLAN.md` entregues e verificadas: **F0** (contratos/base), **F1** (workspaces/sessões/UI),
**F2** (leitura/busca/observação CAS), **F3** (edição/journal/diff/revert), **F4** (shell/jobs),
**F5** (plano/tarefas/perguntas/contexto/compactação), **F6** (git CLI + commit com sugestão de IA),
**F7** (terminal PTY com xterm), **F8** (verificação de projeto, subagentes somente leitura, MCP
stdio, hooks e allowlist de leitura). Composer com `@arquivos`/`/comandos`, cards de aprovação/
plano/tarefas/jobs/respostas/apresentações, painel Arquivos/Alterações real e docs atualizadas
(`ARCHITECTURE` §5/§8.3/§12/§13/§16, `FILES` §14/§16, `DESIGN` §5, `TOOLS` §2.6, `EVIDENCE`).

**Verificação final da branch `feat/code-harness`:** `cargo check --all-targets` verde;
`cargo test --lib` 708 verdes; `pnpm typecheck` verde; `pnpm test` 97 arquivos/1717 testes verdes;
`pnpm build` verde. Nenhum mock/fake em produto (fakes apenas em testes, com provider/streamer
controlados).

**Fora do escopo entregue (documentado, consistente com o plano):** CSP restritiva no
`tauri.conf.json` (dívida pré-existente; exige validação manual do app empacotado), telas de
configuração para MCP/servidores e "Verificações" no painel (backend exposto por `mcp_status` e
`run_checks`), worktrees/LSP/ACP/agendamentos (v2 do PLAN).
## 13. Ajustes pós-fecho — diff como aba central

- **Diff de arquivo como aba do chat (padrão)**: clicar num arquivo da aba Alterações abre `CodeDiffView` no centro, com uma aba `Diff` na barra de sessões (fechável, teclado, `aria-selected`); o chat compartilhado permanece montado oculto (estado preservado) e o `CodeSessionHeader` continua visível.
- **Configurável**: `Settings.diffOpenMode` (`tab` padrão | `panel`) normalizado no backend (`config::normalize_settings`) e exposto em Configurações → Ferramentas → Workbench de código; `panel` mantém o detalhe inline anterior.
- **Sem backend novo**: o alvo vive em `uiStore.codeDiffTab` (workspace/path/staged/knownDiff) e o diff usa `get_file_diff`/journal.
- Testes: `uiStore` (abrir/fechar/setCodeView), `CodeDiffView` (diff conhecido, API, erro), `ChangesPanel` (delega para a aba), `CodeSessionHeader` (aba `Diff` ativa/fecha), `WorkspaceCenter` (centro + header/chat montados), `ToolsTab` (padrão e troca para painel) e `config`/serialização. Verificação: `cargo test --lib` 711 verdes, `pnpm typecheck`, `pnpm build` e testes afetados (201) verdes.
## 14. Diff com syntax highlight (aba Alterações e aba central)

- `DiffView` agora tokeniza cada linha visível com o **Prism/tema compartilhado** (`src/lib/highlight`: `prism`, `SYNTAX_THEME`), então os tokens coloridos seguem as variáveis CSS do tema claro/escuro; as linhas mantêm `bg-success-soft`/`bg-danger-soft`, números e prefixos.
- Linguagem inferida do caminho (`languageForPath`) com fallback para texto puro quando não há gramática; guarda de custo em 4.000 linhas (hunks grandes recolhidos + "ver mais") e `memo` por linha para não re-tokenizar em interações (copiar, expandir).
- Vale para o diff inline do painel e para o diff como aba central (`CodeDiffView` reutiliza `DiffView`).
- Testes: linhas com tokens (keyword/número), arquivo sem gramática em texto puro, contagens/fundos preservados e estados honestos. Verificação: 227 testes afetados verdes, `pnpm typecheck` e `pnpm build` verdes.
## 15. Histórico de commits como aba central (estilo Zed)

- **Botão na aba Alterações**: “Histórico” (só em repo git) abre uma aba central `Commits` (`uiStore.codeCommitsTab`), no mesmo padrão da aba de diff (fechável, teclado, header montado, chat preservado).
- **Lista**: `git_log` até 100 commits (SHA curto, assunto, autor, data) com estados de carregando/erro/vazio.
- **Commit completo**: novo `workspace::git::commit_detail` + comando `git_commit_detail` devolvem metadados (SHA/autor/e-mail/data/assunto/corpo) e arquivos com status, `+N −M`, binário e patch por arquivo; o parser divide o `git show` em seções (`A/M/D/R`), valida a revisão como hash hex (7–40, sem flags) e marca truncamento. UI: autor/e-mail/data, SHA copiável, arquivos expansíveis com `DiffView` (syntax highlight do tema), “Expandir/Recolher diffs” e corpo do commit.
- **Testes**: parser do patch (modified/added/deleted/renamed), revisão inválida, integração com repo git real (metadados + arquivos + patch), validação do comando, store (abrir/selecionar/fechar), botão na aba Alterações, aba no header, view no centro e a tela de lista/commit/expandir/erro. Verificação: `cargo test --lib` 714 verdes, 198 testes de renderer afetados, `pnpm typecheck`/`pnpm build` verdes.
## 16. Correção — commit longo sem rolagem

- Causa: o cabeçalho do commit era `shrink-0` e crescia sem limite (mensagem/corpo longos); o restante era `flex-1 min-h-0` com o `overflow-y-auto`, então o cabeçalho consumia a altura e a lista de arquivos/diffs ficava com altura zero — sem nenhum contêiner rolável.
- Correção: o **detalhe do commit** virou um único contêiner rolável (`role="region"` “Detalhes do commit”, `overflow-y-auto overscroll-contain`) contendo cabeçalho e lista; a mensagem passou a ter `max-h-40 overflow-y-auto` (não empurra os arquivos) e cada arquivo expandido mantém a rolagem interna do `DiffView`.
- Teste de regressão: commit com 80 linhas de mensagem e 12 arquivos garante que cabeçalho e arquivos estão no **mesmo** contêiner rolável e que o corpo tem limite/rolagem. Suíte afetada 199/199, `pnpm typecheck` e `pnpm build` verdes.
## 17. Ajuste — botão de histórico no elemento do topo

- O botão **Histórico** saiu da linha redundante “ALTERAÇÕES” (removida) e passou para a barra **workspace · branch** da aba Alterações, ao lado do nome/branch e dos contadores ↑/↓; só aparece em repositório git. `ChangesPanel` deixou de receber `onOpenCommits` (a ação vive no `CodePanel`, que conhece workspace/git).
- Testes: `CodePanel` abre o histórico pelo botão (estado `codeCommitsTab`/`codeView`) e não renderiza o botão fora de repo; suíte de `components/code` verde, `pnpm typecheck`/`pnpm build` verdes.
## 18. Ações por sessão na sidebar do Code (paridade com o Chat)

- Cada linha de sessão da sidebar do Code ganhou o botão **…** (visível no hover/foco, como no layout Chat) com **Fixar/Desafixar** (`togglePinned`), **Renomear** (diálogo com Enter/Esc), **Exportar** (`export_conversation` markdown), **Remover do Code** (só em sessões compartilhadas, `setConversationCodeLinked(false)`) e **Excluir** com confirmação; a linha mostra o ícone de fixada.
- Funciona tanto nas sessões dentro dos workspaces quanto nas sessões “Sem workspace”; estado de busy nos diálogos e toasts honestos em falha.
- Testes: fixar, renomear, exportar, remover do Code e excluir (5 novos casos em `CodeSidebar`), total 182 verdes em `components/code`, `pnpm typecheck`/`pnpm build` verdes.
## 19. Correção — arquivo novo sem staging na aba Alterações

- Antes: arquivos untracked apareciam como `?`, sem contadores e sem diff, porque `git diff` ignora untracked — só viravam `A` depois de `git add`.
- Agora: a linha do arquivo novo mostra badge **`A`** (grupo “Novos”) mesmo sem staging, e `get_file_diff` retorna o patch **sintético de new file** montado a partir do conteúdo (`workspace::git::untracked_diff`): headers `diff --git`/`new file mode`/`--- /dev/null`/`+++ b/…` + hunk de adições, marcador de “sem newline” e detecção de binário. O fallback só roda quando o `git diff` normal está vazio **e** o path não está no índice (`is_tracked`), então arquivos rastreados sem alterações continuam vazios e nada mexe no índice.
- Testes: síntese do patch (normal, sem newline, binário, limite), `is_tracked` + `git diff` vazio em untracked, linha `A` e abertura do diff no renderer. Verificação: `cargo test --lib` 717 verdes, 183 testes de `components/code`, `pnpm typecheck`/`pnpm build` verdes.