# Baseline de verificação — plano/tarefas (branch `feat/code-harness`)

- **Data:** 28/10/2026, ~12:47–12:55 (America/Sao_Paulo)
- **Repo:** `H:\ChatTauri`
- **HEAD:** `317e299` — `317e299d0b945b74413f655e16f059a1ececebe0` — “Add Code file preview tabs” (2026-10-28 12:41:36 -0300)
- **Branch:** `feat/code-harness`
- **Working tree inicial:** limpo (`git status --short` vazio)
- **Working tree final:** limpo; única alteração esperada é este relatório (`docs/goals/harness-plan-tasks/analysis-baseline.md`). Nenhum commit feito.
- **Escopo:** verificação somente leitura. Nenhum arquivo de código-fonte foi editado.

## Ambiente

| Item | Valor |
| --- | --- |
| Node | `v24.20.0` |
| pnpm | `10.34.5` (store `H:\.pnpm-store\v10`) |
| rustc | `1.99.0 (b940084d7 2026-09-28)` — `x86_64-pc-windows-msvc` |
| cargo | `1.99.0 (5f94df478 2026-08-27)` |
| PowerShell | 7.6.7 |
| SO | Windows NT 10.0.26200 |
| Python | 3.13.15 (relevante para testes condicionais de `run_code`) |
| Git | 2.55.0.windows.5 |
| `node_modules` | já instalado (não rodei `pnpm install`; lockfile intacto) |
| `src-tauri/target` | já existente e aquecido (build incremental; não foi apagado) |

Logs completos preservados em `%TEMP%`:
`chattauri-baseline-typecheck.log`, `chattauri-baseline-pnpm-test.log`, `chattauri-baseline-build.log`,
`chattauri-baseline-cargo-check.log`, `chattauri-baseline-cargo-test.log`, `chattauri-baseline-auth-retest.log`.

## Comandos da baseline

Tempo total dos comandos: ≈ 172 s (~2 min 52 s).

| # | Comando | Workdir | Status | Tempo | Saída resumida |
| --- | --- | --- | --- | --- | --- |
| 1 | `pnpm typecheck` | `H:\ChatTauri` | **OK** (exit 0) | 5,8 s | `tsc --noEmit` sem erros. |
| 2 | `pnpm test` | `H:\ChatTauri` | **FALHA** (exit 1) — **flake pré-existente** | 130,9 s (suite 126,46 s) | 107 arquivos / **1973 testes: 1965 ok, 8 falhas em 1 arquivo** (`ModelPickerDialog.auth.test.tsx`). |
| 3 | `pnpm build` | `H:\ChatTauri` | **OK** (exit 0) | 8,8 s | `tsc --noEmit && vite build`: 5255 módulos, `dist/` gerado (gitignored), aviso de chunk >1500 kB. |
| 4 | `cargo check` | `H:\ChatTauri\src-tauri` | **OK** (exit 0) | 7,3 s (compile 1,76 s) | 0 erros; **83 warnings** já existentes. |
| 5 | `cargo test --lib` | `H:\ChatTauri\src-tauri` | **OK** (exit 0) | 20,1 s (testes 18,47 s) | **738 testes: 728 passaram, 0 falharam, 10 ignored**. |

## Contagem de testes

| Suíte | Total | Passaram | Falharam | Ignorados/skip |
| --- | --- | --- | --- | --- |
| Rust (`cargo test --lib`) | 738 | 728 | 0 | 10 `#[ignore]` |
| TS/Vitest (`pnpm test`) | 1973 (107 arquivos) | 1965 | **8** (flake, 1 arquivo) | 0 |

### Falha/skip pré-existentes (NÃO confundir com regressão)

