import { create } from 'zustand';
import { toast } from 'sonner';
import { api } from '../api';
import type {
  Artifact,
  AttachmentInfo,
  ChatMessage,
  Conversation,
  ModelSelection,
  ReasoningSelection,
  TraceStep,
  TurnEvent,
  TurnOptions,
  TurnPayload,
  TurnProfile,
  TurnResult,
} from '../types';
import { deriveTitle, newId } from '../utils';
import { defaultSelection, getModel } from '../catalog';
import { filterConversationsForLayout } from '../conversations';
import { reasoningForModel } from '../modelMenu';
import { useAppStore } from './appStore';
import { isCodeEvent, useCodeStore } from './codeStore';
import { useUiStore, type LayoutMode } from './uiStore';

export interface StreamingState {
  turnId: string;
  conversationId: string;
  assistantId: string;
  userMessageId: string | null;
  phase: 'starting' | 'reasoning' | 'text' | 'tool';
  step: number;
  startedAt: number;
}

interface ChatState {
  conversations: Conversation[];
  conversationsLoading: boolean;
  activeId: string | null;
  /**
   * Last session remembered by each layout (Chat | Code). Sessions are separate
   * per layout, so switching layouts restores that layout's own conversation
   * instead of leaking the other one (docs/goals/chat-code-sessions).
   */
  activeIdByLayout: Record<LayoutMode, string | null>;
  messagesByConversation: Record<string, ChatMessage[]>;
  loadingConversationId: string | null;
  streaming: StreamingState | null;
  pendingAttachments: AttachmentInfo[];
  error: string | null;
  /** Machine-readable code of the last turn error (`subscription_sharing_*`, `auth_required`, ...). */
  errorCode: string | null;
  /** Actionable hint supplied by the backend for the last turn error. */
  errorHint: string | null;

  dismissError: () => void;

  init: () => Promise<void>;
  refreshConversations: () => Promise<void>;
  /**
   * Opens a conversation. `preserveView` keeps the layout's current page
   * (Biblioteca/Skills) untouched; `enterLayout` uses it to restore the session
   * in the background when the user comes back to a layout that was showing
   * another surface (docs/goals/chat-code-sessions/PLAN.md §3).
   */
  openConversation: (id: string, options?: { preserveView?: boolean }) => Promise<void>;
  startNewConversation: (mode?: LayoutMode) => Promise<string | null>;
  /**
   * Restores the active session of a layout after the Chat | Code switch:
   * remembers/validates the layout's session and falls back to its first
   * visible conversation (or the welcome state when the layout has none).
   */
  enterLayout: (mode: LayoutMode) => Promise<void>;
  /** Clears the active session of the current layout (closing the last tab). */
  clearActiveConversation: () => void;
  /**
   * Adds a Chat session to the Code layout (shared) or removes that link.
   * Returns `false` when the backend rejects the change.
   */
  setConversationCodeLinked: (id: string, linked: boolean) => Promise<boolean>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  togglePinned: (id: string) => Promise<void>;
  addAttachments: (paths: string[]) => Promise<void>;
  removeAttachment: (id: string) => Promise<void>;
  clearAttachments: () => void;
  send: (content: string, options?: SendOptions) => Promise<void>;
  regenerate: () => Promise<void>;
  editAndResend: (messageId: string, content: string) => Promise<void>;
  stop: () => Promise<void>;
  /**
   * Reconciles the artifact list shown in the UI with the backend snapshot of
   * a conversation. Used after a turn ends, when a conversation is reopened and
   * after edits/deletions, so missed `artifact_created` events can never leave
   * the chat/panel stale.
   */
  syncArtifacts: (conversationId?: string | null) => Promise<void>;
  messagesFor: (conversationId: string | null) => ChatMessage[];
}

export interface SendOptions {
  /** Regenerate the last assistant message instead of appending a new user message. */
  regenerate?: boolean;
  /** Override the active model selection. */
  selection?: ModelSelection;
  /** Override the reasoning selection. */
  reasoning?: ReasoningSelection | null;
  /** Extra turn options merged over the app settings defaults. */
  turnOptions?: Partial<TurnOptions>;
}

const EMPTY: ChatMessage[] = [];

/**
 * A conversation's model is locked in as soon as it has messages (or a turn is
 * running). Switching models mid-conversation would mix answers from different
 * models and invalidate the reasoning/provider_state replay.
 */
