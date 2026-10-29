/**
 * Pure helpers for prompt-cache telemetry and the context-meter cache indicator
 * (docs/goals/prompt-cache/PLAN.md §4.7/§7). No React and no I/O: everything here
 * is unit-testable and must never invent a number the provider did not report.
 */
import type {
  CacheBreakReason,
  CacheSample,
  CacheState,
  CacheStats,
  UsageInfo,
} from './types';

export interface CacheTone {
  label: string;
  /** Token classes are applied by the component; keep the helper UI-agnostic. */
  tone: 'success' | 'warning' | 'danger' | 'muted' | 'accent';
  description: string;
}

const CACHE_STATE_META: Record<CacheState, CacheTone> = {
  cold: {
    label: 'Frio',
    tone: 'muted',
    description: 'Primeiro request do epoch: ainda não há prefixo para reutilizar.',
  },
  warming: {
    label: 'Aquecendo',
    tone: 'accent',
    description: 'O provedor ainda está gravando o prefixo no cache.',
  },
  stable: {
    label: 'Estável',
    tone: 'success',
    description: 'Requests em regime estão lendo o prefixo do cache.',
  },
  degraded: {
    label: 'Cache caiu',
    tone: 'warning',
    description: 'O prefixo persistente mudou e o cache foi invalidado.',
  },
  unsupported: {
    label: 'Não reportado',
    tone: 'muted',
    description: 'O provedor/gateway não reporta cache para este modelo.',
  },
  provider_policy: {
    label: 'Política do provedor',
    tone: 'muted',
    description: 'O provedor não reutiliza este request por regra própria de cache.',
  },
};

export function cacheStateMeta(state: CacheState | null | undefined): CacheTone {
  return CACHE_STATE_META[state ?? 'cold'] ?? CACHE_STATE_META.cold;
}

const BREAK_LABELS: Record<CacheBreakReason, string> = {
  first_request: 'Primeiro request do epoch',
  system_prompt: 'Prompt de sistema mudou',
  tool_definitions: 'Definições de ferramentas mudaram',
  history_rewrite: 'Histórico foi reescrito',
  head_trim: 'Histórico antigo foi cortado',
  compaction: 'Contexto compactado',
  model_switch: 'Modelo ou provedor mudou',
  protocol_fallback: 'Protocolo de wire mudou',
  attachments: 'Anexos mudaram',
  config_change: 'Configuração mudou',
  ttl_expired: 'Cache expirou (TTL)',
  provider_policy: 'Regra do provedor',
};

export function cacheBreakLabel(reason: CacheBreakReason | null | undefined): string | null {
  if (!reason) return null;
  return BREAK_LABELS[reason] ?? String(reason);
}

export function clampPercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

/**
 * Provider-billed hit percent: `read / (read + write + uncached)`.
 * Returns null when the provider did not report cache counters.
 */
export function cacheHitPercent(
  usage: Pick<
    UsageInfo,
    'cacheReadTokens' | 'cacheWriteTokens' | 'uncachedInputTokens' | 'cacheReported'
  > | null
  | undefined,
): number | null {
  if (!usage?.cacheReported) return null;
  const read = usage.cacheReadTokens ?? 0;
  const write = usage.cacheWriteTokens ?? 0;
  const uncached = usage.uncachedInputTokens ?? 0;
  const total = read + write + uncached;
  if (total <= 0) return null;
  return clampPercent((read / total) * 100);
}

/** Theoretical ceiling `P/(P+Δ)` for one request. */
export function ceilingPercent(
  prefixTokens: number | null | undefined,
  deltaTokens: number | null | undefined,
): number | null {
  const prefix = prefixTokens ?? 0;
  const delta = deltaTokens ?? 0;
  if (prefix <= 0 && delta <= 0) return null;
  return clampPercent((prefix / (prefix + delta)) * 100);
}

export function formatCacheHit(percent: number | null | undefined): string {
  const clamped = clampPercent(percent ?? null);
  if (clamped == null) return '—';
  return `${Math.round(clamped)}%`;
}

