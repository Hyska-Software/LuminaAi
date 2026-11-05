// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  listAllAgentRoutines: vi.fn(),
  createAgentRoutine: vi.fn(),
  updateAgentRoutine: vi.fn(),
  setAgentRoutineEnabled: vi.fn(),
  deleteAgentRoutine: vi.fn(),
  runAgentRoutineNow: vi.fn(),
  listAgentRoutineRuns: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import { useAgentStore, useChatStore, useUiStore } from '@/lib/store';
import type { Agent, AgentRoutine, AgentRoutineInput } from '@/lib/types';
import { AgentRoutinesView } from './AgentRoutinesView';

const NOW = new Date(2026, 10, 5, 10, 0, 0).getTime();

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'Irineu',
    role: 'Engenheiro',
    description: 'Backend.',
    avatar: { kind: 'emoji', value: '🛠️', shape: 'rounded' },
    department: 'Engenharia',
    pinned: false,
    sortOrder: 1,
    providerId: 'opencode-go',
    modelId: 'deepseek-v4.1-flash',
    reasoning: null,
    instructions: 'Seja direto.',
    promptVersion: 1,
    starters: [],
    capabilities: {
      webSearch: true,
      fileAccess: true,
      codeExecution: true,
      delegation: false,
      computerUse: false,
      screenCapture: false,
      browserUse: false,
      dockerExecution: false,
      skills: null,
      tools: null,
      mcpServers: null,
    },
    memoryEnabled: true,
    workspaceId: null,
    permissionMode: 'edit',
    dockerImage: null,
    computerEnvironment: 'auto',
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
    threadCount: 0,
    lastActiveAt: null,
    ...overrides,
  };
}

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
    nextRunAt: NOW + 3_600_000,
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

const first = agent();
const second = agent({ id: 'agent-2', name: 'Bia', role: 'Analista' });
const firstRoutine = routine();
const secondRoutine = routine({
  id: 'routine-2',
  agentId: 'agent-2',
  title: 'Resumo semanal',
  hour: 18,
  lastStatus: 'ok',
});

