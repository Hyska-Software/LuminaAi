// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CodeSessionState, GoalRound, GoalView } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  listGoalRounds: vi.fn(),
  getCodeSessionState: vi.fn(),
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
import { emptyCodeSession, useChatStore, useCodeStore, useUiStore } from '@/lib/store';
import type { CodeSessionUi } from '@/lib/store/codeStore';
import type { StreamingState } from '@/lib/store/chatStore';
import { GoalPanel } from './GoalPanel';

const CONVERSATION_ID = 'c-1';

function goal(overrides: Partial<GoalView> = {}): GoalView {
  return {
    title: 'Fechar o bug do relatório',
    objective: 'Corrigir o **juros** do relatório.',
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
    tokens: 4_321,
    cost: 0.42,
    ...overrides,
  };
}

function round(overrides: Partial<GoalRound> = {}): GoalRound {
  return {
    index: 1,
    turnId: 'turn-1',
    startedAt: Date.now() - 60_000,
    endedAt: Date.now() - 30_000,
    outcome: 'done',
    durationMs: 45_000,
    tokens: 1_200,
    cost: 0.1,
    filesChanged: 2,
    note: 'Ajustei o cálculo e rodei os testes.',
    ...overrides,
  };
}

function snapshot(goalValue: GoalView | null): CodeSessionState {
  return {
    conversationId: CONVERSATION_ID,
    permissionMode: 'edit',
    planMode: false,
    todos: [],
    jobs: [],
    approvals: [],
    goal: goalValue,
  };
}

function seedSession(overrides: Partial<CodeSessionUi> = {}): void {
  useCodeStore.setState({
    byConversation: {
      [CONVERSATION_ID]: { ...emptyCodeSession(CONVERSATION_ID), ...overrides },
    },
  });
}

function streamingState(): StreamingState {
  return {
    turnId: 'turn-run',
    conversationId: CONVERSATION_ID,
    assistantId: 'assistant-run',
    userMessageId: 'user-run',
    phase: 'text',
    step: 1,
    startedAt: 1,
    turnKind: 'goal_round',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCodeStore.setState({ byConversation: {} });
  useChatStore.setState({ streaming: null, runGoalRound: vi.fn().mockResolvedValue(true) });
  useUiStore.setState({ goalDialog: null, codeGoalOpen: false, codeView: 'session' });
  mocks.listGoalRounds.mockResolvedValue([]);
  mocks.updateGoal.mockImplementation(async (_conversationId, action: string) =>
    snapshot(action === 'delete' ? null : goal({ revision: 8 })),
  );
  mocks.createGoal.mockResolvedValue(snapshot(goal()));
  mocks.getCodeSessionState.mockResolvedValue(snapshot(null));
});

afterEach(cleanup);

