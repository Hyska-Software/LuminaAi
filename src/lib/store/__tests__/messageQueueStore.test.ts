import { beforeEach, describe, expect, it } from 'vitest';

import { compactMessageQueue, sanitizeMessageQueue, useMessageQueueStore, type MessageQueueItem } from '../messageQueueStore';

function item(id: string, conversationId = 'conv-1'): MessageQueueItem {
  return {
    id,
    conversationId,
    agentId: 'agent-1',
    content: `message ${id}`,
    attachments: [],
    providerId: 'opencode-go',
    modelId: 'glm-5.3-flash',
    reasoning: null,
    createdAt: 1,
  };
}

beforeEach(() => {
  useMessageQueueStore.setState({ byConversation: {}, pausedByConversation: {} });
});

describe('messageQueueStore', () => {
  it('keeps a FIFO per conversation and removes empty buckets', () => {
    const queue = useMessageQueueStore.getState();
    queue.enqueue(item('a'));
    queue.enqueue(item('b'));
    queue.enqueue(item('c', 'conv-2'));

    expect(useMessageQueueStore.getState().count('conv-1')).toBe(2);
    expect(useMessageQueueStore.getState().dequeue('conv-1')?.id).toBe('a');
    expect(useMessageQueueStore.getState().dequeue('conv-1')?.id).toBe('b');
    expect(useMessageQueueStore.getState().dequeue('conv-1')).toBeNull();

    compactMessageQueue();
    expect(useMessageQueueStore.getState().byConversation['conv-1']).toBeUndefined();
    expect(useMessageQueueStore.getState().byConversation['conv-2']).toHaveLength(1);
  });

  it('pauses and resumes without dropping queued messages', () => {
    const queue = useMessageQueueStore.getState();
    queue.enqueue(item('a'));
    queue.pause('conv-1', true);
    expect(useMessageQueueStore.getState().isPaused('conv-1')).toBe(true);
    expect(useMessageQueueStore.getState().peek('conv-1')?.id).toBe('a');
    queue.pause('conv-1', false);
    expect(useMessageQueueStore.getState().isPaused('conv-1')).toBe(false);
    expect(useMessageQueueStore.getState().count('conv-1')).toBe(1);
  });

  it('removes one item and clears the whole conversation', () => {
    const queue = useMessageQueueStore.getState();
    queue.enqueue(item('a'));
    queue.enqueue(item('b'));
    queue.remove('conv-1', 'a');
    expect(useMessageQueueStore.getState().byConversation['conv-1'].map((entry) => entry.id)).toEqual([
      'b',
    ]);
    queue.clear('conv-1');
    expect(useMessageQueueStore.getState().count('conv-1')).toBe(0);
  });

  it('puts a rejected item back at the front', () => {
    const queue = useMessageQueueStore.getState();
    queue.enqueue(item('a'));
    queue.enqueue(item('b'));
    queue.enqueueFront(item('a'));
    expect(useMessageQueueStore.getState().byConversation['conv-1'].map((entry) => entry.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('keeps items without a persona (Chat/Code) and with one (Agentes)', () => {
    const withoutAgent: MessageQueueItem = {
      id: 'chat-1',
      conversationId: 'conv-1',
      content: 'mensagem do chat',
      attachments: [],
      providerId: 'opencode-go',
      modelId: 'deepseek-v4.1-flash',
      reasoning: null,
      createdAt: 2,
    };
    const sanitized = sanitizeMessageQueue({
      byConversation: { 'conv-1': [withoutAgent, item('agent-1')] },
      pausedByConversation: {},
    });
    expect(sanitized.byConversation['conv-1'].map((entry) => entry.id)).toEqual([
      'chat-1',
      'agent-1',
    ]);
    expect(sanitized.byConversation['conv-1'][0].agentId).toBeUndefined();
    expect(sanitized.byConversation['conv-1'][1].agentId).toBe('agent-1');
  });

  it('drops malformed persisted state instead of throwing', () => {
    const sanitized = sanitizeMessageQueue({
      byConversation: {
        'conv-1': [{ id: 'broken' }, item('ok')],
        'conv-2': 'not-an-array',
      },
      pausedByConversation: { 'conv-1': true, 'conv-2': true },
    });
    expect(sanitized.byConversation['conv-1'].map((entry) => entry.id)).toEqual(['ok']);
    expect(sanitized.byConversation['conv-2']).toBeUndefined();
    expect(sanitized.pausedByConversation).toEqual({ 'conv-1': true });
    expect(sanitizeMessageQueue(null)).toEqual({
      byConversation: {},
      pausedByConversation: {},
    });
  });
});