/** Merge usage patches without losing cache counters (chatStore merge is shallow). */
export function mergeCacheUsage(
  previous: UsageInfo | null | undefined,
  next: UsageInfo,
): UsageInfo {
  return {
    ...(previous ?? {}),
    ...next,
    cacheReadTokens: next.cacheReadTokens ?? previous?.cacheReadTokens ?? null,
    cacheWriteTokens: next.cacheWriteTokens ?? previous?.cacheWriteTokens ?? null,
    uncachedInputTokens: next.uncachedInputTokens ?? previous?.uncachedInputTokens ?? null,
    cacheReported: next.cacheReported ?? previous?.cacheReported,
  };
}

/** Old payloads (before the cache contract) degrade to "not reported". */
export function normalizeLegacyUsage(usage: UsageInfo | null | undefined): UsageInfo {
  if (!usage) return { cacheReported: false };
  if (usage.cacheReported) return usage;
  const read = usage.cacheReadTokens ?? usage.cachedTokens ?? null;
  if (read == null) return { ...usage, cacheReported: false };
  return {
    ...usage,
    cacheReadTokens: read,
    cacheReported: true,
    uncachedInputTokens:
      usage.uncachedInputTokens ??
      (usage.inputTokens != null ? Math.max(0, usage.inputTokens - read) : null),
  };
}

/** Aggregate a list of samples (token-weighted), including cold/write requests. */
export function aggregateCacheSamples(samples: CacheSample[]): CacheStats | null {
  if (samples.length === 0) return null;
  let read = 0;
  let write = 0;
  let uncached = 0;
  let input = 0;
  let eligibleRead = 0;
  let eligibleInput = 0;
  let eligibleSamples = 0;
  for (const sample of samples) {
    read += sample.cacheRead;
    write += sample.cacheWrite;
    uncached += sample.uncached;
    input += sample.inputTotal;
    if (sample.eligible) {
      eligibleSamples += 1;
      eligibleRead += sample.cacheRead;
      eligibleInput += sample.inputTotal;
    }
  }
  const last = samples[samples.length - 1];
  const hitPercent = input > 0 ? clampPercent((read / input) * 100) : null;
  const steadyHitPercent =
    eligibleInput > 0 ? clampPercent((eligibleRead / eligibleInput) * 100) : null;
  return {
    hitPercent: last?.hitPercent ?? null,
    sessionHitPercent: hitPercent,
    steadyHitPercent,
    ceilingPercent: last?.ceilingPercent ?? null,
    inputTotal: input,
    cacheRead: read,
    cacheWrite: write,
    uncached,
    eligible: eligibleSamples > 0,
    state: last?.state ?? 'cold',
    epoch: last?.epoch ?? 0,
    samples: samples.length,
    breakReason: last?.breakReason ?? null,
    breakDetail: last?.breakDetail ?? null,
    at: last?.at ?? Date.now(),
  };
}

/** Estimated USD saved by cache reads (catalog prices are per million tokens). */
export function cacheSavingsUsd(
  sample: Pick<CacheSample, 'cacheRead' | 'cacheWrite'> | null | undefined,
  cost:
    | { input?: number | null; cacheRead?: number | null; cacheWrite?: number | null }
    | null
    | undefined,
): number | null {
  if (!sample || !cost) return null;
  const inputPrice = cost.input ?? null;
  const readPrice = cost.cacheRead ?? null;
  const writePrice = cost.cacheWrite ?? null;
  if (inputPrice == null || readPrice == null) return null;
  const readSaved = (sample.cacheRead / 1_000_000) * Math.max(0, inputPrice - readPrice);
  // Cache writes are usually more expensive than plain input; report the net.
  const writeExtra =
    writePrice != null
      ? (sample.cacheWrite / 1_000_000) * Math.max(0, writePrice - inputPrice)
      : 0;
  return readSaved - writeExtra;
}

/** Build the UI aggregate for one conversation from its recent samples. */
export function conversationCacheStats(
  conversationId: string,
  samples: CacheSample[],
): CacheStats | null {
  const aggregate = aggregateCacheSamples(samples);
  if (!aggregate) return null;
  return {
    ...aggregate,
    // `conversationId` is deliberately not part of CacheStats; kept here so the
    // store can associate the aggregate without another DTO.
    at: aggregate.at,
    samples: samples.length,
  };
}
