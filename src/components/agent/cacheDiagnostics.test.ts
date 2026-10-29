import { describe, expect, it } from 'vitest';
import type { CacheSample, CacheStats, CacheStatsView } from '@/lib/types';
import type { CacheConversationUi } from '@/lib/store/cacheStore';
import {
  buildCacheDiagnostics,
  cacheStateBadgeTone,
  formatCacheTtl,
} from './cacheDiagnostics';

const AT = 1_700_000_000_000;

function sample(overrides: Partial<CacheSample> = {}): CacheSample {
  return {
    turnId: 'turn-1',
    step: 1,
    providerId: 'opencode-go',
    modelId: 'deepseek-v4.1-flash',
    protocol: 'openai-chat',
    epoch: 2,
    inputTotal: 100_000,
    cacheRead: 90_000,
    cacheWrite: 0,
    uncached: 10_000,
    hitPercent: 90,
    ceilingPercent: 90.9,
    eligible: true,
    state: 'stable',
    at: AT,
    ...overrides,
  };
}

function stats(overrides: Partial<CacheStats> = {}): CacheStats {
  return {
    hitPercent: 90,
    sessionHitPercent: 88,
    steadyHitPercent: 91,
    ceilingPercent: 90.9,
    inputTotal: 100_000,
    cacheRead: 90_000,
    cacheWrite: 0,
    uncached: 10_000,
    eligible: true,
    state: 'stable',
    epoch: 2,
    samples: 3,
    ttlSeconds: 3600,
    minCacheableTokens: 1024,
    at: AT,
    ...overrides,
  };
}

function view(overrides: Partial<CacheStatsView> = {}): CacheStatsView {
  return {
    conversationId: 'conv-1',
    current: stats(),
    session: stats(),
    epoch: 2,
    recent: [sample({ step: 1, at: AT + 2_000 }), sample({ step: 0, at: AT })],
    ...overrides,
  };
}

describe('buildCacheDiagnostics', () => {
  it('ordena amostras por instante e usa a mais nova para provedor/modelo/protocolo', () => {
    const diagnostics = buildCacheDiagnostics({ view: view(), live: null });
    expect(diagnostics.samples.map((entry) => entry.step)).toEqual([0, 1]);
    expect(diagnostics.latest?.step).toBe(1);
    expect(diagnostics.providerId).toBe('opencode-go');
    expect(diagnostics.modelId).toBe('deepseek-v4.1-flash');
    expect(diagnostics.protocol).toBe('openai-chat');
    expect(diagnostics.epoch).toBe(2);
    expect(diagnostics.totalSamples).toBe(3);
    expect(diagnostics.hasData).toBe(true);
  });

  it('cai para provider/modelo da conversa quando não há amostra', () => {
    const empty = buildCacheDiagnostics({
      view: { conversationId: 'conv-1', current: null, session: null, epoch: 0, recent: [] },
      live: null,
      fallbackProviderId: 'anthropic',
      fallbackModelId: 'claude-sonnet-4.6',
    });
    expect(empty.providerId).toBe('anthropic');
    expect(empty.modelId).toBe('claude-sonnet-4.6');
    expect(empty.protocol).toBeNull();
    expect(empty.hasData).toBe(false);
  });

  it('prefere o estado ao vivo e preserva TTL/mínimo de sessão do snapshot', () => {
    const live: CacheConversationUi = {
      current: stats({ hitPercent: 99, ttlSeconds: 3600, minCacheableTokens: 2048 }),
      session: stats({ sessionHitPercent: 92, ttlSeconds: 3600, minCacheableTokens: 2048 }),
      epoch: 4,
      samples: [sample({ step: 7, hitPercent: 99, state: 'stable' })],
      lastBreak: null,
      restored: true,
    };
    const diagnostics = buildCacheDiagnostics({ view: view(), live });
    expect(diagnostics.epoch).toBe(4);
    expect(diagnostics.hit).toBe(99);
    expect(diagnostics.sessionHit).toBe(92);
    expect(diagnostics.latest?.step).toBe(7);
    expect(diagnostics.samples).toHaveLength(1);
    expect(diagnostics.ttlSeconds).toBe(3600);
    expect(diagnostics.minCacheableTokens).toBe(2048);
  });

  it('lista quebras recentes da mais nova para a mais antiga, no máximo 5', () => {
    const recent = Array.from({ length: 7 }, (_, index) =>
      sample({
        step: index,
        at: AT + index * 1_000,
        state: 'degraded',
        breakReason: index === 0 ? 'first_request' : 'system_prompt',
        breakDetail: `detalhe ${index}`,
      }),
    );
    const diagnostics = buildCacheDiagnostics({
      view: view({ recent }),
      live: null,
    });
    expect(diagnostics.breaks).toHaveLength(5);
    expect(diagnostics.breaks[0].step).toBe(6);
    expect(diagnostics.lastBreak?.detail).toBe('detalhe 6');
    expect(diagnostics.breaks[4].step).toBe(2);
  });

  it('usa a quebra da sessão quando nenhuma amostra recente carrega motivo', () => {
    const diagnostics = buildCacheDiagnostics({
      view: view({
        recent: [sample({ state: 'cold' })],
        session: stats({ state: 'degraded', breakReason: 'ttl_expired' }),
      }),
      live: null,
    });
    expect(diagnostics.lastBreak).toEqual({
      step: 1,
      at: AT,
      label: 'Cache expirou (TTL)',
      detail: null,
    });
    expect(diagnostics.breaks).toHaveLength(0);
  });
});

describe('formatCacheTtl / cacheStateBadgeTone', () => {
  it('formata TTL curto e degrada ausente para —', () => {
    expect(formatCacheTtl(3600)).toBe('1 h');
    expect(formatCacheTtl(5400)).toBe('1.5 h');
    expect(formatCacheTtl(300)).toBe('5 min');
    expect(formatCacheTtl(null)).toBe('—');
    expect(formatCacheTtl(0)).toBe('—');
  });

  it('mapeia estado para o tom do badge', () => {
    expect(cacheStateBadgeTone('stable')).toBe('success');
    expect(cacheStateBadgeTone('degraded')).toBe('danger');
    expect(cacheStateBadgeTone('warming')).toBe('accent');
    expect(cacheStateBadgeTone('unsupported')).toBe('neutral');
    expect(cacheStateBadgeTone(null)).toBe('neutral');
  });
});
