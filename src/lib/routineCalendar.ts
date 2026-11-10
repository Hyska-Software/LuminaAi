import { t } from './i18n';
import { compareText, localeUpperCase } from './i18n/format';
import type { AgentRoutine } from './types';

/** Bitmask with every weekday selected (Monday=1 … Sunday=64). */
export const ROUTINE_ALL_DAYS = 0x7f;

/**
 * Monday-first weekday metadata shared by the editor and the calendar. The
 * labels are getters so the list follows a runtime language switch without
 * rebuilding the module.
 */
export const ROUTINE_WEEKDAYS = [
  {
    bit: 0x01,
    index: 0,
    get short() {
      return t('code:calendar.weekdayShort.monday');
    },
    get long() {
      return t('code:calendar.weekdays.monday');
    },
  },
  {
    bit: 0x02,
    index: 1,
    get short() {
      return t('code:calendar.weekdayShort.tuesday');
    },
    get long() {
      return t('code:calendar.weekdays.tuesday');
    },
  },
  {
    bit: 0x04,
    index: 2,
    get short() {
      return t('code:calendar.weekdayShort.wednesday');
    },
    get long() {
      return t('code:calendar.weekdays.wednesday');
    },
  },
  {
    bit: 0x08,
    index: 3,
    get short() {
      return t('code:calendar.weekdayShort.thursday');
    },
    get long() {
      return t('code:calendar.weekdays.thursday');
    },
  },
  {
    bit: 0x10,
    index: 4,
    get short() {
      return t('code:calendar.weekdayShort.friday');
    },
    get long() {
      return t('code:calendar.weekdays.friday');
    },
  },
  {
    bit: 0x20,
    index: 5,
    get short() {
      return t('code:calendar.weekdayShort.saturday');
    },
    get long() {
      return t('code:calendar.weekdays.saturday');
    },
  },
  {
    bit: 0x40,
    index: 6,
    get short() {
      return t('code:calendar.weekdayShort.sunday');
    },
    get long() {
      return t('code:calendar.weekdays.sunday');
    },
  },
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

/**
 * Status copy for routine runs. Getters resolve the current catalog on every
 * read, so nothing is frozen at module import.
 */
export const ROUTINE_STATUS_META: Record<
  string,
  { label: string; tone: RoutineStatusTone }
> = {
  get ok() {
    return { label: t('code:calendar.status.ok'), tone: 'success' as const };
  },
  get error() {
    return { label: t('code:calendar.status.error'), tone: 'danger' as const };
  },
  get blocked() {
    return { label: t('code:calendar.status.blocked'), tone: 'warning' as const };
  },
  get running() {
    return { label: t('code:calendar.status.running'), tone: 'accent' as const };
  },
  get queued() {
    return { label: t('code:calendar.status.queued'), tone: 'accent' as const };
  },
};

/** Monday-first short weekday header labels, resolved in the current language. */
export function weekdayHeaders(): readonly string[] {
  return [
    t('code:calendar.weekdayHeaders.monday'),
    t('code:calendar.weekdayHeaders.tuesday'),
    t('code:calendar.weekdayHeaders.wednesday'),
    t('code:calendar.weekdayHeaders.thursday'),
    t('code:calendar.weekdayHeaders.friday'),
    t('code:calendar.weekdayHeaders.saturday'),
    t('code:calendar.weekdayHeaders.sunday'),
  ];
}

/** Stable catalog key per month index (January = 0). */
const MONTH_KEYS = [
  'code:calendar.months.january',
  'code:calendar.months.february',
  'code:calendar.months.march',
  'code:calendar.months.april',
  'code:calendar.months.may',
  'code:calendar.months.june',
  'code:calendar.months.july',
  'code:calendar.months.august',
  'code:calendar.months.september',
  'code:calendar.months.october',
  'code:calendar.months.november',
  'code:calendar.months.december',
] as const;

/** Stable catalog key per `Date.getDay()` index (Sunday = 0). */
const WEEKDAY_LONG_KEYS = [
  'code:calendar.weekdays.sunday',
  'code:calendar.weekdays.monday',
  'code:calendar.weekdays.tuesday',
  'code:calendar.weekdays.wednesday',
  'code:calendar.weekdays.thursday',
  'code:calendar.weekdays.friday',
  'code:calendar.weekdays.saturday',
] as const;

function capitalize(value: string): string {
  return value.length > 0 ? localeUpperCase(value[0]) + value.slice(1) : value;
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
  return capitalize(
    t('code:calendar.monthYear', {
      month: t(MONTH_KEYS[anchor.getMonth()]),
      year: anchor.getFullYear(),
    }),
  );
}

function monthName(date: Date): string {
  return t(MONTH_KEYS[date.getMonth()]);
}

export function rangeLabel(mode: RoutineCalendarMode, anchor: Date): string {
  if (mode === 'month') return monthLabel(anchor);
  if (mode === 'day') {
    return t('code:calendar.dayLabel', {
      weekday: t(WEEKDAY_LONG_KEYS[anchor.getDay()]),
      day: anchor.getDate(),
      month: monthName(anchor),
      year: anchor.getFullYear(),
    });
  }
  const start = weekDays(anchor)[0]?.date;
  if (!start) return monthLabel(anchor);
  const end = addDays(start, 6);
  if (start.getFullYear() !== end.getFullYear()) {
    return t('code:calendar.weekRangeTwoYears', {
      startDay: start.getDate(),
      startMonth: monthName(start),
      startYear: start.getFullYear(),
      endDay: end.getDate(),
      endMonth: monthName(end),
      endYear: end.getFullYear(),
    });
  }
  if (start.getMonth() !== end.getMonth()) {
    return t('code:calendar.weekRangeTwoMonths', {
      startDay: start.getDate(),
      startMonth: monthName(start),
      endDay: end.getDate(),
      endMonth: monthName(end),
      year: end.getFullYear(),
    });
  }
  return t('code:calendar.weekRangeSameMonth', {
    startDay: start.getDate(),
    endDay: end.getDate(),
    month: monthName(end),
    year: end.getFullYear(),
  });
}

function weekdayMask(mask: number): number {
  const masked = mask & ROUTINE_ALL_DAYS;
  return masked === 0 ? ROUTINE_ALL_DAYS : masked;
}

function weekdaySummary(daysOfWeek: number): string {
  const mask = weekdayMask(daysOfWeek);
  if (mask === ROUTINE_ALL_DAYS) return t('code:calendar.days.all');
  if (mask === 0x1f) return t('code:calendar.days.weekdays');
  if (mask === 0x60) return t('code:calendar.days.weekend');
  const labels = ROUTINE_WEEKDAYS.filter((day) => (mask & day.bit) !== 0).map(
    (day) => day.short,
  );
  return labels.length > 0 ? labels.join(', ') : t('code:calendar.days.none');
}

/** Compact interval text (`4 h`, `30 min`, `2 d`); optionally prefixed with "every". */
export function intervalLabel(minutes: number, short = false): string {
  const value = Math.max(1, Math.round(minutes));
  let amount: string;
  if (value >= 1440 && value % 1440 === 0) amount = `${value / 1440} d`;
  else if (value % 60 === 0) amount = `${value / 60} h`;
  else amount = `${value} min`;
  return short ? amount : t('code:calendar.schedule.every', { amount });
}

export function routineScheduleLabel(routine: AgentRoutine): string {
  if (routine.triggerKind === 'event') {
    return routine.eventKind === 'task.status'
      ? t('code:calendar.schedule.eventTask')
      : t('code:calendar.schedule.eventChannel');
  }
  if (routine.scheduleKind === 'interval') {
    return intervalLabel(routine.intervalMinutes);
  }
  return t('code:calendar.schedule.daily', {
    days: weekdaySummary(routine.daysOfWeek),
    time: `${String(routine.hour).padStart(2, '0')}:${String(routine.minute).padStart(2, '0')}`,
  });
}

function durationLabel(absoluteMs: number): string {
  const minutes = Math.max(1, Math.round(absoluteMs / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

export function routineNextRunLabel(routine: AgentRoutine, now = Date.now()): string {
  if (!routine.enabled) return t('code:calendar.next.paused');
  if (routine.triggerKind === 'event') return t('code:calendar.next.event');
  if (!routine.nextRunAt || routine.nextRunAt <= now) return t('code:calendar.next.pending');
  return t('code:calendar.next.in', { duration: durationLabel(routine.nextRunAt - now) });
}

export function routineLastRunLabel(routine: AgentRoutine, now = Date.now()): string {
  if (!routine.lastRunAt) return t('code:calendar.last.never');
  const delta = now - routine.lastRunAt;
  if (delta < 60_000) return t('code:calendar.last.now');
  return t('code:calendar.last.ago', { duration: durationLabel(delta) });
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
    list.sort((left, right) => left.at - right.at || compareText(left.routine.title, right.routine.title));
  }
  return entries;
}
