/**
 * Painel de diagnóstico de cache de prompt (F5.4 do PLAN; docs/research/cache-audit-ui.md §4).
 *
 * Aberto pela paleta de comandos ("Diagnóstico de cache") ou pelo botão
 * "Ver diagnóstico completo" do popover do chip/medidor. Restaura o snapshot
 * autoritativo com `api.getCacheStats` ao abrir e passa a refletir o
 * `cacheStore` ao vivo (evento `cache_stats` por request) — o backend continua
 * sendo o dono do hit%, aqui só projetamos.
 *
 * O dialog é montado pelo host persistente (`CommandPalette`, sempre presente no
 * App); o pedido chega por `requestCacheDiagnostics()` (evento de janela).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, Copy, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@/components/ui';
import { api } from '@/lib/api';
import { cacheBreakLabel, cacheStateMeta, formatCacheHit } from '@/lib/cache';
import { useAppStore, useChatStore } from '@/lib/store';
import { useCacheStore } from '@/lib/store/cacheStore';
import type { CacheSample, CacheStatsView } from '@/lib/types';
import { cn, copyText, formatTokens, relativeTime } from '@/lib/utils';
import {
  buildCacheDiagnostics,
  cacheStateBadgeTone,
  formatCacheTtl,
  type CacheDiagnosticsView,
} from './cacheDiagnostics';

/** Últimas amostras pedidas ao backend (o mesmo teto prático do store). */
const SAMPLE_LIMIT = 50;

function SummaryItem({
  label,
  value,
  title,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  title?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[10px] uppercase tracking-wider text-foreground-subtle">{label}</dt>
      <dd
        className={cn(
          'min-w-0 truncate text-[13px] font-medium text-foreground',
          mono && 'font-mono text-[12px]',
        )}
        title={title}
      >
        {value}
      </dd>
    </div>
  );
}

function SampleBreakLabel({ sample }: { sample: CacheSample }) {
  const label = cacheBreakLabel(sample.breakReason ?? null);
  if (!label) return <span className="text-foreground-subtle">—</span>;
  return (
    <span className="text-foreground-muted" title={sample.breakDetail ?? undefined}>
      {label}
    </span>
  );
}

const SAMPLE_HEADERS = [
  'Passo',
  'Lido',
  'Gravado',
  'Novo',
  'Cache hit',
  'Teto',
  'Estado',
  'Motivo',
] as const;

