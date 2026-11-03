/**
 * Widgets de integração do harness de código no chat/Code layout.
 *
 * Os cards em `src/components/agent/**` são puramente apresentacionais; este
 * arquivo é o container que lê o `codeStore` (aprovações/plano/tarefas/jobs) e
 * envia as decisões pelo `api` — mantendo o `ChatView` livre de regras de
 * sessão (docs/goals/code-harness/WORKBENCH.md §5).
 */
import { useRef, useState } from 'react';

import {
  ApprovalCard,
  AskUserCard,
  CacheHitChip,
  ContextMeter,
  GoalAttentionCard,
  PlanCard,
  type ApprovalDecisionOptions,
  type PlanAction,
} from '@/components/agent';
import { goalNeedsAttention } from '@/lib/goalRunner';
import { Button } from '@/components/ui';
import { useAppStore, useCodeStore, useUiStore } from '@/lib/store';
import { useCacheStore } from '@/lib/store/cacheStore';
import type {
  ApprovalDecision,
  ApprovalRequest,
  GoalView,
  PlanApprovalChoice,
  PlanView,
} from '@/lib/types';

/** Motivo que impede criar um novo Goal sem sobrescrever o atual. */
function goalExecutionBlocker(goal: GoalView | null | undefined): string | null {
  if (!goal || goal.status === 'completed') return null;
  const status =
    goal.status === 'active' ? 'ativo' : goal.status === 'paused' ? 'pausado' : 'bloqueado';
  return `Esta sessão já tem um objetivo ${status}. Conclua ou encerre o objetivo atual antes de executar o plano como objetivo.`;
}

/**
 * Aprovações, plano e perguntas da sessão de código ativa.
 *
 * Tarefas não moram mais aqui: o `TodoCard` fixo no fim do transcript era
 * duplicado com as apresentações da timeline (F-08). O estado atual vive no
 * popover "Plano e tarefas" do composer.
 */
