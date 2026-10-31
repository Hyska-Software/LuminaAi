# PLAN — Harness de código do Lumina

> **Status:** planejamento concluído em **2026-10-27**. Nenhuma linha de código de produção foi
> alterada; os artefatos desta fase são este plano (GOAL/PLAN/HARNESS/TOOLS/WORKBENCH) e a pesquisa
> em `docs/research/`.
> **Como ler:** `GOAL.md` (pedido + critérios) → este `PLAN.md` (decisões, fases, ownership, riscos)
> → `HARNESS.md` (loop/política/contexto/persistência) → `TOOLS.md` (catálogo de tools) →
> `WORKBENCH.md` (UI/UX).
> **Pesquisa-base:** `docs/research/dsh-harness-map.md`, `paseo-workbench.md`,
> `agent-harness-patterns.md`, `workspace-runtime-options.md`, `lumina-harness-integration-map.md`.

## 1. Resumo executivo

O Lumina já tem a metade difícil de um agente: loop em Rust com streaming incremental, 4 protocolos
de provedor, cancelamento, replay multi-step (`provider_state` v2), tools, skills, artefatos e um
layout Code com a casca pronta (sidebar, abas, painel Arquivos/Alterações) — mas **sem workspace,
sem leitura/escrita de arquivos, sem shell, sem git, sem aprovações**. O modo Code hoje é um chat
com painéis vazios.

Este plano adiciona o **harness de código nativo**: um **perfil de turno** no loop existente
(prompt, tools, política, orçamentos), um **workspace real** em disco, um **pipeline de tools com
permissões**, um **journal de alterações reversível**, **execução de comandos/jobs**, **plano e
tarefas**, **contexto com compactação** e a **UI de revisão/entrega** (árvore, diff, commit,
terminal). O Chat permanece idêntico.

**Escopo da v1.0** (fases 0–6): abrir pasta → agente lê/edita/roda comandos com aprovação →
diff/reverter → commit. Terminal, subagentes, MCP e diagnósticos entram nas versões seguintes, mas
os contratos já preveem onde.

| Métrica do plano | Valor |
| --- | --- |
| Fases até a v1.0 | 7 (F0–F6) |
| Esforço estimado (1 dev sênior) | 11–13 semanas |
| Com time paralelo (4–6 agentes/roles) | ~4–6 semanas de calendário |
| Novas tools | 18 na v1.0 (≤ 14 expostas por turno) |
| Novas tabelas | 5 (`workspaces`, `code_events`, `file_journal`, `session_summaries`, `approval_rules`) + 3 colunas aditivas |
| Novos comandos IPC | ~37 na v1.0 (43 no total, contando terminal e checks) |
| Novos eventos `TurnEvent` | 11 (aditivos) |
| Novas dependências Rust | 10 crate (nenhuma nativa/C; sem OpenSSL) |
| Áreas novas de código | `src-tauri/src/{workspace,policy}`, `harness/code/**`, `src/components/agent/**` |

### 1.1 Diferenciais deste harness (onde o Lumina passa a ser melhor que a referência)

1. **Reversibilidade de verdade**: journal por arquivo + "Reverter turno"/"Reverter arquivo" +
   "Voltar a este ponto" (restaura código **e** conversa) sem poluir o histórico do git. O Paseo
   não reverte; o Aider só auto-commita; o Lumina devolve o controle.
2. **Turno como unidade auditável**: cada turno fecha com tempo, tokens, arquivos e `+N −M`, e cada
   aprovação/execução fica registrada em `code_events` — dá para responder "o que o agente fez e
   quem autorizou" depois.
3. **Aprovação operável**: card com *o quê / onde / consequência* (diff, comando, path, segredo) +
   "sempre permitir" com escopo explícito, auditável e revogável — mais transparente que o fluxo do
   Codex e mais prático que o do DSH (que não tem allow-always).
4. **Modo Plano com três saídas**: aprovar e executar, aprovar e revisar cada edição, ou continuar
   planejando com feedback; o plano é editável antes de valer.
5. **Sessão longa que não morre**: token meter visível, compactação por resumo em 8 seções, poda de
   tool results e spill paginado — com o transcript real preservado na UI.
6. **Jobs que conversam com o agente**: dev server/testes longos viram jobs; ao terminar, o modelo
   recebe o resultado no próximo passo e o usuário vê a saída ao vivo.
7. **Segurança explícita**: workspace trust na primeira abertura, confinamento de path com
   canonicalização (junction/UNC/`..`), env saneado e classificação de comandos destrutivos — sem
   prometer sandbox de SO que o Windows não entrega.
8. **Pronto para agentes externos sem reescrever o workbench**: `agent_kind` + contratos de evento
   no formato que ACP usa (tool calls com diff/locations) deixam a porta aberta para "traga seu
   agente" numa v2, mantendo o Lumina dono da UI, do histórico e das permissões.
9. **Local-first sem daemon**: nenhuma CLI externa obrigatória, nenhum login extra, histórico e
   segredos no disco do usuário — o oposto do modelo do Paseo, que depende dos CLIs instalados.

## 2. Ponto de partida (auditado)

Fatos com evidência (`docs/research/lumina-harness-integration-map.md`):

- **Loop**: `harness::run_turn` (`src-tauri/src/harness/mod.rs:622-1271`), até `max_steps`
  (default 64), tool calls em paralelo (semáforo 4), resposta final forçada, replay v2, título
  heurístico, usage por turno.
- **Tools**: despacho por string em `tools/mod.rs:95-128`, sem trait/registry, sem política, sem
  aprovação; `ToolRuntime` único (`tools/mod.rs:25-43`).
