import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { formatCurrency } from '@/lib/i18n/format';
import { selectActiveAgents, useAgentStore, useChatStore, useUiStore } from '@/lib/store';
import type { Agent, AgentChannel, AgentTask } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  TASK_BOARD_COLUMNS,
  TASK_RESUMABLE_STATUSES,
  taskStatusMeta,
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

const REASSIGNABLE: Record<string, true> = {
  accepted: true,
  running: true,
  waiting_input: true,
  waiting_approval: true,
  review: true,
};

/** The board only keeps recent work visible; older tasks stay in the DB. */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Global kanban of delegated tasks across every agent/channel. */
export function AgentTaskBoardDialog({
  open,
  onOpenChange,
  channelId,
  ownerAgentId,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId?: string;
  ownerAgentId?: string;
  title?: string;
}) {
  const { t } = useTranslation('agents');
  const agents = useAgentStore(useShallow(selectActiveAgents));
  const conversations = useChatStore((state) => state.conversations);
  const openConversation = useChatStore((state) => state.openConversation);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [channels, setChannels] = useState<AgentChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextTasks, nextChannels] = await Promise.all([
        api.listAgentTasks({ channelId, ownerAgentId }),
        api.listAgentChannels(),
      ]);
      const cutoff = Date.now() - RECENT_WINDOW_MS;
      setTasks(nextTasks.filter((task) => task.updatedAt >= cutoff));
      setChannels(nextChannels);
    } catch (caught) {
      setError(String(caught));
    } finally {
      setLoading(false);
    }
  }, [channelId, ownerAgentId]);

  useEffect(() => {
    if (!open) return;
    void load();
    const reload = () => void load();
    window.addEventListener('zylara:agent-task-updated', reload);
    return () => window.removeEventListener('zylara:agent-task-updated', reload);
  }, [open, load]);

  const agentById = (id: string): Agent | undefined =>
    agents.find((agent) => agent.id === id);

  const focusTask = (task: AgentTask) => {
    if (!task.conversationId) {
      toast.info(t('tasks.noThreadTitle'), {
        description: t('tasks.noThreadDescription'),
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
    if (!window.confirm(t('tasks.cancelConfirm', { title: task.title }))) return;
    setBusyId(task.id);
    try {
      const updated = await api.cancelAgentTask(task.id);
      setTasks((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      toast.success(t('tasks.cancelled'));
    } catch (caught) {
      toast.error(t('tasks.cancelError'), { description: String(caught) });
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
      toast.success(t('tasks.resumed'));
    } catch (caught) {
      toast.error(t('tasks.resumeError'), { description: String(caught) });
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
      toast.success(t('tasks.reassigned'), { description: updated.title });
    } catch (caught) {
      toast.error(t('tasks.reassignError'), { description: String(caught) });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader className="pb-4 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="size-4 text-accent" />
            {title ?? t('tasks.title')}
          </DialogTitle>
          <DialogDescription>
            {t('tasks.description')}
          </DialogDescription>
        </DialogHeader>
        <AgentDialogBody className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-foreground-muted">
            {t('tasks.recentSummary', { count: tasks.length })}
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void load()}
            disabled={loading}
            aria-label={t('tasks.reloadAria')}
          >
            {loading ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 size-3.5" />
            )}
            {t('tasks.refresh')}
          </Button>
        </div>
        {error ? (
          <p className="rounded-xl bg-danger-soft px-3 py-2 text-[12px] text-danger">
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
                className="flex max-h-[min(18rem,50vh)] min-h-32 flex-col gap-2 rounded-xl bg-surface p-2"
              >
                <h3
                  id={`task-column-${column.id}`}
                  className="flex shrink-0 items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle"
                >
                  {t(column.titleKey as never)}
                  <span className="font-mono text-[10px]">{entries.length}</span>
                </h3>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
                {entries.length === 0 ? (
                  <p className="px-1 py-3 text-[11px] text-foreground-subtle">{t('tasks.empty')}</p>
                ) : (
                  entries.map((task) => {
                    const agent = agentById(task.ownerAgentId);
                    const meta = taskStatusMeta(task.status);
                    return (
                      <article
                        key={task.id}
                        className="min-w-0 rounded-lg bg-surface-raised p-2 shadow-sm"
                      >
                        <button
                          type="button"
                          onClick={() => focusTask(task)}
                          className="block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <p className="line-clamp-2 text-[12px] font-medium text-foreground">
                            {task.title}
                          </p>
                          <p className="mt-1 flex items-center gap-1.5 truncate text-[10px] text-foreground-muted">
                            {agent ? <AgentAvatar avatar={agent.avatar} size="sm" /> : null}
                            {agent?.name ?? task.ownerAgentId}
                          </p>
                          <p className="mt-1 flex flex-wrap gap-1 text-[10px] text-foreground-subtle">
                            <Badge tone={meta.badge}>
                              {t(meta.labelKey as never)}
                            </Badge>
                            <span>{t('tasks.turns', { count: task.maxTurns })}</span>
                            <span>{formatCurrency(task.maxCost)}</span>
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
                            {t('tasks.resume')}
                          </Button>
                        ) : null}
                        {REASSIGNABLE[task.status] ? (
                          <>
                            <NativeSelect
                              aria-label={t('tasks.reassignAria', { title: task.title })}
                              className="mt-1.5 w-full text-[11px]"
                              value=""
                              disabled={busyId === task.id}
                              onChange={(event) => void reassign(task, event.target.value)}
                            >
                              <option value="">{t('tasks.reassign')}</option>
                              {agents
                                .filter((entry) => entry.id !== task.ownerAgentId)
                                .filter((entry) => {
                                  const channel = channels.find(
                                    (item) => item.id === task.channelId,
                                  );
                                  return !channel || channel.memberIds.includes(entry.id);
                                })
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
                              {t('tasks.cancel')}
                            </Button>
                          </>
                        ) : CANCELLABLE[task.status] ? (
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
                            {t('tasks.cancel')}
                          </Button>
                        ) : null}
                      </article>
                    );
                  })
                )}
                </div>
              </section>
            );
          })}
        </div>
        </AgentDialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
