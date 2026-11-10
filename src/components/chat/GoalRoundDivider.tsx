/**
 * Divisor de rodada automática do objetivo (`docs/goals/code-goals/PLAN.md`
 * §10.5).
 *
 * A rodada do objetivo é um turno normal, mas a mensagem de abertura não é do
 * usuário: o transcript mostra um divisor compacto (linha + `Target`) em vez de
 * uma bolha, sem editar/regenerar. Enquanto a rodada roda, o divisor ganha um
 * spinner; depois, mostra o horário relativo em que começou.
 */
import { useTranslation } from 'react-i18next';
import { Target } from 'lucide-react';

import { Spinner } from '@/components/ui';
import { cn, relativeTime } from '@/lib/utils';

export interface GoalRoundDividerProps {
  /** Timestamp de criação da mensagem de abertura da rodada. */
  createdAt: number;
  /** Rodada em andamento (turno `goal_round` desta conversa). */
  streaming?: boolean;
  className?: string;
}

/** Linha divisória acessível que marca uma rodada automática no transcript. */
export function GoalRoundDivider({
  createdAt,
  streaming = false,
  className,
}: GoalRoundDividerProps) {
  const { t } = useTranslation('chat');
  const when = relativeTime(createdAt);
  const label = streaming
    ? t('goalRound.label')
    : t('goalRound.labelWithTime', { when });

  return (
    <div
      role="separator"
      aria-label={label}
      className={cn('flex min-w-0 items-center gap-3 py-1', className)}
    >
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border" />
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-foreground-muted">
        <Target aria-hidden className="size-3.5 shrink-0 text-accent" strokeWidth={1.75} />
        <span className="truncate">{t('goalRound.text')}</span>
        <span aria-hidden className="shrink-0 text-foreground-subtle">
          ·
        </span>
        <span className="shrink-0 tabular-nums text-foreground-subtle">{when}</span>
        {streaming ? <Spinner size="xs" className="shrink-0 text-accent" /> : null}
      </span>
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border" />
    </div>
  );
}
