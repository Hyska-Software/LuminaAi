# Agentes — contrato do layout, memória, workspace e colaboração

> Este documento descreve o layout **Agentes** (v1.14): personas persistentes,
> memória durável, workspace opcional, fila, rotinas, canais, templates e
> import/export. Ele complementa `docs/ARCHITECTURE.md` (visão técnica),
> `docs/DESIGN.md` (UI/UX) e `docs/goals/code-harness/` (harness de código).

## 1. Layout

O aplicativo tem três layouts, persistidos em `uiStore.layoutMode`:

| Layout | Sessões | Sidebar | Centro |
| --- | --- | --- | --- |
| `chat` | `conversations.mode = 'chat'` | conversas, Biblioteca, Skills | `ChatView` |
| `code` | `mode = 'code'` + sessões do Chat com `code_linked` | workspaces/sessões | workbench de código |
| `agent` | `mode = 'agent'` de uma persona | agentes, canais, threads | home/thread do agente ou canal + `AgentPanel` à direita |

Uma sessão nasce em um layout e não vaza para os outros. A única exceção é
`code_linked` (sessão do Chat adicionada ao Code). Threads de canal têm
`channel_id` e são **ocultas** das listas de agente; elas pertencem ao canal.

Arquivos principais:

- `src/components/agents/**` — sidebar, home, editor, memória, rotinas, canais,
  templates e construtor por IA.
- `src/lib/store/agentStore.ts` — catálogo de personas.
- `src/lib/store/agentQueueStore.ts` — fila FIFO persistida (localStorage).
- `src-tauri/src/agents/mod.rs` — domínio, validação, prompt, memória, rotinas,
  canais e documento de export.
- `src-tauri/src/commands/agents.rs`, `routines.rs`, `channels.rs` — comandos.
- `src-tauri/src/harness/mod.rs` — composição de prompt/tools, memória volátil,
  runtime de ferramentas de agentes com workspace explícito ou interno.
- `src-tauri/src/tools/memory.rs` — ferramenta `memory` (Chat e Code).
- `src-tauri/src/tools/registry.rs` + `harness/code/tools.rs` — execução das
  tools do perfil Code e fronteira de execução.

## 2. Modelo de dados

### `agents`

Identidade (`name`, `role`, `description`, `emoji`, `department`), modelo
(`provider_id`, `model_id`, `reasoning_json`), modelo de reserva opcional
(`fallback_provider_id`, `fallback_model_id`), instruções, `prompt_version`,
starters, `capabilities_json`, `memory_enabled`, `workspace_id`,
`permission_mode`, `docker_image`, pin/ordem e arquivamento.

- `prompt_version` sobe quando um campo que muda o prompt muda (nome, papel,
  descrição, instruções, memória). A snapshot key do Chat/Code inclui
  `agent.id` + `prompt_version`, então editar o prompt causa **exatamente um**
  cache miss e nunca reutiliza o prompt de outra persona.
- `workspace_id` é opcional; sem ele cada conversa usa uma pasta interna própria.
- `permission_mode` é herdado pela conversa criada e pode ser trocado na sessão
  pelo chip do Code.
- O seletor de modelo do composer do layout Agentes edita a rota da persona
  (provedor, modelo e raciocínio). Antes da primeira mensagem ele também
  sincroniza o par congelado da thread vazia; depois disso o modelo da conversa
  fica travado e o segmento ✦ continua ajustando o raciocínio da persona.

### `agent_memories`

Uma linha por memória: `kind` (`fact`/`preference`/`procedure`/`note`),
`content`, origem (`source_conversation_id`), `pinned`, timestamps. Limites:
4 KiB por memória e 200 memórias por agente.

### `agent_routines`

`title`, `prompt`, `schedule_kind` (`interval`/`daily`), `interval_minutes`,
`hour`/`minute`, `enabled`, `conversation_id` (thread dedicada criada no primeiro
run), `next_run_at`, `last_run_at`, `last_status`, `last_error`.

### `agent_channels` / `agent_channel_members` / `agent_channel_messages`

Um canal tem nome, membros (até 6) e um histórico cronológico `user`/`agent`.
Cada membro tem uma thread privada oculta (`conversations.channel_id`) usada para
o turno real.

## 3. Capabilities — aplicadas no backend

