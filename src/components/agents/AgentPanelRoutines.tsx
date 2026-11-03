import { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock,
  ChevronRight,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
} from 'lucide-react';
import { toast } from 'sonner';

import type { AgentPanelContext } from './AgentPanel';
import { AgentRoutinesDialog } from './AgentRoutinesDialog';
import { Badge, Button, Switch } from '@/components/ui';
import { api } from '@/lib/api';
import type { AgentRoutine, AgentRoutineRun } from '@/lib/types';
import { cn } from '@/lib/utils';

function scheduleLabel(routine: AgentRoutine): string {
  if (routine.scheduleKind === 'daily') {
    return `Todos os dias às ${String(routine.hour).padStart(2, '0')}:${String(routine.minute).padStart(2, '0')}`;
  }
  if (routine.intervalMinutes % 60 === 0) return `A cada ${routine.intervalMinutes / 60} h`;
  return `A cada ${routine.intervalMinutes} min`;
}

function relative(timestamp: number | null): string {
  if (!timestamp) return 'Ainda não executada';
  const delta = timestamp - Date.now();
  const future = delta > 0;
  const minutes = Math.max(1, Math.round(Math.abs(delta) / 60_000));
  const value =
    minutes < 60
      ? `${minutes} min`
      : minutes < 1440
        ? `${Math.round(minutes / 60)} h`
        : `${Math.round(minutes / 1440)} d`;
  return future ? `Em ${value}` : `Há ${value}`;
}

const STATUS_LABELS: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
  ok: { label: 'Concluída', tone: 'success' },
  error: { label: 'Erro', tone: 'danger' },
  blocked: { label: 'Bloqueada', tone: 'warning' },
  running: { label: 'Executando', tone: 'warning' },
};

