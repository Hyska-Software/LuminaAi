import { useId, useState, type KeyboardEvent } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, ListChecks } from 'lucide-react';
import { Markdown } from '@/components/chat/Markdown';
import { Badge, Button, Spinner, Textarea } from '@/components/ui';
import type { PlanView } from '@/lib/types';
import { cn, relativeTime } from '@/lib/utils';

/** Saídas do card de plano (WORKBENCH §5.4). */
export type PlanAction = 'approve_run' | 'approve_review' | 'keep_planning';

export interface PlanCardProps {
  plan: PlanView;
  onAction: (action: PlanAction, feedback?: string) => void;
  className?: string;
}

/**
 * Card do modo Plano: Markdown do plano + gate de aprovação. Depois de
 * aprovado vira uma linha compacta com "Ver plano" (o conteúdo continua
 * acessível na timeline). Puramente apresentacional.
 */
export function PlanCard({ plan, onAction, className }: PlanCardProps) {
  const contentId = useId();
  const feedbackId = useId();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [expanded, setExpanded] = useState(false);

  const markdown = plan.markdown?.trim() ?? '';
  const reviewing = plan.state === 'reviewing';
  const approved = plan.state === 'approved';
  const planning = plan.state === 'planning';

  if (plan.state === 'inactive' && !markdown) return null;

  const submitFeedback = () => {
    const value = feedback.trim();
    setFeedbackOpen(false);
    setFeedback('');
    onAction('keep_planning', value ? value : undefined);
  };

  const handleFeedbackKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submitFeedback();
    }
  };

  if (approved) {
    return (
      <div
        className={cn(
          'flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-2',
          className,
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <CheckCircle2 aria-hidden className="size-4 shrink-0 text-success" />
          <span className="min-w-0 flex-1 text-[13px] font-medium text-foreground">
            Plano aprovado
          </span>
          <span className="text-[11px] text-foreground-subtle">{relativeTime(plan.updatedAt)}</span>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded((value) => !value)}
            rightIcon={
              expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />
            }
          >
            Ver plano
          </Button>
        </div>
        {expanded ? (
          <div id={contentId} className="border-t border-border pt-2">
            <PlanMarkdown markdown={markdown} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section
      aria-label="Plano do agente"
      className={cn('flex flex-col gap-3 rounded-xl border border-border bg-surface p-3', className)}
    >
      <header className="flex flex-wrap items-center gap-2">
        <ListChecks aria-hidden className="size-4 shrink-0 text-accent" />
        <h3 className="min-w-0 flex-1 text-[13px] font-medium text-foreground">
          {planning ? 'Plano em preparação' : 'Plano proposto'}
        </h3>
        {planning ? <Spinner size="xs" label="Planejando" /> : null}
        {reviewing ? <Badge variant="accent">Aguardando aprovação</Badge> : null}
        <span className="text-[11px] text-foreground-subtle">{relativeTime(plan.updatedAt)}</span>
      </header>

      <div id={contentId} className="min-w-0">
        <PlanMarkdown markdown={markdown} />
      </div>

      {reviewing ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => onAction('approve_run')}>
              Aprovar e executar
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onAction('approve_review')}>
              Aprovar e revisar cada edição
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={feedbackOpen}
              aria-controls={feedbackId}
              onClick={() => setFeedbackOpen((value) => !value)}
            >
              Continuar planejando
            </Button>
          </div>

          {feedbackOpen ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2">
              <label htmlFor={feedbackId} className="text-[11px] font-medium text-foreground-muted">
                O que ajustar no plano? (opcional)
              </label>
              <Textarea
                id={feedbackId}
                rows={3}
                autoFocus
                value={feedback}
                placeholder="Ex.: inclua testes para o caso de erro e não toque em migrations"
                onChange={(event) => setFeedback(event.target.value)}
                onKeyDown={handleFeedbackKeyDown}
              />
              <div className="flex items-center justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setFeedbackOpen(false)}>
                  Cancelar
                </Button>
                <Button size="sm" variant="secondary" onClick={submitFeedback}>
                  Enviar feedback
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function PlanMarkdown({ markdown }: { markdown: string }) {
  if (!markdown) {
    return (
      <p className="text-[12px] leading-relaxed text-foreground-subtle">
        O plano ainda não tem conteúdo.
      </p>
    );
  }
  return <Markdown content={markdown} className="text-[13px]" />;
}
