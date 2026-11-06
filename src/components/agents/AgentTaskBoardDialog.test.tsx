// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  listAgentTasks: vi.fn(),
  listAgentChannels: vi.fn(),
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
    originConversationId: null,
    result: null,
    resultArtifactIds: [],
    leaseUntil: null,
    handoffCount: 0,
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAgentTasks.mockResolvedValue([
    task({ id: 'queued', title: 'Preparar entrega', status: 'queued' }),
    task({ id: 'running', title: 'Analisar contrato', status: 'running' }),
  ]);
  mocks.listAgentChannels.mockResolvedValue([]);
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
    expect(screen.getByText('Encerradas')).toBeTruthy();
  });

  it('oculta tarefas fora das últimas 24 horas', async () => {
    mocks.listAgentTasks.mockResolvedValue([
      task({ id: 'recent', title: 'Tarefa recente', status: 'queued' }),
      task({
        id: 'old',
        title: 'Tarefa antiga',
        status: 'queued',
        updatedAt: Date.now() - 25 * 60 * 60 * 1000,
      }),
    ]);
    render(<AgentTaskBoardDialog open onOpenChange={() => {}} />);

    expect(await screen.findByText('Tarefa recente')).toBeTruthy();
    expect(screen.queryByText('Tarefa antiga')).toBeNull();
    expect(screen.getByText(/1 tarefa\(s\) nas últimas 24h/)).toBeTruthy();
  });

  it('mantém a etapa rolável quando há mais de duas tarefas', async () => {
    mocks.listAgentTasks.mockResolvedValue([
      task({ id: 'a', title: 'Tarefa A', status: 'queued' }),
      task({ id: 'b', title: 'Tarefa B', status: 'queued' }),
      task({ id: 'c', title: 'Tarefa C', status: 'queued' }),
    ]);
    render(<AgentTaskBoardDialog open onOpenChange={() => {}} />);

    const firstCard = (await screen.findByText('Tarefa A')).closest('article');
    const list = firstCard?.parentElement;
    expect(list?.className).toContain('overflow-y-auto');
    expect(list?.className).toContain('min-h-0');
    expect(list?.parentElement?.className).toContain('max-h-');
    expect(screen.getByText('Tarefa B')).toBeTruthy();
    expect(screen.getByText('Tarefa C')).toBeTruthy();
  });

  it('filtra por canal quando recebe channelId', async () => {
    render(<AgentTaskBoardDialog open onOpenChange={() => {}} channelId="channel-1" />);
    await screen.findByText('Preparar entrega');
    expect(mocks.listAgentTasks).toHaveBeenCalledWith({
      channelId: 'channel-1',
      ownerAgentId: undefined,
    });
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
