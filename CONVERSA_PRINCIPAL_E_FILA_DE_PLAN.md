# Conversa principal por agente e fila de rotinas

## Contexto

Cada persona passa a ter exatamente uma **conversa principal**, criada automaticamente, sempre fixada no topo do histórico do agente e protegida contra desafixar/excluir. Toda rotina — agendada, por evento ou “Executar agora” — passa a executar nessa conversa. Como a principal é uma única thread, execuções concorrentes entram numa fila persistente por conversa, drenada quando ela fica livre. Para agentes existentes é criada uma nova conversa vazia “Conversa principal”, preservando todo o histórico atual; clicar no agente continua abrindo a home, que ganha um botão dedicado para abrir a principal.

## Abordagem

### 1. Modelo: flag de principal e fila persistente

**Conversa principal (`conversations.is_main`)**

- `src-tauri/src/domain.rs` `Conversation`: adicionar `#[serde(default)] pub is_main: bool` no fim da struct.
- `src-tauri/src/db.rs`:
  - `SCHEMA` de `conversations`: adicionar `is_main INTEGER NOT NULL DEFAULT 0` após `sort_order`.
  - `CONVERSATION_COLUMNS`: acrescentar `is_main` no fim (índice 21 no row mapper).
  - `conversation_from_row`: `is_main: row.get::<_, i64>(21)? != 0`.
  - `migrate_conversations_schema`: `ensure_column(conn, "conversations", "is_main", "ALTER TABLE conversations ADD COLUMN is_main INTEGER NOT NULL DEFAULT 0")` e:
    ```sql
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_main_agent
      ON conversations(agent_id) WHERE is_main = 1 AND agent_id IS NOT NULL;
    ```
  - `search_conversations`: incluir `c.is_main` no SELECT explícito e `c.is_main DESC` antes de `c.pinned DESC`.
  - `list_conversations`: `ORDER BY is_main DESC, pinned DESC, sort_order ASC, updated_at DESC`.
  - `update_agent`: depois do UPDATE do agente e ainda sob o mesmo lock, sincronizar a principal **somente enquanto ela estiver vazia**:
    ```sql
    UPDATE conversations SET provider_id = ?2, model_id = ?3, workspace_id = ?4,
      permission_mode = ?5
    WHERE agent_id = ?1 AND is_main = 1 AND message_count = 0
    ```
    Isso faz o modelo/workspace/permissão da principal acompanhar edições da persona antes do primeiro uso; depois de qualquer mensagem ela congela como qualquer thread.
- Todo `Conversation { ... }` direto no Rust (row mapper e fixtures em `commands/conversations.rs`, `domain.rs`, `harness/code/context.rs`) recebe `is_main: false`; só a principal recebe `true`.
- `src/lib/types.ts` `Conversation`: `isMain?: boolean` (opcional para fixtures/payloads antigos; o backend sempre envia).

**Fila (`agent_routine_queue`)**

Adicionar ao `SCHEMA` (depois de `agent_event_deliveries`):

```sql
CREATE TABLE IF NOT EXISTS agent_routine_queue (
  id              TEXT PRIMARY KEY,
  routine_id      TEXT NOT NULL REFERENCES agent_routines(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  source          TEXT NOT NULL DEFAULT 'schedule', -- schedule | event | manual
  event_id        TEXT REFERENCES agent_events(id) ON DELETE SET NULL,
  scheduled_for   INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | running
  error           TEXT,
  created_at      INTEGER NOT NULL,
  started_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agent_routine_queue_pending
  ON agent_routine_queue(status, created_at);
```

