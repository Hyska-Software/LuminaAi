import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'subtle' | 'danger' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'icon' | 'icon-sm';

export const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-foreground text-background hover:bg-foreground/90 active:bg-foreground/85',
  secondary:
    'bg-surface-hover text-foreground hover:bg-surface-active',
  ghost: 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
  subtle: 'bg-surface-hover text-foreground hover:bg-surface-active',
  danger: 'bg-danger text-accent-foreground hover:bg-danger/90 active:bg-danger/85',
  outline:
    'bg-transparent text-foreground hover:bg-surface-hover',
};

export const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-lg px-2.5 text-[13px]',
  md: 'h-9 gap-2 rounded-lg px-3.5 text-sm',
  icon: 'size-9 rounded-lg p-0',
  'icon-sm': 'size-8 rounded-lg p-0',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and marks the button as busy. */
  loading?: boolean;
  /** Renders the child element instead of a `<button>` (Radix Slot). */
  asChild?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const BASE =
  'relative inline-flex shrink-0 select-none items-center justify-center font-medium tracking-tight ' +
  'transition-[color,background-color,opacity] duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
  'disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress ' +
  '[&_svg]:pointer-events-none [&_svg]:shrink-0 motion-reduce:transition-none';

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'secondary',
    size = 'md',
    loading = false,
    asChild = false,
    leftIcon,
    rightIcon,
    disabled,
    children,
    type,
    ...props
  },
  ref,
) {
  const classes = cn(BASE, buttonVariants[variant], buttonSizes[size], className);
  const content = (
    <>
      {loading ? <Spinner size={size === 'sm' || size === 'icon-sm' ? 'xs' : 'sm'} /> : leftIcon}
      {children}
      {rightIcon}
    </>
  );

  if (asChild) {
    return (
      <Slot ref={ref} className={classes} aria-busy={loading || undefined} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {content}
    </button>
  );
});
