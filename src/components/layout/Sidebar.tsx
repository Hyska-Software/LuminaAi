import { useMemo, useRef, useState, type ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Download, Ellipsis, Pencil, Pin, PinOff, Search, Settings, SquarePen, Trash, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAppStore, useChatStore, useUiStore } from '@/lib/store';
import type { Conversation } from '@/lib/types';
import { cn, groupConversations, modKey } from '@/lib/utils';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Kbd,
} from '@/components/ui';
import { useIsCompact } from './hooks';

export interface SidebarProps {
  className?: string;
  /** Present when the sidebar is rendered as an overlay drawer (< 1024px). */
  onClose?: () => void;
}

interface MenuEntryProps {
  icon: ReactNode;
  children: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

function MenuEntry({ icon, children, danger, onSelect }: MenuEntryProps) {
  return (
    <DropdownMenu.Item
      onSelect={() => onSelect()}
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] outline-none',
        danger
          ? 'text-danger data-[highlighted]:bg-danger-soft'
          : 'text-foreground data-[highlighted]:bg-surface-hover',
      )}
    >
      <span className={cn('shrink-0', danger ? 'text-danger' : 'text-foreground-subtle')}>{icon}</span>
      {children}
    </DropdownMenu.Item>
  );
}

interface ConversationRowProps {
  conversation: Conversation;
  active: boolean;
  renaming: boolean;
  renameValue: string;
  onSelect: () => void;
  onStartRename: () => void;
  onRenameValueChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onTogglePin: () => void;
  onExport: () => void;
  onDelete: () => void;
}

