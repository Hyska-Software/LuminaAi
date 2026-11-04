import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  ListChecks,
  Loader2,
  Settings2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { AgentAvatar } from './AgentAvatar';
import { AgentAvatarStack } from './AgentAvatarStack';
import { AgentTaskBoardDialog } from './AgentTaskBoardDialog';
import { AgentPanelButton, AgentPanelOpener } from './AgentPanelToggle';
import { Markdown } from '@/components/chat/Markdown';
import { ComposerActivity } from '@/components/composer/ComposerActivity';
import { useReduceMotion } from '@/components/layout/hooks';
import { IconButton, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { agentAvatarForEmoji, DEFAULT_AGENT_AVATAR } from '@/lib/agentAvatar';
import { useAgentStore, useAppStore, useUiStore } from '@/lib/store';
import type { AgentAvatar as AgentAvatarSpec, AgentChannel, AgentChannelMessage } from '@/lib/types';
import { cn, copyText } from '@/lib/utils';

/** Distance from the bottom (px) still considered "reading the latest message". */
const BOTTOM_THRESHOLD = 96;

/** The textarea grows up to ten lines before scrolling (same as the chat composer). */
const MAX_LINES = 10;

function messageAuthor(
  message: AgentChannelMessage,
  names: Map<string, { name: string; avatar: AgentAvatarSpec }>,
): { name: string; avatar: AgentAvatarSpec } {
  if (message.role === 'user') return { name: 'Você', avatar: agentAvatarForEmoji('🧑') };
  if (message.agentId) {
    return names.get(message.agentId) ?? { name: 'Agente', avatar: DEFAULT_AGENT_AVATAR };
  }
  return { name: 'Sistema', avatar: agentAvatarForEmoji('⚙️') };
}

/** Copy action shown on hover, mirroring the chat message footer. */
function MessageCopyButton({ content, label }: { content: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      clearTimeout(timer.current ?? undefined);
    },
    [],
  );

  const copy = async () => {
    const ok = await copyText(content);
    if (!ok) {
      toast.error('Não foi possível copiar');
      return;
    }
    setCopied(true);
    clearTimeout(timer.current ?? undefined);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <IconButton
      label={copied ? 'Mensagem copiada' : label}
      size="sm"
      variant="ghost"
      className="size-8"
      onClick={() => void copy()}
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </IconButton>
  );
}

