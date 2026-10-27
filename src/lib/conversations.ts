import type { Conversation, ConversationMode } from './types';

/**
 * Session separation between the two layouts (docs/goals/chat-code-sessions).
 *
 * - A session born in the Chat layout (`mode === 'chat'`, the default for legacy
 *   rows) belongs to Chat only.
 * - A session born in the Code layout (`mode === 'code'`) belongs to Code only.
 * - A Chat session explicitly added to Code (`codeLinked === true`) is shared:
 *   it appears in both lists and both modes read/write the same conversation.
 *
 * `mode` is optional on the type so fixtures/old payloads keep working: a
 * missing mode is a Chat session.
 */
export function conversationMode(conversation: Conversation): ConversationMode {
  return conversation.mode === 'code' ? 'code' : 'chat';
}

/** A session that only belongs to the Chat layout (shared or not). */
export function isChatConversation(conversation: Conversation): boolean {
  return conversationMode(conversation) === 'chat';
}

/** A session visible in the Code layout: Code-born or shared from Chat. */
export function isCodeConversation(conversation: Conversation): boolean {
  return conversationMode(conversation) === 'code' || conversation.codeLinked === true;
}

/** A Chat session that was explicitly added to the Code layout. */
export function isSharedChatConversation(conversation: Conversation): boolean {
  return isChatConversation(conversation) && conversation.codeLinked === true;
}

/** Chat sessions the user can still add to Code (not shared yet). */
export function chatConversationsAvailableToLink(
  conversations: readonly Conversation[],
): Conversation[] {
  return conversations.filter(
    (conversation) => isChatConversation(conversation) && conversation.codeLinked !== true,
  );
}

/** Whether a conversation belongs to the given layout's session list. */
export function isConversationVisibleIn(
  conversation: Conversation,
  layout: ConversationMode,
): boolean {
  return layout === 'code' ? isCodeConversation(conversation) : isChatConversation(conversation);
}

/** Sessions visible in one layout, preserving the incoming order. */
export function filterConversationsForLayout(
  conversations: readonly Conversation[],
  layout: ConversationMode,
): Conversation[] {
  return conversations.filter((conversation) => isConversationVisibleIn(conversation, layout));
}
