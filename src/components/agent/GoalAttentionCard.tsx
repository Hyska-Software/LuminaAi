/**
 * Card de atenção do objetivo (`docs/goals/code-goals/PLAN.md` §10.5/§10.8).
 *
 * Hospedado pelo transcript do Code (`CodeSessionCards`) **depois** das
 * mensagens para os estados que exigem decisão humana: pausado (por erro,
 * estol, limite de rodadas ou rodada interrompida), bloqueado e concluído.
 * Pausado pelo usuário e objetivo ativo não viram card (`goalNeedsAttention`).
 *
 * Puramente apresentacional: nenhum store/`api`, ações apenas por callback.
 * Acessibilidade: `role="status"` (polite) para pausado/concluído e
 * `role="alert"` (assertive) para bloqueado, com `aria-busy` durante ações e
 * botão X com `aria-label="Dispensar"`.
 */
import { useTranslation } from 'react-i18next';
import { Target, TriangleAlert, X } from 'lucide-react';

import { Badge, Button, IconButton } from '@/components/ui';
import {
  goalNeedsAttention,
  goalPauseReasonLabel,
  goalStatusLabel,
  goalStatusTone,
} from '@/lib/goalRunner';
import type { GoalStatus, GoalView } from '@/lib/types';
import { cn, formatCost, formatTokens, relativeTime } from '@/lib/utils';

export interface GoalAttentionCardProps {
  goal: GoalView;
  /** Enquanto o host aplica uma ação: desabilita os botões e marca `aria-busy`. */
  busy?: boolean;
  className?: string;
  onResume?: () => void;
  onExtend?: () => void;
  onComplete?: () => void;
  /** Reabre um objetivo concluído (volta a `active` manual). */
  onReopen?: () => void;
  onOpen?: () => void;
  onDismiss?: () => void;
}

const TONE: Record<GoalStatus, { panel: string; text: string }> = {
  active: { panel: 'bg-accent-soft', text: 'text-accent' },
  paused: { panel: 'bg-warning-soft', text: 'text-warning' },
  completed: { panel: 'bg-success-soft', text: 'text-success' },
  blocked: { panel: 'bg-danger-soft', text: 'text-danger' },
};

const TITLE_KEY: Record<GoalStatus, string> = {
  active: 'goalAttention.title.active',
  paused: 'goalAttention.title.paused',
  blocked: 'goalAttention.title.blocked',
  completed: 'goalAttention.title.completed',
};

/**
 * Card de atenção do objetivo. Não renderiza nada para estados que não pedem
 * decisão do usuário (ativo e pausado por você).
 */
