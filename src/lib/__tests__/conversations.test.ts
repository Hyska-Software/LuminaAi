import { describe, expect, it } from 'vitest';
import type { Conversation } from '@/lib/types';
import {
  chatConversationsAvailableToLink,
  conversationMode,
  filterConversationsForLayout,
  isChatConversation,
  isCodeConversation,
  isSharedChatConversation,
} from '../conversations';

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c-1',
    title: 'Sessão',
    createdAt: 1,
    updatedAt: 2,
    pinned: false,
    providerId: 'opencode-go',
    modelId: 'deepseek-v4.1-flash',
    messageCount: 0,
    ...overrides,
  };
}

describe('conversations — separação Chat/Code', () => {
  it('treats a missing mode as a Chat session (legacy compatibility)', () => {
    const legacy = conversation({ id: 'legacy' });
    expect(conversationMode(legacy)).toBe('chat');
    expect(isChatConversation(legacy)).toBe(true);
    expect(isCodeConversation(legacy)).toBe(false);
  });

  it('classifies Code-born sessions as Code only', () => {
    const code = conversation({ id: 'code', mode: 'code' });
    expect(conversationMode(code)).toBe('code');
    expect(isChatConversation(code)).toBe(false);
    expect(isCodeConversation(code)).toBe(true);
  });

  it('keeps a shared Chat session visible in both layouts', () => {
    const shared = conversation({ id: 'shared', mode: 'chat', codeLinked: true });
    expect(isChatConversation(shared)).toBe(true);
    expect(isCodeConversation(shared)).toBe(true);
    expect(isSharedChatConversation(shared)).toBe(true);
  });

  it('filters each layout without reordering', () => {
    const list = [
      conversation({ id: 'chat-1', updatedAt: 30 }),
      conversation({ id: 'code-1', mode: 'code', updatedAt: 20 }),
      conversation({ id: 'shared-1', codeLinked: true, updatedAt: 10 }),
      conversation({ id: 'chat-2', updatedAt: 5 }),
    ];

    expect(filterConversationsForLayout(list, 'chat').map((entry) => entry.id)).toEqual([
      'chat-1',
      'shared-1',
      'chat-2',
    ]);
    expect(filterConversationsForLayout(list, 'code').map((entry) => entry.id)).toEqual([
      'code-1',
      'shared-1',
    ]);
  });

  it('lists only Chat sessions that are not shared yet as candidates to add to Code', () => {
    const list = [
      conversation({ id: 'chat-1' }),
      conversation({ id: 'code-1', mode: 'code' }),
      conversation({ id: 'shared-1', codeLinked: true }),
    ];

    expect(chatConversationsAvailableToLink(list).map((entry) => entry.id)).toEqual(['chat-1']);
  });
});