- **Arquivos do agente**: só artefatos (`<app-data>/artifacts`) e workspace efêmero de `run_code`;
  **nada** de diretório do usuário.
- **Execução**: `run_code` é o molde do executor (kill de árvore, `CREATE_NO_WINDOW`, env sem
  segredos, timeout/cancel) — extrair, não duplicar.
- **Eventos**: 15 variantes, `Channel<TurnEvent>`; sem stdout de processo, aprovação, arquivo
  alterado, plano ou todo. Reducer tolerante a eventos desconhecidos (`default: break`).
- **Chrome Code**: `CodeSidebar`/`CodeSessionHeader`/`CodePanel`/`CodeWelcomeScreen` com estados
  vazios honestos e testados; `ChatView` única e sempre montada; `uiStore` com `layoutMode`,
  `codeView`, `codePanel*`.
- **Contexto**: estimativa por caracteres (`window*3`) e **descarte** do histórico antigo (sem
  resumo); tool result 24k/8k.
- **Dívida encontrada**: CSP está `null` em `src-tauri/tauri.conf.json` apesar de a documentação
  prometer CSP restritiva; `rust-version = 1.77` no `Cargo.toml` é insuficiente para as crates
  necessárias (≥1.85); abas do Code são estado local (não persistem).

O que o research externo sustenta (`agent-harness-patterns.md` §3/§5, `dsh-harness-map.md` §10,
`paseo-workbench.md` §8): catálogo de tools pequeno e estável; permissão em dois eixos (modo +
regras); diff/revisão como contrato de UX; plano como estado da sessão com gate; checkpoints
complementares ao git; contexto com compactação; instruções de projeto (`AGENTS.md`) e skills antes
de MCP/hooks; isolamento por worktree só depois.

## 3. Decisões de arquitetura (fechadas neste plano)

> Formato: **decisão** → por quê → alternativa descartada → consequência/risco. As fases assumem
> estas decisões; se alguma for revertida, as fases afetadas estão indicadas.

### D1. Harness **nativo** no Lumina (não orquestrar CLIs externos)

O Paseo é um *control plane*: um daemon roda Claude Code/Codex/etc. e a UI normaliza eventos
(`paseo-workbench.md` §1). O Lumina vai no sentido oposto: o agente **é** o produto, roda em Rust,
usa os provedores/catálogo/DB/tools já existentes. Ganhos: zero dependência de CLI/versão/login de
terceiros, estado durável próprio (SQLite + `provider_state`), UX coerente, um único modelo de
permissões. **Alternativa descartada** para a v1: daemon + CLIs (duplicaria estado, herdaria bugs de
terceiros e exigiria terminal scraping). **Seam preservado**: `conversations.agent_kind` permite
`acp:<agente>` no futuro (F9/v2), sem reescrever o workbench.

### D2. **Um loop, dois perfis** (`TurnProfile::Chat` | `Code`)

O perfil Code parametriza o mesmo loop (prompt, registry de tools, política, `max_steps`, história,
eventos). Não criamos um segundo loop: duplicar streaming/cancelamento/replay/usage seria a maior
fonte de regressão. A Fase 0 extrai o **registry de tools** e o **dispatch por perfil** mantendo os
testes do Chat verdes byte a byte (mesmos eventos, mesma ordem).

### D3. Workspace = **pasta do usuário**, 1 workspace ↔ N sessões

Workspace é contêiner de primeira classe (`workspaces`), com git **opcional**. `conversations.workspace_id`
nullable (sessões antigas e "sem workspace" continuam válidas). **Alternativa descartada**: pasta
gerenciada em `<app-data>` (ninguém trabalha num repo espelhado) e 1 sessão ↔ 1 workspace (impede
duas tarefas no mesmo repo, que é o uso real).

### D4. Persistência: **`messages` continua a história do modelo**; `code_events` é o log da sessão

Não adotamos event-sourcing completo como o DSH (`dsh-harness-map.md` §2): substituir
`provider_state` v2 e o replay atuais é risco alto e ganho pequeno para um app local-first.
Adotamos o que dá o maior retorno com migração aditiva: **log de fatos da sessão**
(`code_events`) para auditoria/projeções/UI/crash-recovery, **journal de arquivos** para
checkpoint/diff/revert e **`session_summaries`** para compactação. As projeções (todos, plano,
contexto, alterações, jobs, aprovações) são fold desse log — a UI não recalcula transcript.

### D5. Tools: **registry com contrato tipado** e catálogo pequeno

`ToolSpec` (nome, schema, classe de concorrência, risco, aprovação, orientação de prompt,
`execute`) substitui o `match` por string, com adaptadores para as 9 tools atuais (sem mudar
nomes/semântica). O perfil Code expõe **no máximo ~14 tools**. Edição: `edit_file`
(string replace com unicidade + CAS) e `write_file`; `apply_patch` fica para v1.2 (trade-off em
`agent-harness-patterns.md` D1 — string replace erra de forma mais recuperável com modelos
variados). Sem tools de git mutantes para o modelo: **commit é ação do usuário**.

### D6. Permissões: **modos + regras + aprovação interativa**; sandbox de SO **não é prometido**

Modos de sessão: **Leitura**, **Editar** (padrão), **Autônomo** + overlay **Plano**. Regras
"permitir/negar" por tool + matcher (comando/path), com escopo sessão/workspace/global, auditadas e
revogáveis. Aprovação é one-shot, com timeout e fail-closed. No Windows, **não existe** sandbox de
FS barato como Seatbelt/Landlock (`workspace-runtime-options.md` §4): o que prometemos é
**confinamento de path + aprovação + auditoria + kill de processos**, e dizemos isso na UI e na doc.
Sandbox nativo (token restrito/AppContainer) é spike de v2, nunca requisito da v1.