`AgentCapabilities` só **remove** acesso:

- `webSearch` → gate de `web_search`;
- `fileAccess` → gate de `create_file`;
- `codeExecution` → gate de `run_code` (além do gate global);
- `delegation` → gate das tools de tarefas (`delegate_task` etc.);
- `computerUse`/`screenCapture` → gate das tools de computer use;
- `dockerExecution` → permite `agents.docker_image` como override de imagem;
- `skills: null` herda todas; `Some([...])` é allowlist (`Some([])` nega todas);
- `tools: null` herda todas; `Some([...])` é allowlist;
- `mcpServers: null` herda todos os servidores MCP; `Some([...])` é allowlist.

A aplicação acontece em três camadas:

1. **Catálogo**: `tools::definitions` (Chat) e `code_tool_definitions_with_mcp`
   (Code) são filtrados antes do wire e do prompt.
2. **Execução**: `tools::execute` recusa tools fora da allowlist; o Code usa
   `ToolCtx::is_tool_enabled` como fronteira de execução.
3. **Conteúdo**: `list_skills`/`read_skill` escondem skills não autorizadas;
   o catálogo de skills do prompt é filtrado; tools MCP de servidores não
   autorizados não entram no catálogo.

O renderer nunca envia a allowlist: o harness resolve as capabilities da
persona vinculada à conversa. `TurnOptions` carrega esses campos com
`#[serde(skip)]`.

## 4. Memória durável

- Ativada por `agents.memory_enabled`.
- A ferramenta `memory` (`list`/`save`/`update`/`forget`) grava em
  `agent_memories`. Ela existe no Chat e no Code-profile de agentes; no Code ela
  resolve o agente pela conversa e falha fechado se a memória estiver desligada.
- No início do turno, o harness carrega as memórias e injeta um bloco
  `surface_item kind="memory"` na **cauda volátil** do histórico. Nunca entra no
  system prompt congelado.
- O bloco leva uma revisão (`quantidade:maior_updated_at`); uma mudança no
  conjunto gera um novo item. Apenas o item de memória mais recente é
  renderizado (`load_surface_items`), então fatos apagados não sobrevivem em
  blocos antigos.
- Orçamento de contexto: 8 KiB; memórias fixadas primeiro, depois as mais
  recentes. O agente é instruído a não guardar segredos, credenciais, estado
  transitório ou transcripts.

## 5. Workspace e perfil Code

Threads de agentes usam o runtime de ferramentas do **Code**, inclusive quando
o renderer envia o perfil Chat e a conversa não tem pasta selecionada:

- Sem workspace explícito, o backend cria e reutiliza
  `<app-data>/agent-workspaces/<sha256 do id da conversa>`, sem registrar essa
  pasta como workspace visível no Code. Conversas diferentes usam pastas distintas.
- O editor do agente e o cabeçalho da conversa permitem escolher uma pasta sem
  abrir o Code; uma pasta externa precisa estar marcada como confiável. A troca
  da pasta da conversa é recusada enquanto qualquer turno dela estiver ativo.
- A conversa mantém o workspace com que foi criada: mudar o workspace padrão
  da persona depois não altera threads existentes. Selecionar a pasta interna
  novamente não move nem apaga arquivos.
- A conversa herda `workspace_id` e `permission_mode` do agente na criação.
- O prompt do Code recebe o bloco `# Agent profile` (identidade/instruções/
  memória) e a snapshot key inclui `agent.id` + `prompt_version`.
- Com pasta explícita, tools de FS/shell/git/jobs/plano/objetivo/subagente,
  política de aprovação, journal/diff e jobs seguem o Code.
- O layout Agentes mostra o painel Arquivos/Alterações e as abas centrais de
  diff/arquivo/plano/commits/objetivo; aprovações continuam inline.
- A pasta interna não concede `run_command`, `run_checks`, `task` ou MCP.
  Artefatos e `run_code` do Chat continuam disponíveis conforme suas opções e
  capabilities; `run_code` continua sujeito ao opt-in global e não é sandbox.
  Navegador e desktop dependem de suas próprias capabilities e aprovações.

**Computer use local**: o agente pode usar o computador do usuário quando a
capability `computerUse`/`screenCapture` está ligada: screenshot, clique,
teclado, janelas, foco e UI tree, com aprovação por ação e auditoria. O
detalhamento (backend Windows/Docker, denylist, rate limit e imagens para
modelos com visão) está em `docs/COMPUTER.md`.

