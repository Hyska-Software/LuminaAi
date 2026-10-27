# Mapa de integração do harness de código — Lumina

> **Autor:** lumina-analyst (task-3) · 2026-10-27 · **somente leitura de código**; nenhum arquivo de produção foi alterado.
> **Objetivo:** mapa exato (`arquivo:linha`, assinaturas, tipos) do que existe, do que é reaproveitável e de onde plugar um **harness de código nativo** no layout Code sem quebrar contratos.
> **Como ler:** §0 = resumo; §A = loop atual; §B = capacidade × necessidade; §C = extensão; **§D/§F = decisões** (arquivos por owner e perguntas pendentes). Onde não abri o corpo da função, está **“verificar”**.

---

## 0. Resumo executivo — os 10 fatos que decidem o plano

| # | Fato | Evidência |
| --- | --- | --- |
| 1 | O harness é **genérico de conversa**; a "sessão de agente" do Code é `conversations` com `mode='code'`. Não há tabela/entidade de sessão, workspace, snapshot ou job. | `src-tauri/src/domain.rs:32-53`, `db.rs:55-69`, `src/lib/store/chatStore.ts:34-97` |
| 2 | Loop de até `max_steps` (1..1000, default 64), uma chamada de provider por passo, tools em paralelo (semáforo 4), replay multi-step e passada final forçada. | `harness/mod.rs:32,771-1111`, `domain.rs:289-294,679-681` |
| 3 | Todo streaming é `TurnEvent` por `tauri::ipc::Channel` (`tag="type"`, camelCase). Não há evento de stdout de processo, aprovação pendente ou arquivo alterado. | `events.rs:12-71`, `commands/turn.rs:11-17`, `src/lib/api.ts:138-142` |
| 4 | Tools são **despacho por string** num `match` central (sem trait/registry/enum). Tool nova = `definition()` + `run()` + braço no `match` + entrada em `definitions()`. | `tools/mod.rs:67-128`, `tools/create_file.rs:15-88` |
| 5 | O "filesystem do agente" é artefato (`<app-data>/artifacts/<id>/<nome>`) + workspace efêmero do `run_code` (`<app-data>/code-runs/<uuid>/`, apagado no `Drop`). **Não há leitura/escrita de diretório do usuário.** | `tools/artifacts.rs:135-188`, `tools/code_exec.rs:543-564` |
| 6 | Não existe shell, git, diff, commit, editor, watcher, MCP, subagente, aprovação, slash command nem `@files`; sem plugin/dep de shell/fs/git e sem capability correspondente. | `Cargo.toml:16-21`, `capabilities/default.json`, §E.1 |
| 7 | O chrome do Code **já existe com estados vazios honestos**: "Sem workspace" (header e painel), "Sem commit +0 −0" + Commit desabilitado, abas de sessão locais, welcome. | `CodeSessionHeader.tsx:183-197`, `CodePanel.tsx:183-204`, `CodeSidebar.tsx:207-221`, `CodeWelcomeScreen.tsx:45-111` |
| 8 | A timeline (`AgentSteps`) mapeia **nome de tool → ícone por hardcode**; o `trace` persistido guarda só reasoning + contagem de calls por passo. | `AgentSteps.tsx:46-56`, `domain.rs:176-186`, `agentTrace.ts:51-85` |
| 9 | Contexto por **estimativa de caracteres** (`context_window*3` clamp 40k–600k) com **descarte** do histórico antigo (sem resumo). Tool result: 120k na tool, 24k no modelo, 8k na UI. | `harness/mod.rs:45-48,1514-1543,1677-1680`, `tools/mod.rs:22-23` |
| 10 | `run_code` já resolve o problema "Windows" (kill de árvore, `CREATE_NO_WINDOW`, env sem segredos, timeout/cancel, coleta de arquivos) — **é o molde da futura tool de shell**. | `tools/code_exec.rs:543-763,846-950` |

**Caminho de menor risco:** (a) criar o conceito de workspace no backend, (b) extrair de `code_exec` um executor genérico, (c) tools de FS por cima do mesmo `ToolRuntime`; a UI de painel/abas consome isso quase sem mudança. Decisões em §F.

---

## A. Mapa do loop atual

### A.1 Cadeia de chamada (renderer → IPC → harness)

```
Composer.submit()                        src/components/composer/Composer.tsx:96-103
 └ useChatStore.send(content)            src/lib/store/chatStore.ts:831-943
    ├ ensureConversation()               chatStore.ts:565-582 (create_conversation com o layout atual)
    ├ mensagens otimistas                chatStore.ts:872-923
    ├ payload: TurnPayload               chatStore.ts:925-934
    └ runTurn(payload, handleEvent)      chatStore.ts:325-563
       └ api.runTurn(payload,onEvent)    src/lib/api.ts:138-142
          └ invoke('run_turn',{payload,onEvent:Channel})   api.ts:139-141
             └ commands::turn::run_turn src-tauri/src/commands/turn.rs:11-70
                ├ register_turn(turn_id) turn.rs:18-22, state.rs:196-200
                ├ load_settings(&app)    turn.rs:23, config.rs:131-139
                ├ HarnessDeps { … }      turn.rs:24-43, harness/mod.rs:157-185
                ├ harness::run_turn(…)   turn.rs:45-52, harness/mod.rs:622-1271
                └ finish_turn(turn_id)   turn.rs:53, state.rs:202-204
```

`cancel_turn` é comando síncrono separado: `commands/turn.rs:72-75` → `state.cancel_turn` (`state.rs:206-215`).

### A.2 Contratos de turno (Rust ↔ TS)

