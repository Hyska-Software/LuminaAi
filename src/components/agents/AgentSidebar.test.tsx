// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  listAgents: vi.fn(),
  listAgentChannels: vi.fn(),
  listAgentChannelInboxCounts: vi.fn(),
  listConversations: vi.fn(),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
  setConversationPinned: vi.fn(),
  exportConversation: vi.fn(),
  importAgent: vi.fn(),
  listAgentThreads: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import { emptyCodeSession, useAgentStore, useChatStore, useCodeStore, useUiStore } from '@/lib/store';
import type { Agent, AgentChannel, Conversation } from '@/lib/types';
import { AgentSidebar } from './AgentSidebar';

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
    modelId: 'glm-5.3-flash',
    reasoning: null,
    instructions: 'Seja direto.',
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
    memoryEnabled: true,
    workspaceId: null,
    permissionMode: 'edit',
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
    threadCount: 1,
    lastActiveAt: 2,
    ...overrides,
  };
}

function thread(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'thread-1',
    title: 'Planejamento',
    createdAt: 1,
    updatedAt: 2,
    pinned: false,
    providerId: 'opencode-go',
    modelId: 'glm-5.3-flash',
    messageCount: 2,
    preview: 'oi',
    mode: 'agent',
    agentId: 'agent-1',
    ...overrides,
  };
}

function channel(overrides: Partial<AgentChannel> = {}): AgentChannel {
  return {
    id: 'channel-1',
    name: 'Lançamento',
    memberIds: ['agent-1'],
    createdAt: 1,
    updatedAt: 2,
    lastMessageAt: 2,
    ...overrides,
  };
}

function openMenu(trigger: HTMLElement): void {
  fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAgentChannels.mockResolvedValue([]);
  mocks.listAgentChannelInboxCounts.mockResolvedValue([]);
  mocks.listConversations.mockResolvedValue([thread()]);
  mocks.renameConversation.mockResolvedValue(undefined);
  mocks.deleteConversation.mockResolvedValue(undefined);
  mocks.setConversationPinned.mockResolvedValue(undefined);
  mocks.exportConversation.mockResolvedValue('C:/tmp/thread.md');
  mocks.listAgents.mockResolvedValue([agent()]);
  useAgentStore.setState({
    agentsById: { 'agent-1': agent() },
    orderedIds: ['agent-1'],
    status: 'ready',
    error: null,
    mutationById: {},
    initialized: true,
  });
  useChatStore.setState({
    conversations: [thread()],
    activeId: null,
    messagesByConversation: {},
    streaming: null,
  });
  useCodeStore.setState({ byConversation: {} });
  useUiStore.setState({
    layoutMode: 'agent',
    activeAgentId: 'agent-1',
    activeChannelId: null,
    agentEditor: null,
  });
});

afterEach(() => {
  cleanup();
});

describe('AgentSidebar — thread lifecycle', () => {
  it('renames an agent thread from its menu', async () => {
    render(<AgentSidebar />);
    openMenu(await screen.findByRole('button', { name: 'Opções de Planejamento' }));
    fireEvent.click(await screen.findByText('Renomear'));
    const input = await screen.findByLabelText('Título da conversa');
    fireEvent.change(input, { target: { value: 'Planejamento Q4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(mocks.renameConversation).toHaveBeenCalledWith('thread-1', 'Planejamento Q4'),
    );
  });

  it('pins and exports a thread from the same menu', async () => {
    render(<AgentSidebar />);
    openMenu(await screen.findByRole('button', { name: 'Opções de Planejamento' }));
    fireEvent.click(await screen.findByText('Fixar'));
    await waitFor(() => expect(mocks.setConversationPinned).toHaveBeenCalledWith('thread-1', true));

    openMenu(await screen.findByRole('button', { name: 'Opções de Planejamento' }));
    fireEvent.click(await screen.findByText('Exportar'));
    await waitFor(() => expect(mocks.exportConversation).toHaveBeenCalledWith('thread-1', 'markdown'));
  });
});

describe('AgentSidebar — thread status', () => {
  it('surfaces the last turn failure on the thread row', async () => {
    useCodeStore.setState({
      byConversation: {
        'thread-1': { ...emptyCodeSession('thread-1'), error: 'falhou' },
      },
    });
    render(<AgentSidebar />);
    expect(await screen.findByLabelText('Último turno falhou')).toBeTruthy();
  });
});

describe('AgentSidebar — management and channels', () => {
  it('lists active and archived agents and imports a document', async () => {
    const archived = agent({ id: 'agent-old', name: 'Antigo', archivedAt: 9 });
    useAgentStore.setState((state) => ({
      agentsById: { ...state.agentsById, [archived.id]: archived },
      orderedIds: [...state.orderedIds, archived.id],
    }));
    mocks.importAgent.mockResolvedValue(agent({ id: 'agent-new', name: 'Importado' }));
    render(<AgentSidebar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Gerenciar agentes' }));
    expect(await screen.findByText('Ativos')).toBeTruthy();
    expect(await screen.findByText('Arquivados')).toBeTruthy();
    expect(await screen.findByText('Antigo')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Importar' }));
    await waitFor(() => expect(mocks.importAgent).toHaveBeenCalled());
  });

  it('selects a channel and exposes it in the sidebar', async () => {
    mocks.listAgentChannels.mockResolvedValue([channel()]);
    render(<AgentSidebar />);
    const rows = await screen.findAllByRole('button', { name: /Lançamento/ });
    fireEvent.click(rows[0]);
    expect(useUiStore.getState().activeChannelId).toBe('channel-1');
    expect(useUiStore.getState().activeAgentId).toBeNull();
  });
});
