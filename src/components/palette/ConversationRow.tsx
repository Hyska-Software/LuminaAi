import { MessageSquareText, Pin } from 'lucide-react';
import { Badge } from '@/components/ui';
import type { Conversation } from '@/lib/types';
import type { TextRanges } from '@/lib/palette/types';
import { cn, relativeTime } from '@/lib/utils';
import { HighlightedText } from './HighlightedText';

export interface ConversationRowProps {
  id: string;
  conversation: Conversation;
  titleRanges: TextRanges;
  previewRanges: TextRanges;
  active: boolean;
  /** Query matched message content only (the IPC returns no snippet). */
  matchedInContent: boolean;
  onActivate: () => void;
  onExecute: () => void;
  refCallback?: (element: HTMLButtonElement | null) => void;
}

function messageCountLabel(count: number): string {
  if (count === 0) return 'Sem mensagens';
  return count === 1 ? '1 mensagem' : `${count} mensagens`;
}

/** One conversation search result inside the palette listbox. */
export function ConversationRow({
  id,
  conversation,
  titleRanges,
  previewRanges,
  active,
  matchedInContent,
  onActivate,
  onExecute,
  refCallback,
}: ConversationRowProps) {
  const Icon = conversation.pinned ? Pin : MessageSquareText;
  const preview = conversation.preview?.trim() ?? '';
  const ariaDescription = [
    preview || messageCountLabel(conversation.messageCount),
    matchedInContent ? 'Correspondência no conteúdo da conversa' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      ref={refCallback}
      id={id}
      type="button"
      role="option"
      aria-label={conversation.title}
      aria-selected={active}
      aria-description={ariaDescription}
      tabIndex={-1}
      data-palette-active={active ? 'true' : undefined}
      onPointerMove={onActivate}
      onClick={onExecute}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left',
        'transition-colors duration-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        active ? 'bg-surface-hover' : 'hover:bg-surface-hover',
      )}
    >
      <Icon
        aria-hidden
        className={cn('size-4 shrink-0', active ? 'text-accent' : 'text-foreground-subtle')}
        strokeWidth={1.9}
      />

      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-foreground">
            <HighlightedText text={conversation.title} ranges={titleRanges} />
          </span>
          {matchedInContent ? (
            <Badge tone="outline" className="shrink-0">
              Conteúdo
            </Badge>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-foreground-muted">
          {preview ? (
            <HighlightedText text={preview} ranges={previewRanges} />
          ) : (
            messageCountLabel(conversation.messageCount)
          )}
        </span>
      </span>

      <span className="shrink-0 text-[11px] tabular-nums text-foreground-subtle">
        {relativeTime(conversation.updatedAt)}
      </span>
    </button>
  );
}

export default ConversationRow;
