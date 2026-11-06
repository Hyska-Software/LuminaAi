// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { CacheStats, ContextStats } from '@/lib/types';
import type { CacheConversationUi } from '@/lib/store/cacheStore';
import { emptyCodeSession, useAppStore, useCodeStore } from '@/lib/store';
import { useCacheStore } from '@/lib/store/cacheStore';
import { CodeContextMeterChip } from './CodeAgentWidgets';

const CONVERSATION_ID = 'conv-code';

function makeContext(overrides: Partial<ContextStats> = {}): ContextStats {
  return {
    used: 441_000,
    window: 1_000_000,
    outputCap: 32_000,
    percent: 44,
    messages: 120,
    breakdown: { systemPrompt: 100_000, toolDefinitions: 41_000, messages: 300_000 },
    ...overrides,
  };
}

function makeCacheStats(overrides: Partial<CacheStats> = {}): CacheStats {
  return {
    hitPercent: 98,
    sessionHitPercent: 97,
    steadyHitPercent: 98.2,
    ceilingPercent: 98.6,
    inputTotal: 250_000,
    cacheRead: 240_000,
    cacheWrite: 6_000,
    uncached: 4_000,
    eligible: true,
    state: 'stable',
    epoch: 1,
    samples: 12,
    ttlSeconds: 3600,
    at: Date.now(),
    ...overrides,
  };
}

function makeCache(): CacheConversationUi {
  return {
    current: makeCacheStats(),
    session: makeCacheStats(),
    epoch: 1,
    samples: [],
    lastBreak: null,
    restored: true,
  };
}

function setShowCacheIndicator(showIndicator: boolean): void {
  useAppStore.setState((state) => ({
    settings: {
      ...state.settings,
      cache: {
        showIndicator,
        anthropicTtl: state.settings.cache?.anthropicTtl ?? '1h',
        openaiRetention: state.settings.cache?.openaiRetention ?? null,
      },
    },
  }));
}

function seedCode(context: ContextStats | null): void {
  const session = emptyCodeSession(CONVERSATION_ID);
  useCodeStore.setState({
    byConversation: { [CONVERSATION_ID]: { ...session, context } },
  });
}

beforeEach(() => {
  useCodeStore.setState({ byConversation: {} });
  useCacheStore.getState().reset();
  setShowCacheIndicator(true);
});

afterEach(cleanup);

describe('CodeContextMeterChip — medidor do header Code', () => {
  it('mostra o medidor de contexto (sem cache) e não esconde abaixo de 1024px', () => {
    seedCode(makeContext());
    const { container } = render(<CodeContextMeterChip conversationId={CONVERSATION_ID} />);

    const button = screen.getByRole('button', { name: 'Contexto usado: 44%' });
    expect(button.textContent).toContain('44%');
    // O cache não participa do nome acessível nem aparece sem amostra.
    expect(button.getAttribute('aria-describedby')).toBeNull();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('hidden sm:block');
    expect(wrapper.className).not.toContain('hidden lg:block');
  });

  it('combina anel de contexto + segmento de cache quando há amostras', () => {
    seedCode(makeContext());
    useCacheStore.setState({ byConversation: { [CONVERSATION_ID]: makeCache() } });
    render(<CodeContextMeterChip conversationId={CONVERSATION_ID} />);

    const button = screen.getByRole('button', { name: 'Contexto usado: 44%' });
    expect(button.textContent).toContain('44%');
    expect(button.textContent).toContain('98%');
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toBe(
      'Cache de prompt: 98% de acerto — estável.',
    );
  });

  it('showCache=false mantém o contexto do Agentes e remove o segmento de cache', () => {
    seedCode(makeContext());
    useCacheStore.setState({ byConversation: { [CONVERSATION_ID]: makeCache() } });
    render(<CodeContextMeterChip conversationId={CONVERSATION_ID} showCache={false} />);

    const button = screen.getByRole('button', { name: 'Contexto usado: 44%' });
    expect(button.textContent).toContain('44%');
    expect(button.textContent).not.toContain('98%');
    expect(button.getAttribute('aria-describedby')).toBeNull();
  });

  it('showCache=false sem snapshot de contexto não cai para o chip de cache', () => {
    useCacheStore.setState({ byConversation: { [CONVERSATION_ID]: makeCache() } });
    const { container } = render(
      <CodeContextMeterChip conversationId={CONVERSATION_ID} showCache={false} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('cai para o chip cache-first quando só há cache (sessão sem snapshot de contexto)', () => {
    useCacheStore.setState({ byConversation: { [CONVERSATION_ID]: makeCache() } });
    render(<CodeContextMeterChip conversationId={CONVERSATION_ID} />);

    expect(
      screen.getByRole('button', { name: 'Cache de prompt: 98% de acerto' }),
    ).toBeTruthy();
  });

  it('não renderiza nada sem contexto nem cache', () => {
    const { container } = render(<CodeContextMeterChip conversationId={CONVERSATION_ID} />);
    expect(container.firstChild).toBeNull();
  });

  it('obedece Settings.cache.showIndicator: esconde o cache, não o contexto', () => {
    seedCode(makeContext());
    useCacheStore.setState({ byConversation: { [CONVERSATION_ID]: makeCache() } });
    setShowCacheIndicator(false);
    render(<CodeContextMeterChip conversationId={CONVERSATION_ID} />);

    const button = screen.getByRole('button', { name: 'Contexto usado: 44%' });
    expect(button.textContent).toContain('44%');
    expect(button.textContent).not.toContain('98%');
    expect(button.getAttribute('aria-describedby')).toBeNull();
  });

  it('esconde o chip cache-first quando o indicador está desligado', () => {
    useCacheStore.setState({ byConversation: { [CONVERSATION_ID]: makeCache() } });
    setShowCacheIndicator(false);
    const { container } = render(<CodeContextMeterChip conversationId={CONVERSATION_ID} />);
    expect(container.firstChild).toBeNull();
  });
});
