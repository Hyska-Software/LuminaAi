# Evidência — sistema de Goal (layout Code)

> Preenchido pelo **qa-verifier** durante a F4 (QA independente, read-only no
> código; o único arquivo escrito foi este). Registra comandos, números, achados
> e riscos residuais. Sem automação de navegador/screenshot como critério
> (AGENTS.md).
>
> - **Base**: `df8e301` (`feat/code-harness`) + working tree **não commitado**.
> - **F4 validada em**: 2026-10-29 ~22:10–22:22 (America/Sao_Paulo), código de
>   22:04, parecer **ajustes necessários** (1 alto + 2 médios + baixos, §6).
> - **F4.1 (revalidação) em**: 2026-10-29 ~22:35–22:43 (America/Sao_Paulo),
>   código de 22:34, parecer final **APROVADO** (§9–§10) — ALTO/MT1/MT2
>   corrigidos e revalidados; baixos remanescentes aceitos/documentados.
> - **F4.2 (v1.12: `/goal` + botão somente ícone + adendo do rename)** em
>   2026-10-29 ~23:14–23:47 (America/Sao_Paulo), código de 23:21; 5 suítes
>   verdes; parecer **APROVADO com ressalvas** (§11) — 1 médio de UX no CTA do
>   painel, baixos documentados; nenhuma regressão e nenhum bloqueador.
> - **Não houve commit** (por instrução do pedido). QA não alterou código; único
>   arquivo escrito por este papel: este `EVIDENCE.md`.

## 1. Fases

| Fase | Dono | Status | Evidência |
| --- | --- | --- | --- |
| F0 — contratos | Lead | concluída (verificada) | `domain.rs` (`TurnKind`, `GoalView/GoalRound/GoalContinuation/CreateGoalInput/UpdateGoalInput/GoalAction`, `TurnPayload.turn_kind`, `ChatMessage.origin`, `CodeSessionState.goal`), `events.rs` (`GoalUpdated`), `state.rs` (`TurnRegistry`), `lib.rs` (4 comandos registrados), `types.ts`/`api.ts`/`uiStore.ts`; `cargo check` e `pnpm typecheck` verdes |
| F1a — db (`messages.origin`) | storage-dev | concluída (verificada) | `db.rs:798-811` (migração aditiva `ensure_column`), `db.rs:951-964` (slug `user|goal_round`), `db.rs:2208-2255` (`list_code_events_by_kinds`); testes `db::tests::migrates_legacy_messages_with_origin_defaulting_to_user`, `messages_roundtrip_the_origin_turn_kind`, `lists_code_events_by_kind_ordered_and_limited` |
| F1b — goal core/harness/tool | harness-dev | concluída (verificada) | `harness/code/goal.rs` (fold/mutações/begin/finish/preflight/prompt; 21 testes), integração no `harness/mod.rs` (5 testes goal_round), `harness/code/prompt.rs`/`context.rs` (contexto volátil), `tools/code/goal.rs` + registry 24 tools + `tools::code::exec` (12 testes) |
| F1c — comandos IPC | code-runtime-dev | concluída (verificada) | `commands/code.rs:992-1334` (`create_goal`, `update_goal`, `list_goal_rounds`, `goal_can_continue`, `project_goal`/degradação, rename placeholder) + registro em `lib.rs:132-136`; 14 testes em `commands::code::tests` |
| F2 — stores/driver | Lead | concluída (verificada) | `src/lib/goalRunner.ts` (15 testes), `codeStore` (goal/rounds/dismiss/goalStarting/CAS), `chatStore` (`runGoalRound`/`maybeContinueGoal`/`stop`/`streaming.turnKind`; +5 testes), `agentTrace` labels |
| F3a — cards | ui-agent | concluída (verificada) | `GoalCard.tsx` (17 testes), `GoalAttentionCard.tsx` (11), `ToolPresentationCard` (`kind:'goal'`, 19 no arquivo) |
| F3b — composer/chat/centro | ui-core | concluída (verificada) | `GoalControls.tsx` (11 testes) no `CodeSessionControls`, `/goal` (`commands.ts` + `Composer.tsx`), `GoalRoundDivider`/`MessageItem` (5 testes), `WorkspaceCenter` (goal view/dialog) |
| F3c — superfícies Code | ui-code | concluída (verificada) | `GoalDialog.tsx` (14 testes), `GoalPanel.tsx` (16), badge/aba em `CodeSessionHeader`, `GoalAttentionCard` no `CodeSessionCards` |
| F4 — QA | qa-verifier | concluída (parecer: ajustes) | §2–§7 deste arquivo: 5 suítes verdes, revisão adversarial, 1 alto + 2 médios + 12 baixos |
| F4.1 — correções + revalidação | Lead (fix) / qa-verifier (QA) | **concluída — aprovada** | §9–§10: ALTO/MT1/MT2/BAIXOs corrigidos; 5 suítes verdes (`989/0/13` Rust, `127/2355` TS); sem regressões |
| F4.2 — fluxo `/goal` (v1.12) + adendo | Lead (fix) / qa-verifier (QA) | **concluída — aprovada com ressalvas** | §11: `/goal` de preenchimento (agente cria via tool), botão somente ícone acessível, `auto_continue` default true/false explícito, rename do placeholder em `goal::create`; 5 suítes verdes (`991/0/13` Rust, `127/2354` TS); 1 médio de UX + baixos |
| F5 — docs/final | Lead | concluída pelo Lead (não reverificada pelo QA) | `ARCHITECTURE`/`HARNESS`/`TOOLS`/`WORKBENCH` + resultado no `PLAN.md`; resíduos do fluxo antigo em §12.2/§10.1/§10.8/§10.10 do PLAN e `PLAN` §8.4 cita rename só no `create_goal` (§11.4) |

## 2. Comandos de verificação (executados)

Executados no working tree acima, na ordem abaixo, sem concorrência entre as
suítes Rust e TS. Saídas integrais preservadas nos logs da sessão de QA
(`%TEMP%\qa-*.log`); resumo:

| Comando | Exit | Números | Observações |
| --- | --- | --- | --- |
| `cd src-tauri && cargo check` | **0** | `Finished dev profile … in 1.10s` | **85 warnings** (11 novos na área goal — dead code, §6); nenhum erro |
| `cd src-tauri && cargo test --lib` | **0** | `988 passed; 0 failed; 13 ignored; 0 measured; 0 filtered out; finished in 27.06s` | 44 testes com `goal` no nome passaram (ex.: `harness::code::goal::tests::*` 21, `harness::agent_loop_tests::goal_round_*` 4, `tools::code::exec::tests::goal_*` 4, `commands::code::tests::*goal*` 8) + `db::tests::*origin*`/`lists_code_events_by_kind_ordered_and_limited` + `state::tests::turn_registry_*` |
| `pnpm typecheck` | **0** | `tsc --noEmit`, sem saída | strict ligado |
| `pnpm test` | **0** | `Test Files 127 passed (127)` · `Tests 2354 passed (2354)` · `158.34s` | nenhum teste pulado/falhado; só os avisos de ambiente jsdom do Vitest |
| `pnpm build` | **0** | `tsc --noEmit && vite build` · `✓ built in 6.49s` | warning de chunk > 1500 kB é pré-existente (mermaid/elk), não bloqueia |
| `pnpm exec vitest run` (8 arquivos goal: `goalRunner`, `GoalCard`, `GoalAttentionCard`, `GoalDialog`, `GoalPanel`, `GoalControls`, `MessageItem`, `ToolPresentationCard`) | **0** | `8 passed`, **108 tests passed** | reexecução focada às 22:22, após a suíte completa |

Artefatos: `dist/` e `src-tauri/target/` são ignorados pelo git; **nenhum
artefato gerado entrou no working tree** por esta validação. `git status` tem
**59 tracked modificados + 24 entradas não rastreadas**: 16 arquivos novos da
feature + `docs/goals/code-goals/` (3 docs) + **7 JSONs e demais alterações do
goal anterior de prompt-cache** (pré-existentes, ver §7).

## 3. Números baseline (antes da implementação)