function ConversationRow({
  conversation,
  active,
  renaming,
  renameValue,
  onSelect,
  onStartRename,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onTogglePin,
  onExport,
  onDelete,
}: ConversationRowProps) {
  if (renaming) {
    return (
      <div className="relative flex items-center">
        <input
          autoFocus
          value={renameValue}
          onChange={(event) => onRenameValueChange(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={onCommitRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              onCommitRename();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              onCancelRename();
            }
          }}
          aria-label="Renomear conversa"
          className={cn(
            'h-8 w-full min-w-0 rounded-lg border border-accent bg-background px-2',
            'text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent/30',
          )}
        />
      </div>
    );
  }

  return (
    <div className="group relative flex items-center">
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        title={conversation.title}
        className={cn(
          'flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 pr-8 text-left text-[13px]',
          'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          active
            ? 'bg-surface-active text-foreground'
            : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
        )}
      >
        {conversation.pinned ? <Pin className="size-3.5 shrink-0 text-foreground-subtle" /> : null}
        <span className="truncate">{conversation.title}</span>
      </button>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label="Opções da conversa"
            onClick={(event) => event.stopPropagation()}
            className={cn(
              'absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md',
              'text-foreground-subtle transition-colors duration-150 hover:bg-surface-active hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              'opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 lg:data-[state=open]:opacity-100',
            )}
          >
            <Ellipsis className="size-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className={cn(
              'z-50 min-w-44 rounded-xl border border-border bg-surface-raised p-1 shadow-lg animate-fade-in',
            )}
          >
            <MenuEntry
              icon={conversation.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              onSelect={onTogglePin}
            >
              {conversation.pinned ? 'Desafixar' : 'Fixar'}
            </MenuEntry>
            <MenuEntry icon={<Pencil className="size-3.5" />} onSelect={onStartRename}>
              Renomear
            </MenuEntry>
            <MenuEntry icon={<Download className="size-3.5" />} onSelect={onExport}>
              Exportar
            </MenuEntry>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <MenuEntry icon={<Trash className="size-3.5" />} danger onSelect={onDelete}>
              Excluir
            </MenuEntry>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

/** Conversation sidebar (DESIGN §5): new chat, search, grouped history and footer. */
export function Sidebar({ className, onClose }: SidebarProps) {
  const conversations = useChatStore((state) => state.conversations);
  const conversationsLoading = useChatStore((state) => state.conversationsLoading);
  const activeId = useChatStore((state) => state.activeId);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const appInfo = useAppStore((state) => state.appInfo);
  const isCompact = useIsCompact();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const cancelRenameRef = useRef(false);

  const groups = useMemo(() => groupConversations(conversations), [conversations]);

  const handleNewChat = () => {
    void useChatStore.getState().startNewConversation();
    if (isCompact) onClose?.();
  };

  const handleSelect = (id: string) => {
    void useChatStore.getState().openConversation(id);
    if (isCompact) onClose?.();
  };

  const handleStartRename = (conversation: Conversation) => {
    cancelRenameRef.current = false;
    setRenamingId(conversation.id);
    setRenameValue(conversation.title);
  };

  const handleCancelRename = () => {
    cancelRenameRef.current = true;
    setRenamingId(null);
  };

  const handleCommitRename = () => {
    const id = renamingId;
    if (!id) return;
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      return;
    }
    const title = renameValue.trim();
    setRenamingId(null);
    const current = conversations.find((item) => item.id === id);
    if (title && title !== current?.title) {
      void useChatStore.getState().renameConversation(id, title);
    }
  };

  const handleTogglePin = (conversation: Conversation) => {
    void useChatStore.getState().togglePinned(conversation.id);
  };

  const handleExport = async (conversation: Conversation) => {
    try {
      const path = await api.exportConversation(conversation.id, 'markdown');
      if (path) toast.success('Conversa exportada', { description: path });
    } catch (error) {
      toast.error('Não foi possível exportar', { description: String(error) });
    }
  };

  const handleConfirmDelete = async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    await useChatStore.getState().deleteConversation(target.id);
  };

  return (
    <aside
      aria-label="Conversas"
      className={cn('flex h-full w-[272px] shrink-0 flex-col border-r border-border bg-surface', className)}
    >
      <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-3">
        <Button
          variant="secondary"
          size="md"
          onClick={handleNewChat}
          leftIcon={<SquarePen className="size-4" />}
          className="h-9 flex-1 justify-start rounded-xl px-3 text-[13px] font-medium"
        >
          Novo chat
        </Button>
        {onClose ? (
          <IconButton label="Fechar barra lateral" size="sm" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        className={cn(
          'mx-3 mt-1 flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] text-foreground-muted',
          'transition-colors duration-150 hover:bg-surface-hover hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        )}
      >
        <Search className="size-4" />
        <span>Buscar conversas</span>
        <span className="ml-auto flex items-center gap-0.5">
          <Kbd>{modKey}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {conversationsLoading && conversations.length === 0 ? (
          <div className="flex flex-col gap-2 px-1 py-3" role="status" aria-label="Carregando conversas">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="h-7 animate-pulse rounded-lg bg-surface-hover motion-reduce:animate-none" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs leading-relaxed text-foreground-subtle">
            Nenhuma conversa ainda.
            <br />
            Comece um novo chat.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="mb-1">
              <h2 className="px-2 pb-1 pt-3 text-[11px] font-medium text-foreground-subtle">{group.label}</h2>
              <div className="flex flex-col gap-0.5">
                {group.conversations.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    active={conversation.id === activeId}
                    renaming={renamingId === conversation.id}
                    renameValue={renameValue}
                    onSelect={() => handleSelect(conversation.id)}
                    onStartRename={() => handleStartRename(conversation)}
                    onRenameValueChange={setRenameValue}
                    onCommitRename={handleCommitRename}
                    onCancelRename={handleCancelRename}
                    onTogglePin={() => handleTogglePin(conversation)}
                    onExport={() => void handleExport(conversation)}
                    onDelete={() => setDeleteTarget(conversation)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      <div className="border-t border-border px-2 py-2">
        <button
          type="button"
          onClick={() => {
            setSettingsOpen(true);
            if (isCompact) onClose?.();
          }}
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

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => (open ? undefined : setDeleteTarget(null))}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Excluir conversa</DialogTitle>
          </DialogHeader>
          <DialogDescription className="px-6 pb-4">
            {deleteTarget ? `“${deleteTarget.title}” será removida permanentemente.` : ''} Esta ação não pode ser
            desfeita.
          </DialogDescription>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="danger" size="sm" onClick={() => void handleConfirmDelete()}>
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
