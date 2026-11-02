// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  listAgentTasks: vi.fn(),
  cancelAgentTask: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import type { AgentTask } from '@/lib/types';
import { AgentTaskBoardDialog } from './AgentTaskBoardDialog';

function task(overrides: Partial<AgentTask>): AgentTask {
  return {
    id: 'task-1',
    channelId: null,
    parentTaskId: null,
    ownerAgentId: 'agent-1',
    createdByAgentId: null,
    createdByUser: true,
    title: 'Revisar o relatório',
    brief: 'Leia e liste riscos.',
    acceptance: '',
    status: 'queued',
    priority: 0,
    maxTurns: 4,
    maxTokens: 20_000,
    maxCost: 0.5,
    deadlineAt: null,
    conversationId: null,
    result: null,
    resultArtifactIds: [],
    leaseUntil: null,
    handoffCount: 0,
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAgentTasks.mockResolvedValue([
    task({ id: 'queued', title: 'Preparar entrega', status: 'queued' }),
    task({ id: 'running', title: 'Analisar contrato', status: 'running' }),
  ]);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AgentTaskBoardDialog', () => {
  it('mostra as colunas e os cards por status', async () => {
    render(<AgentTaskBoardDialog open onOpenChange={() => {}} />);

    expect(await screen.findByText('Preparar entrega')).toBeTruthy();
    expect(screen.getByText('Analisar contrato')).toBeTruthy();
    expect(screen.getByText('Em fila')).toBeTruthy();
    expect(screen.getByText('Em andamento')).toBeTruthy();
    expect(screen.getByText('Aguardando')).toBeTruthy();
    expect(screen.getByText('Revisão')).toBeTruthy();
    expect(screen.getByText('Concluídas')).toBeTruthy();
  });

  it('cancela uma tarefa com confirmação e atualiza o status', async () => {
    mocks.cancelAgentTask.mockResolvedValue(
      task({ id: 'running', title: 'Analisar contrato', status: 'cancelled' }),
    );
    render(<AgentTaskBoardDialog open onOpenChange={() => {}} />);

    const card = (await screen.findByText('Analisar contrato')).closest('article');
    expect(card).not.toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /cancelar/i })[1]);

    await waitFor(() => expect(mocks.cancelAgentTask).toHaveBeenCalledWith('running'));
    expect(window.confirm).toHaveBeenCalled();
    expect(mocks.listAgentTasks).toHaveBeenCalled();
  });
});
