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
  TurnEvent,
  TurnOptions,
  TurnPayload,
  TurnResult,
} from '../types';
import { deriveTitle, newId } from '../utils';
import { useAppStore } from './appStore';
import { useUiStore } from './uiStore';

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
  messagesByConversation: Record<string, ChatMessage[]>;
  loadingConversationId: string | null;
  streaming: StreamingState | null;
  pendingAttachments: AttachmentInfo[];
  error: string | null;

  init: () => Promise<void>;
  refreshConversations: () => Promise<void>;
  openConversation: (id: string) => Promise<void>;
  startNewConversation: () => Promise<string | null>;
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

function turnOptionsFromSettings(overrides?: Partial<TurnOptions>): TurnOptions {
  const settings = useAppStore.getState().settings;
  return {
    webSearch: settings.webSearchEnabled,
    createFiles: settings.fileCreationEnabled,
    maxSteps: settings.maxSteps,
    temperature: settings.temperature ?? null,
    systemPromptOverride: null,
    regenerate: false,
    ...overrides,
  };
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
                    finishedAt: Date.now(),
                  }
                : tool,
            ),
            citations: mergeCitations(message.citations, event.citations ?? []),
          }));
          break;
        case 'artifact_created':
          useUiStore.getState().addArtifact(event.artifact);
          break;
        case 'usage':
          patchMessage(context.conversationId, context.assistantId, (message) => ({
            ...message,
            usage: { ...(message.usage ?? {}), ...event.usage },
          }));
          break;
        case 'message_updated':
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
          break;
        case 'cancelled':
          flush();
          finished = true;
          patchMessage(context.conversationId, context.assistantId, (message) => ({
            ...message,
            status: 'cancelled',
          }));
          set({ streaming: null });
          break;
        case 'error':
          flush();
          finished = true;
          patchMessage(context.conversationId, context.assistantId, (message) => ({
            ...message,
            status: message.content ? 'complete' : 'error',
          }));
          set({ streaming: null, error: event.message });
          toast.error('Falha na resposta', { description: event.message });
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
    } finally {
      if (flushHandle) clearTimeout(flushHandle);
    }
  };

  const ensureConversation = async (title: string, selection: ModelSelection): Promise<string> => {
    const current = get().activeId;
    if (current) return current;
    const conversation = await api.createConversation(
      title,
      selection.providerId,
      selection.modelId,
    );
    set((state) => ({
      conversations: [conversation, ...state.conversations],
      activeId: conversation.id,
      messagesByConversation: { ...state.messagesByConversation, [conversation.id]: [] },
    }));
    return conversation.id;
  };

  return {
    conversations: [],
    conversationsLoading: false,
    activeId: null,
    messagesByConversation: {},
    loadingConversationId: null,
    streaming: null,
    pendingAttachments: [],
    error: null,

    init: async () => {
      set({ conversationsLoading: true });
      try {
        const conversations = await api.listConversations();
        set({ conversations, conversationsLoading: false });
        const first = conversations[0];
        if (first && !get().activeId) {
          await get().openConversation(first.id);
        }
      } catch (error) {
        set({ conversationsLoading: false, error: String(error) });
      }
    },

    refreshConversations: refreshList,

    openConversation: async (id) => {
      if (get().activeId === id && get().messagesByConversation[id]) return;
      set({ activeId: id, loadingConversationId: id });
      try {
        const detail = await api.getConversation(id);
        if (detail) {
          set((state) => ({
            messagesByConversation: { ...state.messagesByConversation, [id]: detail.messages },
            conversations: state.conversations.map((c) => (c.id === id ? detail.conversation : c)),
            loadingConversationId: null,
          }));
        } else {
          set({ loadingConversationId: null });
        }
        const artifacts = await api.listArtifacts(id);
        useUiStore.getState().setArtifacts(artifacts);
      } catch (error) {
        set({ loadingConversationId: null, error: String(error) });
      }
    },

    startNewConversation: async () => {
      const selection = useAppStore.getState().selection;
      try {
        const conversation = await api.createConversation(
          'Nova conversa',
          selection.providerId,
          selection.modelId,
        );
        set((state) => ({
          conversations: [conversation, ...state.conversations],
          activeId: conversation.id,
          messagesByConversation: { ...state.messagesByConversation, [conversation.id]: [] },
          pendingAttachments: [],
        }));
        useUiStore.getState().setArtifacts([]);
        return conversation.id;
      } catch (error) {
        toast.error('Não foi possível criar a conversa', { description: String(error) });
        return null;
      }
    },

    deleteConversation: async (id) => {
      try {
        await api.deleteConversation(id);
        set((state) => {
          const rest = state.conversations.filter((c) => c.id !== id);
          const messagesByConversation = { ...state.messagesByConversation };
          delete messagesByConversation[id];
          return {
            conversations: rest,
            messagesByConversation,
            activeId: state.activeId === id ? (rest[0]?.id ?? null) : state.activeId,
          };
        });
        const next = get().activeId;
        if (next) await get().openConversation(next);
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
      const selection = options?.selection ?? app.selection;
      const reasoning = options?.reasoning !== undefined ? options.reasoning : selection.reasoning;
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
      const selection = app.selection;
      const turnId = newId();
      try {
        await api.truncateConversation(conversationId, lastAssistant.id);
      } catch (error) {
        toast.error('Não foi possível regenerar', { description: String(error) });
        return;
      }
      removeMessage(conversationId, lastAssistant.id);

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
      });

      const payload: TurnPayload = {
        conversationId,
        content: lastUser.content,
        attachmentIds: lastUser.attachments.map((a) => a.id),
        providerId: selection.providerId,
        modelId: selection.modelId,
        reasoning: selection.reasoning ?? null,
        options: turnOptionsFromSettings({ regenerate: true }),
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
