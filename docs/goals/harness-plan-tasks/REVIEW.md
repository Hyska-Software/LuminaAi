# REVIEW — modo Plano e sistema de tarefas do harness de código

- **Data:** 2026-10-28
- **Repositório:** `H:\ChatTauri`, branch `feat/code-harness`, HEAD `317e299`
- **Escopo:** implementação do harness de código (`src-tauri/src/harness/**`, `tools/**`,
  `policy/**`, `commands/code.rs`) e interfaces do modo Plano e das tarefas
  (`src/components/{agent,code,composer,chat}`, `src/lib/{store,types,api}`).
- **Documentos-base:** `docs/goals/code-harness/{HARNESS,TOOLS,WORKBENCH,PLAN}.md`.
- **Relatórios completos (evidência arquivo:linha):**
  [`analysis-backend.md`](analysis-backend.md) (18 achados),
  [`analysis-frontend.md`](analysis-frontend.md) (21 achados),
  [`analysis-baseline.md`](analysis-baseline.md) (build/testes e lacunas de cobertura).

## Sumário executivo

A feature está **funcionalmente quebrada nos dois caminhos centrais**:

1. **Aprovar/negar um plano derruba a interface.** `submit_plan` persisted
   `presentation = {kind:"plan", state:…}` (flat, sem `markdown`), enquanto o renderer espera
   `{kind:"plan", plan: PlanView}`. `ToolPresentationCard` passa `undefined` ao `PlanCard`, que
   desreferencia `plan.markdown` → `TypeError` → `ErrorBoundary` global. O payload é persistido:
   reabrir uma sessão que já revisou plano derruba a UI de novo.
2. **Aprovar um plano não libera a execução no mesmo turno.** `ToolCtx.plan_mode` é um `bool`
   congelado no início do turno; a aprovação grava `plan/mode=false` só no banco, e o próximo passo
   mutante recebe `PLAN_MODE_ACTIVE`. Na prática "Aprovar e executar" só vale no turno seguinte —
   contra `WORKBENCH.md` §5.4/§8.3 e o próprio resultado devolvido ao modelo.

Ao redor disso, o gate de plano não é descobrível (fica fora da viewport, sem auto-scroll/badge), o
timeout da tool (60 s) mata a revisão humana (600 s), as duas opções de aprovação têm o mesmo efeito,
`/plan` não ativa o modo, `/plan off` dessincroniza o chip, o plano só é persistido se aprovado e a
projeção existe duplicada com uma cópia já divergente. Nas tarefas, `todo_write` aceita múltiplos
`in_progress`, não pode limpar a lista, tem metadados de risco decorativos e a UI mostra a lista
duplicada (N snapshots na timeline + card fixo).

## Baseline (HEAD `317e299`, tree limpo)

| Comando | Status | Resumo |
| --- | --- | --- |
| `pnpm typecheck` | OK | 0 erros |
| `pnpm test` | falha pré-existente | 1973 testes, 8 falhas em `ModelPickerDialog.auth.test.tsx` (flake; arquivo passa 10/10 isolado) |
| `pnpm build` | OK | Vite OK |
| `cargo check` | OK | 0 erros, 83 warnings pré-existentes |
| `cargo test --lib` | OK | 738 testes: 728 ok, 10 `#[ignore]` (credenciais/rede) |

## Achados consolidados

> IDs `B-*` vêm da auditoria de backend e `F-*` da auditoria de frontend (detalhe e evidência nos
> relatórios). "Status" define o que entra **nesta correção**; o restante vira backlog documentado
> em [`PLAN.md`](PLAN.md).

### P0 — corrigir obrigatoriamente

| ID | Achado | Status |
| --- | --- | --- |
| B-01 / F-01 | `presentation` de plano fora do contrato → crash do app ao aprovar/negar e ao reabrir sessões com plano | **corrigir agora** (contrato + guarda defensiva + teste) |
| B-02 | `plan_mode` congelado no `ToolCtx`: aprovação não libera mutações no mesmo turno; ligar plano no meio do turno não bloqueia | **corrigir agora** (política lê estado vivo; aviso ao modelo por passo) |

### P1 — corrigir nesta rodada

