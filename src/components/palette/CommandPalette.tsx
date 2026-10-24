import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Download,
  FileText,
  Lock,
  MessageSquarePlus,
  PanelLeft,
  Search,
  Settings,
  Sparkles,
  SunMoon,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
  MODEL_LOCKED_DESCRIPTION,
  MODEL_LOCKED_TITLE,
  resolveDark,
  selectModelLocked,
  useAppStore,
  useChatStore,
  useUiStore,
} from '@/lib/store';
import { cn, copyText, modKey } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle, Kbd } from '@/components/ui';

interface PaletteAction {
  id: string;
  label: string;
  description?: string;
  group: string;
  icon: LucideIcon;
  shortcut?: string;
  keywords?: string;
  run: () => void | Promise<void>;
}

const GROUP_ORDER = ['Conversas', 'Navegação', 'Aparência'] as const;

async function copyLastAnswer() {
  const chat = useChatStore.getState();
  const conversationId = chat.activeId;
  if (!conversationId) {
    toast.info('Nenhuma conversa aberta');
    return;
  }
  const messages = chat.messagesFor(conversationId);
  const last = [...messages].reverse().find((message) => message.role === 'assistant' && message.content.trim());
  if (!last) {
    toast.info('Nenhuma resposta para copiar ainda');
    return;
  }
  const ok = await copyText(last.content);
  if (ok) toast.success('Resposta copiada');
  else toast.error('Não foi possível copiar');
}

