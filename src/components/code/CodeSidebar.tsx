import { useMemo, useState, type ReactNode } from 'react';
import { MessageSquare, MessageSquarePlus, Search, Settings, Sparkles, SquarePen, X } from 'lucide-react';
import { useAppStore, useChatStore, useUiStore } from '@/lib/store';
import { filterConversationsForLayout } from '@/lib/conversations';
import type { Conversation } from '@/lib/types';
import { cn, groupConversations, modKey } from '@/lib/utils';
import { Button, IconButton, Kbd } from '@/components/ui';
import { useIsCompact } from '@/components/layout/hooks';
import { AddChatSessionDialog } from './AddChatSessionDialog';

export interface CodeSidebarProps {
  className?: string;
  /** Present when the sidebar is rendered as an overlay drawer (< 1024px). */
  onClose?: () => void;
}

interface SidebarActionProps {
  icon: ReactNode;
  label: string;
  /** Accessible name; defaults to the visible label. */
  ariaLabel?: string;
  /** Marks the entry as the current page (Skills view). */
  current?: boolean;
  trailing?: ReactNode;
  onSelect: () => void;
}

/** Compact Paseo-style action row (PLAN §3.2). */
function SidebarAction({ icon, label, ariaLabel, current, trailing, onSelect }: SidebarActionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={ariaLabel}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'mx-3 mt-1 flex h-8 items-center gap-2 rounded-lg px-2 text-[13px]',
        'transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        current
          ? 'bg-surface-active text-foreground'
          : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
      )}
    >
      <span className={cn('shrink-0', current ? 'text-accent' : 'text-foreground-subtle')}>{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
      {trailing ? (
        <span className="ml-auto flex shrink-0 items-center gap-0.5">{trailing}</span>
      ) : null}
    </button>
  );
}

interface SessionRowProps {
  conversation: Conversation;
  active: boolean;
  /** Chat session explicitly added to the Code layout (docs/goals/chat-code-sessions). */
  shared: boolean;
  onSelect: () => void;
}

/** One real Code session row; the dot mirrors the Paseo status dot. */
function SessionRow({ conversation, active, shared, onSelect }: SessionRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      aria-label={shared ? `${conversation.title}, sessão compartilhada do Chat` : undefined}
      title={conversation.title}
      className={cn(
        'flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[13px]',
        'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        active
          ? 'bg-surface-active text-foreground'
          : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          active ? 'bg-accent' : 'bg-foreground-subtle',
        )}
      />
      <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
      {shared ? (
        <span
          title="Sessão compartilhada do Chat"
          className="ml-auto flex shrink-0 items-center gap-1 text-foreground-subtle"
        >
          <MessageSquare aria-hidden className="size-3.5" strokeWidth={1.75} />
          <span className="text-[10px] font-medium leading-none">Do Chat</span>
        </span>
      ) : null}
    </button>
  );
}

/**
 * Code layout sidebar (PLAN §3.2): compact actions, an honest empty Workspaces
 * section (the harness is not wired yet) and the Code session list. Chat and
 * Code have separate session lists — only Code-born sessions and Chat sessions
 * explicitly shared with Code appear here. There is no Biblioteca entry: that
 * page only exists in the Chat layout.
 */
