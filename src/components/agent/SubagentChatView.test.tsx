// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ChatMessage, ConversationDetail } from '@/lib/types';

const mocks = vi.hoisted(() => ({ getConversation: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { getConversation: mocks.getConversation } }));

import { useChatStore } from '@/lib/store';
import { SubagentChatView } from './SubagentChatView';

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

const target = {
  conversationId: 'child-1',
  taskCallId: 'task-1',
  subagentType: 'review',
  description: 'Revisar o diff',
  providerId: 'opencode-go',
  modelId: 'deepseek-v4.1-flash',
  effort: 'high',
};

const detail: ConversationDetail = {
  conversation: {
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
    agentKind: 'zylara',
    permissionMode: 'read_only',
    parentConversationId: 'parent-1',
    subagentTaskCallId: 'task-1',
    subagentType: 'review',
  },
  messages: [
    message({ id: 'user-1', role: 'user', content: 'Revise o diff atual' }),
    message({
      id: 'assistant-1',
      content: 'Achei um bug em src/app.ts:10.',
      reasoning: 'Vou olhar o diff.',
      usage: { totalTokens: 1200, durationMs: 5000 },
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
      trace: [{ reasoning: 'Vou olhar o diff.', toolCalls: 1 }],
    }),
  ],
};

describe('SubagentChatView', () => {
  afterEach(() => {
    cleanup();
    mocks.getConversation.mockReset();
    useChatStore.setState({ streaming: null });
  });

  it('renders the retained transcript as a read-only chat without input', async () => {
    mocks.getConversation.mockResolvedValue(detail);
    render(<SubagentChatView target={target} />);

    expect(await screen.findByText('Subagente · revisão')).toBeTruthy();
    expect(screen.getByText('Somente leitura')).toBeTruthy();
    expect(await screen.findByText(/Achei um bug/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar mensagem' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Regenerar resposta' })).toBeNull();
    expect(mocks.getConversation).toHaveBeenCalledWith('child-1');
  });

  it('shows the live child stream and updates from the store', async () => {
    mocks.getConversation.mockResolvedValue(detail);
    useChatStore.setState({
      streaming: {
        turnId: 'parent-turn',
        conversationId: 'parent-1',
        assistantId: 'parent-assistant',
        userMessageId: 'parent-user',
        phase: 'tool',
        step: 1,
        startedAt: 1,
        turnKind: 'user',
        subagents: {
          'task-1': {
            taskCallId: 'task-1',
            conversationId: 'child-1',
            subagentType: 'review',
            description: 'Revisar o diff',
            prompt: 'Revise o diff atual',
            providerId: 'opencode-go',
            modelId: 'deepseek-v4.1-flash',
            effort: 'high',
            status: 'running',
            startedAt: 1,
            steps: 2,
            text: 'Achei um bug',
            reasoning: 'Vou olhar o diff.',
            trace: [{ reasoning: 'Vou olhar o diff.', toolCalls: 1 }],
            toolCalls: [
              {
                id: 'child-tool-1',
                name: 'read_file',
                arguments: '{"path":"src/app.ts"}',
                status: 'running',
                result: null,
              },
            ],
          },
        },
      },
    });

    render(<SubagentChatView target={target} />);

    expect(await screen.findByText('Subagente · revisão')).toBeTruthy();
    expect(screen.getByText('Revise o diff atual')).toBeTruthy();
    expect(await screen.findByText(/Achei um bug/)).toBeTruthy();
    expect(mocks.getConversation).not.toHaveBeenCalled();

    useChatStore.setState((state) => ({
      streaming: state.streaming
        ? {
            ...state.streaming,
            subagents: {
              ...(state.streaming.subagents ?? {}),
              'task-1': {
                ...state.streaming.subagents!['task-1'],
                status: 'done' as const,
                text: 'Achei um bug em src/app.ts:10.',
                usage: { totalTokens: 1200 },
              },
            },
          }
        : null,
    }));
    await waitFor(() => {
      expect(mocks.getConversation).toHaveBeenCalledWith('child-1');
    });
  });
});
