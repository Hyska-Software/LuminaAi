# Agents platform — evidências

Data: 2026-11-02 (v1.15, working tree).

## Verificações executadas

```text
pnpm typecheck
> tsc --noEmit
(sem erros)

pnpm test (suíte completa final)
Test Files  150 passed (150)
Tests       2559 passed (2559)

pnpm build
✓ built in 5.84s

cd src-tauri && cargo test --lib
test result: ok. 1151 passed; 0 failed; 17 ignored; 0 measured; 0 filtered out

# CDP local completo (abre Chromium/Edge real em teste ignorado)
cargo test --lib local_cdp_browser_navigates_snapshots_and_types -- --ignored
test result: ok. 1 passed; 0 failed

# integração real do backend gráfico (requer Docker + imagem)
docker build -t lumina/computer:test docker/computer
docker run ... lumina/computer:test
docker exec ... xdotool getdisplaygeometry   -> 1440 900
docker exec ... scrot -o /tmp/shot.png       -> PNG 17077 bytes
docker exec ... chromium ... about:blank     -> wmctrl: "about:blank - Chromium"
docker exec ... xclip ... clipboard          -> "hello"
docker run ... which xprop/xclip              -> /usr/bin/xprop, /usr/bin/xclip
cargo test --lib docker_graphical_backend_screenshot_and_click -- --ignored
test result: ok. 1 passed; 0 failed

# run_code em Docker (ignorado por padrão; imagem local)
cargo test --lib docker_mode_runs_node_and_collects_artifacts -- --ignored
test result: ok. 1 passed; 0 failed

# imagem de referência do agente
docker build -t lumina/agent:test docker/agent
docker run --rm --network none --user 1000:1000 --cap-drop ALL \
  --security-opt no-new-privileges lumina/agent:test \
  sh -lc "id -u; node --version; python3 --version; git --version; rg --version | head -1"
1000
v22.23.4
Python 3.11.2
git version 2.39.5
ripgrep 13.0.0
```

## Cobertura nova (2026-11-02)

- `src-tauri/src/computer/mod.rs` + `db.rs` + `commands/computer.rs`
  - container gráfico **por conversa** (`<base>-<conversationId>`), labels,
    noVNC em porta loopback aleatória, cleanup no Stop/boot;
  - pré-auditoria: `begin_computer_action` grava `pending` antes da execução,
    `finish_computer_action` fecha e o boot marca `interrupted`;
  - `computer_drag/scroll/move/wait/clipboard` (clipboard com aprovação e sem
    texto no audit);
  - retenção de screenshots (`prune_old_screenshots`, 24 h);
  - allow/deny de apps (`computerAllowedApps/BlockedApps`);
  - `browserAllowedDomains/BlockedDomains`, private-host switch e bloqueio de
    metadata de nuvem;
  - `computerAllowUnattendedBrowser` para rotinas sem card (desktop fail-closed);
  - testes: `graphical_container_is_isolated_per_conversation`,
    `screenshot_retention_removes_old_files_and_empty_dirs`,
    `computer_audit_pending_action_is_finished_or_interrupted`,
    `backend_follows_execution_environment`.
- `src-tauri/src/computer/browser.rs` + `commands/browser.rs`
  - clique por `Input.dispatchMouseEvent` (box model/scroll into view) e
    digitação por `Input.insertText` (eventos confiáveis);
  - `browser_scroll`, `browser_hover`, `browser_select`, `browser_upload`;
  - takeover do painel: `browser_click_at`, `browser_press_key`,
    `browser_insert_text`, restritos a controle humano;
  - política de hosts aplicada em `browser_open`/navigate/new tab.
- `src/components/chat/ToolCallRow.tsx`
  - screenshots persistidos em `tool-images` aparecem no transcript, com
    `tool_image_preview` restrito ao app-data;
  - teste renderiza a imagem e verifica a chamada restrita.
