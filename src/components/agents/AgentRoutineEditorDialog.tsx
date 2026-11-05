import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
  Input,
  Label,
  NativeSelect,
  Switch,
  Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import { ROUTINE_ALL_DAYS, ROUTINE_WEEKDAYS } from '@/lib/routineCalendar';
import type { Agent, AgentRoutine, AgentRoutineInput } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface AgentRoutineEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: Agent[];
  routine?: AgentRoutine | null;
  initialAgentId?: string | null;
  onSaved: (routine: AgentRoutine) => void;
}

function emptyInput(): AgentRoutineInput {
  return {
    title: '',
    prompt: '',
    scheduleKind: 'interval',
    intervalMinutes: 60,
    hour: 9,
    minute: 0,
    daysOfWeek: ROUTINE_ALL_DAYS,
    enabled: true,
    triggerKind: 'schedule',
    eventKind: '',
    eventFilterJson: '{}',
  };
}

function inputFrom(routine: AgentRoutine): AgentRoutineInput {
  return {
    title: routine.title,
    prompt: routine.prompt,
    scheduleKind: routine.scheduleKind,
    intervalMinutes: routine.intervalMinutes || 60,
    hour: routine.hour,
    minute: routine.minute,
    daysOfWeek: routine.daysOfWeek,
    enabled: routine.enabled,
    triggerKind: routine.triggerKind,
    eventKind: routine.eventKind,
    eventFilterJson: routine.eventFilterJson || '{}',
  };
}

/**
 * Create/edit form shared by the routines page and the agent side panel. The
 * owner of an existing routine is immutable; creating can target any active
 * agent.
 */
