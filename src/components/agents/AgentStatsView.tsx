import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';

import { ChartSvg } from '@/components/genui';
import { Button, IconButton, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useAppStore, useUiStore } from '@/lib/store';
import type { UsageStats } from '@/lib/types';

import { formatUsageCost, formatUsageTokens, modelLabel, relativeTime } from './agentUtils';

type UsagePeriod = '7d' | '30d' | '90d' | 'all';

const PERIODS: Array<{ id: UsagePeriod; label: string }> = [
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: '90d', label: '90 dias' },
  { id: 'all', label: 'Tudo' },
];

const PERIOD_LABELS: Record<UsagePeriod, string> = {
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  all: 'Todo o período',
};

const DAY_MS = 86_400_000;

const INTEGER_FORMAT = new Intl.NumberFormat('pt-BR');
const PERCENT_FORMAT = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 1,
});

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
  const topModelLabel = topModel
    ? modelLabel(providers, topModel.providerId, topModel.modelId) || 'Modelo desconhecido'
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
              Voltar à Equipe
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold tracking-tight">Estatísticas</h1>
              <p className="mt-0.5 text-[12px] text-foreground-muted">
                {PERIOD_LABELS[period]} · Uso de tokens e custo em todas as conversas do Zylara.
              </p>
            </div>
            <IconButton
              label="Atualizar estatísticas"
              size="sm"
              disabled={loading}
              onClick={() => setReloadToken((value) => value + 1)}
            >
              <RefreshCw className="size-4" />
            </IconButton>
          </div>
          <div role="group" aria-label="Período" className="flex flex-wrap items-center gap-1">
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
                {item.label}
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
                Não foi possível carregar as estatísticas.
              </p>
              <p className="mt-1 text-[11px] text-foreground-subtle">{error}</p>
              <Button className="mt-4" size="sm" onClick={() => setReloadToken((value) => value + 1)}>
                Tentar novamente
              </Button>
            </div>
          ) : !stats ? (
            <div
              role="status"
              className="flex min-h-40 items-center justify-center gap-2 text-[13px] text-foreground-muted"
            >
              <Spinner size="sm" label="Carregando estatísticas" />
              Carregando estatísticas…
            </div>
          ) : stats.totals.turns === 0 ? (
            <div className="rounded-2xl border border-border bg-surface-raised/60 px-4 py-10 text-center">
              <p className="text-[13px] font-medium text-foreground">
                Nenhum uso registrado neste período.
              </p>
              <p className="mt-1 text-[12px] text-foreground-muted">
                Converse no Chat, no Code ou com um agente para começar a registrar.
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Tokens usados"
                  value={formatUsageTokens(stats.totals.totalTokens)}
                  detail={`Entrada ${formatUsageTokens(stats.totals.inputTokens)} · Saída ${formatUsageTokens(stats.totals.outputTokens)} · Raciocínio ${formatUsageTokens(stats.totals.reasoningTokens)}`}
                />
                <StatCard
                  label="Gasto total"
                  value={formatUsageCost(stats.totals.cost)}
                  detail={
                    stats.totals.lastUsedAt
                      ? `Última atividade ${relativeTime(stats.totals.lastUsedAt)}`
                      : 'Sem atividade no período'
                  }
                />
                <StatCard
                  label="Turnos"
                  value={INTEGER_FORMAT.format(stats.totals.turns)}
                  detail={`Média de ${formatUsageTokens(
                    Math.round(stats.totals.totalTokens / Math.max(stats.totals.turns, 1)),
                  )} tokens por turno`}
                />
                <StatCard
                  label="Modelo mais usado"
                  value={topModelLabel}
                  detail={
                    topModel
                      ? `${
                          providers.find((provider) => provider.id === topModel.providerId)?.name ??
                          (topModel.providerId || 'Provedor desconhecido')
                        } · ${topModel.turns} ${
                          topModel.turns === 1 ? 'turno' : 'turnos'
                        }`
                      : 'Sem uso no período'
                  }
                />
              </div>

              <section aria-labelledby="stats-daily-heading" className="mt-8">
                <h2
                  id="stats-daily-heading"
                  className="text-base font-semibold tracking-tight text-foreground"
                >
                  Uso por dia
                </h2>
                <div className="mt-3 rounded-2xl border border-border bg-surface-raised/60 p-4">
                  {stats.byDay.length > 0 ? (
                    <ChartSvg
                      spec={{
                        type: 'bar',
                        title: 'Tokens por dia',
                        data: stats.byDay.map((row) => ({
                          label: dayLabel(row.day),
                          value: row.totalTokens,
                        })),
                      }}
                      height={200}
                    />
                  ) : (
                    <p className="py-6 text-center text-[12px] text-foreground-subtle">
                      Sem uso diário no período.
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
                    Por modelo
                  </h2>
                  <span className="text-[11px] text-foreground-subtle">
                    {stats.byModel.length === 1
                      ? '1 modelo'
                      : `${stats.byModel.length} modelos`}
                  </span>
                </div>
                {stats.byModel.length === 0 ? (
                  <p className="mt-3 text-[12px] text-foreground-subtle">Sem modelos no período.</p>
                ) : (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-border">
                    <table
                      aria-label="Uso por modelo"
                      className="w-full border-collapse text-left text-[12.5px]"
                    >
                      <thead className="bg-surface">
                        <tr>
                          <th
                            scope="col"
                            className="whitespace-nowrap border-b border-border px-3 py-2 font-semibold text-foreground"
                          >
                            Modelo
                          </th>
                          <th
                            scope="col"
                            className="whitespace-nowrap border-b border-border px-3 py-2 text-right font-semibold text-foreground"
                          >
                            Turnos
                          </th>
                          <th
                            scope="col"
                            className="whitespace-nowrap border-b border-border px-3 py-2 text-right font-semibold text-foreground"
                          >
                            Tokens
                          </th>
                          <th
                            scope="col"
                            className="whitespace-nowrap border-b border-border px-3 py-2 text-right font-semibold text-foreground"
                          >
                            Participação
                          </th>
                          <th
                            scope="col"
                            className="whitespace-nowrap border-b border-border px-3 py-2 text-right font-semibold text-foreground"
                          >
                            Custo
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
                                    'Modelo desconhecido'}
                                </span>
                                <span className="block truncate text-[11px] text-foreground-subtle">
                                  {providers.find((provider) => provider.id === row.providerId)
                                    ?.name ??
                                    (row.providerId || 'Provedor desconhecido')}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right align-top tabular-nums text-foreground-muted">
                                {INTEGER_FORMAT.format(row.turns)}
                              </td>
                              <td className="px-3 py-2 text-right align-top tabular-nums text-foreground-muted">
                                {formatUsageTokens(row.totalTokens)}
                              </td>
                              <td className="px-3 py-2 text-right align-top tabular-nums text-foreground-muted">
                                {share === null ? '—' : PERCENT_FORMAT.format(share)}
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
                Custos em dólares reportados pelos provedores; turnos sem preço não entram no
                total.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
