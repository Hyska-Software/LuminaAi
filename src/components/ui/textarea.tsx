import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

const BASE =
  'w-full resize-none rounded-xl bg-surface-hover px-3 py-2.5 text-sm leading-relaxed text-foreground ' +
  'placeholder:text-foreground-subtle ' +
  'transition-[box-shadow,background-color] duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(BASE, invalid && 'bg-danger-soft focus-visible:ring-danger/40', className)}
      {...props}
    />
  );
});