### D7. Checkpoint por turno = **journal de arquivos** (não snapshot completo, não auto-commit)

Antes da primeira mutação de cada path no turno, o conteúdo anterior vai para um object store por
hash; ao fim do turno, o estado final é capturado e o diff calculado. Isso dá "Reverter turno",
"Reverter arquivo" e o painel Alterações sem poluir o git. **Alternativa descartada**: snapshot de
todo o workspace por turno (caro), auto-commit estilo Aider (invasivo, polui histórico).

### D8. Git via **CLI do usuário** (não libgit2/gix na v1)

Único caminho para hooks, filtros, LFS, `core.autocrlf`, credential manager e worktrees se
comportarem como o usuário espera, com zero dependência nativa (`workspace-runtime-options.md` §1).
Trait `GitBackend` deixa a porta aberta para backend nativo de leitura na v2. Git ausente → modo
degradado honesto (journal/diff da sessão continuam; aba de commit explica).

### D9. Shell: **runner próprio** (extraído de `run_code`) + **PTY em fase separada**

`run_command` usa o runner de processos (pwsh/bash, timeout, Job Object, env saneado, caps, spill,
streaming coalescido); jobs em background; terminal interativo com `portable-pty` + xterm.js entra
na v1.1 (F7), porque é grande e independente. Sem `tauri-plugin-shell` (uma capability a menos e
reuso do código já testado).

### D10. Contexto: **token meter heurístico + poda + compactação por resumo + spill**

Gatilho `min(W×0.75, W − output_cap − 8192)`; resumo em 8 seções (template do DSH adaptado);
retenção recente ~20%; pruner de tool results antes do resumo; spill com leitura paginada. Medidor
visível no header. `/compact` manual. Sem PTC/run_code programático (descartado explicitamente).

### D11. Extensibilidade na ordem **instruções → skills → MCP → hooks → subagentes → ACP**

`AGENTS.md` (raiz→cwd, cap 32 KiB) e skills existentes já na v1.0; **MCP** na v1.2 (cliente stdio/
HTTP via `rmcp`, com aprovação por tool e origem visível); **hooks** na v1.3; **subagentes** na
v1.2 (delegação com tools restritas, profundidade 1); **ACP** só se "traga seu agente" virar
requisito (v2). Worktrees/paralelismo real: v2 (Windows + target compartilhado tornam escritas
concorrentes perigosas — `AGENTS.md`).

### D12. UI: **workspace como eixo**, painel direito é o produto, chrome mais baixo

Sidebar agrupa workspaces/sessões por status (não por data); header de 44 px + abas 36 px; painel
Arquivos/Alterações/Terminal; transcrição com cards de tool/diff/aprovação/plano/todo e **fecho de
turno** (tempo/tokens/±). Sem browser embutido, sem plugins, sem i18n. Detalhes: `WORKBENCH.md`.

### D13. Segurança de projeto: **workspace trust**

Primeira abertura de pasta pergunta "Confiar nesta pasta?" (padrão: confiar → Editar; alternativa
"abrir em Leitura"). Workspace não confiável não carrega `AGENTS.md`/skills de projeto e não executa
comandos. Proteção contra repo clonado malicioso (padrão Claude Code/Cursor, `agent-harness-patterns.md`
§6.2/§7.3).

### D14. CSP e hardening entram na Fase 0

`tauri.conf.json` hoje tem `csp: null` — corrigir junto da fundação (CSP restritiva com as exceções
necessárias) e adicionar teste/checagem manual no release, porque o harness passa a exibir conteúdo
de arquivos e saída de processos.

## 4. Arquitetura alvo (visão)

```
┌──────────────────────── Renderer (React) ────────────────────────────┐
│ CodeSidebar · CodeSessionHeader(+modo/contexto) · WorkspaceCenter      │
│   └ ChatView (única) · AgentCards (diff/aprovação/plano/todo/job)      │
│ CodePanel: Arquivos(tree) · Alterações(diff/commit) · Terminal         │
│ Composer: @arquivos · /comandos · modelo · modo · plano                │
│ stores: chatStore(+eventos) · uiStore(workspace/abas) · appStore       │
│ lib/api.ts: invoke + Channels (TurnEvent, TerminalEvent)               │
└──────────────▲───────────────────────────────────┬──────────────────┘
               │ eventos/snapshots                  │ comandos IPC
┌──────────────┴───────────────────────────────────▼──────────────────┐
│ commands/*  (turn, workspace, code, git, terminal)                   │
│ harness/    loop único + profile dispatch + prompt(chat|code)         │
│   code/     context(AGENTS.md/manifests/tree) · session(code_events)  │
│ tools/      registry(pipeline/ scheduler/ caps/ spill) + fs/shell/…  │
│ policy/     modos · regras · aprovação (broker) · classificação       │
│ workspace/  safe_path · journal(objects) · watch · exec(Job Objects)  │
│             · git(CLI) · project(perfis)                              │
│ db.rs       workspaces · code_events · file_journal · summaries · …   │
└──────────────────────────────────────────────────────────────────────┘
```

- **Fronteiras**: `tools`/`policy` → `workspace` → sistema; `workspace` não importa `harness`;
  `commands` finos. Nada de `unwrap()` em caminho de usuário; erros tipados com código estável.
