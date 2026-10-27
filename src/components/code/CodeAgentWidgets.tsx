/**
 * Widgets de integração do harness de código no chat/Code layout.
 *
 * Os cards em `src/components/agent/**` são puramente apresentacionais; este
 * arquivo é o container que lê o `codeStore` (aprovações/plano/tarefas/jobs) e
 * envia as decisões pelo `api` — mantendo o `ChatView` livre de regras de
 * sessão (docs/goals/code-harness/WORKBENCH.md §5).
 */
import { useState } from 'react';

import {
  ApprovalCard,
  AskUserCard,
  ContextMeter,
  JobsBar,
  PlanCard,
  TodoCard,
  type ApprovalDecisionOptions,
  type PlanAction,
} from '@/components/agent';
import { useCodeStore } from '@/lib/store';
import type { ApprovalDecision, ApprovalRequest, PlanView } from '@/lib/types';

/** Aprovações, plano e tarefas da sessão de código ativa. */
export function CodeSessionCards({ conversationId }: { conversationId: string }) {
  const session = useCodeStore((state) => state.byConversation[conversationId]);
  const respondApproval = useCodeStore((state) => state.respondApproval);
  const respondQuestion = useCodeStore((state) => state.respondQuestion);
  const [responding, setResponding] = useState<string | null>(null);

  if (!session) return null;
  const planApprovals = session.approvals.filter((approval) => approval.tool === 'submit_plan');
  const otherApprovals = session.approvals.filter((approval) => approval.tool !== 'submit_plan');
  if (
    planApprovals.length === 0 &&
    otherApprovals.length === 0 &&
    session.questions.length === 0 &&
    session.todos.length === 0
  ) {
    return null;
  }

  const decide = async (
    approval: ApprovalRequest,
    decision: ApprovalDecision,
    options?: ApprovalDecisionOptions,
  ) => {
    setResponding(approval.id);
    try {
      await respondApproval(conversationId, approval.id, decision, {
        scope: options?.scope ?? null,
        feedback: options?.feedback ?? null,
      });
    } finally {
      setResponding(null);
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-3" aria-live="polite">
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
        };
        return (
          <PlanCard
            key={approval.id}
            plan={plan}
            onAction={(action: PlanAction, feedback?: string) => {
              if (action === 'keep_planning') {
                void decide(approval, 'denied', {
                  feedback: feedback?.trim() || 'Continue planejando.',
                });
                return;
              }
              void decide(approval, 'approved');
            }}
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
      {session.todos.length > 0 ? <TodoCard todos={session.todos} /> : null}
    </div>
  );
}

/** Array estável: um `?? []` dentro do seletor do zustand causaria loop. */
const EMPTY_JOBS: readonly import('@/lib/types').JobView[] = [];

/** Jobs de processo em background da sessão ativa (acima do composer). */
export function CodeJobsBar({ conversationId }: { conversationId: string }) {
  const jobs = useCodeStore(
    (state) => state.byConversation[conversationId]?.jobs ?? EMPTY_JOBS,
  );
  const killJob = useCodeStore((state) => state.killJob);
  const refreshJobs = useCodeStore((state) => state.refreshJobs);
  if (jobs.length === 0) return null;
  return (
    <JobsBar
      jobs={jobs as import('@/lib/types').JobView[]}
      onKill={(jobId) => {
        void killJob(conversationId, jobId);
      }}
      onOpen={() => {
        void refreshJobs(conversationId);
      }}
    />
  );
}

/** Medidor de contexto do header (compacto). */
export function CodeContextMeterChip({ conversationId }: { conversationId: string }) {
  const stats = useCodeStore((state) => state.byConversation[conversationId]?.context);
  if (!stats) return null;
  return (
    <div className="hidden min-w-32 lg:block">
      <ContextMeter stats={stats} />
    </div>
  );
}
