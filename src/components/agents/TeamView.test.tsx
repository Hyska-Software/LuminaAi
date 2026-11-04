// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  listAgentUsage: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { useAgentStore, useAppStore, useChatStore, useUiStore } from '@/lib/store';
import type { Agent } from '@/lib/types';
import { TeamView } from './TeamView';

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
});
