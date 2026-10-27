/**
 * Cards de apresentação das tools do harness de código na timeline
 * (`docs/goals/code-harness/WORKBENCH.md` §5.2). O backend persiste o campo
 * `presentation` em cada `ToolCallRecord` (diff, tarefas, plano, job, respostas);
 * este componente transforma o JSON opaco em UI tipada.
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { JobsBar, PlanCard, TodoCard } from '@/components/agent';
import { DiffView } from '@/components/code/DiffView';
import type { ToolPresentation } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ToolPresentationCardProps {
  presentation: ToolPresentation;
  className?: string;
}

/** Um card por apresentação persistida; desconhecidos são ignorados. */
export function ToolPresentationCard({ presentation, className }: ToolPresentationCardProps) {
  switch (presentation.kind) {
    case 'file_change':
      return <FileChangeCard presentation={presentation} className={className} />;
    case 'todos':
      return <TodoCard todos={presentation.items} className={className} />;
    case 'plan':
      return <PlanCard plan={presentation.plan} onAction={() => undefined} className={className} />;
    case 'job':
      return <JobsBar jobs={[presentation.job]} className={className} />;
    case 'answers': {
      if (presentation.skipped || presentation.answers.length === 0) {
        return (
          <p className={cn('text-[12px] text-foreground-muted', className)}>
            O usuário preferiu não responder agora.
          </p>
        );
      }
      return (
        <div
          className={cn(
            'rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-foreground-muted',
            className,
          )}
        >
          <p className="font-medium text-foreground">Respostas do usuário</p>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
            {presentation.answers.map((answer) => (
              <li key={answer.questionId}>
                {[answer.selected.join(', '), answer.custom].filter(Boolean).join(' · ')}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case 'changes':
      return (
        <div
          className={cn(
            'rounded-lg border border-border bg-surface px-3 py-2 text-[12px]',
            className,
          )}
        >
          <p className="font-medium text-foreground">
            {presentation.files.length} arquivo(s) alterado(s)
          </p>
          <p className="mt-0.5 tabular-nums text-foreground-muted">
            <span className="text-success">+{presentation.added}</span>{' '}
            <span className="text-danger">−{presentation.removed}</span>
          </p>
        </div>
      );
    case 'subagent':
      return (
        <div
          className={cn(
            'rounded-lg border border-border bg-surface px-3 py-2 text-[12px]',
            className,
          )}
        >
          <p className="font-medium text-foreground">
            Subagente {presentation.subagentType}
          </p>
          <p className="mt-0.5 text-foreground-muted">{presentation.description}</p>
        </div>
      );
    default:
      return null;
  }
}

function FileChangeCard({
  presentation,
  className,
}: {
  presentation: Extract<ToolPresentation, { kind: 'file_change' }>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasDiff = Boolean(presentation.diff?.trim());
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
          {presentation.change === 'created' ? 'Criou' : 'Alterou'} {presentation.path}
        </span>
        <span className="shrink-0 tabular-nums">
          <span className="text-success">+{presentation.added}</span>{' '}
          <span className="text-danger">−{presentation.removed}</span>
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
          <DiffView path={presentation.path} diff={presentation.diff ?? ''} />
        </div>
      ) : null}
    </div>
  );
}

/** Lista as apresentações de um turno (fora do bloco recolhível de passos). */
export function ToolPresentations({ presentations }: { presentations: ToolPresentation[] }) {
  if (presentations.length === 0) return null;
  return (
    <div className="mb-3 mt-2 flex flex-col gap-2">
      {presentations.map((presentation, index) => (
        <ToolPresentationCard key={index} presentation={presentation} />
      ))}
    </div>
  );
}
