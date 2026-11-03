// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import { useAgentQueueStore } from '@/lib/store';
import { AgentQueueBar } from './AgentQueueBar';

beforeEach(() => {
  useAgentQueueStore.setState({ byConversation: {}, pausedByConversation: {} });
});

afterEach(() => cleanup());

describe('AgentQueueBar', () => {
  it('renders nothing with an empty queue without re-rendering forever', () => {
    render(<AgentQueueBar conversationId="conv-1" />);

    expect(screen.queryByLabelText('Fila de mensagens do agente')).toBeNull();
  });

  it('shows the queued messages for the conversation', () => {
    act(() =>
      useAgentQueueStore.getState().enqueue({
        id: 'item-1',
        conversationId: 'conv-1',
        agentId: 'agent-1',
        content: 'Mensagem na fila',
        attachments: [],
        providerId: 'opencode-go',
        modelId: 'deepseek-v4.1-flash',
        reasoning: null,
        createdAt: 1,
      }),
    );

    render(<AgentQueueBar conversationId="conv-1" />);

    expect(screen.getByLabelText('Fila de mensagens do agente')).toBeTruthy();
    expect(screen.getByText('Mensagem na fila')).toBeTruthy();
  });
});
