/**
 * Diálogo de criação/edição do objetivo da sessão de código
 * (`docs/goals/code-goals/PLAN.md` §10.4).
 *
 * Aberto por `uiStore.goalDialog` (pill do composer, card de atenção, `/goal`,
 * painel central) e montado pelo `WorkspaceCenter`. Os limites espelham a fonte
 * única do backend (`harness/code/goal.rs`, PLAN §5.3): objetivo ≤4.000,
 * título ≤120 e limite de rodadas 1..100 (default 25).
 *
 * Ações:
 * - criação: "Criar e começar" (cria e dispara a rodada 1 se não houver turno em
 *   andamento; com turno em andamento a continuidade fica para o fim dele) e
 *   "Criar sem começar";
 * - edição: "Salvar" (update_goal `edit`, CAS por `revision`; o Switch de
 *   continuidade vira `arm`/`disarm`) e a zona de perigo "Encerrar objetivo"
 *   com confirmação inline (`delete`).
 *
 * Acessibilidade: Radix Dialog com título/descrição (foco preso, `Esc`, retorno
 * de foco), labels associadas, erros inline com `aria-invalid`/`aria-describedby`
 * e `aria-busy` durante o IPC.
 */
import { useEffect, useId, useState } from 'react';
import { Play, Target, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
  Textarea,
} from '@/components/ui';
import { useChatStore, useCodeStore } from '@/lib/store';
import type { GoalStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Limites da fonte única do backend (PLAN §5.3). */
const MAX_TITLE_CHARS = 120;
const MAX_OBJECTIVE_CHARS = 4_000;
const MAX_ROUNDS_DEFAULT = 25;
const MAX_ROUNDS_HARD_CAP = 100;

export interface GoalDialogProps {
  conversationId: string;
  mode: 'create' | 'edit';
  onClose: () => void;
}

type FieldErrors = {
  title?: string;
  objective?: string;
  maxRounds?: string;
};

const STATUS_TEXT: Record<GoalStatus, string> = {
  active: 'ativo',
  paused: 'pausado',
  completed: 'concluído',
  blocked: 'bloqueado',
};

function errorId(base: string, field: keyof FieldErrors): string {
  return `${base}-${field}-error`;
}

/**
 * Diálogo criar/editar do objetivo. Ver `GoalDialogProps`; o estado do objetivo
 * vem do `codeStore` (snapshot autoritativo do backend).
 */
export function GoalDialog({ conversationId, mode, onClose }: GoalDialogProps) {
  const baseId = useId();
  const goal = useCodeStore((state) => state.byConversation[conversationId]?.goal ?? null);
  const createGoal = useCodeStore((state) => state.createGoal);
  const updateGoal = useCodeStore((state) => state.updateGoal);
  const runGoalRound = useChatStore((state) => state.runGoalRound);

  /** `editar` pode ser acionado a partir do aviso de objetivo existente. */
  const [localMode, setLocalMode] = useState<'create' | 'edit'>(mode);
  useEffect(() => {
    setLocalMode(mode);
  }, [mode]);

  const editing = localMode === 'edit';
  /** Continuidade só pode mudar com o objetivo ativo (`arm`/`disarm` exigem). */
  const continuityLocked = editing && goal != null && goal.status !== 'active';
  const [title, setTitle] = useState(() => (mode === 'edit' ? (goal?.title ?? '') : ''));
  const [objective, setObjective] = useState(() => (mode === 'edit' ? (goal?.objective ?? '') : ''));
  const [autoContinue, setAutoContinue] = useState(
    () => (mode === 'edit' ? (goal?.autoContinue ?? true) : true),
  );
  const [maxRoundsInput, setMaxRoundsInput] = useState(() =>
    String(mode === 'edit' ? (goal?.maxRounds ?? MAX_ROUNDS_DEFAULT) : MAX_ROUNDS_DEFAULT),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const clearError = (field: keyof FieldErrors) => {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  };

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    const objectiveText = objective.trim();
    if (!objectiveText) {
      next.objective = 'Descreva o objetivo da sessão.';
    } else if (objectiveText.length > MAX_OBJECTIVE_CHARS) {
      next.objective = `O objetivo deve ter no máximo ${MAX_OBJECTIVE_CHARS.toLocaleString('pt-BR')} caracteres.`;
    }
    if (title.trim().length > MAX_TITLE_CHARS) {
      next.title = `O título deve ter no máximo ${MAX_TITLE_CHARS} caracteres.`;
    }
    const parsedMax = Number(maxRoundsInput);
    if (
      maxRoundsInput.trim() === '' ||
      !Number.isInteger(parsedMax) ||
      parsedMax < 1 ||
      parsedMax > MAX_ROUNDS_HARD_CAP
    ) {
      next.maxRounds = `Use um limite entre 1 e ${MAX_ROUNDS_HARD_CAP} rodadas.`;
    }
    return next;
  };

  const validateAndReport = (): boolean => {
    const found = validate();
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  /* Objetivo ativo/pausado/bloqueado impede a criação (o backend recusa). Um
     objetivo concluído é substituído pelo novo. */
  const existingBlocking = editing
    ? null
    : goal && goal.status !== 'completed'
      ? goal
      : null;

  const openEdit = () => {
    setLocalMode('edit');
    setErrors({});
    setSubmitError(null);
    if (goal) {
      setTitle(goal.title);
      setObjective(goal.objective);
      setAutoContinue(goal.autoContinue);
      setMaxRoundsInput(String(goal.maxRounds));
    }
  };

  const submitCreate = async (start: boolean) => {
    if (busy || existingBlocking) return;
    if (!validateAndReport()) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const ok = await createGoal(conversationId, {
        objective: objective.trim(),
        title: title.trim() || null,
        maxRounds: Number(maxRoundsInput),
        autoContinue,
      });
      if (!ok) {
        setSubmitError(
          'Não foi possível criar o objetivo. Se já existe um objetivo ativo, edite-o em vez de criar outro.',
        );
        return;
      }
      // O backend renomeia o título placeholder para o do objetivo; o sidebar
      // só reflete depois de reler as conversas.
      void useChatStore.getState().refreshConversations();
      if (start) {
        // Com um turno em andamento não é possível iniciar a rodada agora: a
        // continuidade fica para o fim do turno (regra do driver no chatStore).
        if (useChatStore.getState().streaming) {
          toast.info('Objetivo criado', {
            description: autoContinue
              ? 'A primeira rodada continua automaticamente ao fim do turno atual.'
              : 'Quando o turno atual terminar, inicie a rodada pelo painel do objetivo.',
          });
        } else {
          const started = await runGoalRound(conversationId);
          if (!started) {
            toast.error('Objetivo criado, mas a rodada não iniciou', {
              description:
                'Verifique se a sessão está ativa no Code e se não há aprovação ou pergunta pendente.',
            });
          }
        }
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async () => {
    if (busy || !goal) return;
    if (!validateAndReport()) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const ok = await updateGoal(
        conversationId,
        'edit',
        {
          title: title.trim() || null,
          objective: objective.trim(),
          maxRounds: Number(maxRoundsInput),
        },
        goal.revision,
      );
      if (!ok) {
        setSubmitError('Não foi possível salvar o objetivo. Atualize a sessão e tente de novo.');
        return;
      }
      // `UpdateGoalInput` não carrega `autoContinue`: armar/desarmar é uma ação
      // própria do contrato (`arm`/`disarm`). Só vale com o objetivo ativo;
      // pausado/bloqueado/concluído recusaria `GOAL_NOT_ACTIVE` (a continuidade
      // é reativada por `resume`).
      if (goal.status === 'active' && autoContinue !== goal.autoContinue) {
        await updateGoal(conversationId, autoContinue ? 'arm' : 'disarm');
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const submitDelete = async () => {
    if (busy) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const ok = await updateGoal(conversationId, 'delete');
      if (!ok) {
        setSubmitError('Não foi possível encerrar o objetivo. Tente de novo.');
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const objectiveCount = objective.length;
  const objectiveTooLong = objectiveCount > MAX_OBJECTIVE_CHARS;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Fechar pelo X/Esc equivale a cancelar; nunca fecha durante o IPC.
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent
        size="md"
        className="gap-0"
        aria-busy={busy || undefined}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader className="gap-1.5 pr-10">
          <DialogTitle>{editing ? 'Editar objetivo' : 'Definir objetivo'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Ajuste o resultado esperado, o limite de rodadas e a continuidade automática.'
              : 'Descreva o resultado esperado. O agente trabalha nele em rodadas até concluir, bloquear ou atingir o limite.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-5">
          {existingBlocking ? (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-lg border border-border bg-warning-soft px-3 py-2.5"
            >
              <p className="min-w-0 break-words text-[12px] leading-relaxed text-warning">
                Já existe um objetivo {STATUS_TEXT[existingBlocking.status]} nesta sessão. Encerre o
                atual para criar outro, ou edite o que já existe.
              </p>
              <div>
                <Button size="sm" variant="secondary" onClick={openEdit}>
                  Editar objetivo
                </Button>
              </div>
            </div>
          ) : null}

          {!editing && goal?.status === 'completed' ? (
            <p className="min-w-0 break-words rounded-lg border border-border bg-success-soft px-3 py-2 text-[11.5px] leading-relaxed text-success">
              O objetivo concluído será substituído pelo novo.
            </p>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor={`${baseId}-title`}>Título</Label>
              <span className="text-[11px] text-foreground-subtle">opcional</span>
            </div>
            <Input
              id={`${baseId}-title`}
              value={title}
              maxLength={MAX_TITLE_CHARS}
              placeholder="Ex.: Corrigir o cálculo de juros"
              invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? errorId(baseId, 'title') : `${baseId}-title-hint`}
              onChange={(event) => {
                setTitle(event.target.value);
                clearError('title');
              }}
            />
            {errors.title ? (
              <p id={errorId(baseId, 'title')} className="text-[11.5px] text-danger">
                {errors.title}
              </p>
            ) : (
              <p id={`${baseId}-title-hint`} className="text-[11px] text-foreground-subtle">
                Sem título, usamos a primeira linha do objetivo.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor={`${baseId}-objective`} required>
                Objetivo
              </Label>
              <span
                aria-hidden
                className={cn(
                  'text-[11px] tabular-nums',
                  objectiveTooLong ? 'text-danger' : 'text-foreground-subtle',
                )}
              >
                {objectiveCount}/{MAX_OBJECTIVE_CHARS}
              </span>
            </div>
            <Textarea
              id={`${baseId}-objective`}
              rows={6}
              value={objective}
              maxLength={MAX_OBJECTIVE_CHARS}
              placeholder="Descreva o resultado esperado, com critérios de aceite…"
              invalid={Boolean(errors.objective)}
              aria-describedby={
                errors.objective ? errorId(baseId, 'objective') : `${baseId}-objective-hint`
              }
              onChange={(event) => {
                setObjective(event.target.value);
                clearError('objective');
              }}
            />
            {errors.objective ? (
              <p id={errorId(baseId, 'objective')} className="text-[11.5px] text-danger">
                {errors.objective}
              </p>
            ) : (
              <p id={`${baseId}-objective-hint`} className="text-[11px] leading-relaxed text-foreground-subtle">
                Só o objetivo decide quando o agente para: concluir, bloquear ou estourar o limite.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col justify-center rounded-xl border border-border bg-surface px-3 py-2.5">
              <Switch
                checked={autoContinue}
                onCheckedChange={setAutoContinue}
                disabled={continuityLocked}
                label="Continuar automaticamente"
                description={
                  continuityLocked
                    ? 'A continuidade é reativada ao retomar o objetivo.'
                    : 'O agente continua sozinho após cada turno bem-sucedido.'
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-max-rounds`}>Limite de rodadas</Label>
              <Input
                id={`${baseId}-max-rounds`}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_ROUNDS_HARD_CAP}
                step={1}
                value={maxRoundsInput}
                invalid={Boolean(errors.maxRounds)}
                aria-describedby={
                  errors.maxRounds ? errorId(baseId, 'maxRounds') : `${baseId}-max-rounds-hint`
                }
                onChange={(event) => {
                  setMaxRoundsInput(event.target.value);
                  clearError('maxRounds');
                }}
              />
              {errors.maxRounds ? (
                <p id={errorId(baseId, 'maxRounds')} className="text-[11.5px] text-danger">
                  {errors.maxRounds}
                </p>
              ) : (
                <p id={`${baseId}-max-rounds-hint`} className="text-[11px] text-foreground-subtle">
                  Entre 1 e {MAX_ROUNDS_HARD_CAP}. Default: {MAX_ROUNDS_DEFAULT}.
                </p>
              )}
            </div>
          </div>

          <p className="flex items-start gap-1.5 rounded-lg bg-warning-soft px-3 py-2 text-[11.5px] leading-relaxed text-warning">
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            <span>
              Cada rodada é um turno completo e consome tokens do provedor. O objetivo pausa sozinho
              em erros, após 3 rodadas sem progresso ou ao atingir o limite.
            </span>
          </p>

          {submitError ? (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {submitError}
            </p>
          ) : null}

          {editing && goal ? (
            <div className="flex flex-col gap-2 rounded-xl border border-border px-3 py-2.5">
              <p className="text-[11.5px] font-medium text-danger">Zona de perigo</p>
              {!confirmDelete ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 text-[11.5px] leading-relaxed text-foreground-muted">
                    Encerrar remove o objetivo e para as rodadas automáticas.
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger hover:bg-danger-soft hover:text-danger"
                    onClick={() => setConfirmDelete(true)}
                  >
                    Encerrar objetivo
                  </Button>
                </div>
              ) : (
                <div role="group" aria-label="Confirmar encerramento do objetivo" className="flex flex-col gap-2">
                  <p role="alert" className="text-[11.5px] leading-relaxed text-foreground-muted">
                    O histórico de rodadas é preservado, mas a sessão fica sem objetivo. Esta ação não
                    pode ser desfeita.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="danger"
                      loading={busy}
                      disabled={busy}
                      onClick={() => void submitDelete()}
                    >
                      Confirmar encerramento
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setConfirmDelete(false)}
                    >
                      Voltar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <Button
                variant="primary"
                size="sm"
                loading={busy}
                disabled={!goal}
                onClick={() => void submitEdit()}
              >
                Salvar
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || existingBlocking != null}
                  onClick={() => void submitCreate(false)}
                >
                  Criar sem começar
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  disabled={existingBlocking != null}
                  leftIcon={busy ? undefined : <Play aria-hidden className="size-3.5" />}
                  onClick={() => void submitCreate(true)}
                >
                  Criar e começar
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GoalDialog;