- **Fluxo de um turno Code**: payload(profile=code) → valida workspace/trust/modo → prompt
  (identidade+ambiente+política+guidance das tools+projeto) → loop de passos → tool calls passam
  por política → aprovação (evento+await) → execução com timeout real → journal+eventos → compactação
  se preciso → finalização com `usage`/`presentation`/changes.
- **Contratos completos**: `HARNESS.md` §12 (eventos/comandos) e §11 (SQL); `TOOLS.md` §3
  (`ToolSpec`/`ToolOutcome`); `types.ts`/`api.ts`/`domain.rs`/`events.rs` na implementação.

## 5. Contratos compartilhados (resumo do que muda)

### 5.1 Rust (`domain.rs`, `events.rs`, `state.rs`, `db.rs`)

```rust
// domain.rs (Lead)
pub enum TurnProfile { Chat, Code }
pub struct TurnPayload { /* …existente… */ pub profile: Option<TurnProfile> }   // default Chat
pub struct Workspace { id, name, path, created_at, updated_at, last_opened_at, pinned, trusted,
                       git: Option<GitInfo> }
pub enum PermissionMode { ReadOnly, Edit, Autonomous }
pub struct TodoItem { id: String, content: String, status: TodoStatus }
pub struct PlanView { state: PlanState, markdown: Option<String>, updated_at: i64 }
pub struct ContextStats { used, window, output_cap, percent, compacted, breakdown }
pub struct FileChange { path, change, added, removed }         // presentation de tool
pub struct ApprovalRequest { id, tool_call_id, tool, title, detail, risk, preview, options, default }
pub struct JobView { id, command, status, started_at, duration_ms, exit_code }
pub struct Conversation { /* … */ pub workspace_id: Option<String>, agent_kind: String,
                          permission_mode: PermissionMode }
// ToolCallRecord ganha `presentation: Option<serde_json::Value>` (persistido)

// events.rs (Lead) — 11 variantes novas, no fim do enum:
ApprovalRequested · ApprovalResolved · ToolProgress · FileChanged · WorkspaceChanges
TodosUpdated · PlanUpdated · ContextStats · Compacted · JobUpdated · ProfileChanged

// state.rs (Lead): WorkspaceRegistry, JobRegistry, ApprovalRegistry (por turno)
```

### 5.2 TypeScript (`types.ts`, `api.ts`, stores)

Espelho dos DTOs; `api.ts` ganha ~37 wrappers na v1.0 (~43 no total); `chatStore` ganha estado de sessão de código
(`approvalsPending`, `plan`, `todos`, `context`, `jobs`, `changes`) e aplica os eventos novos;
`uiStore` ganha `activeWorkspaceId`, `openTabsByWorkspace`, `codeView: 'session'|'skills'|'terminal'`
e persiste. `LayoutMode`/`layoutMode` existentes continuam soberanos.

### 5.3 Comandos IPC (novos, ~37 na v1.0; 43 no total)

`workspace/*` (11), `code/*` (13), `git/*` (9 — inclui `suggest_commit_message`), `terminal/*` (4,
com `Channel<TerminalEvent>`). Lista completa em `HARNESS.md` §12.2.

## 6. Modelo de dados (migrações aditivas)

`workspaces`, `code_events`, `file_journal`, `session_summaries`, `approval_rules` +
`conversations.{workspace_id, agent_kind, permission_mode}`. SQL completo em `HARNESS.md` §11.
Regras: `CREATE TABLE IF NOT EXISTS` / `ensure_column`; nunca renomear/remover; testar abertura de
banco legado (o padrão já existe em `db.rs` e nos testes de migração).

## 7. Fase 0 — Fundação (contratos, registry, perfil, trust, CSP)

**Objetivo**: destravar tudo sem mudar o comportamento do Chat.

Backend (Lead + harness-dev + storage-dev):
1. `TurnProfile` + `TurnPayload.profile` (default `Chat`); dispatch em `run_turn` para
   `harness::code::run_turn` (mesmo loop e helpers; nenhuma mudança de evento no caminho Chat).
2. `tools::registry`: `ToolSpec`/`ToolCtx`/pipeline (validação → política → timeout → execução →
   caps/spill → presentation) com **adaptadores** para as 9 tools atuais; `tools::definitions`
   continua com a mesma saída (teste de contrato).
3. `policy` (esqueleto): `PermissionMode`, `RiskClass`, `PolicyDecision`, `ApprovalBroker`
   (oneshot+evento), regras em memória; sem UI ainda.
4. `workspace` (esqueleto): `WorkspaceCtx`, `safe_path`, `exec` extraído de `code_exec` (com
   testes de não-regressão), `journal` (vazio), `objects`.
5. DB: migração das 5 tabelas + 3 colunas; `code_events` append/seq; projeções vazias.
6. Eventos novos no enum + reducer do renderer tolerante (teste com evento desconhecido).
7. `Conversation`/`ConversationsView` com `workspaceId`/`agentKind`/`permissionMode`; comandos
   `set_conversation_workspace`, `set_permission_mode`, `get_code_session_state` (snapshot vazio).
8. `Settings`: `code_max_steps` (120), `shell_enabled` (true), `auto_compact` (true),
   `spill_retention_days` (30), `approval_timeout_sec` (600), `notifications_enabled` (true) —
   defaults seguros e normalização.
9. `Cargo.toml`: deps da v1 (§10) + `rust-version = 1.89`; `package.json`: `@xterm/xterm` só na F7.
10. **CSP restritiva** no `tauri.conf.json` + checagem manual (abrir app, chat, streaming).

