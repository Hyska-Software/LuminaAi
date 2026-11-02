# Agents platform — evidências

Data: 2026-11-01 (v1.14, working tree).

## Verificações executadas

```text
pnpm typecheck
> tsc --noEmit
(sem erros)

pnpm test (suíte completa final)
Test Files  147 passed (147)
Tests       2546 passed (2546)

pnpm exec vitest run src/components/models/ModelPickerDialog.test.tsx \
  src/components/models/ModelPill.test.tsx
Test Files  2 passed (2)
Tests       57 passed (57)

cd src-tauri && cargo test --lib
test result: ok. 1128 passed; 0 failed; 15 ignored; 0 measured; 0 filtered out

# integração real do backend gráfico (requer Docker + imagem)
docker build -t lumina/computer:test docker/computer
docker run ... lumina/computer:test
docker exec ... xdotool getdisplaygeometry   -> 1440 900
docker exec ... scrot -o /tmp/shot.png       -> PNG 17077 bytes
docker exec ... chromium ... about:blank     -> wmctrl: "about:blank - Chromium"
cargo test --lib docker_graphical_backend_screenshot_and_click -- --ignored
test result: ok. 1 passed; 0 failed
```

## Cobertura nova

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
    (`docker_shell_mounts_the_workspace_and_disables_network_by_default`).
- `src-tauri/src/config.rs`
  - normalização de `executionEnvironment`/`dockerImage` (local/docker, imagem
    vazia volta ao padrão).
- `src-tauri/src/db.rs`
  - CRUD/prompt_version/threads de agente;
  - `agent_memories`, `agent_routines`, `agent_channels` e threads ocultas;
  - uso/custo por agente (`agent_usage_aggregates_tokens_and_cost_per_agent`);
  - paginação e exclusão restrita.
- `src-tauri/src/tools/memory.rs`
  - exigência de agente, save/list/update/forget.
- `src-tauri/src/tools/mod.rs`
  - allowlist de tools no catálogo e na execução.
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
- `src/lib/store/__tests__/agentQueueStore.test.ts`
  - FIFO, pausa/retomada, remoção e limpeza.
- `src-tauri/src/concurrency.rs`
  - limite global, limite por agente, espera/cancelamento e liberação do slot.
- `src-tauri/src/db.rs` (tarefas)
  - criação, claim atômico, transições, handoff, eventos, lease e limite de
    tarefas abertas por dono.
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
- `src-tauri/src/workspace/exec.rs`
  - hardening Docker (cap-drop, no-new-privileges, non-root, read-only,
    tmpfs, limites, mount único, rede off).
- `src/lib/__tests__/conversations.test.ts`
  - sessões de agente escopadas por persona e canais ocultos.
- `src/lib/store/chatStore.ts`
  - concorrência real: dois turnos de agente simultâneos e drenagem da fila da
    thread em segundo plano
    (`mantém dois turnos simultâneos e drena a fila da thread em segundo plano`);
  - erro de segundo plano não vaza para a thread visível; notificação in-app
    respeita `notificationsEnabled`;
  - perfil Code resolvido pela thread (não pelo layout visível) para filas em
    segundo plano.

## Arquivos de contrato

- `docs/AGENTS.md`
- `docs/TASKS.md`
- `docs/COMPUTER.md`
- `docs/DOCKER.md`
- `docs/ARCHITECTURE.md` §3/§5/§8.3.1
- `docs/DESIGN.md` (modo Agentes)
- `docs/goals/agents-platform/PLAN.md`
