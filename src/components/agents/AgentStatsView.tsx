import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, RefreshCw } from 'lucide-react';

import { ChartSvg } from '@/components/genui';
import { Button, IconButton, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { useAppStore, useUiStore } from '@/lib/store';
import type { UsageStats } from '@/lib/types';

import { formatUsageCost, formatUsageTokens, modelLabel, relativeTime } from './agentUtils';

type UsagePeriod = '7d' | '30d' | '90d' | 'all';

const PERIODS: Array<{ id: UsagePeriod; labelKey: string }> = [
  { id: '7d', labelKey: 'stats.periods.7d' },
  { id: '30d', labelKey: 'stats.periods.30d' },
  { id: '90d', labelKey: 'stats.periods.90d' },
  { id: 'all', labelKey: 'stats.periods.all' },
];

const PERIOD_LABELS: Record<UsagePeriod, string> = {
  '7d': 'stats.periods.long.7d',
  '30d': 'stats.periods.long.30d',
  '90d': 'stats.periods.long.90d',
  all: 'stats.periods.long.all',
};

const DAY_MS = 86_400_000;

function sinceForPeriod(period: UsagePeriod): number | null {
  if (period === 'all') return null;
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  return Date.now() - days * DAY_MS;
}

function dayLabel(day: string): string {
  const [, month, date] = day.split('-');
  return month && date ? `${date}/${month}` : day;
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-2xl border border-border bg-surface-raised/60 p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-foreground-subtle">
        {label}
      </p>
      <p className="mt-1 truncate text-xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 truncate text-[11px] text-foreground-muted">{detail}</p>
    </article>
  );
}

