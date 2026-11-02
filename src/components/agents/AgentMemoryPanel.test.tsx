// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  listAgentMemories: vi.fn(),
  createAgentMemory: vi.fn(),
  updateAgentMemory: vi.fn(),
  deleteAgentMemory: vi.fn(),
  clearAgentMemories: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { AgentMemoryPanel } from './AgentMemoryPanel';

const memory = {
  id: 'm1',
  agentId: 'agent-1',
  kind: 'preference' as const,
  content: 'Prefere respostas curtas.',
  sourceConversationId: null,
  pinned: false,
  createdAt: 1,
  updatedAt: 1,
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAgentMemories.mockResolvedValue([memory]);
  mocks.createAgentMemory.mockResolvedValue({
    ...memory,
    id: 'm2',
    content: 'Trabalha com Rust.',
  });
  mocks.updateAgentMemory.mockResolvedValue({ ...memory, pinned: true });
  mocks.deleteAgentMemory.mockResolvedValue(undefined);
  mocks.clearAgentMemories.mockResolvedValue(1);
});

describe('AgentMemoryPanel', () => {
  it('loads stored memories and creates a new one', async () => {
    render(<AgentMemoryPanel agentId="agent-1" memoryEnabled />);
    expect(await screen.findByText('Prefere respostas curtas.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Nova memória'), {
      target: { value: 'Trabalha com Rust.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Adicionar/ }));
    await waitFor(() =>
      expect(mocks.createAgentMemory).toHaveBeenCalledWith('agent-1', {
        kind: 'fact',
        content: 'Trabalha com Rust.',
      }),
    );
    expect(await screen.findByText('Trabalha com Rust.')).toBeTruthy();
  });

  it('toggles a memory pin and removes another', async () => {
    render(<AgentMemoryPanel agentId="agent-1" memoryEnabled />);
    await screen.findByText('Prefere respostas curtas.');
    fireEvent.click(screen.getByRole('button', { name: 'Fixar memória' }));
    await waitFor(() =>
      expect(mocks.updateAgentMemory).toHaveBeenCalledWith('agent-1', 'm1', {
        kind: 'preference',
        content: 'Prefere respostas curtas.',
        pinned: true,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Excluir memória' }));
    await waitFor(() => expect(mocks.deleteAgentMemory).toHaveBeenCalledWith('agent-1', 'm1'));
  });

  it('explains that memories are preserved while the feature is off', async () => {
    render(<AgentMemoryPanel agentId="agent-1" memoryEnabled={false} />);
    await screen.findByText('Prefere respostas curtas.');
    expect(screen.getByText(/As memórias ficam preservadas/)).toBeTruthy();
  });

  it('asks for the agent to be saved when there is no id yet', () => {
    render(<AgentMemoryPanel agentId={null} memoryEnabled />);
    expect(screen.getByText(/Salve o agente primeiro/)).toBeTruthy();
  });
});