- Nova struct em `src-tauri/src/agents/mod.rs`, camelCase, com os campos acima (`AgentRoutineQueueItem`), e row mapper em `db.rs`.
- Não há índice único: cada slot/trigger enfileira uma execução própria; a fila é FIFO e não faz coalescing.
- `Db` methods:
  - `enqueue_scheduled_agent_routine(routine, conversation_id, scheduled_for, next_run_at, now) -> Result<AgentRoutineQueueItem>`: transação que insere a linha `source='schedule'`, `status='pending'`, `scheduled_for=routine.next_run_at` e atualiza `agent_routines.next_run_at=next_run_at`, `last_status='queued'`, `last_error=NULL`, `updated_at=now` (não altera `last_run_at`).
  - `enqueue_agent_routine_run(routine, conversation_id, source, event_id, scheduled_for, now) -> Result<AgentRoutineQueueItem>`: insere a linha e atualiza apenas `last_status='queued'`, `last_error=NULL`, `updated_at=now`; usado por evento/manual.
  - `list_pending_agent_routine_queue(limit) -> Vec<AgentRoutineQueueItem>`: `WHERE status='pending' ORDER BY created_at, id LIMIT ?`.
  - `claim_agent_routine_queue_item(id, now) -> Result<bool>`: CAS `pending -> running`, grava `started_at`.
  - `release_agent_routine_queue_item(id)`: `running -> pending`, limpa `started_at`/`error`; usado quando a principal está ocupada.
  - `finish_agent_routine_queue_item(id) -> Result<()>`: DELETE da linha (o histórico real fica em `agent_routine_runs`).
  - `recover_agent_routine_queue()`: no boot, `running -> pending`, `started_at=NULL`, `error='interrompida'`.
  - `delete_pending_agent_routine_queue(routine_id)`: usado ao desativar a rotina.
  - `delete_pending_agent_routine_queue_for_agent(agent_id)`: usado ao arquivar o agente.
  - `clear_agent_routine_queued_status(routine_id)`: `UPDATE agent_routines SET last_status=NULL WHERE id=? AND last_status='queued'`.

### 2. Criação, backfill e garantia da principal

- **Novo agente**: `Db::create_agent` passa a criar o agente e a principal na **mesma transação**. Gerar `main_id`, `now`; inserir o agente e:
  ```sql
  INSERT INTO conversations
    (id, title, created_at, updated_at, pinned, sort_order, provider_id, model_id,
     message_count, preview, mode, code_linked, workspace_id, agent_kind,
     permission_mode, agent_id, is_main)
  VALUES (?, 'Conversa principal', ?, ?, 1, 0, ?, ?, 0, NULL, 'agent', 0, ?, 'lumina', ?, ?, 1)
  ```
  com `provider_id`/`model_id`/`workspace_id`/`permission_mode` do `AgentInput`. Se a transação falhar, nenhum agente fica sem principal.
- **Backfill de bancos existentes** (`migrate_agent_main_conversations(conn)`, chamado em `Db::init_connection` depois de `migrate_conversations_schema`):
  1. Selecionar todos os agentes (inclusive arquivados) sem `conversations.is_main=1`.
  2. Para cada um, inserir uma nova principal vazia com os campos atuais da persona (`provider_id`, `model_id`, `workspace_id`, `permission_mode`), título `Conversa principal`, `pinned=1`, `is_main=1`.
  3. Atualizar todas as rotinas desses agentes: `agent_routines.conversation_id = (SELECT id da principal do agente)`. Rotinas antigas passam a apontar para a principal; as threads dedicadas antigas permanecem como histórico normal.
  - Idempotente: agentes com principal não são tocados; rotinas já apontando para a principal não mudam.
- **Garantia em runtime**: `Db::get_agent_main_conversation(agent_id) -> Result<Option<Conversation>>` e `Db::ensure_agent_main_conversation(agent_id) -> Result<Conversation>`:
  - Consulta `agent_id = ? AND is_main = 1 AND channel_id IS NULL`.
  - Se faltar, carrega a persona e insere a principal com `INSERT OR IGNORE` (respeitando o índice único); relê e devolve.
  - Usada pelo executor de rotinas e ao criar rotina; também autocura uma principal removida por dado legado.
- **Criar rotina**: `Db::create_agent_routine` chama `ensure_agent_main_conversation(agent_id)` antes de adquirir o lock de escrita e grava o id da principal na coluna `conversation_id` do INSERT (substitui o `NULL` atual). A rotina já nasce com “Abrir conversa” funcional e nunca cria thread própria.

