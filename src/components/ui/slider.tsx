import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SliderProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'defaultValue'> {
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange?: (value: number) => void;
  onValueCommit?: (value: number) => void;
  label?: React.ReactNode;
  valueLabel?: React.ReactNode;
  description?: React.ReactNode;
  /** Tailwind width override for the control itself. */
  controlClassName?: string;
}

/** Styled native range input (keyboard + a11y for free, tokens only). */
export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { value, min, max, step = 1, onValueChange, onValueCommit, label, valueLabel, description, className, controlClassName, disabled, ...props },
  ref,
) {
  const range = max - min;
  const pct = range > 0 ? Math.min(100, Math.max(0, ((value - min) / range) * 100)) : 0;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label || valueLabel) && (
        <div className="flex items-baseline justify-between gap-3">
          {label ? <span className="text-[13px] font-medium text-foreground">{label}</span> : null}
          {valueLabel ? (
            <span className="text-xs tabular-nums text-foreground-muted">{valueLabel}</span>
          ) : null}
        </div>
      )}
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange?.(Number(event.target.value))}
        onPointerUp={(event) => onValueCommit?.(Number((event.target as HTMLInputElement).value))}
        onKeyUp={(event) => onValueCommit?.(Number((event.currentTarget as HTMLInputElement).value))}
        style={{
          background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--border-strong) ${pct}%, var(--border-strong) 100%)`,
        }}
        className={cn(
          'h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none',
          'focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-50',
          '[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-border-strong [&::-webkit-slider-thumb]:bg-surface-raised [&::-webkit-slider-thumb]:shadow-sm',
          'motion-reduce:transition-none',
          controlClassName,
        )}
        {...props}
      />
      {description ? <p className="text-xs leading-relaxed text-foreground-muted">{description}</p> : null}
    </div>
  );
});
