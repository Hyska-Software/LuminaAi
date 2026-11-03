import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Loader2, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { AgentDialogBody } from './AgentDialogBody';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Input,
  Label,
  NativeSelect,
  Switch,
  Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import type { Agent, AgentRoutine, AgentRoutineInput } from '@/lib/types';
import { cn } from '@/lib/utils';

function relative(timestamp: number | null | undefined): string {
  if (!timestamp) return '—';
  const delta = timestamp - Date.now();
  const future = delta > 0;
  const abs = Math.abs(delta);
  const minutes = Math.round(abs / 60_000);
  const value =
    minutes < 60
      ? `${Math.max(1, minutes)} min`
      : minutes < 1440
        ? `${Math.round(minutes / 60)} h`
        : `${Math.round(minutes / 1440)} d`;
  return future ? `em ${value}` : `há ${value}`;
}

const STATUS_LABELS: Record<string, string> = {
  ok: 'concluída',
  error: 'erro',
  blocked: 'bloqueada',
  running: 'executando',
};

function scheduleLabel(routine: Pick<AgentRoutine, 'scheduleKind' | 'intervalMinutes' | 'hour' | 'minute'>): string {
  if (routine.scheduleKind === 'daily') {
    return `Todos os dias às ${String(routine.hour).padStart(2, '0')}:${String(routine.minute).padStart(2, '0')}`;
  }
  if (routine.intervalMinutes % 60 === 0) {
    return `A cada ${routine.intervalMinutes / 60} h`;
  }
  return `A cada ${routine.intervalMinutes} min`;
}

function emptyInput(): AgentRoutineInput {
  return {
    title: '',
    prompt: '',
    scheduleKind: 'interval',
    intervalMinutes: 60,
    hour: 9,
    minute: 0,
    enabled: true,
  };
}

/**
 * CRUD + run-now for one agent's routines. The scheduler runs in the Rust
 * backend while the app is open; a run appends a normal turn to the routine's
 * dedicated thread.
 */