### 3. Ordenação, proteção e exclusão

- `src/lib/utils.ts` `compareConversationOrder`: principal primeiro, depois pinned, sortOrder, recência:
  ```ts
  Number(Boolean(right.isMain)) - Number(Boolean(left.isMain)) ||
  Number(right.pinned) - Number(left.pinned) ||
  ...
  ```
- `src/components/agents/AgentSidebar.tsx` `threadsFor` já usa `compareConversationOrder`; a principal aparece primeiro em `shown`, na busca e no diálogo “Ver todas”.
- `src/components/agents/AgentHome.tsx`: trocar o sort local por `compareConversationOrder`; a principal aparece primeira em “Conversas recentes”.
- `src/lib/store/chatStore.ts` `startNewConversation`: ordenar a lista após inserir a nova conversa (`[conversation, ...state.conversations].sort(compareConversationOrder)`); hoje ela é prepended e ficaria acima da principal até o próximo refresh.
- `src/components/agents/AgentSidebar.tsx` `ThreadRow`:
  - O ícone `Pin` continua aparecendo (principal é `pinned=1`).
  - Não renderizar **Desafixar/Fixar** nem **Excluir** para `conversation.isMain`; manter Parar, Renomear, Exportar. Ajustar o `title` do botão para incluir “Conversa principal” quando aplicável.
  - `SortableList.lockedCount` já trava as pinned; a principal fica no topo por `compareConversationOrder`.
- `src/lib/store/chatStore.ts` `togglePinned`: se `conversation.isMain`, mostrar `toast.info('A conversa principal permanece fixada.')` e retornar sem IPC nem atualização otimista.
- Backend:
  - `Db::set_pinned(id, false)` em uma principal retorna `Err("CONVERSATION_MAIN: a conversa principal não pode ser desafixada.")`; `pinned=true` continua idempotente.
  - Refatorar `delete_conversation` em `delete_conversation_inner(id, allow_main)`; o wrapper público retorna `Err("CONVERSATION_MAIN: a conversa principal não pode ser excluída.")` para principal. A recursão de subagentes usa `allow_main=false`. Em `commands::conversations::delete_conversation`, ler a conversa **antes** de `state.cancel_conversation` e retornar o mesmo erro para `is_main`, para não cancelar um turno e só depois recusar.
  - `delete_agent`:
    - Contar apenas conversas bloqueantes: `agent_id=? AND channel_id IS NULL AND is_main=0` (inclui task threads). Se >0, manter `AGENT_IN_USE` com a contagem.
    - Coletar `main_id` e as threads de canal, apagar membros/líder do canal, commit, e então deletar as threads de canal e a principal com `delete_conversation_inner(..., true)`.
    - Excluir o agente; rotinas/queue caem por cascade de `agent_id`.
  - `commands::agents::delete_agent`: antes de `db.delete_agent`, resolver a principal e `state.cancel_conversation(&main.id)`; após sucesso, fechar terminal/browser/computer session da principal e remover `<data_dir>/agent-workspaces/<main.id>` quando ela não tiver workspace, espelhando o cleanup de `commands::conversations::delete_conversation`.
- UI de exclusão:
  - `AgentSidebar`: `deleteThreads = deleteTarget ? conversations.filter(c => c.agentId === deleteTarget.id && !c.channelId && !c.isMain).length : 0`. O diálogo continua bloqueando quando >0 e menciona que a principal é removida junto.
  - `TeamView`: usar `useChatStore((state) => state.conversations)` e `deleteThreads = deleteTarget ? conversations.filter(c => c.agentId === deleteTarget.id && !c.channelId && !c.isMain).length : 0` (mesma regra do backend, incluindo task threads e excluindo canais/principal); atualizar o mesmo texto.
  - Após excluir agente, chamar `void useChatStore.getState().refreshConversations()` em `AgentSidebar.confirmDelete` e `TeamView.confirmDelete`.
