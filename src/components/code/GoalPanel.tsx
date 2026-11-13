/**
 * Painel central "Objetivo" do layout Code
 * (`docs/goals/code-goals/PLAN.md` §10.3).
 *
 * Aberto pela pill do composer, pelo badge/aba do header, pelo `/goal` ou pelo
 * card de atenção. Mostra o objetivo persistente da sessão (Markdown completo
 * com scroll/copiar), o resumo (rodadas, tempo, tokens, custo, última
 * atividade) e a timeline de rodadas (`list_goal_rounds`, mais recentes
 * primeiro).
 *
 * O cabeçalho/ações reusam o `GoalCard` de `@/components/agent` (mesma matriz de
 * estados do popover do composer) e as ações sobem para o `codeStore`
 * (snapshot autoritativo) ou para o `chatStore` ("Nova rodada"). O painel é a
 * própria `region` e dona do id `code-goal-panel` (contrato com
 * `WorkspaceCenter`/aba do header).
 */
import { useCallback, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Copy, RefreshCw, Target, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { GoalCard, type GoalCardAction } from '@/components/agent';
import { Markdown } from '@/components/chat/Markdown';
import { requestGoalCreation } from '@/components/composer/commands';
import { Badge, Button, IconButton } from '@/components/ui';
import type { BadgeVariant } from '@/components/ui';
import {
  goalPauseReasonLabel,
  goalRoundLabel,
  goalStatusLabel,
} from '@/lib/goalRunner';
import { useChatStore, useCodeStore, useUiStore } from '@/lib/store';
import { t } from '@/lib/i18n';
import { localeLowerCase } from '@/lib/i18n/format';
import type { GoalRound, GoalStatus, GoalView } from '@/lib/types';
import { cn, copyText, formatCost, formatDuration, formatTokens, relativeTime } from '@/lib/utils';

/** Limite do histórico carregado pelo painel (PLAN §5.3/§10.3). */
const GOAL_ROUNDS_LIMIT = 200;

export interface GoalPanelProps {
  conversationId: string;
  className?: string;
}

const STATUS_TONE_CLASS: Record<GoalStatus, string> = {
  active: 'text-accent',
  paused: 'text-warning',
  completed: 'text-success',
  blocked: 'text-danger',
};

/** Rótulo pt-BR do `GoalRound.outcome` (None = rodada em andamento). */
function roundOutcomeLabel(outcome?: string | null): string {
  switch (outcome) {
    case 'done':
      return t('code:goal.outcome.done');
    case 'cancelled':
      return t('code:goal.outcome.cancelled');
    case 'error':
      return t('code:goal.outcome.error');
    case 'interrupted':
      return t('code:goal.outcome.interrupted');
    case null:
    case undefined:
      return t('code:goal.outcome.running');
    default:
      return outcome;
  }
}

function roundOutcomeTone(outcome?: string | null): BadgeVariant {
  switch (outcome) {
    case 'done':
      return 'success';
    case 'error':
      return 'danger';
    case 'cancelled':
    case 'interrupted':
      return 'warning';
    case null:
    case undefined:
      return 'accent';
    default:
      return 'neutral';
  }
}

function filesLabel(count: number): string {
  return t('code:goal.panel.roundFiles', { count });
}

/** Ações do card que são mutações simples do `update_goal`. */
type GoalMutationAction = 'pause' | 'resume' | 'arm' | 'disarm' | 'complete' | 'reopen';

function summaryRows(
  goal: GoalView,
  rounds: GoalRound[],
): Array<{ id: string; label: string; value: string }> {
  const totalMs = rounds.reduce(
    (total, round) =>
      total +
      (typeof round.durationMs === 'number' && Number.isFinite(round.durationMs)
        ? round.durationMs
        : 0),
    0,
  );
  const lastActivity = goal.lastRoundAt ?? goal.updatedAt;
  const rows: Array<{ id: string; label: string; value: string }> = [
    {
      id: 'rounds',
      label: t('code:goal.panel.summary.rounds'),
      value: t('code:goal.panel.summary.roundsValue', {
        current: goal.rounds,
        max: goal.maxRounds,
      }),
    },
    {
      id: 'time',
      label: t('code:goal.panel.summary.totalTime'),
      value: totalMs > 0 ? formatDuration(totalMs) : '—',
    },
    {
      id: 'tokens',
      label: t('code:goal.panel.summary.tokens'),
      value: goal.tokens != null ? `~${formatTokens(goal.tokens)}` : '—',
    },
    { id: 'cost', label: t('code:goal.panel.summary.cost'), value: formatCost(goal.cost) },
    {
      id: 'activity',
      label: t('code:goal.panel.summary.lastActivity'),
      value:
        lastActivity != null && Number.isFinite(lastActivity)
          ? relativeTime(lastActivity)
          : '—',
    },
  ];
  return rows;
}

/** Linha da timeline de rodadas. */
function GoalRoundRow({ round }: { round: GoalRound }) {
  const { t: translate } = useTranslation('code');
  const outcome = round.outcome ?? null;
  const note = round.note?.trim() ?? '';
  const filesChanged = round.filesChanged ?? 0;
  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-lg bg-surface px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[12px] font-medium text-foreground tabular-nums">
          {translate('code:goal.panel.roundLabel', { index: round.index })}
        </span>
        <Badge variant={roundOutcomeTone(outcome)}>{roundOutcomeLabel(outcome)}</Badge>
        {typeof round.durationMs === 'number' && Number.isFinite(round.durationMs) ? (
          <span className="text-[11px] tabular-nums text-foreground-muted">
            {formatDuration(round.durationMs)}
          </span>
        ) : null}
        {filesChanged > 0 ? (
          <span className="text-[11px] tabular-nums text-foreground-muted">
            {filesLabel(filesChanged)}
          </span>
        ) : null}
        {round.tokens != null && Number.isFinite(round.tokens) ? (
          <span className="text-[11px] tabular-nums text-foreground-muted">
            {translate('code:goal.panel.roundTokens', { tokens: formatTokens(round.tokens) })}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-[11px] text-foreground-subtle">
          {relativeTime(round.startedAt)}
        </span>
      </div>
      {note ? (
        <p className="min-w-0 break-words text-[11.5px] leading-relaxed text-foreground-muted">
          {note}
        </p>
      ) : outcome != null ? (
        <p className="text-[11px] leading-relaxed text-foreground-subtle">
          {translate('code:goal.panel.roundNoSummary')}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Painel central do objetivo. Ver `GoalPanelProps`.
 */
export function GoalPanel({ conversationId, className }: GoalPanelProps) {
  const { t } = useTranslation('code');
  const session = useCodeStore((state) => state.byConversation[conversationId]);
  const goal = session?.goal ?? null;
  const goalRounds = session?.goalRounds ?? [];
  const goalRoundsLoading = session?.goalRoundsLoading ?? false;
  const goalRoundsError = session?.goalRoundsError ?? null;
  const sessionLoading = session?.loading ?? false;

  const loadGoalRounds = useCodeStore((state) => state.loadGoalRounds);
  const updateGoal = useCodeStore((state) => state.updateGoal);
  const runGoalRound = useChatStore((state) => state.runGoalRound);
  const streaming = useChatStore((state) => state.streaming);
  const openGoalDialog = useUiStore((state) => state.openGoalDialog);

  const [busy, setBusy] = useState(false);
  const generating = streaming != null;

  /**
   * O composer fica oculto enquanto a view central é `goal` (a aba cobre a
   * sessão). Antes de preencher o fluxo `/goal`, volta o centro para a sessão —
   * senão o usuário clica no CTA e não vê o pedido no campo de mensagem.
   */
  const startGoalCreation = () => {
    useUiStore.getState().closeCodeGoal();
    requestGoalCreation();
  };

  const reloadRounds = useCallback(() => {
    void loadGoalRounds(conversationId, GOAL_ROUNDS_LIMIT);
  }, [conversationId, loadGoalRounds]);

  /* Carrega no mount e sempre que o objetivo avança (rodada/revisão/edição). */
  const goalRoundsKey = goal ? `${goal.createdAt}:${goal.rounds}:${goal.updatedAt}` : null;
  useEffect(() => {
    if (!goalRoundsKey) return;
    void loadGoalRounds(conversationId, GOAL_ROUNDS_LIMIT);
  }, [conversationId, goalRoundsKey, loadGoalRounds]);

  const openEditDialog = () => {
    openGoalDialog({ conversationId, mode: 'edit' });
  };

  const runMutation = async (action: GoalMutationAction) => {
    if (busy || !goal) return;
    setBusy(true);
    try {
      await updateGoal(conversationId, action, null, goal.revision);
    } finally {
      setBusy(false);
    }
  };

  const startRound = async () => {
    if (busy || generating) return;
    setBusy(true);
    try {
      const started = await runGoalRound(conversationId);
      if (!started) {
        toast.error(t('code:goal.toast.startRoundFailed'), {
          description: t('code:goal.toast.startRoundFailedDescription'),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCardAction = (action: GoalCardAction) => {
    switch (action) {
      case 'edit':
      case 'delete':
        openEditDialog();
        return;
      case 'start_round':
        void startRound();
        return;
      case 'pause':
      case 'resume':
      case 'arm':
      case 'disarm':
      case 'complete':
      case 'reopen':
        void runMutation(action);
        return;
      default:
        return;
    }
  };

  const copyObjective = async () => {
    if (!goal) return;
    if (await copyText(goal.objective)) toast.success(t('code:goal.toast.copied'));
    else toast.error(t('code:goal.toast.copyFailed'));
  };

  const disabled = busy || generating;

  return (
    <section
      id="code-goal-panel"
      role="region"
      aria-label={t('code:goal.panel.region')}
      aria-busy={disabled || undefined}
      className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto', className)}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        {sessionLoading && !goal ? (
          <p role="status" className="rounded-xl bg-surface p-4 text-[12.5px] text-foreground-muted">
            {t('code:goal.panel.loading')}
          </p>
        ) : null}

        {!sessionLoading && !goal ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border-dashed bg-surface px-6 py-10 text-center">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Target aria-hidden className="size-5" strokeWidth={1.75} />
            </span>
            <div className="flex max-w-md flex-col gap-1">
              <h2 className="text-[14px] font-semibold text-foreground">
                {t('code:goal.panel.empty.title')}
              </h2>
              <p className="text-[12px] leading-relaxed text-foreground-muted">
                <Trans
                  ns="code"
                  i18nKey="goal.panel.empty.description"
                  components={{ strong: <strong /> }}
                />
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Target aria-hidden className="size-4" />}
              onClick={startGoalCreation}
            >
              {t('code:goal.panel.createWithGoal')}
            </Button>
          </div>
        ) : null}

        {goal ? (
          <>
            <GoalCard
              goal={goal}
              busy={disabled}
              onAction={handleCardAction}
              className="bg-surface-hover"
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <dl className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
                {summaryRows(goal, goalRounds).map((row) => (
                  <div key={row.id} className="flex items-baseline gap-1">
                    <dt className="text-[11px] text-foreground-subtle">{row.label}</dt>
                    <dd className="text-[11.5px] font-medium tabular-nums text-foreground-muted">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap items-center gap-2">
                {goal.status === 'completed' ? (
                  <Button size="sm" variant="secondary" onClick={startGoalCreation}>
                    {t('code:goal.panel.newGoal')}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:bg-danger-soft hover:text-danger"
                  disabled={disabled}
                  onClick={openEditDialog}
                >
                  {t('code:goal.panel.closeGoal')}
                </Button>
              </div>
            </div>

            {goal.status === 'paused' || goal.status === 'blocked' ? (
              <p className="flex items-start gap-1.5 rounded-lg bg-surface px-3 py-2 text-[11.5px] leading-relaxed text-foreground-muted">
                <TriangleAlert
                  aria-hidden
                  className={cn(
                    'mt-0.5 size-3.5 shrink-0',
                    STATUS_TONE_CLASS[goal.status],
                  )}
                  strokeWidth={1.75}
                />
                <span>
                  {goal.status === 'paused'
                    ? (goalPauseReasonLabel(goal.pauseReason) ?? t('code:goal.panel.pausedFallback'))
                    : t('code:goal.panel.blocked')}
                  {goal.status === 'paused' && goal.pauseDetail?.trim()
                    ? ` ${goal.pauseDetail.trim()}`
                    : ''}
                </span>
              </p>
            ) : null}

            <section
              aria-labelledby="code-goal-objective-heading"
              className="flex min-w-0 flex-col gap-2 rounded-xl bg-surface p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h3
                  id="code-goal-objective-heading"
                  className="text-[12px] font-semibold tracking-tight text-foreground"
                >
                  {t('code:goal.panel.objectiveHeading')}
                </h3>
                <IconButton
                  label={t('code:goal.panel.copyObjective')}
                  size="sm"
                  disabled={!goal.objective.trim()}
                  onClick={() => void copyObjective()}
                >
                  <Copy aria-hidden className="size-3.5" />
                </IconButton>
              </div>
              <div
                role="region"
                aria-label={t('code:goal.panel.objectiveRegion')}
                tabIndex={0}
                className={cn(
                  'max-h-72 min-w-0 overflow-y-auto break-words pr-1 text-[13px]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                )}
              >
                {goal.objective.trim() ? (
                  <Markdown content={goal.objective} />
                ) : (
                  <p className="text-[12px] text-foreground-subtle">{t('code:goal.panel.noDescription')}</p>
                )}
              </div>
            </section>

            <section className="flex min-w-0 flex-col gap-2" aria-labelledby="code-goal-rounds-heading">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3
                  id="code-goal-rounds-heading"
                  className="text-[12px] font-semibold tracking-tight text-foreground"
                >
                  {t('code:goal.panel.roundsHeading')}
                </h3>
                <span className="text-[11px] tabular-nums text-foreground-subtle">
                  {goalRoundLabel(goal)} · {goalStatusLabel(goal)}
                </span>
              </div>

              {goalRoundsLoading ? (
                <p role="status" className="rounded-lg bg-surface px-3 py-2 text-[11.5px] text-foreground-muted">
                  {t('code:goal.panel.roundsLoading')}
                </p>
              ) : null}

              {goalRoundsError ? (
                <div
                  role="alert"
                  className="flex flex-col gap-2 rounded-lg bg-danger-soft px-3 py-2.5"
                >
                  <p className="min-w-0 break-words text-[11.5px] leading-relaxed text-danger">
                    {t('code:goal.panel.roundsError')}
                  </p>
                  <div>
                    <Button
                      size="sm"
                      variant="secondary"
                      leftIcon={<RefreshCw aria-hidden className="size-3.5" />}
                      onClick={reloadRounds}
                    >
                      {t('common:actions.retry')}
                    </Button>
                  </div>
                </div>
              ) : null}

              {!goalRoundsLoading && !goalRoundsError && goalRounds.length === 0 ? (
                <p className="rounded-lg bg-surface px-3 py-2 text-[11.5px] text-foreground-subtle">
                  {t('code:goal.panel.roundsEmpty')}
                </p>
              ) : null}

              {goalRounds.length > 0 ? (
                <ol aria-labelledby="code-goal-rounds-heading" className="flex flex-col gap-1.5">
                  {goalRounds.map((entry) => (
                    <GoalRoundRow key={`${entry.index}-${entry.turnId}`} round={entry} />
                  ))}
                </ol>
              ) : null}
            </section>

            <p className="text-[11px] leading-relaxed text-foreground-subtle">
              {t('code:goal.panel.footer', {
                status: localeLowerCase(goalStatusLabel(goal)),
                revision: goal.revision,
              })}
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}

export default GoalPanel;
