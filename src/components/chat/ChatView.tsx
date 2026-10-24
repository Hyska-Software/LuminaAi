import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { Composer } from '@/components/composer/Composer';
import { useReduceMotion } from '@/components/layout/hooks';
import { selectActiveMessages, useChatStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { LoadingSkeleton } from './LoadingSkeleton';
import { MessageList } from './MessageList';
import { WelcomeScreen } from './WelcomeScreen';

/** Distance from the bottom (px) still considered "reading the latest message". */
const BOTTOM_THRESHOLD = 96;

/**
 * Chat column: scrollable conversation with smart auto-scroll, the welcome
 * screen for empty conversations and the composer pinned to the bottom.
 */
export function ChatView() {
  const messages = useChatStore(selectActiveMessages);
  const activeId = useChatStore((state) => state.activeId);
  const streaming = useChatStore((state) => state.streaming);
  const loadingConversationId = useChatStore((state) => state.loadingConversationId);
  const reduceMotion = useReduceMotion();

  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const loading = loadingConversationId !== null && loadingConversationId === activeId;

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    atBottomRef.current = true;
    setShowJump(false);
  }, []);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const nearBottom = distance < BOTTOM_THRESHOLD;
    atBottomRef.current = nearBottom;
    setShowJump(!nearBottom);
  }, []);

  /* Follow streaming output only while the user is parked at the bottom. */
  useLayoutEffect(() => {
    if (atBottomRef.current) scrollToBottom('auto');
  }, [messages, scrollToBottom]);

  /* Always start a conversation at its latest message. */
  useEffect(() => {
    atBottomRef.current = true;
    scrollToBottom('auto');
  }, [activeId, scrollToBottom]);

  /* Sending a message (or regenerating) pulls the view back to the bottom. */
  useEffect(() => {
    const onScrollBottom = () => {
      atBottomRef.current = true;
      scrollToBottom(reduceMotion ? 'auto' : 'smooth');
    };
    window.addEventListener('lumina:scroll-bottom', onScrollBottom);
    return () => window.removeEventListener('lumina:scroll-bottom', onScrollBottom);
  }, [reduceMotion, scrollToBottom]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {loading ? (
          <LoadingSkeleton />
        ) : messages.length === 0 ? (
          <div className="flex min-h-full items-center justify-center">
            <WelcomeScreen />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl px-6 pb-10 pt-6">
            <MessageList messages={messages} streaming={streaming} />
          </div>
        )}
      </div>

      <div className="relative z-10 shrink-0 px-4 pb-3">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-10 bottom-0 bg-linear-to-t from-background via-background/90 to-transparent"
        />
        <div className="relative mx-auto w-full max-w-3xl">
          <Composer />
        </div>
      </div>

      {showJump ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-32 z-20 flex justify-center">
          <button
            type="button"
            onClick={() => scrollToBottom(reduceMotion ? 'auto' : 'smooth')}
            aria-label="Ir para o fim da conversa"
            className={cn(
              'pointer-events-auto flex size-9 items-center justify-center rounded-full border border-border',
              'bg-surface-raised text-foreground-muted shadow-md',
              'transition-colors duration-150 hover:bg-surface-hover hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            )}
          >
            <ArrowDown className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