export function AgentStatsView() {
  const { t } = useTranslation('agents');
  const [period, setPeriod] = useState<UsagePeriod>('all');
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const providers = useAppStore((state) => state.providers);
  const setAgentView = useUiStore((state) => state.setAgentView);

  useEffect(() => {
    let disposed = false;
    setError(null);
    setStats(null);
    setLoading(true);
    api
      .getUsageStats(sinceForPeriod(period))
      .then((next) => {
        if (disposed) return;
        setStats(next);
        setLoading(false);
      })
      .catch((nextError) => {
        if (disposed) return;
        setError(String(nextError));
        setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [period, reloadToken]);

  const topModel = stats?.byModel[0];
  const providerName = (providerId: string): string =>
    providers.find((provider) => provider.id === providerId)?.name ??
    (providerId || t('stats.unknownProvider'));
  const topModelLabel = topModel
    ? modelLabel(providers, topModel.providerId, topModel.modelId) || t('stats.unknownModel')
    : '—';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ArrowLeft className="size-4" />}
              onClick={() => setAgentView('team')}
            >
              {t('stats.back')}
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold tracking-tight">{t('stats.title')}</h1>
              <p className="mt-0.5 text-[12px] text-foreground-muted">
                {t('stats.subtitle', { period: t(PERIOD_LABELS[period] as never) })}
              </p>
            </div>
            <IconButton
              label={t('stats.refreshAria')}
              size="sm"
              disabled={loading}
              onClick={() => setReloadToken((value) => value + 1)}
            >
              <RefreshCw className="size-4" />
            </IconButton>
          </div>
          <div role="group" aria-label={t('stats.periodAria')} className="flex flex-wrap items-center gap-1">
            {PERIODS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={period === item.id}
                onClick={() => setPeriod(item.id)}
                className={
                  period === item.id
                    ? 'h-8 rounded-lg bg-surface-active px-2.5 text-[12px] text-foreground'
                    : 'h-8 rounded-lg px-2.5 text-[12px] text-foreground-muted hover:bg-surface-hover hover:text-foreground'
                }
              >
                {t(item.labelKey as never)}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-6 py-6">
          {error ? (
            <div
              role="alert"
              className="rounded-2xl border border-border bg-surface-raised/60 px-4 py-8 text-center"
            >
              <p className="text-[13px] font-medium text-foreground">
                {t('stats.loadError')}
              </p>
              <p className="mt-1 text-[11px] text-foreground-subtle">{error}</p>
              <Button className="mt-4" size="sm" onClick={() => setReloadToken((value) => value + 1)}>
                {t('common:actions.retry')}
              </Button>
            </div>
          ) : !stats ? (
            <div
              role="status"
              className="flex min-h-40 items-center justify-center gap-2 text-[13px] text-foreground-muted"
            >
              <Spinner size="sm" label={t('stats.loadingAria')} />
              {t('stats.loading')}
            </div>
          ) : stats.totals.turns === 0 ? (
            <div className="rounded-2xl border border-border bg-surface-raised/60 px-4 py-10 text-center">
              <p className="text-[13px] font-medium text-foreground">
                {t('stats.noUsage')}
              </p>
              <p className="mt-1 text-[12px] text-foreground-muted">
                {t('stats.noUsageHint')}
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label={t('stats.cards.tokens')}
                  value={formatUsageTokens(stats.totals.totalTokens)}
                  detail={t('stats.cards.tokensDetail', {
                    input: formatUsageTokens(stats.totals.inputTokens),
                    output: formatUsageTokens(stats.totals.outputTokens),
                    reasoning: formatUsageTokens(stats.totals.reasoningTokens),
                  })}
                />
                <StatCard
                  label={t('stats.cards.spend')}
                  value={formatUsageCost(stats.totals.cost)}
                  detail={
                    stats.totals.lastUsedAt
                      ? t('stats.cards.lastActivity', {
                          time: relativeTime(stats.totals.lastUsedAt),
                        })
                      : t('stats.cards.noActivity')
                  }
                />
                <StatCard
                  label={t('stats.cards.turns')}
                  value={formatNumber(stats.totals.turns)}
                  detail={t('stats.cards.averageTokens', {
                    tokens: formatUsageTokens(
                      Math.round(stats.totals.totalTokens / Math.max(stats.totals.turns, 1)),
                    ),
                  })}
                />
                <StatCard
                  label={t('stats.cards.topModel')}
                  value={topModelLabel}
                  detail={
                    topModel
                      ? t('stats.cards.modelTurns', {
                          provider: providerName(topModel.providerId),
                          count: topModel.turns,
                        })
                      : t('stats.cards.noUsageInPeriod')
                  }
                />
              </div>

              <section aria-labelledby="stats-daily-heading" className="mt-8">
                <h2
                  id="stats-daily-heading"
                  className="text-base font-semibold tracking-tight text-foreground"
                >
                  {t('stats.daily')}
                </h2>
                <div className="mt-3 rounded-2xl border border-border bg-surface-raised/60 p-4">
                  {stats.byDay.length > 0 ? (
                    <ChartSvg
                      spec={{
                        type: 'bar',
                        title: t('stats.tokensPerDay'),
                        data: stats.byDay.map((row) => ({
                          label: dayLabel(row.day),
                          value: row.totalTokens,
                        })),
                      }}
                      height={200}
                    />
                  ) : (
                    <p className="py-6 text-center text-[12px] text-foreground-subtle">
                      {t('stats.noDailyUsage')}
                    </p>
                  )}
                </div>
              </section>

              <section aria-labelledby="stats-models-heading" className="mt-8">
                <div className="flex items-end justify-between gap-4">
                  <h2
                    id="stats-models-heading"
                    className="text-base font-semibold tracking-tight text-foreground"
                  >
                    {t('stats.byModel')}
                  </h2>
                  <span className="text-[11px] text-foreground-subtle">
                    {t('stats.modelCount', { count: stats.byModel.length })}
                  </span>
                </div>
                {stats.byModel.length === 0 ? (
                  <p className="mt-3 text-[12px] text-foreground-subtle">{t('stats.noModels')}</p>
                ) : (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-border">
                    <table
                      aria-label={t('stats.byModelAria')}
                      className="w-full border-collapse text-left text-[12.5px]"
                    >
                      <thead className="bg-surface">
                        <tr>
                          <th
                            scope="col"
                            className="whitespace-nowrap border-b border-border px-3 py-2 font-semibold text-foreground"
                          >
                            {t('stats.columns.model')}
                          </th>
                          <th
                            scope="col"
                            className="whitespace-nowrap border-b border-border px-3 py-2 text-right font-semibold text-foreground"
                          >
                            {t('stats.columns.turns')}
                          </th>
                          <th
                            scope="col"
                            className="whitespace-nowrap border-b border-border px-3 py-2 text-right font-semibold text-foreground"
                          >
                            {t('stats.columns.tokens')}
                          </th>
                          <th
                            scope="col"
                            className="whitespace-nowrap border-b border-border px-3 py-2 text-right font-semibold text-foreground"
                          >
                            {t('stats.columns.share')}
                          </th>
                          <th
                            scope="col"
                            className="whitespace-nowrap border-b border-border px-3 py-2 text-right font-semibold text-foreground"
                          >
                            {t('stats.columns.cost')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.byModel.map((row) => {
                          const share =
                            stats.totals.totalTokens > 0
                              ? row.totalTokens / stats.totals.totalTokens
                              : null;
                          return (
                            <tr key={`${row.providerId}:${row.modelId}`} className="border-t border-border">
                              <td className="min-w-40 px-3 py-2 align-top">
                                <span className="block truncate font-medium text-foreground">
                                  {modelLabel(providers, row.providerId, row.modelId) ||
                                    t('stats.unknownModel')}
                                </span>
                                <span className="block truncate text-[11px] text-foreground-subtle">
                                  {providerName(row.providerId)}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right align-top tabular-nums text-foreground-muted">
                                {formatNumber(row.turns)}
                              </td>
                              <td className="px-3 py-2 text-right align-top tabular-nums text-foreground-muted">
                                {formatUsageTokens(row.totalTokens)}
                              </td>
                              <td className="px-3 py-2 text-right align-top tabular-nums text-foreground-muted">
                                {share === null ? '—' : formatPercent(share, 1)}
                              </td>
                              <td className="px-3 py-2 text-right align-top tabular-nums text-foreground-muted">
                                {formatUsageCost(row.cost)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <p className="mt-8 text-[11px] text-foreground-subtle">
                {t('stats.footnote')}
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