- `src/App.tsx` e telas:
  - Após criar/atualizar/duplicar/importar agente, chamar `void useChatStore.getState().refreshConversations()` nos callers: `AgentEditorDialog.submit` (create e update), `AgentSidebar.duplicateAgent`, `TeamView.createFromTemplate`, `TeamView.importAgent`.
  - O `create_agent` tool já é seguido pelo `refreshList` do fim do turno.
- **Botão especial na home**: `AgentWelcome` recebe `onOpenMain?: () => void`; `AgentHome` resolve `threads.find(t => t.isMain)` e passa `() => openConversation(main.id)`. Na linha de ações (junto de “Nova conversa” e “Editar agente”), renderizar `Button size="sm" variant="secondary"` com ícone `Pin`, texto **Conversa principal** e `aria-label="Abrir conversa principal"`; se não houver principal carregada, não renderizar (o backfill/refresh garante).
- `list_agent_threads` permanece ordenado por recência (não é usado por nenhuma superfície atual). A ordenação principal-first é feita no store/Sidebar/Home; não alterar o cursor paginado.

### 4. Execução de rotinas na principal + fila

**Enfileiramento (todas as origens)**

- `scheduler_tick` deixa de chamar `execute_routine`: para cada rotina vencida de `claim_due_agent_routines`:
  1. `let main = db.ensure_agent_main_conversation(&routine.agent_id)?;`
  2. `let next = routine_next_run_at(..., now_ms());`
  3. `db.enqueue_scheduled_agent_routine(&routine, &main.id, routine.next_run_at, next, now)`.
  4. `db.clear_agent_routine_lease(&routine.id)`; emitir `AgentRoutineRunEvent { status: "queued", conversation_id: Some(main.id) }` via `emit_run` e logar erro de enfileiramento.
  - Se enfileirar falhar, não atualiza o próximo run; a rotina continua vencida e tenta de novo no próximo tick.
- `event_tick`: para cada delivery:
  1. `ensure_agent_main_conversation`.
  2. `db.enqueue_agent_routine_run(&routine, &main.id, "event", Some(event.id), now, now)`.
  3. `finish_event_delivery(..., "done", ...)` (o evento foi aceito na fila; a execução real fica no run log) e emitir `queued`.
  - Se o enqueue falhar, marcar delivery `failed` e emitir erro.
- `run_agent_routine_now`:
  - Verificar agente; se arquivado, retornar `AGENT_ARCHIVED` sem enfileirar.
  - `ensure_agent_main_conversation`; `enqueue_agent_routine_run(..., "manual", None, now, now)`; emitir `queued`; retornar a rotina recarregada (`last_status='queued'`). O comando não executa mais o turno e pode ser síncrono.
- Nenhuma rotina cria thread própria; `routine.conversation_id` aponta a principal (novas e backfill), mas o executor usa `queue.conversation_id`/principal.

**Worker**

- Em `src-tauri/src/commands/routines.rs`, adicionar `pub async fn routine_queue_tick(app: AppHandle)`:
  - `state.db.recover_agent_routine_queue()` uma vez no boot (em `Db::init_connection`).
  - `let pending = db.list_pending_agent_routine_queue(20)`.
  - Para cada item, ignorar se `state.has_active_turn_for(&item.conversation_id)`; manter um `HashSet` de conversas já vistas nesta passagem para não pegar duas da mesma principal.
  - `db.claim_agent_routine_queue_item(item.id, now)`; se true, spawnar `execute_queued_routine(app, item)`.
  - Itens de conversas diferentes rodam em paralelo; a principal nunca tem dois turnos por causa do registro atômico.
- `execute_queued_routine`:
  - Carregar rotina; se sumiu, `finish` a fila e retornar.
  - Se `!routine.enabled && item.source != "manual"`, `finish` a fila e `clear_agent_routine_queued_status` (o agendador só enfileira habilitadas; isso cobre desativação concorrente).
  - Resolver `AgentEvent` por `item.event_id` (se houver); evento ausente → executar sem contexto de evento.
  - Chamar `execute_routine_inner(&app, &routine, &item, event.as_ref())` e:
    - `Ok(RoutineRunOutcome::Busy)` → `release_agent_routine_queue_item` (a principal ocupada; volta a pending).
    - `Ok(Executed) | Err(_)` → `finish_agent_routine_queue_item`; erro é logado; o status está na rotina/run log.
