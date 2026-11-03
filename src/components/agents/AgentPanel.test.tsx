// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  listAgentRoutines: vi.fn(),
  updateAgent: vi.fn(),
  computerPreview: vi.fn(),
  browserSessionStatus: vi.fn(),
  browserFrame: vi.fn(),
  browserTakeControl: vi.fn(),
  browserClickAt: vi.fn(),
  browserPressKey: vi.fn(),
  browserInsertText: vi.fn(),
  releaseComputerControl: vi.fn(),
  getAgentUsage: vi.fn(),
  listAgentTasks: vi.fn(),
  listComputerActions: vi.fn(),
  listAgentMemories: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { useAgentStore } from '@/lib/store';
import type { Agent, AgentInput } from '@/lib/types';
import { AgentPanelBrowser } from './AgentPanelBrowser';
import { AgentPanelData } from './AgentPanelData';
import { AgentPanelScreen } from './AgentPanelScreen';

const agent: Agent = {
  id: 'agent-1',
  name: 'Irineu',
  role: 'Engenheiro',
  description: '',
  emoji: '🛠️',
  department: 'Engenharia',
  pinned: false,
  sortOrder: 1,
  providerId: 'opencode-go',
  modelId: 'deepseek-v4.1-flash',
  reasoning: null,
  instructions: '',
  promptVersion: 1,
  starters: [],
  capabilities: {
    webSearch: true,
    fileAccess: true,
    codeExecution: true,
    delegation: false,
    computerUse: true,
    screenCapture: false,
    browserUse: false,
    dockerExecution: false,
    skills: null,
    tools: null,
    mcpServers: null,
  },
  memoryEnabled: false,
  workspaceId: null,
  permissionMode: 'edit',
  dockerImage: null,
  computerEnvironment: 'auto',
  archivedAt: null,
  createdAt: 1,
  updatedAt: 1,
  threadCount: 0,
  lastActiveAt: null,
};

const context = {
  agent,
  conversation: null,
  openThread: vi.fn(),
  onEdit: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAgentRoutines.mockResolvedValue([]);
  mocks.getAgentUsage.mockResolvedValue(null);
  mocks.listAgentTasks.mockResolvedValue([]);
  mocks.listComputerActions.mockResolvedValue([]);
  mocks.listAgentMemories.mockResolvedValue([]);
  mocks.browserSessionStatus.mockResolvedValue({
    running: false,
    port: null,
    executable: null,
    profileDir: null,
    downloadDir: null,
    tabs: [],
    activeTab: null,
  });
  mocks.browserFrame.mockResolvedValue(null);
  mocks.browserTakeControl.mockResolvedValue({ kind: 'browser', url: null });
  mocks.browserClickAt.mockResolvedValue(undefined);
  mocks.browserPressKey.mockResolvedValue(undefined);
  mocks.browserInsertText.mockResolvedValue(undefined);
  mocks.releaseComputerControl.mockResolvedValue(undefined);
  mocks.updateAgent.mockImplementation(async (_id: string, input: AgentInput) => ({
    ...agent,
    ...input,
    capabilities: input.capabilities,
    computerEnvironment: input.computerEnvironment ?? 'auto',
  }));
  useAgentStore.setState({
    agentsById: { [agent.id]: agent },
    orderedIds: [agent.id],
    status: 'ready',
    initialized: true,
  });
});

afterEach(() => cleanup());

describe('AgentPanel — Tela', () => {
  it('mostra os ambientes e mantém a nuvem desabilitada como Em breve', async () => {
    render(<AgentPanelScreen context={context} />);

    expect(await screen.findByText('Tela de Irineu')).toBeTruthy();
    expect(screen.getByText('Trabalha em')).toBeTruthy();
    expect(screen.getAllByText('Automático').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Este computador').length).toBeGreaterThan(0);
    expect(screen.getByText('Desktop na nuvem')).toBeTruthy();
    expect(screen.getByText('Em breve')).toBeTruthy();
    const cloud = screen.getByText('Desktop na nuvem').closest('button');
    expect(cloud?.disabled).toBe(true);
    expect(screen.getByText('Abra uma conversa com Irineu para ver o desktop.')).toBeTruthy();
  });

  it('salva o ambiente e liga a capability com confirmação', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AgentPanelScreen context={context} />);

    fireEvent.click(screen.getByText('Este computador').closest('button')!);

    await waitFor(() =>
      expect(mocks.updateAgent).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          computerEnvironment: 'this_computer',
          capabilities: expect.objectContaining({ computerUse: true }),
        }),
      ),
    );
  });
});

