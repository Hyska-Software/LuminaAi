# EVIDENCE — Fase 3 (verificação independente + revisão adversarial)

- **Data:** 28/10/2026, ~13:38–13:57 (America/Sao_Paulo)
- **Repo:** `H:\ChatTauri`, branch `feat/code-harness`
- **HEAD:** `317e299` (`317e299d0b945b74413f655e16f059a1ececebe0`) — o trabalho das Fases 0–2 está **não commitado** na working tree (pedido do plano); nenhum commit foi criado nesta fase.
- **Base de comparação:** `analysis-baseline.md` (HEAD `317e299`, tree limpo).
- **Ambiente:** mesmo da baseline — Node `v24.20.0`, pnpm `10.34.5`, rustc/cargo `1.99.0` (x86_64-pc-windows-msvc), Python `3.13.15`, git `2.55.0`. Target cargo aquecido e compartilhado (não foi apagado).
- **Escopo:** somente leitura + comandos; único arquivo escrito nesta fase é este `EVIDENCE.md`.

> **Nota de método:** rodei `pnpm test` concorrentemente com `cargo check`, `cargo test --lib` e `pnpm build` para aproveitar o tempo. Isso **contende CPU** e inflou os tempos (suite TS de 212 s × 126 s na baseline); os números de pass/fail não foram afetados e o flake foi reexecutado isolado.

## 1. Comandos e resultados

| # | Comando | Workdir | Status | Tempo | Números / saída relevante |
| --- | --- | --- | --- | --- | --- |
| 1 | `cargo check` | `src-tauri` | **OK** (exit 0) | 13,65 s (compile 11,51 s) | 0 erros; **76 warnings** (baseline 83). Novo warning: `unused_mut` em `commands/code.rs:90`. |
| 2 | `cargo test --lib` | `src-tauri` | **OK** (exit 0) | 102,40 s (compile 55,65 s + testes 41,79 s) | **760 testes: 750 passed, 0 failed, 10 ignored** (+22 líquidos vs baseline 728). |
| 3 | `pnpm typecheck` | raiz | **OK** (exit 0) | 13,82 s | `tsc --noEmit` sem erros. |
| 4 | `pnpm test` | raiz | **FALHA** (exit 1) — **flake pré-existente** | 217,71 s (suite 212,21 s) | **109 arquivos / 2020 testes: 2005 passed, 15 failed** (2 arquivos: `ModelPickerDialog.auth.test.tsx` 8, `ModelPickerDialog.edge.test.tsx` 7). Nenhuma falha fora desses 2 arquivos. |
| 4b | `pnpm exec vitest run src/components/models/ModelPickerDialog.auth.test.tsx src/components/models/ModelPickerDialog.edge.test.tsx` | raiz | **OK** (exit 0) | 31,96 s | **24/24 passed** isolado. Confirma flake de carga/tempo, não regressão. |
| 5 | `pnpm build` | raiz | **OK** (exit 0) | 50,95 s (vite 28,98 s) | `tsc --noEmit && vite build`; 0 erros; avisos de chunk >1500 kB (pré-existentes). |

**Rust `#[ignore]` (10, inalterados):** 8 `providers::smoke::*` (gateway real/`auth.json`/`ANTHROPIC_API_KEY`), `tools::fetch_url::live_fetch_extracts_readable_page`, `tools::web_search::live_search_parses_results`.

**Comparação com a baseline:** TS 1973 → **2020 testes** (+47); Rust 738 → **760 testes** (+22); TS files 107 → **109** (`CodeSessionCards.test.tsx` e `codeStore.actions.test.ts` novos). Nenhum teste removido sem substituto (ver §3).

### Flake `ModelPickerDialog` — como classificar
- Já existia na baseline (`auth.test.tsx`, 8 falhas na suite cheia, passava isolado).
- Nesta rodada **`edge.test.tsx` também falhou sob carga** (a suite levou 212 s × 126 s da baseline, com `cargo test`/`build` em paralelo). Isolados, **ambos passam**: 24/24 em 32 s.
- Falhas são de timeout/estado de UI (ex.: `getByRole('tab', {name:'ChatGPT'})`, `activeOption()` nulo), não de plano/tarefas. **Não é regressão da rodada.**

## 2. Critérios de aceitação (§1 do PLAN) — matriz critério → evidência

