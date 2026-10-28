import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, ListChecks, PencilLine } from 'lucide-react';
import { Markdown } from '@/components/chat/Markdown';
import { Badge, Button, Spinner, Textarea } from '@/components/ui';
import type { PlanView } from '@/lib/types';
import { cn, relativeTime } from '@/lib/utils';

/** Saídas do card de plano (WORKBENCH §5.4). */
export type PlanAction = 'approve_run' | 'approve_review' | 'keep_planning';

/** Teto do plano no backend (`submit_plan`): 20 000 caracteres. */
export const MAX_PLAN_CHARS = 20_000;

/** A partir deste tamanho o conteúdo é recolhido/rolável (WORKBENCH §5.2). */
const LONG_PLAN_CHARS = 1_200;

export interface PlanCardProps {
  /** Nunca `undefined`: payload inválido degrada para uma linha curta. */
  plan: PlanView | null;
  /**
   * Callback do gate interativo. `planMarkdown` é o texto revisado no editor
   * auxiliar (quando o usuário editou o plano antes de aprovar).
   */
  onAction?: (action: PlanAction, feedback?: string, planMarkdown?: string) => void;
  /** Somente leitura (timeline/histórico e popover): nunca mostra ações mortas. */
  readOnly?: boolean;
  /**
   * Quando presente, o botão "Ver plano" do estado aprovado abre o plano em
   * outra superfície (aba central do Code) em vez de expandir inline.
   */
  onViewPlan?: (plan: PlanView) => void;
  /** Enquanto o host envia a decisão: desabilita as ações e marca `aria-busy`. */
  busy?: boolean;
  className?: string;
}

/**
 * Card do modo Plano: Markdown do plano + gate de aprovação (WORKBENCH §5.4).
 *
 * - Interativo (gate ao vivo): `role="alertdialog"`, foco no botão primário,
 *   `Esc` fecha o feedback/editor ou devolve o plano (`keep_planning`),
 *   `aria-busy`/`disabled` durante o envio e anúncio `aria-live` curto.
 * - `readOnly` (timeline/popover): mesmas informações, **sem** botões — um
 *   card histórico não pode prometer ações que não existem.
 * - Plano editável antes de aprovar: textarea auxiliar (≤ 20 000), validação
 *   de não-vazio e `Ctrl+Enter` aprova com o markdown revisado.
 */
