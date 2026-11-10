import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseChartSpec } from '@/lib/genui/schema';
import { ChartSvg } from './ChartSvg';
import { CodeBlock } from './CodeBlock';

export interface ChartBlockProps {
  /** JSON payload of the chart (preferred prop name). */
  spec?: string;
  /** Alias kept for compatibility with markdown renderers. */
  code?: string;
  title?: string;
  className?: string;
}

/**
 * Renders ` ```chart ` fenced blocks: `{ "type": "bar"|"line"|"pie",
 * "data": [{ "label": "...", "value": 1 }] }`.
 */
export function ChartBlock({ spec, code, title, className }: ChartBlockProps) {
  const { t } = useTranslation('genui');
  const source = spec ?? code ?? '';
  const { chart, error } = useMemo(() => parseChartSpec(source), [source]);

  if (!chart) {
    return (
      <div className={cn('my-3 flex flex-col gap-2', className)}>
        <CodeBlock code={source.trim()} language="json" title={title ?? t('chart.titleFallback')} maxHeight={320} />
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-foreground-subtle">
          <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>{error ?? t('chart.parseError')}</span>
        </p>
      </div>
    );
  }

  const heading = title ?? chart.title;

  return (
    <div className={cn('my-3 rounded-2xl border border-border bg-surface-raised p-4', className)}>
      {heading ? (
        <h4 className="mb-3 text-[13px] font-semibold tracking-tight text-foreground">{heading}</h4>
      ) : null}
      <ChartSvg spec={chart} />
    </div>
  );
}
