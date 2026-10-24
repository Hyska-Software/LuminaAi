import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

export interface SwitchProps
  extends Omit<React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>, 'asChild'> {
  /** Optional label rendered next to the control. */
  label?: React.ReactNode;
  description?: React.ReactNode;
  /** Layout for the label + switch row. */
  align?: 'between' | 'start';
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { className, label, description, align = 'between', id, ...props },
  ref,
) {
  const autoId = React.useId();
  const switchId = id ?? autoId;

  const control = (
    <SwitchPrimitive.Root
      ref={ref}
      id={switchId}
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent outline-none',
        'transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'data-[state=checked]:bg-accent data-[state=unchecked]:bg-border-strong',
        'disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none',
        !label && !description && className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-surface-raised shadow-sm ring-0',
          'transition-transform duration-150 data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0 motion-reduce:transition-none',
        )}
      />
    </SwitchPrimitive.Root>
  );

  if (!label && !description) return control;

  return (
    <div
      className={cn(
        'flex gap-4',
        align === 'between' ? 'items-center justify-between' : 'items-start',
        className,
      )}
    >
      <div className="min-w-0 select-none">
        {label ? (
          <label htmlFor={switchId} className="block cursor-pointer text-sm font-medium text-foreground">
            {label}
          </label>
        ) : null}
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">{description}</p>
        ) : null}
      </div>
      {control}
    </div>
  );
});