| Tipo | Rust | TS | Observação |
| --- | --- | --- | --- |
| `TurnPayload` | `domain.rs:325-341` | `types.ts:261-270` | `conversationId, content, attachmentIds, providerId, modelId, reasoning?, options, turnId?` |
| `TurnOptions` | `domain.rs:296-323` (`#[serde(default)]`) | `types.ts:250-259` | `webSearch, createFiles, runCode, maxSteps, temperature?, systemPromptOverride?, regenerate?` |
| `TurnResult` | `domain.rs:343-354` | `types.ts:272-278` | `userMessage, assistantMessage, usage?, error?, conversation?` |
| `TurnEvent` | `events.rs:12-71` (`tag="type"`, `rename_all="snake_case"`, campos camelCase) | `types.ts:280-302` (union) | 15 variantes (A.4) |
| `ChatMessage` | `domain.rs:188-223` | `types.ts:188-206` | `providerState` é `skip_serializing` (não cruza IPC) |
| `Conversation` | `domain.rs:30-53` | `types.ts:208-231` | `mode: "chat"|"code"`, `codeLinked` |
| `ToolCallRecord` | `domain.rs:87-104` | `types.ts:131-140` | `id, name, arguments (JSON string), result?, status, summary?, startedAt?, finishedAt?` |
| `UsageInfo` / `Settings` | `domain.rs:156-174` / `653-721` | `types.ts:178-186` / `475-510` | `codeExecutionEnabled` **default false** (`domain.rs:713`) |

### A.3 `harness::run_turn`, fase a fase

Assinatura (`harness/mod.rs:622-628`):

```rust
pub async fn run_turn(
    deps: HarnessDeps, payload: TurnPayload, settings: Settings,
    on_event: Arc<dyn EventEmitter>, cancel: CancellationToken,
) -> anyhow::Result<TurnResult>
```

| Fase | Linhas | O que acontece |
| --- | --- | --- |
| 1. Setup | `639-669` | Conversa, provedor, modelo (override de teste → catálogo), **credencial antes de persistir** (`663`), protocolos; atualiza provedor/modelo da conversa (`666-669`). |
| 2. Opções efetivas | `675-681` | `web_search && settings.web_search_enabled`, `create_files && …`, **`run_code && settings.code_execution_enabled`** (`680`), `max_steps.clamp(1, 1000)` (`681`). |
| 3. Persistência inicial | `688-701` | `prepare_new_turn` (user + assistant placeholder, `1277-1295`) ou `prepare_regenerate` (`1297`; corpo não lido — verificar); emite `TurnStarted`. |
| 4. Contexto | `707-765` | `list_messages`, `build_history`, `<app-data>` (`data_dir`/`config::data_dir`), catálogo de skills, `prompt::build_system_prompt`, `tools::definitions`, reasoning/temperature/max_output, `ToolRuntime`. |
| 5. Loop | `784-1001` | Passos com `StepStarted`, acumulando texto/reasoning/usage/calls; tools ao fim de cada passo. |
| 5b. Resposta forçada | `1010-1111` | Sem texto final e sem falha dura: completion extra **sem tools** com prompt de encerramento (`1017-1022`), mesma regra de retry 401. |
| 6. Finalização | `1151-1206` | `duration_ms`/tokens; status (`1160-1170`); preenche `assistant_message`; `db.update_message` (`1183`); `db.record_usage` (`1185-1193`); emite `Usage` + `MessageUpdated`. |
| 6b. Título | `1208-1232` | Só com `auto_title` e título placeholder: `derive_title` → `rename_conversation` → `TitleUpdated`. |
| 6c. Retorno | `1235-1270` | Lê conversa atualizada, monta `TurnResult`, emite `Cancelled`/`Error`/`Done`. |

### A.4 Onde cada `TurnEvent` é emitido

| Evento | Emissor | Linha |
| --- | --- | --- |
| `TurnStarted` | fase 3 | `harness/mod.rs:694-701` |
| `StepStarted` | loop / passada forçada | `790`, `1011-1016` |
| `ReasoningDelta` / `TextDelta` | `run_stream_attempt` | `534-539` / `540-545` |
| `ReasoningDone` | fim do passo com reasoning | `857-858` |
| `ToolCallStarted` / `ToolCallArgs` | `run_stream_attempt` | `546-561` / `563-574` |
| `ToolCallFinished` | após `execute_tools` | `929-938` |
| `ArtifactCreated` | por artefato do outcome | `939-946` |
| `Usage` / `MessageUpdated` | finalização | `1195-1200` / `1201-1206` |
| `TitleUpdated` | auto título | `1222-1230` |
| `Done` / `Cancelled` / `Error` | fecho | `1250-1268` |
| `Error` de credencial | `commands/turn.rs` via `CredentialError` | `commands/turn.rs:60-66` |

### A.5 Tools: definição, despacho, orçamento e limites

**Definições** — `pub fn definitions(options: &TurnOptions) -> Vec<ToolDefinition>` (`tools/mod.rs:67-93`): condicionais `web_search` (`69-71`), `fetch_url` (sempre, `72`), `create_file` (`73-75`), `run_code` (`76-78`); sempre-on `list_skills`/`read_skill` (`81-82`), `list_artifacts`/`read_artifact` (`88-89`), `validate_ui` (`91`). Ordem testada em `:231-271`. `ToolDefinition` = nome + descrição + JSON Schema (`providers/mod.rs:244-248`).

**Despacho** — `pub async fn execute(rt: &ToolRuntime, call: &ToolCallRecord) -> ToolOutcome` (`tools/mod.rs:95-128`): `match call.name` com gates de turno (`103-115`), sempre-on (`116-124`), fallback de erro (`125`); JSON parseado de `arguments` (`130-141`); corte em `MAX_TOOL_RESULT_CHARS = 120_000` (`22-23,143-149`).

**Runtime** — `ToolRuntime` (`tools/mod.rs:25-43`): `db`, `http`, `conversation_id`, `message_id`, `options`, `settings`, `cancel`, `data_dir`, `skills_roots`. **É aqui que um workspace entra** (§C.1). **Saída** — `ToolOutcome` (`:45-64`): `content` (modelo), `summary` (card), `citations`, `artifacts`, `is_error`.

