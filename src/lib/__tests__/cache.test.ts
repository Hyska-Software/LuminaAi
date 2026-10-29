import { describe, expect, it } from 'vitest';
import type { CacheSample, UsageInfo } from '../types';
import {
  aggregateCacheSamples,
  cacheBreakLabel,
  cacheHitPercent,
  cacheSavingsUsd,
  cacheStateMeta,
  ceilingPercent,
  formatCacheHit,
  mergeCacheUsage,
  normalizeLegacyUsage,
} from '../cache';

function sample(overrides: Partial<CacheSample> = {}): CacheSample {
  return {
    turnId: 'turn-1',
    step: 1,
    providerId: 'opencode-go',
    modelId: 'deepseek-v4.1-flash',
    protocol: 'openai-chat',
    epoch: 0,
    inputTotal: 10_000,
    cacheRead: 9_800,
    cacheWrite: 0,
    uncached: 200,
    hitPercent: 98,
    ceilingPercent: 98.2,
    prefixTokensEst: 9_800,
    deltaTokensEst: 200,
    eligible: true,
    state: 'stable',
    at: 1_700_000_000_000,
    ...overrides,
  };
}

describe('cache helpers', () => {
  it('computes provider-billed hit percent from read/write/uncached', () => {
    const usage: UsageInfo = {
      cacheReported: true,
      cacheReadTokens: 9_500,
      cacheWriteTokens: 100,
      uncachedInputTokens: 400,
    };
    expect(cacheHitPercent(usage)).toBeCloseTo(95, 5);
  });

  it('returns null when the provider did not report cache', () => {
    expect(cacheHitPercent({})).toBeNull();
    expect(cacheHitPercent({ cacheReported: true, cacheReadTokens: 0, uncachedInputTokens: 0 }))
      .toBeNull();
  });

  it('computes the theoretical ceiling and clamps it', () => {
    expect(ceilingPercent(9_800, 200)).toBeCloseTo(98, 5);
    expect(ceilingPercent(0, 0)).toBeNull();
    expect(ceilingPercent(-1, 10)).toBeCloseTo(0, 5);
  });

  it('formats a hit and degrades missing data to an em dash', () => {
    expect(formatCacheHit(98.4)).toBe('98%');
    expect(formatCacheHit(null)).toBe('—');
    expect(formatCacheHit(Number.NaN)).toBe('—');
  });

  it('maps cache states to pt-BR labels and tones', () => {
    expect(cacheStateMeta('stable').label).toBe('Estável');
    expect(cacheStateMeta('stable').tone).toBe('success');
    expect(cacheStateMeta('degraded').tone).toBe('warning');
    expect(cacheStateMeta('unsupported').label).toBe('Não reportado');
    expect(cacheStateMeta(undefined).label).toBe('Frio');
  });

  it('labels break reasons for the diagnostics popover', () => {
    expect(cacheBreakLabel('system_prompt')).toBe('Prompt de sistema mudou');
    expect(cacheBreakLabel('compaction')).toBe('Contexto compactado');
    expect(cacheBreakLabel(null)).toBeNull();
  });

  it('merges cache counters without losing previous values', () => {
    const merged = mergeCacheUsage(
      { cacheReported: true, cacheReadTokens: 100 },
      { outputTokens: 10 },
    );
    expect(merged.cacheReadTokens).toBe(100);
    expect(merged.cacheReported).toBe(true);
    expect(merged.outputTokens).toBe(10);
  });

  it('normalizes legacy usage with cachedTokens only', () => {
    const legacy = normalizeLegacyUsage({
      inputTokens: 10_000,
      cachedTokens: 9_000,
    });
    expect(legacy.cacheReported).toBe(true);
    expect(legacy.cacheReadTokens).toBe(9_000);
    expect(legacy.uncachedInputTokens).toBe(1_000);
    expect(normalizeLegacyUsage(null).cacheReported).toBe(false);
  });

  it('aggregates samples token-weighted including cold/write requests', () => {
    const aggregate = aggregateCacheSamples([
      sample({ cacheRead: 0, cacheWrite: 9_000, uncached: 1_000, inputTotal: 10_000, state: 'cold', eligible: false }),
      sample({ inputTotal: 100_000, cacheRead: 98_500, cacheWrite: 500, uncached: 1_000 }),
    ]);
    expect(aggregate).not.toBeNull();
    expect(aggregate?.samples).toBe(2);
    expect(aggregate?.sessionHitPercent).toBeCloseTo((98_500 / 110_000) * 100, 4);
    expect(aggregate?.inputTotal).toBe(110_000);
    expect(aggregate?.steadyHitPercent).toBeCloseTo((98_500 / 100_000) * 100, 4);
  });

  it('estimates savings from catalog cache prices', () => {
    const saved = cacheSavingsUsd(
      { cacheRead: 1_000_000, cacheWrite: 0 },
      { input: 0.15, cacheRead: 0.003, cacheWrite: 0.1875 },
    );
    expect(saved).toBeCloseTo(0.147, 6);
  });
});