function SamplesTable({ diagnostics }: { diagnostics: CacheDiagnosticsView }) {
  if (diagnostics.samples.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface px-4 py-5 text-center">
        <p className="text-[12px] font-medium text-foreground">
          Sem amostras de cache nesta conversa
        </p>
        <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-foreground-muted">
          O provedor ainda não reportou usage de cache ou nenhum request foi concluído. O número
          aparece depois do primeiro request do turno.
        </p>
      </div>
    );
  }

  // Mais recente primeiro: diagnóstico se lê de cima para baixo.
  const rows = [...diagnostics.samples].reverse();
  return (
    <>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-left text-[11px]">
          <caption className="sr-only">Amostras recentes de cache</caption>
          <thead className="sticky top-0 bg-surface">
            <tr className="text-[10px] uppercase tracking-wider text-foreground-subtle">
              {SAMPLE_HEADERS.map((header) => (
                <th key={header} scope="col" className="whitespace-nowrap px-2 py-1.5 font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((sample, index) => (
              <tr key={`${sample.turnId}-${sample.step}-${sample.at}-${index}`}>
                <th
                  scope="row"
                  className="whitespace-nowrap px-2 py-1.5 text-left font-medium tabular-nums text-foreground"
                  title={new Date(sample.at).toLocaleString('pt-BR')}
                >
                  {sample.step}
                </th>
                <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-foreground-muted">
                  {formatTokens(sample.cacheRead)}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-foreground-muted">
                  {sample.cacheWrite > 0 ? formatTokens(sample.cacheWrite) : '—'}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-foreground-muted">
                  {formatTokens(sample.uncached)}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-foreground-muted">
                  {formatCacheHit(sample.hitPercent)}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-foreground-muted">
                  {formatCacheHit(sample.ceilingPercent)}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-foreground-muted">
                  {cacheStateMeta(sample.state).label}
                </td>
                <td className="max-w-[190px] truncate px-2 py-1.5">
                  <SampleBreakLabel sample={sample} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[10.5px] leading-snug text-foreground-subtle">
        Acerto = tokens lidos do cache ÷ tokens de entrada do request. Números reportados pelo
        provedor, não estimativas locais.
      </p>
    </>
  );
}

function BreaksSection({ diagnostics }: { diagnostics: CacheDiagnosticsView }) {
  const last = diagnostics.lastBreak;
  const previous = diagnostics.breaks.slice(1);
  return (
    <section aria-labelledby="cache-diagnostics-breaks">
      <h3
        id="cache-diagnostics-breaks"
        className="mb-2 text-[13px] font-semibold text-foreground"
      >
        Quebras recentes
      </h3>
      {!last ? (
        <p className="text-[11px] leading-relaxed text-foreground-muted">
          Nenhuma quebra de prefixo registrada nas amostras recentes.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
              <span className="font-medium text-foreground">{last.label}</span>
              <span className="tabular-nums text-foreground-subtle">
                passo {last.step} · {relativeTime(last.at)}
              </span>
            </div>
            {last.detail ? (
              <p className="mt-1 break-words text-[11px] leading-relaxed text-foreground-muted">
                {last.detail}
              </p>
            ) : null}
          </div>
          {previous.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
              {previous.map((entry, index) => (
                <li
                  key={`${entry.at}-${entry.step}-${index}`}
                  className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5 text-[11px] text-foreground-muted"
                >
                  <span className="font-medium text-foreground">{entry.label}</span>
                  <span className="tabular-nums text-foreground-subtle">
                    passo {entry.step} · {relativeTime(entry.at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}

export interface CacheDiagnosticsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CacheDiagnosticsDialog({ open, onOpenChange }: CacheDiagnosticsDialogProps) {
  const conversationId = useChatStore((state) => state.activeId);
  const conversation = useChatStore((state) =>
    state.conversations.find((entry) => entry.id === state.activeId),
  );
  const providers = useAppStore((state) => state.providers);
  const live = useCacheStore((state) =>
    conversationId ? (state.byConversation[conversationId] ?? null) : null,
  );

  const [view, setView] = useState<CacheStatsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!open) return;
    // Não mostre números de outra conversa enquanto o snapshot carrega.
    setView(null);
    setError(null);
    if (!conversationId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .getCacheStats(conversationId, SAMPLE_LIMIT)
      .then((next) => {
        if (cancelled) return;
        setView(next);
        // Alimenta o mesmo store do chip (restauração autoritativa + live).
        useCacheStore.getState().seed(conversationId, next);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        toast.error('Não foi possível carregar o diagnóstico de cache', {
          description: message,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, conversationId, reloadToken]);

  const diagnostics = useMemo(
    () =>
      buildCacheDiagnostics({
        view,
        live,
        fallbackProviderId: conversation?.providerId ?? null,
        fallbackModelId: conversation?.modelId ?? null,
      }),
    [view, live, conversation?.providerId, conversation?.modelId],
  );

  const meta = cacheStateMeta(diagnostics.state);
  const providerLabel =
    providers.find((provider) => provider.id === diagnostics.providerId)?.shortName ??
    diagnostics.providerId ??
    '—';

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  const copyJson = async () => {
    const payload = {
      conversationId,
      generatedAt: new Date().toISOString(),
      providerId: diagnostics.providerId,
      modelId: diagnostics.modelId,
      protocol: diagnostics.protocol,
      epoch: diagnostics.epoch,
      hitPercent: diagnostics.hit,
      sessionHitPercent: diagnostics.sessionHit,
      steadyHitPercent: diagnostics.steadyHit,
      ceilingPercent: diagnostics.ceiling,
      ttlSeconds: diagnostics.ttlSeconds,
      minCacheableTokens: diagnostics.minCacheableTokens,
      current: diagnostics.current,
      session: diagnostics.session,
      lastBreak: diagnostics.lastBreak,
      breaks: diagnostics.breaks,
      rawUsage: diagnostics.latest?.rawUsage ?? null,
      samples: diagnostics.samples,
    };
    const ok = await copyText(JSON.stringify(payload, null, 2));
    if (ok) toast.success('Diagnóstico de cache copiado');
    else toast.error('Não foi possível copiar o diagnóstico');
  };

  const emptyConversation = !conversationId;
  const initialLoading = loading && !diagnostics.hasData;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity aria-hidden className="size-4 shrink-0 text-accent" strokeWidth={2} />
            Diagnóstico de cache
          </DialogTitle>
          <DialogDescription>
            Amostras por request, quebras de prefixo e usage bruto da conversa ativa.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          {emptyConversation ? (
            <div className="rounded-xl border border-border bg-surface px-4 py-5 text-center">
              <p className="text-[12px] font-medium text-foreground">Nenhuma conversa aberta</p>
              <p className="mt-1 text-[11px] leading-relaxed text-foreground-muted">
                Abra uma conversa para ver as amostras de cache e o diagnóstico de prefixo.
              </p>
            </div>
          ) : initialLoading ? (
            <div
              role="status"
              className="flex items-center gap-2 py-8 text-xs text-foreground-muted"
            >
              <Spinner
                size="sm"
                className="text-accent"
                label="Carregando diagnóstico de cache"
              />
              Carregando diagnóstico…
            </div>
          ) : error && !diagnostics.hasData ? (
            <div className="rounded-xl border border-danger/30 bg-danger-soft p-3">
              <p className="text-[12px] font-medium text-foreground">
                Não foi possível carregar o diagnóstico de cache
              </p>
              <p className="mt-0.5 break-words text-[11px] leading-relaxed text-foreground-muted">
                {error}
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                loading={loading}
                onClick={reload}
              >
                Tentar novamente
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {error ? (
                <div
                  role="status"
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[11px] text-foreground-muted"
                >
                  Não foi possível atualizar pelo backend; exibindo os dados ao vivo.
                  <button
                    type="button"
                    onClick={reload}
                    className="font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : null}

              {!diagnostics.hasData ? (
                <div className="rounded-xl border border-border bg-surface px-4 py-5 text-center">
                  <p className="text-[12px] font-medium text-foreground">
                    Sem amostras de cache nesta conversa
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-foreground-muted">
                    O provedor ainda não reportou usage de cache ou nenhum request foi concluído. O
                    número aparece depois do primeiro request do turno.
                  </p>
                </div>
              ) : (
                <>
                  <section aria-labelledby="cache-diagnostics-summary">
                    <h3
                      id="cache-diagnostics-summary"
                      className="mb-2 text-[13px] font-semibold text-foreground"
                    >
                      Resumo
                    </h3>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                      <SummaryItem
                        label="Provedor"
                        value={providerLabel}
                        title={diagnostics.providerId ?? undefined}
                      />
                      <SummaryItem
                        label="Modelo"
                        value={diagnostics.modelId ?? '—'}
                        title={diagnostics.modelId ?? undefined}
                        mono
                      />
                      <SummaryItem
                        label="Protocolo"
                        value={diagnostics.protocol ?? '—'}
                        title={diagnostics.protocol ?? undefined}
                        mono
                      />
                      <SummaryItem label="Epoch" value={`#${diagnostics.epoch}`} />
                      <SummaryItem
                        label="Último request"
                        value={formatCacheHit(diagnostics.hit)}
                      />
                      <SummaryItem
                        label="Sessão (ponderada)"
                        value={formatCacheHit(diagnostics.sessionHit)}
                      />
                      <SummaryItem
                        label="Acerto estável"
                        value={formatCacheHit(diagnostics.steadyHit)}
                      />
                      <SummaryItem
                        label="Teto do request"
                        value={formatCacheHit(diagnostics.ceiling)}
                      />
                      <SummaryItem label="TTL" value={formatCacheTtl(diagnostics.ttlSeconds)} />
                      <SummaryItem
                        label="Mínimo cacheável"
                        value={
                          diagnostics.minCacheableTokens != null
                            ? `~${formatTokens(diagnostics.minCacheableTokens)}`
                            : '—'
                        }
                      />
                      <SummaryItem
                        label="Amostras"
                        value={`${Math.max(diagnostics.totalSamples, diagnostics.samples.length)}`}
                      />
                      <SummaryItem
                        label="Estado"
                        value={
                          <Badge tone={cacheStateBadgeTone(diagnostics.state)}>
                            {meta.label}
                          </Badge>
                        }
                      />
                    </dl>
                  </section>

                  <BreaksSection diagnostics={diagnostics} />

                  <section aria-labelledby="cache-diagnostics-samples">
                    <h3
                      id="cache-diagnostics-samples"
                      className="mb-2 text-[13px] font-semibold text-foreground"
                    >
                      Amostras recentes
                    </h3>
                    <SamplesTable diagnostics={diagnostics} />
                  </section>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            size="sm"
            variant="ghost"
            loading={loading}
            disabled={emptyConversation}
            onClick={reload}
            leftIcon={<RefreshCw aria-hidden className="size-3.5" />}
          >
            Atualizar
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={emptyConversation}
            onClick={() => void copyJson()}
            leftIcon={<Copy aria-hidden className="size-3.5" />}
          >
            Copiar JSON
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