**Limites no loop**: semáforo de 4 (`harness/mod.rs:32,1874-1886`), `MAX_STREAMED_TOOL_CALLS=64` (`34,547-549`), resultado para o modelo 24k (`48,976`), para a UI 8k (`45,934`), tool result ausente vira texto sintético (`1343,1449-1461`).

| Tool | Definição | Execução | Observação |
| --- | --- | --- | --- |
| `web_search` | `web_search.rs:52` | `run :80` | citações |
| `fetch_url` | `fetch_url.rs:73` | `run :96` | ~120k chars; bloqueia URL privada |
| `create_file` | `create_file.rs:15-44` | `run :46-88` | ≤10 MB (`:13`); writer de artefatos (`:64-72`) |
| `run_code` | `code_exec.rs:397-444` | `run :456` | ver A.5.1 |
| `list_skills`/`read_skill` | `skills.rs:721`/`:737` | `run_list :759`/`run_read :806` | catálogo `:311-374`; externas read-only |
| `list_artifacts`/`read_artifact` | `artifact_library.rs:108`/`:142` | `run_list`/`run_read` (não lidos — verificar) | escopo de usuário, paginação |
| `validate_ui` | `genui/mod.rs:393` | `run :421` | validação local |

#### A.5.1 `run_code` — o único executor (molde do shell)

- Schema `code_exec.rs:397-444`; gate duplo `settings.code_execution_enabled` (`464-469`) + `options.run_code` (`tools/mod.rs:76-78`, `harness/mod.rs:680`).
- Workspace efêmero `<data_dir>/code-runs/<uuid>/`, removido no `Drop` (`543-564`); `Command` com `current_dir`, stdout/stderr piped, `stdin(null)` e `CREATE_NO_WINDOW` no Windows (`608-621`).
- Timeout/cancel: `select!` entre `rt.cancel` e `timeout(child.wait())`, com `kill_process_tree` (`631-648`) — **é o molde para shell/terminal**.
- Ambiente: `env_clear` + remove `*API_KEY*/*TOKEN*/*SECRET*` (`751-769`); coleta de arquivos (profundidade 4) → artefatos (`846-950`); limites em `32-51`.
- **Sem streaming de stdout**: resultado só chega em `ToolCallFinished`.

### A.6 Histórico e `provider_state` v2

- `build_history` (`harness/mod.rs:1467-1543`): ignora o placeholder atual (`1480-1482`), anexa texto/imagens (`1734-1804`), assistente via `assistant_history_group` (`1554-1590`), corta grupos antigos por orçamento (`1514-1536`).
- **Replay v2**: `PROVIDER_STATE_VERSION=2` (`1340`); envelope `{version, steps:[{state,text,toolCallIds}]}` (`1349-1399`); reconstrução em `replay_steps_history` (`1595-1645`), só quando provedor+modelo coincidem (`1559-1570`). Formato em `docs/ARCHITECTURE.md:109`.
- Orçamento de contexto: `context_window*3` clamp `40_000..600_000` caracteres (`1677-1680`), incluindo `provider_state` (`1693-1697`). `debug_assert_tool_results_are_paired` (`1650-1675`) impede tool result órfão.

### A.7 `max_steps`, tools no último passo e resposta forçada

`MAX_STEPS_LIMIT=1_000`, `MAX_STEPS_DEFAULT=64` (`domain.rs:289-294`), clamp no harness (`681`) e no load (`config.rs:88`). Tools pedidas no último passo **executam** (`913-917`); sem texto final, roda a passada forçada (`991-995,1010-1111`), que usa `tools: Vec::new()` (`1031`). Falha dura de provider não dispara a passada (`1010`).

### A.8 Cancelamento, título, usage

- Cancelamento: `AppState.turns: Mutex<HashMap<String, CancellationToken>>` (`state.rs:32`), APIs `register/finish/cancel/cancel_all` (`196-221`); harness checa antes de cada passo (`785-788`) e após tools (`997-1000`); `run_stream_attempt` faz `select!` e aborta a task (`523-531,590-593`); mensagem parcial com `MessageStatus::Cancelled` (`1160-1161,1250-1251`). **Token único por turno** — sem cancelamento por tool.
- Título: `should_auto_title` (`1992-2001`) + `derive_title` heurístico (`2003-2059`, 48 chars + `…`). **Não há chamada ao modelo**, apesar de `docs/ARCHITECTURE.md:241` sugerir "modelo ou heurística" — estado real: só heurística (§F).
- Usage: `merge_usage` por passo (`1971-1990`), `duration_ms` (`1151-1152`), `total_tokens` derivado (`1153-1157`), persistido em `messages.usage` e `usage_log` (`1183-1193`, `db.rs:1201`).

### A.9 System prompt (`harness/prompt.rs`)

`build_system_prompt(model, options, settings, skills) -> String` (`prompt.rs:25-122`), por concatenação:

| Ordem | Seção | Linhas | Condição |
| --- | --- | --- | --- |
| 1 | Identidade, idioma pt-BR, estilo | `36-57` | sempre |
| 2 | `# Ferramentas` | `58,124-198` | itens por flag |
| 3 | `# Skills` + catálogo | `59,267-326` | sempre |
| 4 | `# Execução de código (run_code)` | `60-62,348-365` | só `options.run_code` |
| 5 | `# Citações e fontes` | `63-70` | sempre |
| 6 | `# Formatação Markdown` | `71,373-415` | sempre |
| 7 | `# UI generativa (blocos ui)` | `72,418-591` | gerada de `data/genui-contract.json` |
| 8 | `# Arquivos e artefatos` | `73-96` | sempre (parte com `run_code`) |
| 9 | `# Biblioteca de artefatos` | `96,208-259` | sempre |
| 10 | `# Anexos do usuário` + `# Segurança` | `97-114` | sempre |
| 11 | `# Instruções adicionais do usuário` | `116-120,604-620` | se `system_prompt` |