1. **`src/components/models/ModelPickerDialog.auth.test.tsx` — 8 falhas apenas na suíte completa.**
   Na suíte cheia o arquivo levou 31,9 s e falhou em `openOpenAiTab` (`getByRole('tab', { name: 'ChatGPT' })` não encontrado, `ModelPickerDialog.auth.test.tsx:115`). Rodando **isolado**, passa **10/10 em 7,6 s** (`pnpm exec vitest run src/components/models/ModelPickerDialog.auth.test.tsx`, exit 0). É flake de carga/tempo (userEvent lento sob concorrência), não relacionado a plano/tarefas. Recomendação: antes de acusar regressão, reexecutar o arquivo isolado.
   Testes que falharam na suíte cheia: “mostra modelos que só existem na conta, com selo Estimado”, “sem conta conectada, mostra Conectar conta ChatGPT e abre Configurações › Provedores”, “conta conectada ao plano…”, “plan-disabled conecta a conta mas pede ativação do plano”, “regressão Go/Zen…”, “favorito por par marca só o provedor certo”, “favorito legado por id…”, “alternar o favorito pelo painel de detalhes grava a chave em par”.
2. **10 testes Rust `#[ignore]`** (todos por dependência externa, não são regressão):
   - 8 `providers::smoke::*` — “real gateway smoke test (needs ~/.local/share/opencode/auth.json)” e 1 Anthropic que exige `ANTHROPIC_API_KEY`.
   - `tools::fetch_url::tests::live_fetch_extracts_readable_page` e `tools::web_search::tests::live_search_parses_results` — rede real.
3. **Testes condicionais** (auto-skip silencioso, não contam como ignored): `tools::code_exec` pula execução Python/JS se o interpretador não existir (`timeout_kills_the_run`, `runs_python_and_collects_generated_artifacts`, `runs_javascript_when_node_is_available`, `integration_*`) e `run_checks_runs_the_detected_command_when_shell_is_available` retorna cedo se shell falhar. Nesta máquina Python 3.13.15 e Node 24.20 estão no PATH, então rodaram de fato.

## Mapa de cobertura — Rust

Arquivos: `src-tauri/src/**` (linhas do módulo de testes).

| Arquivo:linha | Teste | O que cobre |
| --- | --- | --- |
| `policy/mod.rs:321` | `plan_mode_denies_every_mutation_even_in_autonomous` | `plan_mode` força `Deny{PLAN_MODE_ACTIVE}` para mutação mesmo em Autônomo; leitura continua `Allow`. |
| `harness/code/session.rs:267` | `plan_mode_and_plan_view_lifecycle` | liga/desliga `plan_mode` (último evento vence), `submit_plan` → `PlanView{Reviewing}`, `approve_plan` → `Approved` e desliga o modo; `plan_view` reflete. |
| `harness/code/session.rs:288` | `todos_roundtrip_and_validation` | `validate_todos` aceita lista válida; `save_todos`/`todos` roundtrip e status `InProgress`. |
| `harness/code/session.rs:308` | `rejects_duplicate_or_multiple_in_progress` | rejeita conteúdo duplicado (case-insensitive) e >1 `in_progress`; `allow_parallel=true` libera. |
| `harness/code/session.rs:336` | `context_stats_roundtrip` | estatísticas de contexto (não é plano/tarefa). |
| `harness/code/prompt.rs:389` | `plan_mode_and_permission_modes_are_explicit` | prompt do sistema contém “Modo Plano ativo” e “Autônomo”; não contém “Leitura (somente leitura)”. |
| `harness/code/prompt.rs:419` | `todos_are_rendered` | prompt renderiza a lista de tarefas (`[~]`). |
| `harness/code/context.rs:289` | `builds_context_without_workspace` | apenas verifica `plan_mode == false` no default (fraco p/ plano). |
| `tools/code/exec.rs:2724` | `run_command_respects_plan_mode_read_only_and_missing_approval` | `run_command` em `plan_mode` → `PLAN_MODE_ACTIVE`; ReadOnly → `POLICY_DENIED`; sem canal de aprovação → `APPROVAL_UNAVAILABLE`. |
| `tools/code/exec.rs:2844` | `todo_write_validates_saves_and_emits` | `todo_write` salva, presentation `kind:"todos"`, emite `todos_updated`; lista vazia e duplicada → `TOOL_INVALID_ARGS`. |
| `tools/code/exec.rs:2887` | `submit_plan_requires_plan_mode_and_waits_for_review` | fora do modo → `PLAN_MODE_INACTIVE`; aprovação → “Plano aprovado”, `PlanView.Approved`, evento `plan_updated`; negação → feedback na resposta. |
| `tools/code/exec.rs:3042` | `run_checks_reports_missing_project_checks_and_plan_mode` | `NO_CHECKS` sem projeto; `PLAN_MODE_ACTIVE` quando plano ativo. |
| `tools/code/exec.rs:3175` | `todos_and_todo_status_roundtrip_through_the_projection` | projeção de tarefas após `todo_write`. |
| `tools/registry.rs:742` | `tool_exec_resolves_every_code_tool_and_helpers_work` | garante que `ToolCtx` de teste ainda compila; `plan_mode == false` default. |
| `policy/approval.rs:228,240,246,254` | `register_and_resolve_roundtrip`, `resolve_unknown_id_returns_false`, `request_lookup_is_available_for_rule_creation`, `cancel_all_resolves_every_pending_request` | ciclo do registro de aprovação e cancelamento; **não há teste do timeout de `request_interactive`**. |
| `harness/code/tools.rs:141,149` | `parses_arguments_objects_only`, `unknown_tool_is_an_actionable_error` | parsing de argumentos e tool desconhecida; **não há teste do `default_timeout_ms`**. |
| `tools/code/plan.rs` (módulo de testes) | `planning_schemas_are_strict_objects` | só contrato de schema de `todo_write`/`submit_plan`. |
| `harness/mod.rs:745-750` | (sem teste) | emissão de `ProfileChanged` no perfil Code — **não coberta**. |

