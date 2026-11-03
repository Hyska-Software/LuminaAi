import { create } from 'zustand';
import { toast } from 'sonner';
import { api } from '../api';
import type {
  Agent,
  AgentInput,
  Artifact,
  AttachmentInfo,
  ChatMessage,
  Conversation,
  ModelSelection,
  ReasoningSelection,
  SubagentLiveState,
  TraceStep,
  TurnEvent,
  TurnEventBusPayload,
  TurnOptions,
  TurnPayload,
  TurnProfile,
  TurnResult,
  TurnKind,
} from '../types';
import { deriveTitle, newId } from '../utils';
import { inputFromAgent } from '../agentInput';
import { defaultSelection, findModelIn, getModel } from '../catalog';
import { filterConversationsForLayout } from '../conversations';
import { reasoningForModel } from '../modelMenu';
import { shouldContinueGoal } from '../goalRunner';
import { useAgentQueueStore, compactAgentQueue } from './agentQueueStore';
import { useAgentStore } from './agentStore';
import { useAppStore } from './appStore';
import { isCodeEvent, useCodeStore } from './codeStore';
import { useCacheStore } from './cacheStore';
import { useUiStore, type LayoutMode } from './uiStore';

export interface StreamingState {
  turnId: string;
  conversationId: string;
  assistantId: string;
  userMessageId: string | null;
  phase: 'starting' | 'reasoning' | 'text' | 'tool';
  step: number;
  startedAt: number;
  /** `user` (turno do usuário) ou `goal_round` (rodada automática do objetivo). */
  turnKind: TurnKind;
  /** Live child agents of this turn, keyed by the parent `task` call id. */
  subagents?: Record<string, SubagentLiveState>;
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
  /**
   * Active turns per conversation. `streaming` below is only the visible slice
   * of `activeId`; background agent threads keep their own entry here so
   * several agents can work at the same time without sharing a single slot.
   */
  streamsByConversation: Record<string, StreamingState>;
  /** Visible stream of the active conversation (always mirrors the map). */
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
  startNewConversation: (
    mode?: LayoutMode,
    options?: { agentId?: string },
  ) => Promise<string | null>;
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
  /**
   * Applies a model/provider choice (and its thinking mode).
   *
   * A started Code session treats the pair as a **session property**: the
   * change is persisted immediately (the next turn, goal rounds and reopening
   * the session use it) without touching the configured defaults. Everywhere
   * else the previous behavior is kept: the selection is applied and becomes
   * the default for new conversations. Locked targets are ignored with the
   * same copy the selector surfaces show.
   */
  chooseModel: (selection: ModelSelection) => Promise<boolean>;
  /**
   * Applies a thinking-mode choice. Agent turns read the reasoning from the
   * persona (the backend freezes it per thread), so the Agents layout persists
   * the change on the agent instead of the global selection.
   */
  setReasoning: (reasoning: ReasoningSelection | null) => void;
  addAttachments: (paths: string[]) => Promise<void>;
  removeAttachment: (id: string) => Promise<void>;
  clearAttachments: () => void;
  send: (content: string, options?: SendOptions) => Promise<void>;
  /** Drains the next queued message of a conversation (no-op when busy/paused). */
  processQueue: (conversationId?: string | null) => Promise<void>;
  /** Resumes every persisted agent queue that is idle and unpaused. */
  drainAgentQueues: () => Promise<void>;
  /** Applies a turn event mirrored on the global bus (reload/reattach). */
  applyExternalTurnEvent: (payload: TurnEventBusPayload) => Promise<void>;
  /** Rebuilds streams/messages of turns still running in Rust after a reload. */
  reattachTurns: () => Promise<void>;
  regenerate: () => Promise<void>;
  editAndResend: (messageId: string, content: string) => Promise<void>;
  stop: () => Promise<void>;
  /** Stops one conversation even when it is running in the background. */
  stopConversation: (conversationId: string) => Promise<void>;
  /** Stops every active turn (global kill switch). */
  stopAllTurns: () => Promise<void>;
  /**
   * Inicia uma rodada do objetivo na conversa informada (turno `goal_round`).
   * Não roda se já houver streaming/rodada sendo montada; o backend revalida
   * (preflight + harness) e pode recusar.
   */
  runGoalRound: (conversationId: string) => Promise<boolean>;
  /**
   * Chamado no `done` de um turno: decide (regra pura + preflight do backend)
   * se a próxima rodada automática do objetivo deve começar. Só age quando a
   * sessão do objetivo está ativa no layout Code.
   */
  maybeContinueGoal: (conversationId: string) => Promise<void>;
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
  /**
   * O usuário pediu um objetivo pelo `/goal` (chip do composer). O turno é
   * humano normal; o backend injeta a instrução de criação no runtime context.
   */
  goalRequest?: boolean;
}

const EMPTY: ChatMessage[] = [];

/**
 * Turns started by this renderer. Their events arrive through the invoke
 * channel; the global bus listener must ignore them to avoid double-applying.
 */
const localTurnIds = new Set<string>();
/** Highest global-bus sequence applied per turn (reattach + live dedupe). */
const appliedTurnSeq = new Map<string, number>();
const terminalTurnIds = new Set<string>();
/** Dedupe window per conversation+category to avoid notification spam. */
const notificationThrottle = new Map<string, number>();
const NOTIFICATION_DEDUPE_MS = 5_000;

export function notificationsAllowed(category: string): boolean {
  const settings = useAppStore.getState().settings;
  if (settings.notificationsEnabled === false || settings.notificationsDnd === true) {
    return false;
  }
  switch (category) {
    case 'approval_requested':
      return settings.notificationsApprovals !== false;
    case 'question_requested':
      return settings.notificationsQuestions !== false;
    case 'turn_complete':
      return settings.notificationsCompletions !== false;
    case 'task_update':
      return settings.notificationsTasks !== false;
    default:
      return true;
  }
}

function shouldNotify(category: string, conversationId: string): boolean {
  if (!notificationsAllowed(category)) return false;
  const key = `${category}:${conversationId}`;
  const now = Date.now();
  const last = notificationThrottle.get(key) ?? 0;
  if (now - last < NOTIFICATION_DEDUPE_MS) return false;
  notificationThrottle.set(key, now);
  return true;
}

/**
 * Why the model selector is locked for the active layout (`null` = switching is
 * allowed).
 *
 * - Chat keeps the model of a started conversation locked: mixing answers from
 *   different models there would change the identity of the thread and the
 *   replay of the reasoning (`provider_state`).
 * - Code sessions are long-running and users need to escalate to a stronger
 *   model/provider mid-task. The backend persists the pair per session and
 *   replays older messages neutrally (each reply keeps its own model), so the
 *   switch is allowed between turns.
 * - A running turn always locks the selector: the model is resolved when the
 *   turn starts and must not change under it.
 */
export type ModelLockReason = 'started' | 'streaming';

/**
 * Stream of one conversation. `streamsByConversation` is authoritative; the
 * top-level `streaming` is accepted as a mirror for state written by older
 * call sites/tests that only set the visible slice.
 */
export function selectConversationStream(
  state: ChatState,
  conversationId: string | null | undefined,
): StreamingState | null {
  if (!conversationId) return null;
  return (
    state.streamsByConversation[conversationId] ??
    (state.streaming?.conversationId === conversationId ? state.streaming : null)
  );
}

/** Stream of the active conversation (`null` when it is idle). */
export function selectActiveStream(state: ChatState): StreamingState | null {
  return selectConversationStream(state, state.activeId);
}

/** True when the active conversation already has messages (any layout). */
export function selectActiveConversationStarted(state: ChatState): boolean {
  const conversationId = state.activeId;
  if (!conversationId) return false;
  const messages = state.messagesByConversation[conversationId];
  if (messages && messages.length > 0) return true;
  const conversation = state.conversations.find((entry) => entry.id === conversationId);
  return (conversation?.messageCount ?? 0) > 0;
}

/** A session visible in the Code layout: Code-born or shared from Chat. */
function isCodeSessionConversation(conversation: Conversation | undefined): boolean {
  return Boolean(conversation && (conversation.mode === 'code' || conversation.codeLinked));
}