Frontend (Lead + ui-code + ui-core):
- `types.ts`/`api.ts` dos contratos novos; `chatStore` com o esqueleto de estado de código;
  `uiStore` com `activeWorkspaceId`/abas persistidas.
- `CodeSidebar`/`Header`/`Panel` passam a ler do estado novo (ainda vazio, com os mesmos textos
  honestos — testes atualizados, não removidos).

Aceite: `cargo test --lib` e `pnpm test` verdes; Chat idêntico (eventos e mensagens iguais);
nenhuma tool nova exposta ainda; `TurnPayload.profile='code'` roda o mesmo loop com prompt vazio
de código e recusa sem workspace (`WORKSPACE_REQUIRED`).

## 8. Fases de entrega

> Convenção: cada fase é um incremento **utilizável e testado**, não uma camada invisível. A ordem
> é deliberada: leitura antes de escrita, escrita antes de execução, execução antes de git.

### F1 — Workspaces e sessões de código (v0.2a) · ~1,5–2 sem

- **Backend**: `workspace` CRUD + abertura de pasta (dialog existente), canonicalização, detecção
  git (branch/status), trust, `list_workspace_files` (tree com ignore/cap), `open_workspace_in_explorer`;
  `conversations.workspace_id`; comando `get_workspace_context`.
- **Frontend**: sidebar de workspaces (agrupar, expandir, menu, remover-sem-apagar), header com
  chip de workspace real (branch/dirty), welcome "Abrir pasta", confiança da pasta, sessões
  agrupadas por status; abas persistidas.
- **Contratos**: `Workspace`, `GitInfo`, `WorkspaceContext`, 6 comandos.
- **Testes**: canonicalização/paths Windows, CRUD, migração, sidebar/header/welcome, trust gate.
- **Aceite**: abrir um repo real e ver branch/status; criar 2 sessões no mesmo workspace; fechar e
  reabrir o app restaurando workspace ativo e abas.

### F2 — Leitura + confinamento + aprovações (v0.2b) · ~2–2,5 sem

- **Backend**: `tools/fs_read` (`read_file`, `read_image`, `list_dir`, `search_files`,
  `search_text`), `git_read` (`git_status`, `git_diff`, `git_log`), `read_tool_output`;
  `policy` completo (matriz, segredos, modo); `ApprovalBroker` com evento + comando + timeout;
  `code_events` de aprovação; prompt Code v0 (identidade/ambiente/política/tools/projeto).
- **Frontend**: árvore de arquivos real (virtualizada, badges git, filtro, teclado), prévia
  read-only, cards de leitura/busca, **card de aprovação** (comando/path/segredo), chip de modo de
  permissão, banner de workspace não confiável, notificações de espera.
- **Contratos**: 7 tools, `ApprovalRequest/Resolved`, `respond_approval`, `get_workspace_changes`?
  (não ainda), 4 comandos.
- **Testes**: matriz de política (modo × risco × path), path escape/symlink, encoding/binário,
  busca, aprovação (aprovar/negar/motivo/escopo/timeout/cancelamento), cards, reducer.
- **Aceite**: em modo Leitura o agente explora um repo real (lê, busca, mostra git status) sem
  conseguir escrever; em Editar, qualquer comando pede aprovação com o contexto correto.

### F3 — Edição + alterações + checkpoints (v0.3) · ~2 sem

- **Backend**: `write_file`/`edit_file` (observação/CAS, atômico, EOL/BOM), journal + object store,
  diff por arquivo (crate `similar`), `revert_file`/`revert_turn`, watcher coalescido,
  `FileChanged`/`WorkspaceChanges`, presentation nos tool calls, título com workspace.
- **Frontend**: **painel Alterações** (agrupamentos, origem sessão/git, ± por arquivo, diff
  unificado, reverter arquivo/turno com confirmação), card de diff no transcript, fecho de turno
  com alterações, "abrir no painel".
- **Testes**: observação/stale, atômico/CRLF/BOM, journal/revert (incluindo arquivo alterado por
  fora), diff (rename/binário/grande), watcher invalidação, painel e card.
- **Aceite**: pedir "corrija X e rode os testes" → edições com diff revisável → reverter turno
  restaura exatamente o estado anterior → painel consistente após reabrir o app.

### F4 — Shell, jobs e streaming (v0.4) · ~1,5–2 sem

- **Backend**: `run_command` (política, classificação destrutiva, timeout real, kill tree, env
  scrub, caps/spill, `ToolProgress`), `jobs` (`JobRegistry`, `job_list/output/kill`, notificação ao
  modelo), promoção a job no timeout, `run_in_background`.
- **Frontend**: card de comando com saída ao vivo (streaming coalescido), barra/lista de jobs,
  aprovação de comando com "sempre permitir" e motivo de negação, notificação de fim de job.
- **Testes**: exit codes/stderr, timeout, cancelamento/árvore (Job Object), spill, env scrub,
  destrutivo, background/promoção, jobs (limite/cursor/kill), UI.
- **Aceite**: agente roda `npm test`/`cargo test` num projeto real com aprovação, saída ao vivo,
  e um dev server longo permanece em background sem travar o turno.

### F5 — Plano, tarefas, contexto, `@` e `/` (v0.5) · ~2 sem

- **Backend**: `todo_write` (projeção), plan mode + `submit_plan` + revisão (aprovar/continuar),
  `ask_user`, token meter, pruner, compactação (resumo 8 seções + `session_summaries` + evento),
  spill/`read_tool_output` maduro, `/compact`; resolução de `@arquivo` no payload (cap).
- **Frontend**: card de plano com aprovação/feedback, card e popover de tarefas, medidor de
  contexto + popover, card de compactação, **composer com @arquivos e /comandos**, atalhos.
