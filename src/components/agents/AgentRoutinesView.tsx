import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Ellipsis,
  Loader2,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { AgentAvatar } from './AgentAvatar';
import { AgentRoutineEditorDialog } from './AgentRoutineEditorDialog';
import { AgentRoutineRunsDialog } from './AgentRoutineRunsDialog';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  NativeSelect,
  SegmentedControl,
  Spinner,
  Switch,
} from '@/components/ui';
import { api } from '@/lib/api';
import { DEFAULT_AGENT_AVATAR } from '@/lib/agentAvatar';
import {
  ROUTINE_STATUS_META,
  WEEKDAY_HEADERS,
  buildRoutineCalendar,
  monthGrid,
  monthLabel,
  rangeLabel,
  routineNextRunLabel,
  routineScheduleLabel,
  singleDay,
  weekDays,
  type RoutineCalendarDay,
  type RoutineCalendarEntry,
  type RoutineCalendarMode,
} from '@/lib/routineCalendar';
import { useAgentStore, useChatStore, useUiStore } from '@/lib/store';
import type { Agent, AgentRoutine } from '@/lib/types';
import { cn } from '@/lib/utils';

const MONTH_OPTIONS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const;

const VIEW_OPTIONS = [
  { value: 'day', label: 'Dia' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
];

function RoutineChip({
  entry,
  agent,
  week,
  onEdit,
}: {
  entry: RoutineCalendarEntry;
  agent: Agent | null;
  week: boolean;
  onEdit: (routine: AgentRoutine) => void;
}) {
  const routine = entry.routine;
  const paused = !routine.enabled;
  const agentName = agent?.name ?? 'Agente removido';
  return (
    <button
      type="button"
      onClick={() => onEdit(routine)}
      aria-label={`${routine.title}, ${entry.timeLabel}, ${agentName}${paused ? ', pausada' : ''}`}
      title={`${routine.title} · ${agentName} · ${routineScheduleLabel(routine)}`}
      className={cn(
        'flex w-full items-center gap-1 rounded-md px-1.5 text-left leading-4 transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        week ? 'py-1 text-[11px]' : 'py-0.5 text-[10px]',
        paused
          ? 'bg-surface-hover text-foreground-subtle hover:bg-surface-hover'
          : 'bg-accent-soft/60 text-foreground hover:bg-accent-soft',
      )}
    >
      <Clock
        aria-hidden
        className={cn('size-2.5 shrink-0', paused ? 'text-foreground-subtle' : 'text-accent')}
      />
      <span
        className={cn(
          'shrink-0 tabular-nums',
          paused ? 'text-foreground-subtle' : 'text-accent',
        )}
      >
        {entry.timeLabel}
      </span>
      <span className="truncate">{routine.title}</span>
    </button>
  );
}

function RoutineRow({
  routine,
  agent,
  busy,
  onEdit,
  onToggle,
  onRun,
  onRuns,
  onOpenThread,
  onDelete,
}: {
  routine: AgentRoutine;
  agent: Agent | null;
  busy: boolean;
  onEdit: (routine: AgentRoutine) => void;
  onToggle: (routine: AgentRoutine) => void;
  onRun: (routine: AgentRoutine) => void;
  onRuns: (routine: AgentRoutine) => void;
  onOpenThread: (routine: AgentRoutine) => void;
  onDelete: (routine: AgentRoutine) => void;
}) {
  const meta = routine.lastStatus ? ROUTINE_STATUS_META[routine.lastStatus] : null;
  const agentName = agent?.name ?? 'Agente removido';
  return (
    <article className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised/50 px-3 py-2.5">
      <AgentAvatar size="sm" avatar={agent?.avatar ?? DEFAULT_AGENT_AVATAR} />
      <button
        type="button"
        onClick={() => onEdit(routine)}
        aria-label={`Editar rotina ${routine.title}`}
        className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-foreground">{routine.title}</span>
          {!routine.enabled ? <Badge tone="neutral">Pausada</Badge> : null}
          {meta ? <Badge tone={meta.tone}>{meta.label}</Badge> : null}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-foreground-muted">
          {agentName} · {routineScheduleLabel(routine)}
          {routine.triggerKind === 'schedule' ? ` · ${routineNextRunLabel(routine)}` : ''}
        </span>
        {routine.lastError ? (
          <span className="mt-0.5 block truncate text-[10px] text-danger">
            {routine.lastError}
          </span>
        ) : null}
      </button>
      {busy ? <Spinner size="xs" /> : null}
      <Switch
        checked={routine.enabled}
        onCheckedChange={() => onToggle(routine)}
        disabled={busy}
        aria-label={`${routine.enabled ? 'Pausar' : 'Ativar'} rotina ${routine.title}`}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={`Ações da rotina ${routine.title}`} size="sm">
            <Ellipsis className="size-4" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem
            icon={<Play className="size-3.5" />}
            disabled={busy}
            onSelect={() => onRun(routine)}
          >
            Executar agora
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Pencil className="size-3.5" />}
            onSelect={() => onEdit(routine)}
          >
            Editar
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<ScrollText className="size-3.5" />}
            onSelect={() => onRuns(routine)}
          >
            Execuções
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<MessageSquare className="size-3.5" />}
            disabled={!routine.conversationId}
            onSelect={() => onOpenThread(routine)}
          >
            Abrir conversa
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="danger"
            icon={<Trash2 className="size-3.5" />}
            onSelect={() => onDelete(routine)}
          >
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  );
}

