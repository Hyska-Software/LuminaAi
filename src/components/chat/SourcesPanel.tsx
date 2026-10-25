import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Globe, X } from 'lucide-react';
import { PanelResizer } from '@/components/layout/PanelResizer';
import { Badge, IconButton, Tooltip } from '@/components/ui';
import { citationDomain, conversationCitations } from '@/lib/citations';
import {
  clampSidePanelWidth,
  selectActiveMessages,
  SIDE_PANEL_WIDTH_DEFAULT,
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_WIDTH_MIN,
  SIDE_PANEL_WIDTH_STEP,
  useChatStore,
  useUiStore,
} from '@/lib/store';
import type { Citation } from '@/lib/types';
import { cn } from '@/lib/utils';
import { openExternalUrl } from './external';

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** One source row: domain + truncated title; the whole row opens the browser. */
function SourceRow({ citation }: { citation: Citation }) {
  const domain = citationDomain(citation);
  const title = citation.title?.trim() || domain;

  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => void openExternalUrl(citation.url)}
        title={title}
        className={cn(
          'group/source flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left',
          'transition-colors duration-150 hover:bg-surface-hover',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        )}
      >
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-[10px] font-semibold uppercase leading-none text-accent"
        >
          {domain.charAt(0) || '•'}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-snug text-foreground">
            {domain}
          </span>
          <span className="mt-0.5 block truncate text-[11px] leading-snug text-foreground-muted">
            {title}
          </span>
        </span>

        <ExternalLink
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-foreground-subtle opacity-0 transition-opacity duration-150',
            'group-hover/source:opacity-100 group-focus-visible/source:opacity-100',
            'motion-reduce:transition-none',
          )}
        />
      </button>
    </li>
  );
}

/**
 * Side panel listing every source (citation) of the conversation (DESIGN §5),
 * in first-use order and deduplicated by URL. Same slide-in surface as the
 * artifact panel; visibility and mutual exclusion live in `useUiStore`.
 */
export function SourcesPanel() {
  const open = useUiStore((state) => state.sourcesPanelOpen);
  const closeSourcesPanel = useUiStore((state) => state.closeSourcesPanel);
  const sidePanelWidth = useUiStore((state) => state.sidePanelWidth);
  const setSidePanelWidth = useUiStore((state) => state.setSidePanelWidth);
  const messages = useChatStore(selectActiveMessages);
  const sources = useMemo(() => conversationCitations(messages), [messages]);
  const panelRef = useRef<HTMLElement | null>(null);

  /** Width previewed while dragging; `null` means "use the persisted width". */
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const effectiveWidth = clampSidePanelWidth(liveWidth ?? sidePanelWidth);

  const handleResize = useCallback((next: number) => {
    setLiveWidth(clampSidePanelWidth(next));
  }, []);

  const handleResizeEnd = useCallback(
    (next: number) => {
      // The store clamps as well; the local preview disappears in the same commit.
      setSidePanelWidth(next);
      setLiveWidth(null);
    },
    [setSidePanelWidth],
  );

  const handleReset = useCallback(() => {
    setSidePanelWidth(SIDE_PANEL_WIDTH_DEFAULT);
    setLiveWidth(null);
  }, [setSidePanelWidth]);

  /* A drag interrupted by closing the panel never receives its release: drop
     the stale preview so the persisted width takes over. */
  useEffect(() => {
    if (!open) setLiveWidth(null);
  }, [open]);

  // Move focus into the panel when it opens so keyboard users can browse the list.
  useEffect(() => {
    if (!open) return undefined;
    const handle = window.requestAnimationFrame(() => panelRef.current?.focus());
    return () => window.cancelAnimationFrame(handle);
  }, [open]);

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label="Painel de fontes"
      aria-hidden={!open || undefined}
      inert={!open}
      style={{ width: effectiveWidth }}
      className={cn(
        'fixed inset-y-0 right-0 z-40 flex max-w-[92vw] flex-col border-l border-border bg-surface-raised shadow-2xl outline-none',
        'transition-transform duration-[240ms] ease-[var(--ease-out-soft)] motion-reduce:transition-none',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Globe aria-hidden className="size-4" strokeWidth={1.9} />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-foreground">
          Fontes
        </h2>
        <Badge
          tone="muted"
          size="md"
          title={pluralize(sources.length, 'fonte', 'fontes')}
          className="tabular-nums"
        >
          {sources.length}
        </Badge>
        <Tooltip content="Fechar" side="bottom">
          <IconButton label="Fechar painel de fontes" size="sm" onClick={closeSourcesPanel}>
            <X className="size-4" />
          </IconButton>
        </Tooltip>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {sources.length > 0 ? (
          <ul aria-label="Fontes da conversa" className="flex min-w-0 flex-col gap-0.5">
            {sources.map((citation) => (
              <SourceRow key={citation.id || citation.url} citation={citation} />
            ))}
          </ul>
        ) : (
          <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
            <Globe aria-hidden className="size-6 text-foreground-subtle" strokeWidth={1.9} />
            <p className="text-[13px] font-medium text-foreground">Nenhuma fonte nesta conversa</p>
            <p className="max-w-64 text-xs leading-relaxed text-foreground-muted">
              Quando o agente pesquisar na web, as fontes aparecem aqui.
            </p>
          </div>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2 text-[11px] text-foreground-subtle">
        <span className="tabular-nums">{pluralize(sources.length, 'fonte', 'fontes')}</span>
        <span>Abre no navegador padrão</span>
      </footer>

      {/* Fora do fluxo, sobre a borda esquerda: não cobre a lista nem a scrollbar.
          O containing block vem do próprio painel (`position: fixed`), então não
          é preciso um `relative` conflitante para ancorar o handle. */}
      <PanelResizer
        side="end"
        value={effectiveWidth}
        min={SIDE_PANEL_WIDTH_MIN}
        max={SIDE_PANEL_WIDTH_MAX}
        step={SIDE_PANEL_WIDTH_STEP}
        label="Redimensionar painel de fontes"
        className="absolute inset-y-0 -left-2 z-10"
        onResize={handleResize}
        onResizeEnd={handleResizeEnd}
        onReset={handleReset}
      />
    </aside>
  );
}

export default SourcesPanel;
