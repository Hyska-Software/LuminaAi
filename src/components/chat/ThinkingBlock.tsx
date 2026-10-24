import { useEffect, useRef, useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { Brain, ChevronDown } from 'lucide-react';
import { useReduceMotion } from '@/components/layout/hooks';
import { cn, formatDuration } from '@/lib/utils';

export interface ThinkingBlockProps {
  text: string;
  /** Whether the assistant is currently streaming this turn. */
  streaming: boolean;
  /** Timestamp of the streaming turn, used for the live counter. */
  startedAt?: number | null;
  className?: string;
}

/**
 * Collapsible reasoning block (DESIGN §6.3): shimmering title while it streams,
 * auto-opened during the stream and collapsed when it finishes.
 */
export function ThinkingBlock({ text, streaming, startedAt, className }: ThinkingBlockProps) {
  const reduceMotion = useReduceMotion();
  const [open, setOpen] = useState(streaming);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const startRef = useRef<number | null>(streaming ? (startedAt ?? Date.now()) : null);

  useEffect(() => {
    if (streaming) {
      if (startRef.current === null) startRef.current = startedAt ?? Date.now();
      setOpen(true);
      const update = () => {
        if (startRef.current !== null) setElapsed(Date.now() - startRef.current);
      };
      update();
      const timer = setInterval(update, 500);
      return () => clearInterval(timer);
    }
    if (startRef.current !== null) {
      setElapsed(Date.now() - startRef.current);
      startRef.current = null;
    }
    setOpen(false);
    return undefined;
  }, [streaming, startedAt]);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className={cn('mb-2.5', className)}>
      <Collapsible.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1.5 rounded-md text-[13px] font-medium text-foreground-muted',
            'transition-colors duration-150 hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          )}
        >
          <Brain className="size-3.5 shrink-0" />
          <span
            className={cn(
              streaming &&
                !reduceMotion &&
                'bg-linear-to-r from-foreground-muted via-foreground to-foreground-muted bg-[length:200%_100%] bg-clip-text text-transparent animate-shimmer',
            )}
          >
            {streaming ? 'Pensando…' : 'Raciocínio'}
          </span>
          {elapsed !== null ? (
            <span className="text-[12px] font-normal tabular-nums text-foreground-subtle">
              · {formatDuration(elapsed)}
            </span>
          ) : null}
          <ChevronDown
            className={cn('size-3.5 shrink-0 text-foreground-subtle transition-transform duration-150', open && 'rotate-180')}
          />
        </button>
      </Collapsible.Trigger>

      <Collapsible.Content>
        <div
          className={cn(
            'mt-2 max-h-64 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words',
            'border-l border-border pl-3 font-mono text-[12.5px] leading-6 text-foreground-muted',
          )}
        >
          {text || '…'}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
