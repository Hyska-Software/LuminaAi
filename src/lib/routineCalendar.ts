import type { AgentRoutine } from './types';

/** Bitmask with every weekday selected (Monday=1 … Sunday=64). */
export const ROUTINE_ALL_DAYS = 0x7f;

/** Monday-first weekday metadata shared by the editor and the calendar. */
export const ROUTINE_WEEKDAYS = [
  { bit: 0x01, index: 0, short: 'Seg', long: 'Segunda-feira' },
  { bit: 0x02, index: 1, short: 'Ter', long: 'Terça-feira' },
  { bit: 0x04, index: 2, short: 'Qua', long: 'Quarta-feira' },
  { bit: 0x08, index: 3, short: 'Qui', long: 'Quinta-feira' },
  { bit: 0x10, index: 4, short: 'Sex', long: 'Sexta-feira' },
  { bit: 0x20, index: 5, short: 'Sáb', long: 'Sábado' },
  { bit: 0x40, index: 6, short: 'Dom', long: 'Domingo' },
] as const;

export type RoutineCalendarMode = 'day' | 'week' | 'month';

export interface RoutineCalendarDay {
  date: Date;
  key: string;
  inMonth: boolean;
  isToday: boolean;
}

export interface RoutineCalendarEntry {
  routine: AgentRoutine;
  at: number;
  timeLabel: string;
}

export type RoutineStatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export const ROUTINE_STATUS_META: Record<
  string,
  { label: string; tone: RoutineStatusTone }
> = {
  ok: { label: 'Concluída', tone: 'success' },
  error: { label: 'Erro', tone: 'danger' },
  blocked: { label: 'Bloqueada', tone: 'warning' },
  running: { label: 'Executando', tone: 'accent' },
};

const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

const WEEKDAY_LONG = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const;

const WEEKDAY_HEADERS = ['SEG.', 'TER.', 'QUA.', 'QUI.', 'SEX.', 'SÁB.', 'DOM.'] as const;

export { WEEKDAY_HEADERS };

function capitalize(value: string): string {
  return value.length > 0 ? value[0].toLocaleUpperCase('pt-BR') + value.slice(1) : value;
}

export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function calendarDay(date: Date, inMonth: boolean, todayKey: string): RoutineCalendarDay {
  return {
    date,
    key: dayKey(date),
    inMonth,
    isToday: dayKey(date) === todayKey,
  };
}

/** 42 cells, Monday-first, including the adjacent-month days. */
export function monthGrid(anchor: Date, now: Date = new Date()): RoutineCalendarDay[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = addDays(first, -offset);
  const todayKey = dayKey(now);
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(start, index);
    return calendarDay(
      date,
      date.getMonth() === anchor.getMonth() && date.getFullYear() === anchor.getFullYear(),
      todayKey,
    );
  });
}

/** Seven cells for the Monday→Sunday week containing the anchor. */
export function weekDays(anchor: Date, now: Date = new Date()): RoutineCalendarDay[] {
  const offset = (anchor.getDay() + 6) % 7;
  const start = addDays(new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()), -offset);
  const todayKey = dayKey(now);
  return Array.from({ length: 7 }, (_, index) => calendarDay(addDays(start, index), true, todayKey));
}

export function singleDay(anchor: Date, now: Date = new Date()): RoutineCalendarDay {
  return calendarDay(
    new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()),
    true,
    dayKey(now),
  );
}

export function monthLabel(anchor: Date): string {
  return `${capitalize(MONTH_NAMES[anchor.getMonth()])} de ${anchor.getFullYear()}`;
}

function monthName(date: Date): string {
  return MONTH_NAMES[date.getMonth()];
}

