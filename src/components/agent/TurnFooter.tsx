import { useEffect, useState } from 'react';
import { ClipboardCopy, FileDiff, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn, formatDuration, formatTokens } from '@/lib/utils';

export interface TurnFooterProps {
  durationMs: number;
  tokens?: number | null;
  files?: number | null;
  added?: number | null;
  removed?: number | null;
  onOpenChanges?: () => void;
  onRevert?: () => void;
  className?: string;
}

const COPIED_RESET_MS = 2000;

/**
 * Fecho de turno (WORKBENCH §5.1): "Trabalhou por 4m 29s · 38,2k tokens ·
 * 2 arquivos · +42 −7" com as ações de revisão. Só apresenta — as ações sobem
 * por callback e o resumo é copiado localmente.
 */
export function TurnFooter({
  durationMs,
  tokens,
  files,
  added,
  removed,
  onOpenChanges,
  onRevert,
  className,
}: TurnFooterProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const parts: string[] = [`Trabalhou por ${formatDuration(durationMs)}`];
  if (tokens != null && Number.isFinite(tokens)) parts.push(`${formatTokens(tokens)} tokens`);
  if (files != null && files > 0) parts.push(`${files} arquivo${files === 1 ? '' : 's'}`);
  if (added != null || removed != null) {
    parts.push(`+${added ?? 0} −${removed ?? 0}`);
  }

  const summary = parts.join(' · ');

  const copySummary = async () => {
    try {
      await navigator.clipboard?.writeText(summary);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      role="group"
      aria-label="Fim do turno"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-2 text-[12px] text-foreground-muted',
        className,
      )}
    >
      <span className="min-w-0 break-words">{summary}</span>

      <span aria-live="polite" className="sr-only">
        {copied ? 'Resumo do turno copiado' : ''}
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-1">
        {onOpenChanges ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpenChanges}
            leftIcon={<FileDiff className="size-3.5" />}
          >
            Ver alterações
          </Button>
        ) : null}
        {onRevert ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onRevert}
            leftIcon={<RotateCcw className="size-3.5" />}
          >
            Reverter turno
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={copySummary}
          leftIcon={<ClipboardCopy className="size-3.5" />}
        >
          {copied ? 'Resumo copiado' : 'Copiar resumo'}
        </Button>
      </div>
    </div>
  );
}
