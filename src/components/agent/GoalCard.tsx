/**
 * Card do objetivo persistente da sessão de código
 * (`docs/goals/code-goals/PLAN.md` §10.2/§10.5/§10.8).
 *
 * Puramente apresentacional: recebe o `GoalView` (e opcionalmente as rodadas) e
 * sobe as decisões por callback — não conhece store nem `api`. É usado pelo
 * popover do composer (ui-core), pelo painel/timeline (ui-code) e pelo
 * `ToolPresentationCard` (compacto + somente leitura na timeline).
 *
 * Regras de ouro:
 * - `readOnly` (ou a ausência de `onAction`) nunca renderiza botões mortos.
 * - `compact` é um resumo de uma linha de blocos: título, status, rodada e nota.
 * - Nada de `delete` aqui: encerrar o objetivo é ação destrutiva do diálogo.
 * - Texto longo quebra/trunca (`break-words`, `line-clamp`, `truncate`).
 */
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Target } from 'lucide-react';

import { Badge, Button, ProgressBar } from '@/components/ui';
import type { ButtonVariant } from '@/components/ui';
import {
  goalPauseReasonLabel,
  goalRoundLabel,
  goalStatusLabel,
  goalStatusTone,
} from '@/lib/goalRunner';
import type { GoalRound, GoalStatus, GoalView } from '@/lib/types';
import { cn, formatCost, formatDuration, formatTokens, relativeTime } from '@/lib/utils';

/** Ações que o card pode emitir para o host aplicar via `codeStore`/`update_goal`. */
export type GoalCardAction =
  | 'edit'
  | 'pause'
  | 'resume'
  | 'arm'
  | 'disarm'
  | 'complete'
  | 'reopen'
  | 'start_round'
  | 'delete';

export interface GoalCardProps {
  goal: GoalView;
  /** Histórico recente: liga o resumo de duração e o total de tokens/custo. */
  rounds?: GoalRound[];
  /** Enquanto o host aplica uma ação: desabilita as ações e marca `aria-busy`. */
  busy?: boolean;
  /** Timeline/histórico: nunca mostra botões (nem `Abrir objetivo`). */
  readOnly?: boolean;
  /** Variante de timeline/popover: título, badge, rodada e última nota. */
  compact?: boolean;
  className?: string;
  onAction?: (action: GoalCardAction) => void;
  onOpen?: () => void;
}

const STATUS_ICON_TONE: Record<GoalStatus, string> = {
  active: 'text-accent',
  paused: 'text-warning',
  completed: 'text-success',
  blocked: 'text-danger',
};

interface ActionSpec {
  action: GoalCardAction;
  labelKey: string;
  ariaKey: string;
  variant: ButtonVariant;
}

/**
 * Matriz de ações por estado (PLAN §10.8). `delete` fica no diálogo e `disarm`
 * é responsabilidade do controle do host — o card expõe o tipo por contrato.
 */
