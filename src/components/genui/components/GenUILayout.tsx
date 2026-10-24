import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { propNumber, propString, type GenUIValue } from '@/lib/genui/schema';

export interface GenUINodeProps {
  props?: Record<string, GenUIValue>;
  children?: ReactNode;
}

const CARD_VARIANTS = {
  default: 'border-border bg-surface-raised',
  accent: 'border-accent/25 bg-surface-raised',
  muted: 'border-border bg-surface',
} as const;

/** Bordered surface with optional title/subtitle/footer. */
export function GenUICard({ props, children }: GenUINodeProps) {
  const title = propString(props, 'title');
  const subtitle = propString(props, 'subtitle');
  const footer = propString(props, 'footer');
  const variantRaw = propString(props, 'variant', 'default');
  const variant =
    variantRaw === 'accent' || variantRaw === 'muted' ? variantRaw : 'default';

  return (
    <section className={cn('overflow-hidden rounded-2xl border', CARD_VARIANTS[variant])}>
      {title || subtitle ? (
        <header className="border-b border-border px-4 py-3">
          {title ? <h4 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h4> : null}
          {subtitle ? <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">{subtitle}</p> : null}
        </header>
      ) : null}
      <div className="flex flex-col gap-3 p-4">{children}</div>
      {footer ? (
        <footer className="border-t border-border px-4 py-2.5 text-[11px] text-foreground-subtle">{footer}</footer>
      ) : null}
    </section>
  );
}

const GAPS = {
  none: 'gap-0',
  sm: 'gap-1.5',
  md: 'gap-3',
  lg: 'gap-5',
} as const;

const ALIGN = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
} as const;

/** Flex container. */
export function GenUIStack({ props, children }: GenUINodeProps) {
  const direction = propString(props, 'direction', 'column') === 'row' ? 'row' : 'column';
  const gapRaw = propString(props, 'gap', 'md');
  const gap = (gapRaw in GAPS ? gapRaw : 'md') as keyof typeof GAPS;
  const alignRaw = propString(props, 'align', 'stretch');
  const align = (alignRaw in ALIGN ? alignRaw : 'stretch') as keyof typeof ALIGN;
  const wrap = propString(props, 'wrap') === 'true' || props?.wrap === true;
  const justify = propString(props, 'justify');

  return (
    <div
      className={cn(
        'flex min-w-0',
        direction === 'row' ? 'flex-row' : 'flex-col',
        GAPS[gap],
        ALIGN[align],
        wrap && 'flex-wrap',
        justify === 'center' && 'justify-center',
        justify === 'between' && 'justify-between',
        justify === 'end' && 'justify-end',
      )}
    >
      {children}
    </div>
  );
}

const GRID_COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-4',
};

/** Responsive CSS grid. */
export function GenUIGrid({ props, children }: GenUINodeProps) {
  const columns = Math.min(4, Math.max(1, Math.round(propNumber(props, 'columns', 2) ?? 2)));
  const gapRaw = propString(props, 'gap', 'md');
  const gap = (gapRaw in GAPS ? gapRaw : 'md') as keyof typeof GAPS;
  return <div className={cn('grid min-w-0', GRID_COLUMNS[columns], GAPS[gap])}>{children}</div>;
}
