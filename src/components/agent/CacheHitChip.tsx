/**
 * Indicador de cache de prompt em tempo real (docs/goals/prompt-cache/PLAN.md §7,
 * docs/research/cache-audit-ui.md §4).
 *
 * O backend é dono da verdade: `cache_stats` chega uma vez por request de wire e
 * `get_cache_stats` restaura o agregado ao reabrir a conversa. Este arquivo só
 * projeta esses fatos (`CacheConversationUi`) em UI — nunca recalcula hit% a
 * partir de estimativas locais. Quando o provedor não reporta cache, mostra `—`,
 * nunca `0%`.
 *
 * As três peças são reaproveitadas pelos dois layouts:
 * - `CacheHitChip`: chip cache-first do composer do Chat (com popover próprio);
 * - `CacheChipSegment`: segmento `Zap + %` do chip dentro do `ContextMeter` (Code);
 * - `CacheDiagnostics`: corpo do painel de diagnóstico (compartilhado pelos dois).
 */
import { useId, type ReactNode } from 'react';
import { Zap } from 'lucide-react';
import { toast } from 'sonner';

import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui';
import { cacheBreakLabel, cacheStateMeta, formatCacheHit } from '@/lib/cache';
import type { CacheConversationUi } from '@/lib/store/cacheStore';
import type { CacheBreakReason, CacheSample, CacheState, CacheStats } from '@/lib/types';
import { cn, copyText, formatCost, formatTokens, relativeTime } from '@/lib/utils';
import { formatCacheTtl } from './cacheDiagnostics';
import { requestCacheDiagnostics } from './cacheDiagnosticsRequest';

type CacheTone = 'success' | 'warning' | 'danger' | 'muted' | 'accent';

const TONE_CLASSES: Record<CacheTone, { icon: string; dot: string }> = {
  success: { icon: 'text-success', dot: 'bg-success' },
  warning: { icon: 'text-warning', dot: 'bg-warning' },
  danger: { icon: 'text-danger', dot: 'bg-danger' },
  muted: { icon: 'text-foreground-subtle', dot: 'bg-foreground-subtle' },
  accent: { icon: 'text-accent', dot: 'bg-accent' },
};

/** Frases de motivo da queda (textos de `cache-audit-ui.md` §4.5). */
const BREAK_SENTENCES: Record<CacheBreakReason, string> = {
  first_request: 'o primeiro request do epoch',
  system_prompt: 'o prompt de sistema mudou',
  tool_definitions: 'as definições de ferramentas mudaram',
  history_rewrite: 'o histórico foi reescrito',
  head_trim: 'o histórico antigo foi cortado',
  compaction: 'o contexto foi compactado',
  model_switch: 'o modelo ou o provedor mudou',
  protocol_fallback: 'o protocolo de wire mudou',
  attachments: 'os anexos mudaram',
  config_change: 'a configuração mudou',
  ttl_expired: 'o cache expirou pelo TTL',
  provider_policy: 'a regra do provedor impede o reaproveitamento',
};

/** Projeção de UI do store (campos ausentes degradam para `—`). */
interface CacheView {
  current: CacheStats | null;
  session: CacheStats | null;
  hit: number | null;
  state: CacheState | null;
  read: number;
  write: number;
  uncached: number;
  inputTotal: number;
  samples: number;
  ceiling: number | null;
  sessionHit: number | null;
  steadyHit: number | null;
  ttlSeconds: number | null;
  savingsUsd: number | null;
  breakReason: CacheBreakReason | null;
  breakLabel: string | null;
  previousHit: number | null;
  sample: CacheSample | null;
}

function cacheView(cache: CacheConversationUi | null | undefined): CacheView {
  const current = cache?.current ?? cache?.session ?? null;
  const session = cache?.session ?? null;
  const samples = cache?.samples ?? [];
  const sample = samples.length > 0 ? samples[samples.length - 1] : null;
  const previous = samples.length >= 2 ? samples[samples.length - 2] : null;
  const breakReason = current?.breakReason ?? null;
  return {
    current,
    session,
    hit: current?.hitPercent ?? null,
    state: current?.state ?? null,
    read: current?.cacheRead ?? 0,
    write: current?.cacheWrite ?? 0,
    uncached: current?.uncached ?? 0,
    inputTotal: current?.inputTotal ?? 0,
    samples: current?.samples ?? session?.samples ?? samples.length,
    ceiling: current?.ceilingPercent ?? null,
    sessionHit: session?.sessionHitPercent ?? current?.sessionHitPercent ?? null,
    steadyHit: session?.steadyHitPercent ?? current?.steadyHitPercent ?? null,
    ttlSeconds: current?.ttlSeconds ?? session?.ttlSeconds ?? null,
    savingsUsd: current?.savingsUsd ?? session?.savingsUsd ?? null,
    breakReason,
    breakLabel: cacheBreakLabel(breakReason) ?? cache?.lastBreak?.reason ?? null,
    previousHit: previous?.hitPercent ?? null,
    sample,
  };
}

