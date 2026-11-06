// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getAgentUsage: vi.fn(),
  getUsageStats: vi.fn(),
  listAllAgentRoutines: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('@/components/chat/ChatView', () => ({
  ChatView: () => <div data-testid="chat-view" />,
}));

import { useAgentStore, useChatStore, useUiStore } from '@/lib/store';
import type { Agent, UsageStats } from '@/lib/types';
import { AgentWorkspace } from './AgentWorkspace';

const agent: Agent = {
  id: 'agent-1',
  name: 'Irineu',
  role: 'Engenheiro',
  description: '',
  avatar: { kind: 'emoji', value: '🛠️', shape: 'rounded' },
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
    computerUse: false,
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

const emptyStats: UsageStats = {
  totals: {
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    cost: 0,
    lastUsedAt: null,
  },
  byModel: [],
  byDay: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAgentUsage.mockResolvedValue(null);
  mocks.getUsageStats.mockResolvedValue(emptyStats);
  mocks.listAllAgentRoutines.mockResolvedValue([]);
  useAgentStore.setState({
    agentsById: { [agent.id]: agent },
    orderedIds: [agent.id],
    status: 'ready',
    error: null,
    mutationById: {},
    initialized: true,
  });
  useChatStore.setState({
    conversations: [],
    activeId: null,
    messagesByConversation: {},
    streaming: null,
  });
  useUiStore.setState({
    layoutMode: 'agent',
    activeAgentId: agent.id,
    activeChannelId: null,
    agentView: 'team',
    agentEditor: null,
    agentPanelOpen: false,
    agentRightPanel: 'agent',
  });
});

afterEach(() => cleanup());

describe('AgentWorkspace — right panel', () => {
  it('offers a reopen control on the agent home when the panel is closed', async () => {
    render(<AgentWorkspace />);

    fireEvent.click(await screen.findByRole('button', { name: 'Abrir painel do agente' }));

    expect(useUiStore.getState().agentPanelOpen).toBe(true);
    expect(screen.queryByRole('button', { name: 'Abrir painel do agente' })).toBeNull();
  });

  it('keeps the reopen control on an archived agent home', async () => {
    useAgentStore.setState({
      agentsById: { [agent.id]: { ...agent, archivedAt: 2 } },
      orderedIds: [agent.id],
    });
    render(<AgentWorkspace />);

    expect(await screen.findByRole('button', { name: /Restaurar agente/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir painel do agente' })).toBeTruthy();
  });
});

describe('AgentWorkspace — stats page', () => {
  it('renders the stats surface when no agent is selected', async () => {
    useUiStore.setState({ activeAgentId: null, activeChannelId: null, agentView: 'stats' });
    render(<AgentWorkspace />);

    expect(await screen.findByRole('heading', { name: 'Estatísticas' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Voltar à Equipe' })).toBeTruthy();
  });
});

describe('AgentWorkspace — routines page', () => {
  it('renders the central routines surface when no agent is selected', async () => {
    useUiStore.setState({
      activeAgentId: null,
      activeChannelId: null,
      agentView: 'routines',
      agentRoutinesAgentId: null,
    });
    render(<AgentWorkspace />);

    expect(await screen.findByRole('heading', { name: 'Rotinas' })).toBeTruthy();
    expect(await screen.findByText('Nenhuma rotina para este filtro.')).toBeTruthy();
    expect(mocks.listAllAgentRoutines).toHaveBeenCalled();
  });
});
