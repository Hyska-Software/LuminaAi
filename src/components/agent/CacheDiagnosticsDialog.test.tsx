// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  CacheSample,
  CacheStats,
  CacheStatsView,
  Conversation,
  ProviderInfo,
} from '@/lib/types';

const mocks = vi.hoisted(() => ({
  getCacheStats: vi.fn(),
  copyText: vi.fn(async (_text: string) => true),
}));

vi.mock('@/lib/api', () => ({ api: { getCacheStats: mocks.getCacheStats } }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return { ...actual, copyText: mocks.copyText };
});

// Imported after the mocks above.
import { toast } from 'sonner';
import { useAppStore, useChatStore } from '@/lib/store';
import { useCacheStore } from '@/lib/store/cacheStore';
import { CacheDiagnosticsDialog } from './CacheDiagnosticsDialog';

const AT = Date.now();

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    title: 'Planejamento do projeto',
    createdAt: 1,
    updatedAt: 2,
    pinned: false,
    providerId: 'opencode-go',
    modelId: 'deepseek-v4.1-flash',
    messageCount: 2,
    ...overrides,
  };
}

function provider(overrides: Partial<ProviderInfo> = {}): ProviderInfo {
  return {
    id: 'opencode-go',
    name: 'OpenCode Go',
    shortName: 'OpenCode Go',
    description: '',
    baseUrl: 'https://api.opencode.ai',
    consoleUrl: 'https://opencode.ai',
    endpoints: { 'openai-chat': '/chat/completions' },
    authEnv: 'OPENCODE_API_KEY',
    defaultModelId: 'deepseek-v4.1-flash',
    models: [],
    notes: [],
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
    epoch: 3,
    inputTotal: 250_000,
    cacheRead: 240_000,
    cacheWrite: 6_000,
    uncached: 4_000,
    hitPercent: 98,
    ceilingPercent: 98.6,
    eligible: true,
    state: 'stable',
    at: AT,
    ...overrides,
  };
}

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
    epoch: 3,
    samples: 2,
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
    epoch: 3,
    recent: [
      sample({ step: 3, hitPercent: 96, at: AT - 2_000 }),
      sample({ step: 4, hitPercent: 98, at: AT, rawUsage: { cached_tokens: 240_000 } }),
    ],
    ...overrides,
  };
}

function Harness({ initialOpen = true }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        abrir diagnóstico
      </button>
      <CacheDiagnosticsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

async function openDialog(): Promise<HTMLElement> {
  render(<Harness />);
  return screen.findByRole('dialog', { name: 'Diagnóstico de cache' });
}

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState({ activeId: 'conv-1', conversations: [conversation()] });
  useAppStore.setState({ providers: [provider()] });
  useCacheStore.getState().reset();
  mocks.copyText.mockResolvedValue(true);
  mocks.getCacheStats.mockResolvedValue(view());
});

afterEach(() => {
  cleanup();
  useCacheStore.getState().reset();
});

describe('CacheDiagnosticsDialog — resumo e amostras', () => {
  it('restaura do backend ao abrir e mostra provedor/modelo/protocolo, epoch e números', async () => {
    const dialog = await openDialog();
    await waitFor(() => expect(mocks.getCacheStats).toHaveBeenCalledWith('conv-1', 50));

    const summary = await within(dialog).findByRole('region', { name: 'Resumo' });
    expect(within(summary).getByText('OpenCode Go')).toBeTruthy();
    expect(within(summary).getByText('deepseek-v4.1-flash')).toBeTruthy();
    expect(within(summary).getByText('openai-chat')).toBeTruthy();
    expect(within(summary).getByText('#3')).toBeTruthy();
    expect(within(summary).getByText('Último request')).toBeTruthy();
    expect(within(summary).getByText('Sessão (ponderada)')).toBeTruthy();
    expect(within(summary).getByText('Acerto estável')).toBeTruthy();
    expect(within(summary).getByText('Teto do request')).toBeTruthy();
    expect(within(summary).getByText('TTL')).toBeTruthy();
    expect(within(summary).getByText('1 h')).toBeTruthy();
    expect(within(summary).getByText('Mínimo cacheável')).toBeTruthy();
    expect(within(summary).getByText('~1.0K')).toBeTruthy();
    expect(within(summary).getByText('Estável')).toBeTruthy();
  });

  it('lista as amostras recentes (mais nova primeiro) com tokens, hit, teto, estado e motivo', async () => {
    const dialog = await openDialog();
    const table = await within(dialog).findByRole('table', {
      name: 'Amostras recentes de cache',
    });
    const rows = within(table).getAllByRole('row');
    // Cabeçalho + 2 amostras.
    expect(rows).toHaveLength(3);
    expect(rows[1].textContent).toContain('4');
    expect(rows[1].textContent).toContain('240K');
    expect(rows[1].textContent).toContain('6.0K');
    expect(rows[1].textContent).toContain('4.0K');
    expect(rows[1].textContent).toContain('98%');
    expect(rows[1].textContent).toContain('Estável');
    expect(rows[2].textContent).toContain('96%');
  });

  it('mostra última quebra e quebras recentes com motivo legível', async () => {
    mocks.getCacheStats.mockResolvedValue(
      view({
        recent: [
          sample({ step: 1, hitPercent: 0, state: 'warming', breakReason: 'first_request' }),
          sample({
            step: 2,
            hitPercent: 41,
            state: 'degraded',
            breakReason: 'system_prompt',
            breakDetail: 'hash do system prompt mudou',
            at: AT + 1_000,
          }),
        ],
      }),
    );
    const dialog = await openDialog();
    const breaks = await within(dialog).findByRole('region', { name: 'Quebras recentes' });
    expect(within(breaks).getByText('Prompt de sistema mudou')).toBeTruthy();
    expect(within(breaks).getByText('hash do system prompt mudou')).toBeTruthy();
    expect(within(breaks).getByText('Primeiro request do epoch')).toBeTruthy();
  });

  it('atualiza ao vivo quando o cacheStore recebe uma amostra nova', async () => {
    const dialog = await openDialog();
    const table = await within(dialog).findByRole('table', {
      name: 'Amostras recentes de cache',
    });
    expect(within(table).getAllByRole('row')).toHaveLength(3);

    act(() => {
      useCacheStore.getState().applySample(
        'conv-1',
        sample({
          step: 5,
          hitPercent: 99,
          cacheRead: 245_000,
          uncached: 1_000,
          at: AT + 5_000,
        }),
      );
    });

    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(4));
    expect(within(table).getAllByRole('row')[1].textContent).toContain('99%');
  });
});

