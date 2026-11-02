import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent, AgentInput } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  listAgents: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  setAgentPinned: vi.fn(),
  archiveAgent: vi.fn(),
  restoreAgent: vi.fn(),
  deleteAgent: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));

import {
  selectActiveAgents,
  selectAgentsByDepartment,
  selectArchivedAgents,
  selectPinnedAgents,
  useAgentStore,
} from '@/lib/store/agentStore';

const input: AgentInput = {
  name: 'Irineu',
  role: 'Engenheiro',
  description: 'Backend.',
  emoji: '🛠️',
  department: 'Engenharia',
  providerId: 'opencode-go',
  modelId: 'glm-5.3-flash',
  reasoning: null,
  instructions: 'Seja direto.',
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
};

const agent = (overrides: Partial<Agent> = {}): Agent => ({
  id: 'agent-1',
  name: 'Irineu',
  role: 'Engenheiro',
  description: 'Backend.',
  emoji: '🛠️',
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
  memoryEnabled: false,
  workspaceId: null,
  permissionMode: 'edit',
  archivedAt: null,
  createdAt: 1,
  updatedAt: 1,
  threadCount: 0,
  lastActiveAt: null,
  ...overrides,
});

function seed(agents: Agent[]) {
  useAgentStore.setState({
    agentsById: Object.fromEntries(agents.map((entry) => [entry.id, entry])),
    orderedIds: agents.map((entry) => entry.id),
    status: 'ready',
    error: null,
    mutationById: {},
    initialized: true,
  });
}

beforeEach(() => {
  mocks.listAgents.mockReset();
  mocks.createAgent.mockReset();
  mocks.updateAgent.mockReset();
  mocks.setAgentPinned.mockReset();
  mocks.archiveAgent.mockReset();
  mocks.restoreAgent.mockReset();
  mocks.deleteAgent.mockReset();
});

describe('agentStore', () => {
  it('initializes once, keeps archived agents and sorts pinned first', async () => {
    mocks.listAgents.mockResolvedValue([
      agent({ id: 'b', name: 'Bia', department: 'Qualidade', sortOrder: 2 }),
      agent({ id: 'a', name: 'Ana', pinned: true, sortOrder: 9 }),
      agent({ id: 'c', name: 'Caio', archivedAt: 4 }),
    ]);
    await useAgentStore.getState().initialize();
    // A second mount must not hit the backend again.
    await useAgentStore.getState().initialize();
    expect(mocks.listAgents).toHaveBeenCalledTimes(1);

    const state = useAgentStore.getState();
    expect(state.orderedIds).toEqual(['a', 'c', 'b']);
    expect(selectActiveAgents(state).map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(selectPinnedAgents(state).map((entry) => entry.id)).toEqual(['a']);
    expect(selectArchivedAgents(state).map((entry) => entry.id)).toEqual(['c']);
    expect(selectAgentsByDepartment(state).map((group) => group.department)).toEqual([
      'Engenharia',
      'Qualidade',
    ]);
  });

  it('creates, updates, pins, archives and restores without fake optimistic rows', async () => {
    seed([]);
    mocks.createAgent.mockResolvedValue(agent());
    const created = await useAgentStore.getState().create(input);
    expect(created.name).toBe('Irineu');
    expect(useAgentStore.getState().agentsById['agent-1']).toBeTruthy();

    mocks.updateAgent.mockResolvedValue(agent({ name: 'Irineu 2', promptVersion: 2 }));
    await useAgentStore.getState().update('agent-1', { ...input, name: 'Irineu 2' });
    expect(useAgentStore.getState().agentsById['agent-1'].promptVersion).toBe(2);

    mocks.setAgentPinned.mockResolvedValue(agent({ pinned: true }));
    await useAgentStore.getState().pin('agent-1', true);
    expect(useAgentStore.getState().agentsById['agent-1'].pinned).toBe(true);

    mocks.archiveAgent.mockResolvedValue(agent({ archivedAt: 2 }));
    await useAgentStore.getState().archive('agent-1');
    expect(selectActiveAgents(useAgentStore.getState())).toHaveLength(0);

    mocks.restoreAgent.mockResolvedValue(agent());
    await useAgentStore.getState().restore('agent-1');
    expect(selectActiveAgents(useAgentStore.getState())).toHaveLength(1);

    mocks.deleteAgent.mockResolvedValue(undefined);
    await useAgentStore.getState().remove('agent-1');
    expect(useAgentStore.getState().agentsById['agent-1']).toBeUndefined();
  });

  it('keeps the previous state when a mutation fails', async () => {
    seed([agent()]);
    mocks.archiveAgent.mockRejectedValue(new Error('backend offline'));
    await expect(useAgentStore.getState().archive('agent-1')).rejects.toThrow('backend offline');
    expect(useAgentStore.getState().agentsById['agent-1'].archivedAt).toBeNull();
    expect(useAgentStore.getState().mutationById['agent-1']).toBeUndefined();
  });
});