| # | Critério (§1) | Evidência | Status |
| --- | --- | --- | --- |
| 1 | Aprovar/negar plano não quebra a renderização (ao vivo e histórico) | Rust `tools/code/exec.rs::approved_plan_unlocks_mutations_in_the_same_turn_and_is_flat_in_the_card`, `::denied_plan_persists_feedback_and_returns_to_planning`, `::cancelled_plan_review_persists_feedback_and_errors`; TS `ToolPresentationCard.test.tsx` (payload real/legado/aninhado/estado inválido/tarefas malformadas/job malformado; `PresentationBoundary`), `AgentSteps.test.tsx::renderiza a apresentação de plano persistida sem botões de ação`. Normalização flat em `ToolPresentationCard.tsx:59-72`; Rust emite flat em `exec.rs::plan_presentation` (`kind` + `PlanView` camelCase). | **PASSA** |
| 2 | Após “Aprovar e executar”, o mesmo turno executa `write_file`/`edit_file`/`run_command` sem `PLAN_MODE_ACTIVE` | E2E Rust `harness/mod.rs::plan_approval_unlocks_mutations_in_the_same_code_turn` (provider falso + broker: submit_plan → aprovação → `write_file` no passo 2 grava `src/novo.ts`); unidade `exec.rs::approved_plan_unlocks_mutations_...` (mesmo `ToolCtx` sem refresh). Política relê DB por chamada (`exec.rs:560-588`). | **PASSA** |
| 3 | “Aprovar e revisar cada edição” → modo **Revisar**; “Continuar planejando” persiste draft+feedback e volta ao planejamento | Rust `exec.rs::approve_review_switches_to_review_and_writes_ask_approval` (mode `Review`; escrita → `APPROVAL_UNAVAILABLE`, leitura livre), `policy/mod.rs::review_mode_allows_reads_and_asks_for_each_write`, `denied_plan_persists_feedback_and_returns_to_planning` (feedback + `Planning` + draft persistido). TS `PlanCard.test.tsx` (três saídas/feedback), `CodeSessionCards.test.tsx` (`choice` correto). | **PASSA** |
| 4 | Plano editado antes de aprovar é o persistido/visível | Rust `exec.rs::revised_plan_markdown_is_the_persisted_plan` (projeção e presentation) + `commands/code.rs::plan_choice_and_revised_markdown_reach_the_approval_outcome` (trim + outcome) + `validate_plan_choice_rejects_invalid_choice_and_bad_markdown` (vazio/>20k); TS `CodeSessionCards.test.tsx::aprova com o plano editado...`; `PlanCard.tsx:345-388` (textarea, `maxLength`, Ctrl+Enter). | **PASSA** |
| 5 | Gate visível (auto-scroll/badge) e acessível (foco/`Esc`/`alertdialog`/`aria-busy`), sem duplo submit, timeout compatível com revisão humana | TS `ChatView.test.tsx::rola até o gate quando uma aprovação aparece` e `::mostra o gate mesmo sem mensagens`; `CodeSessionHeader.test.tsx` (badge “Aguardando aprovação”); `PlanCard.test.tsx` (`alertdialog`, foco no primário, `Esc`×2, `aria-busy`/busy, duplo submit bloqueado, readOnly); Rust `harness/code/tools.rs::human_review_tools_have_no_runtime_timeout` (`submit_plan`/`ask_user` → `None`; broker com `approval_timeout_secs`, default 600 s), `exec.rs::submit_plan_requires_live_plan_mode`. | **PASSA** |
| 6 | `/plan` ativa o modo; `/plan off` sincroniza chip/store; `profile_changed` reflete o estado real | TS `Composer.code.test.tsx::/plan ativa o modo Plano no codeStore...`, `::/plan não chama o backend quando já ativo`, `::/plan off desativa pelo store (chip sincroniza)`; `codeStore.actions.test.ts` (otimista/rollback); `CodeSessionControls.test.tsx` (modo Revisar, popover). Rust `harness/mod.rs::plan_approval_unlocks_...` assere `planMode:true` e `planMode:false` reais + nota “Atualização de permissões” no prompt; emissão real em `harness/mod.rs:875-884` e por passo em `:1082-1101`. | **PASSA** |
| 7 | Tarefas: máximo 1 `in_progress`; `[]` limpa; subagente sem `todo_write`; UI sem duplicação e com popover/limite de altura | Rust `session.rs::todos_roundtrip_and_validation` (limpeza), `::rejects_duplicate_multiple_in_progress_and_overflow` (1 `in_progress`, cap 50, vazio/duplicado), `exec.rs::todo_write_validates_saves_clears_and_emits` (presentation `items: []`, evento); `prompt.rs::planning_section_renders_feedback_and_respects_the_tool_catalog` (sem `todo_write` no catálogo → sem instrução); spec `tools/code/plan.rs:14-25` (`mutating:false`,`risk:Read`). TS `AgentSteps.test.tsx::mostra apenas a última lista...` (dedupe por mensagem), `CodeSessionCards.test.tsx::não renderiza mais o TodoCard fixo`, `CodeSessionControls.test.tsx` (popover com estado/markdown/feedback/progresso); `max-h`/scroll em `PlanCard.tsx` e `TodoCard`. | **PASSA** (com ressalva de duplicação *entre* mensagens, §4) |
| 8 | `cargo check`, `cargo test --lib`, `pnpm typecheck`, `pnpm test`, `pnpm build` verdes (ressalvado o flake documentado) | §1 acima. `cargo check` 0 erros/76 warnings; `cargo test` 750/750; typecheck/build 0 erros; `pnpm test` 2005/2020 com 15 falhas **apenas** no flake pré-existente, que passa isolado. | **PASSA com a ressalva documentada** |

