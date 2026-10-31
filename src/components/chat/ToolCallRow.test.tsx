// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Bot } from 'lucide-react';
import type { ConversationDetail, ToolCallRecord } from '@/lib/types';

const mocks = vi.hoisted(() => ({ getConversation: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { getConversation: mocks.getConversation } }));

import { ToolCallRow } from './ToolCallRow';

function taskTool(): ToolCallRecord {
  return {
    id: 'task-1',
    name: 'task',
    arguments: JSON.stringify({ description: 'Revisar o diff', prompt: 'Aponte bugs' }),
    status: 'done',
    result: 'Achei um bug.',
    summary: 'Subagente review: Revisar o diff',
    presentation: {
      kind: 'subagent',
      description: 'Revisar o diff',
      subagentType: 'review',
      conversationId: 'child-1',
      providerId: 'opencode-go',
      modelId: 'deepseek-v4.1-flash',
      effort: 'high',
      steps: 3,
      durationMs: 1200,
    },
  };
}

describe('ToolCallRow subagent transcript', () => {
  afterEach(() => {
    cleanup();
    mocks.getConversation.mockReset();
  });

  it('opens the retained transcript from the task row', async () => {
    const detail: ConversationDetail = {
      conversation: {
        id: 'child-1',
        title: 'Subagente: revisar o diff',
        createdAt: 1,
        updatedAt: 2,
        pinned: false,
        providerId: 'opencode-go',
        modelId: 'deepseek-v4.1-flash',
        messageCount: 1,
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
    };
    mocks.getConversation.mockResolvedValue(detail);

    render(<ToolCallRow tool={taskTool()} icon={Bot} />);

    fireEvent.click(screen.getByRole('button', { name: /Ver transcrição/i }));

    expect(await screen.findByText('Subagente: revisar o diff')).toBeTruthy();
    expect(mocks.getConversation).toHaveBeenCalledWith('child-1');
  });
});