## Mapa de cobertura — TS/Vitest

| Arquivo (nº de testes) | O que cobre | O que falta |
| --- | --- | --- |
| `src/components/agent/PlanCard.test.tsx` (7) | markdown + 3 ações (`approve_run`, `approve_review`, `keep_planning`), feedback livre opcional, estado `approved` compacto com “Ver plano”, estado `planning` sem ações, `inactive` vazio → `null`. | Nenhum teste de integração do card ligado ao gate (ações reais); nenhum teste do `approve_review` mudando modo de permissão. |
| `src/components/agent/TodoCard.test.tsx` (4) | contadores/“1 de 3”, rótulos acessíveis, `progressbar` (33%), vazio → `null`, singular. | Não cobre duplicação na timeline nem limite/limpeza. |
| `src/components/agent/ToolPresentationCard.test.tsx` (3) | `file_change` (expandir diff), `answers`/`skipped`, `kind:"output"` desconhecido → `null`. | **Não cobre `kind:"plan"` nem `kind:"todos"`** (exatamente os casos do harness). |
| `src/lib/store/__tests__/codeStore.test.ts` (7) | reducers: approvals/resolutions, `todos_updated`, `plan_updated` (`reviewing`→`planMode:true`, `approved`→`false`), changes, context/jobs, `profile_changed` espelha `permissionMode`/`planMode`, questions, `fromSnapshot`. | Nenhuma ação do store (`respondApproval`, `setPlanMode`) é testada; nenhum teste de integração com evento real do backend (`ProfileChanged` fixo). |
| `src/components/composer/CodeSessionControls.test.tsx` (8) | fallback da linha da conversa vs snapshot; menu de permissão (otimista/rollback + toast); toggle de Plano chama API e aplica snapshot; falha → rollback. | Não cobre o que acontece com o toggle quando `profile_changed` chega no turno. |
| `src/components/composer/Composer.code.test.tsx` (19) | menções `@arquivo`, `/limpar`, `/review` (fill), `/commit`, `/plan off` chama `api.setPlanMode(c-1,false)`. | **Não testa `/plan` ativando o modo**; `/plan off` só verifica a chamada da API — não verifica sincronização do `codeStore` (o handler ignora o snapshot devolvido). |
| `src/components/chat/ChatView.test.tsx` (11) | erros de turno/limite de plano; **nenhuma** cobertura de `CodeSessionCards`/plano/tarefas na view. | Integração do gate de aprovação dentro da view. |
| `src/components/chat/AgentSteps.test.tsx` (11) | timeline de raciocínio/tools, duração. | **Nenhuma** cobertura das `presentations` (`plan`, `todos`, `file_change`) renderizadas por `AgentSteps.tsx:231-237`. |
| `src/components/code/CodeAgentWidgets.tsx` (sem teste) | container que liga `approval_requested` (`submit_plan`) → `PlanCard` → `respondApproval`; e `session.todos` → `TodoCard`. | **Zero testes** — é o wiring crítico do gate de aprovação. |