export function selectModelLocked(state: ChatState): boolean {
  if (state.streaming) return true;
  const conversationId = state.activeId;
  if (!conversationId) return false;
  const messages = state.messagesByConversation[conversationId];
  if (messages && messages.length > 0) return true;
  const conversation = state.conversations.find((entry) => entry.id === conversationId);
  return (conversation?.messageCount ?? 0) > 0;
}

/** Copy shared by every surface that blocks model switching. */
export const MODEL_LOCKED_TITLE = 'Modelo bloqueado nesta conversa';
export const MODEL_LOCKED_DESCRIPTION =
  'O modelo não pode ser alterado depois de iniciar a conversa. Ajuste o modo de pensamento pelo botão ✦.';

/** Aligns the active selection with the model a conversation was started with. */
function syncSelectionToConversation(conversation: Conversation, messageCount: number): void {
  if (messageCount === 0) return;
  const model = getModel(conversation.providerId, conversation.modelId);
  if (!model) return;
  const app = useAppStore.getState();
  const current = app.selection;
  if (
    current.providerId === conversation.providerId &&
    current.modelId === conversation.modelId
  ) {
    return;
  }
  app.setActiveSelection({
    providerId: conversation.providerId,
    modelId: conversation.modelId,
    reasoning: reasoningForModel(model, current.reasoning),
  });
}

/**
 * Hard guarantee for started conversations: the model used by a turn always
 * comes from the conversation, never from a stale/mutated global selection.
 * Returns `null` when the model is not locked (new/custom turns keep the
 * selection from the composer).
 */
function lockedSelectionFor(state: ChatState): ModelSelection | null {
  if (!selectModelLocked(state)) return null;
  const conversationId = state.activeId;
  if (!conversationId) return null;
  const conversation = state.conversations.find((entry) => entry.id === conversationId);
  if (!conversation) return null;
  const model = getModel(conversation.providerId, conversation.modelId);
  if (!model) return null;
  const current = useAppStore.getState().selection;
  const reasoning =
    current.providerId === conversation.providerId && current.modelId === conversation.modelId
      ? current.reasoning
      : reasoningForModel(model, current.reasoning);
  return {
    providerId: conversation.providerId,
    modelId: conversation.modelId,
    reasoning,
  };
}

function turnOptionsFromSettings(overrides?: Partial<TurnOptions>): TurnOptions {
  const settings = useAppStore.getState().settings;
  return {
    webSearch: settings.webSearchEnabled,
    createFiles: settings.fileCreationEnabled,
    runCode: settings.codeExecutionEnabled,
    maxSteps: settings.maxSteps,
    temperature: settings.temperature ?? null,
    systemPromptOverride: null,
    regenerate: false,
    ...overrides,
  };
}

/** Appends streamed reasoning to the last trace step (creating it if needed). */
function appendTraceReasoning(trace: TraceStep[], delta: string): TraceStep[] {
  const steps = trace.length > 0 ? trace : [{ toolCalls: 0 }];
  const last = steps[steps.length - 1];
  return [...steps.slice(0, -1), { ...last, reasoning: `${last.reasoning ?? ''}${delta}` }];
}

/** Accounts one started tool call in the current trace step. */
function addTraceToolCall(trace: TraceStep[]): TraceStep[] {
  const steps = trace.length > 0 ? trace : [{ toolCalls: 0 }];
  const last = steps[steps.length - 1];
  return [...steps.slice(0, -1), { ...last, toolCalls: last.toolCalls + 1 }];
}