export function AgentRoutinesView() {
  const [routines, setRoutines] = useState<AgentRoutine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RoutineCalendarMode>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{
    routine: AgentRoutine | null;
    agentId: string;
  } | null>(null);
  const [runsTarget, setRunsTarget] = useState<AgentRoutine | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentRoutine | null>(null);
  const [deleting, setDeleting] = useState(false);

  const agentsById = useAgentStore((state) => state.agentsById);
  const orderedIds = useAgentStore((state) => state.orderedIds);
  const filterAgentId = useUiStore((state) => state.agentRoutinesAgentId);
  const setFilterAgentId = useUiStore((state) => state.setAgentRoutinesAgentId);
  const setActiveAgentId = useUiStore((state) => state.setActiveAgentId);
  const openConversation = useChatStore((state) => state.openConversation);

  const agents = useMemo(
    () =>
      orderedIds
        .map((id) => agentsById[id])
        .filter((agent): agent is Agent => Boolean(agent)),
    [agentsById, orderedIds],
  );

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const next = await api.listAllAgentRoutines();
      setRoutines(next);
      setError(null);
    } catch (caught) {
      if (!silent) setError(String(caught));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const reload = () => void load(true);
    window.addEventListener('lumina:agent-routine-run', reload);
    window.addEventListener('focus', reload);
    return () => {
      window.removeEventListener('lumina:agent-routine-run', reload);
      window.removeEventListener('focus', reload);
    };
  }, [load]);

  const effectiveFilter =
    filterAgentId && agentsById[filterAgentId] ? filterAgentId : 'all';
  const filtered = useMemo(
    () =>
      routines.filter(
        (routine) => effectiveFilter === 'all' || routine.agentId === effectiveFilter,
      ),
    [effectiveFilter, routines],
  );
  const filterAgents = useMemo(
    () =>
      agents.filter(
        (agent) =>
          agent.id === effectiveFilter ||
          agent.archivedAt === null ||
          routines.some((routine) => routine.agentId === agent.id),
      ),
    [agents, effectiveFilter, routines],
  );
  const creatableAgents = useMemo(
    () => agents.filter((agent) => agent.archivedAt === null),
    [agents],
  );
  const days = useMemo(() => {
    if (mode === 'month') return monthGrid(anchor);
    if (mode === 'week') return weekDays(anchor);
    return [singleDay(anchor)];
  }, [anchor, mode]);
  const calendar = useMemo(() => buildRoutineCalendar(filtered, days), [days, filtered]);
  const rowRoutines = useMemo(
    () =>
      [...filtered].sort((left, right) => {
        const triggerRank = (routine: AgentRoutine) =>
          routine.triggerKind === 'schedule' ? 0 : 1;
        const trigger = triggerRank(left) - triggerRank(right);
        if (trigger !== 0) return trigger;
        if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
        return (
          left.nextRunAt - right.nextRunAt ||
          left.title.localeCompare(right.title, 'pt-BR', { sensitivity: 'base' })
        );
      }),
    [filtered],
  );

  const filteredAgent =
    effectiveFilter !== 'all' ? agentsById[effectiveFilter] ?? null : null;
  const enabledCount = filtered.filter((routine) => routine.enabled).length;
  const summary = filteredAgent
    ? `${filtered.length} ${filtered.length === 1 ? 'rotina' : 'rotinas'} de ${filteredAgent.name}`
    : `${filtered.length} ${filtered.length === 1 ? 'rotina' : 'rotinas'} · ${enabledCount} ${
        enabledCount === 1 ? 'ativa' : 'ativas'
      }`;

  const openCreate = () => {
    if (creatableAgents.length === 0) return;
    const preferred =
      effectiveFilter !== 'all' && agentsById[effectiveFilter]?.archivedAt === null
        ? effectiveFilter
        : creatableAgents[0]?.id ?? '';
    setEditor({ routine: null, agentId: preferred });
  };

  const openEdit = (routine: AgentRoutine) =>
    setEditor({ routine, agentId: routine.agentId });

  const openThread = (routine: AgentRoutine) => {
    if (!routine.conversationId) return;
    setActiveAgentId(routine.agentId);
    void openConversation(routine.conversationId);
  };

  const toggle = async (routine: AgentRoutine) => {
    setBusyId(routine.id);
    try {
      const updated = await api.setAgentRoutineEnabled(routine.id, !routine.enabled);
      setRoutines((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
    } catch (caught) {
      toast.error('Não foi possível atualizar a rotina', { description: String(caught) });
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
      if (updated.lastStatus === 'queued') {
        toast.success('Rotina enfileirada', { description: updated.title });
      } else if (updated.lastStatus === 'error') {
        toast.error('A rotina terminou com erro', {
          description: updated.lastError ?? updated.title,
        });
      } else {
        toast.success('Rotina executada', { description: updated.title });
      }
    } catch (caught) {
      toast.error('Não foi possível executar a rotina', { description: String(caught) });
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteAgentRoutine(deleteTarget.id);
      setRoutines((current) => current.filter((entry) => entry.id !== deleteTarget.id));
      if (editor?.routine?.id === deleteTarget.id) setEditor(null);
      if (runsTarget?.id === deleteTarget.id) setRunsTarget(null);
      toast.success('Rotina excluída');
      setDeleteTarget(null);
    } catch (caught) {
      toast.error('Não foi possível excluir a rotina', { description: String(caught) });
    } finally {
      setDeleting(false);
    }
  };

  const handleSaved = (saved: AgentRoutine) => {
    setRoutines((current) => {
      const exists = current.some((routine) => routine.id === saved.id);
      return exists
        ? current.map((routine) => (routine.id === saved.id ? saved : routine))
        : [...current, saved];
    });
    if (effectiveFilter !== 'all' && saved.agentId !== effectiveFilter) {
      setFilterAgentId(saved.agentId);
    }
    setEditor(null);
  };

  const shift = (delta: number) => {
    const day = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    if (mode === 'month') {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1));
      return;
    }
    setAnchor(
      new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate() + delta * (mode === 'week' ? 7 : 1),
      ),
    );
  };

  const openDay = (day: RoutineCalendarDay) => {
    setAnchor(day.date);
    setMode('day');
  };

  const renderMonth = () => (
    <section
      aria-label={`Calendário de ${rangeLabel('month', anchor)}`}
      className="overflow-hidden rounded-2xl border border-border bg-border"
    >
      <div className="grid grid-cols-7 gap-px bg-border">
        {WEEKDAY_HEADERS.map((label) => (
          <div
            key={label}
            className="bg-surface px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle"
          >
            {label}
          </div>
        ))}
        {days.map((day) => {
          const entries = calendar.get(day.key) ?? [];
          const visible = entries.slice(0, 2);
          return (
            <div
              key={day.key}
              className={cn(
                'min-h-[112px] bg-background p-1.5',
                !day.inMonth && 'bg-surface/30',
              )}
            >
              <button
                type="button"
                onClick={() => openDay(day)}
                aria-current={day.isToday ? 'date' : undefined}
                aria-label={`Abrir ${rangeLabel('day', day.date)} na visão de dia`}
                className={cn(
                  'flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  day.isToday
                    ? 'bg-accent font-semibold text-accent-foreground'
                    : cn(
                        'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
                        !day.inMonth && 'text-foreground-subtle',
                      ),
                )}
              >
                {day.date.getDate()}
              </button>
              <div className="mt-1 space-y-0.5">
                {visible.map((entry) => (
                  <RoutineChip
                    key={`${entry.routine.id}-${entry.at}`}
                    entry={entry}
                    agent={agentsById[entry.routine.agentId] ?? null}
                    week={false}
                    onEdit={openEdit}
                  />
                ))}
                {entries.length > visible.length ? (
                  <button
                    type="button"
                    onClick={() => openDay(day)}
                    aria-label={`Ver mais ${entries.length - visible.length} rotinas de ${rangeLabel(
                      'day',
                      day.date,
                    )}`}
                    className="w-full rounded px-1.5 text-left text-[10px] text-foreground-subtle hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    +{entries.length - visible.length}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );

  const renderWeek = () => (
    <section
      aria-label={`Calendário de ${rangeLabel('week', anchor)}`}
      className="overflow-hidden rounded-2xl border border-border bg-border"
    >
      <div className="grid grid-cols-7 gap-px bg-border">
        {days.map((day, index) => (
          <div key={`head-${day.key}`} className="bg-surface px-2 py-1.5">
            <button
              type="button"
              onClick={() => openDay(day)}
              aria-label={`Abrir ${rangeLabel('day', day.date)} na visão de dia`}
              className={cn(
                'flex w-full items-center justify-between gap-1 text-[10px] font-semibold uppercase tracking-wider',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                day.isToday ? 'text-accent' : 'text-foreground-subtle',
              )}
            >
              <span>{WEEKDAY_HEADERS[index]}</span>
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums',
                  day.isToday && 'bg-accent text-accent-foreground',
                )}
              >
                {day.date.getDate()}
              </span>
            </button>
          </div>
        ))}
        {days.map((day) => (
          <div key={`body-${day.key}`} className="min-h-[240px] bg-background p-2">
            <div className="space-y-1">
              {(calendar.get(day.key) ?? []).map((entry) => (
                <RoutineChip
                  key={`${entry.routine.id}-${entry.at}`}
                  entry={entry}
                  agent={agentsById[entry.routine.agentId] ?? null}
                  week
                  onEdit={openEdit}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  const renderDay = () => {
    const entries = calendar.get(days[0]?.key ?? '') ?? [];
    return (
      <section className="rounded-2xl border border-border bg-surface-raised/40 p-2">
        {entries.length === 0 ? (
          <p className="px-3 py-8 text-center text-[12px] text-foreground-subtle">
            Nenhuma rotina agendada para este dia.
          </p>
        ) : (
          <div className="space-y-0.5">
            {entries.map((entry) => {
              const routine = entry.routine;
              const agent = agentsById[routine.agentId] ?? null;
              const meta = routine.lastStatus
                ? ROUTINE_STATUS_META[routine.lastStatus]
                : null;
              return (
                <button
                  key={`${routine.id}-${entry.at}`}
                  type="button"
                  onClick={() => openEdit(routine)}
                  aria-label={`Editar rotina ${routine.title}`}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-hover',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    !routine.enabled && 'opacity-60',
                  )}
                >
                  <span className="w-11 shrink-0 text-[11px] tabular-nums text-foreground-muted">
                    {entry.timeLabel}
                  </span>
                  <AgentAvatar
                    size="xs"
                    avatar={agent?.avatar ?? DEFAULT_AGENT_AVATAR}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-foreground">
                      {routine.title}
                    </span>
                    <span className="block truncate text-[11px] text-foreground-muted">
                      {agent?.name ?? 'Agente removido'} · {routineScheduleLabel(routine)}
                    </span>
                  </span>
                  {meta ? <Badge tone={meta.tone}>{meta.label}</Badge> : null}
                </button>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border bg-surface">
        <div className="flex w-full flex-col gap-3 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight">Rotinas</h1>
              <p className="mt-0.5 text-[12px] text-foreground-muted">{summary}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                aria-label="Filtrar rotinas por agente"
                value={effectiveFilter}
                wrapperClassName="w-52 shrink-0"
                className="h-8 text-[12px]"
                onChange={(event) =>
                  setFilterAgentId(
                    event.target.value === 'all' ? null : event.target.value,
                  )
                }
              >
                <option value="all">Todos os agentes</option>
                {filterAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                    {agent.archivedAt !== null ? ' · arquivado' : ''}
                  </option>
                ))}
              </NativeSelect>
              <SegmentedControl
                size="sm"
                ariaLabel="Visão do calendário"
                options={VIEW_OPTIONS}
                value={mode}
                onChange={(value) => setMode(value as RoutineCalendarMode)}
              />
              <IconButton
                label="Recarregar rotinas"
                size="sm"
                loading={loading}
                onClick={() => void load()}
              >
                <RefreshCw className="size-4" />
              </IconButton>
              <Button
                variant="primary"
                size="sm"
                disabled={creatableAgents.length === 0}
                title={
                  creatableAgents.length === 0 ? 'Crie um agente primeiro' : undefined
                }
                onClick={openCreate}
              >
                <Plus className="mr-1.5 size-4" />
                Nova rotina
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAnchor(new Date())}
            >
              <CalendarDays className="mr-1.5 size-4" />
              Hoje
            </Button>
            <IconButton
              label="Período anterior"
              size="sm"
              onClick={() => shift(-1)}
            >
              <ChevronLeft className="size-4" />
            </IconButton>
            <div aria-live="polite" className="flex items-center">
              {mode === 'month' ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Escolher mês e ano"
                      className="text-[15px] font-semibold tracking-tight text-foreground"
                    >
                      {monthLabel(anchor)}
                      <ChevronDown className="size-4 text-foreground-subtle" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
                    <DropdownMenuLabel>{anchor.getFullYear()}</DropdownMenuLabel>
                    {MONTH_OPTIONS.map((label, index) => (
                      <DropdownMenuItem
                        key={label}
                        checked={anchor.getMonth() === index}
                        onSelect={() =>
                          setAnchor(new Date(anchor.getFullYear(), index, 1))
                        }
                      >
                        {label}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() =>
                        setAnchor(
                          new Date(anchor.getFullYear() - 1, anchor.getMonth(), 1),
                        )
                      }
                    >
                      Ano anterior ({anchor.getFullYear() - 1})
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        setAnchor(
                          new Date(anchor.getFullYear() + 1, anchor.getMonth(), 1),
                        )
                      }
                    >
                      Próximo ano ({anchor.getFullYear() + 1})
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <p className="px-1 text-[15px] font-semibold tracking-tight">
                  {rangeLabel(mode, anchor)}
                </p>
              )}
            </div>
            <IconButton
              label="Próximo período"
              size="sm"
              onClick={() => shift(1)}
            >
              <ChevronRight className="size-4" />
            </IconButton>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full px-5 py-4">
          {error ? (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger"
            >
              <p className="font-medium">Não foi possível carregar as rotinas.</p>
              <p className="mt-0.5 text-[11px] opacity-80">{error}</p>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 px-0"
                onClick={() => void load()}
              >
                Tentar novamente
              </Button>
            </div>
          ) : null}

          {loading && routines.length === 0 ? (
            <div
              role="status"
              className="flex min-h-60 items-center justify-center gap-2 text-[13px] text-foreground-muted"
            >
              <Spinner size="sm" label="Carregando rotinas" />
              Carregando rotinas…
            </div>
          ) : (
            <div className="space-y-5">
              {mode === 'month' ? renderMonth() : mode === 'week' ? renderWeek() : renderDay()}

              <section aria-labelledby="routines-list-heading" className="space-y-2">
                <div className="flex items-end justify-between gap-3">
                  <h2
                    id="routines-list-heading"
                    className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle"
                  >
                    Todas as rotinas
                  </h2>
                  <span className="text-[11px] text-foreground-subtle">
                    {rowRoutines.length}
                  </span>
                </div>
                {rowRoutines.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
                    <p className="text-[13px] font-medium text-foreground">
                      Nenhuma rotina para este filtro.
                    </p>
                    <p className="mt-1 text-[12px] text-foreground-muted">
                      Crie uma rotina para o agente executar sozinho enquanto o app estiver
                      aberto.
                    </p>
                    {creatableAgents.length > 0 ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-4"
                        onClick={openCreate}
                      >
                        <Plus className="mr-1.5 size-4" />
                        Nova rotina
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {rowRoutines.map((routine) => (
                      <RoutineRow
                        key={routine.id}
                        routine={routine}
                        agent={agentsById[routine.agentId] ?? null}
                        busy={busyId === routine.id}
                        onEdit={openEdit}
                        onToggle={(entry) => void toggle(entry)}
                        onRun={(entry) => void runNow(entry)}
                        onRuns={setRunsTarget}
                        onOpenThread={openThread}
                        onDelete={setDeleteTarget}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </main>

      <AgentRoutineEditorDialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        agents={agents}
        routine={editor?.routine ?? null}
        initialAgentId={editor?.agentId ?? null}
        onSaved={handleSaved}
      />

      <AgentRoutineRunsDialog
        open={runsTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRunsTarget(null);
        }}
        routine={runsTarget}
        onOpenThread={(conversationId, agentId) => {
          setActiveAgentId(agentId);
          void openConversation(conversationId);
        }}
      />

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader className="pb-4 pr-12">
            <DialogTitle>Excluir rotina?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `“${deleteTarget.title}” será removida permanentemente. A conversa principal do agente é preservada.`
                : 'Esta ação não pode ser desfeita.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 size-3.5" />
              )}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
