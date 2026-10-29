// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CacheSample, CacheStats, CacheStatsView } from '@/lib/types';
import type { CacheConversationUi } from '@/lib/store/cacheStore';

const utilsMocks = vi.hoisted(() => ({ copyText: vi.fn(async () => true) }));

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return { ...actual, copyText: utilsMocks.copyText };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Imported after the mocks above.
import { useCacheStore } from '@/lib/store/cacheStore';
import { CACHE_DIAGNOSTICS_EVENT } from './cacheDiagnosticsRequest';
import { CacheHitChip } from './CacheHitChip';

const NOW = Date.now();

function stats(overrides: Partial<CacheStats> = {}): CacheStats {
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
    at: NOW,
    ...overrides,
  };
}

function sample(overrides: Partial<CacheSample> = {}): CacheSample {
  return {
    turnId: 'turn-1',
    step: 4,
    providerId: 'opencode-go',
    modelId: 'deepseek-v4.1-flash',
    protocol: 'openai-chat',
    epoch: 1,
    inputTotal: 250_000,
    cacheRead: 240_000,
    cacheWrite: 6_000,
    uncached: 4_000,
    hitPercent: 98,
    ceilingPercent: 98.6,
    eligible: true,
    state: 'stable',
    at: NOW,
    ...overrides,
  };
}

function cacheUi(overrides: Partial<CacheConversationUi> = {}): CacheConversationUi {
  return {
    current: stats(),
    session: stats(),
    epoch: 1,
    samples: Array.from({ length: 12 }, (_, index) =>
      sample({ step: index + 1, at: NOW - (11 - index) * 1_000 }),
    ),
    lastBreak: null,
    restored: true,
    ...overrides,
  };
}