**Execução em Docker**: `Settings.executionEnvironment` (`local` | `docker`)
escolhe onde `run_command`/`run_checks`/jobs, `run_code` e o terminal interativo
rodam. No modo Docker o workspace é montado em `/workspace`, a rede fica
desligada por padrão (`--network none`) e a imagem vem de `dockerImage`
(padrão `node:22-bookworm`) ou de `agents.docker_image` quando a capability
`dockerExecution` está ligada. Limites de CPU/memória/pids/rootfs são
configuráveis. O detalhamento está em `docs/DOCKER.md`.

Permissões: `read_only`, `review`, `edit`, `autonomous`. O chip do composer
troca o modo da sessão; toda mutação passa por `policy::decide`.

**Modelo de reserva** (opcional): quando a rota principal não resolve
(provedor/modelo indisponível) ou não tem credencial utilizável, o harness tenta
a rota de reserva antes de persistir o turno. A conversa continua a mesma e o
modo de raciocínio vai como `Auto`, porque o esforço do modelo principal pode
não existir na reserva. Falhas de quota no meio do stream ainda encerram o turno
com erro — o fallback é de rota, não um retry infinito.

## 6. Concorrência e fila (FIFO por thread)

- `chatStore.streamsByConversation` guarda **um stream por conversa** (turno
  ativo). `streaming` é só a fatia visível de `activeId`; trocar de thread
  reata o stream daquela conversa e nunca apaga o de outra.
- Várias threads de agente rodam ao mesmo tempo (o backend já registra turnos
  por conversa). Enviar em uma thread ocupada enfileira só aquela thread; o
  composer/stop refletem a thread visível.
- `agentQueueStore` persiste a fila em `localStorage` (`lumina.agent-queue.v1`).
  O `done` de cada thread drena o próprio FIFO, inclusive em segundo plano; as
  filas persistidas são retomadas ao abrir o app no layout Agentes e ao entrar
  no layout.
- A sidebar mostra o contador da fila e um spinner por thread/agente que está
  respondendo (lido do mapa, não do stream visível); threads com aprovação
  pendente, pergunta pendente ou último turno com erro exibem um ícone de
  atenção no lugar do horário.
- Ao concluir um turno de agente enquanto o usuário está em outro layout ou
  thread, um toast in-app avisa (respeita `notificationsEnabled`).
- O erro visível (`error`/`errorCode`/`errorHint`) é da thread ativa: uma falha
  em segundo plano não pinta o banner por cima de outra conversa.
- O backend aplica `ConcurrencyGovernor`: `maxConcurrentTurns` global (padrão
  10, faixa 1–32) e `maxConcurrentTurnsPerAgent` por agente (padrão 1, faixa
  1–4); turnos além do limite aguardam com o token de cancelamento
  (Stop/Cancelar libera).
- `agentDailyCostLimitUsd` bloqueia novos turnos com `BUDGET_EXCEEDED` quando o
  custo do dia atinge o limite.
- Sidebar tem Stop por thread; o diálogo **Atividade** lista todos os streams
  (inclusive em segundo plano), aprovações/perguntas pendentes e tarefas
  aguardando o usuário, e oferece “Parar tudo”.
- Aprovação/pergunta em thread de fundo gera toast + notificação do SO via
  `notify_desktop`; conclusão/falha de thread não ativa também notifica. O toast
  tem ação **Abrir** e há dedupe de 5 s por conversa/categoria.
- `notificationsApprovals`, `notificationsQuestions`, `notificationsCompletions`,
  `notificationsTasks` e `notificationsDnd` controlam as categorias; DND mantém
  os avisos apenas no diálogo Atividade.
- Cada evento de turno é persistido em `turn_events` com `seq` e espelhado em
  `lumina:turn-event`. Ao recarregar o webview, `reattachTurns()` reconstrói o
  stream ativo sem duplicar mensagens; turnos de outra instância são aplicados
  pelo barramento global.

## 7. Rotinas

- CRUD em `AgentRoutinesDialog` (menu do agente → Rotinas).
- O agendador roda no Rust enquanto o app está aberto (tick de 30 s). Ele não é
  um serviço de nuvem nem promete execução com o app fechado.
