// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAgentChannels: vi.fn(),
  listAgentChannelMessages: vi.fn(),
  postAgentChannelMessage: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { useAgentStore, useUiStore } from '@/lib/store';
import type { Agent, AgentChannel } from '@/lib/types';
import { AgentChannelView } from './AgentChannelView';

const channel: AgentChannel = {
  id: 'channel-1',
  name: 'Lançamento',
  kind: 'channel',
  memberIds: ['agent-1', 'agent-2'],
  createdAt: 1,
  updatedAt: 1,
  lastMessageAt: null,
};

function agent(id: string, name: string): Agent {
  return {
    id,
    name,
    role: '',
    description: '',
    avatar: { kind: 'emoji', value: '🤖', shape: 'rounded' },
    department: 'Geral',
    pinned: false,
    sortOrder: 0,
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
    memoryRevision: 0,
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
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAgentChannels.mockResolvedValue([channel]);
  mocks.listAgentChannelMessages.mockResolvedValue([]);
  mocks.postAgentChannelMessage.mockResolvedValue({ messages: [], errors: [] });
  useAgentStore.setState({
    agentsById: { 'agent-1': agent('agent-1', 'Ana'), 'agent-2': agent('agent-2', 'Bia') },
    orderedIds: ['agent-1', 'agent-2'],
    status: 'ready',
    error: null,
  });
  useUiStore.setState({ activeChannelId: 'channel-1' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AgentChannelView mention picker', () => {
  it('sugere membros ao digitar @ e insere a menção', async () => {
    render(<AgentChannelView channelId="channel-1" onBack={() => {}} onEdit={() => {}} />);
    const composer = await screen.findByLabelText('Mensagem para o canal Lançamento');
    fireEvent.change(composer, { target: { value: 'oi @Bi' } });
    const option = await screen.findByRole('button', { name: 'Mencionar Bia' });
    fireEvent.mouseDown(option);
    await waitFor(() =>
      expect((composer as HTMLTextAreaElement).value).toBe('oi @Bia '),
    );
  });

  it('não mostra composer em uma conversa direta', async () => {
    mocks.listAgentChannels.mockResolvedValue([{ ...channel, kind: 'dm', name: 'DM · Ana ↔ Bia' }]);
    render(<AgentChannelView channelId="channel-1" onBack={() => {}} onEdit={() => {}} />);
    expect(await screen.findByText(/Conversa direta entre agentes/)).toBeTruthy();
    expect(screen.queryByLabelText(/Mensagem para o canal/)).toBeNull();
  });
});