Ponto de extensão do harness: nova seção condicionada a novo campo de `TurnOptions`/`Settings`, no padrão de `code_execution_section`.

### A.10 Camada de provider e lacunas do loop

Tipos neutros e request em `providers/mod.rs:64-159,244-277`; streaming via `ProviderEvent` + `EventSink` (`:284-307`) e `ProviderError` tipado (`:425-463`); `ProviderStreamer` injetável para testes (`harness/mod.rs:66-68,605-615`).

**Lacunas** (detalhadas em §B): sem workspace/repo em disco, shell, git, aprovação de tool, plano persistido, MCP, subagentes, compactação por resumo, `@files`, slash commands, file watcher nem streaming de stdout.

---

## B. Capacidades existentes × o que um harness de código precisa

**EXISTE** = pronto/reutilizável · **PARCIAL** = base existe, falta peça · **FALTA** = não existe.

| Capacidade | Status | Onde está / o que falta |
| --- | --- | --- |
| Loop com passos e limite | **EXISTE** | `harness::run_turn` (`harness/mod.rs:622-1271`), `max_steps` 1..1000, passada forçada |
| Streaming incremental | **EXISTE** | `TurnEvent` + `Channel` (`events.rs`, `commands/turn.rs:11-17`) |
| Cancelamento | **EXISTE** | token por turno (`state.rs:196-221`); kill de árvore no `run_code` |
| Persistência de mensagens | **EXISTE** | SQLite (`db.rs:54-140`), replay v2 (`harness/mod.rs:1340-1439`) |
| Usage/tokens/custo | **EXISTE** | `usage_log` (`db.rs:118-131`), `record_usage` (`:1201`) |
| Título automático | **PARCIAL** | heurística local (`harness/mod.rs:2003-2059`); sem uso do modelo |
| Sessões no Code | **PARCIAL** | `mode/codeLinked` (`domain.rs:30-53`, `db.rs:55-69`); abas são estado local (`CodeSessionHeader.tsx:52-81`) |
| Workspace/repo em disco | **FALTA** | só `<app-data>/code-runs/<uuid>` efêmero (`code_exec.rs:543-564`) |
| Leitura de arquivos do workspace | **FALTA** | `read_artifact` lê `<app-data>/artifacts` (`artifact_library.rs:142`) |
| Escrita/edição no workspace | **FALTA** | `create_file` grava artefato, não path arbitrário (`create_file.rs:46-88`) |
| Árvore de arquivos | **FALTA** | `CodePanel` estado vazio (`CodePanel.tsx:218-224`) |
| Diff de alterações | **FALTA** | aba vazia + `+0 −0` fake (`CodePanel.tsx:188-204`) |
| Git status/diff/commit | **FALTA** | sem dep/plugin; Commit desabilitado (`CodePanel.tsx:195-203`) |
| Shell/terminal | **FALTA** | `run_code` roda script isolado (`code_exec.rs:572-737`) |
| Streaming de saída de processo | **FALTA** | resultado só no `ToolCallFinished` (`harness/mod.rs:929-938`) |
| Aprovação humana de tool | **FALTA** | só flags de settings (`harness/mod.rs:675-681`) |
| Plano/todo persistido | **FALTA** | `TraceStep` guarda reasoning+contagem (`domain.rs:176-186`) |
| Histórico/compactação | **PARCIAL** | descarte por orçamento (`harness/mod.rs:1514-1543,1677-1680`); sem resumo |
| Contexto de arquivos no prompt | **PARCIAL** | anexos extraídos (`harness/mod.rs:1734-1804`) + biblioteca via tools |
| Skills (instruções + scripts) | **EXISTE** | `tools/skills.rs`, prompt dinâmico, repositórios externos read-only |
| Execução Python/JS | **EXISTE** | `run_code` opt-in; interpretadores detectados (`code_exec.rs:305-390`) |
| MCP | **FALTA** | sem cliente; tools fixas (`tools/mod.rs:67-93`) |
| Subagentes | **FALTA** | loop único |
| `@files`/menções | **FALTA** | Composer sem parser (`Composer.tsx:25-139`) |
| Slash commands | **FALTA** | atalhos globais (`hotkeys.ts:33-41`) e paleta; composer não |
| Segurança de execução v1 | **PARCIAL** | env scrub + opt-in + timeout (`code_exec.rs:751-769`), sem sandbox (`docs/FILES.md:443-456`) |

---

## C. Pontos de extensão concretos e seguros

### C.1 Backend (Rust)

1. **Nova tool = 4 edições locais**: `definition()`+`run()` em `tools/<nome>.rs`; `pub mod` em `tools/mod.rs:13-20`; entrada em `definitions()` (`:67-93`); braço no `match` de `execute` (`:102-126`) + gate de flag se houver. Se retorna arquivos, preencher `ToolOutcome.artifacts` (`:45-54`) — o loop emite `ArtifactCreated` sozinho (`harness/mod.rs:939-946`).
2. **Novo campo em `ToolRuntime`** (`tools/mod.rs:25-43`): construído num único ponto de produção (`harness/mod.rs:755-765`) mas em **vários literais de teste** (`tools/mod.rs:285-298`, `create_file.rs:120-132`, `code_exec.rs:1028-1044`, …) — mecânico, risco baixo.
3. **Novo campo em `TurnOptions`** (`domain.rs:296-323`): o struct já tem `#[serde(default)]`; espelhar em `types.ts:250-259`, default em `domain.rs:311-323` e gate em `harness/mod.rs:675-681`.
4. **Nova variante em `TurnEvent`** (`events.rs:12-71`): adicionar **no fim**; o reducer ignora tipos desconhecidos (`chatStore.ts:511-512`). Campos opcionais com `#[serde(default)]`/`skip_serializing_if`.
5. **Novo comando Tauri**: `commands/<area>.rs` + `commands/mod.rs:4-11` + `lib.rs:49-98`; `Result<T,String>` (`AGENTS.md:60`); streaming no padrão `Channel<T>` (`commands/turn.rs:16`).
6. **Nova tabela/migração SQLite**: `SCHEMA` em `db.rs:54-140`; coluna nova via `ensure_column` (`db.rs:210-229`) e `migrate_*` chamado no `open` (`db.rs:670-706`). **Nunca renomear/remover coluna**; migração aditiva e idempotente (testes em `db.rs:1545+`).
7. **Novo estado global** (workspaces, terminais): `AppState` (`state.rs:23-33`) + `init` (`:35-54`); diretórios em `ensure_dirs` (`state.rs:225-233`, hoje `attachments, artifacts, logs, code-runs, skills`).
8. **Nova seção de prompt**: função no padrão de `code_execution_section` (`prompt.rs:348-365`) chamada em `build_system_prompt` (`:25-122`).
9. **Novo gate de settings**: `Settings` (`domain.rs:653-721`) + `normalize_settings` (`config.rs:85-129`) + `ToolsTab.tsx` + `save_settings` (`commands/settings.rs:55`). Precedente de default seguro: `code_execution_enabled = false`.
10. **Executor genérico** (maior alavancagem): extrair de `code_exec.rs` o bloco `spawn + select(timeout/cancel) + kill_process_tree + captura` (`:604-737`) para módulo compartilhado (ex.: `tools/exec.rs`), reusado por `run_code`, shell e git — extrair **sem mudar comportamento**, cobrindo com testes antes.