- Cada rotina executa um turno normal na sua thread dedicada, com o modelo,
  instruções, memória e workspace do agente. O resultado aparece na thread.
- Frequência: intervalo mínimo de 5 min (máx. 7 dias) ou horário diário local.
- Status/erro ficam na rotina; o evento `lumina:agent-routine-run` atualiza a
  lista de conversas e mostra um toast.
- Cada execução grava uma linha em `agent_routine_runs` (status, início/fim,
  erro, conversa); o painel do agente lista esse histórico em **Rotinas →
  Registros de execução**.
- Execuções não assistidas não têm card de aprovação/pergunta: tools que exigem
  interação falham fechado imediatamente (sem esperar o timeout).

## 8. Canais (agentes no mesmo thread)

- Criados na sidebar (Canais → +) com até 6 agentes.
- Publicar um texto: Grava a mensagem `user`, e cada membro executa um turno em
  sua thread privada oculta com o histórico compartilhado injetado. A resposta
  é publicada no canal. Como os turnos são sequenciais, o segundo agente vê a
  resposta do primeiro.
- Threads de canal são ocultas das listas/paleta (`channelId`), mas preservadas
  ao sair do canal; excluir o canal remove as threads derivadas.
- Erros de um agente não derrubam os demais: vêm em `errors` e aparecem no
  painel do canal. Respostas de canal são não assistidas: aprovações/perguntas
  falham fechado em vez de bloquear o canal.

## 9. Templates, construtor e portabilidade

- `src/lib/agentTemplates.ts` contém 8 templates locais (assistente,
  pesquisador, engenheiro, revisor, redator, operações, analista, suporte).
- “Criar com IA” (`suggest_agent`) usa o modelo selecionado para devolver um
  rascunho JSON; o editor abre com o draft e **nada é salvo sem revisão**.
- “Editar com IA” (`revise_agent`) recebe um pedido em linguagem natural,
  devolve um patch JSON, normaliza/valida no backend e abre um diálogo com o
  **diff campo a campo** (antes/depois). Só `name`, `role`, `description`,
  `emoji`, `department`, `instructions`, `starters` e `memoryEnabled` são
  revisáveis; rota, reserva, workspace, permissões e capabilities continuam no
  editor estruturado. Aplicar chama o mesmo `update_agent` do editor.
- Duplicar agente copia configuração (não conversas nem memórias).
- Uso por agente: `get_agent_usage`/`list_agent_usage` agregam `usage_log` por
  `conversations.agent_id` (turnos, tokens de entrada/saída/raciocínio, total,
  custo e última atividade). A Equipe e a home do agente mostram esses números;
  threads de rotina/canal entram no mesmo agregado.
- Exportar gera um documento `lumina-agent` versionado (JSON) com configuração
  + memórias; importar valida versão, modelo/workspace e recria o agente.
- Skills/tools/MCP e workspace são escolhidos no editor; permissões continuam
  limitadas pelo backend.

## 9.1 Delegação agente↔agente

Contrato completo: `docs/TASKS.md`.

- `agent_tasks` + `agent_task_events`; dono único, brief, aceite, orçamento,
  deadline, lease/version e profundidade máxima 2.
- Tools (capability `delegation`): `delegate_task`, `task_list`, `task_get`,
  `accept_task`, `decline_task`, `handoff_task`, `update_task`, `finish_task`,
  `send_message`.
- O scheduler Rust roda tarefas a cada 5 s sob o governador de concorrência,
  cria/reusa thread oculta com `task_id`, renova o lease, roda múltiplos turnos
  com orçamento e publica o resultado no canal.
- Handoff entra em `handoff_pending` até o destino aceitar; cancelamento
  interrompe o turno real.
- UI: menu do agente → **Tarefas**; botão **Quadro de tarefas** na sidebar com
  colunas e ações; diálogo **Atividade** centraliza pendências.

## 9.2 Computer use

Contrato completo: `docs/COMPUTER.md`.

- Capabilities `computerUse`, `screenCapture`, `browserUse`.
- Windows local: screenshot, clique, teclado, janelas, foco e árvore de
  acessibilidade; Docker gráfico via `docker/computer/` (Xvfb + noVNC).