| ID | Achado | Status |
| --- | --- | --- |
| B-03 | `submit_plan` dentro do timeout de 60 s × revisão humana de 600 s → `TOOL_TIMEOUT`, card fantasma | corrigir agora |
| B-04 / F-02 | Três saídas do plano não representáveis: `approve_review` ≡ `approve_run`; sem modo "revisar cada edição"; plano revisado é ignorado | corrigir agora (novo `PermissionMode::Review`, `choice` + `planMarkdown` em `respond_approval`) |
| B-05 / F-05 | `ProfileChanged` com `plan_mode:false` fixo no início do turno; sem `PlanUpdated` ao entrar/sair | corrigir agora |
| B-06 | "Sempre permitir neste workspace" nunca casa (`workspace_id: None` + `scope_id` nulo) | corrigir agora (correção pequena no mesmo fluxo de aprovação) |
| B-07 / B-08 / B-14 | Draft do plano não persistido; negação sem evento/plano; reativar Plano depois de aprovar devolve `Approved`; `updated_at` instável | corrigir agora (ciclo `submitted → feedback → approved` e fold único) |
| B-09 | Projeção `PlanView`/`todos` duplicada em `harness/code/session.rs` × `commands/code.rs` | corrigir agora (uma implementação; `commands` delega) |
| B-13 | `let _ =` engole falha de persistência e ainda responde "Plano aprovado" | corrigir agora |
| F-03 | `/plan` não ativa o modo Plano (só insere texto) | corrigir agora |
| F-04 | `/plan off` chama `api` direto e não sincroniza o `codeStore`/chip | corrigir agora |
| F-06 | Gate de plano fora da viewport, sem auto-scroll/badge — revisão expira sem o usuário ver | corrigir parcialmente (auto-scroll + montagem; badge no header) |
| F-07 | Gate do plano sem `alertdialog`/foco/`Esc`/`aria-busy`; duplo submit | corrigir agora |
| F-02/F-10 | `session.plan` morto; card `planning` inalcançável; popover de plano/tarefas ausente | corrigir agora (popover no composer) |
| F-11 | Falha/timeout de aprovação não refresca e é silenciosa | corrigir agora (tratar `false`/erro + refresh) |

### P2 — corrigir nesta rodada (barato e visível)

| ID | Achado | Status |
| --- | --- | --- |
| B-10 / B-11 | `todo_write` `mutating:true` sem `policy_check`; prompt do subagente manda usar `todo_write` inexistente; `allow_parallel_todos` morto; regra "1 `in_progress`" não aplicada | corrigir agora (`mutating:false`, validação única, prompt condicionado ao catálogo) |
| B-12 | Não é possível limpar tarefas (`todos: []` é erro); cap de 50 não documentado | corrigir agora |
| B-16 / B-17 | `set_plan_mode` grava evento sem validar conversa; `respond_approval` persiste regra/auditoria antes de saber se o pedido existia | corrigir agora |
| F-08 / F-09 | `TodoCard` duplicado (timeline N× + card fixo) e cards sempre expandidos/sem limite de altura | corrigir agora (dedupe na timeline, remover card fixo, popover, `max-h`/scroll) |
| F-12 | Tools de código sem rótulos pt-BR/ícones na timeline ("Executou submit plan") | corrigir agora |
| F-13 / F-15 | Contraste AA em metadados (3,1–3,8:1) e microcopy (terceira pessoa/inglês/"arquivo(s)") | corrigir agora |
| F-17 | Toggle Plano sem atualização otimista/rollback (vizinho de permissão tem) | corrigir agora |

### P3 / backlog (registrado, fora desta implementação)

| ID | Achado | Motivo |
| --- | --- | --- |
| B-15 | `PlanState::Inactive` inalcançável | decidir contrato depois (snapshot `Option` é aceitável) |
| B-18 | Stubs F0 `not_wired` em `tools/code/plan.rs` | limpeza sem impacto funcional; o critério "sem stubs" já é coberto por `cargo check` |
| F-11 (linha resolvida) | Decisão aprovada não vira linha "Permitido/Negado" | requer ampliar o store; não bloqueia o plano |
| F-16 | `TodoItem` sem `id` | contrato do PLAN; sem impacto atual |
| F-18 | kinds de presentation sem UI (`output`/`terminal`) | documental; a guarda defensiva evita crash |
| F-19 | Atalhos `Shift+Tab`/`Ctrl+.` | atalho opcional, sem bloqueio |
| F-20 | `title` + `Tooltip` duplicados / `relativeTime` congelado | parte já corrigida com `updated_at` estável; tooltip fica no backlog |
| F-21 | Placeholder sem workspace divergente | copy, não funcional |
| B-10 (centralização) | `ToolSpec.risk/mutating` não governam a política; cada tool chama `policy_check` | refactor estrutural maior; registrado como dívida |

## Mismatches doc ↔ código relevantes