/**
 * Shared channel view: one chronological thread with user posts and one reply
 * per member agent. Replies are generated in each agent's hidden private thread
 * (see `commands::channels`), so the channel stays a readable shared room.
 *
 * The surface mirrors the standard agent thread (`ChatView` + `Composer`):
 * same column width, message rhythm, smart scroll and composer shell. The model
 * selector is intentionally absent — each member agent already owns its route.
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
  const sendKey = useAppStore((state) => state.settings.sendKey);
  const [channel, setChannel] = useState<AgentChannel | null>(null);
  const [messages, setMessages] = useState<AgentChannelMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [taskBoardOpen, setTaskBoardOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const requestId = useRef(0);
  const [showJump, setShowJump] = useState(false);
  const reduceMotion = useReduceMotion();
  const activeChannelId = useUiStore((state) => state.activeChannelId);
  const setActiveChannelId = useUiStore((state) => state.setActiveChannelId);

  const names = useMemo(() => {
    const map = new Map<string, { name: string; avatar: AgentAvatarSpec }>();
    for (const [id, agent] of Object.entries(agents)) {
      map.set(id, { name: agent.name, avatar: agent.avatar });
    }
    return map;
  }, [agents]);
  const members = useMemo(
    () =>
      (channel?.memberIds ?? [])
        .map((id) => ({
          id,
          ...(names.get(id) ?? { name: 'Agente', avatar: DEFAULT_AGENT_AVATAR }),
        }))
        .filter((member) => member.name !== 'Agente'),
    [channel?.memberIds, names],
  );
  const mentionMatch = /(?:^|\s)@([^\s@]*)$/.exec(draft);
  const mentionCandidates = mentionMatch
    ? members
        .filter((member) =>
          member.name.toLocaleLowerCase('pt-BR').includes(mentionMatch[1].toLocaleLowerCase('pt-BR')),
        )
        .slice(0, 6)
    : [];
  const activeMentionIndex =
    mentionCandidates.length > 0 ? Math.min(mentionIndex, mentionCandidates.length - 1) : 0;
  const isDm = channel?.kind === 'dm';
  const memberNames = members.map((member) => member.name).join(', ');

  const resizeTextarea = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = '0px';
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 22;
    const maxHeight = lineHeight * MAX_LINES;
    const nextHeight = Math.min(element.scrollHeight, maxHeight);
    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [draft, resizeTextarea]);

  const insertMention = (name: string) => {
    setDraft((current) =>
      current.replace(/(?:^|\s)@([^\s@]*)$/, (match) => {
        const prefix = match.startsWith(' ') ? ' ' : '';
        return `${prefix}@${name} `;
      }),
    );
    setMentionOpen(false);
    setMentionIndex(0);
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.focus();
      const end = element.value.length;
      element.setSelectionRange(end, end);
      resizeTextarea();
    });
  };

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    atBottomRef.current = true;
    setShowJump(false);
  }, []);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const nearBottom = distance < BOTTOM_THRESHOLD;
    atBottomRef.current = nearBottom;
    setShowJump(!nearBottom);
  }, []);

  const load = useCallback(
    async (silent = false) => {
      const request = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const [channels, history] = await Promise.all([
          api.listAgentChannels(),
          api.listAgentChannelMessages(channelId),
        ]);
        if (request !== requestId.current) return;
        const found = channels.find((entry) => entry.id === channelId) ?? null;
        setChannel(found);
        setMessages(history);
        if (!found) {
          toast.info('Este canal não existe mais');
          setActiveChannelId(null);
        }
      } catch (error) {
        if (request === requestId.current && !silent) {
          toast.error('Não foi possível abrir o canal', { description: String(error) });
        }
      } finally {
        if (request === requestId.current) setLoading(false);
      }
    },
    [channelId, setActiveChannelId],
  );

  useEffect(() => {
    if (activeChannelId !== channelId) return;
    void load();
  }, [activeChannelId, channelId, load]);

  useEffect(() => {
    // Polling refreshes replies published by the member agents while a post is
    // still running; the backend appends each reply as it finishes.
    const reload = () => void load(true);
    window.addEventListener('lumina:channels-changed', reload);
    window.addEventListener('lumina:agent-channel-updated', reload);
    const interval = window.setInterval(reload, 3000);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('lumina:channels-changed', reload);
      window.removeEventListener('lumina:agent-channel-updated', reload);
    };
  }, [load]);

  /* Follow new replies only while the user is parked at the bottom. */
  useLayoutEffect(() => {
    if (atBottomRef.current) scrollToBottom('auto');
  }, [messages, sending, scrollToBottom]);

  /* Always start a channel at its latest message. */
  useEffect(() => {
    atBottomRef.current = true;
    scrollToBottom('auto');
  }, [channelId, scrollToBottom]);

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setErrors([]);
    setMentionOpen(false);
    // A poll that started before the backend persisted this post must not
    // overwrite the optimistic bubble with an older history.
    requestId.current += 1;
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
    setMentionIndex(0);
    requestAnimationFrame(resizeTextarea);
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
      void load(true);
      toast.error('Não foi possível publicar no canal', { description: String(error) });
    } finally {
      setSending(false);
      requestAnimationFrame(() => {
        resizeTextarea();
        textareaRef.current?.focus();
      });
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
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <IconButton label="Voltar para a equipe" size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </IconButton>
        {members.length > 0 ? (
          <AgentAvatarStack
            members={members}
            size="sm"
            ringClassName="ring-background"
          />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-xl border border-border bg-surface-active/70 text-[15px]">
            {isDm ? '@' : '#'}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-foreground">{channel.name}</p>
          <p
            className="flex min-w-0 items-center gap-1 text-[11px] text-foreground-muted"
            title={memberNames || undefined}
          >
            <Users className="size-3 shrink-0" />
            <span className="truncate">
              {members.length > 0
                ? `${members.length} ${members.length === 1 ? 'agente' : 'agentes'} · ${memberNames}`
                : 'Nenhum participante'}
            </span>
          </p>
        </div>
        <AgentPanelButton />
        <IconButton
          label="Tarefas do canal"
          size="sm"
          variant="ghost"
          onClick={() => setTaskBoardOpen(true)}
        >
          <ListChecks className="size-4" />
        </IconButton>
        {isDm ? null : (
          <IconButton
            label="Editar canal"
            size="sm"
            variant="ghost"
            onClick={() => onEdit(channel)}
          >
            <Settings2 className="size-4" />
          </IconButton>
        )}
      </header>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {messages.length === 0 ? (
          <div className="flex min-h-full items-center justify-center px-6 py-12">
            <div className="max-w-sm text-center">
              <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl border border-border bg-surface-raised text-[20px] text-foreground-muted">
                {isDm ? '@' : '#'}
              </span>
              <p className="text-[15px] font-medium text-foreground">
                Nenhuma mensagem em {isDm ? '' : '#'}
                {channel.name}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-foreground-muted">
                {isDm
                  ? 'As respostas geradas pelo inbox aparecem aqui.'
                  : 'Publique uma mensagem e os agentes do canal respondem em ordem. Use @nome para direcionar a mensagem.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl px-6 pb-10 pt-6">
            <div
              role="log"
              aria-live={sending ? 'polite' : 'off'}
              aria-relevant="additions text"
              aria-busy={sending}
              className="flex flex-col"
            >
              {messages.map((message, index) => {
                const author = messageAuthor(message, names);
                const previous = messages[index - 1];
                const groupStart = !previous || previous.role !== message.role;
                const spacing = groupStart ? 'mt-7' : 'mt-3';

                if (message.role === 'system') {
                  return (
                    <div key={message.id} className={cn('flex justify-center', spacing)}>
                      <p className="rounded-full bg-surface-raised px-3 py-1 text-[11px] text-foreground-muted">
                        {message.content}
                      </p>
                    </div>
                  );
                }

                if (message.role === 'user') {
                  return (
                    <div
                      key={message.id}
                      className={cn('group/message flex flex-col items-end', spacing)}
                    >
                      <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-3xl bg-user-bubble px-4 py-2.5 text-[15px] leading-relaxed text-foreground">
                        {message.content}
                      </div>
                      <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/message:opacity-100">
                        <MessageCopyButton content={message.content} label="Copiar mensagem" />
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={message.id}
                    className={cn('group/message flex items-start gap-3', spacing)}
                  >
                    <AgentAvatar
                      avatar={author.avatar}
                      size="sm"
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="mb-0.5 text-[11px] font-medium text-foreground-subtle">
                        {author.name}
                      </p>
                      <Markdown content={message.content} />
                      <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/message:opacity-100">
                        <MessageCopyButton content={message.content} label="Copiar resposta" />
                      </div>
                    </div>
                  </div>
                );
              })}
              {sending ? (
                <div className="mt-7 flex items-start gap-3">
                  <div className="size-7 shrink-0" aria-hidden />
                  <div className="flex items-center gap-2 py-1 text-[13px] text-foreground-subtle">
                    <Spinner size="xs" />
                    <span>Os agentes do canal estão respondendo…</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <div className="relative z-10 shrink-0 px-4 pb-3">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-10 bottom-0 bg-linear-to-t from-background via-background/90 to-transparent"
        />
        <div className="relative mx-auto w-full max-w-3xl">
          {errors.length > 0 ? (
            <div
              role="alert"
              className="mb-2 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-[11px] text-foreground-muted"
            >
              {errors.map((error) => (
                <p key={error} className="truncate">
                  {error}
                </p>
              ))}
            </div>
          ) : null}
          {isDm ? (
            <p className="rounded-xl border border-border bg-surface-raised/60 px-3 py-2 text-center text-[11px] text-foreground-muted">
              Conversa direta entre agentes. As respostas são geradas pelo inbox e aparecem aqui;
              o composer do usuário fica desativado.
            </p>
          ) : (
            <>
              <div
                className={cn(
                  'relative rounded-3xl border bg-surface-raised shadow-sm transition-colors duration-150',
                  sending
                    ? 'border-accent/20'
                    : 'border-border focus-within:border-border-strong',
                )}
              >
                <ComposerActivity active={sending} reduceMotion={reduceMotion} />
                <div className="px-3 pb-1 pt-3">
                  {mentionOpen && mentionCandidates.length > 0 ? (
                    <div
                      role="listbox"
                      id="channel-mention-listbox"
                      aria-label="Membros do canal"
                      className="mb-2 grid max-h-56 gap-0.5 overflow-y-auto rounded-xl border border-border bg-surface p-1"
                    >
                      {mentionCandidates.map((member, index) => (
                        <button
                          key={member.id}
                          type="button"
                          role="option"
                          id={`channel-mention-${member.id}`}
                          aria-selected={index === activeMentionIndex}
                          aria-label={`Mencionar ${member.name}`}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px]',
                            index === activeMentionIndex
                              ? 'bg-surface-hover text-foreground'
                              : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
                          )}
                          onMouseEnter={() => setMentionIndex(index)}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            insertMention(member.name);
                          }}
                        >
                          <AgentAvatar avatar={member.avatar} size="sm" />
                          <span className="truncate">{member.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <textarea
                    ref={textareaRef}
                    value={draft}
                    rows={1}
                    maxLength={16000}
                    placeholder={`Mensagem para ${isDm ? '' : '#'}${channel.name}…`}
                    aria-label={`Mensagem para o canal ${channel.name}`}
                    aria-autocomplete="list"
                    aria-expanded={
                      mentionOpen && mentionCandidates.length > 0 ? true : undefined
                    }
                    aria-controls={
                      mentionOpen && mentionCandidates.length > 0
                        ? 'channel-mention-listbox'
                        : undefined
                    }
                    aria-activedescendant={
                      mentionOpen && mentionCandidates.length > 0
                        ? `channel-mention-${mentionCandidates[activeMentionIndex]?.id}`
                        : undefined
                    }
                    className={
                      'block max-h-[220px] w-full resize-none bg-transparent px-1.5 py-0.5 text-[15px] leading-relaxed text-foreground placeholder:text-foreground-subtle focus:outline-none'
                    }
                    onChange={(event) => {
                      const next = event.target.value;
                      setDraft(next);
                      setMentionIndex(0);
                      setMentionOpen(/(?:^|\s)@([^\s@]*)$/.test(next));
                    }}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return;

                      // The mention picker keeps the focus in the textarea and
                      // is navigated with arrows, like the chat composer menus.
                      if (mentionOpen && mentionCandidates.length > 0) {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setMentionOpen(false);
                          return;
                        }
                        if (event.key === 'ArrowDown') {
                          event.preventDefault();
                          setMentionIndex(
                            (current) => (current + 1) % mentionCandidates.length,
                          );
                          return;
                        }
                        if (event.key === 'ArrowUp') {
                          event.preventDefault();
                          setMentionIndex(
                            (current) =>
                              (current - 1 + mentionCandidates.length) %
                              mentionCandidates.length,
                          );
                          return;
                        }
                        if (event.key === 'Enter' || event.key === 'Tab') {
                          event.preventDefault();
                          const member = mentionCandidates[activeMentionIndex];
                          if (member) insertMention(member.name);
                          return;
                        }
                      }

                      if (event.key !== 'Enter') return;
                      const withModifier = event.metaKey || event.ctrlKey;
                      const shouldSend =
                        sendKey === 'ctrl+enter' ? withModifier : withModifier || !event.shiftKey;
                      if (!shouldSend) return;
                      event.preventDefault();
                      void send();
                    }}
                  />
                </div>
                <div className="flex items-center gap-1 px-2 pb-2 pt-1">
                  <div className="ml-auto flex items-center gap-1.5">
                    {sending ? (
                      <button
                        type="button"
                        disabled
                        aria-label="Publicando no canal"
                        className="flex size-8 shrink-0 cursor-not-allowed items-center justify-center rounded-full bg-surface-active text-foreground-subtle"
                      >
                        <Loader2 className="size-4 animate-spin" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void send()}
                        disabled={!draft.trim()}
                        aria-label="Publicar no canal"
                        className={cn(
                          'flex size-8 shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                          draft.trim()
                            ? 'bg-linear-to-br from-accent to-accent-hover text-accent-foreground hover:brightness-105'
                            : 'cursor-not-allowed bg-surface-active text-foreground-subtle',
                          draft.trim() && !reduceMotion && 'active:scale-95',
                        )}
                      >
                        <ArrowUp className="size-4" strokeWidth={2.25} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <p className="mt-1.5 text-center text-[11px] leading-relaxed text-foreground-subtle">
                Lumina pode cometer erros. Verifique informações importantes.
              </p>
            </>
          )}
        </div>
      </div>

      {showJump ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-32 z-20 flex justify-center">
          <button
            type="button"
            onClick={() => scrollToBottom(reduceMotion ? 'auto' : 'smooth')}
            aria-label="Ir para o fim do canal"
            className={cn(
              'pointer-events-auto flex size-9 items-center justify-center rounded-full border border-border',
              'bg-surface-raised text-foreground-muted shadow-md',
              'transition-colors duration-150 hover:bg-surface-hover hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            )}
          >
            <ArrowDown className="size-4" />
          </button>
        </div>
      ) : null}

      <AgentTaskBoardDialog
        open={taskBoardOpen}
        onOpenChange={setTaskBoardOpen}
        channelId={channelId}
        title={`Tarefas de #${channel.name}`}
      />
    </div>
  );
}