function buildActions(goal: GoalView): ActionSpec[] {
  const actions: ActionSpec[] = [];
  switch (goal.status) {
    case 'active':
      if (goal.autoContinue) {
        actions.push({
          action: 'pause',
          labelKey: 'goal.actions.pause',
          ariaKey: 'goal.actions.pauseAria',
          variant: 'secondary',
        });
      } else {
        actions.push({
          action: 'arm',
          labelKey: 'goal.actions.arm',
          ariaKey: 'goal.actions.armAria',
          variant: 'secondary',
        });
        actions.push({
          action: 'start_round',
          labelKey: 'goal.actions.startRound',
          ariaKey: 'goal.actions.startRoundAria',
          variant: 'secondary',
        });
      }
      actions.push({
        action: 'complete',
        labelKey: 'goal.actions.complete',
        ariaKey: 'goal.actions.completeAria',
        variant: 'ghost',
      });
      actions.push({
        action: 'edit',
        labelKey: 'goal.actions.edit',
        ariaKey: 'goal.actions.editAria',
        variant: 'ghost',
      });
      break;
    case 'paused':
      actions.push({
        action: 'resume',
        labelKey: 'goal.actions.resume',
        ariaKey: 'goal.actions.resumeAria',
        variant: 'secondary',
      });
      if (goal.pauseReason === 'max_rounds') {
        // Estender é um `edit` do limite de rodadas no diálogo (não há ação
        // dedicada no contrato do card).
        actions.push({
          action: 'edit',
          labelKey: 'goal.actions.extend',
          ariaKey: 'goal.actions.extendAria',
          variant: 'secondary',
        });
      } else {
        actions.push({
          action: 'edit',
          labelKey: 'goal.actions.edit',
          ariaKey: 'goal.actions.editAria',
          variant: 'ghost',
        });
        // Concluir manualmente só faz sentido quando quem pausou foi o usuário.
        if (goal.pauseReason === 'user') {
          actions.push({
            action: 'complete',
            labelKey: 'goal.actions.complete',
            ariaKey: 'goal.actions.completeAria',
            variant: 'ghost',
          });
        }
      }
      break;
    case 'completed':
      actions.push({
        action: 'reopen',
        labelKey: 'goal.actions.reopen',
        ariaKey: 'goal.actions.reopenAria',
        variant: 'secondary',
      });
      break;
    case 'blocked':
      actions.push({
        action: 'resume',
        labelKey: 'goal.actions.resume',
        ariaKey: 'goal.actions.resumeAria',
        variant: 'secondary',
      });
      actions.push({
        action: 'complete',
        labelKey: 'goal.actions.complete',
        ariaKey: 'goal.actions.completeAria',
        variant: 'secondary',
      });
      break;
  }
  return actions;
}

function safeMaxRounds(goal: GoalView): number {
  return goal.maxRounds > 0 ? goal.maxRounds : Math.max(1, goal.rounds);
}

/**
 * Card do objetivo da sessão. Ver `GoalCardProps`; compacto é o formato usado
 * na timeline (`ToolPresentationCard`), completo no popover/painel.
 */
