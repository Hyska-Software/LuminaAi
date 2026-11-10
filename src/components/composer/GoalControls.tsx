/**
 * Pill + popover do objetivo persistente da sessão (`docs/goals/code-goals/PLAN.md`
 * §10.2/§10.7/§10.8).
 *
 * Vive no composer do layout Code, entre o toggle do modo Plano e o popover
 * "Plano e tarefas". Lê o snapshot do `codeStore` (autoritativo), aplica ações
 * via `updateGoal`/`runGoalRound` e navega para o painel central/diálogo pelo
 * `uiStore`. O card em si é o `GoalCard` (puro) de `@/components/agent`.
 *
 * Regras:
 * - sem objetivo ⇒ botão só-ícone com o mesmo toggle do modo Plano: inativo
 *   cria a intenção `/goal` (fallback `requestGoalCreation()`); ativo
 *   (`goalIntent`) desativa a intenção;
 * - durante uma rodada (`streaming.turnKind === 'goal_round'`) as ações ficam
 *   desabilitadas, exceto "Pausar após esta rodada" (desarma a continuidade);
 * - "Concluir" pede confirmação inline antes do IPC;
 * - textos longos truncam, nada de botão morto, `aria-expanded`/`aria-busy`
 *   vêm do Radix/`aria-busy` explícito.
 */
import { useEffect, useState } from 'react';
import { Target } from 'lucide-react';