- `browserUse` usa o navegador local controlado por CDP (abas, endereço,
  snapshot com refs, click/type, wait, extract e download) em um perfil isolado
  por conversa; apenas http/https. O Chromium/Edge roda headless e a página é
  exibida dentro do painel Navegador, sem janela externa do sistema.
- `RiskClass::Computer` sempre pede aprovação, inclusive em Autônomo; o card
  mostra screenshot/alvo e só oferece permitir uma vez/negar; sem canal de
  aprovação a tool falha fechada.
- Toda ação tem sessão/registro em `computer_sessions`/`computer_actions`, sem
  texto digitado ou bytes de screenshot; rate limit por turno/hora.
- `computer_screenshot` vira imagem para modelos com visão (máx. 2/turno,
  1280 px) e texto/UI tree para modelos sem visão.
- macOS/Linux local ainda não implementados; a denylist de apps sensíveis está
  ativa. O navegador CDP desta fase é local (Windows); no Docker o navegador
  gráfico continua via screenshot/xdotool.

## 9.3 Docker de produção

Contrato completo: `docs/DOCKER.md`.

- `executionEnvironment` local/docker; imagem, rede, CPU, memória, pids e
  rootfs configuráveis; override de imagem por agente com `dockerExecution`.
- `run_command`/`run_checks`/jobs usam `docker run` com workspace em
  `/workspace`, non-root, cap-drop, no-new-privileges, read-only, tmpfs,
  limites e rede off.
- `run_code` e o terminal interativo também rodam em Docker, com cleanup de
  container no timeout/cancelamento/fechamento da aba e label
  `lumina.owner=lumina` para limpeza no boot.
- `docker_status`, `docker_pull_image`, `docker_validate_image`,
  `docker_cleanup`; imagem do computer use é separada.
- Perfil por workspace, compose/devcontainer e containers gráficos por sessão
  ainda não implementados.

## 9.4 Painel direito do agente

- Configurações → **Agentes** reúne as preferências globais do layout:
  concorrência/fila, orçamento diário, notificações de threads, política de
  navegador, apps do desktop e imagem/limites do Desktop privado. Modelo,
  instruções, workspace, permissões e capabilities continuam por persona no
  editor do agente; o composer também oferece a troca rápida de modelo e
  raciocínio (a mesma rota do editor). O chip de cache do composer do Chat e o
  segmento de cache do medidor de contexto do header não aparecem no layout
  Agentes.
- `AgentPanel` é a sidebar direita do layout Agentes, com abas **Tela**,
  **Rotinas**, **Navegador** e **Dados**. Docked acima de 1120 px; overlay com
  backdrop/Escape abaixo disso.
- O `CodePanel` (Arquivos/Alterações/Terminal) continua **separado**: os botões
  do header alternam qual painel ocupa o dock; não há aba "Código" dentro do
  `AgentPanel`.
- Reabertura: o toggle `PanelRight` da sidebar esquerda, do header da thread e do
  canal, e o botão flutuante (`AgentPanelOpener`) das superfícies sem header
  (home e agente arquivado) trazem o painel de volta; recolhê-lo nunca deixa a
  tela sem um controle para reabri-lo.
- Estado em `uiStore` (`agentPanelOpen`, `agentPanelTab`, `agentRightPanel`) e
  largura em `sidePanelWidth`.
- Tela: desktop privado integrado por RFB com modo somente leitura e controle;
  captura local contínua no Windows; `computer_preview` é captura inicial sem
  modelo/DB. `computer_take_control`/`release_computer_control` serializam a
  transferência e a pausa bloqueia tools no backend (`COMPUTER_PAUSED`).
- Toda ação grava `computer_actions` como `pending` antes de executar e fecha em
  `ok`/`error`; boot marca pendentes como `interrupted`.
- Container gráfico por conversa (não global), sem porta gráfica publicada;
  a ponte local usa token de uso único e `docker exec`, inclusive sem rede no
  container. Cleanup no Stop/boot.
- Ações CUA: drag, scroll, move, wait e clipboard read/write.
- Política de apps (`computerAllowedApps`/`BlockedApps`) e hosts
  (`browserAllowedDomains`/`BlockedDomains`, private hosts e metadata).
- Navegador: clique/digitação reais via `Input.dispatchMouseEvent`/
  `Input.insertText`, scroll/hover/select/upload e takeover interativo no
  preview (clique + teclado quando o humano assume).
