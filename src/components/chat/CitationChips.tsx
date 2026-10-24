import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Citation } from '@/lib/types';
import { cn, hostnameOf, truncate } from '@/lib/utils';
import { openExternalUrl } from './external';

export interface CitationChipsProps {
  citations: Citation[];
  className?: string;
}

const MAX_VISIBLE = 6;

/** Source chips for tool citations (DESIGN §6.3): domain + truncated title. */
export function CitationChips({ citations, className }: CitationChipsProps) {
  const [expanded, setExpanded] = useState(false);
  if (!citations.length) return null;

  // Dedupe by domain+title so repeated searches do not flood the message.
  const unique: Citation[] = [];
  const seen = new Set<string>();
  for (const citation of citations) {
    const key = `${citation.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(citation);
  }
  const visible = expanded ? unique : unique.slice(0, MAX_VISIBLE);
  const hidden = unique.length - visible.length;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {visible.map((citation) => {
        const domain = (citation.siteName?.trim() || hostnameOf(citation.url)).replace(/^www\./, '');
        return (
          <button
            key={citation.id || citation.url}
            type="button"
            onClick={() => void openExternalUrl(citation.url)}
            title={citation.title || domain}
            className={cn(
              'group flex h-6 max-w-60 items-center gap-1.5 rounded-full border border-border bg-surface px-2',
              'text-[11px] text-foreground-muted transition-colors duration-150',
              'hover:border-border-strong hover:bg-surface-hover hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            )}
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[9px] font-semibold uppercase leading-none text-accent">
              {domain.charAt(0) || '•'}
            </span>
            <span className="min-w-0 truncate font-medium">{domain}</span>
            {citation.title ? (
              <>
                <span aria-hidden className="shrink-0 text-foreground-subtle">
                  ·
                </span>
                <span className="min-w-0 truncate text-foreground-subtle">{truncate(citation.title, 42)}</span>
              </>
            ) : null}
          </button>
        );
      })}
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={cn(
            'flex h-6 items-center gap-1 rounded-full border border-dashed border-border bg-transparent px-2',
            'text-[11px] font-medium text-foreground-subtle transition-colors duration-150',
            'hover:border-border-strong hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          )}
        >
          <Plus aria-hidden className="size-3" />
          {hidden} fonte{hidden > 1 ? 's' : ''}
        </button>
      ) : null}
      {expanded && unique.length > MAX_VISIBLE ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex h-6 items-center rounded-full px-2 text-[11px] font-medium text-foreground-subtle transition-colors hover:text-foreground"
        >
          Mostrar menos
        </button>
      ) : null}
    </div>
  );
}
