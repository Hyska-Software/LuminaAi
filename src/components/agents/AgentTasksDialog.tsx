import { useCallback, useEffect, useState } from 'react';
import { Ban, Loader2, Play, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

import { AgentAvatar } from './AgentAvatar';
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
import { selectActiveAgents, useAgentStore } from '@/lib/store';
import type { Agent, AgentTask, AgentTaskStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

const STATUS_META: Record<AgentTaskStatus, { label: string; tone: string }> = {
  queued: { label: 'Na fila', tone: 'text-foreground-muted' },
  accepted: { label: 'Aceita', tone: 'text-accent' },
  running: { label: 'Executando', tone: 'text-accent' },
  waiting_input: { label: 'Aguardando resposta', tone: 'text-warning' },
  waiting_approval: { label: 'Aguardando aprovação', tone: 'text-warning' },
  review: { label: 'Em revisão', tone: 'text-accent' },
  done: { label: 'Concluída', tone: 'text-success' },
  cancelled: { label: 'Cancelada', tone: 'text-foreground-subtle' },
  failed: { label: 'Falhou', tone: 'text-danger' },
  declined: { label: 'Recusada', tone: 'text-danger' },
};

function taskTone(status: string): string {
  return STATUS_META[status as AgentTaskStatus]?.tone ?? 'text-foreground-muted';
}

function taskLabel(status: string): string {
  return STATUS_META[status as AgentTaskStatus]?.label ?? status;
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
    setForm((current) => ({
      ...current,
      toAgentId: current.toAgentId || agent?.id || '',
    }));
    void load();
  }, [open, load, agent?.id]);

  useEffect(() => {
    if (!open) return;
    const reload = () => void load();
    window.addEventListener('lumina:agent-task-updated', reload);
    return () => window.removeEventListener('lumina:agent-task-updated', reload);
  }, [open, load]);

  const create = async () => {
    if (!form.toAgentId || !form.title.trim() || !form.brief.trim()) {
      toast.error('Preencha agente destino, título e brief');
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
      toast.success('Tarefa criada', { description: task.title });
    } catch (caught) {
      toast.error('Não foi possível criar a tarefa', { description: String(caught) });
    } finally {
      setCreating(false);
    }
  };

  const runNow = async (task: AgentTask) => {
    setBusyId(task.id);
    try {
      const updated = await api.runAgentTaskNow(task.id);
      setTasks((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success('Tarefa executada', { description: task.title });
    } catch (caught) {
      toast.error('A tarefa falhou', { description: String(caught) });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (task: AgentTask) => {
    setBusyId(task.id);
    try {
      const updated = await api.cancelAgentTask(task.id);
      setTasks((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success('Tarefa cancelada', { description: task.title });
    } catch (caught) {
      toast.error('Não foi possível cancelar', { description: String(caught) });
    } finally {
      setBusyId(null);
    }
  };

  if (!agent) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Tarefas de {agent.name}</DialogTitle>
          <DialogDescription>
            Trabalho delegado com dono, orçamento e thread própria. Tarefas rodam em segundo
            plano sob o limite de concorrência do app.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[64vh] gap-4 overflow-y-auto pr-1 md:grid-cols-[1.05fr_0.95fr]">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                Tarefas
              </h3>
              <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
                {loading ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 size-3.5" />
                )}
                Atualizar
              </Button>
            </div>
            {error ? (
              <p className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] text-danger">
                {error}
              </p>
            ) : tasks.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[12px] text-foreground-subtle">
                Nenhuma tarefa ainda. Crie uma para este agente ou use `delegate_task` em um canal.
              </p>
            ) : (
              tasks.map((task) => (
                <article
                  key={task.id}
                  className="rounded-xl border border-border bg-surface-raised/50 p-3"
                >
                  <div className="flex items-start gap-2">
                    <span className={cn('mt-0.5 size-2 shrink-0 rounded-full bg-current', taskTone(task.status))} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-foreground">
                        {task.title}
                      </p>
                      <p className={cn('text-[11px]', taskTone(task.status))}>
                        {taskLabel(task.status)} · {task.handoffCount} handoff(s)
                      </p>
                      <p className="mt-1 line-clamp-2 text-[11px] text-foreground-muted">
                        {task.brief}
                      </p>
                      <p className="mt-1 text-[10px] text-foreground-subtle">
                        Orçamento: {task.maxTurns} turnos · US$ {task.maxCost.toFixed(2)} ·{' '}
                        {task.resultArtifactIds.length} artefato(s)
                      </p>
                      {task.result ? (
                        <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[11px] text-foreground-muted">
                          Resultado: {task.result}
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
                      Executar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === task.id || ['done', 'cancelled', 'failed', 'declined'].includes(task.status)}
                      onClick={() => void cancel(task)}
                    >
                      <Ban className="mr-1.5 size-3.5" />
                      Cancelar
                    </Button>
                  </div>
                </article>
              ))
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-border bg-surface-raised/40 p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
              Nova tarefa
            </h3>
            <div className="space-y-1.5">
              <Label htmlFor="task-owner">Agente dono</Label>
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
              <Label htmlFor="task-title">Título</Label>
              <Input
                id="task-title"
                value={form.title}
                maxLength={120}
                placeholder="Revisar o relatório trimestral"
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-brief">Brief</Label>
              <Textarea
                id="task-brief"
                rows={3}
                maxLength={16000}
                className="min-h-20 resize-y text-[12px]"
                placeholder="O que deve ser feito, com que contexto e restrições."
                onChange={(event) => setForm((current) => ({ ...current, brief: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-acceptance">Critério de aceite</Label>
              <Textarea
                id="task-acceptance"
                rows={2}
                maxLength={8000}
                className="min-h-14 resize-y text-[12px]"
                placeholder="Como saber que está pronto (teste, link, diff…)."
                onChange={(event) =>
                  setForm((current) => ({ ...current, acceptance: event.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="task-turns">Turnos</Label>
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
                <Label htmlFor="task-cost">Custo (US$)</Label>
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
              Criar tarefa
            </Button>
            <p className="text-[10px] leading-relaxed text-foreground-subtle">
              O dono recebe uma thread dedicada e o resultado aparece no canal quando houver um.
              Tarefas não assistidas falham fechado em aprovações.
            </p>
          </section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
