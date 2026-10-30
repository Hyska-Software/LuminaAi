/**
 * Cards de apresentação das tools do harness de código na timeline
 * (`docs/goals/code-harness/WORKBENCH.md` §5.2). O backend persiste o campo
 * `presentation` em cada `ToolCallRecord` (diff, tarefas, plano, job, respostas);
 * este componente transforma o JSON opaco em UI tipada.
 *
 * Contrato (`TOOLS.md` §1.1, decisão D1): as apresentações de plano e objetivo
 * são **flat** — `{kind:"plan", ...}` / `{kind:"goal", ...GoalView}`. Payloads
 * antigos/aninhados continuam renderizando; payloads inválidos degradam para
 * uma linha curta em vez de derrubar a App (`PresentationBoundary`).
 */
import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import { GoalCard } from './GoalCard';
import { JobsBar } from './JobsBar';
import { PlanCard } from './PlanCard';
import { TodoCard } from './TodoCard';
import { DiffView } from '@/components/code/DiffView';
import type {
  AskUserAnswer,
  FileChangeKind,
  GoalOrigin,
  GoalPauseReason,
  GoalStatus,
  GoalView,
  JobView,
  PlanState,
  PlanView,
  TodoItem,
  ToolPresentation,
} from '@/lib/types';
import { cn } from '@/lib/utils';

export interface ToolPresentationCardProps {
  presentation: ToolPresentation;
  className?: string;
}

const PLAN_STATES: readonly PlanState[] = ['inactive', 'planning', 'reviewing', 'approved'];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Normaliza a apresentação de plano para `PlanView`.
 *
 * Aceita o formato canônico flat, o formato legado aninhado
 * (`{plan: {...}}`, nunca emitido pelo backend mas defensivo) e payloads sem
 * `markdown` (histórico antigo). Retorna `null` quando o estado é inválido —
 * o card precisa degradar, não receber `undefined`.
 */
export function normalizePlanPresentation(raw: unknown): PlanView | null {
  const value = asRecord(raw);
  if (!value) return null;
  const nested = asRecord(value.plan);
  const source = nested ?? value;
  const state = source.state;
  if (typeof state !== 'string' || !PLAN_STATES.includes(state as PlanState)) return null;
  return {
    state: state as PlanState,
    markdown: typeof source.markdown === 'string' ? source.markdown : null,
    feedback: nonEmptyString(source.feedback),
    updatedAt: finiteNumber(source.updatedAt, Date.now()),
  };
}

const GOAL_STATUSES: readonly GoalStatus[] = ['active', 'paused', 'completed', 'blocked'];
const GOAL_PAUSE_REASONS: readonly GoalPauseReason[] = [
  'user',
  'error',
  'max_rounds',
  'stalled',
  'interrupted',
];

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function finiteInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/**
 * Normaliza a apresentação de objetivo para `GoalView`.
 *
 * Aceita o formato canônico flat (`{kind:"goal", ...GoalView}`), o formato
 * legado aninhado (`{goal: {...}}`) e payloads incompletos. Campos numéricos
 * inválidos caem em defaults seguros e o limite de rodadas respeita o backend
 * (1..100). Retorna `null` quando o status é inválido — o card precisa degradar,
 * nunca receber um `GoalView` pela metade.
 */
export function normalizeGoalPresentation(raw: unknown): GoalView | null {
  const value = asRecord(raw);
  if (!value) return null;
  const nested = asRecord(value.goal);
  const source = nested ?? value;
  const status = source.status;
  if (typeof status !== 'string' || !GOAL_STATUSES.includes(status as GoalStatus)) return null;

  const pauseReasonRaw = source.pauseReason;
  const pauseReason =
    typeof pauseReasonRaw === 'string' &&
    GOAL_PAUSE_REASONS.includes(pauseReasonRaw as GoalPauseReason)
      ? (pauseReasonRaw as GoalPauseReason)
      : null;
  const origin: GoalOrigin = source.origin === 'agent' ? 'agent' : 'user';
  const maxRounds = Math.min(Math.max(finiteInteger(source.maxRounds, 25), 1), 100);

  return {
    title: nonEmptyString(source.title) ?? 'Objetivo',
    objective: typeof source.objective === 'string' ? source.objective : '',
    status: status as GoalStatus,
    autoContinue: source.autoContinue === true,
    rounds: Math.max(0, finiteInteger(source.rounds, 0)),
    maxRounds,
    revision: Math.max(0, finiteInteger(source.revision, 0)),
    origin,
    createdAt: finiteNumber(source.createdAt, Date.now()),
    updatedAt: finiteNumber(source.updatedAt, Date.now()),
    completedAt: optionalFiniteNumber(source.completedAt) ?? null,
    lastRoundAt: optionalFiniteNumber(source.lastRoundAt) ?? null,
    lastNote: optionalString(source.lastNote),
    pauseReason,
    pauseDetail: optionalString(source.pauseDetail),
    blockerReason: optionalString(source.blockerReason),
    blockerStreak: optionalFiniteNumber(source.blockerStreak),
    stalledRounds: optionalFiniteNumber(source.stalledRounds),
    tokens: optionalFiniteNumber(source.tokens),
    cost: optionalFiniteNumber(source.cost),
  };
}

