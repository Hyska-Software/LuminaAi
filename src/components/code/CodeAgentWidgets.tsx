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
  ContextMeter,
  PlanCard,
  type ApprovalDecisionOptions,
  type PlanAction,
} from '@/components/agent';
import { useCodeStore } from '@/lib/store';
import type {
  ApprovalDecision,
  ApprovalRequest,
  PlanApprovalChoice,
  PlanView,
} from '@/lib/types';

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
  const [responding, setResponding] = useState<string | null>(null);
  /** Guard síncrono contra duplo submit (o estado do React é assíncrono). */
  const submittingRef = useRef<string | null>(null);

  if (!session) return null;
  const planApprovals = session.approvals.filter((approval) => approval.tool === 'submit_plan');
  const otherApprovals = session.approvals.filter((approval) => approval.tool !== 'submit_plan');
  if (planApprovals.length === 0 && otherApprovals.length === 0 && session.questions.length === 0) {
    return null;
  }

  const decide = async (
    approval: ApprovalRequest,
    decision: ApprovalDecision,
    options?: ApprovalDecisionOptions & {
      choice?: PlanApprovalChoice | null;
      planMarkdown?: string | null;
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
        planMarkdown: options?.planMarkdown ?? null,
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
    planMarkdown?: string,
  ) => {
    if (action === 'keep_planning') {
      void decide(approval, 'denied', {
        feedback: feedback?.trim() || 'Continue planejando.',
      });
      return;
    }
    const choice: PlanApprovalChoice =
      action === 'approve_review' ? 'approve_review' : 'approve_run';
    const edited = planMarkdown?.trim();
    void decide(approval, 'approved', {
      choice,
      planMarkdown: edited ? edited : null,
    });
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
            onAction={(action, feedback, planMarkdown) =>
              handlePlanAction(approval, action, feedback, planMarkdown)
            }
          />
        );
      })}
      {session.questions.map((request) => (
        <AskUserCard
          key={request.id}
          questions={request.questions.map((question) => ({
            id: question.id,
            question: question.question,
            options: question.options.map((option) => ({
              label: option.label,
              description: option.description ?? undefined,
            })),
            multi: question.multiSelect ?? false,
            allowFreeText: true,
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
      ))}
    </div>
  );
}

/** Medidor de contexto do header (chip compacto com anel + popover). */
export function CodeContextMeterChip({ conversationId }: { conversationId: string }) {
  const stats = useCodeStore((state) => state.byConversation[conversationId]?.context);
  if (!stats) return null;
  return (
    <div className="hidden lg:block">
      <ContextMeter stats={stats} />
    </div>
  );
}
