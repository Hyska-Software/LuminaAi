import { cn } from '@/lib/utils';

export interface ProgressBarProps {
  /** 0–100. Omit (or pass null) for an indeterminate bar. */
  value?: number | null;
  max?: number;
  size?: 'xs' | 'sm' | 'md';
  tone?: 'accent' | 'foreground' | 'danger' | 'success';
  className?: string;
  label?: string;
  indeterminate?: boolean;
}

const SIZES = {
  xs: 'h-0.5',
  sm: 'h-1',
  md: 'h-1.5',
} as const;

const TONES = {
  accent: 'bg-accent',
  foreground: 'bg-foreground',
  danger: 'bg-danger',
  success: 'bg-success',
} as const;

/** Thin determinate/indeterminate progress indicator. */
export function ProgressBar({
  value,
  max = 100,
  size = 'sm',
  tone = 'accent',
  className,
  label,
  indeterminate,
}: ProgressBarProps) {
  const isIndeterminate = indeterminate ?? value == null;
  const pct =
    value == null || !Number.isFinite(value) ? 0 : Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={isIndeterminate ? undefined : 0}
      aria-valuemax={isIndeterminate ? undefined : max}
      aria-valuenow={isIndeterminate ? undefined : Math.round(value ?? 0)}
      aria-valuetext={isIndeterminate ? 'Carregando' : undefined}
      className={cn('w-full overflow-hidden rounded-full bg-surface-active', SIZES[size], className)}
    >
      {isIndeterminate ? (
        <div
          className={cn(
            'h-full w-full animate-shimmer bg-[linear-gradient(90deg,transparent_0%,var(--accent)_50%,transparent_100%)] bg-[length:200%_100%]',
            'motion-reduce:animate-none motion-reduce:bg-accent/60',
          )}
        />
      ) : (
        <div
          className={cn('h-full rounded-full transition-[width] duration-200 ease-out', TONES[tone], 'motion-reduce:transition-none')}
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  );
}
