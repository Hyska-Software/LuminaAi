import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface NativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  wrapperClassName?: string;
}

/** Native `<select>` styled with the design tokens (accessible by default). */
export const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(function NativeSelect(
  { className, wrapperClassName, invalid, children, ...props },
  ref,
) {
  return (
    <div className={cn('relative w-full', wrapperClassName)}>
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-9 w-full appearance-none rounded-lg border border-border bg-surface-raised pl-3 pr-8 text-sm text-foreground',
          'transition-[border-color,box-shadow] duration-150',
          'focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20',
          'disabled:cursor-not-allowed disabled:opacity-60',
          invalid && 'border-danger focus-visible:border-danger',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle"
        strokeWidth={2}
      />
    </div>
  );
});