### C.2 Renderer (TypeScript/React)

1. **Contrato IPC**: `types.ts` + `api.ts` são **do Lead** (`AGENTS.md:26`) — pedir assinatura, não editar.
2. **Streaming/sessão**: `chatStore.ts` — switch de eventos (`:370-514`) e ações; `StreamingState` (`:24-32`) é lido por `Composer`, `ChatView` e `AgentSteps`: acrescentar campo é aditivo, renomear quebra.
3. **Layout do Code**: `uiStore.ts:80-148` + persistência (`:287-295`); novos estados (`activeWorkspaceId`, `terminalOpen`, …) moram aqui.
4. **Chrome**: `src/components/code/**` é `ui-code` (`AGENTS.md:32`): workspace chip em `CodeSessionHeader.tsx:183-197`, painel em `CodePanel.tsx`, lista em `CodeSidebar.tsx:207-221`.
5. **Timeline/cards**: ícones `AgentSteps.tsx:46-56`; agrupamento/labels `agentTrace.ts:51-110` (`pushToolGroups` — não lido, verificar). Tool nova precisa de ícone/label; senão degrada.
6. **Composer**: parser de `@files`/slash entra antes de `submit()` (`Composer.tsx:96-103`); não há componente de menção hoje.
7. **Paleta**: catálogo único `usePaletteActions.ts:240-595`, comandos por layout em `:399-482`; regra "nunca beco sem saída" (`:1-6`).
8. **Hotkeys**: `hotkeys.ts:79-109` + `HotkeyCommand` (`:33-41`) + `App.tsx:43-85`.
9. **Ações/superfícies**: `App.tsx:227-251` monta por modo; `WorkspaceCenter` (`:20-64`) mantém `ChatView` único (`:52`). Superfície central nova (terminal/editor) = novo `codeView` (`uiStore.ts:26`) + ramo em `WorkspaceCenter` (como Skills em `:55-60`).

### C.3 Contratos que **não** podem mudar (sem decisão explícita do Lead)

| Contrato | Por quê |
| --- | --- |
| Nomes/tags dos `TurnEvent` existentes | reducer e testes (`chatStore.ts:370-514`, `types.ts:280-302`) |
| camelCase dos DTOs IPC | `AGENTS.md:63`; testes de contrato (`domain.rs:1053-1130`) |
| Formato do `provider_state` v2 | replay do turno seguinte (`harness/mod.rs:1340-1439`, `ARCHITECTURE.md:109`) |
| Semântica dos nomes de tools existentes | prompt (`prompt.rs:124-198`), testes (`tools/mod.rs:231-271`), UI (`AgentSteps.tsx:46-56`) |
| `mode` imutável após criação | `chat-code-sessions/PLAN.md:12`; `db.rs:785-789` |
| Migrações aditivas de `conversations` | bancos legados (`db.rs:305-322`, `ARCHITECTURE.md:100-107`) |
| `provider_state` fora do IPC | `skip_serializing` (`domain.rs:218-219`) + teste (`:881-898`) |
| Filtro de layout num único arquivo | `conversations.ts:15-57` (`PLAN.md:28-37`) |
| `ChatView` único e montado | `PLAN.md:204`, `WorkspaceCenter.tsx:8-18` |
| Limites de tool result (120k/24k/8k) | comportamento de contexto (`harness/mod.rs:45-48`) |
| Tokens de tema, sem hex | `AGENTS.md:54` |

---

## D. Arquivos que um harness de código tocaria (por área de ownership)

> Ownership: `AGENTS.md:24-33`. **N** = novo · **A** = alterar · **L** = leitura/contrato. Arquivos do Lead são proibidos às outras áreas (`AGENTS.md:35`).

### D.1 Lead — contratos compartilhados

| Arquivo | Impacto | O que muda |
| --- | --- | --- |
| `src-tauri/src/domain.rs` | **A** | tipos novos (`Workspace`, `FileEntry`, `DiffHunk`, `ApprovalRequest`), campos em `TurnOptions`/`Settings` |
| `src-tauri/src/events.rs` | **A** | variantes (`FileChanged`, `ApprovalRequested`, `ProcessOutput`, `WorkspaceUpdated`) |
| `src-tauri/src/state.rs` | **A** | registro de workspaces/processos por app |
| `src-tauri/src/lib.rs` / `commands/mod.rs` | **A** | registrar `commands::{workspace,git,code}` |
| `src-tauri/src/commands/{turn,models}.rs` | **L/A** | `turn.rs` se `TurnPayload` mudar |
| `src-tauri/Cargo.toml` | **A** | deps novas (git; talvez `ignore`/`walkdir`) |
| `src/lib/types.ts` + `src/lib/api.ts` | **A** | espelho dos DTOs/comandos novos |
| `src/lib/store/**` | **A** | `chatStore` (sessão/streaming), `uiStore` (workspace/terminal), `appStore` (settings) |
| `src/lib/conversations.ts` | **L** | visibilidade por layout continua fonte única |
| `src/App.tsx` | **A** | montagem de painéis/superfícies por modo |
| `data/catalog.json`, `scripts/**` | **L** | sem mudança esperada |
| `docs/**` | **A** | ARCHITECTURE/FILES/DESIGN + goal novo |

