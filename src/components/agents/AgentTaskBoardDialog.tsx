import { useCallback, useEffect, useState } from 'react';
import { Ban, ListChecks, Loader2, Play, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

import { AgentAvatar } from './AgentAvatar';
import { AgentDialogBody } from './AgentDialogBody';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  NativeSelect,
} from '@/components/ui';
import { api } from '@/lib/api';
import { selectActiveAgents, useAgentStore, useChatStore, useUiStore } from '@/lib/store';
import type { Agent, AgentTask } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  TASK_BOARD_COLUMNS,
  TASK_RESUMABLE_STATUSES,
  TASK_STATUS_META,
} from './agentTaskStatus';

const CANCELLABLE: Record<string, true> = {
  queued: true,
  accepted: true,
  running: true,
  waiting_input: true,
  waiting_approval: true,
  handoff_pending: true,
  review: true,
};

/** Global kanban of delegated tasks across every agent/channel. */
export function AgentTaskBoardDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const agents = useAgentStore(useShallow(selectActiveAgents));
  const conversations = useChatStore((state) => state.conversations);
  const openConversation = useChatStore((state) => state.openConversation);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTasks(await api.listAgentTasks());
    } catch (caught) {
      setError(String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    const reload = () => void load();
    window.addEventListener('lumina:agent-task-updated', reload);
    return () => window.removeEventListener('lumina:agent-task-updated', reload);
  }, [open, load]);

  const agentById = (id: string): Agent | undefined =>
    agents.find((agent) => agent.id === id);

  const focusTask = (task: AgentTask) => {
    if (!task.conversationId) {
      toast.info('Esta tarefa ainda não tem thread', {
        description: 'Rode a tarefa para criar a thread do agente.',
      });
      return;
    }
    const conversation = conversations.find((entry) => entry.id === task.conversationId);
    useUiStore.getState().setLayoutMode('agent');
    if (conversation?.agentId ?? task.ownerAgentId) {
      useUiStore.getState().setActiveAgentId(conversation?.agentId ?? task.ownerAgentId);
    }
    void openConversation(task.conversationId);
    onOpenChange(false);
  };

  const cancel = async (task: AgentTask) => {
    if (!window.confirm(`Cancelar a tarefa “${task.title}”?`)) return;
    setBusyId(task.id);
    try {
      const updated = await api.cancelAgentTask(task.id);
      setTasks((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      toast.success('Tarefa cancelada');
    } catch (caught) {
      toast.error('Não foi possível cancelar', { description: String(caught) });
    } finally {
      setBusyId(null);
    }
  };

  const resume = async (task: AgentTask) => {
    setBusyId(task.id);
    try {
      const updated = await api.resumeAgentTask(task.id);
      setTasks((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      toast.success('Tarefa retomada');
    } catch (caught) {
      toast.error('Não foi possível retomar', { description: String(caught) });
    } finally {
      setBusyId(null);
    }
  };

  const reassign = async (task: AgentTask, toAgentId: string) => {
    if (!toAgentId || toAgentId === task.ownerAgentId) return;
    setBusyId(task.id);
    try {
      const updated = await api.reassignAgentTask(task.id, toAgentId);
      setTasks((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      toast.success('Tarefa transferida', { description: updated.title });
    } catch (caught) {
      toast.error('Não foi possível transferir', { description: String(caught) });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader className="pb-4 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="size-4 text-accent" />
            Tarefas dos agentes
          </DialogTitle>
          <DialogDescription>
            Quadro de delegações entre agentes. Abra a thread para ver o histórico completo ou
            cancele uma tarefa em execução.
          </DialogDescription>
        </DialogHeader>
        <AgentDialogBody className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-foreground-muted">
            {tasks.length} tarefa(s) · atualiza sozinho quando o status muda
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Recarregar tarefas"
          >
            {loading ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 size-3.5" />
            )}
            Atualizar
          </Button>
        </div>
        {error ? (
          <p className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger">
            {error}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {TASK_BOARD_COLUMNS.map((column) => {
            const entries = tasks.filter((task) => column.statuses.includes(task.status));
            return (
              <section
                key={column.id}
                aria-labelledby={`task-column-${column.id}`}
                className="flex min-h-32 flex-col gap-2 rounded-xl border border-border bg-surface/60 p-2"
              >
                <h3
                  id={`task-column-${column.id}`}
                  className="flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle"
                >
                  {column.title}
                  <span className="font-mono text-[10px]">{entries.length}</span>
                </h3>
                {entries.length === 0 ? (
                  <p className="px-1 py-3 text-[11px] text-foreground-subtle">Vazio</p>
                ) : (
                  entries.map((task) => {
                    const agent = agentById(task.ownerAgentId);
                    return (
                      <article
                        key={task.id}
                        className="rounded-lg border border-border bg-surface-raised p-2 shadow-sm"
                      >
                        <button
                          type="button"
                          onClick={() => focusTask(task)}
                          className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <p className="line-clamp-2 text-[12px] font-medium text-foreground">
                            {task.title}
                          </p>
                          <p className="mt-1 flex items-center gap-1.5 truncate text-[10px] text-foreground-muted">
                            {agent ? <AgentAvatar emoji={agent.emoji} size="sm" /> : null}
                            {agent?.name ?? task.ownerAgentId}
                          </p>
                          <p className="mt-1 flex flex-wrap gap-1 text-[10px] text-foreground-subtle">
                            <Badge tone={TASK_STATUS_META[task.status].badge}>
                              {TASK_STATUS_META[task.status].label}
                            </Badge>
                            <span>{task.maxTurns} turno(s)</span>
                            <span>US$ {task.maxCost.toFixed(2)}</span>
                          </p>
                        </button>
                        {TASK_RESUMABLE_STATUSES.includes(task.status) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="mt-1.5 w-full"
                            disabled={busyId === task.id}
                            onClick={() => void resume(task)}
                          >
                            <Play className="mr-1.5 size-3" />
                            Retomar
                          </Button>
                        ) : null}
                        {CANCELLABLE[task.status] ? (
                          <>
                            <NativeSelect
                              aria-label={`Reatribuir ${task.title}`}
                              className="mt-1.5 w-full text-[11px]"
                              value=""
                              disabled={busyId === task.id}
                              onChange={(event) => void reassign(task, event.target.value)}
                            >
                              <option value="">Reatribuir…</option>
                              {agents
                                .filter((entry) => entry.id !== task.ownerAgentId)
                                .map((entry) => (
                                  <option key={entry.id} value={entry.id}>
                                    {entry.name}
                                  </option>
                                ))}
                            </NativeSelect>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="mt-1.5 w-full"
                              disabled={busyId === task.id}
                              onClick={() => void cancel(task)}
                            >
                              {busyId === task.id ? (
                                <Loader2 className="mr-1.5 size-3 animate-spin" />
                              ) : (
                                <Ban className="mr-1.5 size-3" />
                              )}
                              Cancelar
                            </Button>
                          </>
                        ) : null}
                      </article>
                    );
                  })
                )}
              </section>
            );
          })}
        </div>
        </AgentDialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