### 2.1 Correções P0/P1/P2 “corrigir agora” do REVIEW — teste correspondente

| ID (REVIEW) | Correção implementada | Evidência de teste |
| --- | --- | --- |
| B-01 / F-01 | presentation flat + normalização defensiva | `exec.rs::approved_plan_..._flat_in_the_card`; `ToolPresentationCard.test.tsx` (7 novos testes); `PresentationBoundary` |
| B-02 / D6 | política relê DB por chamada; `ToolCtx.plan_mode` removido | E2E `plan_approval_unlocks_mutations_in_the_same_code_turn`; `exec.rs::plan_mode_activated_mid_turn_blocks_writes_immediately`, `::submit_plan_requires_live_plan_mode`; `registry.rs` sem `plan_mode` |
| B-03 | `submit_plan`/`ask_user` fora do timeout curto | `tools.rs::human_review_tools_have_no_runtime_timeout` |
| B-04 / D2/D3/D5 | `PermissionMode::Review`, `choice`/`planMarkdown`, plan options sem regra | `policy/mod.rs::review_mode_...`; `exec.rs::approve_review_...`; `commands/code.rs::approval_is_resolved_once_and_plan_scope_is_rejected`, `::plan_choice_and_revised_markdown_...`; TS `CodeSessionCards.test.tsx` |
| B-05 / D7 | `ProfileChanged` real + nota por passo | E2E `plan_approval_unlocks_...` (prompt `# Atualização de permissões`, eventos true/false); `codeStore.test.ts` reducer |
| B-06 | workspace scope de `approval_rules` | `commands/code.rs::rule_from_request_resolves_the_workspace_scope_id`, `::workspace_scope_rule_is_created_with_the_conversation_workspace`; `exec.rs::workspace_scoped_rule_matches_through_the_live_policy` |
| B-07/B-08/B-14/D4 | ciclo `submitted→feedback→approved`, reativação→`Planning`, `updated_at` de evento | `session.rs::feedback_draft_and_revised_markdown_survive_the_cycle`, `::reactivating_plan_after_approval_starts_a_new_cycle`, `::stale_review_degrades_to_planning_after_turn_end`, `::plan_mode_and_plan_view_lifecycle`; `commands/code.rs::orphan_review_...` |
| B-09 / D9 | projeção única; `commands` delega | Código: `commands/code.rs:48-114` (delega a `harness::code::session`, `build_plan_view` removido), `get_code_session_state` → `session_state`. **Sem teste de serialização** (matriz §4 prometia) → §5 |
| B-10/B-11/B-12/D8 | `todo_write` 1 `in_progress`/`[]`/cap/`mutating:false`; prompt do subagente | `session.rs::rejects_duplicate_multiple_in_progress_and_overflow`; `exec.rs::todo_write_validates_saves_clears_and_emits`; `prompt.rs::planning_section_renders_feedback_and_respects_the_tool_catalog` |
| B-13 | propagar falha de persistência (sem “Plano aprovado” falso) | Código `exec.rs:2383-2394, 2438-2467, 2499-2510`; **sem teste de injeção de falha** → §5 |
| B-16/B-17 | `set_plan_mode` valida conversa; resolve antes de regra/auditoria | `commands/code.rs::set_plan_mode_validates_the_conversation_before_writing`, `::dead_approval_is_rejected_without_rule_or_audit`, `::approval_is_resolved_once_and_plan_scope_is_rejected` |
| F-02/F-10/F-17 | popover plano/tarefas, `session.plan` vivo, toggle otimista | `CodeSessionControls.test.tsx` (4 testes novos), `codeStore.actions.test.ts`, `Composer.code.test.tsx` |
| F-03/F-04 | `/plan` ativa, `/plan off` via store | `Composer.code.test.tsx` (2 testes novos) |
| F-06/F-07 | auto-scroll/badge; `alertdialog`/foco/`Esc`/`aria-busy`/duplo submit | `ChatView.test.tsx`, `CodeSessionHeader.test.tsx`, `PlanCard.test.tsx` |
| F-08/F-09/F-10 | dedupe por mensagem, remover card fixo, popover, `max-h` | `AgentSteps.test.tsx::mostra apenas a última lista...`, `CodeSessionCards.test.tsx::não renderiza mais o TodoCard fixo`, `PlanCard.test.tsx::readOnly recolhe plano longo...` |
| F-11 | `respondApproval === false`/erro → refresh + toast | `codeStore.actions.test.ts` (`false` → toast+refresh), `CodeSessionCards.test.tsx::decisão já resolvida...` |
| F-12/F-13/F-15 | rótulos pt-BR/ícones, contraste por tokens, microcopy | `agentTrace.ts` (+17 grupos de tools, pt-BR); `AgentSteps.test.tsx::rotula as tools do harness em pt-BR` e `::usa ícones específicos...`; tokens usados (nenhum hex novo — §3); **sem teste automatizado de contraste** → §5 |
| F-16/B-15/B-18 e demais P3 | mantidos em backlog documentado no PLAN §6 | conferido (nada foi implementado “pela metade”) |