| Doc | Promete | Realidade | Correção |
| --- | --- | --- | --- |
| HARNESS §6.1/§6.2 | modo informado ao modelo; plano + mutante → DENY | `ToolCtx`/prompt congelados no turno; `todo_write` mutante sem gate | B-02/B-10 |
| WORKBENCH §5.4 | 3 saídas + plano editável + popover do chip | duas aprovações idênticas; sem modo revisão; sem popover | B-04/F-02/F-10 |
| WORKBENCH §8.3/§12; HARNESS §6.1; PLAN F5 | `/plan [instrução]` entra no modo Plano | `/plan` só preenche texto | F-03 |
| WORKBENCH §5.2/§5.4 | cards sob demanda, tarefas com popover | cards sempre abertos; sem popover; duplicados | F-08/F-09/F-10 |
| TOOLS §2.5 | 1 `in_progress` no modo normal; `submit_plan` publica plano para revisão | sempre permite múltiplos; draft só persiste na aprovação; timeout de 60 s | B-07/B-11/B-12/B-03 |
| TOOLS §1.1 | presentation de plano flat com `markdown` | flat **sem** `markdown`; TS aninhado | B-01/F-01 |
| HARNESS §11.2 | projeção única, "nenhuma tela recalcula" | duas projeções (uma delas divergente) | B-09 |
| WORKBENCH §8.4 | "Sempre permitir neste workspace" funciona | regra nunca casa | B-06 |

## Decisões de contrato (fechadas pelo Lead)

1. **Aprovação destrava o mesmo turno.** Política relê `plan_mode`/`permission_mode` do banco a cada
   tool call; o loop avisa o modelo no próximo passo (nota de atualização no system prompt). A
   aprovação continua bloqueando o turno até a decisão (comportamento atual).
2. **"Aprovar e revisar cada edição" vira `PermissionMode::Review`** ("Revisar"): leitura livre,
   cada escrita/permissão de shell pede aprovação. `approve_run` leva a `Edit`, `approve_review` a
   `Review`; ambas desligam o modo Plano. É a única forma honesta de cumprir a promessa do card.
3. **Plano editável antes de aprovar** via `planMarkdown` em `respond_approval` (não reciclar
   `feedback`, que já é o canal do "continuar planejando"). O markdown aprovado é o persistido.
4. **Presentation canônica do plano = flat** (`{kind:"plan", state, markdown?, feedback?,
   updatedAt}`), alinhada a TOOLS §1.1. O renderer aceita payloads antigos e degrada sem crash.
5. **`todo_write` é estado de sessão, não mutação de workspace** (`mutating:false`, `risk:Read`):
   continua permitido no modo Plano, agora com no máximo um `in_progress` e aceitando `[]` para
   limpar. Subagentes continuam sem `todo_write` e o prompt do filho não menciona a tool.
6. **Feedback do plano é persistido** (`plan/feedback`) e o fold do `PlanView` usa `seq` de
   `plan/mode`/`submitted`/`feedback`/`approved`/`turn/ended`; `updated_at` vem sempre do evento.
7. **Aprovações de plano não criam regra "sempre permitir"**: options específicas
   (`approve_run`/`approve_review`/`keep_planning`), sem escopos; `respond_approval` rejeita escopo
   para `submit_plan`.

## Riscos

- **Contrato compartilhado**: `ApprovalOutcome`/`respond_approval`/`ToolPresentation`/
  `PermissionMode` cruzam backend e renderer — a camada de contrato é aplicada pelo Lead **antes**
  das duas trilhas de implementação.
- **Histórico persistido**: mensagens antigas com `presentation` flat inválido precisam continuar
  renderizando (guarda + `ErrorBoundary` por apresentação), não só a emissão nova.
- **`PermissionMode::Review`** é valor novo em coluna `TEXT` já existente; conversas antigas não
  são afetadas e versões anteriores fazem fallback para `edit` (compatível para frente).
- **Cargo target compartilhado**: implementação Rust roda em uma trilha; QA não pode rodar cargo em
  paralelo (lock). Baseline aquecida: `cargo test --lib` ≈ 20 s.
- **Flake conhecido**: `ModelPickerDialog.auth.test.tsx` pode falhar na suíte cheia; reexecutar
  isolado antes de declarar regressão.

## Próximo passo

[`PLAN.md`](PLAN.md) — plano de correção com fases, donos, escopos de escrita, critérios de
aceitação e matriz de testes.

## Status final

Todos os achados **P0/P1/P2 marcados "corrigir agora"** foram implementados e verificados
(Fases 0–3). Evidência independente em [`EVIDENCE.md`](EVIDENCE.md); resultado consolidado e
backlog em [`PLAN.md` §7](PLAN.md). O trabalho está na working tree, **sem commit**.

