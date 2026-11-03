// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  listActiveComputerSessions: vi.fn(),
  stopComputerSession: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./AgentConversationWorkspace', () => ({
  AgentConversationWorkspace: () => null,
}));

import { AgentThreadHeader } from './AgentThreadHeader';
import { useAppStore, useChatStore, useUiStore } from '@/lib/store';
import type { Agent, Conversation } from '@/lib/types';

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
  threadCount: 1,
  lastActiveAt: 1,
};

const conversation: Conversation = {
  id: 'conv-1',
  title: 'Thread',
  createdAt: 1,
  updatedAt: 1,
  pinned: false,
  providerId: 'opencode-go',
  modelId: 'deepseek-v4.1-flash',
  messageCount: 1,
  mode: 'agent',
  agentId: 'agent-1',
  workspaceId: null,
};

describe('AgentThreadHeader', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listActiveComputerSessions.mockResolvedValue([
      {
        id: 'session-1',
        agentId: 'agent-1',
        conversationId: 'conv-1',
        backend: 'local',
        status: 'active',
        startedAt: 1,
        endedAt: null,
      },
    ]);
    mocks.stopComputerSession.mockResolvedValue(undefined);
    useAppStore.setState({ providers: [] });
    useChatStore.setState({ streamsByConversation: {} });
    useUiStore.setState({
      agentPanelOpen: false,
      agentRightPanel: 'agent',
      codePanelOpen: false,
    });
  });
  afterEach(cleanup);

  it('renders the computer-use status inside the agent thread topbar', async () => {
    render(<AgentThreadHeader agent={agent} conversation={conversation} onBack={vi.fn()} />);

    const status = await screen.findByRole('group', { name: 'Computer use ativo' });
    expect(status.closest('header')).not.toBeNull();
    expect(screen.getByText('Irineu')).toBeTruthy();
  });
});
