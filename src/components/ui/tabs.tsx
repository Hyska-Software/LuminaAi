import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

export interface TabsListProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  variant?: 'default' | 'sidebar';
}

export const TabsList = React.forwardRef<HTMLDivElement, TabsListProps>(function TabsList(
  { className, variant = 'default', ...props },
  ref,
) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        variant === 'default' && 'inline-flex h-9 items-center gap-1 rounded-xl bg-surface p-1',
        variant === 'sidebar' && 'flex flex-col items-stretch gap-0.5',
        className,
      )}
      {...props}
    />
  );
});

export interface TabsTriggerProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  variant?: 'pill' | 'underline' | 'sidebar';
}

export const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(function TabsTrigger(
  { className, variant = 'pill', ...props },
  ref,
) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex select-none items-center gap-2 whitespace-nowrap text-[13px] font-medium',
        'text-foreground-muted transition-colors duration-150 hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        variant === 'pill' &&
          'h-8 justify-center rounded-xl px-3 data-[state=active]:bg-surface-raised data-[state=active]:text-foreground data-[state=active]:shadow-sm',
        variant === 'underline' &&
          'relative h-8 justify-center rounded-none px-2 data-[state=active]:text-foreground data-[state=active]:after:absolute data-[state=active]:after:inset-x-1 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-accent',
        variant === 'sidebar' &&
          'justify-start rounded-lg px-2.5 py-2 text-left data-[state=active]:bg-accent-soft data-[state=active]:text-accent hover:data-[state=inactive]:bg-surface-hover',
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn(
        'outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:data-[state=active]:animate-fade-in',
        className,
      )}
      {...props}
    />
  );
});
