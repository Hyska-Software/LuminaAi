// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getUsageStats: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));

import { useAppStore, useUiStore } from '@/lib/store';
import type { UsageStats } from '@/lib/types';
import { AgentStatsView } from './AgentStatsView';

const stats: UsageStats = {
  totals: {
    turns: 3,
    inputTokens: 10_000,
    outputTokens: 2_000,
    reasoningTokens: 345,
    totalTokens: 12_345,
    cost: 0.5,
    lastUsedAt: 1,
  },
  byModel: [
    {
      providerId: 'opencode-go',
      modelId: 'model-1',
      turns: 2,
      totalTokens: 9_000,
      cost: 0.4,
    },
    {
      providerId: 'opencode-go',
      modelId: 'model-2',
      turns: 1,
      totalTokens: 3_345,
      cost: 0.1,
    },
  ],
  byDay: [
    { day: '2026-11-04', totalTokens: 4_000 },
    { day: '2026-11-05', totalTokens: 8_345 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUsageStats.mockResolvedValue(stats);
  useAppStore.setState({
    providers: [
      {
        id: 'opencode-go',
        name: 'OpenCode Go',
        shortName: 'OpenCode Go',
        description: '',
        baseUrl: '',
        consoleUrl: '',
        endpoints: {},
        authEnv: '',
        defaultModelId: 'model-1',
        models: [],
        notes: [],
      },
    ],
  });
  useUiStore.setState({ agentView: 'stats' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AgentStatsView', () => {
  it('shows totals, the top model and the daily chart', async () => {
    render(<AgentStatsView />);

    expect(await screen.findByText('Tokens usados')).toBeTruthy();
    expect(screen.getByText('12,3 mil')).toBeTruthy();

    const costCard = screen.getByText('Gasto total').closest('article');
    expect(costCard).not.toBeNull();
    expect(within(costCard as HTMLElement).getByText('US$ 0,50')).toBeTruthy();

    const turnsCard = screen.getAllByText('Turnos')[0]?.closest('article');
    expect(turnsCard).not.toBeNull();
    expect(within(turnsCard as HTMLElement).getByText('3')).toBeTruthy();

    const topCard = screen.getByText('Modelo mais usado').closest('article');
    expect(topCard).not.toBeNull();
    expect(within(topCard as HTMLElement).getByText('model-1')).toBeTruthy();

    expect(mocks.getUsageStats).toHaveBeenCalledWith(null);
    expect(screen.getByRole('img', { name: 'Tokens por dia' })).toBeTruthy();
  });

  it('refetches with the selected rolling window', async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(<AgentStatsView />);
    await screen.findByText('Tokens usados');

    fireEvent.click(screen.getByRole('button', { name: '7 dias' }));

    await waitFor(() =>
      expect(mocks.getUsageStats).toHaveBeenLastCalledWith(now - 7 * 86_400_000),
    );
    expect(screen.getByRole('button', { name: '7 dias' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('shows an inline error and retries', async () => {
    mocks.getUsageStats.mockRejectedValueOnce(new Error('offline'));
    render(<AgentStatsView />);

    expect(await screen.findByText('Não foi possível carregar as estatísticas.')).toBeTruthy();
    mocks.getUsageStats.mockResolvedValueOnce(stats);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByText('Tokens usados')).toBeTruthy();
    expect(mocks.getUsageStats).toHaveBeenCalledTimes(2);
  });

  it('renders the empty state when there is no usage in the period', async () => {
    mocks.getUsageStats.mockResolvedValueOnce({
      totals: {
        turns: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        cost: 0,
        lastUsedAt: null,
      },
      byModel: [],
      byDay: [],
    });
    render(<AgentStatsView />);

    expect(await screen.findByText('Nenhum uso registrado neste período.')).toBeTruthy();
    expect(screen.queryByText('Por modelo')).toBeNull();
  });

  it('lists every model with its share of the total tokens', async () => {
    render(<AgentStatsView />);
    await screen.findByText('Por modelo');

    const table = screen.getByRole('table', { name: 'Uso por modelo' });
    expect(within(table).getAllByText('OpenCode Go')).toHaveLength(2);
    const row = within(table).getByText('model-1').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('2')).toBeTruthy();
    expect(within(row as HTMLElement).getByText('9 mil')).toBeTruthy();
    expect(within(row as HTMLElement).getByText('72,9%')).toBeTruthy();
  });

  it('returns to the team page from the back button', async () => {
    render(<AgentStatsView />);
    await screen.findByText('Tokens usados');

    fireEvent.click(screen.getByRole('button', { name: 'Voltar à Equipe' }));

    expect(useUiStore.getState().agentView).toBe('team');
  });
});
