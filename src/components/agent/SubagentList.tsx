import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';

import { Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import type { Conversation } from '@/lib/types';
import { cn } from '@/lib/utils';
import { SubagentTranscriptDialog } from './SubagentTranscriptDialog';

export interface SubagentListProps {
  conversationId: string;
  className?: string;
}

const SUBAGENT_LABELS: Record<string, string> = {
  explore: 'exploração',
  review: 'revisão',
  general: 'geral',
};

/**
 * Audit list of retained child sessions for a parent Code session. Hidden from
 * the sidebar, but all outcomes (done/error/cancelled) remain inspectable.
 */
export function SubagentList({ conversationId, className }: SubagentListProps) {
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api
      .listSubagentConversations(conversationId)
      .then((value) => {
        if (!cancelled) setItems(Array.isArray(value) ? value : []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 px-1 text-[11px] text-foreground-subtle', className)}>
        <Spinner size="xs" /> Carregando subagentes…
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <p className={cn('px-1 text-[12px] leading-relaxed text-foreground-muted', className)}>
        Nenhum subagente nesta sessão.
      </p>
    );
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <p className="px-1 text-[11px] font-medium text-foreground-muted">
        Subagentes · {items.length}
      </p>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => setSelected(item.id)}
              className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <Bot aria-hidden className="size-3.5 shrink-0 text-foreground-subtle" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] font-medium text-foreground">
                  {item.title}
                </span>
                <span className="block truncate text-[10.5px] text-foreground-subtle">
                  {item.subagentType
                    ? (SUBAGENT_LABELS[item.subagentType] ?? item.subagentType)
                    : 'subagente'}{' '}
                  · {item.providerId}/{item.modelId}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <SubagentTranscriptDialog
        conversationId={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}

export default SubagentList;