- Loop em `src-tauri/src/lib.rs` no setup: chamar `routine_queue_tick` no boot e a cada **2 s** (novo `tokio::time::sleep`), em paralelo aos loops existentes de scheduler (30 s) e eventos (5 s).

**Executor (`execute_routine_inner`)**

- Assinatura nova:
  ```rust
  enum RoutineRunOutcome { Executed, Busy }
  async fn execute_routine_inner(
      app: &AppHandle,
      routine: &AgentRoutine,
      queue: &AgentRoutineQueueItem,
      event: Option<&AgentEvent>,
  ) -> Result<RoutineRunOutcome, String>
  ```
- Resolver agente; se arquivado: registrar status `blocked` na rotina com `next_run_at` atual/0, emitir `blocked` e retornar `Err(AGENT_ARCHIVED...)`; a fila é finalizada pelo worker.
- Conversa: `db.get_conversation(&queue.conversation_id)`; se sumiu, retornar erro `AGENT_ROUTINE_CONVERSATION_NOT_FOUND` (fila finalizada).
- Governador: `state.governor.try_acquire(Some(agent.id.clone()), limits)`; sem slot → `Ok(Busy)` **sem** alterar status/emitir.
- Registro: `state.register_turn_if_idle`; se ocupada → `Ok(Busy)` sem alterar status/emitir.
- Próximo run: `if trigger_kind == "event" { 0 } else { routine.next_run_at }`; se `<= now`, recalcular com `routine_next_run_at(...)`. O enfileiramento agendado já avançou `next_run_at`; manual/event preservam o próximo agendamento.
- `mark_agent_routine_run`/`start_agent_routine_run` como hoje, usando `queue.conversation_id`.
- Prompt: `routine.prompt`; se `queue.source == "schedule"` e `queue.scheduled_for < now`, acrescentar “Execução atrasada desde …”; se evento, anexar o bloco `<event …>` existente.
- Payload: `TurnPayload { conversation_id: queue.conversation_id, profile: Code, turn_kind: User, ... }`; `TurnOptions.event_context` e `HarnessDeps` iguais aos atuais.
- Ao final: status/erro, `mark_agent_routine_run`, `finish_agent_routine_run`, `emit_run`; retornar `Executed` ou `Err`.
- Remover o branch antigo que criava thread de rotina e o wrapper `execute_routine` que limpava lease; o lease é limpo no enfileiramento do scheduler.

**Status e UI**

- `src/lib/routineCalendar.ts` `ROUTINE_STATUS_META`: adicionar `queued: { label: 'Na fila', tone: 'accent' }`.
- `AgentRoutinesView.runNow` e `AgentPanelRoutines.runNow`: como a API retorna `lastStatus='queued'`, mostrar `toast.success('Rotina enfileirada', { description: routine.title })`; manter o tratamento de erro e atualizar a rotina local.
- `App.tsx`:
  - Toast de sucesso final: `'O resultado está na conversa principal do agente.'`.
  - O listener já ignora status `queued` para toast; continua disparando o evento customizado/refresh. Não chamar `openConversation` quando `run.status === 'queued'` (evita recarregar a thread ativa sem mensagem nova).
- `AgentRoutineEditorDialog`: descrição “...na conversa principal do agente.” e nota “O resultado aparece na conversa principal do agente...”.
- `AgentRoutineRunsDialog`: descrição “...últimas 30 execuções na conversa principal.”
- `AgentPanelRoutines`: rótulo **Abrir conversa** (não “Abrir thread”).
- `src-tauri/src/agents/mod.rs` doc de `AgentRoutine`: “executa na conversa principal do agente”.
- `src-tauri/src/commands/routines.rs` docs de módulo/`run_agent_routine_now`: principal.
- `src-tauri/src/tools/agents.rs`: descrição de `routine_create` “runs unattended in the agent's main conversation”.
- Nenhum renderer precisa da fila além do status `queued`; o run history só recebe execuções reais.