- **Não medido nesta fase**: o working tree é único e sem commit, contendo
  F0–F3 aplicadas e alterações não commitadas do goal anterior de prompt-cache;
  não existe árvore "antes do Goal" reproduzível sem `git stash` (proibido para
  QA read-only). A referência do Lead para o estado final era **Rust 988
  passed / 0 failed / 13 ignored** e **TS 127 files / 2354 tests** — observado
  **exatamente**. (O `EVIDENCE.md` do goal de prompt-cache registra 900
  passed/10 ignored e 2194 testes em um checkpoint intermediário anterior, mas o
  código mudou depois; não é uma baseline comparável.)
- Testes novos/relacionados ao Goal: **~67 funções Rust** (goal 21, exec tool 12,
  commands 14, prompt 7, harness 5, db 3, spec tool 2, context 1, TurnRegistry 2)
  e **89 casos TS em 7 arquivos novos** (`GoalCard` 17, `GoalPanel` 16,
  `goalRunner` 15, `GoalDialog` 14, `GoalAttentionCard` 11, `GoalControls` 11,
  `MessageItem` 5) + adições em `ToolPresentationCard`/`CodeSessionHeader`/
  `CodeSessionCards`/`Composer.code`/`CodeSessionControls`/`WorkspaceCenter`/
  `agentTrace`/`chatStore`/`codeStore`.

## 4. Resultado por critério de aceite (§1.3 do PLAN)

