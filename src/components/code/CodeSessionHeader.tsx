import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Folder, PanelRight, Plus, X } from 'lucide-react';
import { IconButton, Tooltip } from '@/components/ui';
import { filterConversationsForLayout } from '@/lib/conversations';
import { useChatStore, useUiStore } from '@/lib/store';
import type { Conversation } from '@/lib/types';
import { SIDE_PANEL_DOCK_MIN_VIEWPORT, useViewportWidth } from '@/lib/sidePanel';
import { cn } from '@/lib/utils';

/** Synthetic tab shown when the Code layout has no active conversation. */
const NEW_SESSION_ID = '__new_session__';
const NEW_SESSION_TITLE = 'Nova sessão';

/**
 * Id of the conversation surface the session tabs control. `WorkspaceCenter`
 * (layout/) owns that element and should render it with this id so
 * `aria-controls` points at a real region.
 */
const SESSION_PANEL_ID = 'code-session-panel';

interface SessionTab {
  id: string;
  title: string;
}

function sessionTitle(conversations: Conversation[], id: string): string {
  return conversations.find((conversation) => conversation.id === id)?.title ?? NEW_SESSION_TITLE;
}

/**
 * Code session chrome (PLAN §3.3): header with the active conversation title,
 * the workspace chip ("Sem workspace" until the harness lands), the right panel
 * toggle and the open-session tabs. Tabs are a local view of the real
 * `chatStore` conversations — no new backend state.
 */