async function exportActiveConversation() {
  const conversationId = useChatStore.getState().activeId;
  if (!conversationId) {
    toast.info('Nenhuma conversa aberta');
    return;
  }
  try {
    const path = await api.exportConversation(conversationId, 'markdown');
    if (path) toast.success('Conversa exportada', { description: path });
  } catch (error) {
    toast.error('Não foi possível exportar', {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

function toggleTheme() {
  const ui = useUiStore.getState();
  const next = resolveDark(ui.theme) ? 'light' : 'dark';
  ui.setTheme(next);
  void useAppStore.getState().saveSettings({ theme: next });
}

function openArtifacts() {
  const ui = useUiStore.getState();
  if (!ui.artifacts.length) {
    toast.info('Nenhum artefato nesta conversa');
    return;
  }
  ui.openArtifactPanel();
}

function clearAttachments() {
  useChatStore.getState().clearAttachments();
  toast.success('Anexos removidos');
}

/**
 * Command palette (DESIGN §10): ⌘K opens a 640px overlay with searchable
 * actions, ↑/↓/Enter navigation and shortcut hints. Visibility is driven by
 * `useUiStore.commandPaletteOpen` (the global hotkey lives in AppShell).
 */
export function CommandPalette() {
  const open = useUiStore((state) => state.commandPaletteOpen);
  const setOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const locked = useChatStore(selectModelLocked);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  const actions = useMemo<PaletteAction[]>(
    () => [
      {
        id: 'new-chat',
        group: 'Conversas',
        label: 'Novo chat',
        description: 'Comece uma conversa em branco',
        icon: MessageSquarePlus,
        shortcut: `${modKey}+N`,
        keywords: 'nova conversa criar',
        run: () => void useChatStore.getState().startNewConversation(),
      },
      {
        id: 'search-conversations',
        group: 'Conversas',
        label: 'Buscar conversas',
        description: 'Pesquise no histórico local',
        icon: Search,
        keywords: 'histórico procurar',
        run: () => useUiStore.getState().setSearchOpen(true),
      },
      {
        id: 'export-conversation',
        group: 'Conversas',
        label: 'Exportar conversa',
        description: 'Salvar a conversa atual em Markdown',
        icon: Download,
        keywords: 'salvar markdown arquivo',
        run: () => void exportActiveConversation(),
      },
      {
        id: 'copy-last-answer',
        group: 'Conversas',
        label: 'Copiar última resposta',
        description: 'Copia o texto da resposta mais recente',
        icon: Copy,
        keywords: 'copiar clipboard',
        run: () => void copyLastAnswer(),
      },
      {
        id: 'clear-attachments',
        group: 'Conversas',
        label: 'Limpar anexos',
        description: 'Remove os anexos pendentes do composer',
        icon: Trash2,
        keywords: 'arquivos remover',
        run: clearAttachments,
      },
      {
        id: 'open-settings',
        group: 'Navegação',
        label: 'Abrir configurações',
        description: 'Tema, provedores, modelo padrão e ferramentas',
        icon: Settings,
        shortcut: `${modKey}+,`,
        keywords: 'preferências ajustes',
        run: () => useUiStore.getState().setSettingsOpen(true),
      },
      {
        id: 'switch-model',
        group: 'Navegação',
        label: 'Trocar modelo',
        description: locked ? MODEL_LOCKED_DESCRIPTION : 'Escolher modelo e modo de pensamento',
        icon: locked ? Lock : Sparkles,
        keywords: 'modelo raciocínio pensamento',
        run: () => {
          if (locked) {
            toast.info(MODEL_LOCKED_TITLE, { description: MODEL_LOCKED_DESCRIPTION });
            return;
          }
          useUiStore.getState().setModelPickerOpen(true);
        },
      },
      {
        id: 'toggle-sidebar',
        group: 'Navegação',
        label: 'Alternar barra lateral',
        description: 'Mostrar ou ocultar o histórico',
        icon: PanelLeft,
        shortcut: `${modKey}+B`,
        keywords: 'sidebar histórico',
        run: () => useUiStore.getState().toggleSidebar(),
      },
      {
        id: 'open-artifacts',
        group: 'Navegação',
        label: 'Abrir painel de artefatos',
        description: 'Prévia e ações dos arquivos da conversa',
        icon: FileText,
        keywords: 'arquivos canvas prévia',
        run: openArtifacts,
      },
      {
        id: 'toggle-theme',
        group: 'Aparência',
        label: 'Alternar tema',
        description: 'Troca entre claro e escuro',
        icon: SunMoon,
        keywords: 'dark light escuro claro aparência',
        run: toggleTheme,
      },
    ],
    [locked],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter((action) =>
      [action.label, action.description, action.keywords, action.group]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(needle)),
    );
  }, [actions, query]);

  const groups = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({ group, items: filtered.filter((action) => action.group === group) })).filter(
        (entry) => entry.items.length > 0,
      ),
    [filtered],
  );

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const selectedIndex = Math.min(index, Math.max(0, flat.length - 1));

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, open]);

  const execute = (action: PaletteAction) => {
    setOpen(false);
    void Promise.resolve(action.run()).catch((error: unknown) => {
      toast.error('Não foi possível executar a ação', {
        description: error instanceof Error ? error.message : String(error),
      });
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex(Math.min(flat.length - 1, selectedIndex + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex(Math.max(0, selectedIndex - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const action = flat[selectedIndex];
      if (action) execute(action);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  let flatOffset = -1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showClose={false}
        aria-describedby={undefined}
        className="mt-[9vh] w-[640px] max-w-[calc(100vw-2rem)] flex-none gap-0 self-start overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Paleta de comandos</DialogTitle>
        <DialogDescription className="sr-only">
          Busque e execute ações do Lumina. Use as setas para navegar e Enter para executar.
        </DialogDescription>

        <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-4">
          <Search aria-hidden className="size-4 shrink-0 text-foreground-subtle" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite um comando…"
            aria-label="Buscar comandos"
            role="combobox"
            aria-expanded
            aria-controls="lumina-command-list"
            aria-autocomplete="list"
            aria-activedescendant={
              flat[selectedIndex] ? `lumina-command-${flat[selectedIndex].id}` : undefined
            }
            autoFocus
            spellCheck={false}
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-subtle"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div
          id="lumina-command-list"
          role="listbox"
          aria-label="Comandos"
          className="max-h-[360px] overflow-y-auto p-1.5"
        >
          {groups.length ? (
            groups.map((group) => (
              <div key={group.group} className="flex flex-col">
                <span className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-foreground-subtle">
                  {group.group}
                </span>
                {group.items.map((action) => {
                  flatOffset += 1;
                  const itemIndex = flatOffset;
                  const isSelected = itemIndex === selectedIndex;
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.id}
                      id={`lumina-command-${action.id}`}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      tabIndex={-1}
                      ref={isSelected ? activeRef : undefined}
                      onMouseEnter={() => setIndex(itemIndex)}
                      onClick={() => execute(action)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-100',
                        isSelected ? 'bg-surface-hover' : 'hover:bg-surface-hover',
                        'focus-visible:outline-none',
                      )}
                    >
                      <Icon aria-hidden className="size-4 shrink-0 text-foreground-subtle" strokeWidth={1.9} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground">
                          {action.label}
                        </span>
                        {action.description ? (
                          <span className="block truncate text-[11px] text-foreground-subtle">
                            {action.description}
                          </span>
                        ) : null}
                      </span>
                      {action.shortcut ? (
                        <span className="flex shrink-0 items-center gap-1">
                          {action.shortcut.split('+').map((part) => (
                            <Kbd key={part}>{part}</Kbd>
                          ))}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
              <Search aria-hidden className="size-5 text-foreground-subtle" />
              <p className="text-[13px] font-medium text-foreground">Nenhum comando encontrado</p>
              <p className="text-xs text-foreground-muted">Tente outro termo.</p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2 text-[11px] text-foreground-subtle">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            navegar
            <Kbd>↵</Kbd>
            executar
          </span>
          <span className="tabular-nums">
            {flat.length} {flat.length === 1 ? 'comando' : 'comandos'}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CommandPalette;
