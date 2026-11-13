import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { citationDomain, MAX_INLINE_CITATIONS, uniqueCitations } from '@/lib/citations';
import { useUiStore } from '@/lib/store';
import type { Citation } from '@/lib/types';
import { cn, truncate } from '@/lib/utils';
import { openExternalUrl } from './external';

export interface CitationChipsProps {
  citations: Citation[];
  className?: string;
}

/**
 * Source chips for tool citations (DESIGN §6.3): domain + truncated title, with
 * at most `MAX_INLINE_CITATIONS` chips. The remaining sources are not expanded
 * inline anymore — the "+ N sources" button opens the sources side panel.
 */
export function CitationChips({ citations, className }: CitationChipsProps) {
  const { t } = useTranslation('chat');
  const unique = uniqueCitations(citations);
  if (!unique.length) return null;

  const visible = unique.slice(0, MAX_INLINE_CITATIONS);
  const hidden = unique.length - visible.length;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {visible.map((citation) => {
        const domain = citationDomain(citation);
        return (
          <button
            key={citation.id || citation.url}
            type="button"
            onClick={() => void openExternalUrl(citation.url)}
            title={citation.title || domain}
            className={cn(
              'group flex h-6 max-w-60 items-center gap-1.5 rounded-full bg-surface px-2',
              'text-[11px] text-foreground-muted transition-colors duration-150',
              ' hover:bg-surface-hover hover:text-foreground',
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
          onClick={() => useUiStore.getState().openSourcesPanel()}
          aria-label={t('citations.openHidden', { count: hidden })}
          className={cn(
            'flex h-6 items-center gap-1 rounded-full border-dashed bg-transparent px-2',
            'text-[11px] font-medium text-foreground-subtle transition-colors duration-150',
            ' hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          )}
        >
          <Plus aria-hidden className="size-3" />
          {t('citations.hidden', { count: hidden })}
        </button>
      ) : null}
    </div>
  );
}
