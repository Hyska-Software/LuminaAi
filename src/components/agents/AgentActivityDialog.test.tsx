// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  listAgentTasks: vi.fn(),
  getConversation: vi.fn(),
  listArtifacts: vi.fn(),
  getCacheStats: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { emptyCodeSession, useChatStore, useCodeStore, useUiStore } from '@/lib/store';
import type { ApprovalRequest, Conversation } from '@/lib/types';
import { AgentActivityDialog } from './AgentActivityDialog';

const conversation: Conversation = {
  id: 'conv-1',
  title: 'Plano trimestral',
  createdAt: 1,
  updatedAt: 1,
  pinned: false,
  providerId: 'opencode-go',
  modelId: 'deepseek-v4.1-flash',
  messageCount: 0,
  mode: 'agent',
  agentId: 'agent-1',
};

const approval: ApprovalRequest = {
  id: 'approval-1',
  conversationId: 'conv-1',
  toolCallId: 'call-1',
  tool: 'computer_click',
  title: 'Clique em (10, 20)',
  detail: { kind: 'other', text: 'Clique em (10, 20)' },
  risk: 'computer',
  options: [{ id: 'allow', label: 'Permitir uma vez' }],
  createdAt: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAgentTasks.mockResolvedValue([]);
  mocks.listArtifacts.mockResolvedValue([]);
  mocks.getCacheStats.mockResolvedValue(null);
  mocks.getConversation.mockResolvedValue({ conversation, messages: [] });
  useUiStore.setState({ layoutMode: 'chat' });
  useChatStore.setState({
    conversations: [conversation],
    activeId: null,
    messagesByConversation: {},
    streamsByConversation: {},
    streaming: null,
  });
  useCodeStore.setState({
    byConversation: {
      'conv-1': { ...emptyCodeSession('conv-1'), approvals: [approval] },
    },
  });
});

afterEach(() => {
  cleanup();
});

describe('AgentActivityDialog', () => {
  it('lista aprovações pendentes e abre a thread ao clicar', async () => {
    render(<AgentActivityDialog open onOpenChange={() => {}} />);

    expect(await screen.findByText('Precisa de você')).toBeTruthy();
    const entry = screen.getByText(/Aprovação · Clique em/).closest('button');
    expect(entry).not.toBeNull();
    fireEvent.click(entry!);

    await waitFor(() => expect(useChatStore.getState().activeId).toBe('conv-1'));
    expect(useUiStore.getState().layoutMode).toBe('agent');
  });

  it('mostra estado vazio sem turnos, aprovações ou tarefas', async () => {
    useCodeStore.setState({ byConversation: {} });
    render(<AgentActivityDialog open onOpenChange={() => {}} />);

    expect(
      await screen.findByText(
        'Nada pendente. Turnos, aprovações e tarefas aparecem aqui.',
      ),
    ).toBeTruthy();
  });
});
