# PLAN — correção do modo Plano e do sistema de tarefas

> Base: [`REVIEW.md`](REVIEW.md) e relatórios de auditoria
> ([backend](analysis-backend.md), [frontend](analysis-frontend.md), [baseline](analysis-baseline.md)).
> HEAD da auditoria: `317e299` (branch `feat/code-harness`). Este plano **implementa** as correções
> P0/P1/P2 selecionadas e deixa o restante explicitamente em backlog.

## 1. Objetivo

Fazer o fluxo `Plano → revisão → aprovação → execução` funcionar de ponta a ponta, sem derrubar a
UI, no mesmo turno, com as três saídas prometidas, plano editável e estado persistido/consistente;
e fazer o sistema de tarefas (`todo_write`/`TodoCard`) ser íntegro (validação, limpeza, sem
duplicação, visível em popover) e acessível.

**Definição de pronto**

1. Aprovar ou negar um plano **não** quebra a renderização (nem ao vivo, nem em histórico antigo).
2. Após `Aprovar e executar`, o mesmo turno executa `write_file`/`edit_file`/`run_command` conforme
   o novo modo, sem `PLAN_MODE_ACTIVE`.
3. `Aprovar e revisar cada edição` muda a sessão para o modo **Revisar** (cada escrita pede
   aprovação); `Continuar planejando` persiste o draft + feedback e devolve o agente ao planejamento.
4. Plano editado antes de aprovar é o plano persistido/visível.
5. O gate é visível (auto-scroll/badge), acessível (foco/`Esc`/`alertdialog`/`aria-busy`), sem
   duplo submit, com timeout compatível com revisão humana.
6. `/plan` ativa o modo; `/plan off` sincroniza chip/store; `profile_changed` reflete o estado real.
7. Tarefas: no máximo 1 `in_progress`, `[]` limpa a lista, subagente não é instruído a usar
   `todo_write`, UI sem duplicação e com popover/limite de altura.
8. `cargo check`, `cargo test --lib`, `pnpm typecheck`, `pnpm test` e `pnpm build` verdes
   (ressalvado o flake pré-existente documentado).

## 2. Decisões de contrato (aplicar antes das trilhas)

| # | Decisão | Contrato |
| --- | --- | --- |
| D1 | Presentation de plano canônica **flat** | `{ kind:"plan", state, markdown?, feedback?, updatedAt }`; renderer normaliza payloads antigos e degrada sem crash |
| D2 | "Revisar cada edição" como novo modo | `PermissionMode::Review` (`"review"`, rótulo "Revisar"): leitura livre; escrita/shell pedem aprovação |
| D3 | Plano editável na aprovação | `respond_approval(..., choice: Option<String>, planMarkdown: Option<String>)`; `ApprovalOutcome` carrega `choice`/`plan_markdown` |
| D4 | Feedback do plano persistido | eventos `plan/submitted`, `plan/feedback`, `plan/approved {markdown, reviewEachEdit}`; `PlanView` ganha `feedback?: string` |
| D5 | Aprovação de plano não cria regra | `submit_plan` usa options próprias (`approve_run`/`approve_review`/`keep_planning`); `respond_approval` rejeita escopo para `submit_plan` |
| D6 | Política relê o estado vivo | `policy_check` lê `plan_mode`/`permission_mode`/`workspace_id` do banco por chamada; `ToolCtx.plan_mode` removido |
| D7 | Loop avisa o modelo quando o modo muda | nota de atualização no system prompt + `ProfileChanged` por passo quando muda |
| D8 | `todo_write` é estado de sessão | `mutating:false`, `risk:Read`; `[]` permitido; 1 `in_progress`; cap 50 documentado |
| D9 | Projeção única | `harness::code::session` é a única projeção; `commands/code.rs` delega |

## 3. Fases, donos e escopos de escrita

### Fase 0 — Camada de contrato (Lead) — **pré-requisito das demais**

