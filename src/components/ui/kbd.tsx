import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface KbdProps {
  children: ReactNode;
  className?: string;
  /** Optional grouping wrapper (e.g. a shortcut description). */
  title?: string;
}

/** Renders a keyboard shortcut key. */
export function Kbd({ children, className, title }: KbdProps) {
  return (
    <kbd
      title={title}
      className={cn(
        'inline-flex h-5 min-w-5 select-none items-center justify-center rounded bg-surface-hover px-1.5',
        'font-mono text-[11px] font-medium leading-none text-foreground-subtle',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