describe('GoalPanel — estados', () => {
  it('sem objetivo mostra o estado vazio com CTA do fluxo /goal', () => {
    const listener = vi.fn();
    window.addEventListener('lumina:goal-intent', listener);
    try {
      // View do painel aberta: o composer está oculto atrás dela.
      useUiStore.setState({ codeView: 'goal', codeGoalOpen: true });
      render(<GoalPanel conversationId={CONVERSATION_ID} />);

      expect(screen.getByRole('region', { name: 'Objetivo da sessão' })).toBeTruthy();
      expect(screen.getByText('Nenhum objetivo nesta sessão')).toBeTruthy();
      expect(mocks.listGoalRounds).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Criar com /goal' }));

      expect(listener).toHaveBeenCalledTimes(1);
      expect(useUiStore.getState().goalDialog).toBeNull();
      // Volta para a sessão para o usuário ver o chip/composer.
      expect(useUiStore.getState().codeView).toBe('session');
      expect(useUiStore.getState().codeGoalOpen).toBe(false);
    } finally {
      window.removeEventListener('lumina:goal-intent', listener);
    }
  });

  it('carregando mostra o placeholder, não o CTA', () => {
    seedSession({ loading: true });

    render(<GoalPanel conversationId={CONVERSATION_ID} />);

    expect(screen.getByText('Carregando objetivo…')).toBeTruthy();
    expect(screen.queryByText('Nenhum objetivo nesta sessão')).toBeNull();
  });

  it('mostra objetivo em Markdown, status, rodada e resumo', async () => {
    seedSession({ goal: goal({ lastRoundAt: Date.now() - 60_000 }) });

    render(<GoalPanel conversationId={CONVERSATION_ID} />);

    expect(screen.getByRole('heading', { name: 'Fechar o bug do relatório' })).toBeTruthy();
    expect(screen.getByText('Rodada 3 de 25')).toBeTruthy();
    const strong = screen.getByText('juros');
    expect(strong.tagName).toBe('STRONG');
    // Resumo: rodadas, tempo, tokens, custo e última atividade.
    expect(screen.getByText('Tempo total')).toBeTruthy();
    expect(screen.getByText('Tokens')).toBeTruthy();
    expect(screen.getByText('Custo')).toBeTruthy();
    expect(screen.getByText('Última atividade')).toBeTruthy();
    expect(screen.getByText('~4.3K')).toBeTruthy();
    expect(screen.getByText('$0.42')).toBeTruthy();
    await waitFor(() => expect(mocks.listGoalRounds).toHaveBeenCalledWith(CONVERSATION_ID, 200));
  });

  it('objetivo longo fica em região rolável e quebra palavras', () => {
    seedSession({ goal: goal({ objective: 'a'.repeat(4_000) }) });

    render(<GoalPanel conversationId={CONVERSATION_ID} />);

    const scroll = screen.getByRole('region', { name: 'Objetivo completo' });
    expect(scroll.className).toContain('break-words');
    expect(scroll.className).toContain('overflow-y-auto');
  });
});