import { GoalCard, type GoalCardAction } from '@/components/agent';
import { useReduceMotion } from '@/components/layout/hooks';
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  Tooltip,
} from '@/components/ui';
import {
  canStartGoalRound,
  goalIsRunning,
  goalPauseReasonLabel,
  goalRoundLabel,
  goalStatusLabel,
  goalStatusTone,
} from '@/lib/goalRunner';
import { useChatStore, useCodeStore, useUiStore } from '@/lib/store';
import type { GoalAction, GoalRound, GoalStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { requestGoalCreation } from './commands';

/** Rounds vazio estável (evita recriar o array a cada render). */
const EMPTY_ROUNDS: GoalRound[] = [];

type GoalTone = 'neutral' | 'accent' | 'warning' | 'danger' | 'success';

/** Fundo/borda do pill por tom do estado (tokens do design system). */
const TONE_PILL: Record<GoalTone, string> = {
  neutral:
    'border-dashed border-border bg-transparent text-foreground-muted hover:bg-surface-hover hover:text-foreground',
  accent: 'border-accent/40 bg-accent-soft text-foreground hover:bg-accent-soft',
  warning: 'border-warning/30 bg-warning-soft text-foreground hover:bg-warning-soft',
  danger: 'border-danger/30 bg-danger-soft text-foreground hover:bg-danger-soft',
  success: 'border-success/30 bg-success-soft text-foreground hover:bg-success-soft',
};

/** Cor do ícone por tom (o texto mantém contraste AA sobre o fundo suave). */
const TONE_ICON: Record<GoalTone, string> = {
  neutral: 'text-foreground-muted',
  accent: 'text-accent',
  warning: 'text-warning',
  danger: 'text-danger',
  success: 'text-success',
};

/**
 * Pill **somente ícone** (pedido de produto: manter o botão do objetivo sem
 * texto). Estado é comunicado por cor do ícone, spinner durante a rodada e
 * `aria-label`/tooltip completos; rounds/detalhes ficam no popover.
 */
const ICON_PILL_CLASS_NAME =
  'flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-60';

/** Rótulo de atenção curto para o `title` do pill (motivo de pausa/bloqueio). */
function statusHint(
  status: GoalStatus,
  pauseReason: string | null,
  blockerReason: string | null | undefined,
) {
  if (status === 'paused') return pauseReason ?? 'Objetivo pausado';
  if (status === 'blocked') return blockerReason ?? 'Objetivo bloqueado';
  if (status === 'completed') return 'Objetivo concluído';
  return null;
}

export interface GoalControlsProps {
  conversationId: string;
  className?: string;
  /**
   * Intenção `/goal` do turno (badge no campo), controlada pelo `Composer`.
   * Sem as props, o botão sem objetivo mantém o fallback
   * `requestGoalCreation()` (evento `zylara:goal-intent`).
   */
  goalIntent?: boolean;
  /** Alterna a intenção `/goal`; ausente ⇒ fallback `requestGoalCreation()`. */
  onToggleGoalIntent?: () => void;
}

/**
 * Controle do objetivo no composer: pill de estado + popover com o `GoalCard`
 * completo (resumo, progresso e ações) e os atalhos "Abrir objetivo"/"Editar".
 */
export function GoalControls({
  conversationId,
  className,
  goalIntent = false,
  onToggleGoalIntent,
}: GoalControlsProps) {
  const session = useCodeStore((state) => state.byConversation[conversationId]);
  const streaming = useChatStore((state) => state.streaming);
  const activeId = useChatStore((state) => state.activeId);
  const loadGoalRounds = useCodeStore((state) => state.loadGoalRounds);
  const updateGoal = useCodeStore((state) => state.updateGoal);
  const openGoalDialog = useUiStore((state) => state.openGoalDialog);
  const openCodeGoal = useUiStore((state) => state.openCodeGoal);
  const reduceMotion = useReduceMotion();

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);

  const goal = session?.goal ?? null;
  const goalRounds = session?.goalRounds ?? EMPTY_ROUNDS;
  const busy = pending || (session?.goalStarting ?? false);
  const running = goalIsRunning(
    goal,
    streaming !== null,
    streaming?.turnKind,
    streaming?.conversationId,
    conversationId,
  );
  const tone = goalStatusTone(goal);
  const statusLabel = goal ? goalStatusLabel(goal, running) : '';
  const roundLabel = goalRoundLabel(goal);
  const pauseHint = goal ? statusHint(goal.status, goalPauseReasonLabel(goal.pauseReason), goal.blockerReason) : null;
  const canStart = goal
    ? canStartGoalRound({
        goal,
        planMode: session?.planMode ?? false,
        approvalCount: session?.approvals.length ?? 0,
        questionCount: session?.questions.length ?? 0,
        streaming: streaming !== null,
        activeId,
        conversationId,
      })
    : false;

  // O objetivo sumiu (encerrado em outra superfície): fecha o popover e a
  // confirmação pendente para não agir sobre um alvo que não existe mais.
  useEffect(() => {
    if (goal) return;
    setOpen(false);
    setConfirmComplete(false);
  }, [goal]);

  // Histórico recente do card/popover: recarrega ao abrir e quando o estado do
  // objetivo muda (nova rodada, fim de rodada, edição...).
  const goalCreatedAt = goal?.createdAt ?? null;
  const goalRevision = goal?.revision ?? null;
  useEffect(() => {
    if (!open || goalCreatedAt === null) return;
    void loadGoalRounds(conversationId);
  }, [open, conversationId, goalCreatedAt, goalRevision, loadGoalRounds]);

  /** Sem objetivo: `/goal` preenche o composer; o agente cria a partir da mensagem. */
  const startGoalCreation = () => {
    requestGoalCreation();
  };

  const openEditDialog = () => {
    setOpen(false);
    openGoalDialog({ conversationId, mode: 'edit' });
  };

  const openPanel = () => {
    setOpen(false);
    openCodeGoal();
  };

  const applyAction = async (action: GoalAction) => {
    if (busy) return;
    setPending(true);
    try {
      await updateGoal(conversationId, action);
    } finally {
      setPending(false);
    }
  };

  const startRound = async () => {
    if (busy) return;
    setPending(true);
    try {
      await useChatStore.getState().runGoalRound(conversationId);
    } finally {
      setPending(false);
    }
  };

  const confirmCompletion = async () => {
    if (busy) return;
    setPending(true);
    try {
      const ok = await updateGoal(conversationId, 'complete');
      if (ok) setConfirmComplete(false);
    } finally {
      setPending(false);
    }
  };

  const handleCardAction = (action: GoalCardAction) => {
    if (busy) return;
    switch (action) {
      case 'pause':
      case 'resume':
      case 'arm':
      case 'disarm':
      case 'reopen':
        void applyAction(action);
        return;
      case 'start_round':
        void startRound();
        return;
      case 'complete':
        setConfirmComplete(true);
        return;
      case 'edit':
        openEditDialog();
        return;
      case 'delete':
        // Encerrar é ação destrutiva do diálogo de edição, nunca do popover.
        return;
      default:
        return;
    }
  };

  /** Durante a rodada: desarma a continuidade (ou pausa, se já é manual). */
  const pauseAfterRound = () => {
    void applyAction(goal?.autoContinue ? 'disarm' : 'pause');
  };

  if (!goal) {
    /** Barra: mesmo toggle do modo Plano; sem handler próprio, dispara o evento. */
    const toggleGoalIntent = () => {
      if (onToggleGoalIntent) {
        onToggleGoalIntent();
        return;
      }
      startGoalCreation();
    };

    return (
      <div className={cn('flex items-center', className)}>
        <Tooltip
          side="top"
          content={
            goalIntent
              ? 'Objetivo ativo — clique para desativar'
              : 'Criar objetivo: use /goal e descreva a tarefa na próxima mensagem.'
          }
        >
          <button
            type="button"
            aria-label={goalIntent ? 'Desativar objetivo' : 'Criar objetivo com /goal'}
            aria-pressed={goalIntent}
            onClick={toggleGoalIntent}
            className={cn(
              ICON_PILL_CLASS_NAME,
              goalIntent
                ? 'border-accent/40 bg-accent-soft'
                : 'border-border bg-transparent text-foreground-muted hover:bg-surface-hover hover:text-foreground',
            )}
          >
            <Target
              aria-hidden
              className={cn('size-3.5 shrink-0', goalIntent ? 'text-accent' : undefined)}
              strokeWidth={1.75}
            />
          </button>
        </Tooltip>
      </div>
    );
  }

  const toneClass = TONE_PILL[tone];

  return (
    <div className={cn('flex items-center', className)}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirmComplete(false);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Objetivo: ${statusLabel} — ${roundLabel}`}
            title={pauseHint ?? `${statusLabel} — ${roundLabel}`}
            className={cn(ICON_PILL_CLASS_NAME, toneClass)}
          >
            {running && !reduceMotion ? (
              <Spinner size="xs" className={cn('shrink-0', TONE_ICON[tone])} />
            ) : (
              <Target
                aria-hidden
                className={cn('size-3.5 shrink-0', TONE_ICON[tone])}
                strokeWidth={1.75}
              />
            )}
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          side="top"
          sideOffset={8}
          collisionPadding={12}
          className="w-96 max-w-[calc(100vw-2rem)] p-0"
        >
          <div
            aria-busy={busy || running || undefined}
            className="flex max-h-[min(70vh,34rem)] flex-col gap-2 overflow-y-auto overscroll-contain p-2"
          >
            {running ? (
              <p
                role="status"
                className="flex items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 py-1.5 text-[11px] font-medium leading-relaxed text-foreground"
              >
                <Spinner size="xs" className="shrink-0 text-accent" />
                <span className="min-w-0 break-words">
                  Rodada em andamento — o agente está trabalhando no objetivo.
                </span>
              </p>
            ) : null}

            <GoalCard
              goal={goal}
              rounds={goalRounds}
              busy={busy || running}
              onAction={running ? undefined : handleCardAction}
              onOpen={openPanel}
            />

            {confirmComplete ? (
              <div
                role="status"
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-2.5 py-2"
              >
                <p className="text-[12px] leading-relaxed text-foreground">
                  Concluir o objetivo? O agente para de continuar sozinho nesta sessão.
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="primary"
                    aria-label="Confirmar conclusão do objetivo"
                    loading={pending}
                    disabled={busy}
                    onClick={() => void confirmCompletion()}
                  >
                    Concluir objetivo
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setConfirmComplete(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : null}

            {running ? (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pending}
                  disabled={busy}
                  onClick={pauseAfterRound}
                >
                  Pausar após esta rodada
                </Button>
                <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-foreground-subtle">
                  A rodada atual termina antes de pausar.
                </span>
              </div>
            ) : goal.status === 'active' && goal.autoContinue ? (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pending}
                  disabled={busy || !canStart}
                  title={
                    canStart
                      ? undefined
                      : 'Indisponível enquanto houver plano, aprovação/pergunta pendente ou orçamento esgotado.'
                  }
                  onClick={() => void startRound()}
                >
                  Nova rodada agora
                </Button>
              </div>
            ) : null}

            <p className="px-0.5 text-[11px] leading-relaxed text-foreground-subtle">
              Cada rodada é um turno completo e consome tokens do provedor.
            </p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
