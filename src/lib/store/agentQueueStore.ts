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
  if (Object.keys(byConversation).length !== Object.keys(state.byConversation).length) {
    useAgentQueueStore.setState({ byConversation });
  }
}