function trigger(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

async function openPopover(name = 'Cache de prompt: 98% de acerto'): Promise<HTMLElement> {
  fireEvent.click(trigger(name));
  return screen.findByRole('dialog', { name: 'Detalhes do cache de prompt' });
}

function descriptionOf(button: HTMLElement): string {
  const id = button.getAttribute('aria-describedby');
  expect(id).toBeTruthy();
  return document.getElementById(id as string)?.textContent ?? '';
}

afterEach(() => {
  cleanup();
  useCacheStore.getState().reset();
});

describe('CacheHitChip — chip cache-first (composer do Chat)', () => {
  it('mostra Zap + cache% com largura reservada e nome acessível honesto', () => {
    render(<CacheHitChip cache={cacheUi()} />);

    const button = trigger('Cache de prompt: 98% de acerto');
    expect(button.textContent).toContain('cache');
    expect(button.textContent).toContain('98%');
    expect(button.className).toContain('h-8');
    expect(button.className).toContain('min-w-[5.5rem]');
    expect(button.className).toContain('focus-visible:ring-2');
    expect(button.querySelector('.tabular-nums')).toBeTruthy();
    // Ícone decorativo com o tom do estado (a cor não é o único sinal).
    const icon = button.querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.getAttribute('class') ?? '').toContain('text-success');
    expect(descriptionOf(button)).toBe('Cache de prompt: 98% de acerto — estável.');
  });

  it('abre o painel de diagnóstico com todos os números do último request', async () => {
    render(<CacheHitChip cache={cacheUi()} />);
    const dialog = await openPopover();

    expect(within(dialog).getByText('Cache de prompt')).toBeTruthy();
    expect(within(dialog).getByText('98% de acerto')).toBeTruthy();
    expect(within(dialog).getByText('Lido do cache')).toBeTruthy();
    expect(within(dialog).getByText('240K')).toBeTruthy();
    expect(within(dialog).getByText('Gravado no cache')).toBeTruthy();
    expect(within(dialog).getByText('6.0K')).toBeTruthy();
    expect(within(dialog).getByText('Sem cache')).toBeTruthy();
    expect(within(dialog).getByText('4.0K')).toBeTruthy();
    expect(within(dialog).getByText('Acumulado da sessão')).toBeTruthy();
    expect(within(dialog).getByText('97% em 12 passos')).toBeTruthy();
    expect(within(dialog).getByText('Estável')).toBeTruthy();
    expect(within(dialog).getByText('Acerto estável')).toBeTruthy();
    expect(within(dialog).getByText('Teto deste request')).toBeTruthy();
    expect(within(dialog).getByText('12 amostras')).toBeTruthy();
    expect(within(dialog).getByText('TTL')).toBeTruthy();
    expect(within(dialog).getByText('1 h')).toBeTruthy();
    expect(
      within(dialog).getByText('Acerto = tokens lidos do cache ÷ tokens de entrada do passo.'),
    ).toBeTruthy();

    const bar = within(dialog).getByRole('progressbar', {
      name: 'Acerto do cache de prompt',
    });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('98');
    expect(bar.getAttribute('aria-valuetext')).toBe('98% de acerto no cache');
    // Barra segmentada: lido + gravado + novo.
    const segments = Array.from(bar.children) as HTMLElement[];
    expect(segments).toHaveLength(3);
    expect(segments[0].className).toContain('bg-success');
    expect(segments[1].className).toContain('bg-accent');
    expect(segments[2].className).toContain('bg-context-system');
    expect(segments[0].style.width).toBe('96%');
    expect(segments[0].className).toContain('motion-reduce:transition-none');

    // Renderer atualiza no lugar, sem remontar o popover.
    fireEvent.click(trigger('Cache de prompt: 98% de acerto'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('aquecendo: mostra o 0% real e explica que o acerto vem no próximo passo', async () => {
    const warming = sample({
      step: 1,
      hitPercent: 0,
      state: 'warming',
      cacheRead: 0,
      cacheWrite: 41_000,
      uncached: 1_000,
      inputTotal: 42_000,
      at: NOW,
    });
    render(
      <CacheHitChip
        cache={cacheUi({
          current: stats({
            hitPercent: 0,
            state: 'warming',
            cacheRead: 0,
            cacheWrite: 41_000,
            uncached: 1_000,
            inputTotal: 42_000,
            samples: 1,
          }),
          session: stats({ hitPercent: 0, state: 'warming', samples: 1 }),
          samples: [warming],
        })}
      />,
    );

    const button = trigger('Cache de prompt: 0% de acerto');
    expect(button.textContent).toContain('0%');
    expect(descriptionOf(button)).toBe('Cache de prompt: aquecendo.');

    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Detalhes do cache de prompt' });
    expect(within(dialog).getByRole('status').textContent).toBe(
      'Aquecendo o cache: o primeiro request grava o prefixo e o acerto aparece no próximo passo.',
    );
    expect(within(dialog).getByText('Aquecendo')).toBeTruthy();
  });

  it('queda: tom danger, motivo legível e "de X% para Y%"', async () => {
    const latest = sample({
      step: 4,
      hitPercent: 41,
      state: 'degraded',
      breakReason: 'system_prompt',
      cacheRead: 100_000,
      cacheWrite: 0,
      uncached: 145_000,
      inputTotal: 245_000,
      at: NOW,
    });
    render(
      <CacheHitChip
        cache={cacheUi({
          current: stats({
            hitPercent: 41,
            state: 'degraded',
            breakReason: 'system_prompt',
            cacheRead: 100_000,
            cacheWrite: 0,
            uncached: 145_000,
            inputTotal: 245_000,
            at: NOW,
          }),
          samples: [sample({ step: 3, hitPercent: 98, at: NOW - 1_000 }), latest],
          lastBreak: { reason: 'Prompt de sistema mudou', detail: null, at: NOW },
        })}
      />,
    );

    const button = trigger('Cache de prompt: 41% de acerto');
    const icon = button.querySelector('svg');
    expect(icon?.getAttribute('class') ?? '').toContain('text-danger');
    expect(descriptionOf(button)).toBe('Cache de prompt: 41% de acerto — caiu.');

    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Detalhes do cache de prompt' });
    expect(within(dialog).getByRole('status').textContent).toBe(
      'Cache caiu de 98% para 41% neste passo. Motivo: o prompt de sistema mudou.',
    );
    expect(within(dialog).getByText('Última quebra')).toBeTruthy();
    expect(within(dialog).getByText('Prompt de sistema mudou')).toBeTruthy();
    expect(within(dialog).getByText('Cache caiu')).toBeTruthy();
  });

  it('provedor sem reporte: `—`, nunca 0%, e nota honesta', async () => {
    const noReport = stats({
      hitPercent: null,
      sessionHitPercent: null,
      steadyHitPercent: null,
      ceilingPercent: null,
      inputTotal: 0,
      cacheRead: 0,
      cacheWrite: 0,
      uncached: 0,
      state: 'unsupported',
      samples: 1,
    });
    render(
      <CacheHitChip
        cache={cacheUi({
          current: noReport,
          session: noReport,
          samples: [sample({ hitPercent: null, state: 'unsupported', inputTotal: 0 })],
        })}
      />,
    );

    const button = trigger('Cache de prompt: sem dados');
    expect(button.textContent).toContain('—');
    expect(descriptionOf(button)).toBe('Cache de prompt: sem dados neste provedor.');

    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Detalhes do cache de prompt' });
    expect(within(dialog).getByText('Não reportado')).toBeTruthy();
    expect(within(dialog).getByRole('status').textContent).toBe(
      'Este provedor não informa detalhes de cache nesta execução.',
    );
    const bar = within(dialog).getByRole('progressbar', {
      name: 'Acerto do cache de prompt',
    });
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
    expect(bar.getAttribute('aria-valuetext')).toBe('acerto de cache não reportado');
    expect(bar.children).toHaveLength(0);
  });

  it('sem dados (cache null): chip `—` e mensagem de espera', async () => {
    render(<CacheHitChip cache={null} />);

    const button = trigger('Cache de prompt: aguardando a primeira amostra');
    expect(button.textContent).toContain('—');
    expect(descriptionOf(button)).toBe('Cache de prompt: aguardando a primeira amostra.');

    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Detalhes do cache de prompt' });
    expect(within(dialog).getByRole('status').textContent).toBe(
      'Sem amostras ainda. O acerto de cache aparece depois do primeiro passo.',
    );
    expect(within(dialog).queryByRole('button', { name: 'Copiar usage bruto' })).toBeNull();
  });

  it('copia o usage bruto do último request quando o provedor o devolve', async () => {
    const rawUsage = { prompt_tokens_details: { cached_tokens: 240_000 } };
    utilsMocks.copyText.mockClear();
    render(<CacheHitChip cache={cacheUi({ samples: [sample({ rawUsage })] })} />);

    fireEvent.click(trigger('Cache de prompt: 98% de acerto'));
    const dialog = await screen.findByRole('dialog', { name: 'Detalhes do cache de prompt' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copiar usage bruto' }));

    await waitFor(() =>
      expect(utilsMocks.copyText).toHaveBeenCalledWith(JSON.stringify(rawUsage, null, 2)),
    );
  });

  it('oferece "Ver diagnóstico completo" e emite o pedido de abertura (F5.4)', async () => {
    const listener = vi.fn();
    window.addEventListener(CACHE_DIAGNOSTICS_EVENT, listener);
    render(<CacheHitChip cache={cacheUi()} />);

    fireEvent.click(trigger('Cache de prompt: 98% de acerto'));
    const dialog = await screen.findByRole('dialog', { name: 'Detalhes do cache de prompt' });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Ver diagnóstico completo' }),
    );

    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    window.removeEventListener(CACHE_DIAGNOSTICS_EVENT, listener);
  });

  it('mantém TTL e economia do seed depois de uma amostra ao vivo', async () => {
    const conversationId = 'conv-restored';
    const view: CacheStatsView = {
      conversationId,
      current: stats({ ttlSeconds: 3600, savingsUsd: 0.42 }),
      session: stats({ ttlSeconds: 3600, savingsUsd: 0.42 }),
      epoch: 1,
      recent: [],
    };
    useCacheStore.getState().seed(conversationId, view);
    useCacheStore
      .getState()
      .applySample(conversationId, sample({ step: 5, hitPercent: 96, cacheRead: 240_000 }));
    const cache = useCacheStore.getState().byConversation[conversationId];

    render(<CacheHitChip cache={cache} />);
    fireEvent.click(trigger('Cache de prompt: 96% de acerto'));
    const dialog = await screen.findByRole('dialog', { name: 'Detalhes do cache de prompt' });
    // Metadados de sessão vêm do snapshot restaurado; a amostra ao vivo não os apaga.
    expect(within(dialog).getByText('TTL')).toBeTruthy();
    expect(within(dialog).getByText('1 h')).toBeTruthy();
    expect(within(dialog).getByText('Economia estimada')).toBeTruthy();
    expect(within(dialog).getByText('$0.42')).toBeTruthy();
  });

  it('a11y: gatilho focável e aria-expanded alterna ao abrir/fechar', async () => {
    render(<CacheHitChip cache={cacheUi()} />);

    const button = trigger('Cache de prompt: 98% de acerto');
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(button);
    await screen.findByRole('dialog', { name: 'Detalhes do cache de prompt' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });
});
