// @vitest-environment jsdom
/**
 * Pill/popover do objetivo no composer (docs/goals/code-goals/PLAN.md §10.2).
 *
 * Cobre os estados do `GoalCard` hospedado no popover, as ações que sobem para
 * o `codeStore`/`chatStore`, a navegação para o painel central e o diálogo, e o
 * bloqueio das ações durante uma rodada em andamento.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CodeSessionState, GoalView } from '@/lib/types';

const mocks = vi.hoisted(() => ({
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
import {
  emptyCodeSession,
  useChatStore,
  useCodeStore,
  useUiStore,
  type StreamingState,
} from '@/lib/store';
import { GoalControls } from './GoalControls';

const CONVERSATION_ID = 'c-1';

function goal(overrides: Partial<GoalView> = {}): GoalView {
  return {
    title: 'Deixar o build verde',
    objective: 'Corrigir os erros de TypeScript e rodar os testes.',
    status: 'active',
    autoContinue: true,
    rounds: 2,
    maxRounds: 25,
    revision: 4,
    origin: 'user',
    createdAt: 1_000,
    updatedAt: 2_000,
    ...overrides,
  };
}

function sessionState(overrides: Partial<CodeSessionState> = {}): CodeSessionState {
  return {
    conversationId: CONVERSATION_ID,
    permissionMode: 'edit',
    planMode: false,
    todos: [],
    jobs: [],
    approvals: [],
    ...overrides,
  };
}

function seedGoal(overrides: Partial<GoalView> = {}): GoalView {
  const value = goal(overrides);
  useCodeStore.setState({
    byConversation: {
      [CONVERSATION_ID]: {
        ...emptyCodeSession(CONVERSATION_ID),
        goal: value,
      },
    },
  });
  return value;
}

const streaming = (overrides: Partial<StreamingState> = {}): StreamingState => ({
  turnId: 'turn-goal',
  conversationId: CONVERSATION_ID,
  assistantId: 'assistant-goal',
  userMessageId: 'user-goal',
  phase: 'tool',
  step: 1,
  startedAt: Date.now(),
  turnKind: 'goal_round',
  ...overrides,
});

const pill = (name: RegExp | string): HTMLElement => screen.getByRole('button', { name });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateGoal.mockResolvedValue(sessionState({ goal: goal({ status: 'paused' }) }));
  mocks.listGoalRounds.mockResolvedValue([]);
  mocks.getCodeSessionState.mockResolvedValue(sessionState());
  useCodeStore.setState({ byConversation: {} });
  useChatStore.setState({ streaming: null, activeId: CONVERSATION_ID });
  useUiStore.setState({ codeView: 'session', codeGoalOpen: false, goalDialog: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GoalControls — sem objetivo', () => {
  it('sem props mantém o fallback: botão só-ícone dispara lumina:goal-intent', () => {
    const listener = vi.fn();
    window.addEventListener('lumina:goal-intent', listener);
    try {
      render(<GoalControls conversationId={CONVERSATION_ID} />);

      const trigger = pill('Criar objetivo com /goal');
      // Pedido de produto: botão sem texto, apenas o ícone.
      expect(trigger.textContent?.trim() ?? '').toBe('');
      expect(trigger.getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(trigger);

      expect(listener).toHaveBeenCalledTimes(1);
      // O chip é uma intenção do turno; nenhum diálogo de criação é aberto.
      expect(useUiStore.getState().goalDialog).toBeNull();
    } finally {
      window.removeEventListener('lumina:goal-intent', listener);
    }
  });

  it('com goalIntent=false fica inativo e alterna pelo handler do Composer', () => {
    const onToggleGoalIntent = vi.fn();
    render(
      <GoalControls
        conversationId={CONVERSATION_ID}
        goalIntent={false}
        onToggleGoalIntent={onToggleGoalIntent}
      />,
    );

    const trigger = pill('Criar objetivo com /goal');
    expect(trigger.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(trigger);

    expect(onToggleGoalIntent).toHaveBeenCalledTimes(1);
  });

  it('com goalIntent=true fica accent/aria-pressed e "Desativar objetivo" alterna', () => {
    const onToggleGoalIntent = vi.fn();
    const listener = vi.fn();
    window.addEventListener('lumina:goal-intent', listener);
    try {
      render(
        <GoalControls
          conversationId={CONVERSATION_ID}
          goalIntent
          onToggleGoalIntent={onToggleGoalIntent}
        />,
      );

      const trigger = pill('Desativar objetivo');
      expect(trigger.getAttribute('aria-pressed')).toBe('true');
      expect(trigger.textContent?.trim() ?? '').toBe('');

      fireEvent.click(trigger);
      expect(onToggleGoalIntent).toHaveBeenCalledTimes(1);
      // Com handler próprio o evento global (fallback) não é disparado.
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('lumina:goal-intent', listener);
    }
  });
});

describe('GoalControls — com objetivo', () => {
  it('resume status/rodadas no pill e abre o popover com o card completo', async () => {
    seedGoal();
    render(<GoalControls conversationId={CONVERSATION_ID} />);

    const trigger = pill(/^Objetivo: Automático — Rodada 2 de 25$/);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);

    expect(await screen.findByText('Deixar o build verde')).toBeTruthy();
    expect(screen.getByText('Corrigir os erros de TypeScript e rodar os testes.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pausar objetivo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir objetivo' })).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(mocks.listGoalRounds).toHaveBeenCalledWith(CONVERSATION_ID, 100));
  });

  it('"Abrir objetivo" abre o painel central e fecha o popover', async () => {
    seedGoal();
    render(<GoalControls conversationId={CONVERSATION_ID} />);

    fireEvent.click(pill(/^Objetivo:/));
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir objetivo' }));

    const ui = useUiStore.getState();
    expect(ui.codeView).toBe('goal');
    expect(ui.codeGoalOpen).toBe(true);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Objetivo:/ }).getAttribute('aria-expanded')).toBe(
        'false',
      ),
    );
  });

  it('"Pausar" aplica a ação via codeStore e reflete o snapshot', async () => {
    const current = seedGoal();
    render(<GoalControls conversationId={CONVERSATION_ID} />);

    fireEvent.click(pill(/^Objetivo:/));
    fireEvent.click(await screen.findByRole('button', { name: 'Pausar objetivo' }));

    await waitFor(() =>
      expect(mocks.updateGoal).toHaveBeenCalledWith(
        CONVERSATION_ID,
        'pause',
        null,
        current.revision,
      ),
    );
    await waitFor(() => expect(pill(/^Objetivo: Pausado/)).toBeTruthy());
  });

  it('"Editar" abre o diálogo em modo edição', async () => {
    seedGoal();
    render(<GoalControls conversationId={CONVERSATION_ID} />);

    fireEvent.click(pill(/^Objetivo:/));
    fireEvent.click(await screen.findByRole('button', { name: 'Editar objetivo' }));

    expect(useUiStore.getState().goalDialog).toEqual({
      conversationId: CONVERSATION_ID,
      mode: 'edit',
    });
  });

  it('"Concluir" pede confirmação inline antes do IPC', async () => {
    seedGoal();
    render(<GoalControls conversationId={CONVERSATION_ID} />);

    fireEvent.click(pill(/^Objetivo:/));
    fireEvent.click(await screen.findByRole('button', { name: 'Concluir objetivo' }));

    expect(mocks.updateGoal).not.toHaveBeenCalled();
    expect(screen.getByText(/Concluir o objetivo\?/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar conclusão do objetivo' }));

    await waitFor(() =>
      expect(mocks.updateGoal).toHaveBeenCalledWith(
        CONVERSATION_ID,
        'complete',
        null,
        goal().revision,
      ),
    );
  });

  it('pausado por limite de rodadas oferece "Estender" abrindo a edição', async () => {
    seedGoal({ status: 'paused', pauseReason: 'max_rounds', rounds: 25 });
    render(<GoalControls conversationId={CONVERSATION_ID} />);

    fireEvent.click(pill(/^Objetivo: Pausado/));
    fireEvent.click(await screen.findByRole('button', { name: 'Estender limite de rodadas' }));

    expect(useUiStore.getState().goalDialog).toEqual({
      conversationId: CONVERSATION_ID,
      mode: 'edit',
    });
  });

  it('ativo manual: "Nova rodada" chama o driver do chatStore', async () => {
    seedGoal({ status: 'active', autoContinue: false });
    const runGoalRound = vi
      .spyOn(useChatStore.getState(), 'runGoalRound')
      .mockResolvedValue(true);
    render(<GoalControls conversationId={CONVERSATION_ID} />);

    expect(pill(/^Objetivo: Manual/)).toBeTruthy();
    fireEvent.click(pill(/^Objetivo:/));
    fireEvent.click(await screen.findByRole('button', { name: 'Nova rodada agora' }));

    await waitFor(() => expect(runGoalRound).toHaveBeenCalledWith(CONVERSATION_ID));
  });

  it('bloqueado: "Retomar" retoma via codeStore', async () => {
    seedGoal({ status: 'blocked', blockerReason: 'Sem credencial de rede' });
    mocks.updateGoal.mockResolvedValue(sessionState({ goal: goal({ status: 'active' }) }));
    render(<GoalControls conversationId={CONVERSATION_ID} />);

    fireEvent.click(pill(/^Objetivo: Bloqueado/));
    fireEvent.click(await screen.findByRole('button', { name: 'Retomar objetivo' }));

    await waitFor(() =>
      expect(mocks.updateGoal).toHaveBeenCalledWith(
        CONVERSATION_ID,
        'resume',
        null,
        goal().revision,
      ),
    );
  });
});

describe('GoalControls — rodada em andamento', () => {
  it('mostra "Trabalhando" e desabilita as ações, exceto pausar após a rodada', async () => {
    const current = seedGoal();
    useChatStore.setState({ streaming: streaming() });
    render(<GoalControls conversationId={CONVERSATION_ID} />);

    expect(pill(/^Objetivo: Trabalhando — Rodada 2 de 25$/)).toBeTruthy();
    fireEvent.click(pill(/^Objetivo:/));

    expect(await screen.findByText(/Rodada em andamento/)).toBeTruthy();
    // Ações de mutação do card ficam fora durante a rodada.
    expect(screen.queryByRole('button', { name: 'Pausar objetivo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Concluir objetivo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar objetivo' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Abrir objetivo' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pausar após esta rodada' }));

    await waitFor(() =>
      expect(mocks.updateGoal).toHaveBeenCalledWith(
        CONVERSATION_ID,
        'disarm',
        null,
        current.revision,
      ),
    );
  });

  it('não inicia outra rodada pelo atalho "Nova rodada agora" durante o streaming', async () => {
    seedGoal();
    useChatStore.setState({ streaming: streaming() });
    render(<GoalControls conversationId={CONVERSATION_ID} />);

    fireEvent.click(pill(/^Objetivo:/));

    expect(await screen.findByText(/Rodada em andamento/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Nova rodada agora' })).toBeNull();
  });
});