### 5. Operações sobre a fila

- `set_agent_routine_enabled(false)`: `delete_pending_agent_routine_queue(routine_id)` e `clear_agent_routine_queued_status`; um turno já em execução não é cancelado (Stop continua disponível).
- `delete_agent_routine`: cascade da fila.
- `archive_agent`: `delete_pending_agent_routine_queue_for_agent(agent_id)`; a rotina não roda enquanto arquivada.
- `update_agent_routine`: não mexe na fila; a execução pendente lê a rotina atual no worker.
- `delete_agent`: cascade de fila/rotinas e exclusão forçada da principal.

## Arquivos críticos e âncoras

- `src-tauri/src/db.rs` — `conversations` schema (~380), `CONVERSATION_COLUMNS` (~38), `migrate_conversations_schema` (~1166), `create_agent` (~2597), `delete_agent` (~2794), `create_agent_conversation` (~2837), `delete_conversation`/`set_pinned` (~5660/5719), SCHEMA de fila; concentra migração, backfill, proteção e fila.
- `src-tauri/src/commands/routines.rs` — scheduler/enqueue/queue worker/`execute_routine_inner`; substitui a thread dedicada pela principal e pela fila.
- `src-tauri/src/lib.rs` — loops de fundo; adicionar `routine_queue_tick` a cada 2 s.
- `src/components/agents/AgentSidebar.tsx` — `ThreadRow` (menu protegido), `threadsFor`/contagem de exclusão (~687/910).
- `src/components/agents/AgentHome.tsx` — botão **Conversa principal** e ordenação da home.

## Verificação

**Automatizada**

- `pnpm typecheck`
- `pnpm test`
- `cd src-tauri && cargo test --lib`
- `cd src-tauri && cargo check`
- Testes específicos:
  - `cargo test --lib agent_main_conversation_is_created_pinned_and_protected`
  - `cargo test --lib agent_main_conversation_is_ensured_and_unique`
  - `cargo test --lib update_agent_syncs_empty_main_route`
  - `cargo test --lib agent_routine_queue_transitions_and_recovery`
  - `cargo test --lib agent_routines_use_main_conversation`
  - `cargo test --lib agent_threads_are_linked_paginated_and_delete_is_restricted`
  - `cargo test --lib agents_crud_prompt_version_and_thread_aggregate`
  - `pnpm exec vitest run src/components/agents/AgentSidebar.test.tsx src/components/agents/TeamView.test.tsx src/components/agents/AgentHome.test.tsx src/lib/__tests__/utils.test.ts src/lib/__tests__/chatStore.test.ts`

Casos novos obrigatórios:

- Rust:
  - `create_agent` cria exatamente uma conversa `is_main=1`, `pinned=1`, título `Conversa principal`, com rota/workspace/permissão da persona; `thread_count=1`.
  - `ensure_agent_main_conversation` é idempotente e recria a principal se ela sumir; não cria duplicata com o índice único.
  - `set_pinned(main,false)` e `delete_conversation(main)` falham com `CONVERSATION_MAIN`.
  - `delete_agent` com só a principal remove principal+agente; com outra conversa (inclusive task) falha `AGENT_IN_USE`; a contagem ignora a principal.
  - `update_agent` atualiza `provider_id/model_id/workspace_id/permission_mode` da principal com `message_count=0` e não altera uma principal já usada.
  - `create_agent_routine` grava `conversation_id` da principal; o backfill aponta rotinas antigas para a principal e preserva threads antigas.
  - Fila: enqueue scheduled insere pending e avança `next_run_at`/`last_status=queued`; enqueue manual/event não altera `next_run_at`; claim running, release pending, finish remove; `recover` transforma running em pending; desativar remove pendentes; delete routine/agent cascade.
  - Atualizar testes existentes de `thread_count`/`list_agent_threads`/delete para a principal.
