import { beforeEach, describe, expect, it } from 'vitest';

import { compactAgentQueue, useAgentQueueStore, type AgentQueueItem } from '../agentQueueStore';

function item(id: string, conversationId = 'conv-1'): AgentQueueItem {
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
  useAgentQueueStore.setState({ byConversation: {}, pausedByConversation: {} });
});

describe('agentQueueStore', () => {
  it('keeps a FIFO per conversation and removes empty buckets', () => {
    const queue = useAgentQueueStore.getState();
    queue.enqueue(item('a'));
    queue.enqueue(item('b'));
    queue.enqueue(item('c', 'conv-2'));

    expect(useAgentQueueStore.getState().count('conv-1')).toBe(2);
    expect(useAgentQueueStore.getState().dequeue('conv-1')?.id).toBe('a');
    expect(useAgentQueueStore.getState().dequeue('conv-1')?.id).toBe('b');
    expect(useAgentQueueStore.getState().dequeue('conv-1')).toBeNull();

    compactAgentQueue();
    expect(useAgentQueueStore.getState().byConversation['conv-1']).toBeUndefined();
    expect(useAgentQueueStore.getState().byConversation['conv-2']).toHaveLength(1);
  });

  it('pauses and resumes without dropping queued messages', () => {
    const queue = useAgentQueueStore.getState();
    queue.enqueue(item('a'));
    queue.pause('conv-1', true);
    expect(useAgentQueueStore.getState().isPaused('conv-1')).toBe(true);
    expect(useAgentQueueStore.getState().peek('conv-1')?.id).toBe('a');
    queue.pause('conv-1', false);
    expect(useAgentQueueStore.getState().isPaused('conv-1')).toBe(false);
    expect(useAgentQueueStore.getState().count('conv-1')).toBe(1);
  });

  it('removes one item and clears the whole conversation', () => {
    const queue = useAgentQueueStore.getState();
    queue.enqueue(item('a'));
    queue.enqueue(item('b'));
    queue.remove('conv-1', 'a');
    expect(useAgentQueueStore.getState().byConversation['conv-1'].map((entry) => entry.id)).toEqual([
      'b',
    ]);
    queue.clear('conv-1');
    expect(useAgentQueueStore.getState().count('conv-1')).toBe(0);
  });
});