- `src/components/settings/ToolsTab.tsx`
  - UI de hosts permitidos/bloqueados, private hosts, apps permitidos/bloqueados
    e navegador em rotinas.
- `src/components/agents/AgentPanelBrowser.tsx` + teste
  - clique/digitação no preview quando o humano assume;
  - `AgentPanel.test` cobre toggle, preview/click e dados.
- `src-tauri/src/commands/routines.rs` + `db.rs`
  - `agent_routine_runs`/`list_agent_routine_runs` (histórico de execuções).
- `src-tauri/src/computer/browser.rs` (testes)
  - URL policy + allow/deny/private/metadata;
  - CDP real `#[ignore]` navega, clica/digita e captura frame.
- `src/components/agents/AgentPanel.tsx` + `AgentPanelScreen/Routines/Browser/Data`
  - sidebar direita do layout Agentes (Tela/Rotinas/Navegador/Dados), dock/overlay,
    resize persistido, abas por teclado, sino de atividade;
  - Tela: preview via `computer_preview`, cards “Trabalha em”, “Desktop na nuvem”
    desabilitado como **Em breve**, pausa/assumir controle;
  - Dados: uso, memória, tarefas, fila, conversa e auditoria.
- `src/components/agents/AgentPanel.test.tsx`
  - renderiza ambientes, valida nuvem desabilitada e salva
    `computerEnvironment`/`browserUse`.
- `src-tauri/src/computer/browser.rs` + `commands/browser.rs`
  - sessão Chromium/Edge isolada por conversa, porta CDP loopback, abas,
    navegação/voltar/avançar/reload, screenshot, snapshot com refs, click/type,
    press, extract, tabs, download e take-control;
  - URL policy http/https, bloqueio de `file:`/`chrome:`/`devtools:`/`javascript:`;
  - teste `local_cdp_browser_navigates_snapshots_and_types` (ignorado) abre
    navegador real, navega, clica, digita e captura frame.
- `src-tauri/src/tools/code/computer.rs`
  - tools `browser_navigate/snapshot/click/type/press/wait/extract/tabs/download`;
  - auditoria de browser_type sem texto e gate `is_browser_tool`.
- `src-tauri/src/commands/computer.rs`
  - `computer_preview`, `set_computer_paused`, `computer_take_control`,
    `release_computer_control`; pausa no backend (`COMPUTER_PAUSED`).
- `src-tauri/src/agents/mod.rs` + `db.rs` + `harness/mod.rs`
  - `agents.computer_environment` (`auto`, `private_desktop`, `this_computer`,
    `browser`, `off`) e override por turno.
- `src-tauri/src/commands/routines.rs` + `db.rs`
  - `agent_routine_runs`/`list_agent_routine_runs` para o histórico de execuções.
- `src/components/agents/AgentSidebar.tsx` + `AgentThreadHeader.tsx`
  - alternância entre painel do agente e ferramentas do workspace, ícone de
    ambiente por agente.

- `src-tauri/src/db.rs`
  - auditoria de computer use (`computer_audit_records_actions_without_text_and_counts_limits`):
    sessão/ação, contagem por turno/agente e ausência de texto/segredo;
  - `turn_events` persistidos em ordem e poda
    (`turn_events_are_persisted_in_order_and_pruned`);
  - lease de tarefa renovado só enquanto `running`
    (`agent_tasks_claim_transition_handoff_and_events`);
  - handoff `handoff_pending` fora da fila do scheduler.
- `src-tauri/src/tools/tasks.rs`
  - `handoff_waits_for_target_acceptance_and_is_not_scheduled`: handoff não
    executa até o aceite; dono anterior não aceita; recusa encerra.
- `src-tauri/src/tools/code/computer.rs`
  - `ApprovalDetail::ComputerAction` com alvo/screenshot/tamanho do texto;
  - auditoria antes/depois da ação e rate limit por turno/hora.
