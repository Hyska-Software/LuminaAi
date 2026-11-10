import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCircleQuestion } from 'lucide-react';
import { Badge, Button, Textarea } from '@/components/ui';
import { cn } from '@/lib/utils';

/** Opção de uma pergunta do agente (`ask_user`). */
export interface AskUserOption {
  /** Texto mostrado e devolvido na resposta. */
  label: string;
  description?: string;
  recommended?: boolean;
}

/** Pergunta do agente para o usuário. */
export interface AskUserQuestion {
  id: string;
  question: string;
  options: AskUserOption[];
  /** `true` para aceitar mais de uma opção. */
  multi?: boolean;
  /** Mostra campo de texto livre (default: `true`). */
  allowFreeText?: boolean;
}

/** Resposta de uma pergunta (opções marcadas + texto livre opcional). */
export interface AskUserAnswer {
  questionId: string;
  selected: string[];
  freeText?: string;
}

export interface AskUserCardProps {
  questions: AskUserQuestion[];
  onSubmit: (answers: AskUserAnswer[]) => void;
  onSkip: () => void;
  className?: string;
}

/**
 * Card de pergunta ao usuário (WORKBENCH §5.5): opções single/multi com a
 * recomendada marcada, texto livre opcional e "Ignorar e continuar". Não
 * bloqueia a UI — o turno é que fica aguardando a resposta do host.
 */
export function AskUserCard({ questions, onSubmit, onSkip, className }: AskUserCardProps) {
  const { t } = useTranslation('agents');
  const baseId = useId();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});

  const toggle = (question: AskUserQuestion, label: string) => {
    setSelected((current) => {
      const chosen = current[question.id] ?? [];
      if (question.multi) {
        const next = chosen.includes(label)
          ? chosen.filter((value) => value !== label)
          : [...chosen, label];
        return { ...current, [question.id]: next };
      }
      return { ...current, [question.id]: chosen.includes(label) ? [] : [label] };
    });
  };

  const answered = questions.some((question) => {
    const chosen = selected[question.id] ?? [];
    const free = freeText[question.id]?.trim() ?? '';
    return chosen.length > 0 || free.length > 0;
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!answered) return;
    onSubmit(
      questions.map((question) => {
        const free = freeText[question.id]?.trim() ?? '';
        return {
          questionId: question.id,
          selected: selected[question.id] ?? [],
          ...(free ? { freeText: free } : {}),
        };
      }),
    );
  };

  if (questions.length === 0) return null;

  return (
    <form
      aria-label={t('askUser.aria')}
      onSubmit={submit}
      className={cn('flex flex-col gap-3 rounded-xl border border-border bg-surface p-3', className)}
    >
      <header className="flex items-center gap-2">
        <MessageCircleQuestion aria-hidden className="size-4 shrink-0 text-accent" />
        <h3 className="min-w-0 flex-1 text-[13px] font-medium text-foreground">
          {t('askUser.title', { count: questions.length })}
        </h3>
      </header>

      {questions.map((question) => {
        const optionsId = `${baseId}-${question.id}-options`;
        const freeId = `${baseId}-${question.id}-free`;
        const chosen = selected[question.id] ?? [];
        const allowFreeText = question.allowFreeText !== false;
        return (
          <fieldset key={question.id} className="flex flex-col gap-2">
            <legend className="text-[12px] font-medium leading-relaxed text-foreground">
              {question.question}
            </legend>
            <div id={optionsId} className="flex flex-col gap-1">
              {question.options.map((option) => {
                const inputId = `${baseId}-${question.id}-${option.label}`;
                const checked = chosen.includes(option.label);
                return (
                  <label
                    key={option.label}
                    htmlFor={inputId}
                    className={cn(
                      'flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-[12px] leading-relaxed transition-colors',
                      'border-border bg-background hover:bg-surface-hover',
                      'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40',
                      checked && 'border-accent/50 bg-accent-soft/40',
                    )}
                  >
                    <input
                      id={inputId}
                      type={question.multi ? 'checkbox' : 'radio'}
                      name={`zylara-question-${baseId}-${question.id}`}
                      className="mt-0.5 size-3.5 shrink-0 accent-accent"
                      checked={checked}
                      onChange={() => toggle(question, option.label)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-foreground">{option.label}</span>
                        {option.recommended ? (
                          <Badge variant="accent">{t('askUser.recommended')}</Badge>
                        ) : null}
                      </span>
                      {option.description ? (
                        <span className="mt-0.5 block text-[11px] leading-snug text-foreground-muted">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>

            {allowFreeText ? (
              <div className="flex flex-col gap-1">
                <label htmlFor={freeId} className="text-[11px] text-foreground-muted">
                  {t('askUser.freeTextLabel')}
                </label>
                <Textarea
                  id={freeId}
                  rows={2}
                  value={freeText[question.id] ?? ''}
                  placeholder={t('askUser.freeTextPlaceholder')}
                  onChange={(event) =>
                    setFreeText((current) => ({ ...current, [question.id]: event.target.value }))
                  }
                />
              </div>
            ) : null}
          </fieldset>
        );
      })}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onSkip}>
          {t('askUser.skip')}
        </Button>
        <Button type="submit" size="sm" variant="primary" disabled={!answered}>
          {t('askUser.submit')}
        </Button>
      </div>
    </form>
  );
}