Escopos: `src-tauri/src/domain.rs`, `src/lib/types.ts`, `src/lib/api.ts`,
`src/lib/store/codeStore.ts`, `docs/goals/harness-plan-tasks/**`.

- [x] `domain.rs`: `PlanView.feedback`; `PermissionMode::Review` (+`as_str`/`from_str`).
- [x] `types.ts`: `PermissionMode` + `'review'`; `PlanView.feedback`; `ToolPresentation` plano flat;
      tipos de `respondApproval` (`choice`/`planMarkdown`).
- [x] `api.ts`: `respondApproval` envia `choice`/`planMarkdown`.
- [x] `codeStore.ts`: `respondApproval` propaga `choice`/`planMarkdown` e faz `refresh` após decisão
      de plano; `setPlanMode` otimista com rollback + toast (paridade com `setPermissionMode`).

### Fase 1 — Backend (harness-auditor)

Escopo: `src-tauri/src/{harness/**,tools/**,policy/**,commands/code.rs}` (não editar `domain.rs`
sem pedir ao Lead).

- [x] **B-01**: `submit_plan` emite `presentation` flat com `PlanView` completo (aprovado e negado).
- [x] **B-02/D6**: `policy_check` relê plano/permissão/workspace do DB; remover `ToolCtx.plan_mode`
      (ajustar construtores/testes); `submit_plan` lê o modo vivo.
- [x] **B-03**: remover `submit_plan` do `default_timeout_ms` (broker controla), teste da função.
- [x] **B-04/D2/D3/D5**: `ApprovalOutcome` (`choice`, `plan_markdown`), `respond_approval` (args,
      validação de escopo/choice/markdown, resolver antes de auditar/regra), options de plano,
      `submit_plan` aplica `approve_run`→`Edit`/`approve_review`→`Review`, persiste markdown editado,
      emite `ProfileChanged`.
- [x] **B-05/D7**: `ProfileChanged` no início do turno com `plan_mode` real; revalidação por passo +
      nota de atualização no prompt; `set_plan_mode` valida conversa e usa a projeção; `PlanUpdated`
      em submit/feedback/approve.
- [x] **B-06**: `PolicyContext.workspace_id` a partir da conversa; `rule_from_request` resolve
      `scope_id` do workspace em `respond_approval` (erro se não houver workspace).
- [x] **B-07/B-08/B-14/B-09/D4/D9**: ciclo `plan/submitted → plan/feedback → plan/approved`,
      `plan_view` único (mode/seq/turn-ended, `updated_at` do evento, reativação → `Planning`),
      `commands/code.rs` passa a delegar para `harness::code::session` (remover cópia).
- [x] **B-13**: propagar falhas de persistência (sem "Plano aprovado" falso).
- [x] **B-10/B-11/B-12/D8**: `todo_write` valida 1 `in_progress`, aceita `[]`, `mutating:false`;
      remover `allow_parallel_todos`; prompt condiciona `todo_write` ao catálogo (subagente sem a
      menção); doc/TOOLS mantém cap 50.
- [x] **B-16/B-17**: `set_plan_mode` valida conversa antes de gravar; `respond_approval` não
      persiste regra/auditoria se o pedido morreu.
- [x] Testes: ciclo do plano, presentation contract, aprovação→mutação no mesmo turno (provider
      falso + broker), `Review` pedindo aprovação de escrita, timeout, `ProfileChanged`,
      `todo_write` (limpar/1 `in_progress`/cap), política de workspace, projeção única.

### Fase 2 — Frontend (ui-auditor)

Escopo: `src/components/{agent,code,composer,chat}/**`, `src/lib/agentTrace.ts`.
Não editar `types.ts`/`api.ts`/`codeStore.ts` (Fase 0/Lead); pedir ajuste ao Lead se faltar contrato.

- [x] **F-01/F-22**: `ToolPresentationCard` normaliza plano flat → `PlanView`; guarda de shape +
      `ErrorBoundary` por apresentação; `PlanCard` nunca recebe `undefined` (payload antigo degrada).