export const useChatStore = create<ChatState>()((set, get) => {
  const patchMessage = (
    conversationId: string,
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) => {
    set((state) => {
      const list = state.messagesByConversation[conversationId];
      if (!list) return {};
      let changed = false;
      const next = list.map((message) => {
        if (message.id !== messageId) return message;
        changed = true;
        return updater(message);
      });
      if (!changed) return {};
      return {
        messagesByConversation: { ...state.messagesByConversation, [conversationId]: next },
      };
    });
  };

  const replaceMessageId = (conversationId: string, fromId: string, toId: string) => {
    set((state) => {
      const list = state.messagesByConversation[conversationId];
      if (!list) return {};
      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: list.map((message) =>
            message.id === fromId ? { ...message, id: toId } : message,
          ),
        },
      };
    });
  };

  const pushMessage = (conversationId: string, message: ChatMessage) => {
    set((state) => {
      const list = state.messagesByConversation[conversationId] ?? [];
      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: [...list.filter((m) => m.id !== message.id), message],
        },
      };
    });
  };

  const removeMessage = (conversationId: string, messageId: string) => {
    set((state) => {
      const list = state.messagesByConversation[conversationId];
      if (!list) return {};
      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: list.filter((message) => message.id !== messageId),
        },
      };
    });
  };

  const finalizeAssistant = (conversationId: string, message: ChatMessage) => {
    set((state) => {
      const list = state.messagesByConversation[conversationId] ?? [];
      const exists = list.some((m) => m.id === message.id);
      const next = exists
        ? list.map((m) => (m.id === message.id ? message : m))
        : [...list, message];
      return {
        messagesByConversation: { ...state.messagesByConversation, [conversationId]: next },
        streaming: null,
      };
    });
  };

  const refreshList = async () => {
    try {
      const conversations = await api.listConversations();
      set({ conversations });
    } catch (error) {
      console.error('failed to refresh conversations', error);
    }
  };

  /** Active layout (the store mirrors `uiStore.layoutMode` per operation). */
  const currentLayout = (): LayoutMode => useUiStore.getState().layoutMode;

  /**
   * Perfil do turno: o layout Code só usa o perfil `code` para sessões do Code
   * (nativas ou compartilhadas). O backend rejeita um perfil que não
   * corresponde à sessão, então a decisão aqui é conservadora.
   */
  const turnProfileFor = (conversation: Conversation | undefined): TurnProfile => {
    if (!conversation) return 'chat';
    if (currentLayout() !== 'code') return 'chat';
    return conversation.mode === 'code' || conversation.codeLinked ? 'code' : 'chat';
  };

  /** Carrega/atualiza o estado da sessão de código quando ela é do Code. */
  const syncCodeSession = (conversation: Conversation | undefined): void => {
    if (!conversation) return;
    if (conversation.mode !== 'code' && !conversation.codeLinked) return;
    void useCodeStore.getState().load(conversation.id);
  };

  /** Sessions visible in one layout, preserving the backend order. */
  const visibleConversations = (conversations: Conversation[], layout: LayoutMode) =>
    filterConversationsForLayout(conversations, layout);

  /** Remembers `id` as the active session of `layout` (default: current). */
  const rememberActive = (id: string | null, layout: LayoutMode = currentLayout()) => {
    set((state) => ({
      activeIdByLayout: { ...state.activeIdByLayout, [layout]: id },
    }));
  };

  // Monotonic token: a slow `list_artifacts` response must never overwrite the
  // result of a newer synchronization (turn end, conversation switch, delete).
  let artifactSyncToken = 0;

  const syncArtifacts = async (conversationId?: string | null) => {
    const target = conversationId ?? get().activeId;
    if (!target) return;
    const token = ++artifactSyncToken;
    try {
      const artifacts = await api.listArtifacts(target);
      if (token !== artifactSyncToken) return;
      // The user may have switched conversations while the request was in
      // flight; the panel must never show artifacts from another conversation.
      if (get().activeId !== target) return;
      useUiStore.getState().setArtifacts(artifacts);
    } catch (error) {
      console.error('failed to sync conversation artifacts', error);
    }
  };

  const runTurn = async (
    payload: TurnPayload,
    context: {
      conversationId: string;
      assistantId: string;
      userMessageId: string | null;
      optimisticUserId: string | null;
      mode: 'new' | 'regenerate';
    },
  ) => {
    let reasoningBuffer = '';
    let textBuffer = '';
    let flushHandle: ReturnType<typeof setTimeout> | null = null;
    let finished = false;

    const flush = () => {
      if (flushHandle) {
        clearTimeout(flushHandle);
        flushHandle = null;
      }
      const target = context.assistantId;
      if (reasoningBuffer) {
        const delta = reasoningBuffer;
        reasoningBuffer = '';
        patchMessage(context.conversationId, target, (message) => ({
          ...message,
          reasoning: (message.reasoning ?? '') + delta,
          trace: appendTraceReasoning(message.trace ?? [], delta),
        }));
      }
      if (textBuffer) {
        const delta = textBuffer;
        textBuffer = '';
        patchMessage(context.conversationId, target, (message) => ({
          ...message,
          content: message.content + delta,
        }));
      }
    };

    const schedule = () => {
      if (flushHandle) return;
      flushHandle = setTimeout(flush, 33);
    };

    const handleEvent = (event: TurnEvent) => {
      // O estado de harness de código (aprovações/plano/tarefas/contexto/
      // alterações/jobs) é ortogonal ao streaming e vive no `codeStore`.
      if (isCodeEvent(event)) useCodeStore.getState().applyEvent(context.conversationId, event);
      switch (event.type) {
        case 'turn_started': {
          if (context.optimisticUserId) {
            replaceMessageId(context.conversationId, context.optimisticUserId, event.userMessageId);
            context.userMessageId = event.userMessageId;
            context.optimisticUserId = null;
          }
          replaceMessageId(context.conversationId, context.assistantId, event.assistantMessageId);
          context.assistantId = event.assistantMessageId;
          set((state) =>
            state.streaming
              ? {
                  streaming: {
                    ...state.streaming,
                    assistantId: event.assistantMessageId,
                    userMessageId: event.userMessageId,
                  },
                }
              : {},
          );
          break;
        }
        case 'step_started':
          // A new agent loop step begins: the streamed reasoning that follows
          // belongs to its own timeline entry.
          flush();
          patchMessage(context.conversationId, context.assistantId, (message) => ({
            ...message,
            trace: [...(message.trace ?? []), { toolCalls: 0 }],
          }));
          set((state) => (state.streaming ? { streaming: { ...state.streaming, step: event.step } } : {}));
          break;
        case 'reasoning_delta':
          reasoningBuffer += event.delta;
          set((state) =>
            state.streaming ? { streaming: { ...state.streaming, phase: 'reasoning' } } : {},
          );
          schedule();
          break;
        case 'reasoning_done':
          flush();
          break;
        case 'text_delta':
          textBuffer += event.delta;
          set((state) => (state.streaming ? { streaming: { ...state.streaming, phase: 'text' } } : {}));
          schedule();
          break;
        case 'tool_call_started':
          flush();
          set((state) => (state.streaming ? { streaming: { ...state.streaming, phase: 'tool' } } : {}));
          patchMessage(context.conversationId, context.assistantId, (message) => ({
            ...message,
            toolCalls: [...message.toolCalls.filter((t) => t.id !== event.toolCall.id), event.toolCall],
            trace: addTraceToolCall(message.trace ?? []),
          }));
          break;
        case 'tool_call_args':
          patchMessage(context.conversationId, context.assistantId, (message) => ({
            ...message,
            toolCalls: message.toolCalls.map((tool) =>
              tool.id === event.id ? { ...tool, arguments: tool.arguments + event.delta } : tool,
            ),
          }));
          break;
        case 'tool_call_finished':
          patchMessage(context.conversationId, context.assistantId, (message) => ({
            ...message,
            toolCalls: message.toolCalls.map((tool) =>
              tool.id === event.id
                ? {
                    ...tool,
                    status: event.status,
                    result: event.result,
                    summary: event.summary ?? tool.summary,
                    presentation: event.presentation ?? tool.presentation ?? null,
                    finishedAt: Date.now(),
                  }
                : tool,
            ),
            citations: mergeCitations(message.citations, event.citations ?? []),
          }));
          break;
        case 'artifact_created':
          // The uiStore holds the artifacts of the conversation currently on
          // screen. Events from a turn the user navigated away from are
          // reconciled when that conversation is opened again, so they must not
          // leak into an unrelated chat/panel.
          if (event.artifact.conversationId !== context.conversationId) break;
          if (get().activeId !== context.conversationId) break;
          useUiStore.getState().addArtifact(event.artifact);
          break;
        case 'usage':
          patchMessage(context.conversationId, context.assistantId, (message) => ({
            ...message,
            usage: { ...(message.usage ?? {}), ...event.usage },
          }));
          break;
        case 'message_updated':
          // The definitive message (persisted by the harness) already carries
          // the trace; flush pending deltas first so nothing is duplicated.
          flush();
          patchMessage(context.conversationId, event.message.id, () => event.message);
          break;
        case 'title_updated':
          set((state) => ({
            conversations: state.conversations.map((c) =>
              c.id === event.conversationId ? { ...c, title: event.title } : c,
            ),
          }));
          break;
        case 'done':
          flush();
          finished = true;
          applyResult(event.result);
          void useCodeStore.getState().refresh(context.conversationId);
          break;
        case 'cancelled':
          flush();
          finished = true;
          patchMessage(context.conversationId, context.assistantId, (message) => ({
            ...message,
            status: 'cancelled',
          }));
          set({ streaming: null });
          void syncArtifacts(context.conversationId);
          void useCodeStore.getState().refresh(context.conversationId);
          break;
        case 'error':
          flush();
          finished = true;
          patchMessage(context.conversationId, context.assistantId, (message) => ({
            ...message,
            status: message.content ? 'complete' : 'error',
          }));
          set({
            streaming: null,
            error: event.message,
            errorCode: event.code ?? null,
            errorHint: event.hint ?? null,
          });
          void syncArtifacts(context.conversationId);
          void useCodeStore.getState().refresh(context.conversationId);
          toast.error('Falha na resposta', { description: event.hint ?? event.message });
          break;
        default:
          break;
      }
    };

    const applyResult = (result: TurnResult) => {
      finalizeAssistant(context.conversationId, result.assistantMessage);
      if (context.userMessageId) {
        patchMessage(context.conversationId, context.userMessageId, () => result.userMessage);
      }
      if (result.conversation) {
        set((state) => {
          const exists = state.conversations.some((c) => c.id === result.conversation!.id);
          const conversations = exists
            ? state.conversations.map((c) => (c.id === result.conversation!.id ? result.conversation! : c))
            : [result.conversation!, ...state.conversations];
          return {
            conversations: conversations.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
          };
        });
      }
      if (result.error) {
        set({ error: result.error });
        toast.error('A resposta terminou com erro', { description: result.error });
      }
      void refreshList();
      // Authoritative reconciliation: even if an `artifact_created` event was
      // lost, the conversation's artifacts are complete once the turn is done.
      void syncArtifacts(context.conversationId);
    };

    try {
      const result = await api.runTurn(payload, handleEvent);
      flush();
      if (!finished) {
        finished = true;
        applyResult(result);
      }
    } catch (error) {
      flush();
      const message = error instanceof Error ? error.message : String(error);
      patchMessage(context.conversationId, context.assistantId, (m) =>
        m.content || m.reasoning
          ? { ...m, status: 'complete' }
          : { ...m, status: 'error', content: message },
      );
      set({ streaming: null, error: message });
      toast.error('Não foi possível concluir a mensagem', { description: message });
      void syncArtifacts(context.conversationId);
    } finally {
      if (flushHandle) clearTimeout(flushHandle);
    }
  };

  const ensureConversation = async (title: string, selection: ModelSelection): Promise<string> => {
    const current = get().activeId;
    if (current) return current;
    const layout = currentLayout();
    const conversation = await api.createConversation(
      title,
      selection.providerId,
      selection.modelId,
      layout,
    );
    set((state) => ({
      conversations: [conversation, ...state.conversations],
      activeId: conversation.id,
      messagesByConversation: { ...state.messagesByConversation, [conversation.id]: [] },
      activeIdByLayout: { ...state.activeIdByLayout, [layout]: conversation.id },
    }));
    return conversation.id;
  };

  return {
    conversations: [],
    conversationsLoading: false,
    activeId: null,
    activeIdByLayout: { chat: null, code: null },
    messagesByConversation: {},
    loadingConversationId: null,
    streaming: null,
    pendingAttachments: [],
    error: null,
    errorCode: null,
    errorHint: null,

    init: async () => {
      set({ conversationsLoading: true });
      try {
        const conversations = await api.listConversations();
        set({ conversations, conversationsLoading: false });
        if (!get().activeId) {
          // Each layout opens the first session it can see; a layout with no
          // sessions of its own starts on the welcome screen.
          const layout = currentLayout();
          const first = visibleConversations(conversations, layout)[0];
          if (first) await get().openConversation(first.id);
        }
      } catch (error) {
        set({ conversationsLoading: false, error: String(error) });
      }
    },

    refreshConversations: refreshList,

    enterLayout: async (mode) => {
      const state = get();
      const visible = visibleConversations(state.conversations, mode);
      const remembered = state.activeIdByLayout[mode];
      const target = visible.some((conversation) => conversation.id === remembered)
        ? remembered
        : (visible[0]?.id ?? null);
      if (target === state.activeId && (target === null || state.messagesByConversation[target])) {
        rememberActive(target, mode);
        return;
      }
      if (target) {
        // Restore the session in the background: the layout keeps whichever page
        // it was showing (Biblioteca/Skills) instead of being forced back to the
        // conversation, matching WorkspaceCenter's per-layout view state.
        await get().openConversation(target, { preserveView: true });
        return;
      }
      // No session for this layout: show its welcome state without touching the
      // other layout's cached conversation.
      set({ activeId: null, loadingConversationId: null });
      rememberActive(null, mode);
      useUiStore.getState().setArtifacts([]);
      useUiStore.getState().closeArtifactPanel();
    },

    clearActiveConversation: () => {
      set({ activeId: null, loadingConversationId: null });
      rememberActive(null);
      useUiStore.getState().setArtifacts([]);
      useUiStore.getState().closeArtifactPanel();
    },

    setConversationCodeLinked: async (id, linked) => {
      try {
        const updated = await api.setConversationCodeLinked(id, linked);
        set((state) => ({
          conversations: state.conversations.map((conversation) =>
            conversation.id === id ? { ...conversation, ...updated } : conversation,
          ),
        }));
        return true;
      } catch (error) {
        console.error('failed to update the conversation code link', error);
        return false;
      }
    },

    openConversation: async (id, options) => {
      // Navigating to a conversation leaves the skills view by default and shows
      // the session surface in both layouts (Code shares the same conversation).
      // `enterLayout` preserves the page instead: switching layouts must not
      // close the Biblioteca/Skills page the user was reading.
      if (!options?.preserveView) {
        useUiStore.getState().setActiveView('chat');
        useUiStore.getState().setCodeView('session');
      }
      if (get().activeId === id && get().messagesByConversation[id]) {
        // Messages are cached, but the artifacts may have changed (turn ended
        // in the background, deletion, app reload): always reconcile them.
        rememberActive(id);
        await syncArtifacts(id);
        syncCodeSession(get().conversations.find((conversation) => conversation.id === id));
        return;
      }
      set({ activeId: id, loadingConversationId: id });
      rememberActive(id);
      // Never show the previous conversation's artifacts while the new one
      // loads (the panel may be open on the list).
      useUiStore.getState().setArtifacts([]);
      try {
        const detail = await api.getConversation(id);
        if (detail) {
          set((state) => ({
            messagesByConversation: { ...state.messagesByConversation, [id]: detail.messages },
            conversations: state.conversations.map((c) => (c.id === id ? detail.conversation : c)),
            loadingConversationId: null,
          }));
          // The conversation's model is locked in once it has messages; mirror
          // it in the composer so the locked pill shows the right model.
          syncSelectionToConversation(detail.conversation, detail.messages.length);
          syncCodeSession(detail.conversation);
        } else {
          set({ loadingConversationId: null });
        }
        await syncArtifacts(id);
      } catch (error) {
        set({ loadingConversationId: null, error: String(error) });
      }
    },

    startNewConversation: async (mode) => {
      // "Novo chat"/"Novo agente" creates the session in that layout's own
      // namespace and returns to the conversation surface.
      const layout = mode ?? currentLayout();
      useUiStore.getState().setActiveView('chat');
      useUiStore.getState().setCodeView('session');
      // Leaving a started conversation resets the composer to the configured
      // default model (the previous conversation's model is locked to it).
      if (selectModelLocked(get())) {
        useAppStore
          .getState()
          .setActiveSelection(defaultSelection(useAppStore.getState().settings));
      }
      const selection = useAppStore.getState().selection;
      try {
        const conversation = await api.createConversation(
          'Nova conversa',
          selection.providerId,
          selection.modelId,
          layout,
        );
        set((state) => ({
          conversations: [conversation, ...state.conversations],
          activeId: conversation.id,
          messagesByConversation: { ...state.messagesByConversation, [conversation.id]: [] },
          pendingAttachments: [],
          activeIdByLayout: { ...state.activeIdByLayout, [layout]: conversation.id },
        }));
        useUiStore.getState().setArtifacts([]);
        useUiStore.getState().closeArtifactPanel();
        return conversation.id;
      } catch (error) {
        toast.error('Não foi possível criar a conversa', { description: String(error) });
        return null;
      }
    },

    deleteConversation: async (id) => {
      try {
        await api.deleteConversation(id);
        const layout = currentLayout();
        set((state) => {
          const rest = state.conversations.filter((c) => c.id !== id);
          const messagesByConversation = { ...state.messagesByConversation };
          delete messagesByConversation[id];
          const stillActive = state.activeId !== id;
          const fallback = stillActive
            ? state.activeId
            : (filterConversationsForLayout(rest, layout)[0]?.id ?? null);
          const activeIdByLayout = { ...state.activeIdByLayout };
          if (!stillActive) activeIdByLayout[layout] = fallback;
          for (const key of Object.keys(activeIdByLayout) as LayoutMode[]) {
            if (activeIdByLayout[key] === id) activeIdByLayout[key] = null;
          }
          return {
            conversations: rest,
            messagesByConversation,
            activeId: fallback,
            activeIdByLayout,
          };
        });
        const next = get().activeId;
        if (next) {
          await get().openConversation(next);
        } else {
          useUiStore.getState().setArtifacts([]);
          useUiStore.getState().closeArtifactPanel();
        }
      } catch (error) {
        toast.error('Não foi possível excluir', { description: String(error) });
      }
    },

    renameConversation: async (id, title) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      set((state) => ({
        conversations: state.conversations.map((c) => (c.id === id ? { ...c, title: trimmed } : c)),
      }));
      try {
        await api.renameConversation(id, trimmed);
      } catch (error) {
        toast.error('Não foi possível renomear', { description: String(error) });
      }
    },

    togglePinned: async (id) => {
      const conversation = get().conversations.find((c) => c.id === id);
      if (!conversation) return;
      const pinned = !conversation.pinned;
      set((state) => ({
        conversations: state.conversations.map((c) => (c.id === id ? { ...c, pinned } : c)),
      }));
      try {
        await api.setConversationPinned(id, pinned);
        await refreshList();
      } catch (error) {
        toast.error('Não foi possível fixar', { description: String(error) });
      }
    },

    addAttachments: async (paths) => {
      if (!paths.length) return;
      try {
        const imported = await api.importAttachments(paths);
        set((state) => ({ pendingAttachments: [...state.pendingAttachments, ...imported] }));
      } catch (error) {
        toast.error('Falha ao importar anexo', { description: String(error) });
      }
    },

    removeAttachment: async (id) => {
      set((state) => ({
        pendingAttachments: state.pendingAttachments.filter((a) => a.id !== id),
      }));
      try {
        await api.deleteAttachment(id);
      } catch {
        /* non-blocking */
      }
    },

    clearAttachments: () => set({ pendingAttachments: [] }),

    dismissError: () => set({ error: null, errorCode: null, errorHint: null }),

    send: async (content, options) => {
      const state = get();
      if (state.streaming) {
        toast.info('Aguarde a resposta atual terminar');
        return;
      }
      const trimmed = content.trim();
      const attachments = state.pendingAttachments;
      if (!trimmed && !attachments.length) return;

      const app = useAppStore.getState();
      // A started conversation keeps its model even if some other surface
      // changed the global selection (defense in depth for the model lock).
      const selection = options?.selection ?? lockedSelectionFor(state) ?? app.selection;
      const reasoning = options?.reasoning !== undefined ? options.reasoning : selection.reasoning;
      // Never start a turn whose provider has no credential: show the same
      // actionable CTA the settings screen offers (API key or ChatGPT login).
      const activeProvider = app.providers?.find((provider) => provider.id === selection.providerId);
      if (activeProvider) {
        const key = app.keys?.find((entry) => entry.providerId === selection.providerId);
        const auth = app.auth?.find((entry) => entry.providerId === selection.providerId);
        const ready = Boolean(key?.hasKey) || auth?.state === 'signed-in';
        if (!ready) {
          toast.error('Conecte uma credencial para enviar', {
            description:
              activeProvider.auth === 'oauth'
                ? 'Entre com o ChatGPT (Configurações → Provedores) ou adicione uma API key.'
                : 'Adicione a API key deste provedor em Configurações → Provedores.',
          });
          return;
        }
      }
      const turnId = newId();
      let conversationId: string;
      try {
        conversationId = await ensureConversation(deriveTitle(trimmed || attachments[0]?.name || 'Nova conversa'), selection);
      } catch (error) {
        toast.error('Não foi possível criar a conversa', { description: String(error) });
        return;
      }

      const now = Date.now();
      const optimisticUserId = `optimistic-user-${turnId}`;
      const optimisticAssistantId = `optimistic-assistant-${turnId}`;
      const userMessage: ChatMessage = {
        id: optimisticUserId,
        conversationId,
        role: 'user',
        content: trimmed,
        status: 'complete',
        toolCalls: [],
        citations: [],
        attachments,
        modelId: selection.modelId,
        providerId: selection.providerId,
        createdAt: now,
      };
      const assistantMessage: ChatMessage = {
        id: optimisticAssistantId,
        conversationId,
        role: 'assistant',
        content: '',
        reasoning: '',
        status: 'streaming',
        toolCalls: [],
        citations: [],
        attachments: [],
        trace: [],
        modelId: selection.modelId,
        providerId: selection.providerId,
        createdAt: now + 1,
      };

      const previous = get().messagesByConversation[conversationId] ?? [];
      set((s) => ({
        messagesByConversation: {
          ...s.messagesByConversation,
          [conversationId]: [...previous, userMessage, assistantMessage],
        },
        pendingAttachments: [],
        error: null,
        errorCode: null,
        errorHint: null,
        streaming: {
          turnId,
          conversationId,
          assistantId: optimisticAssistantId,
          userMessageId: optimisticUserId,
          phase: 'starting',
          step: 1,
          startedAt: now,
        },
      }));

      const payload: TurnPayload = {
        conversationId,
        content: trimmed,
        attachmentIds: attachments.map((a) => a.id),
        providerId: selection.providerId,
        modelId: selection.modelId,
        reasoning: reasoning ?? null,
        options: turnOptionsFromSettings(options?.turnOptions),
        profile: turnProfileFor(get().conversations.find((c) => c.id === conversationId)),
        turnId,
      };

      void runTurn(payload, {
        conversationId,
        assistantId: optimisticAssistantId,
        userMessageId: null,
        optimisticUserId,
        mode: 'new',
      });
    },

    regenerate: async () => {
      const state = get();
      if (state.streaming || !state.activeId) return;
      const conversationId = state.activeId;
      const messages = state.messagesByConversation[conversationId] ?? [];
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      if (!lastAssistant || !lastUser) return;

      const app = useAppStore.getState();
      // Regenerating keeps the model the conversation was started with.
      const selection = lockedSelectionFor(state) ?? app.selection;
      const turnId = newId();
      try {
        await api.truncateConversation(conversationId, lastAssistant.id);
      } catch (error) {
        toast.error('Não foi possível regenerar', { description: String(error) });
        return;
      }
      removeMessage(conversationId, lastAssistant.id);
      // The truncated answer may own artifacts; refresh the list so the panel
      // reflects only what still exists.
      void syncArtifacts(conversationId);

      const assistantMessage: ChatMessage = {
        id: `optimistic-assistant-${turnId}`,
        conversationId,
        role: 'assistant',
        content: '',
        reasoning: '',
        status: 'streaming',
        toolCalls: [],
        citations: [],
        attachments: [],
        trace: [],
        modelId: selection.modelId,
        providerId: selection.providerId,
        createdAt: Date.now(),
      };
      pushMessage(conversationId, assistantMessage);
      set({
        streaming: {
          turnId,
          conversationId,
          assistantId: assistantMessage.id,
          userMessageId: lastUser.id,
          phase: 'starting',
          step: 1,
          startedAt: Date.now(),
        },
        error: null,
        errorCode: null,
        errorHint: null,
      });

      const payload: TurnPayload = {
        conversationId,
        content: lastUser.content,
        attachmentIds: lastUser.attachments.map((a) => a.id),
        providerId: selection.providerId,
        modelId: selection.modelId,
        reasoning: selection.reasoning ?? null,
        options: turnOptionsFromSettings({ regenerate: true }),
        profile: turnProfileFor(get().conversations.find((c) => c.id === conversationId)),
        turnId,
      };

      void runTurn(payload, {
        conversationId,
        assistantId: assistantMessage.id,
        userMessageId: lastUser.id,
        optimisticUserId: null,
        mode: 'regenerate',
      });
    },

    editAndResend: async (messageId, content) => {
      const state = get();
      if (state.streaming || !state.activeId) return;
      const conversationId = state.activeId;
      const messages = state.messagesByConversation[conversationId] ?? [];
      const index = messages.findIndex((m) => m.id === messageId);
      if (index < 0) return;
      const trimmed = content.trim();
      if (!trimmed) return;
      try {
        await api.truncateConversation(conversationId, messageId);
      } catch (error) {
        toast.error('Não foi possível editar', { description: String(error) });
        return;
      }
      set((s) => ({
        messagesByConversation: {
          ...s.messagesByConversation,
          [conversationId]: messages.slice(0, index),
        },
      }));
      void syncArtifacts(conversationId);
      await get().send(trimmed);
    },

    stop: async () => {
      const streaming = get().streaming;
      if (!streaming) return;
      set((state) =>
        state.streaming
          ? { streaming: { ...state.streaming, phase: 'starting' } }
          : {},
      );
      try {
        await api.cancelTurn(streaming.turnId);
      } catch (error) {
        console.error('cancel failed', error);
      }
    },

    syncArtifacts,

    messagesFor: (conversationId) =>
      conversationId ? (get().messagesByConversation[conversationId] ?? EMPTY) : EMPTY,
  };
});

function mergeCitations(current: ChatMessage['citations'], incoming: NonNullable<ChatMessage['citations']>): ChatMessage['citations'] {
  if (!incoming.length) return current;
  const seen = new Set(current.map((c) => c.url));
  const merged = [...current];
  for (const citation of incoming) {
    if (seen.has(citation.url)) continue;
    seen.add(citation.url);
    merged.push(citation);
  }
  return merged;
}

export function selectActiveMessages(state: ChatState): ChatMessage[] {
  return state.activeId ? (state.messagesByConversation[state.activeId] ?? EMPTY) : EMPTY;
}

export function selectActiveConversation(state: ChatState): Conversation | undefined {
  return state.activeId ? state.conversations.find((c) => c.id === state.activeId) : undefined;
}

export type { ChatState };
export type { Artifact };