- **Testes**: projeções/replay, plano (aprovar/revisar/continuar/fora de modo), ask_user
  (single/multi/timeout), token meter, compactação (gatilho/seleção/falha), `@` (busca/chips/limite),
  `/` (filtro/execução).
- **Aceite**: `/plan` num pedido grande → plano revisável → aprovação → execução; sessão longa
  compacta sozinha e continua; `@src/app.ts#L10-40` injeta contexto exato.

### F6 — Git UI, commit e entrega (v1.0) · ~1,5 sem

- **Backend**: `git` completo (status/diff/stage/unstage/discard/commit/branch/log),
  `suggest_commit_message` (request curto), validação de mensagem, hooks do git, erros claros.
- **Frontend**: aba Alterações final (staged/unstaged/untracked, seletor de alvo, barra de commit
  com sugestão IA, histórico de commits), branch menu, conflitos, estados de git ausente.
- **Testes**: repo temporário (status/diff/stage/commit/branch), rename/acentos/CRLF, sem git,
  conflito, mensagem vazia/sugestão, commit com hooks, UI.
- **Aceite (release v1.0)**: o fluxo completo do `GOAL.md` em um repositório real, com Chat
  intacto e todos os critérios de pronto do GOAL verificados em `EVIDENCE.md`.

### F7 — Terminal PTY (v1.1) · ~1,5 sem

`portable-pty` + ConPTY + xterm.js; abas de terminal no painel; cwd = workspace; resize/encoding/
kill tree; sem promessa de sandbox. Spikes S1/S2 antes.

### F8 — Agentes, extensões e diagnóstico (v1.2) · ~3 sem

Subagentes (`task` com tools restritas, profundidade 1, resumo no “Thinking”, presentation
persistida); MCP client
(`rmcp`, stdio, namespace `mcp:<server>:<tool>`, aprovação por tool com origem); checks do projeto
(`/test`, `/review`, `/init`, `diagnostics` por comandos configuráveis); hooks (subset
`pre_tool_use`/`post_tool_use`/`stop`); comandos de projeto (`.lumina/commands/*.md`); `apply_patch`
e `delete_path`/`move_path`; notificações do SO.

### v2 (não comprometido) — Worktrees/paralelismo isolado, ACP (agentes externos), LSP, sandbox
experimental (token restrito/ACL), agendamentos, PR/push, FTS5 de histórico, `goal`/auto-continuação.

## 9. Paralelização e ownership

### 9.1 Áreas e donos (proposta de atualização do `AGENTS.md`)

| Área | Arquivos | Dono |
| --- | --- | --- |
| Contratos/estado/IPC | `src/lib/{types,api}.ts`, `src/lib/store/**`, `src/App.tsx`, `src-tauri/src/{domain,events,state}.rs`, `lib.rs`, `commands/mod.rs`, `Cargo.toml`, `tauri.conf.json` | **Lead** |
| Harness/prompt/tools/política | `src-tauri/src/harness/**`, `src-tauri/src/tools/**`, `src-tauri/src/policy/**` | **harness-dev** |
| Workspace/runtime | `src-tauri/src/workspace/**` (safe_path, journal, watch, exec, git, project), `commands/{workspace,git,code,terminal}.rs` | **code-runtime-dev** (novo) |
| Persistência/config | `src-tauri/src/{db,config}.rs`, `commands/{conversations,settings,attachments,artifacts}.rs` | **storage-dev** |
| Workbench Code | `src/components/code/**` (+ FileTree, DiffView, ChangesPanel, CommitBar, WorkspacePicker, TerminalPanel) | **ui-code** |
| Cards do agente | `src/components/agent/**` (ApprovalCard, PlanCard, TodoCard, AskUserCard, ContextMeter, JobsBar), `src/lib/agentTrace.ts`, `AgentSteps` | **ui-agent** (novo) |
| Chat/composer | `src/components/chat/**`, `src/components/composer/**`, `WorkspaceCenter` | **ui-core** |
| Settings/paleta/skills | `src/components/{settings,palette,skills}/**` | **ui-systems** |
| Skills embutidas | `src-tauri/skills/**` | **formats-dev** |
| Verificação | suíte + revisão contra o plano + `EVIDENCE.md` | **verifier** |

> Regra do repo mantida: ninguém edita arquivo de outra área; mudança de contrato é pedida ao Lead
> com assinatura exata. Toda fase termina com `complete` na task compartilhada + mensagem ao Lead.

### 9.2 DAG por fase

```
F0  Lead(contratos) ─┬─ harness-dev(registry/profile/policy skeleton)
                     ├─ code-runtime-dev(safe_path/exec/journal skeleton)
                     ├─ storage-dev(migrações/settings)
                     └─ ui-code/ui-core/ui-agent(reading contracts, scaffolding)
F1  code-runtime-dev(workspace) ─ ui-code(sidebar/header) ─ Lead(integração)
F2  harness-dev(tools leitura+política) ∥ code-runtime-dev(git read/watch/base) ∥ ui-code(tree) ∥ ui-agent(approval card)
F3  harness-dev(write/edit) ∥ code-runtime-dev(journal/diff) ∥ ui-code(changes/diff) ∥ ui-agent(diff card)
F4  code-runtime-dev(exec/jobs) ∥ harness-dev(run_command/jobs tools) ∥ ui-code(jobs/terminal-ish) ∥ ui-core(streaming card)
F5  harness-dev(plan/todo/contexto/compactação) ∥ ui-agent(plan/todo/contexto) ∥ ui-core(@ e /) ∥ code-runtime-dev(spill/limites, apoio)
F6  code-runtime-dev(git UI) ∥ ui-code(commit/histórico) ∥ Lead(release)
F7  code-runtime-dev(pty) ∥ ui-code(terminal)
F8  harness-dev(subagents/mcp/hooks) ∥ ui-agent(cards) ∥ ui-systems(settings MCP) ∥ formats-dev(skills de código)
```