export function CodeSidebar({ className, onClose }: CodeSidebarProps) {
  const conversations = useChatStore((state) => state.conversations);
  const conversationsLoading = useChatStore((state) => state.conversationsLoading);
  const activeId = useChatStore((state) => state.activeId);
  const codeView = useUiStore((state) => state.codeView);
  const setCodeView = useUiStore((state) => state.setCodeView);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const appInfo = useAppStore((state) => state.appInfo);
  const skillsPanelEnabled = useAppStore((state) => state.settings.skillsPanelEnabled);
  const isCompact = useIsCompact();

  const [addSessionOpen, setAddSessionOpen] = useState(false);

  const codeConversations = useMemo(
    () => filterConversationsForLayout(conversations, 'code'),
    [conversations],
  );
  const groups = useMemo(() => groupConversations(codeConversations), [codeConversations]);

  const handleNewAgent = () => {
    useUiStore.getState().setCodeView('session');
    void useChatStore.getState().startNewConversation('code');
    if (isCompact) onClose?.();
  };

  const handleAddSession = () => {
    setAddSessionOpen(true);
  };

  const handleSearch = () => {
    setCommandPaletteOpen(true);
  };

  const handleSkills = () => {
    setCodeView('skills');
    if (isCompact) onClose?.();
  };

  const handleSelect = (id: string) => {
    // A session click always leaves the Skills page and returns to the conversation.
    useUiStore.getState().setCodeView('session');
    void useChatStore.getState().openConversation(id);
    if (isCompact) onClose?.();
  };

  const handleOpenSettings = () => {
    setSettingsOpen(true);
    if (isCompact) onClose?.();
  };

  return (
    <aside
      aria-label="Sessões"
      className={cn('flex h-full w-full min-w-0 flex-col bg-surface', className)}
    >
      <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-3">
        <Button
          variant="secondary"
          size="md"
          onClick={handleNewAgent}
          leftIcon={<SquarePen className="size-4" />}
          className="h-9 flex-1 justify-start rounded-xl px-3 text-[13px] font-medium"
        >
          Novo agente
        </Button>
        {onClose ? (
          <IconButton label="Fechar barra lateral" size="sm" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        ) : null}
      </div>

      <SidebarAction
        icon={<MessageSquarePlus className="size-4" />}
        label="Adicionar sessão do Chat"
        ariaLabel="Adicionar sessão do Chat"
        onSelect={handleAddSession}
      />
      <SidebarAction
        icon={<Search className="size-4" />}
        label="Buscar"
        trailing={
          <>
            <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd>
          </>
        }
        onSelect={handleSearch}
      />
      {skillsPanelEnabled ? (
        <SidebarAction
          icon={<Sparkles className="size-4" />}
          label="Skills"
          ariaLabel="Skills"
          current={codeView === 'skills'}
          onSelect={handleSkills}
        />
      ) : null}

      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden">
        <section aria-labelledby="code-workspaces-heading" className="shrink-0 border-t border-border px-3 pb-1 pt-3">
          <h2
            id="code-workspaces-heading"
            className="text-[11px] font-medium tracking-tight text-foreground-subtle"
          >
            Workspaces
          </h2>
          <div className="mt-2">
            <p className="text-[12.5px] font-medium text-foreground-muted">Nenhum workspace aberto</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-foreground-subtle">
              Os workspaces do harness de código aparecem aqui na próxima etapa.
            </p>
          </div>
        </section>

        <section
          aria-labelledby="code-sessions-heading"
          className="mt-3 flex min-h-0 flex-1 flex-col border-t border-border pt-3"
        >
          <h2
            id="code-sessions-heading"
            className="px-3 text-[11px] font-medium tracking-tight text-foreground-subtle"
          >
            Sessões
          </h2>

          <div className="mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
            {conversationsLoading && conversations.length === 0 ? (
              <div className="flex flex-col gap-2 px-1 py-3" role="status" aria-label="Carregando sessões">
                {[0, 1, 2, 3].map((index) => (
                  <div
                    key={index}
                    className="h-7 animate-pulse rounded-lg bg-surface-hover motion-reduce:animate-none"
                  />
                ))}
              </div>
            ) : groups.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs leading-relaxed text-foreground-subtle">
                <span className="block">Nenhuma sessão ainda.</span>
                <span className="block">Comece um novo agente ou adicione uma sessão do Chat.</span>
              </p>
            ) : (
              groups.map((group) => (
                <section key={group.label} aria-label={group.label} className="mb-1">
                  <h3 className="px-2 pb-1 pt-3 text-[11px] font-medium text-foreground-subtle">
                    {group.label}
                  </h3>
                  <div className="flex flex-col gap-0.5">
                    {group.conversations.map((conversation) => (
                      <SessionRow
                        key={conversation.id}
                        conversation={conversation}
                        active={conversation.id === activeId}
                        shared={conversation.codeLinked === true}
                        onSelect={() => handleSelect(conversation.id)}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="border-t border-border px-2 py-2">
        <button
          type="button"
          onClick={handleOpenSettings}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-lg px-2 text-[13px] text-foreground-muted',
            'transition-colors duration-150 hover:bg-surface-hover hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          )}
        >
          <Settings className="size-4" />
          <span>Configurações</span>
          <span className="ml-auto text-[11px] tabular-nums text-foreground-subtle">
            {appInfo?.version ? `v${appInfo.version}` : ''}
          </span>
        </button>
      </div>

      <AddChatSessionDialog
        open={addSessionOpen}
        onOpenChange={setAddSessionOpen}
        onAdded={() => {
          // The compact drawer must reveal the session it just opened.
          if (isCompact) onClose?.();
        }}
      />
    </aside>
  );
}

export default CodeSidebar;
