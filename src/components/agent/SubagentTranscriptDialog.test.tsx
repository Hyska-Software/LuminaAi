// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ChatMessage, ConversationDetail } from '@/lib/types';

const mocks = vi.hoisted(() => ({ getConversation: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { getConversation: mocks.getConversation } }));

import { SubagentTranscriptDialog } from './SubagentTranscriptDialog';

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg-1',
    conversationId: 'child-1',
    role: 'assistant',
    content: '',
    status: 'complete',
    toolCalls: [],
    citations: [],
    attachments: [],
    trace: [],
    createdAt: 1,
    ...overrides,
  };
}

describe('SubagentTranscriptDialog', () => {
  afterEach(() => {
    cleanup();
    mocks.getConversation.mockReset();
  });

  it('loads and renders the retained child transcript', async () => {
    const detail: ConversationDetail = {
      conversation: {
        id: 'child-1',
        title: 'Subagente: revisar pagamentos',
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
      },
      messages: [
        message({
          id: 'msg-user',
          role: 'user',
          content: 'Revise o diff atual',
        }),
        message({
          id: 'msg-assistant',
          content: 'Achei o bug em src/app.ts:10.',
          usage: { totalTokens: 1234 },
          toolCalls: [
            {
              id: 'tool-1',
              name: 'git_diff',
              arguments: '{}',
              status: 'done',
              result: 'diff --git a/src/app.ts',
              summary: 'Viu o diff do git',
            },
          ],
        }),
      ],
    };
    mocks.getConversation.mockResolvedValue(detail);

    render(
      <SubagentTranscriptDialog
        conversationId="child-1"
        open
        onOpenChange={() => undefined}
      />,
    );

    expect(await screen.findByText('Subagente: revisar pagamentos')).toBeTruthy();
    expect(screen.getByText('review · opencode-go/deepseek-v4.1-flash · 1234 tokens')).toBeTruthy();
    expect(screen.getByText(/Achei o bug/)).toBeTruthy();
    expect(screen.getByText('git_diff')).toBeTruthy();
    expect(mocks.getConversation).toHaveBeenCalledWith('child-1');
  });

  it('does not fetch while closed', () => {
    render(
      <SubagentTranscriptDialog
        conversationId="child-1"
        open={false}
        onOpenChange={() => undefined}
      />,
    );
    expect(mocks.getConversation).not.toHaveBeenCalled();
  });
});