/** Routine list, quick actions and execution log links for one agent. */
export function AgentPanelRoutines({ context }: { context: AgentPanelContext }) {
  const { agent, openThread } = context;
  const [routines, setRoutines] = useState<AgentRoutine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [runs, setRuns] = useState<Array<{ run: AgentRoutineRun; routine: AgentRoutine }>>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRoutines(await api.listAgentRoutines(agent.id));
    } catch (caught) {
      setError(String(caught));
    } finally {
      setLoading(false);
    }
  }, [agent.id]);

  useEffect(() => {
    void load();
    const reload = () => void load();
    window.addEventListener('lumina:agent-routine-run', reload);
    return () => window.removeEventListener('lumina:agent-routine-run', reload);
  }, [load]);

  const toggle = async (routine: AgentRoutine) => {
    setBusyId(routine.id);
    try {
      const updated = await api.setAgentRoutineEnabled(routine.id, !routine.enabled);
      setRoutines((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
    } catch (caught) {
      toast.error('Não foi possível alterar a rotina', { description: String(caught) });
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (routine: AgentRoutine) => {
    setBusyId(routine.id);
    try {
      const updated = await api.runAgentRoutineNow(routine.id);
      setRoutines((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      toast.success('Rotina executada', {
        description: updated.lastStatus === 'error' ? updated.lastError ?? 'Erro' : routine.title,
      });
    } catch (caught) {
      toast.error('Não foi possível executar a rotina', { description: String(caught) });
    } finally {
      setBusyId(null);
    }
  };

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const entries = await Promise.all(
        routines.map(async (routine) => {
          const list = await api.listAgentRoutineRuns(routine.id, 10).catch(() => []);
          return list.map((run) => ({ run, routine }));
        }),
      );
      setRuns(
        entries
          .flat()
          .sort((left, right) => right.run.startedAt - left.run.startedAt)
          .slice(0, 30),
      );
    } finally {
      setRunsLoading(false);
    }
  }, [routines]);

  useEffect(() => {
    if (!logsOpen) return;
    void loadRuns();
  }, [logsOpen, loadRuns]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-3 p-3">
        <section className="rounded-xl border border-border bg-surface-raised/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarClock className="size-4 text-accent" />
              <div>
                <p className="text-[13px] font-medium text-foreground">Rotinas</p>
                <p className="text-[11px] text-foreground-muted">
                  {routines.length} agendamento(s) para {agent.name}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void load()}
              disabled={loading}
              aria-label="Recarregar rotinas"
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1.5 size-3.5" />
              Criar agendamento
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setLogsOpen((current) => !current)}
            >
              <ScrollText className="mr-1.5 size-3.5" />
              Registros de execução
            </Button>
          </div>
        </section>

        {error ? (
          <p className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-[11px] text-danger">
            {error}
          </p>
        ) : null}

        {logsOpen ? (
          <section aria-label="Registros de execução" className="flex flex-col gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
              Últimas execuções
            </h3>
            {runsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="size-4 animate-spin text-foreground-muted" />
              </div>
            ) : runs.length === 0 ? (
              <p className="rounded-lg border border-border bg-surface-raised/40 px-3 py-3 text-[11px] text-foreground-muted">
                Nenhuma execução registrada ainda.
              </p>
            ) : (
              runs.map(({ run, routine }) => {
                const meta = STATUS_LABELS[run.status] ?? null;
                return (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() =>
                      run.conversationId && openThread(run.conversationId)
                    }
                    className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-2.5 py-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <ScrollText className="size-3.5 shrink-0 text-foreground-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-foreground">
                        {routine.title}
                      </span>
                      <span className="block truncate text-[10px] text-foreground-muted">
                        {relative(run.startedAt)} · {run.error ?? scheduleLabel(routine)}
                      </span>
                    </span>
                    {meta ? <Badge tone={meta.tone}>{meta.label}</Badge> : null}
                    <ChevronRight className="size-3.5 text-foreground-subtle" />
                  </button>
                );
              })
            )}
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          {loading && routines.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-foreground-muted" />
            </div>
          ) : routines.length === 0 ? (
            <p className="rounded-xl border border-border bg-surface-raised/40 px-3 py-6 text-center text-[12px] text-foreground-muted">
              Nenhuma rotina. Crie um agendamento para {agent.name} trabalhar sozinho enquanto o
              app estiver aberto.
            </p>
          ) : (
            routines.map((routine) => {
              const meta = STATUS_LABELS[routine.lastStatus ?? ''] ?? null;
              return (
                <article
                  key={routine.id}
                  className={cn(
                    'rounded-xl border border-border bg-surface-raised/40 p-3',
                    !routine.enabled && 'opacity-70',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-foreground">
                        {routine.title}
                      </p>
                      <p className="text-[11px] text-foreground-muted">
                        {scheduleLabel(routine)}
                      </p>
                      <p className="mt-0.5 text-[10px] text-foreground-subtle">
                        {routine.enabled ? 'Ativa' : 'Pausada'} · {relative(routine.lastRunAt)} ·{' '}
                        {relative(routine.nextRunAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {meta ? <Badge tone={meta.tone}>{meta.label}</Badge> : null}
                      <Switch
                        checked={routine.enabled}
                        onCheckedChange={() => void toggle(routine)}
                        disabled={busyId === routine.id}
                        aria-label={`${routine.enabled ? 'Pausar' : 'Ativar'} ${routine.title}`}
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === routine.id}
                      onClick={() => void runNow(routine)}
                    >
                      {busyId === routine.id ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <Play className="mr-1.5 size-3.5" />
                      )}
                      Executar agora
                    </Button>
                    {routine.conversationId ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openThread(routine.conversationId!)}
                      >
                        <ScrollText className="mr-1.5 size-3.5" />
                        Abrir thread
                      </Button>
                    ) : null}
                  </div>
                  {routine.lastError ? (
                    <p className="mt-1.5 text-[10px] text-danger">{routine.lastError}</p>
                  ) : null}
                </article>
              );
            })
          )}
        </section>
      </div>
      <AgentRoutinesDialog agent={agent} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