function normalizeTodos(raw: unknown): TodoItem[] | null {
  const value = asRecord(raw);
  const items = value?.items;
  if (!Array.isArray(items)) return null;
  const valid = items.flatMap((entry): TodoItem[] => {
    const item = asRecord(entry);
    const content = nonEmptyString(item?.content);
    const status = item?.status;
    if (!content) return [];
    if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') return [];
    return [{ content, status }];
  });
  // Lista não vazia mas 100% inválida é payload quebrado; lista vazia é válida
  // (o backend usa `[]` para limpar as tarefas).
  return items.length > 0 && valid.length === 0 ? null : valid;
}

function normalizeJob(raw: unknown): JobView | null {
  const job = asRecord(raw);
  const id = nonEmptyString(job?.id);
  const command = nonEmptyString(job?.command);
  const status = job?.status;
  if (!id || !command || typeof status !== 'string') return null;
  if (!['running', 'done', 'failed', 'killed'].includes(status)) return null;
  return {
    id,
    command,
    status: status as JobView['status'],
    startedAt: finiteNumber(job?.startedAt, Date.now()),
    durationMs: typeof job?.durationMs === 'number' ? job.durationMs : undefined,
    exitCode: typeof job?.exitCode === 'number' ? job.exitCode : null,
    outputPreview: typeof job?.outputPreview === 'string' ? job.outputPreview : null,
  };
}

function normalizeAnswers(raw: unknown): AskUserAnswer[] | null {
  const value = asRecord(raw);
  const answers = value?.answers;
  if (!Array.isArray(answers)) return null;
  return answers.flatMap((entry): AskUserAnswer[] => {
    const answer = asRecord(entry);
    const questionId = nonEmptyString(answer?.questionId);
    const selected = Array.isArray(answer?.selected)
      ? answer.selected.filter((value): value is string => typeof value === 'string')
      : [];
    if (!questionId) return [];
    return [
      {
        questionId,
        selected,
        custom: typeof answer?.custom === 'string' ? answer.custom : null,
      },
    ];
  });
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

const CHANGE_VERBS: Record<string, string> = {
  created: 'Criou',
  modified: 'Alterou',
  deleted: 'Removeu',
  renamed: 'Renomeou',
};

const SUBAGENT_LABELS: Record<string, string> = {
  explore: 'exploração',
  review: 'revisão',
  general: 'geral',
};

/** Linha degradada usada por payload inválido e pelo boundary de render. */
function DegradedPresentation({ kind }: { kind?: string }) {
  return (
    <p
      role="status"
      className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] leading-relaxed text-foreground-muted"
    >
      {kind === 'plan'
        ? 'Plano indisponível nesta versão.'
        : kind === 'goal'
          ? 'Objetivo indisponível nesta versão.'
          : 'Não foi possível mostrar esta apresentação.'}
    </p>
  );
}

interface PresentationBoundaryProps {
  children: ReactNode;
  kind?: string;
}

/**
 * ErrorBoundary local por apresentação: um payload persistido malformado nunca
 * derruba a janela inteira (o boundary global da App é o último recurso).
 */
export class PresentationBoundary extends Component<
  PresentationBoundaryProps,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Falha ao renderizar apresentação de tool', this.props.kind, error, info);
  }

  render() {
    if (this.state.failed) return <DegradedPresentation kind={this.props.kind} />;
    return this.props.children;
  }
}

/** Um card por apresentação persistida; desconhecidos são ignorados. */
export function ToolPresentationCard({ presentation, className }: ToolPresentationCardProps) {
  return (
    <PresentationBoundary kind={presentation?.kind}>
      <PresentationContent presentation={presentation} className={className} />
    </PresentationBoundary>
  );
}