### 9.3 Primeiro PR (F0 em 8 passos pequenos)

1. `TurnProfile` + payload + validação (Lead) + testes.
2. `ToolSpec` + adaptadores das 9 tools + teste de contrato idêntico (harness-dev).
3. Migração DB + `code_events` append/seq + `get_code_session_state` vazio (storage-dev+Lead).
4. `Workspace`/`permissionMode` no domínio + comandos de leitura (Lead+storage-dev).
5. Events novos + reducer tolerante (Lead+ui-core).
6. `exec.rs` extraído + testes de paridade com `code_exec` (code-runtime-dev).
7. `safe_path` + testes Windows (code-runtime-dev).
8. CSP + `rust-version` + deps (Lead).

## 10. Dependências novas (proposta; Lead é dono do `Cargo.toml`)

```toml
# Cargo.toml — adicionar na F0 (validar MSRV 1.89)
notify = "8.2"; notify-debouncer-full = "0.7"      # watch
ignore = "0.4.33"; grep-searcher = "=0.1.17"; grep-regex = "=0.1.14"; globset = "0.4"  # busca
tempfile = "3"; similar = "3.2"; diffy = "0.5"; dunce = "1"   # journal/diff/paths
portable-pty = "0.9"; windows = { version = "0.62", features = [ "Win32_System_JobObjects", … ] }  # F7/F4
# F2/F8: rmcp = { version = "3.8", features = ["client","transport-child-process"] } (MCP, v1.2)
# tauri-plugin-notification (F8) — nova capability no default.json
```

`package.json`: `@xterm/xterm` + `@xterm/addon-fit` (F7). Sem novas deps nativas/C, sem OpenSSL.
`rust-version` sobe para **1.89** (checar `rustup default` no CI/dev antes).

## 11. Verificação e qualidade

### 11.1 Por fase (obrigatório, TDD)

- Backend: `cd src-tauri && cargo check` + `cargo test --lib` (todas as tools novas com testes de
  sucesso/erro/limite/política; loop com provider falso e aprovação; migrações; journal).
- Renderer: `pnpm typecheck`, `pnpm test` (componentes e stores novos), `pnpm build`.
- Integração real (`#[ignore]`): perfil Code com o gateway (tool call + replay + cancelamento +
  compactação) usando `deepseek-v4.1-flash` com esforço máximo (convenção do repo).
- Manual (release): checklist do `GOAL.md` em repo real; **sem** automação de UI/screenshot.

### 11.2 Spikes obrigatórios antes de prometer (de `workspace-runtime-options.md` §13)

| Spike | Fase | Critério |
| --- | --- | --- |
| S1 ConPTY/portable-pty (resize, Ctrl+C, TUI, UTF-8 partido) | F7 | sessão estável 10 min, sem `�` |
| S2 Job Object (kill de árvore, cancelamento < 500 ms) | F4 | zero órfãos em 20 ciclos |
| S3 Git CLI parsing (porcelain v2 `-z`, renames, acentos, 50k arquivos) | F6 | fixtures 100%, p95 status < 800 ms |
| S4 Watcher (overflow, save atômico, OneDrive, 50k) | F3 | rescan em overflow, UI < 1 s |
| S5 Escrita atômica (arquivo aberto, CRLF+BOM, SMB) | F3 | diff mínimo, nenhum truncamento |
| S6 Busca (100k arquivos, cancelamento, memória) | F2 | < 1 s, cancelamento < 150 ms |

Falha em um spike vira decisão explícita (reduzir promessa/adiar), nunca silêncio.

### 11.3 Evidência

Cada fase produz `docs/goals/code-harness/EVIDENCE.md` (seção por fase): comandos rodados,
resultado da suíte, testes de caos (§`HARNESS.md` §14), decisões tomadas na implementação, riscos
abertos. O `verifier` faz revisão independente contra este plano (incl. regra "sem dado falso",
tokens do tema, a11y, segurança) antes do `complete`.

## 12. Riscos e mitigação

| Risco | Prob. | Impacto | Mitigação |
| --- | --- | --- | --- |
| Regressão no Chat pelo refactor do loop/tools | Média | Alto | F0 com adaptadores e testes idênticos; perfil Code em módulo separado; suíte inteira a cada PR |
| Escopo crescer (terminal/subagentes/MCP na v1) | Alta | Alto | Fases fechadas com "não-objetivo"; v1.0 = F0–F6; F7/F8 explícitos |
| Aprovação gerar fadiga e o usuário desligar tudo | Alta | Médio | Modos claros + "sempre permitir" com escopo + allowlist de leitura; auditoria; rotular risco |
| Comando destrutivo aprovado por hábito | Média | Alto | Card mostra comando/path e risco; destrutivo separado visualmente; sem auto-approve em Autônomo |
| Windows: paths longos/UNC/junction/antivírus | Alta | Médio | `safe_path` com testes dedicados; escrita atômica com retry; spikes S3–S5 |
| Performance em repos grandes (árvore/search/status) | Média | Médio | caps+virtualização; ignore; cache por mtime; benchmarks de spike; degradar com aviso |
| Contexto estourar/compactação falhar | Média | Alto | token meter + gatilho conservador + retry com compactação forçada + pruner; testes de sessão longa |
| Perda de trabalho (write cego/revert errado) | Baixa | Alto | read-before-write/CAS; journal+revert com verificação de hash; diff antes de aprovar escrita |
| Vazamento de segredo para o modelo | Média | Alto | env scrub; padrões de segredo com ASK; nunca auto-incluir `.env`; prompt de segurança |
| Dívida preexistente (CSP null) virar incidente | Média | Alto | corrigir na F0 + checagem no release |
| Modelos fracos falharem em tool calling/prompt longo | Média | Médio | catálogo enxuto (≤14 tools), schemas curtos, erros acionáveis, retry/lembrete, testes com modelos reais |
| Dependência de git do usuário ausente/antigo | Média | Baixo | modo degradado honesto; detectar versão; painel explica; commit desabilitado |
| Duplicação de writes entre sessões do mesmo workspace | Média | Médio | PathLock global por workspace; aviso na UI; v2 worktrees |
| `cargo` lock do repo (target compartilhado) em testes concorrentes | Média | Baixo | rodar build/test serializado no CI; documentar (AGENTS.md já alerta) |