| # | Critério | Resultado | Evidência |
| --- | --- | --- | --- |
| 1 | Criar pela UI persiste (`code_events` + snapshot), sobrevive a reload, renomeia placeholder | **OK** | `goal::create` grava `goal/state` (`harness/code/goal.rs:586-649`); fold `current` (`:202-212`); rename `commands/code.rs:1100-1110` com `should_auto_title`; testes `create_goal_renames_only_a_placeholder_conversation_title`, `create_fold_delete_and_recreate_continue_the_revision`, `roundtrip_the_origin`/migração db. (Baixo: o rename não é propagado ao renderer até o próximo refresh — §6 #7) |
| 2 | "Criar e começar" inicia rodada 1 com `turnKind=goal_round`, origem, contexto e tool | **OK** | `harness::agent_loop_tests::goal_round_opens_persists_and_closes_the_round`: valida/abre antes de persistir (`harness/mod.rs:1473-1538`), `origin` persistido (`:2911`), `## Objective` no runtime (`:10700-10714`), tool `goal` no wire, `goal_updated` no início/fim; `chatStore` payload `turnKind/content:''/profile:'code'` testado |
| 3 | No máximo uma rodada após `done`, só com as condições da §7.6 | **OK (com ressalva baixa)** | `goalRunner` (matriz de 10 casos), `chatStore.done → refresh → maybeContinueGoal` (`:560-569`) com revalidação pós-await (`:1341-1344`); `runGoalRound` guarda `streaming`/`goalStarting`; backend `GOAL_BUSY` (`commands/turn.rs:21-27`) + preflight §7.4. Ressalva: janela TOCTOU check→register (§6 #9) |
| 4 | `goal(complete)` encerra; `blocked` só após 3 motivos; 3 rodadas sem progresso pausam | **OK** | `finish_round_pauses_on_error_cancel_and_max_rounds`, `three_rounds_without_progress_pause_stalled_and_progress_resets`, `finish_round_marks_progress_from_file_journal`, `report_blocker_streaks_and_blocks_on_the_third_same_reason`, `goal_create_only_in_human_turn_and_com_apresentacao_flat` |
| 5 | Erro/cancel pausa; limite pausa; crash/reload degrada para `interrupted` sem contar rodada duas vezes | **PARCIAL — achado alto** | Pausas OK (`goal_round_pauses_on_error_and_cancel`); degradação read-only OK (`project_goal_degrades_an_orphan_round_without_writing`); a órfã é fechada por `begin_round` sem recontar (`begin_round_reconciles_an_orphan_round_as_interrupted`). **Porém o caminho de recuperação "Retomar" após crash não destrava** (log `active` + órfã → degrade em leitura → `resume` no-op → loop): ver §6 #1 |
| 6 | Pausar/retomar/reabrir/editar/concluir/encerrar com CAS e snapshot autoritativo | **OK** | `update_applies_cas_and_dispatches_actions` (GOAL_STALE_REVISION, idempotência), `update_goal_applies_cas_and_is_idempotent_on_the_target_state`, `pause_resume_complete_reopen_and_idempotency`; UI trata stale com refresh+toast (`codeStore.ts:560-577`) |
| 7 | System prompt/tools estáveis entre rodadas; contexto volátil carrega o objetivo | **OK** | `harness::agent_loop_tests::goal_round_opens_persists_and_closes_the_round`: system prompt idêntico entre steps e entre rodadas 1/2, `tools_json` idêntico, `## Objective`/objetivo/nota **fora** do system prompt, surface item user com objetivo; `prompt::tests::stable_prompt_is_identical_for_the_same_session`; `human_turn_objective_uses_the_context_wording` |
| 8 | UI acessível, pt-BR, tokens; sem automação de navegador | **OK com ressalvas baixas** | Roles/`aria-label`/`aria-busy`/`aria-expanded`/`Esc`/teclado testados (`GoalControls.test` 130-153, `GoalDialog.test` 149/172/307/330, header/cards); **zero hex solto** nos componentes novos (todos os tokens existem em `globals.css`); textos pt-BR; gaps baixos: `aria-live` de início de rodada, reduced-motion no badge, card `completed` sem Reabrir/Novo (§6 #3/#12) |
| 9 | `cargo check`, `cargo test --lib`, `pnpm typecheck`, `pnpm test`, `pnpm build` verdes; docs + EVIDENCE | **PARCIAL** | 5 comandos **verdes** (§2); este EVIDENCE preenchido; **F5 (docs)** em andamento pelo Lead durante a F4 — não verificado aqui |

## 5. Revisão adversarial (contratos, persistência, rodada, driver, UI, segurança)

### 5.1 Contratos e IPC — sem achados

- **Rust↔TS**: `GoalView`/`GoalRound`/`GoalContinuation`/`CreateGoalInput`/
  `UpdateGoalInput`/`GoalAction` (`domain.rs:1582-1728`) espelham
  `types.ts:333-413` (camelCase + `snake_case` para enums; `#[serde(default)]`
  nos opcionais). `TurnPayload.turnKind`, `ChatMessage.origin`,
  `CodeSessionState.goal`, `TurnEvent::GoalUpdated` presentes nas duas pontas.
- **Comandos IPC**: os 4 comandos registrados em `lib.rs:132-136` com assinaturas
  `conversation_id`/`action`/`input`/`expected_revision`/`limit`/`auto` batem
  byte a byte com `api.ts:227-245` (`conversationId`, `action`, `input`,
  `expectedRevision`, `limit`, `auto`). `[tauri::command]` + serde camelCase
  seguem o padrão das demais commands do repo.
- **Evento** `goal_updated` (`events.rs:115-119`) chega ao `codeStore` via
  `isCodeEvent`/`applyCodeEvent` (`codeStore.ts:163-176,214-233`) e é o mesmo
  caminho dos demais eventos de código (`chatStore.ts:425-428`).
- **Tool presentation** flat `{kind:'goal', ...GoalView}` (`exec.rs:2311-2321`)
  com normalização defensiva de payload real/legado/malformado
  (`ToolPresentationCard.tsx:109-148,298-303`, testado).
- **Migração**: `messages.origin` é coluna final de `MESSAGE_COLUMNS`
  (`db.rs:37-39`), lida por índice 15 (`db.rs:1393`), insert/update com default
  `user`; banco legado preserva linhas (teste dedicado).

### 5.2 Persistência/projeção — 1 achado médio

- Kinds `goal/state`, `goal/deleted`, `goal/round-started`, `goal/round` como
  log-only (`harness/code/goal.rs:44-50`); o fold `current` usa
  `latest_code_event` (O(1) por kind), `goal/deleted` com `seq` maior fecha,
  revisão monotônica por sessão (create após delete/completed continua a
  numeração), CAS por `expectedRevision`, `begin_round`/`finish_round`
  idempotentes por `turnId`, lock global de escrita (`GOAL_WRITE_LOCK`) — tudo
  coberto por testes e verificado por leitura.
- **Achado médio #2**: o fold e o painel **não usam** a query por kinds criada
  na F1a; leem todo o log de `code_events` (§6).

### 5.3 Rodada (harness) — sem achados além do #1

- `run_turn` recusa `goal_round` em Chat (`GOAL_TURN_REQUIRES_CODE`), subagente
  (`GOAL_REQUIRES_TOP_LEVEL`) e `regenerate` **antes** de persistir mensagens e
  de qualquer request ao provider (`harness/mod.rs:1477-1538`; teste
  `goal_round_refuses_invalid_starts_before_persisting` verifica provider não
  chamado e `messages` vazio nas 6 recusas).
- `begin_round` ocorre antes de `prepare_new_turn`; `payload.content` vira
  `round_prompt` (nunca o conteúdo vazio do renderer); `origin` persistido;
  `GoalUpdated` é emitido após `turn_started` e no fecho (depois de
  `turn/ended`, antes de `Done/Error/Cancelled`).
- `finish_round` agrega tokens/custo, detecta progresso por `seq` (arquivos,
  `todos`, `plan/*`, nota), pausa em `cancelled→user`, `error→error`,
  `max_rounds`, `stalled`; **só altera se o objetivo ainda estiver `active`**
  (conclusão/bloqueio/pausa do usuário vencem); falha no fecho é best-effort
  (não derruba o turno).
- Auto-title pulado em `GoalRound` (`harness/mod.rs:2763-2768`); humano ainda
  titula (teste dedicado).
- Prompt/runtime: `## Objective` apenas no contexto volátil (surface item);
  system prompt e tools byte-idênticos entre rodadas (teste de hash do
  prompt-cache).

### 5.4 Driver no renderer — sem achados funcionais

- `done` é o único gatilho; `error`/`cancelled` não chamam `maybeContinueGoal`
  (`chatStore.ts:560-603`). `shouldContinueGoal` exige layout Code, sessão
  ativa, `active+armed`, orçamento, sem plano/aprovação/pergunta/streaming;
  preflight do backend revalida (`goal_can_continue`) e é rechecado após o
  await.
- `runGoalRound`: payload `{content:'', profile:'code', turnKind:'goal_round'}`,
  otimistas com `origin:'goal_round'`, `removeOnFailure` remove otimistas se o
  turno nem começou (`chatStore.ts:642-657`); `stop` de rodada chama
  `updateGoal('pause')` (`:1167-1185`); `regenerate` recusa a última mensagem
  `goal_round` (`:1066-1071`).
- Ressalvas baixas: `goalStarting` não sobrevive à rodada (§6 #6); TOCTOU do
  busy guard no backend (§6 #9).

### 5.5 UI — 1 achado médio + baixos

- Pill/popover (estados/ações/`aria-expanded`/confirmação inline/streaming),
  badge/aba no header (teclado setas/Home/End/Delete, `aria-selected`/
  `aria-controls`), painel central (`role=region aria-label="Objetivo da
  sessão"`, vazio/carregando/erro+retry/timeline), diálogo (Radix, validação
  `aria-invalid`/`aria-describedby`, `Esc`, `aria-busy`, zona de perigo),
  divisor `role="separator"` sem editar/regenerar, card de atenção com
  `role=status`/`alert` e dismiss por revisão — todos mapeados por teste.
- Tokens: nenhum hexadecimal nos arquivos novos; todos os tokens usados existem
  em `src/styles/globals.css`. Textos em pt-BR. Ícones lucide.
- **Achado médio #3**: card de atenção de `completed` sem "Reabrir/Novo".
- Baixos: painel sem "Nova rodada" para ativo ocioso; switch no diálogo de
  objetivo pausado; `aria-live` de início; reduced-motion no badge; origem
  `agent` não rotulada; encerrar durante rodada não fecha a aba.

### 5.6 Segurança — sem achados

- A tool `goal` é **metadado de sessão**: `risk: Read`, `mutating:false`,
  `parallel: Exclusive`, `requires_workspace:true`, `profiles:[Code]`
  (`tools/code/goal.rs:18-30`) — nenhum caminho novo de escrita/shell/commit.
- Subagente **não** recebe a tool (`readonly_tools()` não a contém;
  `harness/mod.rs:3541-3544` filtra; testes
  `subagent_catalog_excludes_the_goal_tool` e `readonly_tools_contain_no_mutating_tool`).
- Objetivo criado pelo modelo sai `origin=Agent` + `autoContinue=false`
  (`goal.rs:614-617`; `exec.rs:2371-2378`) — o modelo não se autoarma; só a UI
  arma/pausa/encerra.
- `goal_round` não burla política/aprovação: é turno normal do harness
  (aprovações/perguntas/plano/journal continuam valendo); preflight recusa
  plano/aprovação/turno ativo/workspace ausente; `create_goal` exige sessão Code
  e pasta existente no disco.
- Nada de `unwrap()`/`expect()` no caminho de produção do goal (`goal.rs`,
  `tools/code/goal.rs`, seção goal de `commands/code.rs`); sem `todo!()`/
  `unimplemented!()`; sem `any` implícito/`@ts-ignore`/`@ts-expect-error` na
  área TS. `pnpm typecheck` (strict) confirma.

## 6. Achados com severidade

Severidades: **Bloqueador** = impede aceite/perda de dados; **Alto** = quebra um
fluxo/critério documentado; **Médio** = desvio de contrato/UI ou dívida
relevante com workaround; **Baixo** = higiene/a11y/cosmético.

**Status após a F4.1 (correções pós-QA)**: **#1 (ALTO), #2 (MÉDIO 1), #3
(MÉDIO 2), #5 e #7 corrigidos** (ver §9, com arquivos e testes);
**#4, #6, #8–#15 aceitos/documentados** pelo Lead como débito de baixa
severidade (sem correção nesta rodada). A tabela abaixo mantém o registro
original da F4 (linhas de referência da época).

| # | Sev. | Achado | Arquivo:linha | Recomendação |
| --- | --- | --- | --- | --- |
| 1 | **Alto** | **"Retomar" após crash/reload não recupera o objetivo.** Crash no meio da rodada deixa `goal/round-started` sem `goal/round` e o último `goal/state` **`active`**. A leitura degrada para `paused/interrupted` (`project_goal`), mas `resume` vê o estado persistido `active` e é **no-op**; a órfã só é reconciliada em `begin_round`, que a UI não alcança enquanto o snapshot está `paused`. Resultado: cada "Retomar" devolve o snapshot degradado (loop); escapar exige encerrar + recriar (perde histórico). Vale também para pausar/concluir/bloquear durante a rodada e o app morrer antes do `finish_round`. O PLAN §6.3/§13 pede que retomar grave `interrupted` sem recontar. Sem teste desse caminho (o teste existente fecha a rodada manualmente antes de re-projetar). | `src-tauri/src/harness/code/goal.rs:776-791` (`resume_locked` no-op em `Active`); `src-tauri/src/commands/code.rs:1054-1098` (degradação read-only); `src-tauri/src/harness/code/goal.rs:1034-1107` (reconciliação só no `begin_round`); UI: `src/components/agent/GoalCard.tsx:113-145`, `src/components/code/CodeAgentWidgets.tsx:198-220` | No `resume`/`reopen` (ou num `goal::reconcile_orphan` chamado por ambos), gravar `goal/round` `interrupted` para as aberturas sem fecho sob o lock antes de retornar o snapshot — mesmo comportamento do `begin_round`. Adicionar teste integrado: `begin_round` sem `finish_round` → `project_goal` degradado → `resume` → `project_goal` `active` e `rounds()` com a órfã fechada |
| 2 | **Médio** | **Fold/painel leem o log completo de `code_events`; a query `list_code_events_by_kinds` (F1a) não tem uso de produção** (só testes). `goal::current` é O(1), mas `rounds`/`begin_round`/`finish_round` carregam todos os eventos da conversa (`list_code_events(conv, 1)`), e `project_goal` chama `rounds` a cada snapshot com objetivo ativo e sem turno. Em sessões longas isso é O(nº de eventos) por leitura/mutação; o PLAN §6.5 prevê a query por kinds "para o painel e o fold". | `src-tauri/src/harness/code/goal.rs:408-412` (`list_events`), `:290-355` (`rounds`), `:1056`, `:1165`; `src-tauri/src/db.rs:2208-2255` | Usar `list_code_events_by_kinds(conv, &[KIND_STATE, KIND_DELETED, KIND_ROUND_STARTED, KIND_ROUND], None)` no fold/painel (atenção à ordem DESC da query vs. o fold atual) |
| 3 | **Médio** | **Card de atenção do estado `completed` não oferece "Reabrir" nem "Novo objetivo"** (PLAN §10.5/§10.8 e task F3c pedem "concluído com resumo + Reabrir/Novo"). O card mostra só "Abrir objetivo"; o host não expõe `onReopen`. Workaround: pill/popover/painel têm "Reabrir"/"Novo objetivo". | `src/components/agent/GoalAttentionCard.tsx:126-135,195-233`; `src/components/code/CodeAgentWidgets.tsx:198-220` | Prop `onReopen` (e/ou `onNewGoal`) no card e no host, mapeando para `updateGoal('reopen')`/`openGoalDialog({mode:'create'})` |
| 4 | Baixo | **`GoalPanel` não tem "Nova rodada"** para objetivo ativo/armado e ocioso (PLAN §10.3 lista a ação). `GoalCard` em `active+armed` só expande pause/concluir/editar; a ação existe apenas no popover do composer ("Nova rodada agora"). | `src/components/code/GoalPanel.tsx:301-327`; `src/components/agent/GoalCard.tsx:78-112` | Botão "Nova rodada" no cabeçalho do painel (usa `runGoalRound` com `canStartGoalRound`) |
| 5 | Baixo | **Switch "Continuar automaticamente" no diálogo de objetivo pausado falha**: `arm`/`disarm` exigem `active`; ao salvar com o switch alterado o `edit` aplica e o `arm`/`disarm` retorna `GOAL_NOT_ACTIVE` (toast de erro). Durante a pausa o switch é inócuo (o retomar rearma). | `src/components/code/GoalDialog.tsx:218-222`; `src-tauri/src/harness/code/goal.rs:699-736` | Esconder/desabilitar o switch quando `goal.status !== 'active'` (ou mapear a alteração para `resume` + arm) |
| 6 | Baixo | **`goalStarting` não é guarda real durante a rodada**: é `true` e volta a `false` no mesmo tick (`finally` imediato porque `runTurn` é `void`); a proteção contra rodada dupla é `streaming` + preflight + `GOAL_BUSY`. | `src/lib/store/chatStore.ts:1264,1309-1311`; `src/lib/store/codeStore.ts:616-623` | Manter `goalStarting` até `turn_started`/fim do turno (ou documentar como sinal apenas síncrono) |
| 7 | Baixo | **Rename do título placeholder feito por `create_goal` não chega ao renderer**: o backend renomeia, mas nenhum `title_updated` é emitido e `codeStore.createGoal` não atualiza a lista; a aba/sidebar pode mostrar o placeholder até o próximo `list_conversations` (ex.: "Criar sem começar" não dispara turno). | `src-tauri/src/commands/code.rs:1100-1110`; `src/lib/store/codeStore.ts:519-533` | Emitir/retornar o título renomeado e atualizar `chatStore.conversations`, ou chamar `refreshConversations` após criar |
| 8 | Baixo | **Dead code/warnings novos na área**: `GOAL_MAX_RUNNING_ROUNDS_PER_CONVERSATION` e `GoalError::not_armed` nunca usados; `arm/disarm/pause/resume/reopen/block/delete` só usados por testes (os comandos usam `update`); `definition()`/`spec()` da tool sem uso; `goalProgressSummary`/`GOAL_STATUS_ORDER`/`goalNextRound` sem uso em produção. `cargo check`: 85 warnings (11 desses). AGENTS.md aceita warnings, mas é débito. | `harness/code/goal.rs:66,144,699-889`; `tools/code/goal.rs:32-38`; `src/lib/goalRunner.ts:97,150,192` | Usar ou remover (ex.: `arm`/`disarm` via wrappers; preflight pode consumir `GOAL_MAX_RUNNING_ROUNDS_PER_CONVERSATION`) |
| 9 | Baixo | **TOCTOU do busy guard**: `commands/turn.rs` checa `has_active_turn_for` e só depois registra o turno (sem atomicidade); dois invokes `goal_round` concorrentes poderiam passar o check. Mitigado no fluxo normal por `streaming`/`goalStarting` no renderer + preflight + `begin_round` (que serializa, mas não rejeita turno ativo de outro turnId). | `src-tauri/src/commands/turn.rs:21-32` | Registrar condicionalmente (ex.: `TurnRegistry::try_register_for_conversation`) para fechar a janela |
| 10 | Baixo | **Appends não atômicos no fecho da rodada**: `begin_round` grava `round-started` e `state` em dois inserts; `finish_round` grava `goal/round` e depois `state`. Crash entre eles pode duplicar o índice na timeline (orçamento não dobra) ou perder a pausa decorrente do outcome (estado fica `active`). Probabilidade baixa; sem transação. | `src-tauri/src/harness/code/goal.rs:1056-1107,1200-1264` | Agrupar cada mutação numa transação SQLite (ou tornar o fold tolerante ao par incompleto) |
| 11 | Baixo | **Timeline marca "Interrompida" uma rodada ainda em andamento** se o usuário pausar o objetivo no meio dela: o fold só permite "em andamento" com `status == Active`. Transitório (o `finish_round` fecha logo em seguida). | `src-tauri/src/harness/code/goal.rs:308-331` | Permitir "em andamento" sempre que houver turno ativo/streaming, independente do status |
| 12 | Baixo | **A11y**: não há anúncio `aria-live` dedicado para o **início** da rodada (o divisor é `role="separator"`; pausa/conclusão/bloqueio são anunciados pelos `role=status/alert` do card); o spinner do badge do header ignora `prefers-reduced-motion` (o pill respeita). | `src/components/chat/GoalRoundDivider.tsx:35-37`; `src/components/code/CodeSessionHeader.tsx:157-158` | Região `aria-live="polite"` curta para "rodada iniciada/pausada" e respeitar `useReduceMotion` no badge |
| 13 | Baixo | **Objetivo proposto pelo agente não é rotulado** na UI: `origin:'agent'` é normalizado, mas não há o microcopy "Objetivo proposto pelo agente" + "Ativar" (PLAN §10.9); o objetivo aparece como ativo/manual (switch de arm). | `src/components/agent/ToolPresentationCard.tsx:123`; `GoalCard.tsx`/`GoalControls.tsx` (sem uso de `origin`) | Badge "Proposto pelo agente" + CTA "Ativar" quando `origin==='agent' && !autoContinue` |
| 14 | Baixo | **Encerrar o objetivo durante a rodada não fecha a aba/painel central**: o painel fica no estado vazio com a aba "Objetivo" aberta (PLAN §13 diz "painel fecha"). | `src/components/code/GoalPanel.tsx:267-290`; `src/components/code/CodeSessionHeader.tsx:833` | Fechar `codeGoalOpen`/`codeView` quando `goal` virar `null` com a view `goal` aberta |
| 15 | Baixo | **`delete` durante a rodada não registra o fecho da rodada no histórico**: `finish_round` retorna `None` se o objetivo sumiu, então o `goal/round` nunca é gravado (auditoria incompleta; o turno termina normalmente). | `src-tauri/src/harness/code/goal.rs:1159-1161` | Gravar o `goal/round` mesmo sem estado do objetivo (tombstone) ou documentar a perda no §13 |

Observação (não é achado): `goal_can_continue(auto=true)` em snapshot
degradado `paused/interrupted` responde `not_armed` (a degradação desarma) e
`interrupted` só aparece com `auto=false` — é coerente com a ordem do §7.4 e
está documentado no teste `goal_can_continue_reasons_follow_the_documented_order`;
a UI do card usa o snapshot, não o `reason`, então não há impacto visual.

## 7. Riscos residuais e pendências

1. **Nenhuma automação de UI/navegador** foi usada como evidência (AGENTS.md).
   A camada visual foi validada por testes jsdom (RTL) + revisão de código; não
   há prova de execução no app empacotado com provider real. Os testes de
   harness usam `ProviderStreamer` falso (sem rede), então a cadeia
   UI→IPC→provider live de uma rodada não foi exercitada nesta máquina.
2. **Working tree não commitado** e **misturado ao goal anterior de
   prompt-cache**: além dos 16 arquivos novos + docs do Goal, `git status` traz
   `docs/goals/prompt-cache/*` (4 tracked + 7 JSONs de evidência não rastreados)
   e `src-tauri/src/harness/cache/bench.rs` — alterações pré-existentes, não
   geradas por esta feature. Um commit do Goal deve separar esses caminhos.
   `dist/` e `target/` estão ignorados; nenhum artefato de build entrou no repo.
3. **F5 (docs)**: o Lead concluiu `ARCHITECTURE.md`/`HARNESS.md`/`TOOLS.md`/
   `WORKBENCH.md` e o resultado no `PLAN.md` após a F4; **não reverificados** pela
   F4.1 (fora do escopo, docs). Nota encontrada na revalidação: o `PLAN.md` ainda
   registra "127 files / 2354 tests" — o número atual é **2355** (1 teste novo da
   F4.1); ajuste de número em documentação (§9.4).
4. **Crash/reload**: o loop do ALTO #1 foi corrigido (§9.1); restam as janelas de
   crash entre appends (#10) e a degradação de leitura não transacional —
   recomenda-se transação por mutação.
5. **Performance do fold** (#2): corrigida para os kinds consumidos (§9.2).
   Resíduo menor: a lista filtrada ainda cobre a sessão inteira (sem `from_seq`)
   e o `begin_round` carrega essa lista duas vezes (uma para idempotência/limite
   e outra na reconciliação) — medir com log grande; não é regressão funcional.
6. **Warnings**: `cargo check` reporta **84 warnings** (85 linhas `warning:`,
   incluindo o resumo; 11 na área do Goal — #8); aceitáveis por AGENTS.md
   ("warnings são aceitáveis"), mas é débito novo.
7. **Sem retomada automática no boot** (por design, D10): após restart, nada
   roda sozinho; o usuário vê o estado e retoma — caminho agora funcional (§9.1).
8. **`goal_round` em segundo plano** fora do escopo (§17) — driver só com a
   sessão ativa no Code, por design.

## 8. Notas de flake e método

- **Nenhum flake**: a suíte completa (`pnpm test`) passou de primeira (127
  arquivos/2354 testes, 158.34s) e `cargo test --lib` passou de primeira
  (988/0/13, 27.06s), sem `Blocking waiting for file lock` no target do cargo.
  Reexecução focada de 8 arquivos goal: 108/108 verdes.
- **Nenhum teste foi alterado para passar**: `git diff -U0` dos testes
  modificados mostra apenas importes/ajustes de tipo (`turnKind: 'user'` em
  fixtures de `StreamingState`) e blocos novos; nenhuma asserção removida.
- **Método**: QA independente e read-only no código; cada critério foi conferido
  por leitura do fluxo (Rust/TS) + execução das suítes + inspeção dos testes
  existentes (sem reescrevê-los). O único arquivo escrito por esta fase é este
  `EVIDENCE.md`. Não houve commit.

---

# Correções pós-QA (F4.1) e parecer final

## 9. Correções pós-QA (F4.1)

- **Quando**: 2026-10-29 ~22:35–22:43 (America/Sao_Paulo); as cinco suítes foram
  executadas uma única vez sobre o código congelado em **22:34** (arquivos
  alterados desde a F4: `harness/code/goal.rs` 22:30, `commands/code.rs` 22:28,
  `GoalAttentionCard.tsx`/teste 22:29, `CodeAgentWidgets.tsx` 22:29,
  `GoalDialog.tsx`/teste 22:34; `PLAN.md` (F5, só doc) 22:35).
- **Método**: revalidação independente, read-only no código (o único arquivo
  escrito foi este EVIDENCE). Sem commit e sem automação de navegador.

### 9.1 ALTO — retomada após rodada interrompida (corrigido e validado)

**Antes** (§6 #1): crash deixava `goal/round-started` sem `goal/round` e o
`goal/state` `active`; o snapshot degradava para `paused/interrupted`, mas
`resume` no estado persistido `active` era no-op — loop, sem destravar pela UI.

**Depois**:
- Novo `pub fn reconcile_interrupted_rounds(db, conv)` —
  `src-tauri/src/harness/code/goal.rs:436-486`: sob `GOAL_WRITE_LOCK`, fecha
  cada `goal/round-started` sem `goal/round` do objetivo atual (escopo pelo
  `boundary`) com `GoalRound { outcome:"interrupted", ended_at: Some(now),
  duration_ms }`; **não** grava `goal/state` e **não** incrementa revisão.
- `commands/code.rs:1273-1284`: `update_goal` chama a reconciliação **antes** de
  aplicar a ação, e somente quando `!state.has_active_turn_for(conversa)`.
- `begin_round` reusa o helper interno (`goal.rs:1140-1142`), preservando a
  semântica anterior (fecha a órfã antes de abrir; nunca conta rodada duas vezes).
- Teste novo `harness::code::goal::tests::reconcile_interrupted_rounds_unblocks_resume_after_a_crash`
  (`goal.rs:1902-1939`): `begin_round` sem `finish_round` → reconcile → 1 rodada
  `interrupted` com `endedAt` → 2ª reconcile é no-op (não duplica) →
  `update(Resume)` devolve `active` → `begin_round("turn-2")` abre índice 2.
  **Rust: 988 → 989 passed** (0 failed, 13 ignored).

**Verificação do fluxo (independente)**:
1. **Fim do loop**: `project_goal` só degrada quando a última rodada tem
   `ended_at.is_none()` e `outcome == "interrupted"` (`commands/code.rs:1088-1096`);
   a rodada reconciliada tem `ended_at` preenchido, então o snapshot pós-`resume`
   volta `active` — o loop `paused/interrupted` não se repete. O caminho de
   `reopen` pós-conclusão também é destravado pela mesma reconciliação.
2. **CAS preservado**: a reconciliação não grava `goal/state` nem altera
   `revision`; o `expectedRevision` que o `update_goal` recebe continua válido.
3. **Idempotência**: segunda chamada não duplica `goal/round` (asserção no teste).
4. **Corrida**: segura por construção — um `goal/round-started` aberto implica
   turno registrado (`commands/turn.rs` registra o turno ANTES de `run_turn`,
   que só então abre a rodada; o registro só é removido depois de
   `finish_round`). Logo, `!has_active_turn_for` ⇒ não existe rodada viva para
   fechar; não há janela para reconciliar rodada em andamento.
5. **Cobertura**: o helper e o fluxo reconcile→resume→begin têm teste; a chamada
   no `update_goal` (fina, sem `AppState` em teste unitário) foi verificada por
   leitura. Sugestão opcional: teste integrado do comando.

**Veredito**: **resolvido**.

### 9.2 MÉDIO 1 — fold sobre a query por kinds (corrigido)

- `goal::list_events` agora usa `db.list_code_events_by_kinds(conv, &[4 kinds
  goal/*, todos, 4 plan/*], None)` — `src-tauri/src/harness/code/goal.rs:408-434`.
  A query da F1a passou a ter uso de produção; deixa de ler o log inteiro
  (`step`/`context`/`file`/`turn` etc. ficam de fora).
- Ordem: a query devolve `seq DESC`; o helper faz `reverse()` e o fold continua
  `ASC` (contrato preservado para `round_starts`/`round_ends`/`prior_note`).
- Progresso do `finish_round`: o filtro inclui `todos` e os 4 kinds `plan/*`
  existentes no repo (conferido por grep) ⇒ `plan_or_todos_changed` continua
  equivalente.
- Residual (nota de perf, não regressão): a lista filtrada ainda cobre a sessão
  inteira (não há `from_seq`) e o `begin_round` a carrega duas vezes (uma para
  idempotência/limite e outra dentro da reconciliação) — medir em sessão longa.

**Veredito**: **resolvido** (com nota de otimização futura).

### 9.3 MÉDIO 2 — "Reabrir" no card de atenção concluído (corrigido)

- `GoalAttentionCard` ganhou `onReopen?` (`GoalAttentionCard.tsx:35`),
  `canReopen = status === 'completed'` (`:134`), ação "Reabrir objetivo"
  (`:233-243`) e entrada em `showActions` (`:135-140`); sem handler o botão não
  é renderizado (sem botão morto).
- Host `CodeAgentWidgets.tsx` passa `onReopen` → `updateGoal(conv, 'reopen')`
  (mesmo `goalBusy`/`applyGoalAction` das demais ações do card).
- Testes: `GoalAttentionCard.test.tsx` **11 → 12** — "mostra resumo e as ações
  de reabrir/abrir/dispensar" e "não mostra 'Reabrir objetivo' sem handler".

**Veredito**: **resolvido**. Residual baixo: o botão "Novo objetivo" no card de
`completed` continua existindo apenas no painel/popover (PLAN §10.5 menciona
"Reabrir/Novo").

### 9.4 BAIXOS corrigidos

- **Switch de continuidade em objetivo não ativo** (§6 #5):
  `continuityLocked = editing && goal != null && goal.status !== 'active'`
  (`GoalDialog.tsx:88-90`) desabilita o Switch; a copy passa a explicar
  "A continuidade é reativada ao retomar o objetivo." (`:375-385`); e
  `arm`/`disarm` só é chamado quando `goal.status === 'active'` (`:223-229`),
  eliminando o toast `GOAL_NOT_ACTIVE` ao salvar objetivo pausado/bloqueado/
  concluído. Verificado por leitura + typecheck/testes verdes (sem teste
  dedicado do estado travado).
- **Rename do título placeholder** (§6 #7): após criar, o diálogo chama
  `useChatStore.getState().refreshConversations()` (`GoalDialog.tsx:175-177`),
  propagando o título ao sidebar/abas; o mock de `listConversations` foi
  adicionado ao teste do diálogo. Verificado por leitura + suíte (sem asserção
  dedicada de propagação).

**Veredito**: **resolvido** (ambos de UI; verificação por leitura + testes).

### 9.5 Suítes da F4.1 (working tree de 22:34)

| Comando | Exit | Números | vs F4 |
| --- | --- | --- | --- |
| `cd src-tauri && cargo check` | **0** | 84 warnings (contagem do cargo; 11 na área Goal) | igual |
| `cd src-tauri && cargo test --lib` | **0** | **989 passed; 0 failed; 13 ignored; 0 measured; 0 filtered out** (33.18s) | **+1** (teste da reconciliação) |
| `pnpm typecheck` | **0** | `tsc --noEmit` sem saída | igual |
| `pnpm test` | **0** | **127 files passed (127); 2355 tests passed (2355)** (225.04s) | **+1** (teste de Reabrir) |
| `pnpm build` | **0** | `tsc --noEmit && vite build`, `✓ built in 20.92s` (warning de chunk >1500 kB pré-existente) | igual |

- **Regressões**: nenhuma. Nenhum teste falhou/pulou; `git status` continua com
  **83 entradas** (59 tracked modificados + 24 não rastreados), os mesmos
  caminhos da F4 — os 5 arquivos alterados pela correção já estavam no diff.
  `dist/`/`target/` ignorados; nenhum artefato gerado entrou no repo.
- **Nenhum teste enfraquecido**: as correções só adicionaram/ajustaram testes
  (Rust +1 novo; TS +1 novo; mock de `listConversations`); nenhuma asserção
  existente removida.
- **Sem flakes**: 5 suítes verdes na primeira execução da F4.1.

### 9.6 Achados remanescentes (final)

| # | Sev. | Achado | Status |
| --- | --- | --- | --- |
| 1/2/3 | Alto/Médio | Os três achados da F4 | **corrigidos e revalidados** (§9.1–§9.3) |
| 4 | Baixo | `GoalPanel` sem "Nova rodada" para ativo ocioso (só no popover do composer) | aceito/documentado |
| 6 | Baixo | `goalStarting` curto (guarda real é `streaming` + preflight + `GOAL_BUSY`) | aceito/documentado |
| 8 | Baixo | 11 warnings de dead code de contrato (`GOAL_MAX_RUNNING…`, `not_armed`, wrappers usados só por teste, `definition/spec`, helpers TS sem uso) | aceito/documentado |
| 9 | Baixo | TOCTOU do busy guard (`commands/turn.rs:21-32`) | aceito/documentado |
| 10 | Baixo | Appends não atômicos de `begin_round`/`finish_round` (janela de crash) | aceito/documentado |
| 11 | Baixo | Timeline marca "Interrompida" rodada em andamento se o objetivo é pausado no meio | aceito/documentado |
| 12 | Baixo | Sem `aria-live` dedicado ao início da rodada; spinner do badge do header ignora reduced-motion | aceito/documentado |
| 13 | Baixo | Origem `agent` sem rótulo "Objetivo proposto pelo agente"/"Ativar" | aceito/documentado |
| 14 | Baixo | Encerrar objetivo durante a rodada não fecha a aba/painel central | aceito/documentado |
| 15 | Baixo | `delete` durante a rodada não registra o fecho da rodada no histórico | aceito/documentado |
| 16 | Baixo (novo, doc) | `PLAN.md` (F5) registra "127 files / 2354 tests"; o número atual é **2355** | corrigir o número no PLAN (não é código) |
| 17 | Baixo (novo) | Card de atenção `completed` tem "Reabrir" mas não "Novo objetivo" (§9.3) | aceito/documentado |

Observação (comportamento, não achado): como a reconciliação roda em **qualquer**
ação do `update_goal` sem turno ativo, editar/armar um objetivo com snapshot
degradado também fecha a órfã — o aviso "pausado/interrompido" desaparece após a
edição e o objetivo volta a `active` (com o `autoContinue` persistido). É o
comportamento desejado para manter o log consistente; o usuário que quer
controlar o gasto deve observar o pill "Automático"/"Manual" após editar.

## 10. Parecer final

**APROVADO (F4.1).** As cinco suítes estão verdes no working tree atual
(`cargo check` 0; `cargo test --lib` **989/0/13**; `pnpm typecheck` 0;
`pnpm test` **127/2355**; `pnpm build` 0), o **ALTO** (retomada após rodada
interrompida) foi validado no código e no teste novo (fim do loop, sem bump de
revisão, idempotente, sem janela de corrida contra turno vivo), e as correções
**MÉDIO 1**, **MÉDIO 2** e **BAIXO 5/7** foram confirmadas. Nenhuma regressão
encontrada. Os baixos remanescentes são débito documentado e aceito pelo Lead,
sem impacto no aceite do sistema de Goal; o único item de documentação é o
`PLAN.md` ainda citar 2354 testes (atual: 2355).

Ressalvas de validade (mantidas da F4): working tree **não commitado** e
misturado às alterações do goal anterior de prompt-cache (o commit deve separar
os caminhos); sem **E2E live com provider real** (os testes de harness usam
`ProviderStreamer` falso) e sem automação de navegador/screenshot como evidência
(AGENTS.md). Recomendações para o fechamento: (a) ajustar o número no
`PLAN.md`; (b) opcional: teste integrado do comando `update_goal` cobrindo
`crash → update_goal(Resume) → snapshot active`; (c) opcional: transações nas
mutações de rodada e `from_seq` no fold (perf). Sem commit nesta rodada.

---

## 11. F4.2 — fluxo `/goal` + botão somente ícone (+ adendo do rename)

- **Quando**: 2026-10-29 ~23:14–23:47 (America/Sao_Paulo). Código da mudança
  v1.12 até 23:02; **adendo do rename** em `harness/code/goal.rs` (23:19) e
  `harness/mod.rs` (23:21). As suítes TS rodaram às 23:15 (antes do adendo) e
  **não foram afetadas** (o adendo é só Rust — mtimes conferidos); o Rust foi
  reexecutado **depois** do adendo e é o número final registrado.
- **Método**: QA independente, read-only no código; único arquivo escrito:
  `EVIDENCE.md`. Sem commit e sem automação de navegador.

### 11.1 Antes → depois (v1.12)

| Item | Antes (F4.1) | Depois (F4.2) |
| --- | --- | --- |
| Ativação | `/goal` (invoke) abria o painel se houvesse objetivo ou o `GoalDialog` em modo criação; o pill fantasma também abria o diálogo | `/goal` é **comando de preenchimento** (`GOAL_CREATE_PREFIX`): insere o pedido no composer e foca o campo; o usuário completa e envia; **o agente cria o objetivo pela tool `goal` (action `create`)** no mesmo turno |
| Diálogo | criação e edição | só **edição/encerramento**; `mode:'create'` e `create_goal` ficam para back-compat/teste — **nenhum caminho de UI abre criação** (verificado por grep) |
| Botão do composer | pill com rótulo de status e `N/M` | **somente ícone** (`Target`), `size-8`, estado por cor + spinner + `aria-label`/`title`; sem objetivo dispara `requestGoalCreation()`; com objetivo abre o popover |
| Tool `goal` | `create` nascia sempre `autoContinue=false` (D8) | schema ganhou `auto_continue?: boolean`; `exec::goal_create` usa **default `true`** (pedido humano) e `false` explícito é respeitado; `origin=agent`; **sem o parâmetro** `goal::create` segue **desarmado** (retrocompatível) |
| Rename do placeholder (adendo) | só `create_goal` (comando) renomeava | **`goal::create` renomeia** o título placeholder (best-effort, `should_auto_title` + `db.rename_conversation`) para **as duas origens** (tool e comando, duplicação idempotente); auto-title do turno relê o título vivo do DB e não sobrescreve mais o rename da tool |
| Docs | fluxo antigo | PLAN §1.3/§8.3/§10.1–§10.8/§12.2/§20, WORKBENCH §17, TOOLS §7, HARNESS §15.2 e ARCHITECTURE §8.3 (item 11) atualizados (resíduos em §11.4 #5) |

### 11.2 Fluxo novo validado (código + testes)

- **`/goal` só preenche**: `GOAL_CREATE_PREFIX`/`requestGoalCreation`
  (`commands.ts:30-37`), comando `action:'fill'` (`commands.ts:74-83`) e
  substituição do token + foco (`Composer.tsx:379-397`). O `requestGoalCreation`
  reusa o listener já existente `lumina:suggest` (`Composer.tsx:140-165`) — por
  isso `Composer.tsx` voltou a ser **byte-idêntico ao HEAD** (`git diff` vazio).
  Testes: `Composer — comando /goal` (`Composer.code.test.tsx:478-522`) verificam
  catálogo/grupo Objetivo, prefixo com `max_rounds`/`auto_continue=true`,
  **nenhum envio**, `goalDialog=null`, `codeGoalOpen=false`, `codeView='session'`.
- **Nenhum caminho de UI cria objetivo por diálogo**: grep de
  `openGoalDialog`/`mode: 'create'` só encontra `mode:'edit'` em produção
  (`CodeAgentWidgets.tsx:208`, `GoalPanel.tsx:194`, `GoalControls.tsx:161`); os
  usos de `'create'` restantes são tipo (`GoalDialog.tsx:50`, `uiStore.ts:83`) e
  testes (`GoalDialog.test.tsx:90`, `WorkspaceCenter.test.tsx:45`). `GoalDialog`
  create continua coberto por teste de regressão do componente.
- **Tool create armado por default**: schema `auto_continue?: boolean`
  (`tools/code/goal.rs:63-66`), guidance do fluxo `/goal` (`:29`); `exec.rs`
  `goal_create` (`:2363-2386`) faz `opt_bool(args,"auto_continue").unwrap_or(true)`
  e passa `Some(...)`; `goal::create` honra explícito para `origin=Agent` e mantém
  `unwrap_or(false)` sem parâmetro (`harness/code/goal.rs:690-696`). Testes:
  `goal_create_only_in_human_turn_and_com_apresentacao_flat` (asserta
  `origin=agent` e `autoContinue=true`) e o novo
  `goal_create_can_explicitly_disable_auto_continue` (`exec.rs:4015-4034`).
- **Driver**: o turno humano que cria o objetivo termina em `done`; o
  `chatStore` faz `refresh → maybeContinueGoal` (já testado) e, como o objetivo
  nasce `active+armed` com `rounds=0 < maxRounds`, a rodada 1 inicia ao fim do
  turno (preflight `goal_can_continue(auto=true)` exige `autoContinue`, que é
  true). Nenhuma mudança de driver foi necessária.
- **Botão somente ícone + acessibilidade**: `GoalControls` usa
  `ICON_PILL_CLASS_NAME` (`:68-74`) e não renderiza texto/`N/M` (`:232-254` sem
  objetivo; `:267-284` com objetivo, só `Target`/`Spinner`). `aria-label`
  completo ("Criar objetivo com /goal" / "Objetivo: <status> — Rodada N de M"),
  `title` com motivo de pausa, tooltip explicando o fluxo, `aria-expanded` via
  Radix, foco visível e spinner respeitando `useReduceMotion`. Testes:
  `GoalControls.test.tsx:110-131` (asserta `textContent` vazio e o evento
  `lumina:suggest`) e `CodeSessionControls.test.tsx:328-353` (posição entre
  Plano e Plano/tarefas + aria-label novo).
- **Adendo do rename**: `goal::create` renomeia após `append_state`, best-effort
  (`harness/code/goal.rs:726-734`), e o auto-title do turno relê o título vivo
  do DB (`harness/mod.rs:2763-2777`) para **não sobrescrever** o rename da tool.
  Testes novos/ajustados: `create_renames_only_a_placeholder_conversation_title`
  (`goal.rs:1492-1531`; renomeia "Nova conversa" → título do objetivo e não
  toca título real) e `goal_round_skips_auto_title_but_human_turns_still_title`
  (`mod.rs:10978-11071`; reseta o título antes da rodada e mantém o auto-title
  de turno humano). A duplicação com o `rename_placeholder_title` do
  `create_goal` é idempotente (o segundo rename vê título já trocado ou reusa o
  mesmo valor).
- **Docs**: fluxo novo descrito em PLAN §8.3/§10.2–§10.4/§10.7/§10.8/§20,
  WORKBENCH §17, TOOLS §7, HARNESS §15.2 e ARCHITECTURE §8.3 item 11.

### 11.3 Números finais F4.2

| Comando | Exit | Números | vs F4.1 |
| --- | --- | --- | --- |
| `cd src-tauri && cargo check` | **0** | 84 warnings (contagem do cargo; 11 dead-code na área goal) | igual |
| `cd src-tauri && cargo test --lib` | **0** | **991 passed; 0 failed; 13 ignored; 0 measured; 0 filtered out** (15.61s; reexecução após o adendo — 990 antes dele) | **+2** (`goal_create_can_explicitly_disable_auto_continue`, `create_renames_only_a_placeholder_conversation_title`) |
| `pnpm typecheck` | **0** | `tsc --noEmit` sem saída | igual |
| `pnpm test` | **0** | **127 files passed (127); 2354 tests passed (2354)** (165.78s) | **−1** (ver §11.3.1) |
| `pnpm build` | **0** | `tsc --noEmit && vite build`, `✓ built in 12.03s` (warning de chunk >1500 kB pré-existente) | igual |

**11.3.1 Testes (sem enfraquecimento).** A queda de 1 no TS vem só de
`Composer.code.test.tsx` (25 → 24): o bloco `/goal` foi reescrito para o fluxo de
preenchimento (3 testes novos) e os testes do comportamento **removido** (abrir
painel/diálogo) deixaram de existir — não há teste de comportamento vigente
suprimido. Os demais arquivos mantêm a contagem (GoalControls 11, GoalPanel 16,
GoalCard 17, GoalAttentionCard 12, GoalDialog 14, CodeSessionControls 16,
CodeSessionCards 20, MessageItem 5, goalRunner 15). No Rust, +2 testes novos; o
teste de auto-title foi ajustado (reset do título) para continuar válido após o
rename — asserções seguem verificando o contrato (rodada não titula; turno
humano titula).

**11.3.2 Working tree.** `git status`: **82 entradas** (58 tracked modificados +
24 não rastreados). Uma entrada tracked a menos que na F4.1 porque
`src/components/composer/Composer.tsx` voltou a ser idêntico ao HEAD (o caminho
`invoke:'goal'` foi removido); os 7 arquivos alterados nesta rodada
(`Composer.tsx`→HEAD, `GoalPanel.tsx`, `GoalControls.tsx`, `tools/code/goal.rs`,
`harness/code/goal.rs`, `tools/code/exec.rs`, `commands.ts` + testes) conferem
por mtime. `dist/`/`target/` ignorados; nenhum artefato gerado.

### 11.4 Achados da F4.2

| # | Sev. | Achado | Arquivo:linha | Recomendação |
| --- | --- | --- | --- | --- |
| 1 | **Médio** | **CTA do `GoalPanel` preenche o composer que está oculto na view `goal`.** "Criar com /goal" (vazio) e "Novo objetivo (/goal)" (concluído) só chamam `requestGoalCreation()`; o listener preenche/foca o `textarea` do `ChatView`, mas o `WorkspaceCenter` mantém o `ChatView` com `hidden` enquanto `codeView==='goal'` — o usuário clica e **não vê nada acontecer** (o texto fica no composer e só aparece ao fechar a aba "Objetivo" manualmente; o foco em elemento oculto é no-op). Alcançável no caminho "concluir → card de atenção → Abrir objetivo → Novo objetivo (/goal)". | `GoalPanel.tsx:283-290,315-318`; `commands.ts:33-37`; `Composer.tsx:142-155`; `WorkspaceCenter.tsx:51-55,72-79` | Antes de `requestGoalCreation()`, fechar a aba/voltar à sessão (`useUiStore.getState().closeCodeGoal()` e/ou `setCodeView('session')`); teste do CTA deve assertar `codeView==='session'` |
| 2 | Baixo | **Estado do botão somente ícone é comunicado só por cor para usuários videntes.** O `Target` é o mesmo para active/paused/blocked/completed (só muda a cor; spinner apenas em rodada); o PLAN §10.10 ainda exige "nunca só cor — texto/símbolo". `aria-label`/`title`/tooltip atendem leitor de tela, mas daltônicos não distinguem pausado/bloqueado/concluído sem hover. | `GoalControls.tsx:68-86,250-284`; PLAN §10.10 (`PLAN.md:751`) vs §10.2 (`:623-631`) | Diferenciar o glifo por estado (ex.: `Pause`/`Check`/`TriangleAlert`) ou dot/badge mínimo; alinhar §10.10 à decisão de produto |
| 3 | Baixo | **Ícone sem objetivo contorna o gate de workspace do composer.** O catálogo `/` só abre com workspace (`Composer.tsx:109`), mas o ícone chama `requestGoalCreation()` mesmo sem workspace; a tool `goal` tem `requires_workspace:true` e é filtrada sem workspace (`harness/mod.rs:3541`), então o pedido não pode ser cumprido e não há aviso/CTA de abrir pasta (antes, o diálogo validava o workspace e errava com mensagem). | `GoalControls.tsx:232-254`; `Composer.tsx:109`; `tools/code/goal.rs:27`; `harness/mod.rs:3541` | Desabilitar/ocultar o ícone sem workspace (ou abrir o CTA "Sem workspace"), mantendo a paridade com o menu `/` |
| 4 | Baixo | **`/goal` com objetivo já existente ainda insere o pedido de criação** (o comando é puro fill; não checa o store). O agente recebe o pedido e a tool responde `GOAL_ALREADY_EXISTS`; o comportamento anterior (abrir o painel quando havia objetivo) deixou de existir sem substituto textual — o usuário precisa saber que o ícone/popover é o caminho. | `commands.ts:74-83`; teste `Composer.code.test.tsx:489-507` (semeia objetivo e espera fill) | Mencionar na descrição do comando ou detectar objetivo no store em `requestGoalCreation` e abrir popover/painel em vez de preencher criação |
| 5 | Baixo | **Resíduos do fluxo antigo na documentação**: `PLAN.md:907` (§12.2 ainda diz "`/goal` abre painel/diálogo; sem sessão ⇒ toast"); `:610`/`:614` (§10.1 "pill ... estado/rounds, criar" e "diálogo criar/editar"); `:753` (responsivo "pill esconde rótulo"); `:718-725` (§10.8 "Pill" com `N/M`); `:558` (§8.4 cita só `create_goal` renomeando — agora `goal::create` renomeia nas duas origens, adendo não documentado em TOOLS/HARNESS). | PLAN §8.4/§10.1/§10.8/§10.10/§12.2; TOOLS/HARNESS | Passagem de docs do F5 |
| 6 | Baixo (observação/segurança) | **`auto_continue=true` virou default de qualquer `create` em turno humano**, não só quando o usuário digitou `/goal`: o modelo pode criar+armar um objetivo num turno humano comum sem gatilho explícito de produto. Mitigações seguem válidas (só turno humano, sem objetivo ativo, workspace exigido, `origin=agent`, preflight/budget/pausa/disarm); D8 ("o modelo não se autoarma") foi atenuado pela decisão v1.12. Sem parâmetro, `goal::create` continua desarmado. | `exec.rs:2374`; `harness/code/goal.rs:690-696`; guidance `tools/code/goal.rs:29` | Se a intenção for "só /goal arma": default `false` no exec e exigir `auto_continue:true` explícito do modelo (a guidance e o prefixo já mandam true); documentar a decisão no PLAN §8.3 |

Observações (não são achados):
- O `live_title` do auto-title (`harness/mod.rs:2763-2777`) resolveu a corrida
  em que o auto-title do fim do turno sobrescreveria o título renomeado pela
  tool; custo: **um `get_conversation` extra por turno** (negligenciável).
- Caso ultra-raro: se o título derivado do objetivo for exatamente um
  placeholder conhecido ("Nova conversa" etc.), o auto-title do fim do turno
  ainda pode substituí-lo (`should_auto_title(live_title)` true).
- O fluxo `/goal` pressupõe workspace e turno humano; sem workspace vale o
  achado #3.

### 11.5 Parecer final F4.2

**APROVADO COM RESSALVAS.** As cinco suítes estão verdes
(`cargo check` 0; `cargo test --lib` **991/0/13**; `pnpm typecheck` 0;
`pnpm test` **127/2354**; `pnpm build` 0) e o fluxo novo foi confirmado por
código + testes: `/goal` apenas preenche o composer (sem painel/diálogo, sem
envio), o botão é somente ícone com `aria-label`/tooltip completos, a tool
`create` nasce armada no turno humano (com `auto_continue=false` respeitado e
sem parâmetro desarmado), `origin=agent`, e o adendo do rename está aplicado com
auto-title protegido. **Nenhuma regressão** e **nenhum bloqueador**.

Ressalva principal: o achado **#1 (Médio)** — CTA do `GoalPanel` preenche um
composer oculto — deve ser corrigido antes do fecho (é um beco sem saída na
superfície do painel; o caminho principal pelo ícone/`/goal` no composer
funciona). Os demais baixos são débito documentado/aceitável. Mantidas as
ressalvas gerais (§7): working tree não commitado e misturado ao goal anterior
de prompt-cache; sem E2E live com provider real; sem automação de navegador como
evidência. Sem commit nesta rodada.

## 12. F4.2.1 — ajuste do CTA do GoalPanel (Lead, pós-QA F4.2)

> Nota de método: a task-11 (revalidação F4.2.1 pelo `qa-verifier`) foi
> interrompida antes do parecer. O ajuste abaixo foi validado pelo Lead com os
> testes focados + suítes completas; fica registrado aqui como fecho.

**Antes** (achado Médio #1 da F4.2): os CTAs do `GoalPanel` (`Criar com /goal` e
`Novo objetivo (/goal)`) chamavam `requestGoalCreation()` com a view central
`goal` aberta; o `WorkspaceCenter` mantém o `ChatView`/composer oculto nessa
view, então o clique não produzia efeito visível (só após fechar a aba).

**Depois**: `GoalPanel.tsx` ganhou `startGoalCreation()`:

```ts
const startGoalCreation = () => {
  useUiStore.getState().closeCodeGoal(); // volta codeView='session'
  requestGoalCreation();                 // preenche /goal e foca o composer
};
```

Usado nos dois CTAs; os testes (`GoalPanel.test.tsx`) abrem a view `goal`
(`codeView:'goal', codeGoalOpen:true`), clicam no CTA e assertam
`codeView==='session'`, `codeGoalOpen===false`, `lumina:suggest` disparado e
`goalDialog=null`. Também entram neste fecho:
`auto_title_reads_the_live_title_after_a_goal_renames_the_placeholder`
(helper `conversation_needs_auto_title`) e a limpeza de resíduos docs do fluxo
antigo (pill fantasma/`invoke:'goal'`/diálogo de criação/`Definir objetivo`).

**Verificação final (working tree, após o ajuste)**:

| Comando | Resultado |
| --- | --- |
| `cd src-tauri && cargo check` | exit 0 |
| `cd src-tauri && cargo test --lib` | **992 passed / 0 failed / 13 ignored** |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | **127 files / 2354 tests passed** |
| `pnpm build` | exit 0 |

**Parecer de fecho**: o Médio #1 está corrigido; permanecem apenas os baixos
documentados na §11.4 (estado do botão só por cor para videntes, gate de
workspace do ícone, `/goal` com objetivo já existente, rascunho do composer
substituído) e as ressalvas gerais (working tree sem commit/misturada ao goal de
prompt-cache; sem E2E live; sem automação de navegador). Sem commit.