export function CodeSessionHeader() {
  const activeId = useChatStore((state) => state.activeId);
  const conversations = useChatStore((state) => state.conversations);
  const codePanelOpen = useUiStore((state) => state.codePanelOpen);
  const toggleCodePanel = useUiStore((state) => state.toggleCodePanel);
  const viewportWidth = useViewportWidth();
  /** The docked code panel only exists on wide windows (see CodePanel). */
  const canDock = viewportWidth >= SIDE_PANEL_DOCK_MIN_VIEWPORT;

  // Sessions are separated per layout: the Code tabs only ever mirror Code
  // sessions and Chat sessions explicitly shared with Code (chat-code-sessions).
  const codeConversations = useMemo(
    () => filterConversationsForLayout(conversations, 'code'),
    [conversations],
  );

  const [openIds, setOpenIds] = useState<string[]>(() => (activeId ? [activeId] : []));
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const addTabRef = (id: string) => (node: HTMLButtonElement | null) => {
    if (node) tabRefs.current.set(id, node);
    else tabRefs.current.delete(id);
  };
  const plusRef = useRef<HTMLButtonElement | null>(null);

  /** Restores keyboard focus after closing a tab (R3 do EVIDENCE da fase 1). */
  const focusTab = (id: string | undefined) => {
    window.setTimeout(() => {
      if (id) tabRefs.current.get(id)?.focus();
      else plusRef.current?.focus();
    }, 0);
  };

  /* The active conversation always becomes a tab; tabs of deleted (or no
     longer Code-visible) conversations are dropped. Comparing before returning
     keeps the previous array (and the render) when nothing changed. */
  useEffect(() => {
    const known = new Set(codeConversations.map((conversation) => conversation.id));
    setOpenIds((previous) => {
      const next = previous.filter((id) => known.has(id));
      if (activeId && known.has(activeId) && !next.includes(activeId)) next.push(activeId);
      if (next.length === previous.length && next.every((id, index) => id === previous[index])) {
        return previous;
      }
      return next;
    });
  }, [activeId, codeConversations]);

  const activeConversation = activeId
    ? codeConversations.find((conversation) => conversation.id === activeId)
    : undefined;
  const title = activeConversation?.title ?? NEW_SESSION_TITLE;
  const tabs: SessionTab[] =
    openIds.length === 0
      ? []
      : openIds.map((id) => ({ id, title: sessionTitle(codeConversations, id) }));
  /* No active Code session (no conversation, or it belongs to Chat only): the
     tab strip falls back to the synthetic "Nova sessão" tab, so the tablist
     always has exactly one selected tab. */
  const showNewSessionTab = activeConversation === undefined;

  const selectTab = (id: string) => {
    if (id === NEW_SESSION_ID || id === activeId) return;
    useUiStore.getState().setCodeView('session');
    void useChatStore.getState().openConversation(id);
  };

  const closeTab = (id: string) => {
    if (id === NEW_SESSION_ID) return;
    const index = tabs.findIndex((tab) => tab.id === id);
    const rest = tabs.filter((tab) => tab.id !== id);
    setOpenIds(rest.map((tab) => tab.id));
    if (id !== activeId) {
      focusTab(activeId ?? undefined);
      return;
    }
    // Closing the active tab falls back to the next one, then to the previous;
    // closing the last tab returns to the "Nova sessão" welcome state. The
    // conversation itself stays in the history (there is no backend close).
    const neighbor = tabs[index + 1] ?? tabs[index - 1];
    if (neighbor) {
      void useChatStore.getState().openConversation(neighbor.id);
      focusTab(neighbor.id);
    } else {
      useChatStore.getState().clearActiveConversation();
      focusTab(undefined);
    }
  };

  const createSession = () => {
    useUiStore.getState().setCodeView('session');
    void useChatStore.getState().startNewConversation('code');
  };

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLElement>, id: string) => {
    const tablist = event.currentTarget.closest('[role="tablist"]');
    const items = tablist ? Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]')) : [];
    const index = items.indexOf(event.currentTarget);
    const focusAt = (nextIndex: number) => {
      const element = items[nextIndex];
      if (!element) return;
      event.preventDefault();
      element.focus();
    };

    switch (event.key) {
      case 'ArrowRight':
        focusAt((index + 1) % items.length);
        break;
      case 'ArrowLeft':
        focusAt((index - 1 + items.length) % items.length);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(items.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        selectTab(id);
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        closeTab(id);
        break;
      default:
        break;
    }
  };

  const panelLabel = codePanelOpen ? 'Ocultar painel de arquivos' : 'Mostrar painel de arquivos';
  const panelButton = (
    <IconButton
      label={panelLabel}
      size="sm"
      active={codePanelOpen}
      aria-pressed={codePanelOpen}
      disabled={!canDock}
      onClick={toggleCodePanel}
    >
      <PanelRight className="size-4" />
    </IconButton>
  );

  return (
    <header className="flex shrink-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2
          className="min-w-0 truncate text-[13px] font-semibold tracking-tight text-foreground"
          title={title}
        >
          {title}
        </h2>
        <span
          className="inline-flex h-6 max-w-44 shrink-0 items-center gap-1.5 rounded-full border border-border px-2 text-[11.5px] text-foreground-muted"
          title="O workspace do agente chega com o harness de código"
        >
          <Folder aria-hidden className="size-3 shrink-0" strokeWidth={1.75} />
          <span className="truncate">Sem workspace</span>
        </span>
        <div className="ml-auto flex shrink-0 items-center">
          {canDock ? (
            <Tooltip content={panelLabel} side="bottom">
              {panelButton}
            </Tooltip>
          ) : (
            <Tooltip content="Aumente a janela para ver o painel de arquivos" side="bottom">
              {/* Disabled buttons swallow pointer events: hover the wrapper so the hint stays discoverable. */}
              <span className="inline-flex" title="Aumente a janela para ver o painel de arquivos">
                {panelButton}
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        <div
          role="tablist"
          aria-label="Sessões abertas"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-0.5"
        >
          {showNewSessionTab ? (
            <div
              role="tab"
              aria-label={NEW_SESSION_TITLE}
              aria-selected
              aria-controls={SESSION_PANEL_ID}
              title={NEW_SESSION_TITLE}
              tabIndex={0}
              className={cn(
                'flex h-8 max-w-44 shrink-0 select-none items-center rounded-lg border border-border',
                'bg-surface-raised pl-2.5 pr-2 text-[12px] text-foreground shadow-sm',
                'outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              )}
            >
              <span className="truncate">{NEW_SESSION_TITLE}</span>
            </div>
          ) : (
            tabs.map((tab) => {
              const selected = tab.id === activeId;
              return (
                <div
                  key={tab.id}
                  role="presentation"
                  className={cn(
                    'group flex h-8 max-w-44 shrink-0 items-center rounded-lg border transition-colors duration-150',
                    selected
                      ? 'border-border bg-surface-raised text-foreground shadow-sm'
                      : 'border-transparent text-foreground-muted hover:bg-surface-hover hover:text-foreground',
                  )}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-label={tab.title}
                    aria-selected={selected}
                    aria-controls={SESSION_PANEL_ID}
                    title={tab.title}
                    tabIndex={selected ? 0 : -1}
                    ref={addTabRef(tab.id)}
                    onClick={() => selectTab(tab.id)}
                    onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                    className={cn(
                      'h-full min-w-0 flex-1 cursor-pointer select-none rounded-l-lg pl-2.5 text-left text-[12px]',
                      'outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    )}
                  >
                    <span className="block truncate">{tab.title}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Fechar ${tab.title}`}
                    tabIndex={-1}
                    onClick={() => closeTab(tab.id)}
                    className={cn(
                      'mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-subtle',
                      'transition-colors duration-150 hover:bg-surface-active hover:text-foreground',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    )}
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <Tooltip content="Nova sessão" side="bottom">
          <IconButton ref={plusRef} label="Nova sessão" size="sm" onClick={createSession}>
            <Plus className="size-4" />
          </IconButton>
        </Tooltip>
      </div>
    </header>
  );
}

export default CodeSessionHeader;
