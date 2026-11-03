import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Send, Settings2, Users } from 'lucide-react';
import { toast } from 'sonner';

import { AgentAvatar } from './AgentAvatar';
import { AgentPanelButton, AgentPanelOpener } from './AgentPanelToggle';
import { Markdown } from '@/components/chat/Markdown';
import { Button, IconButton, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAgentStore, useUiStore } from '@/lib/store';
import type { AgentChannel, AgentChannelMessage } from '@/lib/types';
import { cn } from '@/lib/utils';

function messageAuthor(
  message: AgentChannelMessage,
  names: Map<string, { name: string; emoji: string }>,
): { name: string; emoji: string } {
  if (message.role === 'user') return { name: 'Você', emoji: '🧑' };
  if (message.agentId) return names.get(message.agentId) ?? { name: 'Agente', emoji: '🤖' };
  return { name: 'Sistema', emoji: '⚙️' };
}

/**
 * Shared channel view: one chronological thread with user posts and one reply
 * per member agent. Replies are generated in each agent's hidden private thread
 * (see `commands::channels`), so the channel stays a readable shared room.
 */
export function AgentChannelView({
  channelId,
  onBack,
  onEdit,
}: {
  channelId: string;
  onBack: () => void;
  onEdit: (channel: AgentChannel) => void;
}) {
  const agents = useAgentStore((state) => state.agentsById);
  const [channel, setChannel] = useState<AgentChannel | null>(null);
  const [messages, setMessages] = useState<AgentChannelMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeChannelId = useUiStore((state) => state.activeChannelId);
  const setActiveChannelId = useUiStore((state) => state.setActiveChannelId);

  const names = useMemo(() => {
    const map = new Map<string, { name: string; emoji: string }>();
    for (const [id, agent] of Object.entries(agents)) {
      map.set(id, { name: agent.name, emoji: agent.emoji });
    }
    return map;
  }, [agents]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [channels, history] = await Promise.all([
        api.listAgentChannels(),
        api.listAgentChannelMessages(channelId),
      ]);
      const found = channels.find((entry) => entry.id === channelId) ?? null;
      setChannel(found);
      setMessages(history);
      if (!found) {
        toast.info('Este canal não existe mais');
        setActiveChannelId(null);
      }
    } catch (error) {
      toast.error('Não foi possível abrir o canal', { description: String(error) });
    } finally {
      setLoading(false);
    }
  }, [channelId, setActiveChannelId]);

  useEffect(() => {
    if (activeChannelId !== channelId) return;
    void load();
  }, [activeChannelId, channelId, load]);

  useEffect(() => {
    const reload = () => void load();
    window.addEventListener('lumina:channels-changed', reload);
    return () => window.removeEventListener('lumina:channels-changed', reload);
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, sending]);

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setErrors([]);
    // Optimistic bubble so the composer feels immediate; the authoritative
    // list replaces it when the agents finish.
    const optimistic: AgentChannelMessage = {
      id: `optimistic-${Date.now()}`,
      channelId,
      role: 'user',
      agentId: null,
      content,
      createdAt: Date.now(),
    };
    setMessages((current) => [...current, optimistic]);
    setDraft('');
    try {
      const result = await api.postAgentChannelMessage(channelId, content);
      setMessages(result.messages);
      setErrors(result.errors);
      if (result.errors.length > 0) {
        toast.warning('Alguns agentes não responderam', {
          description: result.errors[0],
        });
      }
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setDraft(content);
      toast.error('Não foi possível publicar no canal', { description: String(error) });
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="relative flex h-full items-center justify-center text-[13px] text-foreground-muted">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Carregando canal…
        <AgentPanelOpener />
      </div>
    );
  }
  if (!channel) {
    return (
      <div className="relative flex h-full items-center justify-center px-6 text-center text-[13px] text-foreground-muted">
        Canal indisponível.
        <AgentPanelOpener />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <IconButton label="Voltar para a equipe" size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </IconButton>
        <span className="flex size-8 items-center justify-center rounded-xl border border-border bg-surface-active/70 text-[15px]">
          #
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-foreground">{channel.name}</p>
          <p className="flex items-center gap-1 truncate text-[11px] text-foreground-muted">
            <Users className="size-3" />
            {channel.memberIds
              .map((id) => names.get(id)?.name)
              .filter(Boolean)
              .join(', ') || 'Nenhum participante'}
          </p>
        </div>
        <AgentPanelButton />
        <IconButton
          label="Editar canal"
          size="sm"
          variant="ghost"
          onClick={() => onEdit(channel)}
        >
          <Settings2 className="size-4" />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-5 py-5">
          {messages.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-foreground-muted">
              Nenhuma mensagem ainda. Publique algo e os agentes do canal respondem em ordem.
            </div>
          ) : (
            messages.map((message) => {
              const author = messageAuthor(message, names);
              const own = message.role === 'user';
              return (
                <div
                  key={message.id}
                  className={cn('flex min-w-0 gap-2.5', own && 'flex-row-reverse')}
                >
                  <AgentAvatar emoji={author.emoji} size="sm" />
                  <div className={cn('min-w-0 max-w-[85%]', own && 'text-right')}>
                    <p className="mb-0.5 text-[10px] font-medium text-foreground-subtle">
                      {author.name}
                    </p>
                    <div
                      className={cn(
                        'rounded-2xl border border-border px-3 py-2 text-left text-[13px] leading-relaxed',
                        own ? 'bg-accent-soft/50 text-foreground' : 'bg-surface-raised/70',
                      )}
                    >
                      {own ? (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      ) : (
                        <Markdown content={message.content} className="text-[13px]" />
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          {sending ? (
            <div className="flex items-center gap-2 pl-9 text-[11px] text-foreground-muted">
              <Loader2 className="size-3.5 animate-spin" />
              Os agentes do canal estão respondendo…
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 px-4 pb-3">
        <div className="mx-auto w-full max-w-3xl">
          {errors.length > 0 ? (
            <div className="mb-2 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-[11px] text-foreground-muted">
              {errors.map((error) => (
                <p key={error} className="truncate">
                  {error}
                </p>
              ))}
            </div>
          ) : null}
          <div className="rounded-3xl border border-border bg-surface-raised shadow-sm focus-within:border-border-strong">
            <Textarea
              value={draft}
              rows={2}
              maxLength={16000}
              placeholder={`Mensagem para #${channel.name}…`}
              aria-label={`Mensagem para o canal ${channel.name}`}
              className="min-h-14 resize-none border-0 bg-transparent px-4 pt-3 text-[14px] focus:ring-0"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="flex items-center justify-end px-2 pb-2">
              <Button
                size="sm"
                variant="primary"
                disabled={sending || !draft.trim()}
                onClick={() => void send()}
              >
                {sending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Send className="mr-1.5 size-3.5" />}
                Publicar
              </Button>
            </div>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-foreground-subtle">
            Cada agente responde uma vez, em ordem. As respostas ficam no histórico compartilhado.
          </p>
        </div>
      </div>
    </div>
  );
}