## 3. Revisão adversarial do diff

`git diff --stat`: **41 arquivos, +3700/−597** (fora untracked: `CodeSessionCards.test.tsx`, `codeStore.actions.test.ts`, `docs/goals/harness-plan-tasks/**`). Escopos respeitados (backend em `src-tauri/src/{harness,tools,policy,commands}`, frontend em `components/{agent,code,composer,chat}` + `lib/agentTrace.ts`, contrato em `domain/types/api/codeStore`, docs do harness). Nenhum arquivo de outra área tocado.

### O que foi checado e passou
- **Testes não foram enfraquecidos:** 149 `assert*` novos vs 12 removidos (Rust); 84 `expect` novos vs 9 removidos (TS). Os 13 casos TS e 3 testes Rust removidos foram **re-escritos/expandidos** (ex.: `todo_write_validates_saves_and_emits` → `..._clears_and_emits`; `submit_plan_requires_plan_mode_and_waits_for_review` → 6 testes de ciclo/gate; `PlanCard` 7→16 casos; `ToolPresentationCard` 3→14). Testes novos têm asserções de conteúdo real (`presentation["kind"]`, arquivo gravado no disco, `permission_mode`, prompt, evento), não smoke vazio.
- **Sem `todo!()`/`unimplemented!()`** em `src-tauri/src` (0 ocorrências).
- **Sem `unsafe`, `@ts-ignore`, `@ts-expect-error`, `any` explícito, `.only`/`it.skip`/`describe.skip`** novos no diff.
- **Sem cor hex solta** nos `.tsx/.ts` alterados (só tokens `background/foreground/border/accent-*`); microcopy em pt-BR nos componentes alterados.
- **Novo `unwrap()/expect()` em Rust está todo em `#[cfg(test)]`** (Fixtures e asserts); produção usa `?`/`map_err`/`ok()`.
- **Contratos doc × código coerentes** para flat plan (`TOOLS §1.1`), `PermissionMode::Review` (`HARNESS §6.1`), `todo_write` `mutating:false`/`[]`/cap (`TOOLS §2.5`), broker timeout 10 min (`TOOLS §4`), três saídas + edição + popover (`WORKBENCH §5.2/5.4/8.3`).
- **`git status`:** apenas as 41 modificações esperadas + 3 itens untracked esperados (`docs/goals/harness-plan-tasks/`, os 2 testes novos). `dist/` é gitignored; nenhum log/patch da verificação entrou no repo (logs em `%TEMP%`; `.research/*.log` são pré-existentes de 27–28/10 00:0x e gitignored).

