import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LuminaOrbProps {
  /** Diameter in pixels. */
  size?: number;
  className?: string;
  /** Gentle pulse used while the assistant is reasoning. */
  animated?: boolean;
}

/**
 * The Lumina mark: a soft accent orb with a four-point spark (DESIGN §2).
 *
 * The gradient is built from design tokens only — no raw colors — so the mark
 * keeps adapting to light/dark themes.
 */
export function LuminaOrb({ size = 24, className, animated = false }: LuminaOrbProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full',
        'bg-linear-to-br from-accent via-accent to-accent-hover text-accent-foreground',
        'shadow-[0_0_16px_-4px_var(--accent)]',
        animated && 'animate-pulse-soft',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Sparkles strokeWidth={2} style={{ width: size * 0.55, height: size * 0.55 }} />
    </span>
  );
}