export function AgentRoutineEditorDialog({
  open,
  onOpenChange,
  agents,
  routine = null,
  initialAgentId = null,
  onSaved,
}: AgentRoutineEditorDialogProps) {
  const [agentId, setAgentId] = useState('');
  const [form, setForm] = useState<AgentRoutineInput>(emptyInput);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (routine) {
      setAgentId(routine.agentId);
      setForm(inputFrom(routine));
    } else {
      const preferred =
        agents.find(
          (agent) => agent.id === initialAgentId && agent.archivedAt === null,
        ) ?? agents.find((agent) => agent.archivedAt === null);
      setAgentId(preferred?.id ?? '');
      setForm(emptyInput());
    }
    setError(null);
    // `agents` is intentionally not a dependency: the panel recreates `[agent]`
    // every render and resetting here would erase the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, routine?.id, initialAgentId]);

  const toggleDay = (bit: number) => {
    setForm((current) => ({ ...current, daysOfWeek: current.daysOfWeek ^ bit }));
  };

  const save = async () => {
    const title = form.title.trim();
    const prompt = form.prompt.trim();
    if (!agentId) {
      setError('Escolha o agente da rotina.');
      return;
    }
    if (!title) {
      setError('Dê um título à rotina.');
      return;
    }
    if (!prompt) {
      setError('Descreva a instrução da rotina.');
      return;
    }
    if (form.triggerKind === 'event' && !form.eventKind) {
      setError('Escolha o tipo de evento.');
      return;
    }
    if (
      form.triggerKind === 'schedule' &&
      form.scheduleKind === 'daily' &&
      form.daysOfWeek === 0
    ) {
      setError('Escolha ao menos um dia.');
      return;
    }

    const payload: AgentRoutineInput = { ...form, title, prompt };
    setSaving(true);
    setError(null);
    try {
      const saved = routine
        ? await api.updateAgentRoutine(routine.id, payload)
        : await api.createAgentRoutine(agentId, payload);
      toast.success(routine ? 'Rotina atualizada' : 'Rotina criada', {
        description: saved.title,
      });
      onSaved(saved);
      onOpenChange(false);
    } catch (caught) {
      toast.error('Não foi possível salvar a rotina', {
        description: String(caught),
      });
    } finally {
      setSaving(false);
    }
  };

  const daily = form.triggerKind === 'schedule' && form.scheduleKind === 'daily';
  const ownerMissing = routine ? !agents.some((agent) => agent.id === routine.agentId) : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader className="pb-4 pr-12">
          <DialogTitle>{routine ? 'Editar rotina' : 'Nova rotina'}</DialogTitle>
          <DialogDescription>
            Uma instrução que o agente executa sozinho na thread dedicada da rotina.
          </DialogDescription>
        </DialogHeader>

        <AgentDialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="routine-agent">Agente</Label>
            <NativeSelect
              id="routine-agent"
              value={agentId}
              disabled={Boolean(routine)}
              onChange={(event) => setAgentId(event.target.value)}
            >
              {!routine ? (
                <option value="" disabled>
                  Selecione um agente
                </option>
              ) : null}
              {agents.map((agent) => (
                <option
                  key={agent.id}
                  value={agent.id}
                  disabled={!routine && agent.archivedAt !== null}
                >
                  {agent.name}
                  {agent.archivedAt !== null ? ' (arquivado)' : ''}
                </option>
              ))}
              {ownerMissing && routine ? (
                <option value={routine.agentId}>{routine.agentId}</option>
              ) : null}
            </NativeSelect>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="routine-title">Título</Label>
            <Input
              id="routine-title"
              value={form.title}
              maxLength={80}
              autoFocus
              placeholder="Resumo diário do repositório"
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
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
              onChange={(event) =>
                setForm((current) => ({ ...current, prompt: event.target.value }))
              }
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="routine-trigger">Gatilho</Label>
              <NativeSelect
                id="routine-trigger"
                value={form.triggerKind}
                onChange={(event) => {
                  const triggerKind = event.target
                    .value as AgentRoutineInput['triggerKind'];
                  setForm((current) => ({
                    ...current,
                    triggerKind,
                    eventKind:
                      triggerKind === 'event'
                        ? current.eventKind || 'channel.message'
                        : '',
                  }));
                }}
              >
                <option value="schedule">Agendada</option>
                <option value="event">Por evento</option>
              </NativeSelect>
            </div>

            {form.triggerKind === 'schedule' ? (
              <div className="space-y-1.5">
                <Label htmlFor="routine-kind">Frequência</Label>
                <NativeSelect
                  id="routine-kind"
                  value={form.scheduleKind}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      scheduleKind: event.target
                        .value as AgentRoutineInput['scheduleKind'],
                    }))
                  }
                >
                  <option value="interval">A cada intervalo</option>
                  <option value="daily">Todos os dias</option>
                </NativeSelect>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="routine-event">Evento</Label>
                <NativeSelect
                  id="routine-event"
                  value={form.eventKind}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      eventKind: event.target
                        .value as AgentRoutineInput['eventKind'],
                    }))
                  }
                >
                  <option value="channel.message">Mensagem em canal</option>
                  <option value="task.status">Status de tarefa</option>
                </NativeSelect>
              </div>
            )}

            {form.triggerKind === 'schedule' && form.scheduleKind === 'interval' ? (
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
            ) : null}

            {daily ? (
              <div className="space-y-1.5 sm:col-span-2">
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
                        hour: Math.max(
                          0,
                          Math.min(23, Number(event.target.value) || 0),
                        ),
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
                        minute: Math.max(
                          0,
                          Math.min(59, Number(event.target.value) || 0),
                        ),
                      }))
                    }
                  />
                </div>
              </div>
            ) : null}

            {form.triggerKind === 'event' ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="routine-filter">Filtro JSON (opcional)</Label>
                <Input
                  id="routine-filter"
                  value={form.eventFilterJson}
                  placeholder='{"channelId":"..."}'
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      eventFilterJson: event.target.value,
                    }))
                  }
                />
              </div>
            ) : null}
          </div>

          {daily ? (
            <div className="space-y-1.5">
              <Label>Dias da semana</Label>
              <div role="group" aria-label="Dias da semana" className="flex flex-wrap gap-1">
                {ROUTINE_WEEKDAYS.map((day) => {
                  const active = (form.daysOfWeek & day.bit) !== 0;
                  return (
                    <button
                      key={day.bit}
                      type="button"
                      aria-label={day.long}
                      aria-pressed={active}
                      onClick={() => toggleDay(day.bit)}
                      className={cn(
                        'h-7 rounded-lg border px-2 text-[11px] font-medium transition-colors duration-150',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                        active
                          ? 'border-accent/40 bg-accent-soft text-accent'
                          : 'border-border text-foreground-muted hover:bg-surface-hover hover:text-foreground',
                      )}
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <Switch
            checked={form.enabled}
            onCheckedChange={(checked) =>
              setForm((current) => ({ ...current, enabled: checked }))
            }
            label="Ativa"
            description="Rotinas desativadas não são executadas pelo agendador."
          />

          {error ? (
            <p role="alert" className="text-[11px] text-danger">
              {error}
            </p>
          ) : null}

          <p className="text-[10px] leading-relaxed text-foreground-subtle">
            O agendador roda enquanto o app estiver aberto. O resultado aparece na conversa da
            rotina; não há execução em nuvem.
          </p>
        </AgentDialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            {routine ? 'Salvar rotina' : 'Criar rotina'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
