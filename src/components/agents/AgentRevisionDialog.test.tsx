// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  reviseAgent: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { useAgentStore, useAppStore } from '@/lib/store';
import type { Agent, AgentInput, AgentRevision } from '@/lib/types';
import { AgentRevisionDialog } from './AgentRevisionDialog';

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
};

const before: AgentInput = {
  name: 'Irineu',
  role: 'Engenheiro',
  description: '',
  emoji: '🛠️',
  department: 'Engenharia',
  providerId: 'opencode-go',
  modelId: 'glm-5.3-flash',
  reasoning: null,
  instructions: 'Seja direto.',
  starters: [],
  capabilities: agent.capabilities,
  memoryEnabled: false,
  workspaceId: null,
  permissionMode: 'edit',
};

const after: AgentInput = {
  ...before,
  instructions: 'Seja direto e sempre termine com o próximo passo.',
};

const revision: AgentRevision = {
  agentId: 'agent-1',
  before,
  after,
  changes: [
    {
      field: 'instructions',
      label: 'Instruções',
      before: before.instructions,
      after: after.instructions,
    },
  ],
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reviseAgent.mockResolvedValue(revision);
  useAppStore.setState({
    selection: {
      providerId: 'opencode-go',
      modelId: 'glm-5.3-flash',
      reasoning: null,
    },
  });
  useAgentStore.setState({
    agentsById: { 'agent-1': agent },
    orderedIds: ['agent-1'],
    status: 'ready',
    error: null,
    mutationById: {},
    initialized: true,
    update: vi.fn().mockResolvedValue({ ...agent, instructions: after.instructions }),
  });
});

describe('AgentRevisionDialog', () => {
  it('shows the field diff and applies only after confirmation', async () => {
    render(<AgentRevisionDialog agent={agent} open onOpenChange={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Pedido de alteração do agente'), {
      target: { value: 'Sempre termine com o próximo passo.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Gerar revisão/ }));

    await waitFor(() =>
      expect(mocks.reviseAgent).toHaveBeenCalledWith(
        'agent-1',
        'Sempre termine com o próximo passo.',
        'opencode-go',
        'glm-5.3-flash',
      ),
    );
    expect(await screen.findByText('Instruções')).toBeTruthy();
    expect(screen.getByText('Seja direto.')).toBeTruthy();
    expect(
      screen.getByText('Seja direto e sempre termine com o próximo passo.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Aplicar revisão/ }));
    await waitFor(() =>
      expect(useAgentStore.getState().update).toHaveBeenCalledWith('agent-1', after),
    );
  });
});