### Achados da revisão (ordenados por gravidade)

1. **[Baixo — `let _ =` silencioso novo] Persistência do feedback do plano é ignorada nos caminhos `Cancelled`/`Expired`.**
   `src-tauri/src/tools/code/exec.rs:2530` e `:2540`: `let _ = session::plan_feedback(...)`. No caminho `Denied` a falha é propagada (`:2499-2510`), mas cancelamento/timeout engolem erro de persistência — fere parcialmente B-13 e pode perder o feedback sem sinal. Correção barata: usar `Err` → `plan_error(...)` como no `Denied`.
2. **[Baixo — cobertura] B-09 e B-13 sem os testes prometidos na matriz do PLAN §4.**
   - B-09: `get_code_session_state` delega à projeção única (verificado em `commands/code.rs:219-226`), mas **não existe teste de serialização/delegação** (a matriz pedia “teste de serialização”); o `session_state` depende de `AppState`/`State`, então a delegação está garantida por inspeção, não por teste.
   - B-13: a propagação de `SESSION_LOG_FAILED` está no código (`exec.rs:2383-2394, 2446, 2463, 2506`) mas **não há teste de injeção de falha de append** (Fixture não permite falhar o DB). Cobertura = inspeção.
3. **[Baixo — doc] `HARNESS.md` tem uma linha de fluxo desatualizada.**
   `docs/goals/code-harness/HARNESS.md:294` ainda mostra `invoke('respond_approval', { approvalId, decision, scope?, feedback? })`, embora os bullets imediatamente acima (`:284-291`) e o código (`api.ts:183-201`, `commands/code.rs:336-357`) incluam `choice`/`planMarkdown`. Ajustar a linha evita doc×código divergente.
4. **[Baixo — UX/documentado] Duplicação de `TodoCard` *entre* mensagens permanece.**
   `AgentSteps.tsx:128-153` remove só as listas antigas **da mesma mensagem** (teste cobre); cada turno com `todo_write` ainda rende um card na sua mensagem, e o popover do composer repete o estado. É o recorte documentado em `WORKBENCH.md §5.2` (“só o último snapshot por mensagem), não uma promessa de card único global. Registrar como esperado, não bug.
5. **[Informativo — ordenação de efeitos em `respond_approval`] Falha ao criar regra “sempre permitir” ocorre depois de resolver o oneshot.**
   `commands/code.rs:418-436`: resolve (`:418`), depois `rule_from_request`/`state_create_rule`. Um erro aí (ex.: workspace removido entre o pedido e a decisão) retorna `Err` ao renderer **já com a ação aprovada** — a UI mostra toast de erro enquanto a tool já destravou. É o trade-off de B-17 (evitar regra/auditoria para pedido morto); documentar/avaliar inversão (criar regra antes de resolver quebra o outro lado). Baixo impacto (cenário raro) mas merece nota.

### Nit de lint novo
- `commands/code.rs:90` — `let mut plan` desnecessário (`unused_mut`), novo warning de `cargo check` (aceitável pelos critérios, mas trivial de limpar). Contagem total de warnings **caiu** 83 → 76.

## 4. Riscos residuais

1. **Flake de UI sob carga:** `ModelPickerDialog.{auth,edge}` falham na suite cheia quando a máquina está contendedida (evidência: 15 falhas em 212 s; 24/24 isolados em 32 s). Antes de qualquer regressão, reexecutar isolado. A rodada **não** introduziu falhas fora desses arquivos.
2. **Cobertura por inspeção (não por teste):** B-09 (delegação/teste de serialização), B-13 (falha de persistência), contraste AA (só tokens, sem teste automatizado) e a cobertura de rótulos pt-BR de *todas* as 23 tools (testes cobrem um subconjunto em `AgentSteps.test`).
3. **Persistência de feedback silenciosa em cancelamento/timeout** (achado 1) — perda de contexto do plano sem erro visível nesses dois caminhos.
4. **Dependência de ambiente:** 10 testes Rust `#[ignore]` dependem de credenciais/rede; `run_code`/`git` pulam condicionalmente sem Python/Node/git. Nesta máquina rodaram (Python 3.13.15/Node 24.20/git 2.55); em CI sem PATH, a cobertura real cai silenciosamente.
5. **Ordem resolve→regra** (achado 5) e **duplicação entre mensagens** (achado 4) são decisões/trade-offs documentáveis — não bloqueiam a Definição de Pronto, mas devem constar no handoff.

