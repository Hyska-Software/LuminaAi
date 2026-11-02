# Tarefas delegadas — contrato

> Estado: schema, máquina de estados, tools, scheduler em background, múltiplos
> turnos com orçamento, cancelamento real, lease heartbeat, handoff com aceite e
> quadro kanban global. Tarefas são trabalho durável com dono, orçamento e
> thread própria.

## Modelo

`agent_tasks`:

- `owner_agent_id`, `created_by_agent_id`, `created_by_user`;
- `channel_id`, `parent_task_id` (profundidade máxima 2);
- `title`, `brief`, `acceptance`;
- `status`: `queued | accepted | running | waiting_input | waiting_approval |
  review | handoff_pending | done | cancelled | failed | declined`;
- `max_turns`, `max_tokens`, `max_cost`, `deadline_at`;
- `conversation_id` (thread oculta), `result`, `result_artifact_ids`;
- `lease_until`, `handoff_count`, `version`.

`agent_task_events` registra cada transição (from/to, ator, payload JSON) para
auditoria. `conversations.task_id` liga a thread à tarefa.

## Transições

- `queued → accepted | declined | cancelled | failed`
- `accepted → running | review | done | handoff_pending | cancelled | failed`
- `running → waiting_input | waiting_approval | review | done | handoff_pending |
  queued | failed | cancelled`
- `waiting_* → running | handoff_pending | cancelled | failed`
- `review → running | done | handoff_pending | failed | cancelled`
- `handoff_pending → accepted | declined | cancelled | failed`

`version`/`lease_until` evitam dois runners na mesma tarefa. O claim expira em
30 min; o runner renova o lease a cada 5 min e cancela o turno se a renovação
falhar (outro runner assumiu ou a tarefa foi cancelada).

## Tools (capability `delegation`)

- `delegate_task` — cria tarefa para outro agente; herda canal e tarefa-pai da
  conversa atual.
- `task_list` / `task_get` — consulta tarefas e histórico.
- `accept_task` / `decline_task` — aceite/recusa pelo dono.
- `handoff_task` — transfere para outro agente; máximo 3 por tarefa; entra em
  `handoff_pending` e **não** é executada até o destino aceitar.
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

- tick a cada 5 s; `handoff_pending` nunca é pego pelo scheduler;
- pega tarefas `queued`/`accepted` e tenta um slot do `ConcurrencyGovernor`
  (global e por agente);
- `claim` atômico + heartbeat de lease;
- cria/reusa a thread da tarefa (`mode=agent`, `task_id`);
- roda até `max_turns` turnos reais, checando custo/tokens acumulados antes de
  cada continuação; estouro vira `failed` com `AGENT_TASK_BUDGET`;
- `finish_task` encerra o loop; se o agente devolver texto final sem chamar a
  tool, o runner consolida esse texto como resultado;
- `cancel_agent_task` cancela o turno/conversa antes de mudar o status e o
  runner não escreve transição terminal depois do cancelamento;
- transiciona para `done`/`failed`; publica no canal quando aplicável;
- emite `lumina:agent-task-updated`.

## UI

- Menu do agente → **Tarefas** (`AgentTasksDialog`): lista, cria, executa agora,
  cancela e mostra orçamento/resultado.
- Botão **Quadro de tarefas** no topo da sidebar (`AgentTaskBoardDialog`):
  colunas Em fila / Em andamento / Aguardando / Revisão / Concluídas, cards com
  dono/orçamento/status, abrir thread e cancelar.
- Diálogo **Atividade** lista turnos ativos, aprovações/perguntas pendentes e
  tarefas aguardando o usuário.
- Canal: mensagens de tarefa usam o mesmo histórico; o resultado é publicado
  como mensagem do agente.
- Eventos atualizam o renderer via `lumina:agent-task-updated`.

## Limitações atuais

- O quadro é global (sidebar), não embutido por canal; menções `@agente` e
  reassign visual ainda não existem.
- Aprovações de tarefa em background dependem do card/notificação; não há
  “reassign” automático por falha.
- O scheduler só roda com o app aberto (local-first).
