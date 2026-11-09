// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  cancelTurn: vi.fn().mockResolvedValue(true),
  listActiveTurns: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));

import { useChatStore, useMessageQueueStore, type StreamingState } from '@/lib/store';
import { MessageQueueBar } from './MessageQueueBar';

function streamingState(): StreamingState {
  return {
    turnId: 'turn-1',
    conversationId: 'conv-1',
    assistantId: 'assistant-1',
    userMessageId: 'user-1',
    phase: 'text',
    step: 1,
    startedAt: 1,
    turnKind: 'user',
    subagents: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useMessageQueueStore.setState({ byConversation: {}, pausedByConversation: {} });
  useChatStore.setState({
    activeId: 'conv-1',
    streamsByConversation: {},
    streaming: null,
  });
});

afterEach(() => cleanup());

describe('MessageQueueBar', () => {
  it('renders nothing with an empty queue without re-rendering forever', () => {
    render(<MessageQueueBar conversationId="conv-1" />);

    expect(screen.queryByLabelText('Fila de mensagens')).toBeNull();
  });

  it('shows the queued messages for the conversation', () => {
    act(() =>
      useMessageQueueStore.getState().enqueue({
        id: 'item-1',
        conversationId: 'conv-1',
        content: 'Mensagem na fila',
        attachments: [],
        providerId: 'opencode-go',
        modelId: 'deepseek-v4.1-flash',
        reasoning: null,
        createdAt: 1,
      }),
    );

    render(<MessageQueueBar conversationId="conv-1" />);

    expect(screen.getByLabelText('Fila de mensagens')).toBeTruthy();
    expect(screen.getByText('Mensagem na fila')).toBeTruthy();
  });

  it('interrupts the running turn when the item is sent now', async () => {
    const stream = streamingState();
    act(() => {
      useMessageQueueStore.getState().enqueue({
        id: 'item-1',
        conversationId: 'conv-1',
        content: 'Corrige o rumo',
        attachments: [],
        providerId: 'opencode-go',
        modelId: 'deepseek-v4.1-flash',
        reasoning: null,
        createdAt: 1,
      });
      useChatStore.setState({
        streamsByConversation: { 'conv-1': stream },
        streaming: stream,
      });
    });

    render(<MessageQueueBar conversationId="conv-1" />);

    const buttons = screen.getAllByRole('button', { name: 'Enviar agora' });
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(mocks.cancelTurn).toHaveBeenCalledWith('turn-1'));
  });
});