## 5. Itens não atendidos / backlog decorrente

Nenhum item **P0/P1/P2 “corrigir agora”** ficou sem implementação. Dois itens da matriz de testes prometida não têm teste automatizado e foram verificados apenas por inspeção: **B-09 (teste de serialização da projeção única)** e **B-13 (falha de injeção de persistência)**. Achados 1 e 5 acima entram como backlog imediato (baratos). O backlog já registrado no `PLAN.md §6` (B-15, B-18, `TodoItem.id`, kinds `output`/`terminal`, atalhos, tooltip, copy sem workspace) permanece inalterado — sem sinal de implementação pela metade.

**Conclusão da Fase 3:** critérios de aceitação §1 atendidos (item 8 com a ressalva do flake pré-existente); verificação independente reproduziu os números do Lead (Rust 750/750, typecheck/build verdes) e isolou a única falha TS como flake de carga já conhecido. Recomendação: corrigir os achados 1 e 3 (baratos) antes do commit final; aceitar 4/5 como documentados.

---

## Adendo pós-ajustes do Lead (re-verificação final)

- **Data:** 28/10/2026, ~13:45–14:02 (America/Sao_Paulo) — verificação final após os ajustes do Lead.
- **HEAD:** `317e299` (mesma rodada não commitada). `git diff --stat`: **41 arquivos, +3739/−600** (antes dos ajustes: +3700/−597 → **+39/−3** linhas, concentradas em `exec.rs`, `commands/code.rs`, `HARNESS.md`, `ChatView.tsx` e `ChatView.test.tsx`).
- **Escopo:** somente leitura; a única escrita foi este adendo.

### Comandos no estado final

| Comando | Status | Tempo | Números / observação |
| --- | --- | --- | --- |
| `cargo check` | **OK** (exit 0) | 23,29 s (compile 22,80 s; contended com vitest) | 0 erros; **75 warnings** (antes 76). **`unused_mut` de `commands/code.rs:90` sumiu** (varredura do log: 0 ocorrências em `commands/code.rs`); os 2 `does not need to be mutable` restantes (`terminal/mod.rs:178`, `workspace/git.rs:339`) são pré-existentes. Sobra só `unused_variable` em `commands/code.rs:721` (pré-existente). |
| `cargo test --lib` | **OK** (exit 0) | 43,01 s (testes 40,43 s) | **760 testes: 750 passed, 0 failed, 10 ignored** — igual à rodada anterior. |
| `pnpm typecheck` | **OK** (exit 0) | 15,98 s | 0 erros. |
| `pnpm test` | **FALHA** (exit 1) — flake de carga | 218,22 s (suite 213,17 s) | **109 arquivos / 2021 testes: 2002 passed, 19 failed** em 3 arquivos: `ModelPickerDialog.auth` (10), `ModelPickerDialog.edge` (8) e **`LibraryView` (1)** — todas passam isoladas (linha abaixo). `ChatView.test.tsx` **14/14 passed dentro da suíte cheia**. |
| Re-run isolado (3 flaky + ChatView) | **OK** (exit 0) | 22,21 s | **4 arquivos / 79 testes: 79 passed** (auth 10 + edge 14 + LibraryView 41 + ChatView 14) em 20,85 s ⇒ flake de carga, nenhuma regressão. |
| `pnpm build` | **OK** (exit 0) | 41,48 s (vite 21,22 s) | 0 erros; só avisos pré-existentes de chunk. |

### Confirmação dos ajustes do Lead

1. **[Resolvido] Persistência do feedback do plano em `Cancelled`/`Expired` agora propaga erro.**
   `src-tauri/src/tools/code/exec.rs:2528-2562`: os dois braços usam `if let Err(error) = session::plan_feedback(...)` → `return plan_error("SESSION_LOG_FAILED", ..., Some(&reviewing))`, no mesmo padrão do `Denied` (`:2499-2510`). Não há mais `let _ =` no `submit_plan`. Coberto por `cancelled_plan_review_persists_feedback_and_errors` (verde no `cargo test`); a falha de persistência em si segue sem teste de injeção (Fixture in-memory não falha o append) — cobertura por inspeção, mesma ressalva de B-13 já registrada.