/** Lock state of the model selector, given the active layout. */
export function modelLockReason(state: ChatState, layout: LayoutMode): ModelLockReason | null {
  const conversation = state.activeId
    ? state.conversations.find((entry) => entry.id === state.activeId)
    : undefined;
  // Only Code sessions get the per-session model switch; a Chat-only session
  // shown here (transitional state) keeps the Chat rules.
  const unlockable = layout === 'code' && isCodeSessionConversation(conversation);
  if (!unlockable && selectActiveConversationStarted(state)) return 'started';
  // While a turn is visible, the selector stays locked even if the active
  // conversation has not loaded yet (defensive: the model is already frozen
  // into the request).
  if (selectActiveStream(state) ?? state.streaming) return 'streaming';
  return null;
}

/**
 * Route of the active agent surface. Agent conversations own their frozen pair
 * (`conversations.provider_id/model_id`, resolved by the harness), while the
 * thinking mode always comes from the persona.
 */
export function agentSelectionForLayout(
  state: ChatState,
  layout: LayoutMode,
): ModelSelection | null {
  if (layout !== 'agent') return null;
  const activeAgentId = useUiStore.getState().activeAgentId;
  const agent = activeAgentId
    ? useAgentStore.getState().agentsById[activeAgentId]
    : undefined;
  if (!agent) return null;
  const conversation = state.activeId
    ? state.conversations.find((entry) => entry.id === state.activeId)
    : undefined;
  const linked =
    conversation?.mode === 'agent' && conversation.agentId === agent.id
      ? conversation
      : undefined;
  return {
    providerId: linked?.providerId ?? agent.providerId,
    modelId: linked?.modelId ?? agent.modelId,
    reasoning: agent.reasoning ?? null,
  };
}

/** Agent that owns the active agent surface (the open thread wins over the sidebar). */
function activeAgentForState(state: ChatState): Agent | undefined {
  const conversation = state.activeId
    ? state.conversations.find((entry) => entry.id === state.activeId)
    : undefined;
  const agentId =
    conversation?.mode === 'agent' ? conversation.agentId : undefined;
  const resolvedId = agentId ?? useUiStore.getState().activeAgentId;
  return resolvedId ? useAgentStore.getState().agentsById[resolvedId] : undefined;
}

/**
 * Serializes route edits on personas: picking a model moves the pill straight
 * to the thinking step, so the reasoning choice must not clobber the model
 * update (or vice versa) through a stale `AgentInput` snapshot.
 */
let agentRouteQueue: Promise<unknown> = Promise.resolve();

function patchAgentRoute(
  agentId: string,
  patch: Partial<Pick<AgentInput, 'providerId' | 'modelId' | 'reasoning'>>,
): Promise<Agent> {
  const next = agentRouteQueue.then(() => {
    const agent = useAgentStore.getState().agentsById[agentId];
    if (!agent) throw new Error('o agente não existe mais');
    return useAgentStore.getState().update(agentId, {
      ...inputFromAgent(agent),
      ...patch,
    });
  });
  // A failed edit must not poison the next queued edit.
  agentRouteQueue = next.catch(() => undefined);
  return next;
}

/** Copy shared by every surface that blocks model switching. */
export const MODEL_LOCKED_TITLE = 'Modelo bloqueado nesta conversa';
export const MODEL_LOCKED_DESCRIPTION =
  'O modelo não pode ser alterado depois de iniciar a conversa. Ajuste o modo de pensamento pelo botão ✦.';
export const MODEL_STREAMING_LOCKED_TITLE = 'Aguarde a resposta atual terminar';
export const MODEL_STREAMING_LOCKED_DESCRIPTION =
  'A troca de modelo fica disponível quando a resposta atual terminar.';

/** Title/description for a lock reason, shared by the pill, dialog and palette. */
export function modelLockCopy(reason: ModelLockReason): { title: string; description: string } {
  return reason === 'streaming'
    ? { title: MODEL_STREAMING_LOCKED_TITLE, description: MODEL_STREAMING_LOCKED_DESCRIPTION }
    : { title: MODEL_LOCKED_TITLE, description: MODEL_LOCKED_DESCRIPTION };
}

/**
 * Resolves a model in the **merged** view the composer uses: the bundled
 * catalog plus the account-only list of each provider (`useAppStore.providers`).
 * An account-only model chosen in a Code session must resolve here too — the
 * static catalog alone would silently keep a stale selection when the session is
 * reopened, and the next send would overwrite the persisted pair.
 */
function modelForRoute(providerId: string, modelId: string) {
  const merged = useAppStore.getState().providers;
  return findModelIn(merged, providerId, modelId) ?? getModel(providerId, modelId);
}