- [x] **F-07**: `PlanCard`-gate com `role="alertdialog"`, `aria-labelledby`, foco no botão primário,
      `Esc` (fecha feedback/continua planejando), `aria-busy`/`responding` desabilitando ações,
      anúncio `aria-live` curto.
- [x] **F-02/D3**: `CodeSessionCards` envia `choice` (`approve_run`/`approve_review`) e feedback;
      `PlanCard` ganha "Editar plano antes de aprovar" (textarea, validação ≤ 20 000, markdown no
      approve); `readOnly` para timeline (sem botões mortos); feedback visível.
- [x] **F-03**: `/plan` ativa o modo pelo `codeStore` (mantendo o preenchimento) e `/plan off` usa o
      store (chip sincroniza).
- [x] **F-06**: auto-scroll quando aprovações/plano aparecem; badge "Aguardando aprovação" no
      header/tab; gate montado de forma consistente.
- [x] **F-08/F-09/F-10**: dedupe de `todos` por mensagem na timeline; remover `TodoCard` fixo do fim
      do ChatView; popover de plano/tarefas no composer (estado + markdown + status dos todos);
      `max-h`/scroll nos cards; colapsar quando longo.
- [x] **F-11**: tratar `respondApproval === false`/erro com refresh + toast; refresh após decisão de
      plano (store da Fase 0).
- [x] **F-12/F-13/F-15**: labels/ícones pt-BR para tools do harness; contraste AA
      (`foreground-muted` em metadados, chip ativo com contraste); microcopy pt-BR.
- [x] **F-17**: toggle Plano otimista (store) refletido no chip.
- [x] Testes: `ToolPresentationCard` (payload real + legado + malformado), `PlanCard`
      (readOnly/busy/edit/feedback/a11y), `CodeSessionCards` (3 ações/duplo clique/refresh),
      `Composer` (`/plan`, `/plan off`), `CodeSessionControls` (modo Revisar, popover, otimismo),
      `AgentSteps` (presentations dedupe), `agentTrace` (labels).

### Fase 3 — QA/verificação (qa-verifier)

Escopo: somente leitura + comandos; sem editar código.

- [x] `cargo check` + `cargo test --lib`; `pnpm typecheck` + `pnpm test` + `pnpm build`.
- [x] Reexecutar isolado o flake `ModelPickerDialog.auth.test.tsx` se falhar na suíte.
- [x] Revisão adversarial: conferir diff contra este plano, procurar regressões, validar critérios
      de aceitação §1, checar `git status` (sem artefatos).
- [x] Escrever `EVIDENCE.md` da rodada (comandos, números, resultados por critério).

## 4. Matriz de testes por correção