2. **[Resolvido] `unused_mut` removido.**
   `src-tauri/src/commands/code.rs:90`: `let plan = ... plan_view(...)` (sem `mut`); o compilador não reporta mais esse warning.
3. **[Resolvido] Doc sincronizada.**
   `docs/goals/code-harness/HARNESS.md:294` agora documenta `invoke('respond_approval', { approvalId, decision, scope?, feedback?, choice?, planMarkdown? })`, alinhada a `src/lib/api.ts:183-201` e `commands/code.rs:336-357`.
4. **[Resolvido — novo ajuste] Gate visível no layout Chat.**
   `src/components/chat/ChatView.tsx:79-87`: `pendingGateCount` conta aprovações/perguntas **sem** guarda de `layoutMode`; no render (`:163-175`) o welcome só aparece com `messages.length === 0 && pendingGateCount === 0`, e `CodeSessionCards` monta quando `layoutMode === 'code' || pendingGateCount > 0`. Teste novo `ChatView.test.tsx:386` — “mantém o gate visível mesmo com o layout Chat selecionado” (conversa Code + `layoutMode='chat'` + aprovação pendente → `alertdialog` “Plano proposto”). **ChatView 14/14 na suíte cheia e 14/14 isolado.**
5. **Sem loop de scroll (verificado por análise + execução):** o efeito de auto-scroll (`ChatView.tsx:131-145`) depende apenas de `activeId`, `pendingGateCount`, `planUpdatedAt`, `reduceMotion` e `scrollToBottom` (`useCallback(..., [])` estável). Ele escreve só refs e chama `scrollToBottom`, cujo `setShowJump(false)` não está nas dependências do efeito ⇒ nenhuma re-execução induzida (sem “Maximum update depth” nem timeout na suíte cheia ou isolado). O scroll automático agora também vale no layout Chat — intencional e idêntico ao do layout Code.

### Higiene final

- `git diff --check`: **limpo** (exit 0; sem whitespace nem conflict markers).
- `git status`: **41 arquivos modificados** (mesmos da Fase 3) + untracked esperados: `docs/goals/harness-plan-tasks/` (EVIDENCE/PLAN/REVIEW/analysis-*), `src/components/code/CodeSessionCards.test.tsx`, `src/lib/store/__tests__/codeStore.actions.test.ts`. `dist/` gitignored; nenhum log/patch/artefato de build entrou no repo (logs em `%TEMP%`). Nenhum commit.

### Riscos atualizados

1. **Flake de carga ampliou a superfície:** além de `ModelPickerDialog.{auth,edge}`, desta vez **1 teste de `LibraryView.test.tsx`** (“mostra o erro de prévia e tenta novamente”) falhou sob carga e passou isolado (79/79 nos 4 arquivos). A suíte cheia ficou em 213 s com execuções pesadas em paralelo; reexecutar isolado antes de classificar regressão. Nada indica relação com plano/tarefas.
2. **Ajuste 1 sem teste de injeção de falha** (persistência de feedback): comportamento garantido por código e pela suíte, mas o caminho `SESSION_LOG_FAILED` de `Cancelled`/`Expired` não é exercitado por teste dedicado — mesma lacuna estrutural de B-13.
3. **Gate no layout Chat em carga fresca:** a cobertura nova cobre troca de layout com sessão já carregada no `codeStore`. Se o app reabrir direto no layout Chat sem snapshot da sessão (nenhum `load` chamado), o gate continua não montado — limitação pré-existente do store, não introduzida por este ajuste; baixa probabilidade (um turno Code ativo implica sessão carregada).
4. **Gate no layout Chat ocupa a área do transcript mesmo com a conversa “não visível” naquele layout** (intencional: pedido pendente tem prioridade), deixando o corpo vazio atrás do card; sem impacto funcional.
5. **Riscos do EVIDENCE original seguem válidos** (B-09 sem teste de serialização, ordem resolve→regra, duplicação de `TodoCard` entre mensagens, dependência de PATH/rede nos testes ignorados); nenhum foi alterado por esta rodada.

**Conclusão do adendo:** os itens endereçados pelo Lead (persistência silenciosa, warning `unused_mut`, doc do `respond_approval`) estão **resolvidos**, e o novo ajuste do gate no layout Chat está correto e coberto, sem loop de scroll. `cargo check`/`cargo test --lib`/`typecheck`/`build` verdes e `pnpm test` limpo fora do flake de carga já documentado — **nada bloqueia o commit final**.
