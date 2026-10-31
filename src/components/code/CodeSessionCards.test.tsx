// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ApprovalRequest, CodeSessionState, GoalView } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  respondApproval: vi.fn(),
  respondQuestion: vi.fn(),
  getCodeSessionState: vi.fn(),
  updateGoal: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

// Imported after the mocks above.
import { toast } from 'sonner';
import { emptyCodeSession, useCodeStore, useUiStore } from '@/lib/store';
import { CodeSessionCards } from './CodeAgentWidgets';

function planApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'apr-plan',
    toolCallId: 'call-plan',
    tool: 'submit_plan',
    title: 'Aprovar plano?',
    detail: { kind: 'other', text: 'Resumo do plano' },
    risk: 'ask',
    preview: '## Plano\n\n1. Criar módulo',
    options: [],
    createdAt: 1,
    ...overrides,
  };
}

function commandApproval(): ApprovalRequest {
  return {
    id: 'apr-cmd',
    toolCallId: 'call-cmd',
    tool: 'run_command',
    title: 'Executar comando?',
    detail: { kind: 'command', command: 'pnpm test', workdir: '.' },
    risk: 'shell',
    options: [{ id: 'allow', label: 'Permitir' }],
    createdAt: 2,
  };
}

function snapshot(overrides: Partial<CodeSessionState> = {}): CodeSessionState {
  return {
    conversationId: 'c-1',
    permissionMode: 'edit',
    planMode: false,
    todos: [],
    jobs: [],
    approvals: [],
    ...overrides,
  };
}

