import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';

export interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
  /** Accessible label. Omit to render the spinner as decorative. */
  label?: string;
}

const SIZES: Record<SpinnerSize, string> = {
  xs: 'size-3',
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-6',
};

/** Indeterminate loading indicator. */
export function Spinner({ size = 'sm', className, label }: SpinnerProps) {
  return (
    <LoaderCircle
      strokeWidth={2}
      className={cn('shrink-0 animate-spin text-current motion-reduce:animate-none', SIZES[size], className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'status' : undefined}
    />
  );
}
