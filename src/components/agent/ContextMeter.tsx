import { Gauge } from 'lucide-react';
import type { ContextStats } from '@/lib/types';
import { cn, formatTokens } from '@/lib/utils';

export interface ContextMeterProps {
  stats: ContextStats;
  /** Mensagens resumidas na última compactação (quando o host souber). */
  compacted?: number | null;
  className?: string;
}

interface Tier {
  label: string;
  bar: string;
  text: string;
}

const TIERS: Record<'ok' | 'warning' | 'critical', Tier> = {
  ok: { label: 'ok', bar: 'bg-success', text: 'text-foreground-muted' },
  warning: { label: 'atenção', bar: 'bg-warning', text: 'text-warning' },
  critical: { label: 'compactando', bar: 'bg-danger', text: 'text-danger' },
};

function tierFor(percent: number): Tier {
  if (percent >= 90) return TIERS.critical;
  if (percent >= 70) return TIERS.warning;
  return TIERS.ok;
}

/**
 * Medidor de contexto (WORKBENCH §4/§9): percentual usado da janela, tokens e
 * aviso de compactação. Cor indica a faixa, mas o rótulo textual acompanha.
 */
export function ContextMeter({ stats, compacted, className }: ContextMeterProps) {
  const percent = Number.isFinite(stats.percent)
    ? Math.min(100, Math.max(0, Math.round(stats.percent)))
    : 0;
  const tier = tierFor(percent);
  const compactedCount = compacted ?? stats.compacted ?? 0;
  const compactedNote =
    compactedCount > 0
      ? `Contexto compactado · ${compactedCount} mensage${compactedCount === 1 ? 'm' : 'ns'} resumida${compactedCount === 1 ? '' : 's'}`
      : null;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center gap-2">
        <Gauge aria-hidden className="size-3.5 shrink-0 text-foreground-subtle" />
        <span className="min-w-0 flex-1 text-[11px] font-medium text-foreground-muted">Contexto</span>
        <span className={cn('text-[11px] font-medium tabular-nums', tier.text)}>
          {percent}%
          <span className="sr-only"> — {tier.label}</span>
        </span>
        <span className="text-[11px] tabular-nums text-foreground-subtle">
          {formatTokens(stats.used)} / {formatTokens(stats.window)}
        </span>
      </div>

      <div
        role="progressbar"
        aria-label="Contexto usado"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% do contexto usado — ${tier.label}`}
        title={`Limite de saída: ${formatTokens(stats.outputCap)} tokens`}
        className="h-1 w-full overflow-hidden rounded-full bg-surface-active"
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-200 ease-out', tier.bar, 'motion-reduce:transition-none')}
          style={{ width: `${percent}%` }}
        />
      </div>

      {compactedNote ? (
        <p className="text-[11px] leading-snug text-foreground-subtle" role="status">
          {compactedNote}
        </p>
      ) : null}
    </div>
  );
}
