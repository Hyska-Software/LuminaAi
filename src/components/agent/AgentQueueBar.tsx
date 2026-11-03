import { ListOrdered, Pause, Play, Trash2, X } from 'lucide-react';

import { Button, IconButton } from '@/components/ui';
import { useAgentQueueStore, useChatStore, type AgentQueueItem } from '@/lib/store';
import { cn } from '@/lib/utils';

/** Stable fallback: a fresh `[]` on every selector call would loop React. */
const EMPTY_QUEUE: AgentQueueItem[] = [];

/**
 * FIFO above the composer for agent threads. The queue is persisted in
 * localStorage and drained when the current turn finishes (same conversation).
 */
export function AgentQueueBar({
  conversationId,
  className,
}: {
  conversationId: string;
  className?: string;
}) {
  const items = useAgentQueueStore(
    (state) => state.byConversation[conversationId] ?? EMPTY_QUEUE,
  );
  const paused = useAgentQueueStore(
    (state) => state.pausedByConversation[conversationId] === true,
  );
  const pause = useAgentQueueStore((state) => state.pause);
  const remove = useAgentQueueStore((state) => state.remove);
  const clear = useAgentQueueStore((state) => state.clear);
  const streaming = useChatStore((state) => state.streaming !== null);
  const processQueue = useChatStore((state) => state.processQueue);

  if (items.length === 0) return null;

  return (
    <div
      className={cn(
        'mb-2 rounded-xl border border-border bg-surface-raised/80 px-2.5 py-2',
        className,
      )}
      aria-label="Fila de mensagens do agente"
    >
      <div className="flex items-center gap-2">
        <ListOrdered aria-hidden className="size-3.5 shrink-0 text-accent" />
        <p className="min-w-0 flex-1 text-[11px] font-medium text-foreground-muted">
          Na fila · {items.length}
          {paused ? ' · pausada' : ''}
        </p>
        <IconButton
          label={paused ? 'Retomar fila' : 'Pausar fila'}
          size="sm"
          variant="ghost"
          onClick={() => {
            pause(conversationId, !paused);
            if (paused) void processQueue(conversationId);
          }}
        >
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        </IconButton>
        {!streaming && !paused ? (
          <Button size="sm" variant="ghost" onClick={() => void processQueue(conversationId)}>
            Enviar agora
          </Button>
        ) : null}
        <IconButton
          label="Limpar fila"
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
              {item.content || `${item.attachments.length} anexo(s)`}
            </span>
            <IconButton
              label="Remover da fila"
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
            +{items.length - 3} mensagem(ns)
          </li>
        ) : null}
      </ul>
    </div>
  );
}