function PresentationContent({ presentation, className }: ToolPresentationCardProps) {
  const kind = asRecord(presentation)?.kind;
  switch (kind) {
    case 'file_change': {
      const value = asRecord(presentation) ?? {};
      const path = nonEmptyString(value.path);
      if (!path) return <DegradedPresentation kind={kind} />;
      return <FileChangeCard presentation={presentation} className={className} />;
    }
    case 'todos': {
      const todos = normalizeTodos(presentation);
      if (!todos) return <DegradedPresentation kind={kind} />;
      return <TodoCard todos={todos} className={className} />;
    }
    case 'plan': {
      const plan = normalizePlanPresentation(presentation);
      if (!plan) return <DegradedPresentation kind={kind} />;
      // Timeline/histórico e popover são somente leitura: nunca renderizar
      // botões de aprovação que não têm efeito (F-22).
      return <PlanCard plan={plan} readOnly className={className} />;
    }
    case 'goal': {
      const goal = normalizeGoalPresentation(presentation);
      if (!goal) return <DegradedPresentation kind={kind} />;
      // Card compacto na timeline: resumo do estado, sem ações mortas.
      return <GoalCard goal={goal} compact readOnly className={className} />;
    }
    case 'job': {
      const job = normalizeJob(asRecord(presentation)?.job);
      if (!job) return <DegradedPresentation kind={kind} />;
      return <JobsBar jobs={[job]} className={className} />;
    }
    case 'answers': {
      const value = asRecord(presentation) ?? {};
      const skipped = value.skipped === true;
      const answers = normalizeAnswers(presentation);
      if (!answers) return <DegradedPresentation kind={kind} />;
      if (skipped) {
        return (
          <p className={cn('text-[12px] text-foreground-muted', className)}>
            Você preferiu não responder agora.
          </p>
        );
      }
      if (answers.length === 0) return <DegradedPresentation kind={kind} />;
      return (
        <div
          className={cn(
            'rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-foreground-muted',
            className,
          )}
        >
          <p className="font-medium text-foreground">Respostas do usuário</p>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
            {answers.map((answer) => (
              <li key={answer.questionId}>
                {[answer.selected.join(', '), answer.custom].filter(Boolean).join(' · ')}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case 'changes': {
      const value = asRecord(presentation) ?? {};
      const files = Array.isArray(value.files) ? value.files : null;
      if (!files) return <DegradedPresentation kind={kind} />;
      const count = files.length;
      return (
        <div
          className={cn('rounded-lg border border-border bg-surface px-3 py-2 text-[12px]', className)}
        >
          <p className="font-medium text-foreground">
            {count} {plural(count, 'arquivo alterado', 'arquivos alterados')}
          </p>
          <p className="mt-0.5 tabular-nums text-foreground-muted">
            <span className="text-success">+{finiteNumber(value.added)}</span>{' '}
            <span className="text-danger">−{finiteNumber(value.removed)}</span>
          </p>
        </div>
      );
    }
    case 'subagent': {
      const value = asRecord(presentation) ?? {};
      const type = nonEmptyString(value.subagentType);
      const description = nonEmptyString(value.description);
      if (!type || !description) return <DegradedPresentation kind={kind} />;
      const label = SUBAGENT_LABELS[type] ?? type;
      return (
        <div
          className={cn('rounded-lg border border-border bg-surface px-3 py-2 text-[12px]', className)}
        >
          <p className="font-medium text-foreground">Subagente de {label}</p>
          <p className="mt-0.5 text-foreground-muted">{description}</p>
        </div>
      );
    }
    default:
      // Kinds sem UI nesta fase (`output`, `terminal`) e desconhecidos.
      return null;
  }
}

function FileChangeCard({
  presentation,
  className,
}: {
  presentation: ToolPresentation;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const value = asRecord(presentation) ?? {};
  const path = nonEmptyString(value.path) ?? '';
  const change = typeof value.change === 'string' ? (value.change as FileChangeKind) : 'modified';
  const diff = typeof value.diff === 'string' ? value.diff : '';
  const hasDiff = Boolean(diff.trim());
  const verb = CHANGE_VERBS[change as unknown as string] ?? 'Alterou';
  return (
    <div className={cn('rounded-lg border border-border bg-surface', className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        )}
      >
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {verb} {path}
        </span>
        <span className="shrink-0 tabular-nums">
          <span className="text-success">+{finiteNumber(value.added)}</span>{' '}
          <span className="text-danger">−{finiteNumber(value.removed)}</span>
        </span>
        {hasDiff ? (
          <ChevronDown
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 text-foreground-subtle transition-transform duration-150',
              open && 'rotate-180',
            )}
          />
        ) : null}
      </button>
      {open && hasDiff ? (
        <div className="max-h-64 overflow-y-auto border-t border-border">
          <DiffView path={path} diff={diff} />
        </div>
      ) : null}
    </div>
  );
}
