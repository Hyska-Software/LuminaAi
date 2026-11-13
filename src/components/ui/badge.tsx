import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'outline';
/** `muted` is an alias of `neutral`, kept for ergonomics. */
export type BadgeTone = BadgeVariant | 'muted';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  tone?: BadgeTone;
  size?: BadgeSize;
  className?: string;
  title?: string;
}

const VARIANTS: Record<BadgeTone, string> = {
  neutral: 'bg-surface-hover text-foreground-muted',
  muted: 'bg-surface-hover text-foreground-muted',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  outline: 'bg-surface-hover text-foreground-muted',
};

const SIZES: Record<BadgeSize, string> = {
  sm: 'h-[18px] rounded px-1.5 text-[10px]',
  md: 'h-5 rounded-md px-2 text-[11px]',
};

/** Small non-interactive label used for capabilities, kinds and statuses. */
export function Badge({ children, variant, tone, size = 'sm', className, title }: BadgeProps) {
  const resolved: BadgeTone = tone ?? variant ?? 'neutral';
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium leading-none tracking-tight',
        VARIANTS[resolved],
        SIZES[size],
        className,
      )}
    >
      {children}
    </span>
  );
}
