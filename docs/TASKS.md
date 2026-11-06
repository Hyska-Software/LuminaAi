# Tarefas delegadas — contrato

> Estado: schema, máquina de estados, tools, scheduler em background, múltiplos
> turnos com orçamento, cancelamento real, lease heartbeat, handoff imediato,
> retomada e quadro kanban global. Tarefas são trabalho durável com dono,
> orçamento e thread própria.

## Modelo

`agent_tasks`:

- `owner_agent_id`, `created_by_agent_id`, `created_by_user`;
- `channel_id`, `parent_task_id` (profundidade máxima 2);
- `title`, `brief`, `acceptance`;
- `status`: `queued | accepted | running | waiting_input | waiting_approval |
  review | handoff_pending | done | cancelled | failed | declined`;
- `max_turns`, `max_tokens`, `max_cost`, `deadline_at`;
- `conversation_id` (thread oculta), `origin_conversation_id` (quem delegou),
  `result`, `result_artifact_ids`;
- `lease_until`, `handoff_count`, `version`.

`agent_task_events` registra cada transição (from/to, ator, payload JSON) para
auditoria. `conversations.task_id` liga a thread à tarefa.

## Transições

- `queued → accepted | running | declined | cancelled | failed`
- `accepted → running | review | done | declined | handoff_pending | cancelled |
  failed`
- `running → waiting_input | waiting_approval | review | done | handoff_pending |
  queued | accepted | declined | failed | cancelled`
- `waiting_* → queued | running | accepted | handoff_pending | cancelled |
  failed`
- `review → queued | running | accepted | done | handoff_pending | failed |
  cancelled`
- `handoff_pending → accepted | running | queued | declined | cancelled |
  failed` (linhas legadas; novas transferências já entram `accepted`)

`version`/`lease_until` evitam dois runners na mesma tarefa. O claim usa CAS;
o lease expira em 30 min, o runner renova a cada 5 min e o sweep recupera
`running` com lease vencido. `queued`/`accepted` com deadline vencido viram
`failed` (`AGENT_TASK_DEADLINE`).

## Tools

Criação/transferência (capability `delegation`): `delegate_task`,
`handoff_task`, `send_message`.
Dono (sempre disponíveis): `task_list`, `task_get`, `task_wait`, `task_cancel`,
`accept_task`, `decline_task`, `update_task`, `finish_task`.

- `delegate_task` — cria tarefa para outro agente; rejeita auto-delegação,
  herda canal (inclusive de uma thread de tarefa) e tarefa-pai. Um líder de
  canal pode usar a tool mesmo com a capability `delegation` desligada; os
  demais membros continuam exigindo a capability.
- `task_list` / `task_get` — escopados ao dono/criador/canal do chamador.
- `task_wait` — espera até 300 s por um estado estável (`done`, `failed`,
  `cancelled`, `declined`, `review`, `waiting_input`, `waiting_approval`);
  devolve `waitTimedOut` sem alterar a tarefa.
- `task_cancel` — dono ou criador encerra uma tarefa não terminal; a transição
  é auditada em `agent_task_events`. O turno em execução observa o novo status
  no próximo passo (cancelamento cooperativo); o comando de UI continua sendo o
  caminho para interromper imediatamente.
- `accept_task` / `decline_task` — aceite/recusa pelo dono.
- `handoff_task` — transfere imediatamente (máx. 3), zera `conversation_id` e
  exige que o destino seja membro do canal; recusa no primeiro turno é possível.
- `update_task` — progresso (`running`, `waiting_input`, `waiting_approval`,
  `review`).
- `finish_task` — resultado + artefatos validados; só o dono.
- `send_message` — publica no canal se o agente for membro (16k chars).

Limites:

- 3 tarefas abertas por agente;
- profundidade de delegação 2;
- 3 handoffs por tarefa;
- orçamento por tarefa (turnos/tokens/custo), deadline e limite diário local
  por agente;
- tarefas não assistidas rodam com `approvals: None`/`questions: None`.

## Runner

`commands/tasks.rs`:

- tick a cada 5 s em paralelo; faz sweep de deadline/lease e não espera uma
  tarefa terminar para pegar as próximas;
- pega `queued`/`accepted` e adquire um slot do `ConcurrencyGovernor` por turno;
- `claim` CAS + heartbeat de lease por dono; nunca reutiliza a thread de outro
  dono (handoff cria thread nova);
- cria/reusa a thread da tarefa (`mode=agent`, `task_id`);
- roda até `max_turns` (16 passos por turno), checando deadline/custo/tokens
  antes de cada continuação; `TurnResult.error` vira falha, não sucesso;
- para em `waiting_input`/`waiting_approval`/`review`; `resume_agent_task`
  devolve para `queued`;
- `run_agent_task_now` inicia em background e retorna sem bloquear;
- `cancel_agent_task` cancela o turno/conversa antes de mudar o status e o
  runner não escreve transição terminal depois do cancelamento;
- terminais entregam uma mensagem `system` em `origin_conversation_id`
  (resultado como dados, não instrução) e publicam no canal quando aplicável;
  quando o dono conclui pela tool `finish_task`, o runner observa o `done` e
  publica o resultado no canal mesmo sem transicionar a tarefa de novo;
- cada turno de tarefa persiste `turn_events` e emite `lumina:turn-event`, então
  abrir a thread da tarefa durante a execução mostra streaming/passos em vez de
  um transcript vazio;
- tarefas criadas a partir da thread de um líder de canal ficam retidas enquanto
  o turno do líder está ativo; o reply dele é publicado primeiro e o próximo
  tick do scheduler inicia as tarefas;
- emite `lumina:agent-task-updated` (com `originConversationId`) no claim, em
  cada transição relevante e no fim.

## UI

- Menu do agente → **Tarefas** (`AgentTasksDialog`): lista, cria, executa agora,
  retoma, cancela e mostra orçamento/resultado/deadline.
- Botão **Quadro de tarefas** no topo da sidebar (`AgentTaskBoardDialog`):
  colunas Em fila / Em andamento / Aguardando / Revisão / Concluídas /
  Encerradas, cards com dono/orçamento/status, abrir thread, retomar,
  reatribuir e cancelar. O quadro mostra apenas tarefas com atividade nas
  últimas 24h e cada coluna rola independentemente quando passa de duas
  tarefas.
- Diálogo **Atividade** lista turnos do renderer e turnos de fundo registrados
  no backend, aprovações/perguntas pendentes e tarefas aguardando o usuário.
- Canal: mensagens de tarefa usam o mesmo histórico; o resultado é publicado
  como mensagem do agente e emite `lumina:agent-channel-updated`.
- Eventos atualizam o renderer via `lumina:agent-task-updated`.

## Limitações atuais

- O quadro é global (sidebar), não embutido por canal.
- Aprovações de tarefa em background dependem do card/notificação; não há
  reassign automático por falha.
- O scheduler só roda com o app aberto (local-first).