### D.2 harness-dev — harness/tools

| Arquivo | Impacto | O que muda |
| --- | --- | --- |
| `harness/mod.rs` | **A** | gates (`675-681`), `ToolRuntime` (`755-765`), definições, eventual 2º loop |
| `harness/prompt.rs` | **A** | seções `# Workspace`/`# Shell`/`# Git` + segurança |
| `tools/mod.rs` | **A** | `definitions`/`execute` + `ToolRuntime.workspace` |
| `tools/code_exec.rs` | **A** | extrair executor; usar workspace real |
| `tools/create_file.rs` | **A/L** | distinguir artefato de arquivo do workspace |
| **novos** `tools/{fs_read,fs_write,fs_list,fs_search,shell,git_*}.rs` | **N** | tools do harness |
| `tools/artifacts.rs`, `documents/**`, `tools/skills.rs`, `tools/genui/**` | **L** | reuso (writer, extração de texto, skills) |

### D.3 storage-dev — persistência/config/commands

| Arquivo | Impacto | O que muda |
| --- | --- | --- |
| `db.rs` | **A** | tabelas `workspaces`, `approvals`, `file_snapshots`/`edits`, `terminal_logs`; migrações aditivas |
| `config.rs` | **A** | paths (`workspaces/`), settings novos normalizados |
| `commands/conversations.rs` / `settings.rs` | **L/A** | vínculo sessão↔workspace; status de ambiente |
| **novos** `commands/{workspace,git,code}.rs` | **N** | CRUD, status/diff/commit, abrir no explorer |
| `capabilities/default.json` / `tauri.conf.json` | **A/L** | se usar plugin oficial; CSP hoje `null` (§E) |
| `state.rs` | **A** | (coordenar com Lead) registro em memória |

### D.4 ui-code — Code workbench

| Arquivo | Impacto | O que muda |
| --- | --- | --- |
| `CodePanel.tsx` | **A** | árvore, diff, lista de alterações, Commit |
| `CodeSessionHeader.tsx` | **A** | workspace real + troca |
| `CodeSidebar.tsx` | **A** | Workspaces real (abrir/criar/remover) |
| `CodeWelcomeScreen.tsx` | **A/L** | copy quando houver workspace |
| `AddChatSessionDialog.tsx` | **L** | sem mudança esperada |
| **novos** `code/{FileTree,ChangeList,DiffView,WorkspacePicker,CommitBar}.tsx` + `index.ts` | **N/A** | peças do workbench |

### D.5 ui-core — UI núcleo

| Arquivo | Impacto | O que muda |
| --- | --- | --- |
| `composer/Composer.tsx` | **A** | `@files`, slash, chip de workspace, aprovação inline |
| `chat/AgentSteps.tsx` | **A** | ícones/labels das tools novas (`:46-56`) |
| `chat/MessageItem.tsx`, `chat/ChatView.tsx` | **A/L** | blocos novos (diff, aprovação); welcome |
| `lib/agentTrace.ts` | **A** | agrupamento/labels |
| `layout/WorkspaceCenter.tsx` | **A** | novo `codeView`/superfície central |
| `layout/AppShell.tsx` | **L** | já aceita sidebar/right panel por slot (`:11-33`) |

### D.6 ui-systems — UI de sistemas

| Arquivo | Impacto | O que muda |
| --- | --- | --- |
| `settings/ToolsTab.tsx` | **A** | settings de workspace/harness/aprovação |
| `palette/usePaletteActions.ts` | **A** | comandos de harness por layout |
| `artifacts/ArtifactPreview.tsx` + previews | **L/A** | reuso para visualizar arquivo fora do "artefato" |
| `skills/SkillsView.tsx`, `models/**` | **L** | inalterados |

### D.7 formats-dev — skills embutidas

`src-tauri/skills/**`: **L** hoje (pode ganhar skills de código, mas o harness não depende disso).

### D.8 Ordem de dependência sugerida

1. Lead: contratos (`domain/events/types/api`) + `state.rs` + nomes/registro de comandos + tabelas (com storage-dev).
2. harness-dev: executor extraído + tools de FS/shell.
3. storage-dev: comandos + persistência.
4. ui-code: painel/árvore/diff.
5. ui-core/ui-systems: composer, cards, paleta, settings.
6. Lead: integração final + `cargo test --lib`, `pnpm test`, `pnpm typecheck`, `pnpm build`.

---

## E. Riscos técnicos específicos do código atual

### E.1 Plataforma/arquitetura