export function rangeLabel(mode: RoutineCalendarMode, anchor: Date): string {
  if (mode === 'month') return monthLabel(anchor);
  if (mode === 'day') {
    return `${capitalize(WEEKDAY_LONG[anchor.getDay()])}, ${anchor.getDate()} de ${monthName(
      anchor,
    )} de ${anchor.getFullYear()}`;
  }
  const start = weekDays(anchor)[0]?.date;
  if (!start) return monthLabel(anchor);
  const end = addDays(start, 6);
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.getDate()} de ${monthName(start)} de ${start.getFullYear()} – ${end.getDate()} de ${monthName(end)} de ${end.getFullYear()}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${start.getDate()} de ${monthName(start)} – ${end.getDate()} de ${monthName(
      end,
    )} de ${end.getFullYear()}`;
  }
  return `${start.getDate()} – ${end.getDate()} de ${monthName(end)} de ${end.getFullYear()}`;
}

function weekdayMask(mask: number): number {
  const masked = mask & ROUTINE_ALL_DAYS;
  return masked === 0 ? ROUTINE_ALL_DAYS : masked;
}

function weekdaySummary(daysOfWeek: number): string {
  const mask = weekdayMask(daysOfWeek);
  if (mask === ROUTINE_ALL_DAYS) return 'Todos os dias';
  if (mask === 0x1f) return 'Seg a sex';
  if (mask === 0x60) return 'Sáb e dom';
  const labels = ROUTINE_WEEKDAYS.filter((day) => (mask & day.bit) !== 0).map(
    (day) => day.short,
  );
  return labels.length > 0 ? labels.join(', ') : 'Nenhum dia';
}

/** Compact interval text (`4 h`, `30 min`, `2 d`); optionally prefixed with `A cada`. */
export function intervalLabel(minutes: number, short = false): string {
  const value = Math.max(1, Math.round(minutes));
  let amount: string;
  if (value >= 1440 && value % 1440 === 0) amount = `${value / 1440} d`;
  else if (value % 60 === 0) amount = `${value / 60} h`;
  else amount = `${value} min`;
  return short ? amount : `A cada ${amount}`;
}

export function routineScheduleLabel(routine: AgentRoutine): string {
  if (routine.triggerKind === 'event') {
    return routine.eventKind === 'task.status'
      ? 'Por evento: status de tarefa'
      : 'Por evento: mensagem em canal';
  }
  if (routine.scheduleKind === 'interval') {
    return intervalLabel(routine.intervalMinutes);
  }
  return `${weekdaySummary(routine.daysOfWeek)} às ${String(routine.hour).padStart(2, '0')}:${String(routine.minute).padStart(2, '0')}`;
}

function durationLabel(absoluteMs: number): string {
  const minutes = Math.max(1, Math.round(absoluteMs / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

export function routineNextRunLabel(routine: AgentRoutine, now = Date.now()): string {
  if (!routine.enabled) return 'Pausada';
  if (routine.triggerKind === 'event') return 'Aguardando evento';
  if (!routine.nextRunAt || routine.nextRunAt <= now) return 'Pendente';
  return `em ${durationLabel(routine.nextRunAt - now)}`;
}

export function routineLastRunLabel(routine: AgentRoutine, now = Date.now()): string {
  if (!routine.lastRunAt) return 'Nunca executada';
  const delta = now - routine.lastRunAt;
  if (delta < 60_000) return 'agora';
  return `há ${durationLabel(delta)}`;
}

/**
 * Projects scheduled occurrences for the given days. Event routines are not
 * part of the agenda; disabled routines stay visible (the UI mutes them).
 */
export function buildRoutineCalendar(
  routines: AgentRoutine[],
  days: RoutineCalendarDay[],
): Map<string, RoutineCalendarEntry[]> {
  const entries = new Map<string, RoutineCalendarEntry[]>();
  if (days.length === 0) return entries;

  const add = (day: RoutineCalendarDay, routine: AgentRoutine, at: number, label: string) => {
    const list = entries.get(day.key) ?? [];
    list.push({ routine, at, timeLabel: label });
    entries.set(day.key, list);
  };

  for (const routine of routines) {
    if (routine.triggerKind === 'event') continue;

    if (routine.scheduleKind === 'daily') {
      const mask = weekdayMask(routine.daysOfWeek);
      for (const day of days) {
        const weekday = (day.date.getDay() + 6) % 7;
        if ((mask & (1 << weekday)) === 0) continue;
        const at = new Date(
          day.date.getFullYear(),
          day.date.getMonth(),
          day.date.getDate(),
          routine.hour,
          routine.minute,
        ).getTime();
        if (at < routine.createdAt) continue;
        add(
          day,
          routine,
          at,
          `${String(routine.hour).padStart(2, '0')}:${String(routine.minute).padStart(2, '0')}`,
        );
      }
      continue;
    }

    const intervalMs = Math.max(5, routine.intervalMinutes) * 60_000;
    const base =
      routine.nextRunAt > 0 ? routine.nextRunAt : routine.createdAt + intervalMs;
    for (const day of days) {
      const start = new Date(
        day.date.getFullYear(),
        day.date.getMonth(),
        day.date.getDate(),
      ).getTime();
      const end = new Date(
        day.date.getFullYear(),
        day.date.getMonth(),
        day.date.getDate() + 1,
      ).getTime();
      const min = Math.max(start, routine.createdAt);
      if (min >= end) continue;
      const steps = Math.ceil((min - base) / intervalMs);
      const at = base + steps * intervalMs;
      if (at >= end) continue;
      add(day, routine, at, intervalLabel(routine.intervalMinutes, true));
    }
  }

  for (const list of entries.values()) {
    list.sort(
      (left, right) =>
        left.at - right.at ||
        left.routine.title.localeCompare(right.routine.title, 'pt-BR'),
    );
  }
  return entries;
}