- Renderer:
  - `utils.test.ts`: `compareConversationOrder` coloca `isMain` acima de qualquer pinned, mesmo com `updatedAt` menor.
  - `AgentSidebar.test.tsx`: a principal aparece primeira mesmo com outra pinned mais recente; o menu da principal não tem Desafixar/Excluir e mantém Renomear/Exportar; a contagem de exclusão de agente ignora a principal.
  - `AgentHome.test.tsx`: com `[main, normal]`, o botão **Conversa principal** abre `main.id` e a lista de recentes começa por ela.
  - `TeamView.test.tsx`: com uma conversa principal e nenhuma outra permite excluir; com uma segunda conversa (normal ou task) bloqueia; o diálogo explica que a principal sai junto.
  - `chatStore.test.ts`: `togglePinned` em principal não chama a API e emite o aviso; `applyResult`/refresh preservam o campo `isMain`.
  - `AgentEditorDialog`/`TeamView`/`AgentSidebar` testam que criar/duplicar/importar/atualizar/excluir dispara `refreshConversations` (mock de `listConversations`).

**Manual (smoke real)**

1. `pnpm app:dev`.
2. Banco existente com agentes: abra Agentes; cada agente tem **Conversa principal** vazia, fixada acima do histórico; o menu dela não oferece Desafixar/Excluir; renomear/exportar funcionam.
3. Crie um agente novo: a principal aparece na sidebar/home após o refresh; o botão **Conversa principal** na home abre a thread; “Nova conversa” cria uma thread abaixo.
4. Edite o modelo/workspace de um agente com principal vazia; abra a principal e confirme a rota nova. Depois de uma mensagem, a principal fica congelada como thread normal.
5. Inicie um turno longo na principal e dispare **Executar agora** em uma rotina: o retorno mostra **Na fila**; a fila permanece após reiniciar o app; quando o turno termina, a rotina executa na principal e o resultado aparece nela; o run log registra a execução.
6. Duas rotinas para o mesmo agente ficam em FIFO; rotinas de agentes diferentes podem executar em paralelo. Um evento de canal com a principal ocupada também entra na fila.
7. Exclua uma rotina com item pendente: a fila é removida. Desative outra com item pendente: a fila é limpa. Arquive um agente: pendentes somem e as rotinas não rodam.
8. Exclua um agente com apenas a principal: exclusão permitida, principal some; com outra conversa: bloqueada com a contagem correta.
9. Duplique/importe um agente: a cópia ganha principal própria, sem compartilhar a do original.
10. Confirme que o backfill não duplica principal ao reiniciar o app e que rotinas antigas abrem a principal.

## Premissas e contingências

- Agentes existentes recebem uma **nova principal vazia**; nenhuma thread antiga é promovida, apagada ou renomeada. As threads de rotinas antigas permanecem como histórico normal.
- Clicar no agente continua abrindo a home; a principal é acessada pelo botão especial e pela primeira linha do histórico.
- A principal é protegida (não desafixa, não exclui) e é removida somente junto com o agente quando não há outras conversas. Renomear/exportar são permitidos.
- Toda execução de rotina (schedule, event, manual) passa pela fila persistente. Não há coalescing: cada slot/trigger vira um item FIFO; a principal executa um turno por vez.
- Se a principal estiver ocupada, o item permanece `pending`; não vira `blocked`. O worker tenta a cada 2 s. Se o agente for arquivado, o item é finalizado e a rotina fica bloqueada.
- Eventos consideram a entrega concluída ao entrar na fila; uma falha posterior aparece no run log/status da rotina, sem reentrega automática do evento.
- A principal herda rota/workspace/permissão na criação; edições da persona sincronizam esses campos apenas enquanto `message_count=0`. Depois disso, vale o congelamento normal de thread. As execuções de rotina continuam usando a rota da persona (`TurnPayload` atual), não trocam o modelo da thread.
- `list_agent_threads` continua por recência (API sem uso atual); a ordenação principal-first é aplicada nas superfícies visíveis (Sidebar/Home/paleta).
- A fila reseta `running -> pending` no boot; uma execução interrompida pode ser repetida após reabrir o app.
- O agente só é excluível sem outras conversas; a Sidebar e a Equipe contam as conversas não-canal/não-principais do store (incluindo task threads), a mesma regra do backend.