/** Backend `degraded` significa que o prefixo caiu: tom de alerta, não de aquecimento. */
function toneFor(state: CacheState | null, hit: number | null): CacheTone {
  if (state === 'degraded') return 'danger';
  if (state == null) return hit == null ? 'muted' : 'accent';
  return cacheStateMeta(state).tone;
}

/**
 * Nome acessível do gatilho. O `%` é sempre o reportado pelo provedor; sem
 * reporte o nome é honesto (`sem dados`) em vez de inventar `0%`.
 */
export function cacheAriaLabel(cache: CacheConversationUi | null | undefined): string {
  const view = cacheView(cache);
  if (view.hit != null) return `Cache de prompt: ${formatCacheHit(view.hit)} de acerto`;
  if (cache == null) return 'Cache de prompt: aguardando a primeira amostra';
  if (view.state === 'warming' || view.state === 'cold') return 'Cache de prompt: aquecendo';
  return 'Cache de prompt: sem dados';
}

/** Descrição `aria-describedby` do chip (textos de `cache-audit-ui.md` §4.7). */
export function cacheStateSentence(cache: CacheConversationUi | null | undefined): string {
  const view = cacheView(cache);
  if (view.state === 'unsupported') return 'Cache de prompt: sem dados neste provedor.';
  if (view.state === 'provider_policy') {
    return 'Cache de prompt: política do provedor impede o reaproveitamento.';
  }
  if (view.state === 'warming') return 'Cache de prompt: aquecendo.';
  if (cache == null) return 'Cache de prompt: aguardando a primeira amostra.';
  if (view.hit == null) return 'Cache de prompt: sem dados neste provedor.';
  if (view.state === 'degraded') return `Cache de prompt: ${formatCacheHit(view.hit)} de acerto — caiu.`;
  if (view.state === 'stable') return `Cache de prompt: ${formatCacheHit(view.hit)} de acerto — estável.`;
  if (view.state === 'cold') {
    return `Cache de prompt: ${formatCacheHit(view.hit)} de acerto — primeiro request do epoch.`;
  }
  return `Cache de prompt: ${formatCacheHit(view.hit)} de acerto.`;
}

/** Nota honesta de estado (`role="status"`); `null` quando não há o que explicar. */
function cacheStatusNote(cache: CacheConversationUi | null | undefined): string | null {
  const view = cacheView(cache);
  switch (view.state) {
    case 'unsupported':
      return 'Este provedor não informa detalhes de cache nesta execução.';
    case 'provider_policy':
      return 'O provedor não reutiliza este request por regra própria de cache.';
    case 'cold':
      return 'Primeiro request do epoch: ainda não há prefixo para reutilizar.';
    case 'warming':
      return 'Aquecendo o cache: o primeiro request grava o prefixo e o acerto aparece no próximo passo.';
    case 'degraded': {
      const from = view.previousHit;
      const to = view.hit;
      const range =
        from != null && to != null && from > to
          ? ` de ${Math.round(from)}% para ${Math.round(to)}%`
          : '';
      const reason =
        (view.breakReason ? BREAK_SENTENCES[view.breakReason] : null) ?? 'motivo não identificado';
      return `Cache caiu${range} neste passo. Motivo: ${reason}.`;
    }
    default:
      if (view.hit == null) {
        return cache == null
          ? 'Sem amostras ainda. O acerto de cache aparece depois do primeiro passo.'
          : 'Este provedor não informa detalhes de cache nesta execução.';
      }
      return null;
  }
}

