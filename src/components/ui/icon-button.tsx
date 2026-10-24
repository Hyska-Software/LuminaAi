import * as React from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';
import { buttonVariants, type ButtonVariant } from './button';

export type IconButtonSize = 'sm' | 'md' | 'lg';

const SIZES: Record<IconButtonSize, string> = {
  sm: 'size-8 rounded-lg',
  md: 'size-9 rounded-lg',
  lg: 'size-10 rounded-xl',
};

const BASE =
  'relative inline-flex shrink-0 select-none items-center justify-center ' +
  'transition-[color,background-color,border-color,opacity] duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
  'disabled:pointer-events-none disabled:opacity-50 ' +
  '[&_svg]:pointer-events-none [&_svg]:shrink-0 motion-reduce:transition-none';

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required accessible name. */
  label: string;
  variant?: ButtonVariant;
  size?: IconButtonSize;
  active?: boolean;
  loading?: boolean;
  tooltip?: boolean;
}

/** Square button whose only content is an icon. `label` is mandatory (aria-label). */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', size = 'md', active = false, loading = false, className, disabled, children, type, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      title={props.title}
      aria-pressed={active || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        BASE,
        buttonVariants[variant],
        SIZES[size],
        active && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
        className,
      )}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : children}
    </button>
  );
});
