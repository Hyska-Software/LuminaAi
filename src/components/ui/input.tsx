import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

const BASE =
  'h-9 w-full rounded-lg bg-surface-hover px-3 text-sm text-foreground ' +
  'placeholder:text-foreground-subtle ' +
  'transition-[box-shadow,background-color] duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 ' +
  'file:border-0 file:bg-transparent file:text-sm file:font-medium';

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, type = 'text', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(BASE, invalid && 'bg-danger-soft focus-visible:ring-danger/40', className)}
      {...props}
    />
  );
});
