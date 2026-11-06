import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { AttachmentInfo, ReasoningSelection, TurnOptions } from '@/lib/types';

/** One message waiting for the conversation's current turn to finish. */
export interface AgentQueueItem {
  id: string;
  conversationId: string;
  agentId: string;
  content: string;
  attachments: AttachmentInfo[];
  providerId: string;
  modelId: string;
  reasoning: ReasoningSelection | null;
  turnOptions?: Partial<TurnOptions>;
  goalRequest?: boolean;
  createdAt: number;
}

interface AgentQueueState {
  /** FIFO per conversation. */
  byConversation: Record<string, AgentQueueItem[]>;
  /** A paused queue is kept but never drained automatically. */
  pausedByConversation: Record<string, boolean>;

  enqueue: (item: AgentQueueItem) => void;
  /** Puts an item back at the head (used when TURN_BUSY rejects a drained item). */
  enqueueFront: (item: AgentQueueItem) => void;
  dequeue: (conversationId: string) => AgentQueueItem | null;
  peek: (conversationId: string) => AgentQueueItem | null;
  remove: (conversationId: string, itemId: string) => void;
  clear: (conversationId: string) => void;
  pause: (conversationId: string, paused: boolean) => void;
  isPaused: (conversationId: string) => boolean;
  count: (conversationId: string) => number;
}

export const useAgentQueueStore = create<AgentQueueState>()(
  persist(
    (set, get) => ({
      byConversation: {},
      pausedByConversation: {},

      enqueue: (item) =>
        set((state) => ({
          byConversation: {
            ...state.byConversation,
            [item.conversationId]: [
              ...(state.byConversation[item.conversationId] ?? []),
              item,
            ],
          },
        })),

      enqueueFront: (item) =>
        set((state) => ({
          byConversation: {
            ...state.byConversation,
            [item.conversationId]: [
              item,
              ...(state.byConversation[item.conversationId] ?? []).filter(
                (entry) => entry.id !== item.id,
              ),
            ],
          },
        })),

      dequeue: (conversationId) => {
        const items = get().byConversation[conversationId] ?? [];
        const [next, ...rest] = items;
        if (!next) return null;
        set((state) => ({
          byConversation: {
            ...state.byConversation,
            [conversationId]: rest,
          },
        }));
        return next;
      },

      peek: (conversationId) => get().byConversation[conversationId]?.[0] ?? null,

      remove: (conversationId, itemId) =>
        set((state) => ({
          byConversation: {
            ...state.byConversation,
            [conversationId]: (state.byConversation[conversationId] ?? []).filter(
              (item) => item.id !== itemId,
            ),
          },
        })),

      clear: (conversationId) =>
        set((state) => ({
          byConversation: { ...state.byConversation, [conversationId]: [] },
          pausedByConversation: {
            ...state.pausedByConversation,
            [conversationId]: false,
          },
        })),

      pause: (conversationId, paused) =>
        set((state) => ({
          pausedByConversation: {
            ...state.pausedByConversation,
            [conversationId]: paused,
          },
        })),

      isPaused: (conversationId) => get().pausedByConversation[conversationId] === true,
      count: (conversationId) => get().byConversation[conversationId]?.length ?? 0,
    }),
    {
      name: 'lumina.agent-queue.v1',
      version: 1,
      migrate: (persisted) => sanitizeAgentQueue(persisted) as AgentQueueState,
      merge: (persisted, current) => ({
        ...current,
        ...sanitizeAgentQueue(persisted),
      }),
      partialize: (state) => ({
        byConversation: state.byConversation,
        pausedByConversation: state.pausedByConversation,
      }),
    },
  ),
);

/** Removes empty buckets so the persisted state does not grow forever. */
export function compactAgentQueue(): void {
  const state = useAgentQueueStore.getState();
  const byConversation = Object.fromEntries(
    Object.entries(state.byConversation).filter(([, items]) => items.length > 0),
  );
  const pausedByConversation = Object.fromEntries(
    Object.entries(state.pausedByConversation).filter(
      ([conversationId, paused]) => paused && (byConversation[conversationId]?.length ?? 0) > 0,
    ),
  );
  if (
    Object.keys(byConversation).length !== Object.keys(state.byConversation).length ||
    Object.keys(pausedByConversation).length !==
      Object.keys(state.pausedByConversation).length
  ) {
    useAgentQueueStore.setState({ byConversation, pausedByConversation });
  }
}

function isQueueItem(value: unknown): value is AgentQueueItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<AgentQueueItem>;
  return (
    typeof item.id === 'string' &&
    typeof item.conversationId === 'string' &&
    typeof item.agentId === 'string' &&
    typeof item.content === 'string' &&
    Array.isArray(item.attachments) &&
    typeof item.providerId === 'string' &&
    typeof item.modelId === 'string'
  );
}

/** Drops malformed localStorage data instead of crashing the whole app. */
export function sanitizeAgentQueue(value: unknown): {
  byConversation: Record<string, AgentQueueItem[]>;
  pausedByConversation: Record<string, boolean>;
} {
  if (!value || typeof value !== 'object') {
    return { byConversation: {}, pausedByConversation: {} };
  }
  const raw = value as {
    byConversation?: unknown;
    pausedByConversation?: unknown;
  };
  const byConversation: Record<string, AgentQueueItem[]> = {};
  if (raw.byConversation && typeof raw.byConversation === 'object') {
    for (const [conversationId, items] of Object.entries(
      raw.byConversation as Record<string, unknown>,
    )) {
      if (!Array.isArray(items)) continue;
      const clean = items.filter(isQueueItem);
      if (clean.length > 0) byConversation[conversationId] = clean;
    }
  }
  const pausedByConversation: Record<string, boolean> = {};
  if (raw.pausedByConversation && typeof raw.pausedByConversation === 'object') {
    for (const [conversationId, paused] of Object.entries(
      raw.pausedByConversation as Record<string, unknown>,
    )) {
      if (paused === true && byConversation[conversationId]) {
        pausedByConversation[conversationId] = true;
      }
    }
  }
  return { byConversation, pausedByConversation };
}