- `src-tauri/src/harness/mod.rs`
  - `tool_screenshots_are_persisted_as_paths_and_replayed_only_for_vision_models`:
    JPEG 1280 px em `tool-images`, DB só com caminho, limite de 2/turno,
    replay apenas para modelos com visão.
- `src-tauri/src/providers/{anthropic,openai_chat,openai_responses,google}.rs`
  - teste por protocolo do bloco de imagem no tool result (Anthropic/Responses/
    Google) e mensagem `user` rotulada no Chat Completions.
- `src-tauri/src/commands/tasks.rs`
  - runner multi-turno com orçamento acumulado, heartbeat de lease (5 min),
    cancelamento via `cancel_conversation`, handoff pendente e consolidação do
    resultado final.
- `src-tauri/src/commands/turn.rs`
  - `PersistingEmitter`: todo evento tem `seq`, é gravado em `turn_events` e
    espelhado em `lumina:turn-event`; `list_turn_events` para reattach.
- `src-tauri/src/commands/computer.rs`
  - listagem de ações/sessões, encerramento de sessão e prévia de screenshot
    restrita a `<app-data>/computer`.
- `src-tauri/src/commands/diagnostics.rs`
  - `platform_diagnostics` (versão, turnos ativos, sessões de computer use,
    tarefas abertas por status).
- `src-tauri/src/lib.rs`
  - limpeza no boot de sessões de computer use órfãs e containers
    `lumina.owner=lumina`; label adicionado a `run_code`, terminal e container
    gráfico.
- `src-tauri/src/tools/code_exec.rs`
  - `run_code` em Docker com workspace em `/workspace`, rede off, cap-drop,
    no-new-privileges, limites configuráveis, rootfs read-only, `docker rm -f`
    em timeout/cancelamento e coleta de artefatos.
- `src-tauri/src/terminal/mod.rs`
  - terminal em Docker com hardening, bash/sh fallback, limites e cleanup do
    container (`docker_terminal_uses_hardened_container_flags`).
- `src-tauri/src/agents/mod.rs` + `db.rs` + `harness/mod.rs`
  - `agents.docker_image` (migração aditiva), capability `dockerExecution` como
    gate e override no turno.
- `src/lib/store/chatStore.ts`
  - `reattachTurns()` + `applyExternalTurnEvent` com `localTurnIds` e
    `appliedTurnSeq`; teste de reload no meio do turno;
  - notificações com ação **Abrir**, dedupe de 5 s por categoria e categorias
    aprovação/pergunta/conclusão;
  - `notificationsAllowed` respeita master switch, DND e cada categoria;
  - turnos internos sem eventos persistidos não criam stream fantasma.
- `src/App.tsx`
  - notificações de tarefa com ação **Abrir** e status que precisam de humano
    (`waiting_*`, `handoff_pending`, `review`, `done`, `failed`, `declined`).
- `src/components/settings/GeneralTab.tsx`
  - master switch, DND e toggles de aprovações/perguntas/conclusões/tarefas.
- `src/components/agents/AgentTaskBoardDialog.tsx` + `.test.tsx`
  - quadro kanban global (5 colunas), abrir thread e cancelar com confirmação.
- `src/components/agents/AgentActivityDialog.tsx` + `.test.tsx`
  - turnos ativos, aprovações/perguntas pendentes, tarefas aguardando e
    navegação para a thread correta.
- `src/components/computer/ComputerControlBanner.tsx`
  - banner persistente com agente/thread/backend e **Parar**.
- `src/components/agents/AgentEditorDialog.tsx`
  - imagem Docker por agente, desabilitada sem `dockerExecution`.
- `src/components/settings/ToolsTab.tsx`
  - memória/CPU/pids/rootfs, limites de computer use e botão de diagnóstico.

## Cobertura anterior (v1.14)

- `src-tauri/src/agents/mod.rs`
  - prompt do agente + memória;
  - capabilities/allowlists;
  - rotina (normalização + next_run_at);
  - export document versionado;
  - fallback (par obrigatório/duplicata);
  - revisão conversacional (`apply_agent_revision` + diff por campo);
  - helper de allowlist do perfil Code.