export function PlanCard({
  plan,
  onAction,
  readOnly = false,
  onViewPlan,
  busy = false,
  className,
}: PlanCardProps) {
  const titleId = useId();
  const contentId = useId();
  const feedbackId = useId();
  const editorId = useId();
  const editorErrorId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState('');
  // Recolhido por padrão no histórico quando o plano é longo.
  const [expanded, setExpanded] = useState(false);

  const markdown = plan?.markdown?.trim() ?? '';
  const persistedFeedback = plan?.feedback?.trim() ?? '';
  const state = plan?.state ?? 'inactive';
  const reviewing = state === 'reviewing';
  const approved = state === 'approved';
  const planning = state === 'planning';
  const interactive = reviewing && !readOnly;
  const long = markdown.length > LONG_PLAN_CHARS;
  const draftValid = draft.trim().length > 0;
  const edited = editorOpen && draftValid && draft !== markdown;

  // Foco inicial no primário (WORKBENCH §10). Roda ao montar o gate; não
  // rouba o foco de novo quando `busy` alterna.
  useEffect(() => {
    if (!interactive) return;
    primaryRef.current?.focus();
  }, [interactive, state]);

  if (!plan) {
    return (
      <p role="status" className={cn('text-[12px] leading-relaxed text-foreground-muted', className)}>
        Plano indisponível nesta versão.
      </p>
    );
  }

  if (state === 'inactive' && !markdown && !persistedFeedback) return null;

  const act = (action: PlanAction, planMarkdown?: string) => {
    if (!onAction || busy) return;
    // Preserva a assinatura curta quando não há markdown revisado (contrato
    // do card é `(action, feedback?, planMarkdown?)`).
    if (planMarkdown === undefined) onAction(action);
    else onAction(action, undefined, planMarkdown);
  };

  const approve = (action: 'approve_run' | 'approve_review') => {
    if (busy) return;
    if (editorOpen && !draftValid) return;
    act(action, edited ? draft : undefined);
  };

  const openEditor = () => {
    setDraft(markdown);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setDraft('');
  };

  const submitFeedback = () => {
    if (busy) return;
    const value = feedback.trim();
    setFeedbackOpen(false);
    setFeedback('');
    onAction?.('keep_planning', value ? value : undefined);
  };

  const handleFeedbackKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submitFeedback();
    }
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (draftValid) approve('approve_run');
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!interactive || event.key !== 'Escape' || busy) return;
    // Esc nunca aprova/nega por acidente: fecha editor/feedback ou devolve o
    // plano para o agente continuar planejando.
    event.preventDefault();
    event.stopPropagation();
    if (editorOpen) {
      closeEditor();
      return;
    }
    if (feedbackOpen) {
      setFeedbackOpen(false);
      setFeedback('');
      return;
    }
    onAction?.('keep_planning');
  };

  const announcement = busy
    ? 'Enviando decisão do plano…'
    : interactive
      ? 'Plano aguardando aprovação.'
      : '';

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
          <span className="text-[11px] text-foreground-muted">{relativeTime(plan.updatedAt)}</span>
          {markdown ? (
            onViewPlan ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onViewPlan(plan)}
                rightIcon={<ChevronRight className="size-3.5" />}
              >
                Ver plano
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={expanded}
                aria-controls={contentId}
                onClick={() => setExpanded((value) => !value)}
                rightIcon={
                  expanded ? (
                    <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronRight className="size-3.5" />
                  )
                }
              >
                Ver plano
              </Button>
            )
          ) : null}
        </div>
        {expanded && markdown ? (
          <div
            id={contentId}
            tabIndex={0}
            className="max-h-72 overflow-y-auto overscroll-contain border-t border-border pt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <PlanMarkdown markdown={markdown} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section
      role={interactive ? 'alertdialog' : undefined}
      aria-label={interactive ? undefined : 'Plano do agente'}
      aria-labelledby={interactive ? titleId : undefined}
      aria-busy={busy || undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-border bg-surface p-3',
        className,
      )}
    >
      {interactive ? (
        <p aria-live="assertive" className="sr-only">
          {announcement}
        </p>
      ) : null}

      <header className="flex flex-wrap items-center gap-2">
        <ListChecks aria-hidden className="size-4 shrink-0 text-accent" />
        <h3 id={titleId} className="min-w-0 flex-1 text-[13px] font-medium text-foreground">
          {planning
            ? 'Plano em preparação'
            : persistedFeedback
              ? 'Plano devolvido para revisão'
              : 'Plano proposto'}
        </h3>
        {planning ? <Spinner size="xs" label="Planejando" /> : null}
        {reviewing ? (
          <Badge variant={persistedFeedback ? 'warning' : 'accent'}>
            {persistedFeedback ? 'Não aprovado' : 'Aguardando aprovação'}
          </Badge>
        ) : null}
        {readOnly && reviewing ? <Badge variant="outline">Somente leitura</Badge> : null}
        <span className="text-[11px] text-foreground-muted">{relativeTime(plan.updatedAt)}</span>
      </header>

      {persistedFeedback ? (
        <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-background px-2 py-1.5">
          <p className="text-[11px] font-medium text-foreground-muted">Feedback anterior</p>
          <p className="min-w-0 break-words text-[12px] leading-relaxed text-foreground-muted">
            {persistedFeedback}
          </p>
        </div>
      ) : null}

      <div id={contentId} className="min-w-0">
        {markdown ? (
          <div
            tabIndex={0}
            className={cn(
              'overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              interactive ? 'max-h-80' : expanded ? 'max-h-72' : 'max-h-32',
            )}
          >
            <PlanMarkdown markdown={markdown} />
          </div>
        ) : (
          <p className="text-[12px] leading-relaxed text-foreground-muted">
            {planning ? 'O plano ainda está sendo preparado.' : 'O plano ainda não tem conteúdo.'}
          </p>
        )}
        {!interactive && long ? (
          <Button
            size="sm"
            variant="ghost"
            className="mt-1"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Recolher plano' : 'Ver plano completo'}
          </Button>
        ) : null}
      </div>

      {interactive ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              ref={primaryRef}
              size="sm"
              variant="primary"
              disabled={busy || (editorOpen && !draftValid)}
              onClick={() => approve('approve_run')}
            >
              Aprovar e executar
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || (editorOpen && !draftValid)}
              onClick={() => approve('approve_review')}
            >
              Aprovar e revisar cada edição
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={feedbackOpen}
              aria-controls={feedbackId}
              disabled={busy}
              onClick={() => setFeedbackOpen((value) => !value)}
            >
              Continuar planejando
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={editorOpen}
              aria-controls={editorId}
              disabled={busy}
              leftIcon={<PencilLine aria-hidden className="size-3.5" />}
              onClick={() => (editorOpen ? closeEditor() : openEditor())}
            >
              Editar plano antes de aprovar
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
                <Button size="sm" variant="secondary" disabled={busy} onClick={submitFeedback}>
                  Enviar feedback
                </Button>
              </div>
            </div>
          ) : null}

          {editorOpen ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2">
              <label htmlFor={editorId} className="text-[11px] font-medium text-foreground-muted">
                Plano revisado (será o plano aprovado e persistido)
              </label>
              <Textarea
                id={editorId}
                rows={8}
                maxLength={MAX_PLAN_CHARS}
                value={draft}
                autoFocus
                aria-invalid={draftValid ? undefined : true}
                aria-describedby={editorErrorId}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleEditorKeyDown}
              />
              <div className="flex items-center justify-between gap-2">
                <p
                  id={editorErrorId}
                  className={cn(
                    'text-[11px]',
                    draftValid ? 'text-foreground-muted' : 'text-danger',
                  )}
                >
                  {draftValid
                    ? `${draft.length} / ${MAX_PLAN_CHARS.toLocaleString('pt-BR')} caracteres · Ctrl+Enter aprova`
                    : 'O plano não pode ficar vazio.'}
                </p>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={closeEditor}>
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !draftValid}
                    onClick={() => approve('approve_run')}
                  >
                    Aprovar com este plano
                  </Button>
                </div>
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
      <p className="text-[12px] leading-relaxed text-foreground-muted">
        O plano ainda não tem conteúdo.
      </p>
    );
  }
  return <Markdown content={markdown} className="text-[13px]" />;
}
