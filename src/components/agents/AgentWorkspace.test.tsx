// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getAgentUsage: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('@/components/chat/ChatView', () => ({
  ChatView: () => <div data-testid="chat-view" />,
}));

import { useAgentStore, useChatStore, useUiStore } from '@/lib/store';
import type { Agent } from '@/lib/types';
import { AgentWorkspace } from './AgentWorkspace';

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAgentUsage.mockResolvedValue(null);
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
