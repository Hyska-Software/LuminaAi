import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * Shared body surface for the Agents dialogs: the header and footer already
 * own the 24px horizontal rhythm, so the body adds it around its content and
 * takes over the scroll between them.
 */
export function AgentDialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-5', className)}
      {...props}
    />
  );
}
