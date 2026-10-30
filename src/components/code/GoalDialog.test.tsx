// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CodeSessionState, CreateGoalInput, GoalView } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  listGoalRounds: vi.fn(),
  getCodeSessionState: vi.fn(),
  // `create_goal` renomeia o título placeholder; a UI relê a lista.
  listConversations: vi.fn().mockResolvedValue([]),
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
import type { StreamingState } from '@/lib/store/chatStore';
import { GoalDialog } from './GoalDialog';

const CONVERSATION_ID = 'c-1';

function goal(overrides: Partial<GoalView> = {}): GoalView {
  return {
    title: 'Fechar o bug',
    objective: 'Corrigir o cálculo de juros.',
    status: 'active',
    autoContinue: true,
    rounds: 1,
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

function seedGoal(goalValue: GoalView): void {
  useCodeStore.setState({
    byConversation: { [CONVERSATION_ID]: { ...emptyCodeSession(CONVERSATION_ID), goal: goalValue } },
  });
}

function streamingState(overrides: Partial<StreamingState> = {}): StreamingState {
  return {
    turnId: 'turn-1',
    conversationId: CONVERSATION_ID,
    assistantId: 'assistant-1',
    userMessageId: 'user-1',
    phase: 'text',
    step: 1,
    startedAt: 1,
    turnKind: 'user',
    ...overrides,
  };
}

function renderDialog(mode: 'create' | 'edit', onClose = vi.fn()) {
  render(
    <GoalDialog conversationId={CONVERSATION_ID} mode={mode} onClose={onClose} />,
  );
  return onClose;
}

const objectiveInput = () => screen.getByRole('textbox', { name: /^Objetivo/ });
const titleInput = () => screen.getByLabelText('Título');
const maxRoundsInput = () => screen.getByRole('spinbutton', { name: 'Limite de rodadas' });
const autoContinueSwitch = () =>
  screen.getByRole('switch', { name: 'Continuar automaticamente' });

beforeEach(() => {
  vi.clearAllMocks();
  useCodeStore.setState({ byConversation: {} });
  useChatStore.setState({ streaming: null, runGoalRound: vi.fn().mockResolvedValue(true) });
  useUiStore.setState({ codeGoalOpen: false, codeView: 'session', goalDialog: null });
  mocks.createGoal.mockImplementation(async (_conversationId: string, input: CreateGoalInput) =>
    snapshot(
      goal({
        title: input.title ?? 'Fechar o bug',
        objective: input.objective,
        autoContinue: input.autoContinue ?? true,
        maxRounds: input.maxRounds ?? 25,
        revision: 1,
      }),
    ),
  );
  mocks.updateGoal.mockImplementation(async (_conversationId, action: string) =>
    snapshot(action === 'delete' ? null : goal({ revision: 8 })),
  );
  mocks.listGoalRounds.mockResolvedValue([]);
});

afterEach(cleanup);

describe('GoalDialog — criação', () => {
  it('mostra os campos com os defaults e o aviso de custo', () => {
    renderDialog('create');

    expect(screen.getByRole('dialog', { name: 'Definir objetivo' })).toBeTruthy();
    expect(titleInput()).toHaveProperty('value', '');
    expect(objectiveInput()).toHaveProperty('value', '');
    expect(screen.getByText('0/4000')).toBeTruthy();
    expect(autoContinueSwitch().getAttribute('aria-checked')).toBe('true');
    expect(maxRoundsInput()).toHaveProperty('value', '25');
    expect(
      screen.getByText(/Cada rodada é um turno completo e consome tokens do provedor/),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Criar e começar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Criar sem começar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
  });

  it('valida o objetivo obrigatório antes de chamar o backend', () => {
    renderDialog('create');

    fireEvent.click(screen.getByRole('button', { name: 'Criar e começar' }));

    expect(screen.getByText('Descreva o objetivo da sessão.')).toBeTruthy();
    expect(objectiveInput().getAttribute('aria-invalid')).toBe('true');
    expect(mocks.createGoal).not.toHaveBeenCalled();
  });

  it('limita o objetivo a 4.000 caracteres', () => {
    renderDialog('create');
    fireEvent.change(objectiveInput(), { target: { value: 'a'.repeat(4_001) } });

    fireEvent.click(screen.getByRole('button', { name: 'Criar e começar' }));

    expect(screen.getByText('O objetivo deve ter no máximo 4.000 caracteres.')).toBeTruthy();
    expect(screen.getByText('4001/4000')).toBeTruthy();
    expect(mocks.createGoal).not.toHaveBeenCalled();
  });

  it('valida o limite de rodadas (1..100)', () => {
    renderDialog('create');
    fireEvent.change(objectiveInput(), { target: { value: 'Entregar o relatório' } });
    fireEvent.change(maxRoundsInput(), { target: { value: '0' } });

    fireEvent.click(screen.getByRole('button', { name: 'Criar e começar' }));

    expect(screen.getByText('Use um limite entre 1 e 100 rodadas.')).toBeTruthy();
    expect(maxRoundsInput().getAttribute('aria-invalid')).toBe('true');
    expect(mocks.createGoal).not.toHaveBeenCalled();
  });

  it('“Criar e começar” cria e inicia a primeira rodada', async () => {
    const onClose = renderDialog('create');
    fireEvent.change(titleInput(), { target: { value: 'Novo objetivo' } });
    fireEvent.change(objectiveInput(), { target: { value: 'Entregar X com testes' } });
    fireEvent.change(maxRoundsInput(), { target: { value: '10' } });

    fireEvent.click(screen.getByRole('button', { name: 'Criar e começar' }));

    await waitFor(() =>
      expect(mocks.createGoal).toHaveBeenCalledWith(CONVERSATION_ID, {
        objective: 'Entregar X com testes',
        title: 'Novo objetivo',
        maxRounds: 10,
        autoContinue: true,
      }),
    );
    await waitFor(() =>
      expect(useChatStore.getState().runGoalRound).toHaveBeenCalledWith(CONVERSATION_ID),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('“Criar sem começar” cria sem iniciar rodada', async () => {
    const onClose = renderDialog('create');
    fireEvent.change(objectiveInput(), { target: { value: 'Entregar Y' } });

    fireEvent.click(screen.getByRole('button', { name: 'Criar sem começar' }));

    await waitFor(() => expect(mocks.createGoal).toHaveBeenCalledTimes(1));
    expect(useChatStore.getState().runGoalRound).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('com turno em andamento só cria: a continuidade fica para o fim do turno', async () => {
    const onClose = renderDialog('create');
    useChatStore.setState({ streaming: streamingState() });
    fireEvent.change(objectiveInput(), { target: { value: 'Entregar Z' } });

    fireEvent.click(screen.getByRole('button', { name: 'Criar e começar' }));

    await waitFor(() => expect(mocks.createGoal).toHaveBeenCalledTimes(1));
    expect(useChatStore.getState().runGoalRound).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('com objetivo ativo mostra erro amigável e oferece editar', () => {
    seedGoal(goal());
    renderDialog('create');

    expect(screen.getByText(/Já existe um objetivo ativo nesta sessão/)).toBeTruthy();
    const createButton = screen.getByRole('button', { name: 'Criar e começar' }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Editar objetivo' }));

    expect(screen.getByRole('dialog', { name: 'Editar objetivo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeTruthy();
    expect(titleInput()).toHaveProperty('value', 'Fechar o bug');
    expect(objectiveInput()).toHaveProperty('value', 'Corrigir o cálculo de juros.');
  });

  it('avisa que criar substitui um objetivo concluído', () => {
    seedGoal(goal({ status: 'completed', autoContinue: false, rounds: 25 }));
    renderDialog('create');

    expect(screen.getByText(/O objetivo concluído será substituído pelo novo\./)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Criar e começar' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe('GoalDialog — edição', () => {
  it('preenche os campos e salva com expectedRevision', async () => {
    seedGoal(goal());
    const onClose = renderDialog('edit');

    expect(titleInput()).toHaveProperty('value', 'Fechar o bug');
    expect(objectiveInput()).toHaveProperty('value', 'Corrigir o cálculo de juros.');
    expect(maxRoundsInput()).toHaveProperty('value', '25');

    fireEvent.change(titleInput(), { target: { value: 'Novo título' } });
    fireEvent.change(objectiveInput(), { target: { value: 'Objetivo revisado' } });
    fireEvent.change(maxRoundsInput(), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(mocks.updateGoal).toHaveBeenCalledWith(
        CONVERSATION_ID,
        'edit',
        { title: 'Novo título', objective: 'Objetivo revisado', maxRounds: 40 },
        7,
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('desativar a continuidade automática também desarma o objetivo', async () => {
    seedGoal(goal());
    const onClose = renderDialog('edit');
    fireEvent.click(autoContinueSwitch());

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mocks.updateGoal).toHaveBeenCalledTimes(2));
    expect(mocks.updateGoal.mock.calls[0]?.[1]).toBe('edit');
    expect(mocks.updateGoal.mock.calls[1]?.[1]).toBe('disarm');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('zona de perigo encerra o objetivo com confirmação inline', async () => {
    seedGoal(goal());
    const onClose = renderDialog('edit');

    fireEvent.click(screen.getByRole('button', { name: 'Encerrar objetivo' }));

    expect(screen.getByText(/O histórico de rodadas é preservado/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar encerramento' }));

    await waitFor(() =>
      expect(mocks.updateGoal).toHaveBeenCalledWith(CONVERSATION_ID, 'delete', null, 7),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('GoalDialog — acessibilidade', () => {
  it('Esc fecha o diálogo', async () => {
    const onClose = renderDialog('create');

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('durante o envio desabilita as ações, marca aria-busy e ignora Esc', async () => {
    const onClose = renderDialog('create');
    let resolveCreate: (state: CodeSessionState) => void = () => {};
    mocks.createGoal.mockImplementation(
      () =>
        new Promise<CodeSessionState>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    fireEvent.change(objectiveInput(), { target: { value: 'Entregar W' } });

    fireEvent.click(screen.getByRole('button', { name: 'Criar e começar' }));

    await waitFor(() => expect(mocks.createGoal).toHaveBeenCalledTimes(1));
    const submit = screen.getByRole('button', { name: 'Criar e começar' });
    expect(submit.getAttribute('aria-busy')).toBe('true');
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveCreate(snapshot(goal()));
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