## Lacunas priorizadas (para o Lead não confundir com regressões)

> Todas foram confirmadas por leitura de código; nenhuma foi “corrigida” nesta verificação.

### P0 — risco direto de comportamento errado

1. **Aprovar o plano NÃO libera mutações no mesmo turno.**
   `ToolCtx.plan_mode` é capturado **uma vez** na criação do turno (`src-tauri/src/harness/mod.rs:925-954`, campo em `:941`) e reutilizado por todas as tools do turno (`harness/mod.rs:1126-1129` → `harness/code/tools.rs:58` clona o ctx). A aprovação grava `plan_mode=false` **no banco** (`exec.rs:2320-2324` → `session::approve_plan`), mas `policy_check` continua lendo `ctx.plan_mode` (`exec.rs:560-570`). Resultado: depois de “Plano aprovado — continue a implementação”, `write_file`/`edit_file`/`run_command` seguem negados com `PLAN_MODE_ACTIVE` até o turno seguinte. Nenhum teste cobre o fluxo “aprovar e mutar no mesmo turno”.
2. **Timeout de `submit_plan` (60 s) é menor que o timeout de aprovação (600 s default).**
   `harness/code/tools.rs:34-43` aplica 60 s a `todo_write`/`submit_plan`; `ToolCtx::request_approval` usa `settings.approval_timeout_secs.max(30)` (`tools/registry.rs:137-154`), cujo default é **600 s** (`domain.rs` Settings). Uma revisão humana acima de 60 s vira `TOOL_TIMEOUT` com o card de aprovação ainda pendente/órfão na UI. O teste `submit_plan_requires_plan_mode_and_waits_for_review` responde em milissegundos e não pega isso; caminhos `Expired`/`Cancelled` de `submit_plan` (`exec.rs:2345-2352`) não têm teste.
3. **`ProfileChanged` emite `plan_mode: false` fixo.**
   `harness/mod.rs:742-751` emite `ProfileChanged { plan_mode: false }` no início de todo turno Code, mesmo com a sessão em modo Plano (o valor real está em `code_context.plan_mode`/`plan_mode_active`). O `codeStore` aplica o evento cegamente (`src/lib/store/codeStore.ts:162-167`), então o toggle de Plano da UI é desligado a cada turno. Não há teste do evento nem do backend.

### P1 — funcionalidade sem cobertura / ações mortas

4. **Wiring do gate de aprovação sem teste e `approve_review` sem efeito.**
   `CodeSessionCards` (`src/components/code/CodeAgentWidgets.tsx:71-92`) monta o `PlanCard` a partir de `approval.preview` e traduz ações em `respondApproval`; não existe teste do container nem da ação `respondApproval` do store. Além disso, “Aprovar e revisar cada edição” (`approve_review`) é tratado igual a “Aprovar e executar” (`decide(approval,'approved')`), sem alterar `permissionMode` — a distinção de UI não tem efeito no backend.
5. **`PlanCard` na timeline com ações mortas.**
   `ToolPresentationCard.tsx:27-28` renderiza `kind:"plan"` com `onAction={() => undefined}` e sem indicação de “somente leitura”. O `submit_plan` persiste `presentation {kind:"plan", state:"reviewing"|"approved"}` (`exec.rs:2325-2343`), e `AgentSteps.tsx:231-237` renderiza isso na mensagem: um plano negado (que reenvia com `keep_planning`) deixa botões “Aprovar e executar / Continuar planejando” que não fazem nada. `ToolPresentationCard.test.tsx` não cobre `plan`.
