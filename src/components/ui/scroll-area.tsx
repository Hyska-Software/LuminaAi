import * as React from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { cn } from '@/lib/utils';

export interface ScrollAreaProps
  extends Omit<React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>, 'type'> {
  viewportClassName?: string;
  viewportRef?: React.Ref<HTMLDivElement>;
  type?: 'auto' | 'always' | 'scroll' | 'hover';
  /** Adds horizontal scrolling in addition to vertical. */
  horizontal?: boolean;
}

export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  { className, viewportClassName, viewportRef, children, type = 'hover', horizontal = false, ...props },
  ref,
) {
  return (
    <ScrollAreaPrimitive.Root ref={ref} type={type} className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        className={cn('size-full rounded-[inherit] [&>div]:block!', viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex w-2 touch-none select-none p-0.5 transition-opacity duration-150 data-[state=hidden]:opacity-0"
      >
        <ScrollAreaPrimitive.Thumb className="flex-1 rounded-full bg-border-strong transition-colors hover:bg-foreground-subtle" />
      </ScrollAreaPrimitive.Scrollbar>
      {horizontal ? (
        <ScrollAreaPrimitive.Scrollbar
          orientation="horizontal"
          className="flex h-2 touch-none select-none flex-col p-0.5 transition-opacity duration-150 data-[state=hidden]:opacity-0"
        >
          <ScrollAreaPrimitive.Thumb className="flex-1 rounded-full bg-border-strong transition-colors hover:bg-foreground-subtle" />
        </ScrollAreaPrimitive.Scrollbar>
      ) : null}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
});
