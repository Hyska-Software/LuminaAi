// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Conversation } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  listSubagentConversations: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));

import { useUiStore } from '@/lib/store';
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
    useUiStore.setState({
      codeSubagentTabs: [],
      codeSubagentTab: null,
      codeView: 'session',
    });
  });

  it('lists retained children and opens the selected chat tab', async () => {
    mocks.listSubagentConversations.mockResolvedValue([child()]);

    render(<SubagentList conversationId="parent-1" />);

    expect(await screen.findByText('Subagentes · 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Subagente: revisar o diff/i }));

    const state = useUiStore.getState();
    expect(state.codeView).toBe('subagent');
    expect(state.codeSubagentTabs).toHaveLength(1);
    expect(state.codeSubagentTab).toMatchObject({
      conversationId: 'child-1',
      taskCallId: 'task-1',
      subagentType: 'review',
    });
  });

  it('shows an empty state when the parent has no children', async () => {
    mocks.listSubagentConversations.mockResolvedValue([]);
    render(<SubagentList conversationId="parent-1" />);
    expect(await screen.findByText('Nenhum subagente nesta sessão.')).toBeTruthy();
  });
});