6. **Plano negado não é persistido.**
   No caminho `Denied` (`exec.rs:2332-2343`) não há `session::submit_plan` nem `PlanUpdated`; `plan_view` (`harness/code/session.rs:79-114`) só olha eventos `plan/submitted`/`plan/approved`. Reabrir a sessão não mostra “plano negado/em revisão”, e o `codeStore.plan` fica no valor anterior. Nenhum teste de persistência de negação.
7. **Duplicidade de `TodoCard` (e de plano aprovado).**
   `todo_write` emite `todos_updated` e persiste `presentation kind:"todos"`; `AgentSteps` renderiza um `TodoCard` por apresentação (`AgentSteps.tsx:231-237`) e `CodeSessionCards` renderiza outro a partir de `session.todos` (`CodeAgentWidgets.tsx:123`). Após N chamadas de `todo_write` no turno, a timeline acumula cards + o card fixo. Cenário não coberto por teste de integração (AgentSteps.test não testa presentations).

### P2 — cobertura parcial / limpeza

8. **`/plan` não ativa o modo Plano; `/plan off` não sincroniza o `codeStore`.**
   `src/components/composer/commands.ts:36-44`: `/plan` é `action:'fill'` (só insere texto); só `/plan off` invoca backend. O handler (`Composer.tsx:334-350`) chama `api.setPlanMode(false)` direto e ignora o snapshot retornado (sem `useCodeStore.setState`/refresh), então o pill continua pressionado até um refresh/evento; o backend `set_plan_mode` (`commands/code.rs:312-323`) também não emite evento. O teste `Composer.code.test.tsx:380` só verifica a chamada da API.
9. **Limite/limpeza de tarefas.**
   `validate_todos` rejeita lista vazia (`session.rs:159-161`) → não existe forma de limpar a lista; cap de 50 itens (`:162-164`) sem teste; não há ação de UI para limpar tarefas; a lista persiste entre turnos por design (último evento vence), mas o teste só cobre roundtrip.
10. **Caminhos de timeout/cancelamento de aprovação não testados no nível de tool.**
    `request_interactive` (`policy/approval.rs:167-202`) tem timeout/expiração e `ApprovalRegistry` tem `cancel_all`, mas não há teste do timeout (inclusive “resolve após timeout devolve false”) nem do `submit_plan` retornando `APPROVAL_TIMEOUT`/`APPROVAL_CANCELLED`.

## Riscos de verificação

- **Flake de suíte:** `pnpm test` completo tem 8 falhas em `ModelPickerDialog.auth.test.tsx` (passa isolado). Orçamento de ~131 s; sempre reexecutar o arquivo isolado antes de declarar regressão. Não atribuir a mudanças de plano/tarefas.
- **Target do cargo compartilhado:** `cargo check` (7,3 s) e `cargo test --lib` (20,1 s) estão aquecidos. Em build frio, podem levar minutos; se aparecer “Blocking waiting for file lock”, apenas aguardar. **Nunca** apagar `src-tauri/target`.
- **Rede/PATH:** os 10 tests Rust `#[ignore]` exigem credenciais (`~/.local/share/opencode/auth.json`, `ANTHROPIC_API_KEY`) ou rede e **não** rodam na baseline. Os testes de `run_code`/`run_checks` dependem de Python/Node/shell no PATH; presentes aqui (Python 3.13.15, Node 24.20), mas em ambiente sem eles “passam” sem executar (skip silencioso).
- **Sem automação de UI/navegador:** toda a evidência é de comandos/testes, conforme AGENTS.md.
- **Artefatos de build:** `pnpm build` grava `dist/` (ignorado por `.gitignore:10`); não alterou o working tree.
- **Tempo total da baseline:** ~3 min para os 5 comandos com target aquecido; reservar mais em build frio.
