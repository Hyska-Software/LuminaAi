import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Loader2, Play, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

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
  Input,
  Label,
  NativeSelect,
  Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/i18n/format';
import { selectActiveAgents, useAgentStore } from '@/lib/store';
import type { Agent, AgentTask, AgentTaskStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  TASK_RESUMABLE_STATUSES,
  taskStatusMeta,
} from './agentTaskStatus';

function taskTone(status: string): string {
  return taskStatusMeta(status as AgentTaskStatus).tone;
}

export function AgentTasksDialog({
  agent,
  open,
  onOpenChange,
}: {
  agent: Agent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('agents');
  const agents = useAgentStore(useShallow(selectActiveAgents));
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    toAgentId: '',
    title: '',
    brief: '',
    acceptance: '',
    maxTurns: 8,
    maxCost: 1,
  });

  const load = useCallback(async () => {
    if (!agent) return;
    setLoading(true);
    setError(null);
    try {
      setTasks(await api.listAgentTasks({ ownerAgentId: agent.id }));
    } catch (caught) {
      setError(String(caught));
    } finally {
      setLoading(false);
    }
  }, [agent]);

  useEffect(() => {
    if (!open) return;
    setForm((current) => {
      const fallback = agents.find((entry) => entry.id !== agent?.id)?.id ?? '';
      const keepsCurrent =
        current.toAgentId && current.toAgentId !== agent?.id ? current.toAgentId : fallback;
      return { ...current, toAgentId: keepsCurrent };
    });
    void load();
  }, [open, load, agent?.id, agents]);

  useEffect(() => {
    if (!open) return;
    const reload = () => void load();
    window.addEventListener('zylara:agent-task-updated', reload);
    return () => window.removeEventListener('zylara:agent-task-updated', reload);
  }, [open, load]);

  const create = async () => {
    if (!form.toAgentId || !form.title.trim() || !form.brief.trim()) {
      toast.error(t('tasks.create.validation'));
      return;
    }
    if (form.toAgentId === agent?.id) {
      toast.error(t('tasks.create.otherAgent'));
      return;
    }
    setCreating(true);
    try {
      const task = await api.createAgentTask({
        toAgentId: form.toAgentId,
        title: form.title.trim(),
        brief: form.brief.trim(),
        acceptance: form.acceptance.trim(),
        maxTurns: form.maxTurns,
        maxCost: form.maxCost,
      });
      setTasks((current) => [task, ...current]);
      setForm((current) => ({
        ...current,
        title: '',
        brief: '',
        acceptance: '',
      }));
      toast.success(t('tasks.created'), { description: task.title });
    } catch (caught) {
      toast.error(t('tasks.createError'), { description: String(caught) });
    } finally {
      setCreating(false);
    }
  };

  const runNow = async (task: AgentTask) => {
    setBusyId(task.id);
    try {
      const updated = await api.runAgentTaskNow(task.id);
      setTasks((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success(t('tasks.started'), { description: task.title });
    } catch (caught) {
      toast.error(t('tasks.startError'), { description: String(caught) });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const resume = async (task: AgentTask) => {
    setBusyId(task.id);
    try {
      const updated = await api.resumeAgentTask(task.id);
      setTasks((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success(t('tasks.resumed'), { description: task.title });
    } catch (caught) {
      toast.error(t('tasks.resumeError'), { description: String(caught) });
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (task: AgentTask) => {
    setBusyId(task.id);
    try {
      const updated = await api.cancelAgentTask(task.id);
      setTasks((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success(t('tasks.cancelled'), { description: task.title });
    } catch (caught) {
      toast.error(t('tasks.cancelError'), { description: String(caught) });
    } finally {
      setBusyId(null);
    }
  };

  if (!agent) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader className="pb-4 pr-12">
          <DialogTitle>{t('tasks.forAgent', { name: agent.name })}</DialogTitle>
          <DialogDescription>
            {t('tasks.dialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <AgentDialogBody className="grid gap-4 md:grid-cols-[1.05fr_0.95fr]">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                {t('tasks.heading')}
              </h3>
              <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
                {loading ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 size-3.5" />
                )}
                {t('tasks.refresh')}
              </Button>
            </div>
            {error ? (
              <p className="rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-danger">
                {error}
              </p>
            ) : tasks.length === 0 ? (
              <p className="rounded-xl border-dashed px-3 py-6 text-center text-[12px] text-foreground-subtle">
                {t('tasks.emptyHint')}
              </p>
            ) : (
              tasks.map((task) => {
                const meta = taskStatusMeta(task.status);
                return (
                <article
                  key={task.id}
                  className="rounded-xl bg-surface p-3"
                >
                  <div className="flex items-start gap-2">
                    <span className={cn('mt-0.5 size-2 shrink-0 rounded-full bg-current', taskTone(task.status))} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-foreground">
                        {task.title}
                      </p>
                      <p className={cn('text-[11px]', meta.tone)}>
                        {t(meta.labelKey as never)} · {t('tasks.handoffs', { count: task.handoffCount })}
                      </p>
                      <p className="mt-1 line-clamp-2 text-[11px] text-foreground-muted">
                        {task.brief}
                      </p>
                      <p className="mt-1 text-[10px] text-foreground-subtle">
                        {t('tasks.budget', {
                          turns: task.maxTurns,
                          cost: formatCurrency(task.maxCost),
                          artifacts: task.resultArtifactIds.length,
                        })}
                        {task.deadlineAt
                          ? ` · ${t('tasks.deadline', { date: formatDateTime(new Date(task.deadlineAt)) })}`
                          : ''}
                      </p>
                      {task.result ? (
                        <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[11px] text-foreground-muted">
                          {t('tasks.result', { result: task.result })}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === task.id || !['queued', 'accepted'].includes(task.status)}
                      onClick={() => void runNow(task)}
                    >
                      {busyId === task.id ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <Play className="mr-1.5 size-3.5" />
                      )}
                      {t('tasks.run')}
                    </Button>
                    {TASK_RESUMABLE_STATUSES.includes(task.status) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === task.id}
                        onClick={() => void resume(task)}
                      >
                        <Play className="mr-1.5 size-3.5" />
                        {t('tasks.resume')}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === task.id || ['done', 'cancelled', 'failed', 'declined'].includes(task.status)}
                      onClick={() => void cancel(task)}
                    >
                      <Ban className="mr-1.5 size-3.5" />
                      {t('tasks.cancel')}
                    </Button>
                  </div>
                </article>
                );
              })
            )}
          </section>

          <section className="space-y-3 rounded-xl bg-surface p-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
              {t('tasks.newTask')}
            </h3>
            <div className="space-y-1.5">
              <Label htmlFor="task-owner">{t('tasks.form.owner')}</Label>
              <NativeSelect
                id="task-owner"
                value={form.toAgentId}
                onChange={(event) => setForm((current) => ({ ...current, toAgentId: event.target.value }))}
              >
                {agents.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-title">{t('tasks.form.title')}</Label>
              <Input
                id="task-title"
                value={form.title}
                maxLength={120}
                placeholder={t('tasks.form.titlePlaceholder')}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-brief">{t('tasks.form.brief')}</Label>
              <Textarea
                id="task-brief"
                rows={3}
                maxLength={16000}
                value={form.brief}
                className="min-h-20 resize-y text-[12px]"
                placeholder={t('tasks.form.briefPlaceholder')}
                onChange={(event) => setForm((current) => ({ ...current, brief: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-acceptance">{t('tasks.form.acceptance')}</Label>
              <Textarea
                id="task-acceptance"
                rows={2}
                maxLength={8000}
                value={form.acceptance}
                className="min-h-14 resize-y text-[12px]"
                placeholder={t('tasks.form.acceptancePlaceholder')}
                onChange={(event) =>
                  setForm((current) => ({ ...current, acceptance: event.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="task-turns">{t('tasks.form.turns')}</Label>
                <Input
                  id="task-turns"
                  type="number"
                  min={1}
                  max={32}
                  value={form.maxTurns}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, maxTurns: Number(event.target.value) || 1 }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-cost">{t('tasks.form.cost')}</Label>
                <Input
                  id="task-cost"
                  type="number"
                  min={0.01}
                  max={50}
                  step={0.01}
                  value={form.maxCost}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, maxCost: Number(event.target.value) || 0.01 }))
                  }
                />
              </div>
            </div>
            <Button size="sm" variant="primary" disabled={creating} onClick={() => void create()}>
              {creating ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Plus className="mr-1.5 size-3.5" />
              )}
              {t('tasks.createTask')}
            </Button>
            <p className="text-[10px] leading-relaxed text-foreground-subtle">
              {t('tasks.form.footnote')}
            </p>
          </section>
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