export function GoalAttentionCard({
  goal,
  busy = false,
  className,
  onResume,
  onExtend,
  onComplete,
  onReopen,
  onOpen,
  onDismiss,
}: GoalAttentionCardProps) {
  const { t } = useTranslation('agents');
  if (!goalNeedsAttention(goal) || goal.status === 'active') return null;

  const tone = TONE[goal.status];
  const title = t(TITLE_KEY[goal.status]);
  const role = goal.status === 'blocked' ? 'alert' : 'status';

  const completedLabel = (completedAt?: number | null): string => {
    if (completedAt == null || !Number.isFinite(completedAt)) {
      return t('goalAttention.completed.body');
    }
    if (Date.now() - completedAt < 60_000) return t('goalAttention.completed.now');
    return t('goalAttention.completed.ago', { relative: relativeTime(completedAt) });
  };

  const summaryParts = (): string[] => {
    const parts = [t('goalAttention.rounds', { current: goal.rounds, max: goal.maxRounds })];
    if (goal.tokens != null && Number.isFinite(goal.tokens)) {
      parts.push(t('goalAttention.tokens', { tokens: formatTokens(goal.tokens) }));
    }
    if (goal.cost != null && Number.isFinite(goal.cost)) {
      parts.push(formatCost(goal.cost));
    }
    const lastActivity = goal.lastRoundAt ?? goal.updatedAt;
    if (lastActivity != null && Number.isFinite(lastActivity)) {
      parts.push(t('goalAttention.lastActivity', { time: relativeTime(lastActivity) }));
    }
    return parts;
  };

  const summary = summaryParts();
  const guidance = (() => {
    if (goal.status !== 'paused') return null;
    switch (goal.pauseReason) {
      case 'max_rounds':
        return t('goalAttention.guidance.maxRounds');
      case 'stalled':
        return t('goalAttention.guidance.stalled');
      case 'interrupted':
        return t('goalAttention.guidance.interrupted');
      case 'error':
        return t('goalAttention.guidance.error');
      default:
        return null;
    }
  })();

  const label = (() => {
    if (goal.status === 'paused') {
      return goalPauseReasonLabel(goal.pauseReason) ?? t('goalAttention.pausedFallback');
    }
    if (goal.status === 'blocked') {
      return t('goalAttention.blockedLabel', { count: goal.blockerStreak ?? 1 });
    }
    return completedLabel(goal.completedAt);
  })();

  const detail = (() => {
    if (goal.status === 'paused') return goal.pauseDetail?.trim() || goal.lastNote?.trim() || '';
    if (goal.status === 'blocked') return goal.blockerReason?.trim() || '';
    return goal.lastNote?.trim() || '';
  })();

  const canResume = goal.status === 'paused' || goal.status === 'blocked';
  const canExtend = goal.status === 'paused' && goal.pauseReason === 'max_rounds';
  // Concluir só no bloqueado: pausado por erro/estol/interrupção pede retomar
  // (ou estender), não encerrar (PLAN §10.8).
  const canComplete = goal.status === 'blocked';
  const canReopen = goal.status === 'completed';
  const showActions =
    (canResume && onResume != null) ||
    (canExtend && onExtend != null) ||
    (canComplete && onComplete != null) ||
    (canReopen && onReopen != null) ||
    onOpen != null;

  const run = (handler?: () => void) => {
    if (busy) return;
    handler?.();
  };

  return (
    <section
      role={role}
      aria-label={title}
      aria-busy={busy || undefined}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface p-3',
        className,
      )}
    >
      <header className="flex min-w-0 items-center gap-2">
        {goal.status === 'paused' || goal.status === 'blocked' ? (
          <TriangleAlert aria-hidden className={cn('size-4 shrink-0', tone.text)} strokeWidth={1.75} />
        ) : (
          <Target aria-hidden className={cn('size-4 shrink-0', tone.text)} strokeWidth={1.75} />
        )}
        <h3 className="min-w-0 flex-1 break-words text-[13px] font-medium text-foreground">{title}</h3>
        <Badge variant={goalStatusTone(goal)}>{goalStatusLabel(goal)}</Badge>
        {onDismiss ? (
          <IconButton
            size="sm"
            label={t('goalAttention.dismiss')}
            disabled={busy}
            onClick={() => run(onDismiss)}
            className="shrink-0"
          >
            <X aria-hidden className="size-3.5" />
          </IconButton>
        ) : null}
      </header>

      <div className={cn('flex min-w-0 flex-col gap-0.5 rounded-lg px-2.5 py-1.5', tone.panel)}>
        <p className={cn('min-w-0 break-words text-[11px] font-medium', tone.text)}>{label}</p>
        {detail ? (
          <p className="min-w-0 break-words text-[11px] leading-relaxed text-foreground-muted">
            {detail}
          </p>
        ) : null}
        {guidance ? (
          <p className={cn('min-w-0 break-words text-[11px] leading-relaxed', tone.text)}>
            {guidance}
          </p>
        ) : null}
      </div>

      <p className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-foreground-muted">
        {summary.map((part) => (
          <span key={part} className="break-words">
            {part}
          </span>
        ))}
      </p>

      {showActions ? (
        <div className="flex flex-wrap items-center gap-2">
          {canResume && onResume ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              leftIcon={<Target aria-hidden className="size-3.5" />}
              onClick={() => run(onResume)}
            >
              {t('goalAttention.actions.resume')}
            </Button>
          ) : null}
          {canExtend && onExtend ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => run(onExtend)}
            >
              {t('goalAttention.actions.extend')}
            </Button>
          ) : null}
          {canComplete && onComplete ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => run(onComplete)}
            >
              {t('goalAttention.actions.complete')}
            </Button>
          ) : null}
          {canReopen && onReopen ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              leftIcon={<Target aria-hidden className="size-3.5" />}
              onClick={() => run(onReopen)}
            >
              {t('goalAttention.actions.reopen')}
            </Button>
          ) : null}
          {onOpen ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(onOpen)}>
              {t('goalAttention.actions.open')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
