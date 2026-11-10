import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { compareText } from '@/lib/i18n/format';
import {
  ROUTINE_STATUS_META,
  weekdayHeaders,
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

const MONTH_KEYS = [
  'routinesView.months.january',
  'routinesView.months.february',
  'routinesView.months.march',
  'routinesView.months.april',
  'routinesView.months.may',
  'routinesView.months.june',
  'routinesView.months.july',
  'routinesView.months.august',
  'routinesView.months.september',
  'routinesView.months.october',
  'routinesView.months.november',
  'routinesView.months.december',
] as const;

const VIEW_OPTIONS = [
  { value: 'day', labelKey: 'routinesView.views.day' },
  { value: 'week', labelKey: 'routinesView.views.week' },
  { value: 'month', labelKey: 'routinesView.views.month' },
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
  const { t } = useTranslation('agents');
  const routine = entry.routine;
  const paused = !routine.enabled;
  const agentName = agent?.name ?? t('routinesView.removedAgent');
  return (
    <button
      type="button"
      onClick={() => onEdit(routine)}
      aria-label={t('routinesView.chipAria', {
        title: routine.title,
        time: entry.timeLabel,
        agent: agentName,
        paused: paused ? t('routinesView.chipPausedSuffix') : '',
      })}
      title={t('routinesView.chipTitle', {
        title: routine.title,
        agent: agentName,
        schedule: routineScheduleLabel(routine),
      })}
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
  const { t } = useTranslation('agents');
  const meta = routine.lastStatus ? ROUTINE_STATUS_META[routine.lastStatus] : null;
  const agentName = agent?.name ?? t('routinesView.removedAgent');
  return (
    <article className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised/50 px-3 py-2.5">
      <AgentAvatar size="sm" avatar={agent?.avatar ?? DEFAULT_AGENT_AVATAR} />
      <button
        type="button"
        onClick={() => onEdit(routine)}
        aria-label={t('routinesView.editAria', { title: routine.title })}
        className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-foreground">{routine.title}</span>
          {!routine.enabled ? (
            <Badge tone="neutral">{t('routinesView.paused')}</Badge>
          ) : null}
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
        aria-label={t(
          routine.enabled ? 'routinesView.pauseAria' : 'routinesView.resumeAria',
          { title: routine.title },
        )}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={t('routinesView.actionsAria', { title: routine.title })} size="sm">
            <Ellipsis className="size-4" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem
            icon={<Play className="size-3.5" />}
            disabled={busy}
            onSelect={() => onRun(routine)}
          >
            {t('routinesView.runNow')}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Pencil className="size-3.5" />}
            onSelect={() => onEdit(routine)}
          >
            {t('common:actions.edit')}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<ScrollText className="size-3.5" />}
            onSelect={() => onRuns(routine)}
          >
            {t('routinesView.runs')}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<MessageSquare className="size-3.5" />}
            disabled={!routine.conversationId}
            onSelect={() => onOpenThread(routine)}
          >
            {t('routinesView.openConversation')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="danger"
            icon={<Trash2 className="size-3.5" />}
            onSelect={() => onDelete(routine)}
          >
            {t('common:actions.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  );
}

export function AgentRoutinesView() {
  const { t } = useTranslation('agents');
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
    window.addEventListener('zylara:agent-routine-run', reload);
    window.addEventListener('focus', reload);
    return () => {
      window.removeEventListener('zylara:agent-routine-run', reload);
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
        return left.nextRunAt - right.nextRunAt || compareText(left.title, right.title);
      }),
    [filtered],
  );

  const filteredAgent =
    effectiveFilter !== 'all' ? agentsById[effectiveFilter] ?? null : null;
  const enabledCount = filtered.filter((routine) => routine.enabled).length;
  const summary = filteredAgent
    ? t('routinesView.summaryAgent', {
        count: filtered.length,
        agent: filteredAgent.name,
      })
    : t('routinesView.summary', {
        count: filtered.length,
        enabled: enabledCount,
      });

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
      toast.error(t('routinesView.updateError'), { description: String(caught) });
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
        toast.success(t('routinesView.queued'), { description: updated.title });
      } else if (updated.lastStatus === 'error') {
        toast.error(t('routinesView.runFailed'), {
          description: updated.lastError ?? updated.title,
        });
      } else {
        toast.success(t('routinesView.ran'), { description: updated.title });
      }
    } catch (caught) {
      toast.error(t('routinesView.runError'), { description: String(caught) });
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
      toast.success(t('routinesView.deleted'));
      setDeleteTarget(null);
    } catch (caught) {
      toast.error(t('routinesView.deleteError'), { description: String(caught) });
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
      aria-label={t('routinesView.monthCalendarAria', { range: rangeLabel('month', anchor) })}
      className="overflow-hidden rounded-2xl border border-border bg-border"
    >
      <div className="grid grid-cols-7 gap-px bg-border">
        {weekdayHeaders().map((label) => (
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
                aria-label={t('routinesView.openDayAria', { range: rangeLabel('day', day.date) })}
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
                    aria-label={t('routinesView.moreAria', {
                      count: entries.length - visible.length,
                      range: rangeLabel('day', day.date),
                    })}
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
      aria-label={t('routinesView.weekCalendarAria', { range: rangeLabel('week', anchor) })}
      className="overflow-hidden rounded-2xl border border-border bg-border"
    >
      <div className="grid grid-cols-7 gap-px bg-border">
        {days.map((day, index) => (
          <div key={`head-${day.key}`} className="bg-surface px-2 py-1.5">
            <button
              type="button"
              onClick={() => openDay(day)}
              aria-label={t('routinesView.openDayAria', { range: rangeLabel('day', day.date) })}
              className={cn(
                'flex w-full items-center justify-between gap-1 text-[10px] font-semibold uppercase tracking-wider',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                day.isToday ? 'text-accent' : 'text-foreground-subtle',
              )}
            >
              <span>{weekdayHeaders()[index]}</span>
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
            {t('routinesView.noRoutinesForDay')}
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
                  aria-label={t('routinesView.editAria', { title: routine.title })}
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
                      {agent?.name ?? t('routinesView.removedAgent')} ·{' '}
                      {routineScheduleLabel(routine)}
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
              <h1 className="text-xl font-semibold tracking-tight">{t('routinesView.title')}</h1>
              <p className="mt-0.5 text-[12px] text-foreground-muted">{summary}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                aria-label={t('routinesView.filterAria')}
                value={effectiveFilter}
                wrapperClassName="w-52 shrink-0"
                className="h-8 text-[12px]"
                onChange={(event) =>
                  setFilterAgentId(
                    event.target.value === 'all' ? null : event.target.value,
                  )
                }
              >
                <option value="all">{t('routinesView.allAgents')}</option>
                {filterAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.archivedAt !== null
                      ? t('routineEditor.archivedAgent', { name: agent.name })
                      : agent.name}
                  </option>
                ))}
              </NativeSelect>
              <SegmentedControl
                size="sm"
                ariaLabel={t('routinesView.viewAria')}
                options={VIEW_OPTIONS.map((option) => ({
                  value: option.value,
                  label: t(option.labelKey as never),
                }))}
                value={mode}
                onChange={(value) => setMode(value as RoutineCalendarMode)}
              />
              <IconButton
                label={t('routinesView.reloadAria')}
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
                  creatableAgents.length === 0 ? t('routinesView.createAgentFirst') : undefined
                }
                onClick={openCreate}
              >
                <Plus className="mr-1.5 size-4" />
                {t('routinesView.newRoutine')}
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
              {t('routinesView.today')}
            </Button>
            <IconButton
              label={t('routinesView.previousPeriod')}
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
                      aria-label={t('routinesView.chooseMonthAria')}
                      className="text-[15px] font-semibold tracking-tight text-foreground"
                    >
                      {monthLabel(anchor)}
                      <ChevronDown className="size-4 text-foreground-subtle" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
                    <DropdownMenuLabel>{anchor.getFullYear()}</DropdownMenuLabel>
                    {MONTH_KEYS.map((key, index) => (
                      <DropdownMenuItem
                        key={key}
                        checked={anchor.getMonth() === index}
                        onSelect={() =>
                          setAnchor(new Date(anchor.getFullYear(), index, 1))
                        }
                      >
                        {t(key as never)}
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
                      {t('routinesView.previousYear', { year: anchor.getFullYear() - 1 })}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        setAnchor(
                          new Date(anchor.getFullYear() + 1, anchor.getMonth(), 1),
                        )
                      }
                    >
                      {t('routinesView.nextYear', { year: anchor.getFullYear() + 1 })}
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
              label={t('routinesView.nextPeriod')}
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
              <p className="font-medium">{t('routinesView.loadError')}</p>
              <p className="mt-0.5 text-[11px] opacity-80">{error}</p>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 px-0"
                onClick={() => void load()}
              >
                {t('common:actions.retry')}
              </Button>
            </div>
          ) : null}

          {loading && routines.length === 0 ? (
            <div
              role="status"
              className="flex min-h-60 items-center justify-center gap-2 text-[13px] text-foreground-muted"
            >
              <Spinner size="sm" label={t('routinesView.loadingAria')} />
              {t('routinesView.loading')}
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
                    {t('routinesView.allRoutines')}
                  </h2>
                  <span className="text-[11px] text-foreground-subtle">
                    {rowRoutines.length}
                  </span>
                </div>
                {rowRoutines.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
                    <p className="text-[13px] font-medium text-foreground">
                      {t('routinesView.emptyTitle')}
                    </p>
                    <p className="mt-1 text-[12px] text-foreground-muted">
                      {t('routinesView.emptyDescription')}
                    </p>
                    {creatableAgents.length > 0 ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-4"
                        onClick={openCreate}
                      >
                        <Plus className="mr-1.5 size-4" />
                        {t('routinesView.newRoutine')}
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
            <DialogTitle>{t('routinesView.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? t('routinesView.deleteDescription', { title: deleteTarget.title })
                : t('routinesView.deleteIrreversible')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              {t('common:actions.cancel')}
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
              {t('common:actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