## 13. Documentação a atualizar (por fase)

- F0: `AGENTS.md` (novas áreas/donos + comandos), `docs/ARCHITECTURE.md` (§3, §4, §5, §8, §12, §13,
  §16), `docs/FILES.md` (§5–8 + §14 novo release do harness), `docs/DESIGN.md` (§5, §11, §14).
- F1: `docs/ARCHITECTURE.md` §5 (workspaces/tabelas), `DESIGN` §5 (Code).
- F2: `docs/FILES.md` (tools de leitura, política, segurança §8.3), `ARCHITECTURE` §8/§13.
- F3: `FILES` (journal/revert), `ARCHITECTURE` §5/§11, `DESIGN` §6 (cards).
- F4: `FILES` §8 (execução de comandos/jobs; contraste com `run_code`), `ARCHITECTURE` §8.2,
  `DESIGN` §14 (microcopy), `docs/FILES.md` §14 (release).
- F5: `GENUI`? não; `DESIGN` §7 (composer @/ e modo), `ARCHITECTURE` §8 (contexto).
- F6: `ARCHITECTURE` §11 (git/commit), `FILES` §14, `DESIGN` §14 (commit).
- F7/F8: `FILES` §8/§9 (terminal/MCP), `ARCHITECTURE` §8/§13, `docs/MODELS.md`? não.
- Sempre: `docs/goals/code-harness/EVIDENCE.md`.

## 14. Decisões que preciso confirmar com você (antes da Fase 0)

1. **Runtime nativo** (D1) é o caminho, mantendo o seam `agent_kind` para agentes externos no
   futuro? *(recomendo sim — é a única forma de entregar o harness dentro do app sem depender de
   CLIs instalados; o workbench continua compatível com ACP depois)*
2. **Escopo da v1.0 = F0–F6** (workspace, leitura, edição, shell, plano/contexto, git/commit) e
   **terminal na v1.1**? Ou você quer terminal já na v1.0 (custa ~1,5 semana e um spike de ConPTY)?
3. **Modos de permissão** com estes nomes/regras: `Leitura` / `Editar` (padrão) / `Autônomo` +
   overlay `Plano`? *(alternativa: Manual / Aceitar edições / Plano / Acesso total, nomes do
   benchmark)*
4. **Confiança na pasta** (D13) como gate de segurança na primeira abertura? *(recomendo sim; sem
   ele, instruções de repo clonado entram no prompt e skills podem rodar)*
5. **Commit só pelo usuário** (o agente não recebe tool de commit; pode sugerir mensagem)? *(recomendo
   sim; ferramenta de commit para o modelo é o caminho mais curto para histórico poluído)*
6. **`Autônomo` libera shell sem aprovação** exceto comandos destrutivos, ou todo comando pede
   aprovação mesmo nele? *(recomendo liberar — é o modo "confio nesta tarefa"; destrutivo continua
   pedindo)*
7. **Workspace = pasta do usuário**, sem pasta gerenciada, e **sem worktrees** na v1? *(recomendo
   sim; worktrees na v2)*

Sem resposta, sigo com as recomendações acima (elas estão registradas como as decisões D1–D14).

## 15. Não faremos (explicitamente)

- Daemon/servidor remoto, mobile/web/CLI, plugins de terceiros, marketplace, voz, browser embutido,
  i18n.
- Event-sourcing completo do transcript (substituir `messages`/`provider_state`), PTC/`run_code`
  programático, gateway HTTP interno.
- Sandbox de SO no Windows na v1; auto-aprovação por classificador de modelo; auto-commit.
- Multi-agente/worktrees paralelos na v1; ACP na v1.
- Edição colaborativa/multiusuário; LSP completo na v1.
- Dados falsos em qualquer estado da UI: o que não existe aparece como vazio honesto (regra herdada
  da fase 1 e testada).

## 16. Referências

- Pesquisa: `docs/research/{dsh-harness-map,paseo-workbench,agent-harness-patterns,workspace-runtime-options,lumina-harness-integration-map}.md`
- Fase anterior: `docs/goals/chat-code-layout/`, `docs/goals/chat-code-sessions/`
- Contratos atuais: `docs/ARCHITECTURE.md`, `docs/FILES.md`, `docs/DESIGN.md`, `AGENTS.md`
- Padrões abertos: AGENTS.md (agents.md), Agent Skills (agentskills.io), MCP
  (modelcontextprotocol.io), ACP (agentclientprotocol.com)