export function AgentRoutinesDialog({
  agent,
  open,
  onOpenChange,
}: {
  agent: Agent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [routines, setRoutines] = useState<AgentRoutine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AgentRoutine | null>(null);
  const [form, setForm] = useState<AgentRoutineInput>(emptyInput);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!agent) return;
    setLoading(true);
    setError(null);
    try {
      setRoutines(await api.listAgentRoutines(agent.id));
    } catch (caught) {
      setError(String(caught));
    } finally {
      setLoading(false);
    }
  }, [agent]);

  useEffect(() => {
    if (!open) {
      setEditing(null);
      setForm(emptyInput());
      return;
    }
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const reload = () => void load();
    window.addEventListener('lumina:agent-routine-run', reload);
    return () => window.removeEventListener('lumina:agent-routine-run', reload);
  }, [open, load]);

  const startCreate = () => {
    setEditing(null);
    setForm(emptyInput());
  };

  const startEdit = (routine: AgentRoutine) => {
    setEditing(routine);
    setForm({
      title: routine.title,
      prompt: routine.prompt,
      scheduleKind: routine.scheduleKind,
      intervalMinutes: routine.intervalMinutes || 60,
      hour: routine.hour,
      minute: routine.minute,
      enabled: routine.enabled,
    });
  };

  const save = async () => {
    if (!agent) return;
    if (!form.title.trim()) {
      toast.error('Dê um título à rotina');
      return;
    }
    if (!form.prompt.trim()) {
      toast.error('Descreva a instrução da rotina');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const updated = await api.updateAgentRoutine(editing.id, form);
        setRoutines((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        toast.success('Rotina atualizada', { description: updated.title });
      } else {
        const created = await api.createAgentRoutine(agent.id, form);
        setRoutines((current) => [...current, created]);
        toast.success('Rotina criada', { description: created.title });
      }
      startCreate();
    } catch (caught) {
      toast.error('Não foi possível salvar a rotina', { description: String(caught) });
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (routine: AgentRoutine, enabled: boolean) => {
    try {
      const updated = await api.setAgentRoutineEnabled(routine.id, enabled);
      setRoutines((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (caught) {
      toast.error('Não foi possível atualizar a rotina', { description: String(caught) });
    }
  };

  const runNow = async (routine: AgentRoutine) => {
    setRunningId(routine.id);
    try {
      await api.runAgentRoutineNow(routine.id);
      toast.success('Rotina executada', { description: routine.title });
      await load();
    } catch (caught) {
      toast.error('A rotina falhou', { description: String(caught) });
      await load();
    } finally {
      setRunningId(null);
    }
  };

  const remove = async (routine: AgentRoutine) => {
    // eslint-disable-next-line no-alert -- destructive action needs a native confirmation here
    if (!window.confirm(`Excluir a rotina “${routine.title}”? A conversa dela é preservada.`)) return;
    try {
      await api.deleteAgentRoutine(routine.id);
      setRoutines((current) => current.filter((item) => item.id !== routine.id));
      if (editing?.id === routine.id) startCreate();
      toast.success('Rotina excluída');
    } catch (caught) {
      toast.error('Não foi possível excluir a rotina', { description: String(caught) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader className="pb-4 pr-12">
          <DialogTitle>Rotinas de {agent?.name ?? 'agente'}</DialogTitle>
          <DialogDescription>
            Uma instrução com horário. Cada execução entra na conversa dedicada da rotina, com o
            contexto e o workspace do agente.
          </DialogDescription>
        </DialogHeader>

        <AgentDialogBody className="grid gap-4 md:grid-cols-[1.05fr_0.95fr]">
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                Agendadas
              </h3>
              <Button size="sm" variant="ghost" onClick={startCreate}>
                <Plus className="mr-1.5 size-3.5" />
                Nova
              </Button>
            </div>
            {loading ? (
              <p className="py-4 text-center text-[12px] text-foreground-muted">Carregando…</p>
            ) : error ? (
              <div className="py-4 text-center text-[12px] text-foreground-muted">
                Não foi possível carregar as rotinas.
                <Button size="sm" variant="ghost" className="ml-1 px-0" onClick={() => void load()}>
                  Tentar novamente
                </Button>
              </div>
            ) : routines.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[12px] text-foreground-subtle">
                Nenhuma rotina ainda. Crie uma para o agente lembrar de fazer algo por conta própria.
              </p>
            ) : (
              routines.map((routine) => (
                <article
                  key={routine.id}
                  className={cn(
                    'rounded-xl border border-border bg-surface/50 p-3',
                    editing?.id === routine.id && 'border-accent/40 bg-accent-soft/30',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <CalendarClock className="mt-0.5 size-4 shrink-0 text-accent" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-foreground">
                        {routine.title}
                      </p>
                      <p className="truncate text-[11px] text-foreground-muted">
                        {scheduleLabel(routine)} · próxima {relative(routine.nextRunAt)}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-foreground-subtle">
                        {routine.prompt}
                      </p>
                      {routine.lastStatus ? (
                        <p
                          className={cn(
                            'mt-1 text-[10px]',
                            routine.lastStatus === 'ok'
                              ? 'text-success'
                              : routine.lastStatus === 'running'
                                ? 'text-accent'
                                : 'text-danger',
                          )}
                        >
                          Última execução: {STATUS_LABELS[routine.lastStatus] ?? routine.lastStatus}
                          {routine.lastError ? ` · ${routine.lastError}` : ''}
                        </p>
                      ) : null}
                    </div>
                    <Switch
                      checked={routine.enabled}
                      onCheckedChange={(checked) => void toggle(routine, checked)}
                      aria-label={`Ativar rotina ${routine.title}`}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={runningId === routine.id}
                      onClick={() => void runNow(routine)}
                    >
                      {runningId === routine.id ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <Play className="mr-1.5 size-3.5" />
                      )}
                      Executar
                    </Button>
                    <IconButton
                      label={`Editar rotina ${routine.title}`}
                      size="sm"
                      variant="ghost"
                      onClick={() => startEdit(routine)}
                    >
                      <Pencil className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label={`Excluir rotina ${routine.title}`}
                      size="sm"
                      variant="ghost"
                      onClick={() => void remove(routine)}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                </article>
              ))
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-border bg-surface/50 p-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
              {editing ? 'Editar rotina' : 'Nova rotina'}
            </h3>
            <div className="space-y-1.5">
              <Label htmlFor="routine-title">Título</Label>
              <Input
                id="routine-title"
                value={form.title}
                maxLength={80}
                placeholder="Resumo diário do repositório"
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="routine-prompt">Instrução</Label>
              <Textarea
                id="routine-prompt"
                value={form.prompt}
                rows={4}
                maxLength={8192}
                className="min-h-24 resize-y text-[12px]"
                placeholder="Liste os testes que passaram a falhar desde a última execução."
                onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="routine-kind">Frequência</Label>
                <NativeSelect
                  id="routine-kind"
                  value={form.scheduleKind}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      scheduleKind: event.target.value as AgentRoutineInput['scheduleKind'],
                    }))
                  }
                >
                  <option value="interval">A cada intervalo</option>
                  <option value="daily">Todos os dias</option>
                </NativeSelect>
              </div>
              {form.scheduleKind === 'interval' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="routine-interval">Intervalo (min)</Label>
                  <Input
                    id="routine-interval"
                    type="number"
                    min={5}
                    max={10080}
                    value={form.intervalMinutes}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        intervalMinutes: Number(event.target.value) || 60,
                      }))
                    }
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>Horário</Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      aria-label="Hora"
                      type="number"
                      min={0}
                      max={23}
                      value={form.hour}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          hour: Math.max(0, Math.min(23, Number(event.target.value) || 0)),
                        }))
                      }
                    />
                    <span className="text-foreground-subtle">:</span>
                    <Input
                      aria-label="Minuto"
                      type="number"
                      min={0}
                      max={59}
                      value={form.minute}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          minute: Math.max(0, Math.min(59, Number(event.target.value) || 0)),
                        }))
                      }
                    />
                  </div>
                </div>
              )}
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(checked) => setForm((current) => ({ ...current, enabled: checked }))}
              label="Ativa"
              description="Rotinas desativadas não são executadas pelo agendador."
            />
            <div className="flex justify-end gap-2 pt-1">
              {editing ? (
                <Button size="sm" variant="ghost" onClick={startCreate}>
                  Cancelar
                </Button>
              ) : null}
              <Button size="sm" variant="primary" disabled={saving} onClick={() => void save()}>
                {saving ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                {editing ? 'Salvar rotina' : 'Criar rotina'}
              </Button>
            </div>
            <p className="text-[10px] leading-relaxed text-foreground-subtle">
              O agendador roda enquanto o app estiver aberto. O resultado aparece na conversa da
              rotina; não há execução em nuvem.
            </p>
          </section>
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
