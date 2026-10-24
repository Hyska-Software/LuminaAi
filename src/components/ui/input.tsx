import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

const BASE =
  'h-9 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-foreground ' +
  'placeholder:text-foreground-subtle ' +
  'transition-[border-color,box-shadow] duration-150 ' +
  'focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 ' +
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
      className={cn(BASE, invalid && 'border-danger focus-visible:border-danger focus-visible:ring-danger/20', className)}
      {...props}
    />
  );
});
