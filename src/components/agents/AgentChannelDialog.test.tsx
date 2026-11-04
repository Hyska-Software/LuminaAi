// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAgentChannel: vi.fn(),
  updateAgentChannel: vi.fn(),
  deleteAgentChannel: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { useAgentStore } from '@/lib/store';
import type { Agent, AgentChannel } from '@/lib/types';
import { AgentChannelDialog } from './AgentChannelDialog';

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
  mocks.updateAgentChannel.mockImplementation(async (_id: string, input: Partial<AgentChannel>) => ({
    ...channel,
    ...input,
  }));
  useAgentStore.setState({
    agentsById: { 'agent-1': agent('agent-1', 'Ana'), 'agent-2': agent('agent-2', 'Bia') },
    orderedIds: ['agent-1', 'agent-2'],
    status: 'ready',
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AgentChannelDialog — leader', () => {
  it('salva o líder escolhido', async () => {
    render(
      <AgentChannelDialog
        channel={channel}
        open
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Líder/));
    fireEvent.click(await screen.findByRole('option', { name: 'Bia' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar canal' }));

    await waitFor(() =>
      expect(mocks.updateAgentChannel).toHaveBeenCalledWith('channel-1', {
        name: 'Lançamento',
        memberIds: ['agent-1', 'agent-2'],
        leaderAgentId: 'agent-2',
      }),
    );
  });

  it('remove o líder quando ele deixa de ser participante', async () => {
    render(
      <AgentChannelDialog
        channel={channel}
        open
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Líder/));
    fireEvent.click(await screen.findByRole('option', { name: 'Bia' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bia' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar canal' }));

    await waitFor(() =>
      expect(mocks.updateAgentChannel).toHaveBeenCalledWith('channel-1', {
        name: 'Lançamento',
        memberIds: ['agent-1'],
        leaderAgentId: null,
      }),
    );
  });
});