export function CodeSessionCards({ conversationId }: { conversationId: string }) {
  const session = useCodeStore((state) => state.byConversation[conversationId]);
  const respondApproval = useCodeStore((state) => state.respondApproval);
  const respondQuestion = useCodeStore((state) => state.respondQuestion);
  const layoutMode = useUiStore((state) => state.layoutMode);
  const [responding, setResponding] = useState<string | null>(null);
  /** Ação do objetivo aplicando (dispensa duplo clique nas ações do card). */
  const [goalBusy, setGoalBusy] = useState(false);
  /** Guard síncrono contra duplo submit (o estado do React é assíncrono). */
  const submittingRef = useRef<string | null>(null);

  if (!session) return null;
  const planApprovals = session.approvals.filter((approval) => approval.tool === 'submit_plan');
  const otherApprovals = session.approvals.filter((approval) => approval.tool !== 'submit_plan');
  const goal = session.goal;
  const goalBlocker = goalExecutionBlocker(goal);
  /* Card de atenção do objetivo (PLAN §10.5): só para estados que exigem decisão
     humana e enquanto esta revisão não foi dispensada pelo usuário. */
  const showGoalAttention = Boolean(
    goal && goalNeedsAttention(goal) && goal.revision !== session.dismissedGoalRevision,
  );
  if (
    planApprovals.length === 0 &&
    otherApprovals.length === 0 &&
    session.questions.length === 0 &&
    !showGoalAttention
  ) {
    return null;
  }

  const applyGoalAction = async (run: () => Promise<unknown>) => {
    if (goalBusy) return;
    setGoalBusy(true);
    try {
      await run();
    } finally {
      setGoalBusy(false);
    }
  };

  const decide = async (
    approval: ApprovalRequest,
    decision: ApprovalDecision,
    options?: ApprovalDecisionOptions & {
      choice?: PlanApprovalChoice | null;
    },
  ) => {
    // Duplo clique / dois listeners no mesmo gate: só a primeira decisão vale.
    if (submittingRef.current) return;
    submittingRef.current = approval.id;
    setResponding(approval.id);
    try {
      // O store faz o refresh e o toast quando o backend responde `false`
      // (aprovação já resolvida/expirada) — ver `codeStore.respondApproval`.
      await respondApproval(conversationId, approval.id, decision, {
        scope: options?.scope ?? null,
        feedback: options?.feedback ?? null,
        choice: options?.choice ?? null,
      });
    } finally {
      submittingRef.current = null;
      setResponding(null);
    }
  };

  const handlePlanAction = (
    approval: ApprovalRequest,
    action: PlanAction,
    feedback?: string,
  ) => {
    if (action === 'keep_planning') {
      void decide(approval, 'denied', {
        feedback: feedback?.trim() || 'Continue planejando.',
      });
      return;
    }
    const choice: PlanApprovalChoice =
      action === 'approve_goal'
        ? 'approve_goal'
        : action === 'approve_review'
          ? 'approve_review'
          : 'approve_run';
    void decide(approval, 'approved', { choice });
  };

  const announcement =
    planApprovals.length > 0
      ? 'Plano aguardando aprovação.'
      : otherApprovals.length > 0
        ? 'Aprovação necessária.'
        : session.questions.length > 0
          ? 'O agente fez uma pergunta.'
          : '';

  return (
    <div className="mt-3 flex flex-col gap-3">
      {announcement ? (
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      ) : null}
      {otherApprovals.map((approval) => (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          responding={responding === approval.id}
          onDecide={(decision, options) => {
            void decide(approval, decision, options);
          }}
        />
      ))}
      {planApprovals.map((approval) => {
        const plan: PlanView = {
          state: 'reviewing',
          markdown: approval.preview ?? '',
          updatedAt: approval.createdAt,
          feedback: null,
        };
        return (
          <PlanCard
            key={approval.id}
            plan={plan}
            busy={responding === approval.id}
            goalBlockedReason={goalBlocker}
            onAction={(action, feedback) => handlePlanAction(approval, action, feedback)}
          />
        );
      })}
      {session.questions.map((request) => {
        const assistance = request.questions.find(
          (question) => question.header === 'computer_desktop' || question.header === 'computer_browser',
        );
        return (
          <div key={request.id} className="flex flex-col gap-2">
            <AskUserCard
              questions={request.questions.map((question) => ({
                id: question.id,
                question: question.question,
                options: question.options.map((option) => ({
                  label: option.label,
                  description: option.description ?? undefined,
                })),
                multi: question.multiSelect ?? false,
                allowFreeText: !assistance,
              }))}
              onSubmit={(answers) => {
                void respondQuestion(
                  conversationId,
                  request.id,
                  answers.map((answer) => ({
                    questionId: answer.questionId,
                    selected: answer.selected,
                    custom: answer.freeText ?? null,
                  })),
                  false,
                );
              }}
              onSkip={() => {
                void respondQuestion(conversationId, request.id, [], true);
              }}
            />
            {assistance && layoutMode === 'agent' ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => {
                  const ui = useUiStore.getState();
                  ui.setAgentRightPanel('agent');
                  ui.setAgentPanelTab(assistance.header === 'computer_browser' ? 'browser' : 'screen');
                  ui.setAgentPanelOpen(true);
                }}>Abrir ambiente para ajudar</Button>
                <span className="text-[11px] text-foreground-muted">Assuma e devolva o controle no painel antes de responder.</span>
              </div>
            ) : null}
          </div>
        );
      })}
      {showGoalAttention && goal ? (
        <GoalAttentionCard
          goal={goal}
          busy={goalBusy}
          onResume={() =>
            void applyGoalAction(() =>
              useCodeStore.getState().updateGoal(conversationId, 'resume'),
            )
          }
          onExtend={() =>
            useUiStore.getState().openGoalDialog({ conversationId, mode: 'edit' })
          }
          onComplete={() =>
            void applyGoalAction(() =>
              useCodeStore.getState().updateGoal(conversationId, 'complete'),
            )
          }
          onReopen={() =>
            void applyGoalAction(() =>
              useCodeStore.getState().updateGoal(conversationId, 'reopen'),
            )
          }
          onOpen={() => useUiStore.getState().openCodeGoal()}
          onDismiss={() =>
            useCodeStore.getState().dismissGoalAttention(conversationId, goal.revision)
          }
        />
      ) : null}
    </div>
  );
}

/**
 * Medidor do header: chip compacto com anel de contexto + `%` de cache.
 *
 * O `cacheStore` é a fonte do cache (evento `cache_stats` por request +
 * restauração via `get_cache_stats`); `Settings.cache.showIndicator` só
 * esconde o indicador, a medição continua. Sem contexto (payload antigo ou
 * sessão sem snapshot) o chip cai para a variante cache-first. O container não
 * esconde mais o medidor abaixo de 1024px (`hidden lg:block` removido): o
 * requisito é mostrar em tempo real, então ele encolhe/reserva largura em vez
 * de sumir.
 */
export function CodeContextMeterChip({ conversationId }: { conversationId: string }) {
  const stats = useCodeStore((state) => state.byConversation[conversationId]?.context);
  const cache = useCacheStore((state) => state.byConversation[conversationId] ?? null);
  const showCacheIndicator = useAppStore(
    (state) => state.settings.cache?.showIndicator !== false,
  );
  const showCache = showCacheIndicator && cache != null;

  if (!stats) {
    if (!showCache) return null;
    return (
      <div className="hidden sm:block">
        <CacheHitChip cache={cache} />
      </div>
    );
  }

  return (
    <div className="hidden sm:block">
      <ContextMeter stats={stats} cache={showCache ? cache : undefined} />
    </div>
  );
}
