/**
 * Terminal tab of the Code right panel (WORKBENCH §7.3).
 *
 * This component is intentionally a thin view: `terminalManager` owns the PTY
 * sessions, xterm instances and IPC channels so switching to Arquivos/
 * Alterações, collapsing the panel or changing the session never leaks a
 * process. The view attaches the hosts of the active conversation and renders
 * the tabs/status/actions.
 */
import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { CircleStop, Eraser, Plus, RotateCcw, SquareTerminal, X } from 'lucide-react';
// Mandatory: without xterm.css the viewport/screen/char-measure elements fall
// back to normal DOM flow (visible "WWWW…" measure text and broken rows).
import '@xterm/xterm/css/xterm.css';

import {
  Button,
  IconButton,
  Spinner,
  Tooltip,
} from '@/components/ui';
import type { TerminalTabInfo } from './terminalManager';
import { terminalManager } from './terminalManager';
import { cn } from '@/lib/utils';

interface TerminalPanelProps {
  conversationId: string;
  className?: string;
}

function tabDisplayName(tab: TerminalTabInfo): string {
  if (tab.running) return tab.title;
  return `${tab.title} (encerrado)`;
}

/** Aba "Terminal" do painel direito: abas de terminais, xterm e foco. */
export function TerminalPanel({ conversationId, className }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const emptyCtaRef = useRef<HTMLButtonElement | null>(null);
  const previousTabs = useRef({ conversationId, count: 0 });
  const snapshot = useSyncExternalStore(
    terminalManager.subscribe,
    () => terminalManager.getSnapshot(conversationId),
    () => terminalManager.getSnapshot(conversationId),
  );

  const { tabs, activeId, loading, error, limit } = snapshot;
  const active = tabs.find((tab) => tab.id === activeId) ?? null;
  const atLimit = tabs.length >= limit;
  const blocked = atLimit;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Focus the terminal when the user explicitly opened the Terminal tab;
    // switching sessions from the sidebar must keep focus where it was.
    const activeElement = document.activeElement;
    const focusTerminal =
      activeElement instanceof HTMLElement && activeElement.id === 'code-panel-tab-terminal';
    terminalManager.attach(conversationId, container, { focus: focusTerminal });
    return () => terminalManager.detach(conversationId, container);
  }, [conversationId]);

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => terminalManager.applyTheme());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fonts = document.fonts;
    if (fonts) {
      void fonts.ready
        .then(() => {
          if (!cancelled) terminalManager.refitAll();
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  /* Keep the active tab visible when the tab strip overflows (4 tabs in a
     narrow panel). */
  useEffect(() => {
    if (!activeId) return;
    const node = tabRefs.current.get(activeId);
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [activeId, tabs.length]);

  /* A vertical wheel scrolls the horizontal strip: otherwise the tabs that
     overflow a narrow panel are only reachable with a trackpad or Shift+wheel.
     The native listener is non-passive so it can stop the parent from scrolling. */
  useEffect(() => {
    const strip = tabStripRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => {
      if (strip.scrollWidth <= strip.clientWidth) return;
      // Trackpad gestures already carry deltaX; a mouse wheel only has deltaY.
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (delta === 0) return;
      const maxScroll = strip.scrollWidth - strip.clientWidth;
      const next = Math.min(maxScroll, Math.max(0, strip.scrollLeft + delta));
      if (next === strip.scrollLeft) return;
      event.preventDefault();
      strip.scrollLeft = next;
    };
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  }, []);

  /* Closing the last tab should not drop focus on <body>. */
  useEffect(() => {
    const previous = previousTabs.current;
    if (previous.conversationId === conversationId && previous.count > 0 && tabs.length === 0) {
      emptyCtaRef.current?.focus();
    }
    previousTabs.current = { conversationId, count: tabs.length };
  }, [conversationId, tabs.length]);

  const selectTab = (id: string, focusTerminal = true) => {
    terminalManager.activate(conversationId, id, { focusTerminal });
  };

  const closeTab = (tab: TerminalTabInfo) => {
    void terminalManager.close(conversationId, tab.id);
  };

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (index + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        nextIndex = (index - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = tabs[nextIndex];
    if (!next) return;
    selectTab(next.id, false);
    tabRefs.current.get(next.id)?.focus();
  };

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col bg-surface-raised', className)}>
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
        <div
          ref={tabStripRef}
          role="tablist"
          aria-label="Terminais abertos"
          className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          {tabs.map((tab) => {
            const selected = activeId === tab.id;
            return (
              <div
                key={tab.id}
                role="presentation"
                className={cn(
                  'flex h-7 max-w-40 shrink-0 items-center rounded-lg text-[12px] transition-colors duration-150',
                  selected
                    ? 'bg-surface-active text-foreground'
                    : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
                )}
              >
                <button
                  ref={(node) => {
                    if (node) tabRefs.current.set(tab.id, node);
                    else tabRefs.current.delete(tab.id);
                  }}
                  type="button"
                  role="tab"
                  id={`terminal-tab-${tab.id}`}
                  aria-selected={selected}
                  aria-controls="terminal-output"
                  tabIndex={selected ? 0 : -1}
                  title={tab.cwd ? `${tabDisplayName(tab)} — ${tab.cwd}` : tabDisplayName(tab)}
                  onClick={() => selectTab(tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                  className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-l-lg pl-2 pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <SquareTerminal
                    aria-hidden
                    className={cn(
                      'size-3.5 shrink-0',
                      tab.running ? 'text-foreground-subtle' : 'text-warning',
                    )}
                    strokeWidth={1.75}
                  />
                  <span className="min-w-0 truncate">{tab.title}</span>
                  {!tab.running ? (
                    <span
                      aria-hidden
                      className="ml-0.5 inline-flex size-1.5 shrink-0 rounded-full bg-warning"
                    />
                  ) : null}
                </button>
                <button
                  type="button"
                  aria-label={`Fechar ${tab.title}`}
                  title="Fechar aba e encerrar o shell"
                  onClick={() => closeTab(tab)}
                  className="mr-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-subtle transition-colors duration-150 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {active ? (
            <>
              <Tooltip content="Limpar terminal" side="bottom">
                <IconButton
                  label="Limpar terminal"
                  size="sm"
                  className="size-7"
                  onClick={() => terminalManager.clear(conversationId, active.id)}
                >
                  <Eraser aria-hidden className="size-3.5" strokeWidth={1.75} />
                </IconButton>
              </Tooltip>
              {active.running ? (
                <Tooltip content="Matar processo" side="bottom">
                  <IconButton
                    label="Matar processo"
                    size="sm"
                    className="size-7"
                    disabled={active.killing}
                    onClick={() => void terminalManager.kill(conversationId, active.id)}
                  >
                    {active.killing ? (
                      <Spinner size="xs" />
                    ) : (
                      <CircleStop aria-hidden className="size-4" strokeWidth={1.75} />
                    )}
                  </IconButton>
                </Tooltip>
              ) : (
                <Tooltip content="Reiniciar terminal" side="bottom">
                  <IconButton
                    label="Reiniciar terminal"
                    size="sm"
                    className="size-7"
                    disabled={loading}
                    onClick={() => void terminalManager.restart(conversationId, active.id)}
                  >
                    <RotateCcw aria-hidden className="size-3.5" strokeWidth={1.75} />
                  </IconButton>
                </Tooltip>
              )}
              <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
            </>
          ) : null}
          <Tooltip
            content={atLimit ? 'Limite de 4 terminais. Feche uma aba para abrir outro.' : 'Novo terminal'}
            side="bottom"
          >
            <span className="inline-flex">
              <IconButton
                label="Novo terminal"
                size="sm"
                className="size-7"
                loading={loading}
                disabled={blocked}
                onClick={() => void terminalManager.open(conversationId)}
              >
                <Plus aria-hidden className="size-4" strokeWidth={1.75} />
              </IconButton>
            </span>
          </Tooltip>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          title={error.detail}
          className="flex shrink-0 items-center gap-2 border-b border-border bg-danger-soft/40 px-3 py-2 text-[12px] text-danger"
        >
          <span className="min-w-0 flex-1">{error.message}</span>
          {error.canRetry ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-2 text-[11px]"
              leftIcon={<RotateCcw aria-hidden className="size-3" strokeWidth={1.75} />}
              onClick={() => void terminalManager.open(conversationId)}
            >
              Tentar novamente
            </Button>
          ) : null}
        </div>
      ) : null}

      <div
        role="tabpanel"
        id="terminal-output"
        aria-labelledby={active ? `terminal-tab-${active.id}` : undefined}
        aria-busy={loading || undefined}
        className="relative min-h-0 flex-1 overflow-hidden bg-background"
      >
        <div ref={containerRef} className="absolute inset-0" />
        {tabs.length === 0 && !loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-[13px] font-medium text-foreground">Nenhum terminal aberto</p>
            <p className="max-w-64 text-[12px] leading-relaxed text-foreground-muted">
              O terminal roda no diretório do workspace. O agente usa os próprios comandos e jobs.
            </p>
            <Button
              ref={emptyCtaRef}
              variant="secondary"
              size="sm"
              className="mt-1"
              disabled={loading || blocked}
              onClick={() => void terminalManager.open(conversationId)}
            >
              Abrir terminal
            </Button>
          </div>
        ) : null}
        {loading && tabs.length === 0 ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/85 px-6 text-center">
            <Spinner size="sm" />
            <p className="text-[12px] text-foreground-muted">Conectando ao shell…</p>
          </div>
        ) : null}
      </div>

      <div
        role="status"
        aria-live="polite"
        className="flex h-6 shrink-0 items-center gap-3 border-t border-border px-3 text-[11px] text-foreground-muted"
      >
        <span className="min-w-0 flex-1 truncate" title={active?.cwd || undefined}>
          {active ? active.cwd || active.title : 'Nenhum terminal ativo'}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums">
          {active ? (
            active.running ? (
              <span className="inline-flex items-center gap-1">
                <span
                  aria-hidden
                  className={cn(
                    'size-1.5 rounded-full bg-success',
                    !active.killing && 'motion-safe:animate-pulse',
                  )}
                />
                {active.killing ? 'Encerrando…' : `Rodando · ${active.cols}×${active.rows}`}
              </span>
            ) : (
              <span className="text-warning">
                Encerrado{active.exitCode !== null ? ` (${active.exitCode})` : ''}
              </span>
            )
          ) : null}
          <span className="text-foreground-muted">
            {tabs.length}/{limit}
          </span>
        </span>
      </div>
    </div>
  );
}

export default TerminalPanel;
