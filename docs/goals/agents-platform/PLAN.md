# Agents platform — plano e estado (v1.14)

> Objetivo: deixar o layout **Agentes** comparável ao OpenBot (local-first) e
> cobrir os recursos centrais do Grok Bot que fazem sentido no desktop local:
> personas, memória, workspace, fila, rotinas, canais, templates e
> portabilidade. Contrato final: `docs/AGENTS.md`.

## F0 — Estabilização (concluído)

- [x] Menu por thread: fixar, renomear, exportar e excluir.
- [x] “Ver todas as conversas” por agente (lista completa).
- [x] Diálogo “Gerenciar agentes” com ativos, arquivados e importar.
- [x] Painéis de artefatos/fontes no layout Agentes; painel de workspace nas
      threads de agente com workspace.
- [x] Paleta escopada por `activeAgentId`; `openConversation` troca a persona.
- [x] Editor com abas (identidade/modelo/comportamento/capabilities/memória) e
      raciocínio editável.
- [x] Abas centrais de diff/arquivo/plano/commits/objetivo para agentes com
      workspace.
- [x] Testes de UI da sidebar e da memória; testes Rust de DB, prompt,
      capabilities, rotinas, canais e export.
- [x] Documentação (`docs/AGENTS.md`, ARCHITECTURE/DESIGN).

## F1 — Configuração e memória (concluído)

- [x] Capabilities reais (web, arquivos, execução, skills, tools, MCP) no
      catálogo, na execução e no conteúdo.
- [x] Memória durável por agente (`agent_memories`), ferramenta `memory` no Chat
      e no Code, UI de CRUD e injeção volátil com orçamento/revisão.
- [x] Atividade por agente na Equipe (threads e última atividade).
- [x] Uso/custo por agente agregado de `usage_log`
      (`get_agent_usage`/`list_agent_usage`) na Equipe e na home.
- [x] Workspace/permission mode no agente e no editor.

## F2 — Workspace, fila e rotinas (concluído)

- [x] Agente com workspace roda o perfil Code (FS/shell/git/jobs/plano/
      aprovações/journal), com prompt de persona e snapshot key própria.
- [x] Concorrência real: `chatStore.streamsByConversation` mantém um stream por
      conversa; várias threads de agente rodam ao mesmo tempo e `streaming` é só
      a fatia visível de `activeId`.
- [x] Fila FIFO por thread persistida, com pausar/retomar/remover/limpar,
      drenagem no `done` da própria thread (inclusive em segundo plano),
      retomada de filas persistidas e contador na sidebar.
- [x] Rotinas (intervalo/Diário) com agendador Rust enquanto o app está aberto,
      thread dedicada, execução manual, status/erro e evento de UI.
- [x] Modelo de reserva por agente (`fallbackProviderId`/`fallbackModelId`) com
      failover de rota antes de persistir o turno.
- [x] Execução de comandos/jobs no PC do usuário ou em Docker
      (`executionEnvironment`, imagem configurável, workspace em `/workspace`,
      rede desligada por padrão).
- [x] Status visual por thread (spinner, aprovação/pergunta/erro) e notificações
      in-app sem vazar erro de segundo plano para a thread visível.

## F3 — Colaboração e ecossistema (concluído no escopo local)

- [x] Canais com até 6 agentes, histórico compartilhado, threads privadas
      ocultas e respostas sequenciais no mesmo thread.
- [x] Templates locais (8), construtor por IA com revisão no editor, edição
      conversacional com diff campo a campo (`revise_agent`), duplicar,
      exportar e importar documento `lumina-agent` versionado.
- [x] Skills/tools/MCP por agente, workspace e permissões no editor.
- [x] Sidebar de canais e gestão de membros; exclusão remove threads derivadas.

## P4 local-first — decisão do usuário (2026-11-01)

O usuário aprovou **apenas local-first**: computer use no PC do usuário e
execução em Docker, como no MausBot. Ficam **fora**: computador always-on na
nuvem, apps iOS/Android, acesso remoto web, voz, Vault de logins e times
multi-usuário com papéis.

### Etapa 1 — computer use (implementado no Windows/Docker)

- [x] Capabilities `computerUse`/`screenCapture`/`browserUse`/`delegation`.
- [x] Screenshot, clique, teclado, janelas, foco e árvore de acessibilidade.
- [x] Aprovação por ação fora do Autônomo (`RiskClass::Computer` Ask; no Autônomo executa direto).
- [x] Docker gráfico (`docker/computer/`: Xvfb + noVNC + xdotool/scrot),
      validado com container real (1440×900, screenshot, clique, Chromium).
- [x] `browser_open` (navegador real local/Docker, operado pelas tools de
      desktop).
- [x] Denylist de títulos sensíveis (senhas/bancos/UAC) antes da aprovação.
- [x] Screenshot como imagem no resultado da tool (visão, 2/turno, 1280 px).
- [x] Auditoria (`computer_sessions`/`computer_actions`), rate limit por
      turno/hora e banner de controle com “Parar”.
- [ ] Cliente CDP dedicado.
- [ ] macOS/Linux local.

### Etapa 2 — delegação agente↔agente

- [x] `agent_tasks`/`agent_task_events`, máquina de estados, lease/version.
- [x] Tools `delegate_task`, `accept_task`, `handoff_task`, `finish_task`,
      `send_message`, `task_list`/`task_get`.
- [x] Scheduler Rust a cada 5 s sob o governador, thread oculta por tarefa,
      resultado no canal e orçamento por tarefa.
- [x] UI de tarefas no menu do agente (criar/executar/cancelar).
- [x] Quadro kanban global na sidebar, cancelamento real, lease heartbeat,
      handoff com aceite e orçamento por múltiplos turnos.
- [ ] Menções `@agente` no canal e reassign visual.

### Etapa 3 — streams, notificações e orçamento

- [x] `ConcurrencyGovernor` backend (global + por agente).
- [x] Stop por thread/agente e “Parar tudo” (diálogo Atividade).
- [x] `maxConcurrentTurns`, `maxConcurrentTurnsPerAgent`,
      `maxQueueLengthPerThread`, `agentDailyCostLimitUsd`.
- [x] Toast + notificação do SO para aprovação/pergunta/conclusão em background,
      com ação “Abrir” no toast e dedupe por conversa/categoria.
- [x] Reattach completo via `turn_events` após reload do renderer.

### Etapa 4 — Docker de produção

- [x] Hardening (`cap-drop`, no-new-privileges, non-root, read-only, tmpfs,
      limites, workspace único, rede off).
- [x] `docker_status`/`pull`/`validate`/`cleanup` e UI de validação.
- [x] Imagem gráfica separada.
- [x] Perfil de imagem por agente, `run_code` e terminal em Docker, limites
      configuráveis na UI.
- [ ] Perfil por workspace, compose/devcontainer e containers gráficos por
      sessão.

### Etapa 5 — painel direito do agente (2026-11-02)

- [x] `AgentPanel` com Tela/Rotinas/Navegador/Dados, dock/overlay e resize.
- [x] Tela: preview ao vivo, “Trabalha em” por agente, “Desktop na nuvem” Em
      breve, pausa/assumir controle.
- [x] Rotinas no painel + `agent_routine_runs`.
- [x] Navegador CDP local completo (abas, endereço, snapshot/refs, click/type,
      press, wait, extract, download).
- [x] Dados: identidade, uso, memória, tarefas, fila e auditoria.
- [x] `CodePanel` continua separado; header alterna os dois painéis.
- [ ] macOS/Linux local; containers gráficos por sessão; compose/devcontainer.