| Correção | Teste novo/atualizado |
| --- | --- |
| B-01 presentation | Rust: `submit_plan` approved/denied → `presentation.kind/plan.state/markdown`; TS: payload real, legado e malformado não derruba |
| B-02 aprovação no turno | Rust: fluxo loop com provider falso, `submit_plan` aprovado via broker e `write_file` no passo seguinte grava; plano ligado no meio do turno → `PLAN_MODE_ACTIVE` |
| B-03 timeout | Rust: `default_timeout_ms("submit_plan") == None`; broker expira em `APPROVAL_TIMEOUT` |
| B-04 saídas | Rust: `approve_run`→`Edit`; `approve_review`→`Review` (escrita seguinte pede aprovação); markdown editado persistido; TS: `CodeSessionCards` envia `choice` correto |
| B-05/D7 profile | Rust: turno com Plano ativo emite `planMode:true`; nota de atualização no prompt após mudança; TS: reducer mantém/atualiza conforme evento real |
| B-06 workspace | Rust: `decide` com `workspace_id`; regra de workspace criada com `scope_id` correto e aplicada |
| B-07/B-08/B-14/D4 | Rust: fold `submitted→feedback→submitted→approved`, reativação do modo → `Planning`, `updated_at` do evento; TS: popover mostra estado/feedback |
| B-09 projeção | Rust: `get_code_session_state` usa a projeção única (teste de serialização); remover cópia |
| B-10/B-11/B-12/D8 | Rust: `todo_write([])` limpa + evento; 2 `in_progress` → erro; prompt de subagente sem `todo_write`; TS: card vazio oculto |
| B-13/B-16/B-17 | Rust: falha de append → erro (sem "aprovado"); `set_plan_mode` id inválido → erro sem evento; `respond_approval` id morto → `Err` sem regra/auditoria |
| F-03/F-04/F-17 | TS: `/plan` chama store e chip liga; `/plan off` desliga o chip; `setPlanMode` otimista/rollback |
| F-06/F-07 | TS: foco inicial, `Esc`, `aria-busy`, duplo clique 1 chamada, scroll no gate, badge |
| F-08/F-09/F-10 | TS: dedupe de `todos`, sem card fixo duplicado, popover plano/tarefas, `max-h` |
| F-11 | TS: `respondApproval` false → refresh/toast |
| F-12/F-13/F-15 | TS: labels pt-BR/ícones; microcopy; contraste via tokens |

## 5. Verificação

- `cd src-tauri && cargo check && cargo test --lib`
- `pnpm typecheck && pnpm test && pnpm build`
- Revisão do diff pelo Lead + QA independente (qa-verifier), sem automação de navegador
  (AGENTS.md). Evidência em `EVIDENCE.md`.

## 6. Backlog documentado (não entra nesta rodada)

`B-15` (`PlanState::Inactive`), `B-18` (stubs F0), centralização de `ToolSpec.risk/mutating` na
política, linha de decisão resolvida (F-11), `TodoItem.id` (F-16), kinds `output`/`terminal` (F-18),
atalhos `Shift+Tab`/`Ctrl+.` (F-19), tooltip duplicado (F-20), placeholder sem workspace (F-21).

## 7. Resultado da execução (2026-10-28)

Fases 0–3 concluídas na working tree (sem commit, conforme o pedido). Evidência completa em
[`EVIDENCE.md`](EVIDENCE.md).

| Fase | Dono | Resultado |
| --- | --- | --- |
| 0 — contrato | Lead | `PlanView.feedback`, `PermissionMode::Review`, presentation flat, `respond_approval` com `choice`/`planMarkdown`, `codeStore` otimista/refresh; testes `codeStore.actions` |
| 1 — backend | harness-auditor | `cargo check` OK; `cargo test --lib` **760 testes: 750 passed / 0 failed / 10 ignored** (+22 vs baseline); todos os IDs B-01…B-17 do escopo corrigidos |
| 2 — frontend | ui-auditor | `pnpm typecheck` OK; 525 testes focados verdes; suíte completa com falhas apenas no flake conhecido; todos os IDs F-01…F-17 corrigidos |
| 3 — QA | qa-verifier | verificação independente + revisão adversarial; 8/8 critérios §1 atendidos; 149 asserts Rust e 84 expects TS novos, sem testes enfraquecidos |
| Final — Lead | Lead | 3 achados do QA corrigidos (propagação de `plan_feedback` em cancel/timeout, warning `unused_mut`, doc do `respond_approval`) + gate de aprovação independente de layout (com teste); re-verificação final solicitada ao QA |

**Gaps de cobertura residuais (documentados, não bloqueiam):** B-09 sem teste de serialização da
projeção única (delegação verificada por inspeção) e B-13 sem teste de injeção de falha de append.
Trade-offs aceitos: `respond_approval` resolve o oneshot antes de criar regra/auditoria (pedido morto
nunca gera efeito colateral; falha rara ao criar regra pode reportar erro com a ação já aprovada);
`TodoCard` por mensagem continua (dedupe apenas dentro da mensagem, como documentado em
`WORKBENCH.md` §5.2).
