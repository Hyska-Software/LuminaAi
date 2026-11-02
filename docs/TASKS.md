# Tarefas delegadas — contrato

> Estado: schema, máquina de estados, tools, scheduler em background e UI de
> tarefas. Tarefas são trabalho durável com dono, orçamento e thread própria.

## Modelo

`agent_tasks`:

- `owner_agent_id`, `created_by_agent_id`, `created_by_user`;
- `channel_id`, `parent_task_id` (profundidade máxima 2);
- `title`, `brief`, `acceptance`;
- `status`: `queued | accepted | running | waiting_input | waiting_approval |
  review | done | cancelled | failed | declined`;
- `max_turns`, `max_tokens`, `max_cost`, `deadline_at`;
- `conversation_id` (thread oculta), `result`, `result_artifact_ids`;
- `lease_until`, `handoff_count`, `version`.

`agent_task_events` registra cada transição (from/to, ator, payload JSON) para
auditoria. `conversations.task_id` liga a thread à tarefa.

## Transições

- `queued → accepted | declined | cancelled | failed`
- `accepted → running | review | done | cancelled | failed`
- `running → waiting_input | waiting_approval | review | done | failed |
  cancelled | queued` (queued é usado pelo handoff)
- `waiting_* → running | cancelled | failed`
- `review → running | done | failed | cancelled`

`version`/`lease_until` evitam dois runners na mesma tarefa. Claim expira em
30 min e é renovado pelo runner.

## Tools (capability `delegation`)

- `delegate_task` — cria tarefa para outro agente; herda canal e tarefa-pai da
  conversa atual.
- `task_list` / `task_get` — consulta tarefas e histórico.
- `accept_task` / `decline_task` — aceite/recusa pelo dono.
- `handoff_task` — transfere para outro agente; máximo 3 por tarefa; o novo dono
  aceita.
- `update_task` — progresso (`running`, `waiting_input`, `waiting_approval`,
  `review`).
- `finish_task` — resultado + artefatos; só o dono.
- `send_message` — publica no canal se o agente for membro.

Limites:

- 3 tarefas abertas por agente;
- profundidade de delegação 2;
- 3 handoffs por tarefa;
- orçamento por tarefa (turnos/tokens/custo) e limite diário global por agente;
- tarefas não assistidas rodam com `approvals: None`/`questions: None`.

## Runner

`commands/tasks.rs`:

- tick a cada 5 s;
- pega tarefas `queued`/`accepted` e tenta um slot do `ConcurrencyGovernor`
  (global e por agente);
- `claim` atômico;
- cria/reusa a thread da tarefa (`mode=agent`, `task_id`);
- roda `harness::run_turn` com o dono, perfil Code quando há workspace;
- transiciona para `done`/`failed`; publica no canal quando aplicável;
- emite `lumina:agent-task-updated`.

## UI

- Menu do agente → **Tarefas** (`AgentTasksDialog`): lista, cria, executa agora,
  cancela e mostra orçamento/resultado.
- Canal: mensagens de tarefa usam o mesmo histórico; o resultado é publicado
  como mensagem do agente.
- Eventos atualizam o renderer via `lumina:agent-task-updated`.

## Limitações atuais

- O orçamento de `max_turns` vira um limite de passos por execução
  (`max_turns * 8`), não múltiplos turnos automáticos.
- Não há quadro kanban dedicado no canal; a gestão está no diálogo do agente.
- Aprovações de tarefa em background dependem do card/notificação; não há
  “reassign” automático por falha.
- O scheduler só roda com o app aberto (local-first).
