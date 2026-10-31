// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Conversation } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  listSubagentConversations: vi.fn(),
  getConversation: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));

import { SubagentList } from './SubagentList';

function child(): Conversation {
  return {
    id: 'child-1',
    title: 'Subagente: revisar o diff',
    createdAt: 1,
    updatedAt: 2,
    pinned: false,
    providerId: 'opencode-go',
    modelId: 'deepseek-v4.1-flash',
    messageCount: 2,
    mode: 'code',
    codeLinked: false,
    workspaceId: 'ws-1',
    agentKind: 'lumina',
    permissionMode: 'read_only',
    parentConversationId: 'parent-1',
    subagentTaskCallId: 'task-1',
    subagentType: 'review',
  };
}

describe('SubagentList', () => {
  afterEach(() => {
    cleanup();
    mocks.listSubagentConversations.mockReset();
    mocks.getConversation.mockReset();
  });

  it('lists retained children and opens the selected transcript', async () => {
    mocks.listSubagentConversations.mockResolvedValue([child()]);
    mocks.getConversation.mockResolvedValue({
      conversation: child(),
      messages: [
        {
          id: 'msg-1',
          conversationId: 'child-1',
          role: 'assistant',
          content: 'Achei um bug.',
          status: 'complete',
          toolCalls: [],
          citations: [],
          attachments: [],
          trace: [],
          createdAt: 2,
        },
      ],
    });

    render(<SubagentList conversationId="parent-1" />);

    expect(await screen.findByText('Subagentes · 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Subagente: revisar o diff/i }));

    expect(await screen.findByText('Achei um bug.')).toBeTruthy();
    expect(mocks.getConversation).toHaveBeenCalledWith('child-1');
  });

  it('shows an empty state when the parent has no children', async () => {
    mocks.listSubagentConversations.mockResolvedValue([]);
    render(<SubagentList conversationId="parent-1" />);
    expect(await screen.findByText('Nenhum subagente nesta sessão.')).toBeTruthy();
  });
});