function CacheRow({
  label,
  value,
  title,
}: {
  label: string;
  value: ReactNode;
  title?: string;
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 text-[11px] leading-snug">
      <span className="min-w-0 truncate text-foreground-muted">{label}</span>
      <span className="shrink-0 tabular-nums text-foreground-muted" title={title}>
        {value}
      </span>
    </div>
  );
}

/**
 * Segmento `divisor + Zap + cache%` do gatilho do `ContextMeter` (Code).
 * Larguras fixas para o número não deslocar o anel de contexto.
 */
export function CacheChipSegment({
  cache,
}: {
  cache: CacheConversationUi | null | undefined;
}) {
  const view = cacheView(cache);
  const tone = TONE_CLASSES[toneFor(view.state, view.hit)];
  return (
    <>
      <span aria-hidden className="h-3 w-px shrink-0 bg-border" />
      <span
        aria-hidden
        className="flex w-11 shrink-0 items-center justify-end gap-0.5 tabular-nums"
      >
        <Zap className={cn('size-3 shrink-0', tone.icon)} strokeWidth={2} />
        <span className={cn(view.hit == null && 'text-foreground-subtle')}>
          {formatCacheHit(view.hit)}
        </span>
      </span>
    </>
  );
}

export interface CacheDiagnosticsProps {
  cache: CacheConversationUi | null;
  className?: string;
}

/**
 * Corpo do painel "Cache de prompt": hit do último request, teto, barra
 * lido/gravado/novo, acumulado da sessão, estado, última quebra, TTL, economia,
 * nº de amostras e "Copiar usage bruto". Sem ícones: o popover do medidor não
 * deve ganhar SVGs (teste de a11y existente) — o estado usa ponto + texto.
 */
export function CacheDiagnostics({ cache, className }: CacheDiagnosticsProps) {
  const view = cacheView(cache);
  const tone = TONE_CLASSES[toneFor(view.state, view.hit)];
  const meta = cacheStateMeta(view.state);
  const note = cacheStatusNote(cache);
  const hitLabel = view.hit != null ? `${Math.round(view.hit)}% de acerto` : 'sem dados';
  const measured =
    view.inputTotal > 0 || view.read > 0 || view.write > 0 || view.uncached > 0;
  const total = view.inputTotal > 0 ? view.inputTotal : view.read + view.write + view.uncached;
  const segments =
    total > 0
      ? [
          { key: 'read', value: view.read, className: 'bg-success' },
          { key: 'write', value: view.write, className: 'bg-accent' },
          { key: 'uncached', value: view.uncached, className: 'bg-context-system' },
        ]
          .filter((segment) => segment.value > 0)
          .map((segment) => ({ ...segment, width: (segment.value / total) * 100 }))
      : [];
  const sessionLabel =
    view.sessionHit != null
      ? `${Math.round(view.sessionHit)}% em ${view.samples} ${view.samples === 1 ? 'passo' : 'passos'}`
      : '—';
  const rawUsage = view.sample?.rawUsage;
  const hasRawUsage = rawUsage !== undefined && rawUsage !== null;

  const copyRawUsage = async () => {
    if (!hasRawUsage) return;
    const ok = await copyText(JSON.stringify(rawUsage, null, 2));
    if (ok) toast.success('Usage bruto copiado');
    else toast.error('Não foi possível copiar o usage');
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-[13px] font-semibold text-foreground">Cache de prompt</p>
        <p className="shrink-0 tabular-nums text-[11px] text-foreground-muted">{hitLabel}</p>
      </div>

      <div
        role="progressbar"
        aria-label="Acerto do cache de prompt"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view.hit != null ? Math.round(view.hit) : undefined}
        aria-valuetext={
          view.hit != null
            ? `${Math.round(view.hit)}% de acerto no cache`
            : 'acerto de cache não reportado'
        }
        title="Acerto = tokens lidos do cache ÷ tokens de entrada do request"
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-active"
      >
        {segments.map((segment) => (
          <div
            key={segment.key}
            aria-hidden
            className={cn(
              'h-full transition-[width] duration-300 ease-out motion-reduce:transition-none',
              segment.className,
            )}
            style={{ width: `${segment.width.toFixed(1)}%` }}
          />
        ))}
      </div>

      <CacheRow label="Lido do cache" value={measured ? formatTokens(view.read) : '—'} />
      <CacheRow label="Gravado no cache" value={view.write > 0 ? formatTokens(view.write) : '—'} />
      <CacheRow label="Sem cache" value={measured ? formatTokens(view.uncached) : '—'} />
      <CacheRow label="Acumulado da sessão" value={sessionLabel} />
      <CacheRow
        label="Acerto estável"
        value={view.steadyHit != null ? formatCacheHit(view.steadyHit) : '—'}
      />
      <CacheRow
        label="Teto deste request"
        value={view.ceiling != null ? formatCacheHit(view.ceiling) : '—'}
        title="Teto teórico P/(P+Δ) deste request"
      />
      <div className="flex min-w-0 items-baseline justify-between gap-3 text-[11px] leading-snug">
        <span className="min-w-0 truncate text-foreground-muted">Estado</span>
        <span className="flex shrink-0 items-center gap-1.5 text-foreground">
          <span aria-hidden className={cn('size-2 rounded-full', tone.dot)} />
          {meta.label}
        </span>
      </div>
      <CacheRow
        label="Última amostra"
        value={
          view.sample
            ? `passo ${view.sample.step} · ${relativeTime(view.sample.at)}`
            : '—'
        }
      />
      {view.breakLabel ? <CacheRow label="Última quebra" value={view.breakLabel} /> : null}
      <CacheRow label="TTL" value={formatCacheTtl(view.ttlSeconds)} />
      {view.savingsUsd != null ? (
        <CacheRow label="Economia estimada" value={formatCost(view.savingsUsd)} />
      ) : null}

      {note ? (
        <p role="status" className="text-[11px] leading-snug text-foreground-muted">
          {note}
        </p>
      ) : null}

      <p className="text-[10.5px] leading-snug text-foreground-subtle">
        Acerto = tokens lidos do cache ÷ tokens de entrada do passo.
      </p>

      <div className="flex flex-col gap-1 border-t border-border pt-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="tabular-nums text-[11px] text-foreground-subtle">
            {view.samples} {view.samples === 1 ? 'amostra' : 'amostras'}
          </span>
          {hasRawUsage ? (
            <button
              type="button"
              onClick={() => void copyRawUsage()}
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[11px] font-medium text-foreground-muted',
                'transition-colors duration-150 hover:bg-surface-hover hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              )}
            >
              Copiar usage bruto
            </button>
          ) : null}
        </div>
        <PopoverClose asChild>
          <button
            type="button"
            onClick={() => window.setTimeout(requestCacheDiagnostics, 0)}
            className={cn(
              'self-start rounded-md px-1.5 py-0.5 text-[11px] font-medium text-accent',
              'transition-colors duration-150 hover:bg-accent-soft',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            )}
          >
            Ver diagnóstico completo
          </button>
        </PopoverClose>
      </div>
    </div>
  );
}