function seed(
  approvals: ApprovalRequest[],
  todos: { content: string; status: 'pending' | 'in_progress' | 'completed' }[] = [],
  goalValue: GoalView | null = null,
): void {
  useCodeStore.setState({
    byConversation: {
      'c-1': {
        ...emptyCodeSession('c-1'),
        approvals,
        todos,
        goal: goalValue,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useCodeStore.setState({ byConversation: {} });
  mocks.respondApproval.mockResolvedValue(true);
  mocks.getCodeSessionState.mockResolvedValue(snapshot());
  mocks.respondQuestion.mockResolvedValue(true);
  mocks.updateGoal.mockResolvedValue(snapshot());
  useUiStore.setState({ codeGoalOpen: false, codeView: 'session', goalDialog: null });
});

afterEach(cleanup);

describe('CodeSessionCards — gate do plano', () => {
  it('renderiza o gate interativo com o markdown do preview', () => {
    seed([planApproval()]);
    render(<CodeSessionCards conversationId="c-1" />);

    expect(screen.getByRole('alertdialog', { name: 'Plano proposto' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aprovar e executar' })).toBeTruthy();
    expect(screen.getByText('Criar módulo')).toBeTruthy();
  });

  it('"Aprovar e executar" envia choice=approve_run', async () => {
    seed([planApproval()]);
    render(<CodeSessionCards conversationId="c-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar e executar' }));

    await waitFor(() =>
      expect(mocks.respondApproval).toHaveBeenCalledWith('apr-plan', 'approved', {
        scope: null,
        feedback: null,
        choice: 'approve_run',
        planMarkdown: null,
      }),
    );
    // Decisão de plano sincroniza o snapshot autoritativo.
    await waitFor(() => expect(mocks.getCodeSessionState).toHaveBeenCalledWith('c-1'));
  });

  it('"Aprovar e revisar cada edição" envia choice=approve_review', async () => {
    seed([planApproval()]);
    render(<CodeSessionCards conversationId="c-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar e revisar cada edição' }));

    await waitFor(() =>
      expect(mocks.respondApproval).toHaveBeenCalledWith(
        'apr-plan',
        'approved',
        expect.objectContaining({ choice: 'approve_review' }),
      ),
    );
  });

  it('"Executar como Objetivo" envia choice=approve_goal', async () => {
    seed([planApproval()]);
    render(<CodeSessionCards conversationId="c-1" />);

    fireEvent.click(screen.getByRole('button', { name: /Executar como Objetivo/ }));

    await waitFor(() =>
      expect(mocks.respondApproval).toHaveBeenCalledWith(
        'apr-plan',
        'approved',
        expect.objectContaining({ choice: 'approve_goal' }),
      ),
    );
    await waitFor(() => expect(mocks.getCodeSessionState).toHaveBeenCalledWith('c-1'));
  });

  it('não executa como objetivo quando já existe um objetivo ativo', () => {
    seed([planApproval()], [], goal({ status: 'active' }));
    render(<CodeSessionCards conversationId="c-1" />);

    const button = screen.getByRole('button', {
      name: /Executar como Objetivo/,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/já tem um objetivo ativo/)).toBeTruthy();
  });

  it('"Continuar planejando" nega com feedback (default quando vazio)', async () => {
    seed([planApproval()]);
    render(<CodeSessionCards conversationId="c-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Continuar planejando' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar feedback' }));

    await waitFor(() =>
      expect(mocks.respondApproval).toHaveBeenCalledWith(
        'apr-plan',
        'denied',
        expect.objectContaining({ feedback: 'Continue planejando.' }),
      ),
    );
  });

  it('duplo clique decide uma única vez', async () => {
    seed([planApproval()]);
    render(<CodeSessionCards conversationId="c-1" />);

    const button = screen.getByRole('button', { name: 'Aprovar e executar' });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(mocks.respondApproval).toHaveBeenCalledTimes(1));
  });

  it('decisão já resolvida: store refresca e avisa (não fica card fantasma)', async () => {
    seed([planApproval()]);
    mocks.respondApproval.mockResolvedValue(false);
    render(<CodeSessionCards conversationId="c-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar e executar' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Esta aprovação já não está disponível',
        expect.objectContaining({ description: expect.stringContaining('Atualizando') }),
      ),
    );
    expect(mocks.getCodeSessionState).toHaveBeenCalledWith('c-1');
  });
});

describe('CodeSessionCards — acessibilidade e tarefas', () => {
  it('anuncia o gate em uma região aria-live curta (não envolve os cards)', () => {
    seed([planApproval()]);
    const { container } = render(<CodeSessionCards conversationId="c-1" />);

    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe('Plano aguardando aprovação.');
    // O card interativo não fica dentro da live region.
    expect(live?.querySelector('button')).toBeNull();
  });

  it('não renderiza mais o TodoCard fixo no fim do transcript (dedupe F-08)', () => {
    seed([], [{ content: 'Rodar testes', status: 'in_progress' }]);
    const { container } = render(<CodeSessionCards conversationId="c-1" />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tarefas do agente' })).toBeNull();
  });

  it('mantém os cards de aprovação de outras tools', () => {
    seed([commandApproval()]);
    render(<CodeSessionCards conversationId="c-1" />);
    expect(screen.getByRole('alertdialog', { name: 'Executar comando?' })).toBeTruthy();
  });
});

function goal(overrides: Partial<GoalView> = {}): GoalView {
  return {
    title: 'Fechar o bug',
    objective: 'Corrigir o cálculo de juros.',
    status: 'active',
    autoContinue: true,
    rounds: 3,
    maxRounds: 25,
    revision: 7,
    origin: 'user',
    createdAt: 1_000,
    updatedAt: 2_000,
    completedAt: null,
    lastRoundAt: null,
    lastNote: null,
    pauseReason: null,
    pauseDetail: null,
    blockerReason: null,
    blockerStreak: 0,
    stalledRounds: 0,
    tokens: 0,
    cost: 0,
    ...overrides,
  };
}

function seedGoalSession(goalValue: GoalView, dismissedGoalRevision: number | null = null): void {
  useCodeStore.setState({
    byConversation: {
      'c-1': {
        ...emptyCodeSession('c-1'),
        goal: goalValue,
        dismissedGoalRevision,
      },
    },
  });
}

describe('CodeSessionCards — card de atenção do objetivo', () => {
  it('pausado por erro aparece com motivo e ações', () => {
    seedGoalSession(
      goal({ status: 'paused', pauseReason: 'error', pauseDetail: 'Credencial expirada', autoContinue: false }),
    );

    render(<CodeSessionCards conversationId="c-1" />);

    const card = screen.getByRole('status', { name: 'Objetivo pausado' });
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('Pausado após um erro');
    expect(card.textContent).toContain('Credencial expirada');
    expect(screen.getByRole('button', { name: 'Retomar objetivo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir objetivo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dispensar' })).toBeTruthy();
  });

  it('retomar aplica update_goal resume com a revisão atual', async () => {
    seedGoalSession(goal({ status: 'paused', pauseReason: 'error', autoContinue: false }));

    render(<CodeSessionCards conversationId="c-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Retomar objetivo' }));

    await waitFor(() =>
      expect(mocks.updateGoal).toHaveBeenCalledWith('c-1', 'resume', null, 7),
    );
  });

  it('concluir (bloqueado) aplica update_goal complete', async () => {
    seedGoalSession(
      goal({ status: 'blocked', blockerReason: 'Falta permissão', blockerStreak: 1, autoContinue: false }),
    );

    render(<CodeSessionCards conversationId="c-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Concluir objetivo' }));

    await waitFor(() =>
      expect(mocks.updateGoal).toHaveBeenCalledWith('c-1', 'complete', null, 7),
    );
  });

  it('estender (max_rounds) abre o diálogo em modo edição', () => {
    seedGoalSession(
      goal({ status: 'paused', pauseReason: 'max_rounds', autoContinue: false, rounds: 25 }),
    );

    render(<CodeSessionCards conversationId="c-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Estender limite' }));

    expect(useUiStore.getState().goalDialog).toEqual({
      conversationId: 'c-1',
      mode: 'edit',
    });
  });

  it('dispensar esconde o card pela revisão', () => {
    seedGoalSession(goal({ status: 'paused', pauseReason: 'error', autoContinue: false }));

    render(<CodeSessionCards conversationId="c-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar' }));

    expect(useCodeStore.getState().byConversation['c-1']?.dismissedGoalRevision).toBe(7);
    expect(screen.queryByRole('status', { name: 'Objetivo pausado' })).toBeNull();
  });

  it('revisão dispensada não renderiza o card de novo', () => {
    seedGoalSession(
      goal({ status: 'paused', pauseReason: 'error', autoContinue: false }),
      7,
    );

    const { container } = render(<CodeSessionCards conversationId="c-1" />);
    expect(container.firstChild).toBeNull();
  });

  it('concluído mostra card com abrir e dispensar (sem retomar)', () => {
    seedGoalSession(
      goal({ status: 'completed', autoContinue: false, completedAt: Date.now() - 1_000 }),
    );

    render(<CodeSessionCards conversationId="c-1" />);

    expect(screen.getByRole('status', { name: 'Objetivo concluído' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retomar objetivo' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir objetivo' }));
    expect(useUiStore.getState().codeGoalOpen).toBe(true);
    expect(useUiStore.getState().codeView).toBe('goal');
  });

  it('bloqueado usa role alert', () => {
    seedGoalSession(
      goal({ status: 'blocked', blockerReason: 'Falta permissão', blockerStreak: 1, autoContinue: false }),
    );

    render(<CodeSessionCards conversationId="c-1" />);

    expect(screen.getByRole('alert', { name: 'Objetivo bloqueado' })).toBeTruthy();
  });

  it('pausado pelo usuário não gera card e não quebra as aprovações', () => {
    seedGoalSession(goal({ status: 'paused', pauseReason: 'user', autoContinue: false }));
    useCodeStore.setState((state) => ({
      byConversation: {
        ...state.byConversation,
        'c-1': {
          ...state.byConversation['c-1'],
          approvals: [commandApproval()],
        },
      },
    }));

    render(<CodeSessionCards conversationId="c-1" />);

    expect(screen.getByRole('alertdialog', { name: 'Executar comando?' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Objetivo pausado' })).toBeNull();
  });

  it('convive com o gate do plano aguardando aprovação', () => {
    seedGoalSession(goal({ status: 'paused', pauseReason: 'interrupted', autoContinue: false }));
    useCodeStore.setState((state) => ({
      byConversation: {
        ...state.byConversation,
        'c-1': {
          ...state.byConversation['c-1'],
          approvals: [planApproval()],
        },
      },
    }));

    render(<CodeSessionCards conversationId="c-1" />);

    expect(screen.getByRole('alertdialog', { name: 'Plano proposto' })).toBeTruthy();
    // A rodada foi interrompida: o card de atenção fica visível para retomar.
    expect(screen.getByRole('status', { name: 'Objetivo pausado' })).toBeTruthy();
  });
});
