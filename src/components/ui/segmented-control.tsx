import * as React from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { cn } from '@/lib/utils';

export interface SegmentedOption {
  value: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  title?: string;
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  value?: string | null;
  onChange: (value: string) => void;
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  fullWidth?: boolean;
}

const SIZES = {
  sm: 'h-7 px-2.5 text-[12px]',
  md: 'h-8 px-3 text-[13px]',
} as const;

/** Single-choice segmented control (Radix RadioGroup under the hood). */
export function SegmentedControl({
  options,
  value,
  onChange,
  size = 'md',
  className,
  ariaLabel,
  disabled = false,
  fullWidth = false,
}: SegmentedControlProps) {
  return (
    <RadioGroupPrimitive.Root
      value={value ?? undefined}
      onValueChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
      orientation="horizontal"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-xl bg-surface p-0.5',
        fullWidth && 'flex w-full',
        className,
      )}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          title={option.title}
          className={cn(
            'group relative inline-flex select-none items-center justify-center rounded-[10px] font-medium',
            'text-foreground-muted transition-colors duration-150 hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            'data-[state=checked]:bg-surface-raised data-[state=checked]:text-foreground data-[state=checked]:shadow-sm',
            'data-[disabled]:pointer-events-none data-[disabled]:opacity-40 motion-reduce:transition-none',
            fullWidth && 'flex-1',
            SIZES[size],
          )}
        >
          <span className="flex min-w-0 flex-col items-center leading-tight">
            <span className="truncate">{option.label}</span>
            {option.description ? (
              <span className="mt-0.5 text-[10px] font-normal text-foreground-subtle">{option.description}</span>
            ) : null}
          </span>
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
