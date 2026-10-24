import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseGenUI } from '@/lib/genui/schema';
import { CodeBlock } from './CodeBlock';
import { GenUIRenderer } from './GenUIRenderer';

export interface GenUIBlockProps {
  source: string;
  className?: string;
}

/**
 * Entry point for ` ```ui ` fenced blocks: parses the declarative JSON and
 * renders it. On any validation error it degrades to the raw code block with a
 * discreet warning instead of failing the message.
 */
export function GenUIBlock({ source, className }: GenUIBlockProps) {
  const { spec, error } = useMemo(() => parseGenUI(source), [source]);

  if (!spec) {
    return (
      <div className={cn('my-3 flex flex-col gap-2', className)}>
        <CodeBlock code={source.trim()} language="json" title="UI generativa" maxHeight={300} />
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-foreground-subtle">
          <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>{error ?? 'Não foi possível renderizar a UI generativa.'}</span>
        </p>
      </div>
    );
  }

  return (
    <div className={cn('my-3', className)}>
      <GenUIRenderer spec={spec} />
    </div>
  );
}