| # | Risco | Evidência | Mitigação |
| --- | --- | --- | --- |
| R1 | **Harness acoplado a conversa**: não há entidade de workspace/sessão; tudo pende de `conversation_id`. | `harness/mod.rs:639-641`, `tools/mod.rs:31` | `workspace_id` como dimensão opcional; `conversation_id` continua obrigatório |
| R2 | **Sem plugin de fs**: renderer não lê disco; tudo passa por comandos. | `Cargo.toml:16-21`, `capabilities/default.json` | Backend dono da árvore/diff; renderer só recebe DTOs |
| R3 | **Sem plugin de shell**: usar plugin muda capability/segurança; fazer próprio = `std::process::Command` como `run_code`. | idem | Recomendo executor próprio (reuso de `code_exec`) |
| R4 | **CSP está `null`**, mas `ARCHITECTURE.md:555` diz "CSP restritiva em produção". | `src-tauri/tauri.conf.json` (`app.security.csp: null`) | Verificar com o Lead antes de expor HTML de arquivo |
| R5 | **Windows first**: kill de árvore, `CREATE_NO_WINDOW`, `cmd.exe`, caminhos. | `code_exec.rs:620-648`, `docs/FILES.md:434` | Centralizar executor e testar Windows |
| R6 | **`run_code` não é sandbox**; shell/git amplificam risco. | `code_exec.rs:1-5`, `FILES.md:443-456` | Aprovação por tool + allowlist + auditoria; default opt-in |
| R7 | **SSE/Channel**: execução longa não tem progresso incremental. | `events.rs`, `harness/mod.rs:509-602` | Evento `ProcessOutput` com throttle ou canal por terminal |
| R8 | **SQLite/migração**: 3 migrações anteriores; quebra usuários se não aditiva. | `db.rs:255-322`, testes `db.rs:1545+` | Só `ensure_column`/`CREATE TABLE IF NOT EXISTS` |
| R9 | **Contexto por caracteres**, não tokens; corte descarta histórico sem resumir. | `harness/mod.rs:1677-1680,1514-1543` | Leitura paginada de arquivos (padrão `read_artifact`) + budget explícito |
| R10 | **Replay v2 frágil**: cada passo vira assistant + tool result; saída não-textual precisa ir como texto. | `harness/mod.rs:1340-1439,1595-1645` | Serializar toda saída como texto truncado; nunca pular result |
| R11 | **Tool result sem streaming e capado**: shell grande corta em 24k (modelo) e 8k (UI). | `harness/mod.rs:45-48` | Evento paginado para UI; resumo + offset para o modelo |
| R12 | **`ChatView` único**: novas superfícies convivem sem desmontá-lo. | `WorkspaceCenter.tsx:8-18,46-53` | Novo `codeView` com wrapper estável (como Skills) |
| R13 | **Tools hardcoded na timeline**; desconhecida degrada. | `AgentSteps.tsx:46-56`, `agentTrace.ts:51-110` | Entradas + fallback garantido |
| R14 | **Abas do Code são estado local**: perdem-se ao alternar layout. | `CodeSessionHeader.tsx:52-81`, `PLAN.md:241` | Persistir em `uiStore`/SQLite se o harness exigir |
| R15 | **Cancelamento único por turno**: sem parar só a tool. | `state.rs:196-221` | Token filho por tool/processo |
| R16 | **Título heurístico** fica ruim para tarefas de código. | `harness/mod.rs:1992-2059` | Decidir heurística vs. modelo (§F) |
| R17 | **Sem gates de aprovação**; só categorias on/off. | `harness/mod.rs:675-681` | Aprovação por tool/comando/path + "sempre permitir" |
| R18 | **Settings por app**, não por workspace. | `config.rs:44-48,131-146` | Config de workspace no DB/JSON do workspace |

### E.2 Produto/UX

| # | Risco | Evidência |
| --- | --- | --- |
| P1 | Estados vazios do Code são **honestos e testados**; substituir por mock quebra testes que proíbem ação falsa. | `CodeSidebar.test.tsx:250-261`, `CodePanel.test.tsx:89-116` |
| P2 | A UI já promete workspace: "Sem workspace" em 3 lugares + Commit desabilitado. | `CodeSessionHeader.tsx:193`, `CodePanel.tsx:185,195-203`, `CodeSidebar.tsx:218` |
| P3 | Paleta "nunca oferece beco sem saída": comandos de workspace só quando existir workspace. | `usePaletteActions.ts:1-6,399-482` |

---

## F. Lacunas e ambiguidades que o Lead precisa decidir

> Cada item: **decisão** → opções → recomendação do analista. São as perguntas que mudam o plano.

### F.1 Escopo

1. **Uma fase ou duas?** (A) fase 1 = workspace + árvore + leitura/escrita seguras; fase 2 = shell/git/diff/commit. (B) tudo junto. **Recomendo A** — o chrome já existe; shell/git concentram risco e decisões.
2. **Mesmo `run_turn` ou loop novo?** (A) tools novas no loop atual (reuso máximo). (B) `run_*` próprio. **Recomendo A no início**; B só se precisar de processo persistente/terminal interativo.
3. **Workspace ↔ sessão:** (A) 1 workspace ↔ N sessões (`workspace_id` na conversa). (B) 1:1. **Recomendo A** (conceito "Workspaces" já desenhado na sidebar do Code).
4. **Onde mora o workspace?** Pasta escolhida pelo usuário vs. `<app-data>/workspaces/`. **Recomendo pasta do usuário** (`tauri-plugin-dialog` já habilitado em `capabilities/default.json`).

### F.2 Dados e contrato

5. **`Workspace` vira tipo de domínio/IPC?** Mínimo: `id, name, path, created_at, last_opened_at, git_branch?`; espelhar em `types.ts`/`api.ts` e criar comandos CRUD (hoje não há nenhum tipo de projeto/pasta em `domain.rs`).
6. **Associação sessão↔workspace:** campo em `Conversation` (`workspaceId`) vs. tabela. **Recomendo campo** (migração mais simples, `list_conversations` já entrega tudo).
7. **Eventos novos:** `TurnEvent` vs. canal separado. **Recomendo** `TurnEvent` para diff/aprovação e canal próprio para terminal (`terminal_input/output`).
8. **Aprovações:** efêmeras vs. tabela auditável. **Recomendo tabela** (`approvals(id, conversation_id, tool, args_hash, decision, created_at)`).
9. **Undo/snapshot:** sem isso não há "desfazer". **Recomendo** guardar baseline do arquivo antes da 1ª escrita da sessão (`<app-data>/snapshots/` ou conteúdo no DB).

### F.3 Execução e segurança