- `computerAllowUnattendedBrowser` permite navegador em rotinas sem card;
  desktop continua fail-closed.
- Rotinas/Tarefas: execuções em `agent_routine_runs`; navegador não assistido é
  opt-in e continua sujeito à política de hosts.
- Ambiente por agente em `agents.computer_environment` (`auto`,
  `private_desktop`, `this_computer`, `browser`, `off`). “Desktop na nuvem” fica
  desabilitado como **Em breve**.
- Navegador: sessão CDP local, abas/endereço/voltar/avançar/reload, frame ao
  vivo, “Assumir o controle” e encerramento. Downloads vão para
  `<workspace>/downloads` (ou pasta do app).
- Dados: identidade/modelo/capabilities, uso, memória, tarefas, fila, conversa e
  auditoria recente de computer use.

## 10. Cache e segurança

- O prompt do agente é congelado por sessão; a memória e o estado de rotina/
  canal entram como `surface_items` voláteis.
- Mudanças de capabilities alteram o catálogo de tools e, portanto, o
  `tools_hash`/snapshot key.
- Instruções do agente são configuração, não autorização; o prompt base de
  segurança vem antes.
- A allowlist de tools/skills/MCP é aplicada no backend; o renderer não é
  autoridade.
- Segredos nunca entram na memória ou no workspace do agente. O agente de Code
  continua sujeito ao confinamento de path, journal e aprovação.

## 11. Verificação

- `pnpm typecheck`
- `pnpm test`
- `cd src-tauri && cargo test --lib` (ou filtros `agent`, `memory`)
- `cd src-tauri && cargo check`

Testes específicos deste contrato:

- `src/lib/store/__tests__/agentQueueStore.test.ts`
- `src/lib/__tests__/chatStore.test.ts` (streams simultâneos, fila em segundo
  plano e notificações)
- `src/components/agents/AgentSidebar.test.tsx`
- `src/components/agents/AgentMemoryPanel.test.tsx`
- `src/components/agents/AgentRevisionDialog.test.tsx`
- `src/components/agents/TeamView.test.tsx`
- `src-tauri/src/agents/mod.rs` (prompt, memória, rotinas, capabilities,
  export, fallback e revisão)
- `src-tauri/src/db.rs` (CRUD de agente, threads, canais, rotinas)
- `src-tauri/src/tools/memory.rs` e `src-tauri/src/tools/mod.rs` (allowlist)
- `src-tauri/src/workspace/exec.rs` (argv/hardening do Docker)
- `src/components/settings/ToolsTab.test.tsx` (ambiente Docker)
- `src-tauri/src/concurrency.rs` (governador global/por agente)
- `src-tauri/src/tools/tasks.rs` (delegação/ownership/handoff pendente)
- `src-tauri/src/db.rs` (tarefas: claim/transições/handoff/lease; auditoria de
  computer use; `turn_events`)
- `src-tauri/src/commands/tasks.rs` (runner multi-turno/cancelamento/heartbeat)
- `src-tauri/src/commands/turn.rs` (eventos persistidos/reattach)
- `src-tauri/src/computer/mod.rs` (backend local/Docker e ambiente por agente)
- `src-tauri/src/computer/browser.rs` (CDP local, URL policy, perfil/refs)
- `src-tauri/src/commands/routines.rs` (runs/logs de rotina)
- `src-tauri/src/tools/code/computer.rs` (browser tools/auditoria)
- `src-tauri/src/tools/code_exec.rs` (`run_code` Docker, teste `#[ignore]`)
- `src-tauri/src/terminal/mod.rs` (terminal Docker hardening)
- `src-tauri/src/harness/mod.rs` (imagens de tool para modelos com visão)
- `src/lib/__tests__/chatStore.test.ts` (reattach e notificações)
- `src/components/agents/AgentPanel.test.tsx` (Tela/Navegador)
- `src/components/settings/AgentsTab.test.tsx` (concorrência, notificações, navegador e computer use)
- `src/components/agents/AgentTaskBoardDialog.test.tsx`
- `src/components/agents/AgentActivityDialog.test.tsx`
- `docs/TASKS.md`, `docs/COMPUTER.md`, `docs/DOCKER.md`
