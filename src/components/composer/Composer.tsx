import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { ArrowUp, FilePlus, Globe, Plus, Square, Target, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { credentialGateMessage } from '@/components/chat/turnError';
import { useReduceMotion } from '@/components/layout/hooks';
import { ModelPill } from '@/components/models/ModelPill';
import {
  Button,
  IconButton,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Tooltip,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAppStore, useChatStore, useCodeStore, useUiStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { AttachmentChips } from './AttachmentChips';
import { CacheMeterChip } from './CacheMeterChip';
import { CodeSessionControls } from './CodeSessionControls';
import { filterSlashCommands, type SlashCommand } from './commands';
import { ComposerActivity } from './ComposerActivity';
import { MentionChips } from './MentionChips';
import {
  MENTION_LISTBOX_ID,
  MentionMenu,
  mentionOptionId,
} from './MentionMenu';
import { addMention, composeMessage, withoutMention, type MentionedFile } from './mentions';
import { PlanModeChip } from './PlanModeChip';
import { SLASH_LISTBOX_ID, SlashMenu, slashOptionId } from './SlashMenu';
import { ToolsToggle } from './ToolsToggle';

/** Native picker filters: images and the documents `documents::extract` handles. */
const ATTACHMENT_FILTERS = [
  { name: 'Documentos', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'json', 'csv'] },
  { name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
  { name: 'Todos os arquivos', extensions: ['*'] },
];

/** The textarea grows up to ten lines before scrolling (DESIGN §7). */
const MAX_LINES = 10;

/** Debounce da busca de arquivos do `@` (WORKBENCH §6). */
const MENTION_DEBOUNCE_MS = 120;

/** Menu aberto do composer (menção `@` ou comando `/`). */
type ComposerMenu =
  | { kind: 'mention'; query: string; start: number; end: number; active: number }
  | { kind: 'slash'; query: string; start: number; end: number; active: number };

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Message composer pinned to the bottom of the chat column. */
export function Composer() {
  const [value, setValue] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [mentioned, setMentioned] = useState<MentionedFile[]>([]);
  const [menu, setMenu] = useState<ComposerMenu | null>(null);
  /** `/goal` como chip de intenção: a mensagem é enviada sem prompt automático. */
  const [goalIntent, setGoalIntent] = useState(false);
  const [mentionResults, setMentionResults] = useState<string[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionError, setMentionError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const reduceMotion = useReduceMotion();

  const streaming = useChatStore((state) => state.streaming);
  const pendingAttachments = useChatStore((state) => state.pendingAttachments);
  const activeConversationId = useChatStore((state) => state.activeId);
  const conversations = useChatStore((state) => state.conversations);
  const sendKey = useAppStore((state) => state.settings.sendKey);
  const webSearchEnabled = useAppStore((state) => state.settings.webSearchEnabled);
  const fileCreationEnabled = useAppStore((state) => state.settings.fileCreationEnabled);
  // D9 gate: the active provider needs a usable credential (API key or a
  // signed-in ChatGPT plan) before a turn can start. Only enforced when the
  // provider exists in the merged list, so an empty catalog (boot/unit tests)
  // keeps the composer usable — `chatStore.send` still guards the real send.
  const selectedProvider = useAppStore((state) =>
    state.providers.find((provider) => provider.id === state.selection.providerId),
  );
  const providerReady = useAppStore((state) => state.providerReady(state.selection.providerId));
  const setModelPickerOpen = useUiStore((state) => state.setModelPickerOpen);
  const openSettings = useUiStore((state) => state.openSettings);
  // Only the copy changes in the Code layout; sending/attachments/streaming are shared.
  const layoutMode = useUiStore((state) => state.layoutMode);
  const activeWorkspaceId = useUiStore((state) => state.activeWorkspaceId);
  const isCodeLayout = layoutMode === 'code';

  const activeConversation = activeConversationId
    ? conversations.find((conversation) => conversation.id === activeConversationId)
    : undefined;
  /** Sessão do Code (nativa ou compartilhada do Chat): hospeda os controles de sessão. */
  const codeSessionConversation =
    isCodeLayout &&
    activeConversation &&
    (activeConversation.mode === 'code' || activeConversation.codeLinked)
      ? activeConversation
      : undefined;
  /**
   * Modo Plano da sessão do Code: controla o badge (pill) dentro do campo.
   * Sem sessão de código não há badge (nem assinatura ao `codeStore`).
   */
  const planModeActive = useCodeStore((state) =>
    codeSessionConversation
      ? (state.byConversation[codeSessionConversation.id]?.planMode ?? false)
      : false,
  );
  /** A linha de chips acima do textarea existe quando há `/goal` e/ou Plano. */
  const showComposerChips = goalIntent || planModeActive;
  const workspaceId = activeConversation?.workspaceId || activeWorkspaceId || null;
  /** `@` menções e `/` comandos só existem no modo Code com workspace. */
  const codeMenusEnabled = isCodeLayout && Boolean(workspaceId);

  const isStreaming = streaming !== null;
  const providerBlocked = selectedProvider !== undefined && !providerReady;
  const canSend =
    !isStreaming &&
    !providerBlocked &&
    (value.trim().length > 0 || mentioned.length > 0 || pendingAttachments.length > 0);

  const slashQuery = menu?.kind === 'slash' ? menu.query : '';
  const slashCommands = useMemo(() => filterSlashCommands(slashQuery), [slashQuery]);
  const mentionQuery = menu?.kind === 'mention' ? menu.query : null;
  const optionCount =
    menu?.kind === 'mention' ? mentionResults.length : menu?.kind === 'slash' ? slashCommands.length : 0;
  const activeIndex = menu ? Math.min(menu.active, Math.max(0, optionCount - 1)) : 0;

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
  }, [value, resizeTextarea]);

  /* Welcome-screen suggestions and global "focus composer" shortcut. */
  useEffect(() => {
    const onSuggest = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== 'string') return;
      setValue(detail);
      setMenu(null);
      requestAnimationFrame(() => {
        const element = textareaRef.current;
        if (!element) return;
        element.focus();
        const end = element.value.length;
        element.setSelectionRange(end, end);
        resizeTextarea();
      });
    };
    const onGoalIntent = () => {
      // Chip do `/goal`: não mexe no texto digitado; só ativa a intenção e foca.
      setGoalIntent(true);
      setMenu(null);
      textareaRef.current?.focus();
    };
    const onFocusComposer = () => {
      textareaRef.current?.focus();
    };
    window.addEventListener('lumina:suggest', onSuggest);
    window.addEventListener('lumina:goal-intent', onGoalIntent);
    window.addEventListener('lumina:focus-composer', onFocusComposer);
    return () => {
      window.removeEventListener('lumina:suggest', onSuggest);
      window.removeEventListener('lumina:goal-intent', onGoalIntent);
      window.removeEventListener('lumina:focus-composer', onFocusComposer);
    };
  }, [resizeTextarea]);

  /* A intenção de objetivo não vaza entre sessões. */
  useEffect(() => {
    setGoalIntent(false);
  }, [activeConversationId]);

  /* Ctrl/Cmd+L foca o composer (padrão Paseo) — só no modo Code. Local ao
     componente: nenhum atalho global novo, o Chat mantém o comportamento. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'l') return;
      if (useUiStore.getState().layoutMode !== 'code') return;
      event.preventDefault();
      textareaRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /* Fecha os menus quando o contexto deixa de existir (troca para Chat ou
     sessão sem workspace). */
  useEffect(() => {
    if (!codeMenusEnabled && menu) setMenu(null);
  }, [codeMenusEnabled, menu]);

  /* Busca de arquivos do `@`: debounce 120 ms, resultado sempre do workspace
     resolvido no momento (guard contra resposta atrasada). */
  useEffect(() => {
    if (mentionQuery === null || !workspaceId) return;
    let cancelled = false;
    setMentionLoading(true);
    setMentionError(null);
    const timer = window.setTimeout(() => {
      if (typeof api.searchWorkspaceFiles !== 'function') {
        if (cancelled) return;
        setMentionLoading(false);
        setMentionError('A busca de arquivos não está disponível nesta versão.');
        return;
      }
      void api
        .searchWorkspaceFiles(workspaceId, mentionQuery, 20)
        .then((paths) => {
          if (cancelled) return;
          setMentionResults(paths);
          setMentionLoading(false);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setMentionLoading(false);
          setMentionError(describeError(error));
        });
    }, MENTION_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mentionQuery, workspaceId]);

  const focusTextareaAt = useCallback(
    (caret: number) => {
      requestAnimationFrame(() => {
        const element = textareaRef.current;
        if (!element) return;
        element.focus();
        const position = Math.max(0, Math.min(caret, element.value.length));
        element.setSelectionRange(position, position);
        resizeTextarea();
      });
    },
    [resizeTextarea],
  );

  /** Detecta `@arquivo` ou `/comando` na posição do cursor. */
  const analyzeTrigger = useCallback(
    (next: string, caret: number) => {
      if (!codeMenusEnabled) {
        setMenu(null);
        return;
      }
      const before = next.slice(0, caret);
      const mentionMatch = /(^|\s)@([^\s@]*)$/.exec(before);
      if (mentionMatch) {
        const query = mentionMatch[2] ?? '';
        setMenu({
          kind: 'mention',
          query,
          start: caret - query.length - 1,
          end: caret,
          active: 0,
        });
        return;
      }
      const slashMatch = /(^|\s)\/([^\s]*)$/.exec(before);
      if (slashMatch) {
        const query = slashMatch[2] ?? '';
        setMenu({
          kind: 'slash',
          query,
          start: caret - query.length - 1,
          end: caret,
          active: 0,
        });
        return;
      }
      setMenu(null);
    },
    [codeMenusEnabled],
  );

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    setValue(next);
    analyzeTrigger(next, event.target.selectionStart ?? next.length);
  };

  const selectMention = useCallback(
    (path: string) => {
      if (!menu || menu.kind !== 'mention') return;
      const next = value.slice(0, menu.start) + value.slice(menu.end);
      setValue(next);
      setMentioned((previous) => addMention(previous, path));
      setMenu(null);
      focusTextareaAt(menu.start);
    },
    [focusTextareaAt, menu, value],
  );

  const runInvoke = useCallback(
    (command: SlashCommand) => {
      const conversationId = useChatStore.getState().activeId;
      switch (command.invoke) {
        case 'compact': {
          if (!conversationId) {
            toast.info('Nenhuma sessão ativa para compactar', {
              description: 'Abra uma sessão de código para compactar o contexto.',
            });
            return;
          }
          void api
            .compactSession(conversationId)
            .then(() => toast.success('Contexto compactado'))
            .catch((error: unknown) => {
              // O backend do harness ainda não implementa `/compact`: o toast
              // precisa ser honesto em vez de fingir que a compactação ocorreu.
              toast.error('Compactação ainda não disponível', {
                description: describeError(error),
              });
            });
          return;
        }
        case 'commit': {
          const ui = useUiStore.getState();
          ui.setCodePanelTab('changes');
          ui.setCodePanelOpen(true);
          return;
        }
        case 'permissoes': {
          toast.info('Modo de permissão fica no campo de mensagem', {
            description: 'Use o chip Leitura / Revisar / Editar / Autônomo ao lado do anexo.',
          });
          return;
        }
        case 'novo': {
          void useChatStore.getState().startNewConversation('code');
          return;
        }
        case 'limpar': {
          setValue('');
          setMentioned([]);
          requestAnimationFrame(resizeTextarea);
          textareaRef.current?.focus();
          return;
        }
        case 'plan-on': {
          if (!conversationId) {
            toast.info('Nenhuma sessão ativa', {
              description: 'Abra uma sessão de código para ativar o modo Plano.',
            });
            return;
          }
          const current = useCodeStore.getState().byConversation[conversationId];
          if (current?.planMode) {
            toast.info('Modo Plano já está ativo');
            return;
          }
          // Estado da sessão vive no `codeStore` (não chamar `api` direto): o
          // chip do composer reflete a mudança otimista e faz rollback no erro.
          void useCodeStore
            .getState()
            .setPlanMode(conversationId, true)
            .then((ok) => {
              if (ok) toast.success('Modo Plano ativado');
            });
          return;
        }
        case 'plan-off': {
          if (!conversationId) {
            toast.info('Nenhuma sessão ativa', {
              description: 'Abra uma sessão de código para desativar o modo Plano.',
            });
            return;
          }
          void useCodeStore
            .getState()
            .setPlanMode(conversationId, false)
            .then((ok) => {
              if (ok) toast.success('Modo Plano desativado');
            });
          return;
        }
        default:
          return;
      }
    },
    [resizeTextarea],
  );

  const selectSlash = useCallback(
    (command: SlashCommand) => {
      if (!menu || menu.kind !== 'slash') return;
      const start = menu.start;
      const end = menu.end;
      setMenu(null);
      const rest = value.slice(end);
      if (command.action === 'intent') {
        // `/goal` vira chip; o texto do usuário fica intocado.
        setGoalIntent(true);
        setValue(value.slice(0, start) + rest);
        focusTextareaAt(start);
        return;
      }
      if (command.action === 'fill' && command.fill) {
        setValue(value.slice(0, start) + command.fill + rest);
        focusTextareaAt(start + command.fill.length);
        // Comandos de intenção que também têm efeito (ex.: `/plan` ativa o
        // modo Plano antes de preencher a instrução).
        if (command.invoke) runInvoke(command);
        return;
      }
      setValue(value.slice(0, start) + rest);
      focusTextareaAt(start);
      runInvoke(command);
    },
    [focusTextareaAt, menu, runInvoke, value],
  );

  const selectActiveOption = useCallback(() => {
    if (!menu) return;
    if (menu.kind === 'mention') {
      const path = mentionResults[activeIndex];
      if (path) selectMention(path);
      return;
    }
    const command = slashCommands[activeIndex];
    if (command) selectSlash(command);
  }, [activeIndex, menu, mentionResults, selectMention, selectSlash, slashCommands]);

  const moveActiveOption = useCallback(
    (delta: 1 | -1) => {
      if (!menu || optionCount === 0) return;
      const next = (activeIndex + delta + optionCount) % optionCount;
      setMenu({ ...menu, active: next });
    },
    [activeIndex, menu, optionCount],
  );

  const submit = useCallback(() => {
    if (!canSend) return;
    const text = composeMessage(value, mentioned);
    if (!text && pendingAttachments.length === 0) return;
    const goalRequest = goalIntent;
    setValue('');
    setMentioned([]);
    setMenu(null);
    setGoalIntent(false);
    requestAnimationFrame(resizeTextarea);
    window.dispatchEvent(new CustomEvent('lumina:scroll-bottom'));
    void useChatStore.getState().send(text, goalRequest ? { goalRequest: true } : undefined);
  }, [canSend, goalIntent, mentioned, pendingAttachments.length, resizeTextarea, value]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;

    /* Menus de `@`/`/`: o textarea mantém o foco e a opção ativa é exposta por
       `aria-activedescendant`. Tab/Enter confirmam, Esc fecha. */
    if (menu) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenu(null);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveActiveOption(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveActiveOption(-1);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        selectActiveOption();
        return;
      }
    }

    /* Backspace com o textarea vazio remove o último chip de menção. */
    if (
      event.key === 'Backspace' &&
      value.length === 0 &&
      (event.currentTarget.selectionStart ?? 0) === 0 &&
      mentioned.length > 0
    ) {
      event.preventDefault();
      setMentioned((previous) => previous.slice(0, -1));
      return;
    }

    if (event.key !== 'Enter') return;
    const withModifier = event.metaKey || event.ctrlKey;
    const shouldSend = sendKey === 'ctrl+enter' ? withModifier : withModifier || !event.shiftKey;
    if (!shouldSend) return;
    event.preventDefault();
    submit();
  };

  const handleAttach = async () => {
    if (attaching) return;
    setAttaching(true);
    try {
      const selection = await open({
        multiple: true,
        title: 'Anexar arquivos',
        filters: ATTACHMENT_FILTERS,
      });
      const paths = Array.isArray(selection) ? selection : selection ? [selection] : [];
      if (paths.length) await useChatStore.getState().addAttachments(paths);
    } catch (error) {
      toast.error('Não foi possível anexar', { description: String(error) });
    } finally {
      setAttaching(false);
    }
  };

  const toggleWebSearch = () => {
    void useAppStore.getState().saveSettings({ webSearchEnabled: !webSearchEnabled });
  };

  const toggleFileCreation = () => {
    void useAppStore.getState().saveSettings({ fileCreationEnabled: !fileCreationEnabled });
  };

  const placeholder = goalIntent
    ? 'Descreva o objetivo e o trabalho a fazer…'
    : !isCodeLayout
      ? 'Pergunte alguma coisa…'
      : codeMenusEnabled
        ? 'Descreva a tarefa… @ para arquivos, / para comandos'
        : 'Descreva a tarefa para o agente…';

  const menuControls = menu
    ? menu.kind === 'mention'
      ? MENTION_LISTBOX_ID
      : SLASH_LISTBOX_ID
    : undefined;
  const activeDescendant =
    menu && optionCount > 0
      ? menu.kind === 'mention'
        ? mentionOptionId(activeIndex)
        : slashOptionId(activeIndex)
      : undefined;

  return (
    <div>
      {providerBlocked ? (
        <div
          id="composer-credential-notice"
          role="status"
          className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2"
        >
          <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" strokeWidth={2} />
          <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-foreground-muted">
            {credentialGateMessage(selectedProvider)}
          </span>
          <Button variant="secondary" size="sm" onClick={() => openSettings('providers')}>
            Abrir Provedores
          </Button>
        </div>
      ) : null}

      <div
        className={cn(
          'relative rounded-3xl border bg-surface-raised shadow-sm transition-colors duration-150',
          isStreaming
            ? 'border-accent/20'
            : 'border-border focus-within:border-border-strong',
        )}
      >
        <ComposerActivity active={isStreaming} reduceMotion={reduceMotion} />

        <Popover
          open={menu !== null}
          onOpenChange={(open) => {
            if (!open) setMenu(null);
          }}
        >
          <PopoverAnchor asChild>
            <div className="px-3 pb-1 pt-3">
              {showComposerChips ? (
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {goalIntent ? (
                    // Mesmo padrão do badge de Plano: um único botão-pill accent;
                    // clicar em qualquer parte remove a intenção.
                    <Tooltip side="top" content="Objetivo ativo — clique para desativar">
                      <button
                        type="button"
                        aria-label="Desativar objetivo"
                        aria-pressed={true}
                        onClick={() => {
                          setGoalIntent(false);
                          textareaRef.current?.focus();
                        }}
                        className={cn(
                          'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-2.5',
                          'text-[12px] font-medium text-foreground',
                          'transition-colors duration-150 hover:bg-accent-soft/80',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                        )}
                      >
                        <Target
                          aria-hidden
                          className="size-3.5 shrink-0 text-accent"
                          strokeWidth={1.75}
                        />
                        /goal
                      </button>
                    </Tooltip>
                  ) : null}
                  {codeSessionConversation ? (
                    <PlanModeChip conversationId={codeSessionConversation.id} />
                  ) : null}
                </div>
              ) : null}

              {mentioned.length > 0 ? (
                <MentionChips
                  mentions={mentioned}
                  onRemove={(path) => {
                    setMentioned((previous) => withoutMention(previous, path));
                    textareaRef.current?.focus();
                  }}
                  className="mb-2"
                />
              ) : null}

              {pendingAttachments.length > 0 ? (
                <AttachmentChips
                  attachments={pendingAttachments}
                  onRemove={(id) => void useChatStore.getState().removeAttachment(id)}
                  className="mb-2"
                />
              ) : null}

              <textarea
                ref={textareaRef}
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder={placeholder}
                aria-label={isCodeLayout ? 'Tarefa para o agente' : 'Mensagem para o Lumina'}
                aria-describedby={providerBlocked ? 'composer-credential-notice' : undefined}
                aria-expanded={menu ? true : undefined}
                aria-controls={menuControls}
                aria-activedescendant={activeDescendant}
                aria-autocomplete={codeMenusEnabled ? 'list' : undefined}
                className={cn(
                  'block max-h-[220px] w-full resize-none bg-transparent px-1.5 py-0.5',
                  'text-[15px] leading-relaxed text-foreground placeholder:text-foreground-subtle',
                  'focus:outline-none',
                )}
              />
            </div>
          </PopoverAnchor>

          <PopoverContent
            side="top"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="w-[min(30rem,calc(100vw-2rem))] p-1"
            onOpenAutoFocus={(event) => {
              // O foco continua no textarea: os menus são navegados por
              // aria-activedescendant, como um combobox.
              event.preventDefault();
            }}
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              setMenu(null);
              textareaRef.current?.focus();
            }}
          >
            {menu?.kind === 'mention' ? (
              <MentionMenu
                query={menu.query}
                results={mentionResults}
                loading={mentionLoading}
                error={mentionError}
                activeIndex={activeIndex}
                onSelect={selectMention}
                onHoverIndex={(index) => setMenu({ ...menu, active: index })}
              />
            ) : menu?.kind === 'slash' ? (
              <SlashMenu
                commands={slashCommands}
                activeIndex={activeIndex}
                onSelect={selectSlash}
                onHoverIndex={(index) => setMenu({ ...menu, active: index })}
              />
            ) : null}
          </PopoverContent>
        </Popover>

        <div className="flex items-center gap-1 px-2 pb-2 pt-1">
          <IconButton
            label="Anexar arquivos"
            size="sm"
            variant="ghost"
            loading={attaching}
            onClick={() => void handleAttach()}
          >
            <Plus className="size-4" />
          </IconButton>

          {codeSessionConversation ? (
            <CodeSessionControls
              conversationId={codeSessionConversation.id}
              goalIntent={goalIntent}
              onToggleGoalIntent={() => setGoalIntent((current) => !current)}
            />
          ) : isCodeLayout ? null : (
            <>
              <ToolsToggle
                icon={Globe}
                label="Busca web"
                active={webSearchEnabled}
                onToggle={toggleWebSearch}
              />
              <ToolsToggle
                icon={FilePlus}
                label="Criar arquivos"
                active={fileCreationEnabled}
                onToggle={toggleFileCreation}
              />
            </>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            {!isCodeLayout && activeConversationId ? (
              <CacheMeterChip conversationId={activeConversationId} />
            ) : null}
            <ModelPill onClick={() => setModelPickerOpen(true)} />

            {isStreaming ? (
              <button
                type="button"
                onClick={() => void useChatStore.getState().stop()}
                aria-label="Parar resposta"
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background',
                  'transition-colors duration-150 hover:bg-foreground/90',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                )}
              >
                <Square className="size-3.5 fill-current" strokeWidth={2} />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                aria-label="Enviar mensagem"
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  canSend
                    ? 'bg-linear-to-br from-accent to-accent-hover text-accent-foreground hover:brightness-105'
                    : 'cursor-not-allowed bg-surface-active text-foreground-subtle',
                  canSend && !reduceMotion && 'active:scale-95',
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
    </div>
  );
}