- `src-tauri/src/harness/mod.rs`
  - failover real de rota para o modelo de reserva antes de persistir o turno
    (`agent_turn_uses_the_fallback_route_when_the_primary_is_unavailable`).
- `src-tauri/src/workspace/exec.rs`
  - construção do `docker run` com workspace em `/workspace`, workdir relativo,
    rede desligada por padrão e imagem configurável
    (`docker_shell_mounts_the_workspace_and_disables_network_by_default`);
  - hardening completo (cap-drop, no-new-privileges, non-root, read-only,
    tmpfs, limites, mount único, rede off).
- `src-tauri/src/config.rs`
  - normalização de `executionEnvironment`/`dockerImage` e dos limites de
    memória/CPU/pids.
- `src-tauri/src/db.rs`
  - CRUD/prompt_version/threads de agente;
  - `agent_memories`, `agent_routines`, `agent_channels` e threads ocultas;
  - uso/custo por agente (`agent_usage_aggregates_tokens_and_cost_per_agent`);
  - paginação e exclusão restrita;
  - criação, claim atômico, transições, handoff, eventos, lease e limite de
    tarefas abertas por dono.
- `src-tauri/src/tools/memory.rs`
  - exigência de agente, save/list/update/forget.
- `src-tauri/src/tools/mod.rs`
  - allowlist de tools no catálogo e na execução.
- `src-tauri/src/tools/tasks.rs`
  - delegação → aceite → conclusão, capability `delegation` e ownership.
- `src-tauri/src/computer/mod.rs`
  - seleção local/Docker, escape de SendKeys e denylist de títulos sensíveis;
    screenshot/click/type/key, janelas, UI tree e abertura de browser
    (local/Docker);
  - integração `#[ignore]` real: container Xvfb 1440×900, screenshot PNG,
    clique e Chromium visível via wmctrl.
- `src-tauri/src/policy/mod.rs`
  - `RiskClass::Computer` sempre pede aprovação, inclusive em Autônomo.
- `src-tauri/src/concurrency.rs`
  - limite global, limite por agente, espera/cancelamento e liberação do slot.
- `src/lib/__tests__/conversations.test.ts`
  - sessões de agente escopadas por persona e canais ocultos.
- `src/lib/store/chatStore.ts`
  - concorrência real: dois turnos de agente simultâneos e drenagem da fila da
    thread em segundo plano;
  - erro de segundo plano não vaza para a thread visível; notificação in-app
    respeita `notificationsEnabled`;
  - perfil Code resolvido pela thread (não pelo layout visível) para filas em
    segundo plano.
- `src/lib/store/__tests__/agentQueueStore.test.ts`
  - FIFO, pausa/retomada, remoção e limpeza.
- `src/components/agents/AgentSidebar.test.tsx`
  - menu de thread (renomear/fixar/exportar), gerenciamento, canal e status
    (falha do último turno) por thread.
- `src/components/agents/AgentMemoryPanel.test.tsx`
  - carga, criação, pin, exclusão e estado desligado.
- `src/components/agents/AgentRevisionDialog.test.tsx`
  - revisão por IA mostra o diff e só aplica após confirmação.
- `src/components/agents/TeamView.test.tsx`
  - tokens/custo agregados por agente nos cards da Equipe.
- `src/components/settings/ToolsTab.test.tsx`
  - ambiente Docker, imagem e rede persistem pelas configurações.

## Arquivos de contrato

- `docs/AGENTS.md`
- `docs/TASKS.md`
- `docs/COMPUTER.md`
- `docs/DOCKER.md`
- `docs/ARCHITECTURE.md` §3/§5/§8.3.1
- `docs/DESIGN.md` (modo Agentes)
- `docs/goals/agents-platform/PLAN.md`