export function GoalCard({
  goal,
  rounds,
  busy = false,
  readOnly = false,
  compact = false,
  className,
  onAction,
  onOpen,
}: GoalCardProps) {
  const { t } = useTranslation('agents');
  const titleId = useId();
  const title = goal.title.trim() || t('goal.fallbackTitle');
  const statusTone = goalStatusTone(goal);
  const statusLabel = goalStatusLabel(goal);
  const roundLabel = goalRoundLabel(goal);
  const maxRounds = safeMaxRounds(goal);
  const progressValue = Math.min(Math.max(goal.rounds, 0), maxRounds);
  const lastNote = goal.lastNote?.trim() ?? '';

  const pauseGuidance = (): string | null => {
    if (goal.status !== 'paused') return null;
    switch (goal.pauseReason) {
      case 'max_rounds':
        return t('goal.guidance.maxRounds');
      case 'stalled':
        return t('goal.guidance.stalled');
      case 'interrupted':
        return t('goal.guidance.interrupted');
      default:
        return null;
    }
  };

  const completedLabel = (completedAt?: number | null): string => {
    if (completedAt == null || !Number.isFinite(completedAt)) return t('goal.completed.body');
    if (Date.now() - completedAt < 60_000) return t('goal.completed.now');
    return t('goal.completed.ago', { relative: relativeTime(completedAt) });
  };

  const summaryParts = (): string[] => {
    const parts = [t('goal.rounds', { current: goal.rounds, max: goal.maxRounds })];
    if (goal.tokens != null && Number.isFinite(goal.tokens)) {
      parts.push(t('goal.tokens', { tokens: formatTokens(goal.tokens) }));
    }
    if (goal.cost != null && Number.isFinite(goal.cost)) {
      parts.push(formatCost(goal.cost));
    }
    const totalMs = (rounds ?? []).reduce(
      (total, round) =>
        total + (typeof round.durationMs === 'number' && Number.isFinite(round.durationMs)
          ? round.durationMs
          : 0),
      0,
    );
    if (totalMs > 0) parts.push(formatDuration(totalMs));
    return parts;
  };

  const guidance = pauseGuidance();
  const summary = !compact && rounds !== undefined ? summaryParts() : [];

  // `readOnly`/compacto nunca mostram ação; sem handler também não (nada de
  // botão morto prometendo efeito que não existe).
  const actions = !readOnly && !compact && onAction ? buildActions(goal) : [];
  const showOpen = !readOnly && !compact && onOpen != null;
  const showActions = actions.length > 0 || showOpen;

  const act = (action: GoalCardAction) => {
    if (busy) return;
    onAction?.(action);
  };

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      className={cn(
        'flex min-w-0 flex-col rounded-xl bg-surface',
        compact ? 'gap-1 px-3 py-2' : 'gap-2.5 p-3',
        className,
      )}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <Target
          aria-hidden
          className={cn('size-4 shrink-0', STATUS_ICON_TONE[goal.status])}
          strokeWidth={1.75}
        />
        <h3
          id={titleId}
          title={title}
          className={cn(
            'min-w-0 flex-1 text-[13px] font-medium text-foreground',
            compact ? 'truncate' : 'break-words',
          )}
        >
          {title}
        </h3>
        <Badge variant={statusTone}>{statusLabel}</Badge>
        {readOnly && !compact ? <Badge variant="outline">{t('goal.readOnly')}</Badge> : null}
        <span className="shrink-0 text-[11px] tabular-nums text-foreground-muted">{roundLabel}</span>
      </header>

      {compact ? (
        lastNote ? (
          <p className="min-w-0 break-words text-[11px] leading-relaxed text-foreground-muted">
            <span className="font-medium">{t('goal.lastNoteLabel')} </span>
            {lastNote}
          </p>
        ) : null
      ) : (
        <>
          {goal.objective.trim() ? (
            <p className="line-clamp-3 min-w-0 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground-muted">
              {goal.objective}
            </p>
          ) : null}

          <ProgressBar
            value={progressValue}
            max={maxRounds}
            size="xs"
            tone={goal.status === 'completed' ? 'success' : 'accent'}
            label={t('goal.progressAria')}
          />

          {goal.status === 'paused' ? (
            <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-warning-soft px-2.5 py-1.5">
              <p className="text-[11px] font-medium text-warning">
                {goalPauseReasonLabel(goal.pauseReason) ?? t('goal.pausedFallback')}
              </p>
              {goal.pauseDetail?.trim() ? (
                <p className="min-w-0 break-words text-[11px] leading-relaxed text-foreground-muted">
                  {goal.pauseDetail}
                </p>
              ) : null}
              {guidance ? (
                <p className="min-w-0 break-words text-[11px] leading-relaxed text-warning">
                  {guidance}
                </p>
              ) : null}
            </div>
          ) : null}

          {goal.status === 'blocked' ? (
            <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-danger-soft px-2.5 py-1.5">
              <p className="text-[11px] font-medium text-danger">
                {t('goal.blockedLabel', { count: goal.blockerStreak ?? 1 })}
              </p>
              {goal.blockerReason?.trim() ? (
                <p className="min-w-0 break-words text-[11px] leading-relaxed text-foreground-muted">
                  {goal.blockerReason}
                </p>
              ) : null}
            </div>
          ) : null}

          {goal.status === 'completed' ? (
            <p className="min-w-0 break-words rounded-lg bg-success-soft px-2.5 py-1.5 text-[11px] leading-relaxed text-success">
              {completedLabel(goal.completedAt)}
            </p>
          ) : null}

          {lastNote ? (
            <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-background px-2.5 py-1.5">
              <p className="text-[11px] font-medium text-foreground-muted">{t('goal.lastNote')}</p>
              <p className="min-w-0 break-words text-[11px] leading-relaxed text-foreground-muted">
                {lastNote}
              </p>
            </div>
          ) : null}

          {summary.length > 0 ? (
            <p className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-foreground-muted">
              {summary.map((part) => (
                <span key={part} className="break-words">
                  {part}
                </span>
              ))}
            </p>
          ) : null}
        </>
      )}

      {showActions ? (
        <div className="flex flex-wrap items-center gap-2">
          {actions.map((spec) => (
            <Button
              key={`${spec.action}-${spec.labelKey}`}
              size="sm"
              variant={spec.variant}
              aria-label={t(spec.ariaKey as never)}
              disabled={busy}
              onClick={() => act(spec.action)}
            >
              {t(spec.labelKey as never)}
            </Button>
          ))}
          {showOpen ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('goal.actions.openAria')}
              disabled={busy}
              onClick={() => {
                if (busy) return;
                onOpen?.();
              }}
            >
              {t('goal.actions.open')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