describe('AgentPanel — Navegador', () => {
  it('ativa browserUse pelo switch', async () => {
    render(<AgentPanelBrowser context={context} />);

    const toggle = await screen.findByLabelText('Deixar Irineu usar um navegador');
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(mocks.updateAgent).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          capabilities: expect.objectContaining({ browserUse: true }),
        }),
      ),
    );
  });

  it('encaminha clique do preview quando o humano assume o controle', async () => {
    const browserAgent: Agent = {
      ...agent,
      capabilities: { ...agent.capabilities, browserUse: true },
    };
    useAgentStore.setState({
      agentsById: { [browserAgent.id]: browserAgent },
      orderedIds: [browserAgent.id],
    });
    mocks.browserSessionStatus.mockResolvedValue({
      running: true,
      port: 9222,
      executable: 'msedge.exe',
      profileDir: 'C:/app/browser/conv-1',
      downloadDir: 'C:/app/downloads',
      tabs: [{ id: 'tab-1', title: 'Exemplo', url: 'https://example.com', active: true }],
      activeTab: 'tab-1',
    });
    mocks.browserFrame.mockResolvedValue({
      dataUrl: 'data:image/jpeg;base64,abc',
      url: 'https://example.com',
      title: 'Exemplo',
      width: 1280,
      height: 820,
      capturedAt: 1,
    });
    mocks.browserTakeControl.mockResolvedValue({ kind: 'browser', url: null });
    render(
      <AgentPanelBrowser
        context={{ ...context, agent: browserAgent, conversation: { id: 'conv-1' } as never }}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Assumir o controle/i }));
    await waitFor(() => expect(mocks.browserTakeControl).toHaveBeenCalledWith('conv-1'));
    const image = await screen.findByAltText(/Página controlada por Irineu/);
    Object.defineProperty(image, 'getBoundingClientRect', {
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 1280,
        bottom: 820,
        width: 1280,
        height: 820,
        toJSON: () => ({}),
      }),
    });
    fireEvent.click(image, { clientX: 100, clientY: 120 });
    await waitFor(() =>
      expect(mocks.browserClickAt).toHaveBeenCalledWith('conv-1', 100, 120, 'tab-1'),
    );
  });
});

describe('AgentPanel — Dados', () => {
  it('mostra uso, tarefas e capacidades do agente', async () => {
    mocks.getAgentUsage.mockResolvedValue({
      agentId: 'agent-1',
      turns: 4,
      inputTokens: 1000,
      outputTokens: 500,
      reasoningTokens: 0,
      totalTokens: 1500,
      cost: 0.25,
      lastUsedAt: Date.now(),
    });
    mocks.listAgentTasks.mockResolvedValue([
      {
        id: 'task-1',
        channelId: null,
        parentTaskId: null,
        ownerAgentId: 'agent-1',
        createdByAgentId: null,
        createdByUser: true,
        title: 'Revisar',
        brief: 'Leia.',
        acceptance: '',
        status: 'waiting_input',
        priority: 0,
        maxTurns: 4,
        maxTokens: 1000,
        maxCost: 0.5,
        deadlineAt: null,
        conversationId: null,
        result: null,
        resultArtifactIds: [],
        leaseUntil: null,
        handoffCount: 0,
        version: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    render(<AgentPanelData context={context} />);

    expect(await screen.findByText('Uso')).toBeTruthy();
    expect(screen.getAllByText('Tarefas').length).toBeGreaterThan(0);
    expect(await screen.findByText('1 aberta(s) de 1')).toBeTruthy();
    expect(screen.getByText('Computador')).toBeTruthy();
  });
});