/** Aligns the active selection with the model a conversation was started with. */
function syncSelectionToConversation(conversation: Conversation, messageCount: number): void {
  if (messageCount === 0) return;
  const model = modelForRoute(conversation.providerId, conversation.modelId);
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
 * Hard guarantee for started Chat conversations: the model used by a turn
 * always comes from the conversation, never from a stale/mutated global
 * selection. Returns `null` when the model is not locked (new/custom turns and
 * Code sessions, whose model is persisted per session by `chooseModel`).
 */
function lockedSelectionFor(state: ChatState): ModelSelection | null {
  if (modelLockReason(state, useUiStore.getState().layoutMode) !== 'started') return null;
  const conversationId = state.activeId;
  if (!conversationId) return null;
  const conversation = state.conversations.find((entry) => entry.id === conversationId);
  if (!conversation) return null;
  const model = modelForRoute(conversation.providerId, conversation.modelId);
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

  /**
   * Writes the stream of one conversation. Only the visible conversation
   * updates `streaming`; a background agent keeps its state in the map and
   * never steals the composer/stop button from the thread on screen.
   */
  const setStream = (conversationId: string, stream: StreamingState | null) => {
    set((state) => {
      const streamsByConversation = { ...state.streamsByConversation };
      if (stream) streamsByConversation[conversationId] = stream;
      else delete streamsByConversation[conversationId];
      return {
        streamsByConversation,
        ...(state.activeId === conversationId ? { streaming: stream } : {}),
      };
    });
  };

  const patchStream = (
    conversationId: string,
    update: (stream: StreamingState) => StreamingState,
  ) => {
    const current = get().streamsByConversation[conversationId];
    if (!current) return;
    setStream(conversationId, update(current));
  };

  const finalizeAssistant = (conversationId: string, message: ChatMessage) => {
    set((state) => {
      const list = state.messagesByConversation[conversationId] ?? [];
      const exists = list.some((m) => m.id === message.id);
      const next = exists
        ? list.map((m) => (m.id === message.id ? message : m))
        : [...list, message];
      const streamsByConversation = { ...state.streamsByConversation };
      delete streamsByConversation[conversationId];
      return {
        messagesByConversation: { ...state.messagesByConversation, [conversationId]: next },
        streamsByConversation,
        // A finished background turn must not clear the visible stream of
        // another conversation.
        ...(state.activeId === conversationId ? { streaming: null } : {}),
      };
    });
  };

  /** Loads a conversation into the cache without changing the active thread. */
  const loadConversationIntoCache = async (conversationId: string) => {
    try {
      const detail = await api.getConversation(conversationId);
      if (!detail) return;
      set((state) => ({
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: detail.messages,
        },
        conversations: state.conversations.map((conversation) =>
          conversation.id === conversationId ? detail.conversation : conversation,
        ),
      }));
    } catch {
      /* a reattach is best-effort; the next open will retry */
    }
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
    // Agent threads own their profile: a queued background turn must keep the
    // Code profile even when the user is looking at the Chat layout.
    if (conversation.mode === 'agent') {
      return conversation.workspaceId ? 'code' : 'chat';
    }
    const layout = currentLayout();
    if (layout === 'chat') return 'chat';
    return conversation.mode === 'code' || conversation.codeLinked ? 'code' : 'chat';
  };

  /** True when the conversation owns Code-session state. */
  const isCodeProfileConversation = (conversation: Conversation | undefined): boolean =>
    Boolean(
      conversation &&
        (conversation.mode === 'code' ||
          conversation.codeLinked ||
          conversation.mode === 'agent'),
    );

  /** Carrega/atualiza o estado da sessão de código quando ela é do Code. */
  const syncCodeSession = (conversation: Conversation | undefined): void => {
    if (!conversation) return;
    if (!isCodeProfileConversation(conversation)) return;
    void useCodeStore.getState().load(conversation.id);
  };

  /**
   * Sessions visible in one layout, preserving the backend order. Agentes is
   * persona-scoped: the sidebar/home owns selection, so a layout switch never
   * opens an arbitrary agent thread.
   */
  const visibleConversations = (conversations: Conversation[], layout: LayoutMode) =>
    layout === 'agent' ? [] : filterConversationsForLayout(conversations, layout);

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

  // Prompt-cache aggregate is authoritative in the backend; when a conversation
  // is opened (even with messages cached) the chip must show the persisted
  // session numbers before the next turn produces a fresh sample.
  const syncCacheStats = async (conversationId?: string | null) => {
    const target = conversationId ?? get().activeId;
    if (!target) return;
    try {
      const view = await api.getCacheStats(target, 50);
      if (get().activeId !== target) return;
      useCacheStore.getState().seed(target, view);
    } catch (error) {
      console.error('failed to sync conversation cache stats', error);
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
      /** Rodada automática: remove os otimistas se o turno nem começou. */
      removeOnFailure?: boolean;
    },
  ) => {
    let local_turn_id: string | null = payload.turnId ?? null;
    let reasoningBuffer = '';
    let textBuffer = '';
    let flushHandle: ReturnType<typeof setTimeout> | null = null;
    let finished = false;
    let started = false;
    /** Primeiro texto depois de um novo passo ganha um parágrafo. */
    let pendingTextBreak = false;
    /** Fecho terminal: `cancelled`/`error` não têm `done.result`. */
    let terminal: 'cancelled' | 'error' | null = null;

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

    /**
     * Cancelado/erro: reconcilia o resultado autoritativo sem apagar a
     * narração já visível. O backend persiste só o texto do último passo nesse
     * caminho; se o usuário já vê os parágrafos anteriores, eles ficam.
     */
    const reconcileTerminalResult = (result: TurnResult) => {
      const final = result.assistantMessage;
      if (!final) return;
      patchMessage(context.conversationId, context.assistantId, (message) => {
        const visible = message.content ?? '';
        const hasVisibleText = visible.trim().length > 0;
        return {
          ...message,
          content: hasVisibleText ? visible : (final.content ?? ''),
          usage: final.usage ?? message.usage,
          toolCalls: final.toolCalls.length ? final.toolCalls : message.toolCalls,
          citations: final.citations.length ? final.citations : message.citations,
        };
      });
    };

    const schedule = () => {
      if (flushHandle) return;
      flushHandle = setTimeout(flush, 33);
    };

    const patchSubagent = (
      taskCallId: string,
      update: (current: SubagentLiveState) => SubagentLiveState,
    ) => {
      patchStream(context.conversationId, (stream) => {
        const current = stream.subagents?.[taskCallId];
        if (!current) return stream;
        return {
          ...stream,
          subagents: {
            ...(stream.subagents ?? {}),
            [taskCallId]: update(current),
          },
        };
      });
    };

    const handleEvent = (event: TurnEvent) => {
      // O estado de harness de código (aprovações/plano/tarefas/contexto/
      // alterações/jobs) é ortogonal ao streaming e vive no `codeStore`.
      if (isCodeEvent(event)) useCodeStore.getState().applyEvent(context.conversationId, event);
      if (
        (event.type === 'approval_requested' || event.type === 'question_requested') &&
        shouldNotify(event.type, context.conversationId)
      ) {
        const uiNow = useUiStore.getState();
        const conversation = get().conversations.find(
          (entry) => entry.id === context.conversationId,
        );
        const background =
          uiNow.layoutMode !== 'agent' ||
          get().activeId !== context.conversationId ||
          (typeof document !== 'undefined' && !document.hasFocus());
        if (background) {
          const title =
            event.type === 'approval_requested'
              ? 'Aprovação necessária'
              : 'O agente fez uma pergunta';
          const body = conversation?.title ?? 'Thread de agente';
          toast.info(title, {
            description: body,
            action: {
              label: 'Abrir',
              onClick: () => void get().openConversation(context.conversationId),
            },
          });
          void api.notifyDesktop(title, body);
        }
      }
      switch (event.type) {
        case 'turn_started': {
          started = true;
          if (context.optimisticUserId) {
            replaceMessageId(context.conversationId, context.optimisticUserId, event.userMessageId);
            context.userMessageId = event.userMessageId;
            context.optimisticUserId = null;
          }
          replaceMessageId(context.conversationId, context.assistantId, event.assistantMessageId);
          context.assistantId = event.assistantMessageId;
          patchStream(context.conversationId, (stream) => ({
            ...stream,
            assistantId: event.assistantMessageId,
            userMessageId: event.userMessageId,
          }));
          break;
        }
        case 'step_started':
          // A new agent loop step begins: the streamed reasoning that follows
          // belongs to its own timeline entry. The text of this step starts a
          // new paragraph once it arrives (not on an empty step).
          flush();
          pendingTextBreak = true;
          patchMessage(context.conversationId, context.assistantId, (message) => ({
            ...message,
            trace: [...(message.trace ?? []), { toolCalls: 0 }],
          }));
          patchStream(context.conversationId, (stream) => ({ ...stream, step: event.step }));
          break;
        case 'reasoning_delta':
          reasoningBuffer += event.delta;
          patchStream(context.conversationId, (stream) => ({ ...stream, phase: 'reasoning' }));
          schedule();
          break;
        case 'reasoning_done':
          flush();
          break;
        case 'text_delta':
          if (!event.delta) break;
          if (pendingTextBreak) {
            pendingTextBreak = false;
            const current = get().messagesByConversation[context.conversationId]?.find(
              (message) => message.id === context.assistantId,
            );
            if (current?.content && !current.content.endsWith('\n')) {
              textBuffer += '\n\n';
            }
          }
          textBuffer += event.delta;
          patchStream(context.conversationId, (stream) => ({ ...stream, phase: 'text' }));
          schedule();
          break;
        case 'tool_call_started':
          flush();
          patchStream(context.conversationId, (stream) => ({ ...stream, phase: 'tool' }));
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
        case 'tool_progress': {
          // Saída incremental de shell/job no card da tool em execução.
          patchMessage(context.conversationId, context.assistantId, (message) => {
            const target = message.toolCalls.some((tool) => tool.id === event.id)
              ? event.id
              : [...message.toolCalls].reverse().find((tool) => tool.status === 'running')?.id;
            return {
              ...message,
              toolCalls: message.toolCalls.map((tool) =>
                tool.id === target
                  ? { ...tool, result: `${tool.result ?? ''}${event.delta}` }
                  : tool,
              ),
            };
          });
          break;
        }
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
        case 'cache_stats':
          useCacheStore.getState().applySample(context.conversationId, event.sample);
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
          if (local_turn_id) terminalTurnIds.add(local_turn_id);
          applyResult(event.result);
          // In-app completion notice for agent threads the user is not looking
          // at. The `notificationsEnabled` setting already existed for this;
          // this is the renderer side (no OS-level notification yet).
          {
            const finishedConversation = get().conversations.find(
              (conversation) => conversation.id === context.conversationId,
            );
            const uiNow = useUiStore.getState();
            if (
              finishedConversation?.mode === 'agent' &&
              notificationsAllowed('turn_complete') &&
              (uiNow.layoutMode !== 'agent' || get().activeId !== finishedConversation.id)
            ) {
              const agentName = finishedConversation.agentId
                ? useAgentStore.getState().agentsById[finishedConversation.agentId]?.name
                : null;
              const title = `${agentName ?? 'Agente'} concluiu a resposta`;
              toast.success(title, {
                description: finishedConversation.title,
                action: {
                  label: 'Abrir',
                  onClick: () => void get().openConversation(finishedConversation.id),
                },
              });
              void api.notifyDesktop(title, finishedConversation.title);
            }
          }
          // Sincroniza o snapshot da sessão e só então decide a próxima rodada
          // do objetivo (o estado do goal_updated/finish_round precisa chegar).
          void (async () => {
            await useCodeStore.getState().refresh(context.conversationId);
            await get().maybeContinueGoal(context.conversationId);
            // A queued message is the next turn of the same thread. This runs
            // for background agent threads too: each thread drains its own
            // FIFO without waiting for the user to look at it.
            await get().processQueue(context.conversationId);
          })();
          // The per-request event carries only cache counters; TTL/min/savings
          // come from the authoritative snapshot, so refresh it at turn end.
          void syncCacheStats(context.conversationId);
          break;
        case 'cancelled':
          flush();
          finished = true;
          terminal = 'cancelled';
          if (local_turn_id) terminalTurnIds.add(local_turn_id);
          void syncCacheStats(context.conversationId);
          patchMessage(context.conversationId, context.assistantId, (message) => ({
            ...message,
            status: 'cancelled',
          }));
          setStream(context.conversationId, null);
          void syncArtifacts(context.conversationId);
          void useCodeStore.getState().refresh(context.conversationId);
          break;
        case 'error':
          flush();
          finished = true;
          terminal = 'error';
          if (local_turn_id) terminalTurnIds.add(local_turn_id);
          void syncCacheStats(context.conversationId);
          patchMessage(context.conversationId, context.assistantId, (message) => ({
            ...message,
            status: message.content ? 'complete' : 'error',
          }));
          setStream(context.conversationId, null);
          // A background failure must not paint the error banner over the
          // thread the user is reading; it still gets the toast below.
          if (get().activeId === context.conversationId) {
            set({
              error: event.message,
              errorCode: event.code ?? null,
              errorHint: event.hint ?? null,
            });
          }
          void syncArtifacts(context.conversationId);
          void useCodeStore.getState().refresh(context.conversationId);
          toast.error('Falha na resposta', { description: event.hint ?? event.message });
          break;
        case 'subagent_started':
          patchStream(context.conversationId, (stream) => ({
            ...stream,
            subagents: {
              ...(stream.subagents ?? {}),
              [event.taskCallId]: {
                taskCallId: event.taskCallId,
                conversationId: event.conversationId,
                subagentType: event.subagentType,
                description: event.description,
                prompt: event.prompt,
                providerId: event.providerId,
                modelId: event.modelId,
                effort: event.effort ?? null,
                status: 'running',
                startedAt: Date.now(),
                steps: 0,
                text: '',
                reasoning: '',
                trace: [],
                toolCalls: [],
              },
            },
          }));
          break;
        case 'subagent_event': {
          const nested = event.event;
          if (nested.type === 'step_started') {
            patchSubagent(event.taskCallId, (current) => ({
              ...current,
              steps: Math.max(current.steps, nested.step),
              trace:
                current.trace.length >= nested.step
                  ? current.trace
                  : [...current.trace, { toolCalls: 0 }],
            }));
          } else if (nested.type === 'reasoning_delta') {
            patchSubagent(event.taskCallId, (current) => ({
              ...current,
              reasoning: current.reasoning + nested.delta,
              trace:
                current.trace.length === 0
                  ? [{ reasoning: nested.delta, toolCalls: 0 }]
                  : current.trace.map((step, index) =>
                      index === current.trace.length - 1
                        ? {
                            ...step,
                            reasoning: `${step.reasoning ?? ''}${nested.delta}`,
                          }
                        : step,
                    ),
            }));
          } else if (nested.type === 'text_delta') {
            patchSubagent(event.taskCallId, (current) => ({
              ...current,
              text: current.text + nested.delta,
            }));
          } else if (nested.type === 'tool_call_started') {
            patchSubagent(event.taskCallId, (current) => ({
              ...current,
              trace:
                current.trace.length === 0
                  ? [{ toolCalls: 1 }]
                  : current.trace.map((step, index) =>
                      index === current.trace.length - 1
                        ? { ...step, toolCalls: step.toolCalls + 1 }
                        : step,
                    ),
              toolCalls: [
                ...current.toolCalls.filter((tool) => tool.id !== nested.toolCall.id),
                nested.toolCall,
              ],
            }));
          } else if (nested.type === 'tool_call_args') {
            patchSubagent(event.taskCallId, (current) => ({
              ...current,
              toolCalls: current.toolCalls.map((tool) =>
                tool.id === nested.id
                  ? { ...tool, arguments: tool.arguments + nested.delta }
                  : tool,
              ),
            }));
          } else if (nested.type === 'tool_call_finished') {
            patchSubagent(event.taskCallId, (current) => ({
              ...current,
              toolCalls: current.toolCalls.map((tool) =>
                tool.id === nested.id
                  ? {
                      ...tool,
                      status: nested.status,
                      result: nested.result,
                      summary: nested.summary ?? tool.summary,
                      presentation: nested.presentation ?? tool.presentation ?? null,
                      finishedAt: Date.now(),
                    }
                  : tool,
              ),
            }));
          } else if (nested.type === 'tool_progress') {
            patchSubagent(event.taskCallId, (current) => {
              const target =
                current.toolCalls.find((tool) => tool.id === nested.id) ??
                [...current.toolCalls].reverse().find((tool) => tool.status === 'running');
              return {
                ...current,
                toolCalls: target
                  ? current.toolCalls.map((tool) =>
                      tool.id === target.id
                        ? { ...tool, result: `${tool.result ?? ''}${nested.delta}` }
                        : tool,
                    )
                  : current.toolCalls,
              };
            });
          } else if (nested.type === 'usage') {
            patchSubagent(event.taskCallId, (current) => ({
              ...current,
              usage: { ...(current.usage ?? {}), ...nested.usage },
            }));
          } else if (nested.type === 'error') {
            patchSubagent(event.taskCallId, (current) => ({
              ...current,
              status: 'error',
              error: nested.hint ?? nested.message,
            }));
          } else if (nested.type === 'cancelled') {
            patchSubagent(event.taskCallId, (current) => ({
              ...current,
              status: 'cancelled',
            }));
          }
          break;
        }
        case 'subagent_finished':
          patchSubagent(event.taskCallId, (current) => ({
            ...current,
            status: event.status,
            conversationId: event.conversationId ?? current.conversationId,
            usage: event.usage
              ? { ...(current.usage ?? {}), ...event.usage }
              : current.usage,
            durationMs: event.durationMs,
            error: event.error ?? current.error ?? null,
          }));
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
        if (get().activeId === context.conversationId) {
          set({ error: result.error });
        }
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
      } else if (terminal) {
        reconcileTerminalResult(result);
      }
    } catch (error) {
      flush();
      const message = error instanceof Error ? error.message : String(error);
      // Rodada de objetivo que nem começou (preflight/harness recusou): não
      // deixa mensagens otimistas órfãs no transcript.
      if (context.removeOnFailure && !started) {
        removeMessage(
          context.conversationId,
          context.optimisticUserId ?? context.userMessageId ?? '',
        );
        removeMessage(context.conversationId, context.assistantId);
        setStream(context.conversationId, null);
        if (get().activeId === context.conversationId) set({ error: message });
        toast.error('Não foi possível iniciar a rodada do objetivo', { description: message });
        void useCodeStore.getState().refresh(context.conversationId);
        return;
      }
      patchMessage(context.conversationId, context.assistantId, (m) =>
        m.content || m.reasoning
          ? { ...m, status: 'complete' }
          : { ...m, status: 'error', content: message },
      );
      setStream(context.conversationId, null);
      if (get().activeId === context.conversationId) set({ error: message });
      toast.error('Não foi possível concluir a mensagem', { description: message });
      void syncArtifacts(context.conversationId);
    } finally {
      if (flushHandle) clearTimeout(flushHandle);
      if (local_turn_id) {
        localTurnIds.delete(local_turn_id);
        local_turn_id = null;
      }
    }
  };

  const ensureConversation = async (title: string, selection: ModelSelection): Promise<string> => {
    const current = get().activeId;
    if (current) return current;
    const layout = currentLayout();
    const agentId = layout === 'agent' ? useUiStore.getState().activeAgentId : null;
    if (layout === 'agent' && !agentId) {
      throw new Error('Selecione um agente antes de enviar a mensagem.');
    }
    const conversation = agentId
      ? await api.createConversation(
          title,
          selection.providerId,
          selection.modelId,
          layout,
          agentId,
        )
      : await api.createConversation(title, selection.providerId, selection.modelId, layout);
    set((state) => ({
      conversations: [conversation, ...state.conversations],
      activeId: conversation.id,
      messagesByConversation: { ...state.messagesByConversation, [conversation.id]: [] },
      activeIdByLayout: { ...state.activeIdByLayout, [layout]: conversation.id },
    }));
    return conversation.id;
  };

  /**
   * Appends the optimistic user/assistant pair and starts one turn in an
   * existing conversation. Shared by `send` and the agent queue drain.
   */
  const startTurn = (
    input: {
      conversationId: string;
      content: string;
      attachments: AttachmentInfo[];
      selection: ModelSelection;
      reasoning: ReasoningSelection | null;
      options?: SendOptions;
    },
    clearPendingAttachments = true,
  ) => {
    const { conversationId, content, attachments, selection, reasoning, options } = input;
    const turnId = newId();
    localTurnIds.add(turnId);
    const now = Date.now();
    const optimisticUserId = `optimistic-user-${turnId}`;
    const optimisticAssistantId = `optimistic-assistant-${turnId}`;
    const userMessage: ChatMessage = {
      id: optimisticUserId,
      conversationId,
      role: 'user',
      content,
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
    const stream: StreamingState = {
      turnId,
      conversationId,
      assistantId: optimisticAssistantId,
      userMessageId: optimisticUserId,
      phase: 'starting',
      step: 1,
      startedAt: now,
      turnKind: 'user',
      subagents: {},
    };
    set((s) => ({
      messagesByConversation: {
        ...s.messagesByConversation,
        [conversationId]: [...previous, userMessage, assistantMessage],
      },
      ...(clearPendingAttachments ? { pendingAttachments: [] } : {}),
      // Errors are per visible thread: a background turn must not clear the
      // banner of the conversation on screen.
      ...(s.activeId === conversationId
        ? { error: null, errorCode: null, errorHint: null }
        : {}),
      streamsByConversation: { ...s.streamsByConversation, [conversationId]: stream },
      ...(s.activeId === conversationId ? { streaming: stream } : {}),
    }));

    const payload: TurnPayload = {
      conversationId,
      content,
      attachmentIds: attachments.map((a) => a.id),
      providerId: selection.providerId,
      modelId: selection.modelId,
      reasoning: reasoning ?? null,
      options: turnOptionsFromSettings(options?.turnOptions),
      profile: turnProfileFor(get().conversations.find((c) => c.id === conversationId)),
      turnKind: 'user',
      goalRequest: options?.goalRequest ?? false,
      turnId,
    };

    void runTurn(payload, {
      conversationId,
      assistantId: optimisticAssistantId,
      userMessageId: null,
      optimisticUserId,
      mode: 'new',
    });
  };

  /**
   * Starts the next queued message of one conversation, if any. Each agent
   * thread drains its own FIFO, including while it is in the background.
   */
  const processQueue = async (conversationId?: string | null) => {
    const target = conversationId ?? get().activeId;
    if (!target) return;
    if (selectConversationStream(get(), target)) return;
    const queue = useAgentQueueStore.getState();
    if (queue.isPaused(target)) return;
    const item = queue.peek(target);
    if (!item) {
      compactAgentQueue();
      return;
    }
    const agent = useAgentStore.getState().agentsById[item.agentId];
    if (!agent || agent.archivedAt !== null) {
      queue.pause(target, true);
      toast.error('A fila está pausada: restaure o agente para continuar');
      return;
    }
    queue.dequeue(target);
    const selection: ModelSelection = {
      providerId: item.providerId || agent?.providerId || useAppStore.getState().selection.providerId,
      modelId: item.modelId || agent?.modelId || useAppStore.getState().selection.modelId,
      reasoning: item.reasoning ?? agent?.reasoning ?? null,
    };
    startTurn({
      conversationId: target,
      content: item.content,
      attachments: item.attachments,
      selection,
      reasoning: item.reasoning ?? agent?.reasoning ?? null,
      options: {
        selection,
        reasoning: item.reasoning ?? agent?.reasoning ?? null,
        turnOptions: item.turnOptions,
        goalRequest: item.goalRequest,
      },
    }, false);
  };

  /**
   * Resumes persisted FIFOs. Each thread starts independently, so a reload can
   * pick up several queued agent tasks without waiting for the user to visit
   * them one by one.
   */
  const drainAgentQueues = async () => {
    const ids = Object.keys(useAgentQueueStore.getState().byConversation);
    for (const id of ids) {
      await processQueue(id);
    }
  };

  return {
    conversations: [],
    conversationsLoading: false,
    activeId: null,
    activeIdByLayout: { chat: null, code: null, agent: null },
    messagesByConversation: {},
    loadingConversationId: null,
    streamsByConversation: {},
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
      const rememberedAgent =
        mode === 'agent' && remembered
          ? state.conversations.find(
              (conversation) =>
                conversation.id === remembered && conversation.mode === 'agent',
            )
          : undefined;
      const target =
        mode === 'agent'
          ? (rememberedAgent?.id ?? null)
          : visible.some((conversation) => conversation.id === remembered)
            ? remembered
            : (visible[0]?.id ?? null);
      if (target === state.activeId && (target === null || state.messagesByConversation[target])) {
        rememberActive(target, mode);
        return;
      }
      if (target) {
        if (mode === 'agent') {
          const conversation = state.conversations.find((entry) => entry.id === target);
          if (conversation?.agentId) {
            useUiStore.getState().setActiveAgentId(conversation.agentId);
          }
        }
        // Restore the session in the background: the layout keeps whichever page
        // it was showing (Biblioteca/Skills) instead of being forced back to the
        // conversation, matching WorkspaceCenter's per-layout view state.
        await get().openConversation(target, { preserveView: true });
        if (mode === 'agent') void get().drainAgentQueues();
        return;
      }
      // No session for this layout: show its welcome state without touching the
      // other layout's cached conversation.
      if (mode === 'agent') void get().drainAgentQueues();
      set({ activeId: null, loadingConversationId: null, streaming: null });
      rememberActive(null, mode);
      useUiStore.getState().setArtifacts([]);
      useUiStore.getState().closeArtifactPanel();
    },

    clearActiveConversation: () => {
      set({ activeId: null, loadingConversationId: null, streaming: null });
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
      // the session surface in the current layout. A page open in another layout
      // must survive: Agent navigation never closes the Chat Library or the Code
      // Skills page.
      const layout = currentLayout();
      if (!options?.preserveView) {
        if (layout === 'chat') useUiStore.getState().setActiveView('chat');
        if (layout === 'code' || layout === 'agent') {
          useUiStore.getState().setCodeView('session');
        }
      }
      // The agent thread is the authority for the selected persona: opening it
      // from the palette/sidebar must switch the sidebar selection too.
      const targetConversation = get().conversations.find((conversation) => conversation.id === id);
      if (targetConversation?.mode === 'agent' && targetConversation.agentId) {
        useUiStore.getState().setActiveAgentId(targetConversation.agentId);
      }
      if (get().activeId === id && get().messagesByConversation[id]) {
        // Messages are cached, but the artifacts may have changed (turn ended
        // in the background, deletion, app reload): always reconcile them.
        rememberActive(id);
        // Re-attach the visible stream of this thread (it may have been
        // running in the background while another conversation was open).
        set({ streaming: get().streamsByConversation[id] ?? null });
        await syncArtifacts(id);
        void syncCacheStats(id);
        syncCodeSession(get().conversations.find((conversation) => conversation.id === id));
        return;
      }
      set({
        activeId: id,
        loadingConversationId: id,
        streaming: get().streamsByConversation[id] ?? null,
      });
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
        void syncCacheStats(id);
      } catch (error) {
        set({ loadingConversationId: null, error: String(error) });
      }
    },

    startNewConversation: async (mode, options) => {
      // "Novo chat"/"Novo agente" creates the session in that layout's own
      // namespace and returns to the conversation surface.
      const layout = mode ?? currentLayout();
      const agentId = layout === 'agent' ? options?.agentId : undefined;
      if (layout === 'agent' && !agentId) {
        toast.info('Selecione um agente para iniciar a conversa');
        return null;
      }
      // Only the page state of the layout that started the conversation is
      // reset; the other layouts keep their own surface.
      if (layout === 'chat') useUiStore.getState().setActiveView('chat');
      if (layout === 'code' || layout === 'agent') {
        useUiStore.getState().setCodeView('session');
      }
      // Leaving a started conversation resets the composer to the configured
      // default model (the previous conversation keeps its own model, which may
      // have been changed during the session in the Code layout).
      if (selectActiveConversationStarted(get())) {
        useAppStore
          .getState()
          .setActiveSelection(defaultSelection(useAppStore.getState().settings));
      }
      const selection = useAppStore.getState().selection;
      try {
        const conversation = agentId
          ? await api.createConversation(
              'Nova conversa',
              selection.providerId,
              selection.modelId,
              layout,
              agentId,
            )
          : await api.createConversation(
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
          streaming: state.streamsByConversation[conversation.id] ?? null,
          activeIdByLayout: { ...state.activeIdByLayout, [layout]: conversation.id },
        }));
        if (layout === 'agent') void useAgentStore.getState().refresh();
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
        useAgentQueueStore.getState().clear(id);
        const layout = currentLayout();
        set((state) => {
          const rest = state.conversations.filter((c) => c.id !== id);
          const messagesByConversation = { ...state.messagesByConversation };
          delete messagesByConversation[id];
          const streamsByConversation = { ...state.streamsByConversation };
          delete streamsByConversation[id];
          const stillActive = state.activeId !== id;
          const fallback = stillActive
            ? state.activeId
            : layout === 'agent'
              ? null
              : (filterConversationsForLayout(rest, layout)[0]?.id ?? null);
          const activeIdByLayout = { ...state.activeIdByLayout };
          if (!stillActive) activeIdByLayout[layout] = fallback;
          for (const key of Object.keys(activeIdByLayout) as LayoutMode[]) {
            if (activeIdByLayout[key] === id) activeIdByLayout[key] = null;
          }
          return {
            conversations: rest,
            messagesByConversation,
            streamsByConversation,
            activeId: fallback,
            streaming: stillActive
              ? state.streaming
              : fallback
                ? (streamsByConversation[fallback] ?? null)
                : null,
            activeIdByLayout,
          };
        });
        if (layout === 'agent') void useAgentStore.getState().refresh();
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

    chooseModel: async (selection) => {
      const state = get();
      const layout = currentLayout();
      const lock = modelLockReason(state, layout);
      if (lock) {
        const copy = modelLockCopy(lock);
        toast.info(copy.title, { description: copy.description });
        return false;
      }
      const conversationId = state.activeId;
      const conversation = conversationId
        ? state.conversations.find((entry) => entry.id === conversationId)
        : undefined;
      if (layout === 'agent') {
        const agent = activeAgentForState(state);
        if (!agent) {
          toast.info('Selecione um agente para trocar o modelo');
          return false;
        }
        try {
          await patchAgentRoute(agent.id, {
            providerId: selection.providerId,
            modelId: selection.modelId,
            reasoning: selection.reasoning ?? null,
          });
          // Agent turns resolve the pair from the conversation (frozen at
          // creation). An empty thread must follow the persona edit so its
          // first message uses the model the user just picked.
          const current = get();
          const liveConversation = conversationId
            ? current.conversations.find((entry) => entry.id === conversationId)
            : undefined;
          if (
            liveConversation &&
            liveConversation.mode === 'agent' &&
            liveConversation.agentId === agent.id &&
            !selectActiveConversationStarted(current) &&
            (liveConversation.providerId !== selection.providerId ||
              liveConversation.modelId !== selection.modelId)
          ) {
            const updated = await api.setConversationModel(
              liveConversation.id,
              selection.providerId,
              selection.modelId,
            );
            set((state) => ({
              conversations: state.conversations.map((entry) =>
                entry.id === updated.id ? updated : entry,
              ),
            }));
          }
          const name =
            modelForRoute(selection.providerId, selection.modelId)?.name ?? selection.modelId;
          toast.success('Modelo do agente atualizado', {
            description: `As próximas respostas usarão ${name}.`,
          });
          return true;
        } catch (error) {
          toast.error('Não foi possível alterar o modelo', {
            description: String(error instanceof Error ? error.message : error).replace(
              /^MODEL_LOCKED:\s*/,
              '',
            ),
          });
          return false;
        }
      }
      const app = useAppStore.getState();
      const previous = app.selection;
      // A **started Code session** owns its model: persist the pair immediately
      // so the next turn, goal rounds and reopening the session use the same
      // route, while the configured defaults stay untouched. Older replies keep
      // their own model (the harness replays them through the neutral history).
      const startedCodeSession =
        layout === 'code' &&
        isCodeSessionConversation(conversation) &&
        selectActiveConversationStarted(state);
      if (!startedCodeSession || !conversationId) {
        // New/empty conversation: same behavior as before — apply the selection
        // and remember it as the default for new conversations.
        app.setSelection(selection);
        return true;
      }
      const samePair =
        conversation?.providerId === selection.providerId &&
        conversation?.modelId === selection.modelId;
      if (samePair) {
        // Only the thinking mode changed: keep the session route as-is.
        app.setActiveSelection(selection);
        return true;
      }

      app.setActiveSelection(selection);
      try {
        const updated = await api.setConversationModel(
          conversationId,
          selection.providerId,
          selection.modelId,
        );
        set((current) => ({
          conversations: current.conversations.map((entry) =>
            entry.id === updated.id ? updated : entry,
          ),
        }));
        const name = modelForRoute(updated.providerId, updated.modelId)?.name ?? updated.modelId;
        toast.success('Modelo da sessão alterado', {
          description: `As próximas respostas usarão ${name}.`,
        });
        return true;
      } catch (error) {
        // Reverting only while the user is still on this session: a stale
        // failure must not clobber the selection of another conversation.
        if (get().activeId === conversationId) app.setActiveSelection(previous);
        const description = String(error instanceof Error ? error.message : error).replace(
          /^MODEL_LOCKED:\s*/,
          '',
        );
        toast.error('Não foi possível alterar o modelo', { description });
        return false;
      }
    },

    setReasoning: (reasoning) => {
      if (currentLayout() !== 'agent') {
        useAppStore.getState().setReasoning(reasoning);
        return;
      }
      const agent = activeAgentForState(get());
      if (!agent) {
        useAppStore.getState().setReasoning(reasoning);
        return;
      }
      void patchAgentRoute(agent.id, { reasoning }).catch((error) => {
        toast.error('Não foi possível alterar o modo de pensamento', {
          description: String(error instanceof Error ? error.message : error),
        });
      });
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

    processQueue: async (conversationId) => {
      await processQueue(conversationId);
    },

    drainAgentQueues,

    send: async (content, options) => {
      const state = get();
      const trimmed = content.trim();
      const attachments = state.pendingAttachments;
      if (!trimmed && !attachments.length) return;
      // Only the conversation being sent to is busy. A background agent turn
      // never blocks another thread.
      const activeStream = selectActiveStream(state);
      if (activeStream) {
        const ui = useUiStore.getState();
        const conversation = state.activeId
          ? state.conversations.find((entry) => entry.id === state.activeId)
          : undefined;
        const agentId =
          ui.layoutMode === 'agent'
            ? (conversation?.agentId ?? ui.activeAgentId ?? null)
            : null;
        if (ui.layoutMode === 'agent' && state.activeId && agentId) {
          const queueLimit =
            useAppStore.getState().settings.maxQueueLengthPerThread ?? 20;
          if (useAgentQueueStore.getState().count(state.activeId) >= queueLimit) {
            toast.error('Fila cheia', {
              description: `Esta thread já tem ${queueLimit} mensagens na fila. Aguarde ou limpe a fila.`,
            });
            return;
          }
          const agent = useAgentStore.getState().agentsById[agentId];
          useAgentQueueStore.getState().enqueue({
            id: newId(),
            conversationId: state.activeId,
            agentId,
            content: trimmed,
            attachments,
            providerId: agent?.providerId ?? useAppStore.getState().selection.providerId,
            modelId: agent?.modelId ?? useAppStore.getState().selection.modelId,
            reasoning: agent?.reasoning ?? null,
            turnOptions: options?.turnOptions,
            goalRequest: options?.goalRequest,
            createdAt: Date.now(),
          });
          set({ pendingAttachments: [] });
          toast.info('Mensagem na fila', {
            description: 'Ela será enviada quando a resposta atual terminar.',
          });
          return;
        }
        toast.info('Aguarde a resposta atual terminar');
        return;
      }

      const app = useAppStore.getState();
      const ui = useUiStore.getState();
      const activeAgent =
        ui.layoutMode === 'agent' && ui.activeAgentId
          ? useAgentStore.getState().agentsById[ui.activeAgentId]
          : undefined;
      const agentSelection: ModelSelection | null = activeAgent
        ? {
            providerId: activeAgent.providerId,
            modelId: activeAgent.modelId,
            reasoning: activeAgent.reasoning,
          }
        : null;
      // A started conversation keeps its model even if some other surface
      // changed the global selection (defense in depth for the model lock).
      const selection =
        options?.selection ?? lockedSelectionFor(state) ?? agentSelection ?? app.selection;
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
      let conversationId: string;
      try {
        conversationId = await ensureConversation(deriveTitle(trimmed || attachments[0]?.name || 'Nova conversa'), selection);
      } catch (error) {
        toast.error('Não foi possível criar a conversa', { description: String(error) });
        return;
      }

      startTurn({
        conversationId,
        content: trimmed,
        attachments,
        selection,
        reasoning,
        options,
      });
    },

    regenerate: async () => {
      const state = get();
      if (!state.activeId || selectActiveStream(state)) return;
      const conversationId = state.activeId;
      const messages = state.messagesByConversation[conversationId] ?? [];
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      if (!lastAssistant || !lastUser) return;
      if (lastUser.origin === 'goal_round') {
        toast.info('Rodada do objetivo não pode ser regenerada', {
          description: 'Use "Nova rodada" no objetivo para continuar o trabalho.',
        });
        return;
      }

      const app = useAppStore.getState();
      // Regenerating keeps the model the conversation was started with.
      const selection = lockedSelectionFor(state) ?? app.selection;
      const turnId = newId();
      localTurnIds.add(turnId);
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
      const stream: StreamingState = {
        turnId,
        conversationId,
        assistantId: assistantMessage.id,
        userMessageId: lastUser.id,
        phase: 'starting',
        step: 1,
        startedAt: Date.now(),
        turnKind: 'user',
        subagents: {},
      };
      set((s) => ({
        streamsByConversation: { ...s.streamsByConversation, [conversationId]: stream },
        streaming: s.activeId === conversationId ? stream : s.streaming,
        error: null,
        errorCode: null,
        errorHint: null,
      }));

      const payload: TurnPayload = {
        conversationId,
        content: lastUser.content,
        attachmentIds: lastUser.attachments.map((a) => a.id),
        providerId: selection.providerId,
        modelId: selection.modelId,
        reasoning: selection.reasoning ?? null,
        options: turnOptionsFromSettings({ regenerate: true }),
        profile: turnProfileFor(get().conversations.find((c) => c.id === conversationId)),
        turnKind: 'user',
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
      if (!state.activeId || selectActiveStream(state)) return;
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
      const state = get();
      const conversationId = state.activeId;
      const streaming = selectConversationStream(state, conversationId) ?? state.streaming;
      if (!streaming) return;
      if (conversationId) {
        setStream(conversationId, { ...streaming, phase: 'starting' });
      }
      // Parar uma rodada do objetivo também pausa a continuidade automática:
      // sem isso o próximo `done` retomaria sozinho o que o usuário parou.
      if (streaming.turnKind === 'goal_round') {
        void useCodeStore.getState().updateGoal(streaming.conversationId, 'pause');
      }
      try {
        await api.cancelTurn(streaming.turnId);
      } catch (error) {
        console.error('cancel failed', error);
      }
    },

    stopConversation: async (conversationId) => {
      const state = get();
      const streaming = selectConversationStream(state, conversationId);
      if (!streaming) {
        // The renderer may have reloaded and lost the stream object while the
        // Rust side still owns the turn; the conversation-level cancel covers it.
        try {
          await api.cancelConversation(conversationId);
        } catch (error) {
          console.error('cancel conversation failed', error);
        }
        return;
      }
      setStream(conversationId, { ...streaming, phase: 'starting' });
      if (streaming.turnKind === 'goal_round') {
        void useCodeStore.getState().updateGoal(streaming.conversationId, 'pause');
      }
      try {
        await api.cancelTurn(streaming.turnId);
      } catch (error) {
        console.error('cancel failed', error);
      }
    },

    stopAllTurns: async () => {
      const ids = Object.keys(get().streamsByConversation);
      await Promise.all(ids.map((id) => get().stopConversation(id)));
    },

    runGoalRound: async (conversationId) => {
      const state = get();
      if (selectConversationStream(state, conversationId)) return false;
      const conversation = state.conversations.find((entry) => entry.id === conversationId);
      if (!conversation) return false;
      const session = useCodeStore.getState().byConversation[conversationId];
      if (!session?.goal || session.goalStarting) return false;

      const app = useAppStore.getState();
      const selection: ModelSelection = {
        providerId: conversation.providerId,
        modelId: conversation.modelId,
        reasoning: null,
      };
      // Mesma checagem de credencial do `send`: um turno sem credencial não
      // deve criar mensagens quebradas.
      const activeProvider = app.providers?.find(
        (provider) => provider.id === selection.providerId,
      );
      if (activeProvider) {
        const key = app.keys?.find((entry) => entry.providerId === selection.providerId);
        const auth = app.auth?.find((entry) => entry.providerId === selection.providerId);
        const ready = Boolean(key?.hasKey) || auth?.state === 'signed-in';
        if (!ready) {
          toast.error('Conecte uma credencial para continuar o objetivo', {
            description:
              activeProvider.auth === 'oauth'
                ? 'Entre com o ChatGPT (Configurações → Provedores) ou adicione uma API key.'
                : 'Adicione a API key deste provedor em Configurações → Provedores.',
          });
          return false;
        }
      }
      const model = modelForRoute(conversation.providerId, conversation.modelId);
      const current = app.selection;
      const reasoning =
        current.providerId === conversation.providerId &&
        current.modelId === conversation.modelId
          ? current.reasoning
          : model
            ? reasoningForModel(model, current.reasoning)
            : current.reasoning;

      const turnId = newId();
      localTurnIds.add(turnId);
      const now = Date.now();
      const optimisticUserId = `optimistic-user-${turnId}`;
      const optimisticAssistantId = `optimistic-assistant-${turnId}`;
      const userMessage: ChatMessage = {
        id: optimisticUserId,
        conversationId,
        role: 'user',
        content: '',
        status: 'complete',
        toolCalls: [],
        citations: [],
        attachments: [],
        modelId: selection.modelId,
        providerId: selection.providerId,
        createdAt: now,
        origin: 'goal_round',
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

      useCodeStore.getState().setGoalStarting(conversationId, true);
      try {
        const previous = get().messagesByConversation[conversationId] ?? [];
        const stream: StreamingState = {
          turnId,
          conversationId,
          assistantId: optimisticAssistantId,
          userMessageId: optimisticUserId,
          phase: 'starting',
          step: 1,
          startedAt: now,
          turnKind: 'goal_round',
          subagents: {},
        };
        set((s) => ({
          messagesByConversation: {
            ...s.messagesByConversation,
            [conversationId]: [...previous, userMessage, assistantMessage],
          },
          ...(s.activeId === conversationId
            ? { error: null, errorCode: null, errorHint: null }
            : {}),
          streamsByConversation: { ...s.streamsByConversation, [conversationId]: stream },
          ...(s.activeId === conversationId ? { streaming: stream } : {}),
        }));

        const payload: TurnPayload = {
          conversationId,
          content: '',
          attachmentIds: [],
          providerId: conversation.providerId,
          modelId: conversation.modelId,
          reasoning: reasoning ?? null,
          options: turnOptionsFromSettings(),
          profile: 'code',
          turnKind: 'goal_round',
          turnId,
        };

        void runTurn(payload, {
          conversationId,
          assistantId: optimisticAssistantId,
          userMessageId: null,
          optimisticUserId,
          mode: 'new',
          removeOnFailure: true,
        });
        return true;
      } finally {
        useCodeStore.getState().setGoalStarting(conversationId, false);
      }
    },

    maybeContinueGoal: async (conversationId) => {
      if (selectConversationStream(get(), conversationId)) return;
      const ui = useUiStore.getState();
      const conversation = get().conversations.find((entry) => entry.id === conversationId);
      const codeCapable =
        ui.layoutMode === 'code' ||
        (ui.layoutMode === 'agent' && Boolean(conversation?.workspaceId));
      if (!codeCapable || get().activeId !== conversationId) return;
      const session = useCodeStore.getState().byConversation[conversationId];
      if (!session) return;
      if (
        !shouldContinueGoal({
          goal: session.goal,
          planMode: session.planMode,
          approvalCount: session.approvals.length,
          questionCount: session.questions.length,
          streaming: false,
          activeId: get().activeId,
          conversationId,
          layoutMode: ui.layoutMode,
          hasWorkspace: Boolean(conversation?.workspaceId),
        })
      ) {
        return;
      }
      let gate;
      try {
        gate = await api.goalCanContinue(conversationId, true);
      } catch {
        return;
      }
      if (!gate?.ok) return;
      // Revalida depois do await (o usuário pode ter trocado de sessão/iniciado
      // um turno enquanto o preflight respondia).
      if (selectConversationStream(get(), conversationId) || get().activeId !== conversationId) {
        return;
      }
      await get().runGoalRound(conversationId);
    },

    applyExternalTurnEvent: async (payload) => {
      if (localTurnIds.has(payload.turnId)) return;
      if (terminalTurnIds.has(payload.turnId)) return;
      const lastSeq = appliedTurnSeq.get(payload.turnId) ?? 0;
      if (payload.seq <= lastSeq) return;
      appliedTurnSeq.set(payload.turnId, payload.seq);
      const { conversationId, event, turnId } = payload;
      if (isCodeEvent(event)) {
        useCodeStore.getState().applyEvent(conversationId, event);
      }
      if (!get().messagesByConversation[conversationId]) {
        await loadConversationIntoCache(conversationId);
      }
      const conversation = get().conversations.find((entry) => entry.id === conversationId);
      let stream = selectConversationStream(get(), conversationId);
      if (event.type === 'turn_started') {
        stream = {
          turnId,
          conversationId,
          assistantId: event.assistantMessageId,
          userMessageId: event.userMessageId,
          phase: 'starting',
          step: 1,
          startedAt: Date.now(),
          turnKind: 'user',
          subagents: stream?.subagents ?? {},
        };
        setStream(conversationId, stream);
        const list = get().messagesByConversation[conversationId] ?? [];
        if (!list.some((message) => message.id === event.assistantMessageId)) {
          pushMessage(conversationId, {
            id: event.assistantMessageId,
            conversationId,
            role: 'assistant',
            content: '',
            reasoning: '',
            status: 'streaming',
            toolCalls: [],
            citations: [],
            attachments: [],
            trace: [],
            modelId: conversation?.modelId ?? '',
            providerId: conversation?.providerId ?? '',
            createdAt: Date.now(),
          });
        }
        return;
      }
      if (!stream) {
        const list = get().messagesByConversation[conversationId] ?? [];
        const assistant = [...list]
          .reverse()
          .find((message) => message.role === 'assistant' && message.status === 'streaming');
        stream = {
          turnId,
          conversationId,
          assistantId: assistant?.id ?? `external-assistant-${turnId}`,
          userMessageId: null,
          phase: 'starting',
          step: 1,
          startedAt: Date.now(),
          turnKind: 'user',
          subagents: {},
        };
        setStream(conversationId, stream);
      }
      const assistantId = stream.assistantId;
      switch (event.type) {
        case 'step_started':
          patchStream(conversationId, (current) => ({ ...current, step: event.step }));
          break;
        case 'reasoning_delta':
          patchStream(conversationId, (current) => ({ ...current, phase: 'reasoning' }));
          patchMessage(conversationId, assistantId, (message) => ({
            ...message,
            reasoning: (message.reasoning ?? '') + event.delta,
          }));
          break;
        case 'text_delta':
          patchStream(conversationId, (current) => ({ ...current, phase: 'text' }));
          patchMessage(conversationId, assistantId, (message) => ({
            ...message,
            content: message.content + event.delta,
          }));
          break;
        case 'tool_call_started':
          patchStream(conversationId, (current) => ({ ...current, phase: 'tool' }));
          patchMessage(conversationId, assistantId, (message) => ({
            ...message,
            toolCalls: [
              ...message.toolCalls.filter((tool) => tool.id !== event.toolCall.id),
              event.toolCall,
            ],
          }));
          break;
        case 'tool_call_args':
          patchMessage(conversationId, assistantId, (message) => ({
            ...message,
            toolCalls: message.toolCalls.map((tool) =>
              tool.id === event.id ? { ...tool, arguments: tool.arguments + event.delta } : tool,
            ),
          }));
          break;
        case 'tool_call_finished':
          patchMessage(conversationId, assistantId, (message) => ({
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
        case 'tool_progress':
          patchMessage(conversationId, assistantId, (message) => ({
            ...message,
            toolCalls: message.toolCalls.map((tool) =>
              tool.id === event.id
                ? { ...tool, result: `${tool.result ?? ''}${event.delta}` }
                : tool,
            ),
          }));
          break;
        case 'message_updated':
          patchMessage(conversationId, event.message.id, () => event.message);
          break;
        case 'usage':
          patchMessage(conversationId, assistantId, (message) => ({
            ...message,
            usage: { ...(message.usage ?? {}), ...event.usage },
          }));
          break;
        case 'title_updated':
          set((state) => ({
            conversations: state.conversations.map((entry) =>
              entry.id === event.conversationId ? { ...entry, title: event.title } : entry,
            ),
          }));
          break;
        case 'artifact_created':
          if (
            event.artifact.conversationId === conversationId &&
            get().activeId === conversationId
          ) {
            useUiStore.getState().addArtifact(event.artifact);
          }
          break;
        case 'done':
          terminalTurnIds.add(turnId);
          finalizeAssistant(conversationId, event.result.assistantMessage);
          if (stream.userMessageId) {
            patchMessage(conversationId, stream.userMessageId, () => event.result.userMessage);
          }
          if (event.result.conversation) {
            const updated = event.result.conversation;
            set((state) => ({
              conversations: state.conversations.map((entry) =>
                entry.id === updated.id ? updated : entry,
              ),
            }));
          }
          void refreshList();
          void syncArtifacts(conversationId);
          break;
        case 'cancelled':
          terminalTurnIds.add(turnId);
          patchMessage(conversationId, assistantId, (message) => ({
            ...message,
            status: 'cancelled',
          }));
          setStream(conversationId, null);
          break;
        case 'error':
          terminalTurnIds.add(turnId);
          patchMessage(conversationId, assistantId, (message) => ({
            ...message,
            status: message.content ? 'complete' : 'error',
          }));
          setStream(conversationId, null);
          if (get().activeId === conversationId) {
            set({
              error: event.message,
              errorCode: event.code ?? null,
              errorHint: event.hint ?? null,
            });
          }
          break;
        default:
          break;
      }
    },

    reattachTurns: async () => {
      let active: Awaited<ReturnType<typeof api.listActiveTurns>> = [];
      try {
        active = await api.listActiveTurns();
      } catch {
        return;
      }
      for (const turn of active) {
        if (localTurnIds.has(turn.turnId)) continue;
        await loadConversationIntoCache(turn.conversationId);
        let records: Awaited<ReturnType<typeof api.listTurnEvents>> = [];
        try {
          records.push(...(await api.listTurnEvents(turn.turnId)));
        } catch {
          continue;
        }
        // Turns without persisted events are internal runners (task/rotina)
        // that do not stream to the renderer; do not invent a phantom stream.
        if (records.length === 0) continue;
        for (const record of records) {
          await get().applyExternalTurnEvent({
            turnId: record.turnId,
            seq: record.seq,
            conversationId: turn.conversationId,
            event: record.event,
          });
        }
        if (
          !terminalTurnIds.has(turn.turnId) &&
          !selectConversationStream(get(), turn.conversationId)
        ) {
          const list = get().messagesByConversation[turn.conversationId] ?? [];
          const assistant = [...list]
            .reverse()
            .find(
              (message) => message.role === 'assistant' && message.status === 'streaming',
            );
          setStream(turn.conversationId, {
            turnId: turn.turnId,
            conversationId: turn.conversationId,
            assistantId: assistant?.id ?? `external-assistant-${turn.turnId}`,
            userMessageId: null,
            phase: 'starting',
            step: 1,
            startedAt: turn.startedAt,
            turnKind: 'user',
            subagents: {},
          });
        }
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
