import { useTranslation } from 'react-i18next';
import { ListOrdered, Pause, Play, Trash2, X, Zap } from 'lucide-react';

import { Button, IconButton } from '@/components/ui';
import {
  selectConversationStream,
  useChatStore,
  useMessageQueueStore,
  type MessageQueueItem,
} from '@/lib/store';
import { cn } from '@/lib/utils';

/** Stable fallback: a fresh `[]` on every selector call would loop React. */
const EMPTY_QUEUE: MessageQueueItem[] = [];

/**
 * FIFO above the composer for every layout. The queue is persisted in
 * localStorage and drained when the conversation's turn finishes. While a turn
 * is running, "Send now" interrupts it and sends the chosen message.
 */
export function MessageQueueBar({
  conversationId,
  className,
}: {
  conversationId: string;
  className?: string;
}) {
  const { t } = useTranslation('chat');
  const items = useMessageQueueStore(
    (state) => state.byConversation[conversationId] ?? EMPTY_QUEUE,
  );
  const paused = useMessageQueueStore(
    (state) => state.pausedByConversation[conversationId] === true,
  );
  const pause = useMessageQueueStore((state) => state.pause);
  const remove = useMessageQueueStore((state) => state.remove);
  const clear = useMessageQueueStore((state) => state.clear);
  const streaming = useChatStore(
    (state) => selectConversationStream(state, conversationId) !== null,
  );
  const processQueue = useChatStore((state) => state.processQueue);
  const sendQueuedNow = useChatStore((state) => state.sendQueuedNow);

  if (items.length === 0) return null;

  return (
    <div
      className={cn(
        'mb-2 rounded-xl border border-border bg-surface-raised/80 px-2.5 py-2',
        className,
      )}
      aria-label={t('queue.aria')}
    >
      <div className="flex items-center gap-2">
        <ListOrdered aria-hidden className="size-3.5 shrink-0 text-accent" />
        <p className="min-w-0 flex-1 text-[11px] font-medium text-foreground-muted">
          {paused
            ? t('queue.titlePaused', { count: items.length })
            : t('queue.title', { count: items.length })}
        </p>
        <IconButton
          label={paused ? t('queue.resume') : t('queue.pause')}
          size="sm"
          variant="ghost"
          onClick={() => {
            pause(conversationId, !paused);
            if (paused) void processQueue(conversationId);
          }}
        >
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        </IconButton>
        {!paused ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (streaming) void sendQueuedNow(conversationId, items[0].id);
              else void processQueue(conversationId);
            }}
          >
            {t('queue.sendNow')}
          </Button>
        ) : null}
        <IconButton
          label={t('queue.clear')}
          size="sm"
          variant="ghost"
          onClick={() => clear(conversationId)}
        >
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
      <ul className="mt-1.5 space-y-1">
        {items.slice(0, 3).map((item, index) => (
          <li
            key={item.id}
            className="flex min-w-0 items-center gap-2 rounded-lg bg-surface/70 px-2 py-1"
          >
            <span className="w-4 shrink-0 text-center text-[10px] tabular-nums text-foreground-subtle">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-foreground-muted">
              {item.content || t('queue.attachments', { count: item.attachments.length })}
            </span>
            <IconButton
              label={t('queue.sendNow')}
              size="sm"
              variant="ghost"
              onClick={() => {
                void sendQueuedNow(conversationId, item.id);
              }}
            >
              <Zap className="size-3" />
            </IconButton>
            <IconButton
              label={t('queue.remove')}
              size="sm"
              variant="ghost"
              onClick={() => {
                remove(conversationId, item.id);
              }}
            >
              <X className="size-3" />
            </IconButton>
          </li>
        ))}
        {items.length > 3 ? (
          <li className="pl-6 text-[10px] text-foreground-subtle">
            {t('queue.more', { count: items.length - 3 })}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
