import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, MessageSquarePlus, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Spinner,
} from '@/components/ui';
import { chatConversationsAvailableToLink } from '@/lib/conversations';
import { useChatStore, useUiStore } from '@/lib/store';
import type { Conversation } from '@/lib/types';
import { cn, relativeTime } from '@/lib/utils';

export interface AddChatSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a Chat session was linked and opened in the Code layout. */
  onAdded?: (conversation: Conversation) => void;
}

/** Case/diacritic-insensitive folding for the local search. */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function matchesQuery(conversation: Conversation, needles: string[]): boolean {
  if (needles.length === 0) return true;
  const haystack = fold(`${conversation.title} ${conversation.preview ?? ''}`);
  return needles.every((needle) => haystack.includes(needle));
}

/**
 * Dialog opened from the Code sidebar to bring a Chat session into the Code
 * layout (`codeLinked = true`). It lists exactly the real Chat sessions that
 * are not shared yet — no fake workspace/session data. Adding one closes the
 * dialog and opens the very same conversation in Code.
 */
export function AddChatSessionDialog({ open, onOpenChange, onAdded }: AddChatSessionDialogProps) {
  const conversations = useChatStore((state) => state.conversations);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const available = useMemo(
    () => chatConversationsAvailableToLink(conversations),
    [conversations],
  );
  const needles = useMemo(
    () => fold(query).split(/\s+/).filter((needle) => needle.length > 0),
    [query],
  );
  const results = useMemo(
    () => available.filter((conversation) => matchesQuery(conversation, needles)),
    [available, needles],
  );

  /* A closed dialog never keeps a stale search or error for the next opening. */
  useEffect(() => {
    if (open) return;
    setQuery('');
    setBusyId(null);
    setError(null);
  }, [open]);

  const handleAdd = async (conversation: Conversation) => {
    if (busyId) return;
    setBusyId(conversation.id);
    setError(null);
    const ok = await useChatStore.getState().setConversationCodeLinked(conversation.id, true);
    setBusyId(null);
    if (!ok) {
      // The store is intentionally toast-free: the caller owns the feedback.
      setError('Não foi possível adicionar a sessão ao Code. Tente novamente.');
      toast.error('Não foi possível adicionar a sessão ao Code');
      return;
    }
    onOpenChange(false);
    useUiStore.getState().setCodeView('session');
    onAdded?.(conversation);
    await useChatStore.getState().openConversation(conversation.id);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Keep the dialog open while the link is being committed.
        if (!next && busyId) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="md" className="gap-0">
        <DialogHeader className="gap-1.5 pr-12">
          <DialogTitle>Adicionar sessão do Chat</DialogTitle>
          <DialogDescription>
            Escolha uma conversa do Chat para trabalhar nela também no Code. Ela continua disponível
            nos dois layouts.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-3">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar sessão do Chat…"
              aria-label="Buscar sessão do Chat"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              className="pl-8"
            />
          </div>
        </div>

        <div
          role="region"
          aria-label="Sessões do Chat disponíveis"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-3"
        >
          {available.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-10 text-center">
              <span className="flex size-10 items-center justify-center rounded-xl border border-border bg-surface-hover text-foreground-muted">
                <MessageSquarePlus aria-hidden className="size-5" strokeWidth={1.75} />
              </span>
              <p className="text-[13px] font-medium text-foreground">Nenhuma sessão do Chat disponível</p>
              <p className="max-w-sm text-[12px] leading-relaxed text-foreground-muted">
                Todas as conversas do Chat já estão no Code, ou você ainda não tem conversas no Chat.
              </p>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-10 text-center">
              <p className="text-[13px] font-medium text-foreground">Nenhuma sessão encontrada</p>
              <p className="max-w-sm text-[12px] leading-relaxed text-foreground-muted">
                Nenhuma conversa do Chat corresponde a “{query.trim()}”.
              </p>
              <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
                Limpar busca
              </Button>
            </div>
          ) : (
            <div role="list" className="flex flex-col gap-1.5 py-0.5">
              {results.map((conversation) => {
                const busy = busyId === conversation.id;
                return (
                  <div key={conversation.id} role="listitem">
                    <button
                      type="button"
                      aria-label={`Adicionar ${conversation.title} ao Code`}
                      aria-busy={busy || undefined}
                      disabled={busyId !== null}
                      onClick={() => void handleAdd(conversation)}
                      className={cn(
                        'flex w-full min-w-0 items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5 text-left',
                        'transition-colors duration-150 hover:border-border-strong hover:bg-surface-hover',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                        'disabled:cursor-not-allowed disabled:opacity-60',
                      )}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-foreground-muted">
                        <MessageSquare aria-hidden className="size-4" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground">
                          {conversation.title}
                        </span>
                        {conversation.preview ? (
                          <span className="mt-0.5 block truncate text-[12px] leading-relaxed text-foreground-muted">
                            {conversation.preview}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-foreground-subtle">
                        {relativeTime(conversation.updatedAt)}
                      </span>
                      {busy ? (
                        <Spinner size="xs" label="Adicionando sessão" className="text-foreground-muted" />
                      ) : (
                        <Plus aria-hidden className="size-4 shrink-0 text-foreground-subtle" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] leading-relaxed text-danger"
            >
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="justify-between">
          <span className="text-[11px] tabular-nums text-foreground-subtle">
            {available.length === 1 ? '1 sessão disponível' : `${available.length} sessões disponíveis`}
          </span>
          <Button variant="ghost" size="sm" disabled={busyId !== null} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AddChatSessionDialog;
