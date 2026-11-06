// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  listAgentUsage: vi.fn(),
  archiveAgent: vi.fn(),
  restoreAgent: vi.fn(),
  deleteAgent: vi.fn(),
  importAgent: vi.fn(),
  listAgents: vi.fn(),
  listConversations: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { useAgentStore, useAppStore, useChatStore, useUiStore } from '@/lib/store';
import type { Agent, Conversation } from '@/lib/types';
import { TeamView } from './TeamView';

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    title: 'Conversa',
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    providerId: 'opencode-go',
    modelId: 'glm-5.3-flash',
    messageCount: 0,
    mode: 'agent',
    agentId: 'agent-old',
    ...overrides,
  };
}

const agent: Agent = {
  id: 'agent-1',
  name: 'Irineu',
  role: 'Engenheiro',
  description: 'Cuida do backend.',
  avatar: { kind: 'emoji', value: '🛠️', shape: 'rounded' },
  department: 'Engenharia',
  pinned: false,
  sortOrder: 1,
  providerId: 'opencode-go',
  modelId: 'glm-5.3-flash',
  reasoning: null,
  instructions: '',
  promptVersion: 1,
  starters: [],
  capabilities: {
    webSearch: true,
    fileAccess: true,
    codeExecution: true,
    skills: null,
    tools: null,
    mcpServers: null,
  },
  memoryEnabled: false,
  workspaceId: null,
  permissionMode: 'edit',
  archivedAt: null,
  createdAt: 1,
  updatedAt: 1,
  threadCount: 2,
  lastActiveAt: Date.now(),
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listConversations.mockResolvedValue([]);
  mocks.listAgentUsage.mockResolvedValue([
    {
      agentId: 'agent-1',
      turns: 3,
      inputTokens: 10_000,
      outputTokens: 2_000,
      reasoningTokens: 345,
      totalTokens: 12_345,
      cost: 0.5,
      lastUsedAt: 1,
    },
  ]);
  useAgentStore.setState({
    agentsById: { 'agent-1': agent },
    orderedIds: ['agent-1'],
    status: 'ready',
    error: null,
    mutationById: {},
    initialized: true,
  });
  useAppStore.setState({ providers: [], selection: { providerId: '', modelId: '', reasoning: null } });
  useChatStore.setState({ conversations: [], activeId: null, streaming: null });
  useUiStore.setState({
    layoutMode: 'agent',
    activeAgentId: 'agent-1',
    activeChannelId: null,
    agentView: 'team',
    agentEditor: null,
  });
});

describe('TeamView — per-agent usage', () => {
  it('shows tokens and cost aggregated for each agent', async () => {
    render(<TeamView />);
    expect(await screen.findByText(/12,3 mil tokens/)).toBeTruthy();
    expect(screen.getByText(/US\$ 0,50/)).toBeTruthy();
    expect(mocks.listAgentUsage).toHaveBeenCalled();
  });

  it('opens the stats page from the team header', async () => {
    render(<TeamView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Estatísticas' }));
    expect(useUiStore.getState().agentView).toBe('stats');
  });
});

describe('TeamView — agent lifecycle', () => {
  function archivedAgent(overrides: Partial<Agent> = {}): Agent {
    return {
      ...agent,
      id: 'agent-old',
      name: 'Antigo',
      archivedAt: 9,
      threadCount: 0,
      ...overrides,
    };
  }

  function addArchived(next: Agent) {
    useAgentStore.setState((state) => ({
      agentsById: { ...state.agentsById, [next.id]: next },
      orderedIds: [...state.orderedIds, next.id],
    }));
  }

  it('arquiva um agente pelo card com opção de desfazer', async () => {
    mocks.archiveAgent.mockResolvedValue({ ...agent, archivedAt: 9 });
    render(<TeamView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Arquivar agente Irineu' }));
    await waitFor(() => expect(mocks.archiveAgent).toHaveBeenCalledWith('agent-1'));
    expect(await screen.findByText('Arquivados')).toBeTruthy();
  });

  it('restaura um agente arquivado', async () => {
    const archived = archivedAgent();
    addArchived(archived);
    mocks.restoreAgent.mockResolvedValue({ ...archived, archivedAt: null });
    render(<TeamView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar' }));
    await waitFor(() => expect(mocks.restoreAgent).toHaveBeenCalledWith('agent-old'));
  });

  it('exclui um agente arquivado sem conversas após confirmação', async () => {
    addArchived(archivedAgent({ threadCount: 1 }));
    useChatStore.setState({
      conversations: [conversation({ id: 'old-main', isMain: true, pinned: true })],
      activeId: null,
      streaming: null,
    });
    mocks.deleteAgent.mockResolvedValue(undefined);
    render(<TeamView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/será removido permanentemente/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(mocks.deleteAgent).toHaveBeenCalledWith('agent-old'));
  });

  it('bloqueia a exclusão enquanto o agente tem conversas', async () => {
    addArchived(archivedAgent({ threadCount: 2 }));
    useChatStore.setState({
      conversations: [
        conversation({ id: 'old-main', isMain: true, pinned: true }),
        conversation({ id: 'old-extra' }),
      ],
      activeId: null,
      streaming: null,
    });
    render(<TeamView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('button', { name: 'Excluir' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('importa um agente pela página da Equipe', async () => {
    mocks.importAgent.mockResolvedValue({ ...agent, id: 'agent-new', name: 'Importado' });
    mocks.listAgents.mockResolvedValue([agent]);
    render(<TeamView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Importar' }));
    await waitFor(() => expect(mocks.importAgent).toHaveBeenCalled());
    await waitFor(() => expect(useUiStore.getState().activeAgentId).toBe('agent-new'));
  });

  it('mantém os arquivados acessíveis quando não há agentes ativos', async () => {
    useAgentStore.setState({
      agentsById: { 'agent-old': archivedAgent() },
      orderedIds: ['agent-old'],
    });
    render(<TeamView />);
    expect(screen.getByText('Monte sua equipe')).toBeTruthy();
    expect(screen.getByText('Arquivados')).toBeTruthy();
    expect(screen.getByText('Antigo')).toBeTruthy();
  });
});
