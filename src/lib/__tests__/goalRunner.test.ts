import { describe, expect, it } from 'vitest';
import {
  canStartGoalRound,
  goalCanExtend,
  goalContinuationReasonLabel,
  goalNeedsAttention,
  goalNextRound,
  goalPauseReasonLabel,
  goalRoundLabel,
  goalStatusLabel,
  goalStatusTone,
  shouldContinueGoal,
} from '../goalRunner';
import type { GoalView } from '../types';

function goal(overrides: Partial<GoalView> = {}): GoalView {
  return {
    title: 'Objetivo',
    objective: 'Refatorar o parser.',
    status: 'active',
    autoContinue: true,
    rounds: 2,
    maxRounds: 25,
    revision: 3,
    origin: 'user',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

const base = {
  goal: goal(),
  planMode: false,
  approvalCount: 0,
  questionCount: 0,
  streaming: false,
  activeId: 'c-1',
  conversationId: 'c-1',
  layoutMode: 'code' as const,
};

describe('goalRunner — decisão de autocontinuação', () => {
  it('continua quando todas as condições valem', () => {
    expect(shouldContinueGoal(base)).toBe(true);
  });

  it.each([
    ['sem objetivo', { goal: null }],
    ['fora do layout Code', { layoutMode: 'chat' as const }],
    ['sessão não é a ativa', { activeId: 'c-2' }],
    ['streaming', { streaming: true }],
    ['modo Plano', { planMode: true }],
    ['aprovação pendente', { approvalCount: 1 }],
    ['pergunta pendente', { questionCount: 1 }],
    ['objetivo pausado', { goal: goal({ status: 'paused' }) }],
    ['continuidade manual', { goal: goal({ autoContinue: false }) }],
    ['orçamento esgotado', { goal: goal({ rounds: 25 }) }],
  ])('não continua com %s', (_label, patch) => {
    expect(shouldContinueGoal({ ...base, ...patch })).toBe(false);
  });

  it('a rodada manual ignora autoContinue e layout, mas exige ativo e orçamento', () => {
    const manual = { ...base, goal: goal({ autoContinue: false }) };
    expect(canStartGoalRound(manual)).toBe(true);
    expect(canStartGoalRound({ ...manual, planMode: true })).toBe(false);
    expect(canStartGoalRound({ ...manual, goal: goal({ status: 'paused' }) })).toBe(false);
    expect(canStartGoalRound({ ...manual, goal: goal({ rounds: 25 }) })).toBe(false);
    expect(canStartGoalRound({ ...manual, streaming: true })).toBe(false);
  });
});

describe('goalRunner — rótulos e estados', () => {
  it('rótulos de status, rodada e pausa', () => {
    expect(goalStatusLabel(goal())).toBe('Automático');
    expect(goalStatusLabel(goal({ autoContinue: false }))).toBe('Manual');
    expect(goalStatusLabel(goal({ status: 'paused', pauseReason: 'stalled' }))).toBe('Pausado');
    expect(goalRoundLabel(goal())).toBe('Rodada 2 de 25');
    expect(goalNextRound(goal())).toBe(3);
    expect(goalNextRound(goal({ rounds: 25 }))).toBe(25);
    expect(goalPauseReasonLabel('max_rounds')).toBe('Limite de rodadas atingido');
    expect(goalPauseReasonLabel(null)).toBeNull();
  });

  it('atenção/ex tensão e tons de status', () => {
    expect(goalNeedsAttention(goal({ status: 'blocked' }))).toBe(true);
    expect(goalNeedsAttention(goal({ status: 'completed' }))).toBe(true);
    expect(goalNeedsAttention(goal({ status: 'paused', pauseReason: 'stalled' }))).toBe(true);
    expect(goalNeedsAttention(goal({ status: 'paused', pauseReason: 'user' }))).toBe(false);
    expect(goalNeedsAttention(goal())).toBe(false);
    expect(goalCanExtend(goal({ status: 'paused', pauseReason: 'max_rounds' }))).toBe(true);
    expect(goalCanExtend(goal({ status: 'paused', pauseReason: 'error' }))).toBe(false);
    expect(goalStatusTone(goal())).toBe('accent');
    expect(goalStatusTone(goal({ status: 'paused' }))).toBe('warning');
    expect(goalStatusTone(goal({ status: 'blocked' }))).toBe('danger');
    expect(goalStatusTone(goal({ status: 'completed' }))).toBe('success');
    expect(goalStatusTone(null)).toBe('neutral');
  });

  it('traduz os motivos do preflight', () => {
    expect(goalContinuationReasonLabel('plan_mode')).toContain('Modo Plano');
    expect(goalContinuationReasonLabel('pending_approval')).toContain('aprovação');
    expect(goalContinuationReasonLabel('busy')).toContain('turno');
    expect(goalContinuationReasonLabel('interrupted')).toContain('interrompida');
    expect(goalContinuationReasonLabel(null)).toBe('Não foi possível continuar.');
  });
});
