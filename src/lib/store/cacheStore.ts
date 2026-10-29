/**
 * Per-conversation prompt-cache UI state (docs/goals/prompt-cache/PLAN.md §4.7/§7).
 *
 * The backend is the source of truth: `cache_stats` arrives once per provider
 * request (wire request) and `get_cache_stats` restores the aggregate when a
 * conversation is reopened. This store only projects those facts; it never
 * recomputes the provider-reported hit% from estimates.
 */
import { create } from 'zustand';
import type { CacheSample, CacheStats, CacheStatsView } from '../types';
import { aggregateCacheSamples, cacheBreakLabel } from '../cache';

export interface CacheConversationUi {
  current: CacheStats | null;
  session: CacheStats | null;
  epoch: number;
  samples: CacheSample[];
  lastBreak: { reason: string; detail: string | null; at: number } | null;
  restored: boolean;
}

export function emptyCacheConversation(): CacheConversationUi {
  return {
    current: null,
    session: null,
    epoch: 0,
    samples: [],
    lastBreak: null,
    restored: false,
  };
}

/** Keep only the latest N samples in memory; the backend retains the full log. */
const MAX_SAMPLES = 50;

function statsFromSample(sample: CacheSample, samples: CacheSample[]): CacheStats {
  return {
    hitPercent: sample.hitPercent ?? null,
    sessionHitPercent: null,
    steadyHitPercent: null,
    ceilingPercent: sample.ceilingPercent ?? null,
    inputTotal: sample.inputTotal,
    cacheRead: sample.cacheRead,
    cacheWrite: sample.cacheWrite,
    uncached: sample.uncached,
    eligible: sample.eligible,
    excludedReason: sample.excludedReason ?? null,
    state: sample.state,
    epoch: sample.epoch,
    samples: samples.length,
    breakReason: sample.breakReason ?? null,
    breakDetail: sample.breakDetail ?? null,
    at: sample.at,
    // Session-weighted values come from the aggregate below.
    ...(aggregateCacheSamples(samples) ?? {}),
  };
}

export interface CacheStore {
  byConversation: Record<string, CacheConversationUi>;
  /** Apply a per-request sample emitted during streaming. */
  applySample: (conversationId: string, sample: CacheSample) => void;
  /** Restore the authoritative aggregate when opening a conversation. */
  seed: (conversationId: string, view: CacheStatsView | null | undefined) => void;
  clear: (conversationId: string) => void;
  reset: () => void;
}

export const useCacheStore = create<CacheStore>((set) => ({
  byConversation: {},

  applySample: (conversationId, sample) =>
    set((state) => {
      const previous = state.byConversation[conversationId] ?? emptyCacheConversation();
      const samples = [...previous.samples, sample].slice(-MAX_SAMPLES);
      const lastBreak = sample.breakReason
        ? {
            reason: cacheBreakLabel(sample.breakReason) ?? sample.breakReason,
            detail: sample.breakDetail ?? null,
            at: sample.at,
          }
        : previous.lastBreak;
      const aggregate = aggregateCacheSamples(samples);
      // `cache_stats` carries per-request facts only; provider/session metadata
      // (TTL, min cacheable tokens, savings) comes from the restored snapshot and
      // must survive live samples until the next `get_cache_stats`.
      const ttlSeconds =
        previous.session?.ttlSeconds ?? previous.current?.ttlSeconds ?? null;
      const minCacheableTokens =
        previous.session?.minCacheableTokens ?? previous.current?.minCacheableTokens ?? null;
      const savingsUsd = previous.session?.savingsUsd ?? previous.current?.savingsUsd ?? null;
      const current = statsFromSample(sample, samples);
      return {
        byConversation: {
          ...state.byConversation,
          [conversationId]: {
            ...previous,
            current: {
              ...current,
              ttlSeconds,
              minCacheableTokens,
              savingsUsd,
            },
            session: aggregate
              ? {
                  ...aggregate,
                  ttlSeconds,
                  minCacheableTokens,
                  savingsUsd,
                }
              : previous.session,
            epoch: sample.epoch,
            samples,
            lastBreak,
          },
        },
      };
    }),

  seed: (conversationId, view) =>
    set((state) => {
      if (!view) {
        return {
          byConversation: {
            ...state.byConversation,
            [conversationId]: emptyCacheConversation(),
          },
        };
      }
      return {
        byConversation: {
          ...state.byConversation,
          [conversationId]: {
            current: view.current ?? null,
            session: view.session ?? null,
            epoch: view.epoch ?? 0,
            samples: view.recent ?? [],
            lastBreak: view.session?.breakReason
              ? {
                  reason:
                    cacheBreakLabel(view.session.breakReason) ?? view.session.breakReason,
                  detail: view.session.breakDetail ?? null,
                  at: view.session.at ?? Date.now(),
                }
              : null,
            restored: true,
          },
        },
      };
    }),

  clear: (conversationId) =>
    set((state) => {
      const next = { ...state.byConversation };
      delete next[conversationId];
      return { byConversation: next };
    }),

  reset: () => set({ byConversation: {} }),
}));

/** Convenience selector for a conversation (returns null before the first sample). */
export function selectCacheConversation(
  conversationId: string | null | undefined,
): (state: CacheStore) => CacheConversationUi | null {
  return (state) =>
    (conversationId ? state.byConversation[conversationId] : null) ?? null;
}