export interface CacheHitChipProps {
  cache: CacheConversationUi | null;
  className?: string;
}

/**
 * Chip cache-first do composer do Chat: `Zap + cache NN%` (ou `—`) que abre o
 * painel de diagnóstico. Quando o provedor reporta cache, o número é o do
 * último request de wire; antes da primeira amostra o chip mostra `—` e a nota
 * explica que o dado só existe depois do primeiro passo.
 */
export function CacheHitChip({ cache, className }: CacheHitChipProps) {
  const descriptionId = useId();
  const view = cacheView(cache);
  const tone = TONE_CLASSES[toneFor(view.state, view.hit)];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={cacheAriaLabel(cache)}
          aria-describedby={descriptionId}
          className={cn(
            'flex h-8 min-w-[5.5rem] shrink-0 items-center justify-center gap-1 rounded-full border border-border px-2',
            'text-[11px] font-medium tabular-nums text-foreground-muted',
            'transition-colors duration-150 hover:bg-surface-hover hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            className,
          )}
        >
          <Zap aria-hidden className={cn('size-3 shrink-0', tone.icon)} strokeWidth={2} />
          <span aria-hidden className="text-foreground-subtle">
            cache
          </span>
          <span className={cn('tabular-nums', view.hit == null && 'text-foreground-subtle')}>
            {formatCacheHit(view.hit)}
          </span>
          <span id={descriptionId} className="sr-only">
            {cacheStateSentence(cache)}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        aria-label="Detalhes do cache de prompt"
        className="w-72 p-3 shadow-lg"
      >
        <CacheDiagnostics cache={cache} />
      </PopoverContent>
    </Popover>
  );
}