describe('GoalPanel — ações', () => {
  it('pausar aplica update_goal com a revisão atual', async () => {
    seedSession({ goal: goal() });
    render(<GoalPanel conversationId={CONVERSATION_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pausar objetivo' }));

    await waitFor(() =>
      expect(mocks.updateGoal).toHaveBeenCalledWith(CONVERSATION_ID, 'pause', null, 7),
    );
  });

  it('“Nova rodada” inicia a rodada pelo chatStore (objetivo manual)', async () => {
    seedSession({ goal: goal({ autoContinue: false }) });
    render(<GoalPanel conversationId={CONVERSATION_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'Nova rodada agora' }));

    await waitFor(() =>
      expect(useChatStore.getState().runGoalRound).toHaveBeenCalledWith(CONVERSATION_ID),
    );
  });

  it('“Editar” abre o diálogo em modo edição', () => {
    seedSession({ goal: goal() });
    render(<GoalPanel conversationId={CONVERSATION_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'Editar objetivo' }));

    expect(useUiStore.getState().goalDialog).toEqual({
      conversationId: CONVERSATION_ID,
      mode: 'edit',
    });
  });

  it('“Encerrar objetivo” leva à zona de perigo do diálogo', () => {
    seedSession({ goal: goal() });
    render(<GoalPanel conversationId={CONVERSATION_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'Encerrar objetivo' }));

    expect(useUiStore.getState().goalDialog).toEqual({
      conversationId: CONVERSATION_ID,
      mode: 'edit',
    });
  });

  it('com rodada em andamento desabilita as ações e marca aria-busy', () => {
    seedSession({ goal: goal() });
    useChatStore.setState({ streaming: streamingState() });

    render(<GoalPanel conversationId={CONVERSATION_ID} />);

    expect(screen.getByRole('region', { name: 'Objetivo da sessão' }).getAttribute('aria-busy')).toBe(
      'true',
    );
    expect((screen.getByRole('button', { name: 'Pausar objetivo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('bloqueado mostra motivo e permite retomar', () => {
    seedSession({
      goal: goal({
        status: 'blocked',
        blockerReason: 'Falta credencial do provedor',
        blockerStreak: 1,
        rounds: 2,
      }),
    });
    render(<GoalPanel conversationId={CONVERSATION_ID} />);

    expect(screen.getByText('Bloqueio registrado (1 de 3).')).toBeTruthy();
    expect(screen.getByText('Falta credencial do provedor')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retomar objetivo' })).toBeTruthy();
  });

  it('concluído oferece Reabrir e Novo objetivo pelo fluxo /goal', () => {
    const listener = vi.fn();
    window.addEventListener('lumina:goal-intent', listener);
    try {
      seedSession({ goal: goal({ status: 'completed', completedAt: Date.now() - 1_000 }) });
      useUiStore.setState({ codeView: 'goal', codeGoalOpen: true });
      render(<GoalPanel conversationId={CONVERSATION_ID} />);

      expect(screen.getByText('Concluído agora.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Reabrir objetivo' })).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Novo objetivo (/goal)' }));

      expect(listener).toHaveBeenCalledTimes(1);
      expect(useUiStore.getState().goalDialog).toBeNull();
      expect(useUiStore.getState().codeView).toBe('session');
      expect(useUiStore.getState().codeGoalOpen).toBe(false);
    } finally {
      window.removeEventListener('lumina:goal-intent', listener);
    }
  });
});

describe('GoalPanel — histórico de rodadas', () => {
  it('mostra resultado, duração, arquivos e nota de cada rodada', async () => {
    const rounds = [
      round({ index: 2, turnId: 'turn-2', outcome: 'error', durationMs: 5_000, filesChanged: 0, note: null }),
      round({ index: 1, turnId: 'turn-1' }),
    ];
    mocks.listGoalRounds.mockResolvedValue(rounds);
    seedSession({ goal: goal() });

    render(<GoalPanel conversationId={CONVERSATION_ID} />);

    expect(await screen.findByText('Ajustei o cálculo e rodei os testes.')).toBeTruthy();
    expect(screen.getByText('Concluída')).toBeTruthy();
    expect(screen.getByText('Erro')).toBeTruthy();
    expect(screen.getByText('45s')).toBeTruthy();
    expect(screen.getByText('2 arquivos')).toBeTruthy();
  });

  it('rodada sem fecho aparece como Em andamento', async () => {
    mocks.listGoalRounds.mockResolvedValue([
      round({ outcome: null, endedAt: null, durationMs: null, note: null }),
    ]);
    seedSession({ goal: goal() });

    render(<GoalPanel conversationId={CONVERSATION_ID} />);

    expect(await screen.findByText('Em andamento')).toBeTruthy();
    expect(screen.queryByText('Interrompida')).toBeNull();
  });

  it('erro no histórico mostra retry', async () => {
    mocks.listGoalRounds.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([]);
    seedSession({ goal: goal() });

    render(<GoalPanel conversationId={CONVERSATION_ID} />);

    expect(await screen.findByText('Não foi possível carregar o histórico de rodadas.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await waitFor(() => expect(mocks.listGoalRounds).toHaveBeenCalledTimes(2));
  });

  it('recarrega quando a rodada avança', async () => {
    seedSession({ goal: goal({ rounds: 1 }) });
    render(<GoalPanel conversationId={CONVERSATION_ID} />);
    await waitFor(() => expect(mocks.listGoalRounds).toHaveBeenCalledTimes(1));

    act(() => {
      useCodeStore.setState((state) => ({
        byConversation: {
          ...state.byConversation,
          [CONVERSATION_ID]: {
            ...state.byConversation[CONVERSATION_ID],
            goal: goal({ rounds: 2, updatedAt: 9_000 }),
          },
        },
      }));
    });

    await waitFor(() => expect(mocks.listGoalRounds).toHaveBeenCalledTimes(2));
  });

  it('copia o objetivo para o clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    seedSession({ goal: goal() });
    render(<GoalPanel conversationId={CONVERSATION_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copiar objetivo' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('Corrigir o **juros** do relatório.'),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Objetivo copiado'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });
});
