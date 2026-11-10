import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('agents');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const parts: string[] = [t('turnFooter.worked', { duration: formatDuration(durationMs) })];
  if (tokens != null && Number.isFinite(tokens)) {
    parts.push(t('turnFooter.tokens', { tokens: formatTokens(tokens) }));
  }
  if (files != null && files > 0) parts.push(t('turnFooter.files', { count: files }));
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
      aria-label={t('turnFooter.aria')}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-2 text-[12px] text-foreground-muted',
        className,
      )}
    >
      <span className="min-w-0 break-words">{summary}</span>

      <span aria-live="polite" className="sr-only">
        {copied ? t('turnFooter.copiedAria') : ''}
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-1">
        {onOpenChanges ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpenChanges}
            leftIcon={<FileDiff className="size-3.5" />}
          >
            {t('turnFooter.viewChanges')}
          </Button>
        ) : null}
        {onRevert ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onRevert}
            leftIcon={<RotateCcw className="size-3.5" />}
          >
            {t('turnFooter.revert')}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={copySummary}
          leftIcon={<ClipboardCopy className="size-3.5" />}
        >
          {copied ? t('turnFooter.copied') : t('turnFooter.copy')}
        </Button>
      </div>
    </div>
  );
}
