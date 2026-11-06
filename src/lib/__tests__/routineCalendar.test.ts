import { describe, expect, it } from 'vitest';

import {
  buildRoutineCalendar,
  dayKey,
  intervalLabel,
  monthGrid,
  rangeLabel,
  routineScheduleLabel,
  weekDays,
} from '../routineCalendar';
import type { AgentRoutine } from '../types';

function routine(overrides: Partial<AgentRoutine> = {}): AgentRoutine {
  return {
    id: 'routine-1',
    agentId: 'agent-1',
    title: 'Verificação de caixa de entrada',
    prompt: 'Leia os e-mails.',
    scheduleKind: 'daily',
    intervalMinutes: 0,
    hour: 9,
    minute: 0,
    daysOfWeek: 0x7f,
    enabled: true,
    conversationId: null,
    nextRunAt: 0,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    triggerKind: 'schedule',
    eventKind: '',
    eventFilterJson: '{}',
    leaseUntil: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function local(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return new Date(year, month, day, hour, minute).getTime();
}

describe('routineCalendar — grid and labels', () => {
  it('builds a Monday-first six-week month grid across adjacent months', () => {
    const days = monthGrid(new Date(2026, 10, 5), new Date(2026, 10, 5));
    expect(days).toHaveLength(42);
    expect(days[0]?.key).toBe('2026-10-26');
    expect(days[0]?.date.getDate()).toBe(26);
    expect(days[0]?.inMonth).toBe(false);
    expect(days[41]?.key).toBe('2026-12-06');
    expect(days.find((day) => day.key === '2026-11-05')?.isToday).toBe(true);
  });

  it('builds the Monday–Sunday week containing the anchor', () => {
    const days = weekDays(new Date(2026, 10, 5), new Date(2026, 10, 5));
    expect(days.map((day) => day.key)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
  });

  it('formats the period labels in pt-BR', () => {
    const anchor = new Date(2026, 10, 5);
    expect(rangeLabel('month', anchor)).toBe('Novembro de 2026');
    expect(rangeLabel('week', anchor)).toBe('2 – 8 de novembro de 2026');
    expect(rangeLabel('day', anchor)).toBe('Quinta-feira, 5 de novembro de 2026');
  });
});

describe('routineCalendar — occurrences', () => {
  it('shows a weekday-only daily routine on the matching days', () => {
    const days = weekDays(new Date(2026, 10, 5), new Date(2026, 10, 5));
    const calendar = buildRoutineCalendar(
      [routine({ daysOfWeek: 1 << 4, createdAt: local(2026, 9, 1) })],
      days,
    );
    expect(calendar.get('2026-11-06')?.[0]?.timeLabel).toBe('09:00');
    expect(calendar.get('2026-11-05')).toBeUndefined();
    expect(calendar.get('2026-11-07')).toBeUndefined();
  });

  it('does not schedule before the routine creation time', () => {
    const days = weekDays(new Date(2026, 10, 5), new Date(2026, 10, 5));
    const calendar = buildRoutineCalendar(
      [routine({ createdAt: local(2026, 10, 6, 10, 0) })],
      days,
    );
    expect(calendar.get('2026-11-06')).toBeUndefined();
    expect(calendar.get('2026-11-07')?.[0]?.timeLabel).toBe('09:00');
  });

  it('projects interval routines once per day with a compact label', () => {
    const days = weekDays(new Date(2026, 10, 5), new Date(2026, 10, 5));
    const calendar = buildRoutineCalendar(
      [
        routine({
          scheduleKind: 'interval',
          intervalMinutes: 240,
          nextRunAt: local(2026, 10, 6, 12, 0),
          createdAt: local(2026, 9, 1),
          title: 'Coleta',
        }),
      ],
      days,
    );
    expect(calendar.size).toBe(7);
    expect(calendar.get('2026-11-05')?.[0]?.at).toBe(local(2026, 10, 5, 0, 0));
    expect(calendar.get('2026-11-05')?.[0]?.timeLabel).toBe('4 h');
    expect(calendar.get('2026-11-06')?.[0]?.timeLabel).toBe('4 h');
  });

  it('skips days for intervals longer than a day', () => {
    const days = weekDays(new Date(2026, 10, 9), new Date(2026, 10, 9));
    const calendar = buildRoutineCalendar(
      [
        routine({
          scheduleKind: 'interval',
          intervalMinutes: 26 * 60,
          nextRunAt: local(2026, 10, 6, 12, 0),
          createdAt: local(2026, 9, 1),
        }),
      ],
      days,
    );
    expect(calendar.get('2026-11-12')).toBeUndefined();
    expect(calendar.get('2026-11-13')?.[0]).toBeTruthy();
  });

  it('ignores event routines and keeps paused routines visible', () => {
    const days = weekDays(new Date(2026, 10, 5), new Date(2026, 10, 5));
    const calendar = buildRoutineCalendar(
      [
        routine({ id: 'event', triggerKind: 'event', eventKind: 'channel.message' }),
        routine({ id: 'paused', enabled: false, createdAt: local(2026, 9, 1) }),
      ],
      days,
    );
    expect(calendar.get('2026-11-05')).toHaveLength(1);
    expect(calendar.get('2026-11-05')?.[0]?.routine.id).toBe('paused');
    expect(calendar.get('2026-11-05')?.[0]?.routine.enabled).toBe(false);
  });
});

describe('routineCalendar — schedule copy', () => {
  it('summarizes weekday masks', () => {
    expect(routineScheduleLabel(routine({ daysOfWeek: 0x7f }))).toBe(
      'Todos os dias às 09:00',
    );
    expect(routineScheduleLabel(routine({ daysOfWeek: 0x1f }))).toBe('Seg a sex às 09:00');
    expect(routineScheduleLabel(routine({ daysOfWeek: 0x60 }))).toBe('Sáb e dom às 09:00');
    expect(routineScheduleLabel(routine({ daysOfWeek: 0x15 }))).toBe(
      'Seg, Qua, Sex às 09:00',
    );
  });

  it('summarizes event and interval schedules', () => {
    expect(
      routineScheduleLabel(
        routine({ triggerKind: 'event', eventKind: 'channel.message' }),
      ),
    ).toBe('Por evento: mensagem em canal');
    expect(
      routineScheduleLabel(routine({ triggerKind: 'event', eventKind: 'task.status' })),
    ).toBe('Por evento: status de tarefa');
    expect(
      routineScheduleLabel(routine({ scheduleKind: 'interval', intervalMinutes: 90 })),
    ).toBe('A cada 90 min');
    expect(
      routineScheduleLabel(routine({ scheduleKind: 'interval', intervalMinutes: 120 })),
    ).toBe('A cada 2 h');
    expect(
      routineScheduleLabel(routine({ scheduleKind: 'interval', intervalMinutes: 1440 })),
    ).toBe('A cada 1 d');
    expect(intervalLabel(240, true)).toBe('4 h');
  });

  it('formats day keys locally', () => {
    expect(dayKey(new Date(2026, 10, 5, 23, 59))).toBe('2026-11-05');
  });
});