10. **Executor próprio vs. `tauri-plugin-shell`.** **Recomendo próprio** (reuso de `code_exec`, sem nova capability), com allowlist de binários.
11. **Modelo de aprovação:** (a) por tool, (b) por comando, (c) por path, (d) por sessão. **Recomendo** (b)+(c) com "sempre permitir nesta sessão", deny por default para shell/git write, leitura livre dentro do workspace.
12. **`run_code` muda de semântica?** Hoje é deliverable/artefato opt-in. **Recomendo manter** e criar `run_command` (shell) separado — não quebrar prompt/testes/`FILES.md §8`.
13. **Git:** lib `git2` vs. `git.exe` via executor vs. ler `.git`. **Recomendo `git.exe` via executor** no início (zero dep pesada, comportamento do git do usuário), com fallback amigável; `git2` como otimização futura.
14. **Limites de processo** e o que vai ao modelo vs. UI. **Recomendo** 24k ao modelo (padrão), UI por evento paginado, teto backend 1–2 MB por execução.
15. **Escopo de path:** canonicalizar, bloquear `..`/symlink e garantir `starts_with(workspace)`. **Recomendo allowlist só dentro do workspace** na fase 1.

### F.4 UI/UX

16. **Terminal:** painel direito (aba), centro (`codeView`) ou drawer inferior? **Recomendo centro** (`WorkspaceCenter` já alterna superfícies) + atalho.
17. **Editor de arquivo:** read-only reusando `CodePreview` ou edição no app? **Recomendo read-only primeiro**; edição via tool, "abrir externo" via `opener`.
18. **Aprovação na UI:** banner no composer vs. card na timeline. **Recomendo card na timeline** (`AgentSteps`) + CTA no composer.
19. **Sessão sem workspace:** oferecer "pasta temporária" com aviso ou exigir abrir pasta? **Recomendo exigir workspace** no Code (modelo Paseo), com empty state acionável.
20. **"Alterações" mostra o quê?** (a) diff git do working tree, (b) edições do agente na sessão, (c) ambos. **Recomendo (c)** com origem marcada.
21. **Vários workspaces abertos?** Sidebar já tem a seção, mas o app tem uma conversa ativa. **Recomendo** lista de abertos (estado global) com 1 ativo por vez.

### F.5 Operação e testes

22. **Critérios de pronto e TDD por área:** backend com `ProviderStreamer` falso (`harness/mod.rs:66-68`) e `ToolRuntime` temporário (`tools/mod.rs:285-298`); renderer com mock de `@/lib/api` (`AGENTS.md:42`); verificação `cargo test --lib` + `pnpm test/typecheck/build`.
23. **Migração de dados/onboarding:** usuários existentes começam sem workspace; definir CTA ("Abrir pasta") e copy.
24. **Documentação:** atualizar `ARCHITECTURE` (§4/§8/§12/§16), `DESIGN` (§5 Code), `FILES` (tools/§6.2/§6.3/segurança §8.3), `AGENTS.md` (se houver área nova) e criar `docs/goals/<harness>/{GOAL,PLAN}.md` (padrão dos goals anteriores).

---

## Apêndice 1 — âncoras principais

| Assunto | Âncora |
| --- | --- |
| `run_turn` backend | `src-tauri/src/harness/mod.rs:622` |
| Loop / passada final | `harness/mod.rs:784-1001` / `:1010-1111` |
| Histórico + replay v2 | `harness/mod.rs:1467` / `:1340-1439` |
| Tools em paralelo | `harness/mod.rs:1874-1886` |
| System prompt | `harness/prompt.rs:25` |
| `ToolRuntime` / despacho | `tools/mod.rs:25` / `:95` |
| `run_code` | `tools/code_exec.rs:397-737` |
| Writer de artefatos | `tools/artifacts.rs:135` |
| Eventos / comando do turno | `events.rs:12` / `commands/turn.rs:11` |
| `AppState` + tokens | `state.rs:23,196` |
| Schema/migrações | `db.rs:54,255-322` |
| Settings/paths | `config.rs:35-146` |
| Registro de comandos | `lib.rs:49-98` |
| Contrato TS de eventos | `types.ts:280-302` |
| `api.runTurn` | `api.ts:138-142` |
| Reducer de streaming | `chatStore.ts:370-514` |
| Layout Code (estado) | `uiStore.ts:80-148` |
| Composição por modo | `App.tsx:227-251` / `WorkspaceCenter.tsx:46-53` |
| Painel/header/sidebar Code | `CodePanel.tsx:55-241` / `CodeSessionHeader.tsx:36-294` / `CodeSidebar.tsx:107-300` |
| Composer | `Composer.tsx:96-139,186-259` |
| Timeline de tools | `AgentSteps.tsx:46-135`, `agentTrace.ts:51-110` |
| Paleta / hotkeys | `usePaletteActions.ts:240-595` / `hotkeys.ts:33-109` |

## Apêndice 2 — checagens rápidas antes de planejar código

```bash
# 1) Confirmar que não há harness escondido
grep -rn "workspace\|git\|terminal\|mcp\|approval" src-tauri/src --include=*.rs | grep -vi "test\|prompt\|compact"
# 2) Pontos de extensão de tools
grep -n "pub fn definitions\|pub async fn execute\|pub struct ToolRuntime" src-tauri/src/tools/mod.rs
# 3) Contrato de eventos
grep -n "enum TurnEvent" -A 60 src-tauri/src/events.rs
# 4) Schema/migrações e comandos
grep -n "CREATE TABLE\|ALTER TABLE\|migrate_" src-tauri/src/db.rs; grep -n "commands::" src-tauri/src/lib.rs
# 5) Verificação final
cd src-tauri && cargo test --lib; cd .. && pnpm test && pnpm typecheck && pnpm build
```

---

*Fim do mapa. Nenhum arquivo de código foi modificado; este documento é o único artefato produzido (escopo: `docs/research/lumina-harness-integration-map.md`).*
