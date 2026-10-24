import type { StreamingState } from '@/lib/store';
import type { ChatMessage } from '@/lib/types';
import { MessageItem } from './MessageItem';

export interface MessageListProps {
  messages: ChatMessage[];
  streaming: StreamingState | null;
}

/**
 * Ordered list of chat messages. The container is a polite live region while a
 * turn streams so screen readers announce the new content (DESIGN §12).
 */
export function MessageList({ messages, streaming }: MessageListProps) {
  return (
    <div
      role="log"
      aria-live={streaming ? 'polite' : 'off'}
      aria-relevant="additions text"
      aria-busy={streaming !== null}
      className="flex flex-col"
    >
      {messages.map((message, index) => (
        <MessageItem
          key={message.id}
          message={message}
          isStreaming={streaming?.assistantId === message.id}
          isGroupStart={index === 0 || messages[index - 1]?.role !== message.role}
        />
      ))}
    </div>
  );
}
