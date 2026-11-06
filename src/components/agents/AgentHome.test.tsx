// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getAgentUsage: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('@/components/chat/ChatView', () => ({
  ChatView: ({ welcome }: { welcome?: ReactNode }) => <div>{welcome}</div>,
}));

import { useAgentStore, useAppStore, useChatStore, useUiStore } from '@/lib/store';
import type { Agent, Conversation } from '@/lib/types';
import { AgentHome } from './AgentHome';

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
  lastActiveAt: null,
};

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'thread',
    title: 'Conversa',
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    providerId: 'opencode-go',
    modelId: 'deepseek-v4.1-flash',
    messageCount: 0,
    mode: 'agent',
    agentId: 'agent-1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAgentUsage.mockResolvedValue(null);
  useAgentStore.setState({
    agentsById: { 'agent-1': agent },
    orderedIds: ['agent-1'],
    status: 'ready',
    error: null,
    mutationById: {},
    initialized: true,
  });
  useAppStore.setState({ providers: [] });
  useUiStore.setState({ agentEditor: null, agentAvatarEditor: null });
});

afterEach(() => cleanup());

describe('AgentHome — primary conversation', () => {
  it('keeps the primary out of recents and opens it from the dedicated button', async () => {
    const openConversation = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      conversations: [
        conversation({ id: 'normal', title: 'Outra', updatedAt: 99 }),
        conversation({ id: 'main', title: 'Principal', isMain: true, pinned: true }),
      ],
      activeId: null,
      messagesByConversation: {},
      streamsByConversation: {},
      streaming: null,
      openConversation,
    });

    render(<AgentHome agent={agent} />);

    expect(await screen.findByText('Outra')).toBeTruthy();
    expect(screen.queryByText('Principal')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir conversa principal' }));
    expect(openConversation).toHaveBeenCalledWith('main');
  });
});