function openMenu(trigger: HTMLElement): void {
  fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  mocks.listAllAgentRoutines.mockResolvedValue([firstRoutine, secondRoutine]);
  mocks.listAgentRoutineRuns.mockResolvedValue([]);
  mocks.deleteAgentRoutine.mockResolvedValue(undefined);
  mocks.setAgentRoutineEnabled.mockImplementation(
    async (id: string, enabled: boolean) => ({
      ...(id === secondRoutine.id ? secondRoutine : firstRoutine),
      enabled,
    }),
  );
  mocks.runAgentRoutineNow.mockImplementation(async (id: string) => ({
    ...(id === secondRoutine.id ? secondRoutine : firstRoutine),
    lastStatus: 'ok',
  }));
  mocks.createAgentRoutine.mockImplementation(
    async (agentId: string, input: AgentRoutineInput) => ({
      ...routine({ id: 'routine-new', agentId }),
      ...input,
    }),
  );
  mocks.updateAgentRoutine.mockImplementation(
    async (id: string, input: AgentRoutineInput) => ({
      ...routine({ id }),
      ...input,
    }),
  );

  useAgentStore.setState({
    agentsById: { [first.id]: first, [second.id]: second },
    orderedIds: [first.id, second.id],
    status: 'ready',
    error: null,
    mutationById: {},
    initialized: true,
  });
  useChatStore.setState({
    conversations: [],
    activeId: null,
    messagesByConversation: {},
    streamsByConversation: {},
    streaming: null,
  });
  useUiStore.setState({
    layoutMode: 'agent',
    activeAgentId: null,
    activeChannelId: null,
    agentView: 'routines',
    agentRoutinesAgentId: null,
    agentEditor: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AgentRoutinesView — calendar and filters', () => {
  it('renders the controls and both agents routines', async () => {
    render(<AgentRoutinesView />);

    expect(await screen.findByRole('heading', { name: 'Rotinas' })).toBeTruthy();
    expect(screen.getByLabelText('Filtrar rotinas por agente')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Mês' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(
      await screen.findByRole('button', {
        name: 'Editar rotina Verificação de caixa de entrada',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Editar rotina Resumo semanal' }),
    ).toBeTruthy();
  });

  it('switches the calendar view and filters by agent', async () => {
    render(<AgentRoutinesView />);
    await screen.findByRole('button', {
      name: 'Editar rotina Verificação de caixa de entrada',
    });

    fireEvent.click(screen.getByRole('radio', { name: 'Semana' }));
    expect(screen.getByRole('radio', { name: 'Semana' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Mês' }).getAttribute('aria-checked')).toBe(
      'false',
    );

    fireEvent.change(screen.getByLabelText('Filtrar rotinas por agente'), {
      target: { value: 'agent-2' },
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('button', {
          name: 'Editar rotina Verificação de caixa de entrada',
        }),
      ).toBeNull(),
    );
    expect(
      screen.getByRole('button', { name: 'Editar rotina Resumo semanal' }),
    ).toBeTruthy();
  });
});

describe('AgentRoutinesView — create and edit', () => {
  it('creates a routine with the initial agent and default weekdays', async () => {
    render(<AgentRoutinesView />);
    await screen.findByRole('button', {
      name: 'Editar rotina Verificação de caixa de entrada',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Nova rotina' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Título'), {
      target: { value: 'Nova coleta' },
    });
    fireEvent.change(within(dialog).getByLabelText('Instrução'), {
      target: { value: 'Colete as novidades.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar rotina' }));

    await waitFor(() =>
      expect(mocks.createAgentRoutine).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          title: 'Nova coleta',
          prompt: 'Colete as novidades.',
          daysOfWeek: 127,
        }),
      ),
    );
    expect(
      await screen.findByRole('button', { name: 'Editar rotina Nova coleta' }),
    ).toBeTruthy();
  });

  it('sends the updated weekday mask when a day is removed', async () => {
    render(<AgentRoutinesView />);
    await screen.findByRole('button', {
      name: 'Editar rotina Verificação de caixa de entrada',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Nova rotina' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Frequência'), {
      target: { value: 'daily' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Segunda-feira' }));
    fireEvent.change(within(dialog).getByLabelText('Título'), {
      target: { value: 'Sem segunda' },
    });
    fireEvent.change(within(dialog).getByLabelText('Instrução'), {
      target: { value: 'Rode nos outros dias.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar rotina' }));

    await waitFor(() =>
      expect(mocks.createAgentRoutine).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({ daysOfWeek: 126 }),
      ),
    );
  });

  it('blocks a daily routine with no weekday selected', async () => {
    render(<AgentRoutinesView />);
    await screen.findByRole('button', {
      name: 'Editar rotina Verificação de caixa de entrada',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Nova rotina' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Frequência'), {
      target: { value: 'daily' },
    });
    for (const label of [
      'Segunda-feira',
      'Terça-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado',
      'Domingo',
    ]) {
      fireEvent.click(within(dialog).getByRole('button', { name: label }));
    }
    fireEvent.change(within(dialog).getByLabelText('Título'), {
      target: { value: 'Sem dias' },
    });
    fireEvent.change(within(dialog).getByLabelText('Instrução'), {
      target: { value: 'Nunca deve salvar.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar rotina' }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'Escolha ao menos um dia.',
    );
    expect(mocks.createAgentRoutine).not.toHaveBeenCalled();
  });
});

describe('AgentRoutinesView — management actions', () => {
  it('toggles, runs, opens the log and deletes a routine', async () => {
    render(<AgentRoutinesView />);
    await screen.findByRole('button', {
      name: 'Editar rotina Verificação de caixa de entrada',
    });

    fireEvent.click(
      screen.getByLabelText('Pausar rotina Verificação de caixa de entrada'),
    );
    await waitFor(() =>
      expect(mocks.setAgentRoutineEnabled).toHaveBeenCalledWith('routine-1', false),
    );

    openMenu(
      screen.getByRole('button', {
        name: 'Ações da rotina Verificação de caixa de entrada',
      }),
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Executar agora' }));
    await waitFor(() =>
      expect(mocks.runAgentRoutineNow).toHaveBeenCalledWith('routine-1'),
    );

    openMenu(
      screen.getByRole('button', {
        name: 'Ações da rotina Verificação de caixa de entrada',
      }),
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Execuções' }));
    await waitFor(() =>
      expect(mocks.listAgentRoutineRuns).toHaveBeenCalledWith('routine-1', 30),
    );
    expect(await screen.findByText('Nenhuma execução registrada.')).toBeTruthy();
    const runsDialog = screen.getByRole('dialog');
    fireEvent.click(
      within(runsDialog).getAllByRole('button', { name: 'Fechar' }).at(-1)!,
    );

    openMenu(
      screen.getByRole('button', {
        name: 'Ações da rotina Verificação de caixa de entrada',
      }),
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Excluir' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    await waitFor(() =>
      expect(mocks.deleteAgentRoutine).toHaveBeenCalledWith('routine-1'),
    );
  });
});