describe('CacheDiagnosticsDialog — estados honestos', () => {
  it('sem amostras: mensagem explícita e nenhuma tabela', async () => {
    mocks.getCacheStats.mockResolvedValue({
      conversationId: 'conv-1',
      current: null,
      session: null,
      epoch: 0,
      recent: [],
    });
    const dialog = await openDialog();

    expect(await within(dialog).findByText('Sem amostras de cache nesta conversa')).toBeTruthy();
    expect(within(dialog).queryByRole('table')).toBeNull();
    expect(within(dialog).queryByRole('region', { name: 'Resumo' })).toBeNull();
  });

  it('sem conversa ativa: estado vazio e "Copiar JSON" desabilitado', async () => {
    useChatStore.setState({ activeId: null });
    render(<CacheDiagnosticsDialog open onOpenChange={() => undefined} />);

    const dialog = await screen.findByRole('dialog', { name: 'Diagnóstico de cache' });
    expect(within(dialog).getByText('Nenhuma conversa aberta')).toBeTruthy();
    expect(mocks.getCacheStats).not.toHaveBeenCalled();
    expect(
      (within(dialog).getByRole('button', { name: 'Copiar JSON' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('erro do backend: toast discreto, estado de erro e "Tentar novamente" refaz a chamada', async () => {
    mocks.getCacheStats.mockRejectedValueOnce(new Error('backend offline'));
    const dialog = await openDialog();

    expect(
      await within(dialog).findByText('Não foi possível carregar o diagnóstico de cache'),
    ).toBeTruthy();
    expect(within(dialog).getByText('backend offline')).toBeTruthy();
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      'Não foi possível carregar o diagnóstico de cache',
      { description: 'backend offline' },
    );

    mocks.getCacheStats.mockResolvedValueOnce(view());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tentar novamente' }));

    await waitFor(() => expect(mocks.getCacheStats).toHaveBeenCalledTimes(2));
    expect(await within(dialog).findByRole('region', { name: 'Resumo' })).toBeTruthy();
  });

  it('erro de atualização com dados ao vivo: aviso inline em vez de apagar o painel', async () => {
    useCacheStore.getState().seed(
      'conv-1',
      view({
        current: null,
        session: null,
        recent: [sample({ step: 2 })],
      }),
    );
    mocks.getCacheStats.mockRejectedValueOnce(new Error('timeout'));
    const dialog = await openDialog();

    expect(
      await within(dialog).findByText(/exibindo os dados ao vivo/),
    ).toBeTruthy();
    expect(within(dialog).getByRole('table', { name: 'Amostras recentes de cache' })).toBeTruthy();
  });
});

describe('CacheDiagnosticsDialog — copiar JSON e acessibilidade', () => {
  it('copia o JSON com usage bruto, amostras e metadados de sessão', async () => {
    const dialog = await openDialog();
    await within(dialog).findByRole('region', { name: 'Resumo' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Copiar JSON' }));

    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(mocks.copyText.mock.calls[0][0] as string) as {
      conversationId: string;
      epoch: number;
      ttlSeconds: number | null;
      rawUsage: unknown;
      samples: CacheSample[];
    };
    expect(payload.conversationId).toBe('conv-1');
    expect(payload.epoch).toBe(3);
    expect(payload.ttlSeconds).toBe(3600);
    expect(payload.rawUsage).toEqual({ cached_tokens: 240_000 });
    expect(payload.samples).toHaveLength(2);
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Diagnóstico de cache copiado');
  });

  it('é um dialog acessível: nome, foco inicial e Esc fecha', async () => {
    const onOpenChange = vi.fn();
    render(<CacheDiagnosticsDialog open onOpenChange={onOpenChange} />);

    const dialog = await screen.findByRole('dialog', { name: 'Diagnóstico de cache' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'Fechar' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Atualizar' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Copiar JSON' })).toBeTruthy();

    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('oferece "Atualizar" para refazer a consulta sem fechar', async () => {
    const dialog = await openDialog();
    await within(dialog).findByRole('region', { name: 'Resumo' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(mocks.getCacheStats).toHaveBeenCalledTimes(2));
  });
});
