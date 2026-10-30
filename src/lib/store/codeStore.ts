import { create } from 'zustand';
import { toast } from 'sonner';
import { api } from '../api';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalScope,
  AskUserAnswer,
  AskUserRequest,
  ChangesSummary,
  CodeSessionState,
  ContextStats,
  CreateGoalInput,
  FileChange,
  GoalAction,
  GoalRound,
  GoalView,
  JobView,
  PermissionMode,
  PlanApprovalChoice,
  PlanView,
  TodoItem,
  TurnEvent,
  UpdateGoalInput,
} from '../types';

/**
 * Estado de UI de uma sessão do harness de código (docs/goals/code-harness/
 * WORKBENCH.md §4–§7). Vive separado do `chatStore` porque é ortogonal ao
 * streaming: permissões, plano, tarefas, contexto, alterações, jobs e
 * aprovações da sessão ATIVA.
 *
 * `applyEvent` é um reducer puro (testável) chamado pelo `chatStore` para cada
 * `TurnEvent` do turno em andamento; `load` sincroniza o snapshot autoritativo
 * do backend ao abrir a sessão.
 */
export interface CodeSessionUi {
  conversationId: string;
  permissionMode: PermissionMode;
  planMode: boolean;
  plan: PlanView | null;
  /** Objetivo persistente da sessão (docs/goals/code-goals/PLAN.md). */
  goal: GoalView | null;
  /** Histórico de rodadas (carregado sob demanda pelo painel). */
  goalRounds: GoalRound[];
  goalRoundsLoading: boolean;
  goalRoundsError: string | null;
  /** Guarda síncrona contra duas rodadas iniciadas no mesmo clique/ciclo. */
  goalStarting: boolean;
  /** Revisão do objetivo cujo card de atenção foi dispensado (UI-only). */
  dismissedGoalRevision: number | null;
  todos: TodoItem[];
  context: ContextStats | null;
  changes: ChangesSummary | null;
  jobs: JobView[];
  approvals: ApprovalRequest[];
  /** Perguntas estruturadas pendentes do agente (`ask_user`). */
  questions: AskUserRequest[];
  /** Respostas já dadas (para o card mostrar o estado resolvido). */
  questionAnswers: Record<string, { answers: AskUserAnswer[]; skipped: boolean }>;
  /** Decisões já tomadas nesta sessão (para o card mostrar o estado resolvido). */
  resolutions: Record<string, { decision: ApprovalDecision; scope?: ApprovalScope | null }>;
  loading: boolean;
  error: string | null;
}

export function emptyCodeSession(conversationId: string): CodeSessionUi {
  return {
    conversationId,
    // Fallback antes do snapshot do backend: o padrão de fábrica do Code é
    // Autônomo (a sessão real sempre carrega o modo persistido em seguida).
    permissionMode: 'autonomous',
    planMode: false,
    plan: null,
    goal: null,
    goalRounds: [],
    goalRoundsLoading: false,
    goalRoundsError: null,
    goalStarting: false,
    dismissedGoalRevision: null,
    todos: [],
    context: null,
    changes: null,
    jobs: [],
    approvals: [],
    questions: [],
    questionAnswers: {},
    resolutions: {},
    loading: false,
    error: null,
  };
}

function upsertJob(jobs: JobView[], job: JobView): JobView[] {
  const index = jobs.findIndex((entry) => entry.id === job.id);
  if (index < 0) return [...jobs, job];
  const next = [...jobs];
  next[index] = job;
  return next;
}

function mergeChange(summary: ChangesSummary | null, change: FileChange): ChangesSummary {
  const files = summary?.files ?? [];
  const existing = files.findIndex((entry) => entry.path === change.path);
  const entry = {
    path: change.path,
    kind: change.kind,
    added: change.added ?? 0,
    removed: change.removed ?? 0,
    origin: 'session' as const,
  };
  const nextFiles = existing < 0 ? [...files, entry] : files.map((file, i) => (i === existing ? entry : file));
  return {
    turnId: summary?.turnId ?? null,
    files: nextFiles,
    added: nextFiles.reduce((total, file) => total + (file.added ?? 0), 0),
    removed: nextFiles.reduce((total, file) => total + (file.removed ?? 0), 0),
  };
}

/**
 * Reducer puro dos eventos de código. Eventos do Chat são ignorados (o
 * `chatStore` continua dono deles).
 */
export function applyCodeEvent(state: CodeSessionUi, event: TurnEvent): CodeSessionUi {
  switch (event.type) {
    case 'approval_requested': {
      const others = state.approvals.filter((entry) => entry.id !== event.approval.id);
      return { ...state, approvals: [...others, event.approval] };
    }
    case 'approval_resolved': {
      const resolutions = {
        ...state.resolutions,
        [event.approvalId]: {
          decision: event.decision,
          scope: event.scope ?? null,
        },
      };
      return {
        ...state,
        approvals: state.approvals.filter((entry) => entry.id !== event.approvalId),
        resolutions,
      };
    }
    case 'question_requested': {
      const others = state.questions.filter((entry) => entry.id !== event.request.id);
      return { ...state, questions: [...others, event.request] };
    }
    case 'question_resolved': {
      return {
        ...state,
        questions: state.questions.filter((entry) => entry.id !== event.requestId),
        questionAnswers: {
          ...state.questionAnswers,
          [event.requestId]: { answers: event.answers, skipped: event.skipped },
        },
      };
    }
    case 'plan_updated':
      return {
        ...state,
        plan: event.plan,
        planMode: event.plan.state === 'planning' || event.plan.state === 'reviewing',
      };
    case 'goal_updated': {
      const previousGoal = state.goal;
      const goal = event.goal;
      // Rodada nova/estado novo invalida o "dispensado" do card de atenção.
      const dismissedGoalRevision =
        previousGoal && previousGoal.revision === goal.revision
          ? state.dismissedGoalRevision
          : null;
      const goalRounds =
        previousGoal && previousGoal.createdAt === goal.createdAt
          ? state.goalRounds
          : [];
      return { ...state, goal, goalRounds, dismissedGoalRevision };
    }
    case 'todos_updated':
      return { ...state, todos: event.todos };
    case 'context_stats':
      return { ...state, context: event.stats };
    case 'compacted':
      return {
        ...state,
        context: state.context
          ? {
              ...state.context,
              // `ContextStats.compacted` = mensagens resumidas (cumulativo desde
              // o último sumário), não o número de compactações. O próximo
              // `context_stats` traz o valor canônico; aqui usamos o evento para
              // a nota não mostrar "1 mensagem" entre a compactação e o passo.
              compacted: event.messages,
              used: Math.max(0, state.context.used - event.tokensFreed),
            }
          : state.context,
      };
    case 'workspace_changes':
      return { ...state, changes: event.summary };
    case 'file_changed':
      return { ...state, changes: mergeChange(state.changes, event.change) };
    case 'job_updated':
      return { ...state, jobs: upsertJob(state.jobs, event.job) };
    case 'profile_changed':
      return {
        ...state,
        permissionMode: event.permissionMode,
        planMode: event.planMode,
      };
    default:
      return state;
  }
}

/** Eventos que o `chatStore` deve repassar ao `codeStore`. */
export function isCodeEvent(event: TurnEvent): boolean {
  switch (event.type) {
    case 'approval_requested':
    case 'approval_resolved':
    case 'question_requested':
    case 'question_resolved':
    case 'plan_updated':
    case 'goal_updated':
    case 'todos_updated':
    case 'context_stats':
    case 'compacted':
    case 'workspace_changes':
    case 'file_changed':
    case 'job_updated':
    case 'profile_changed':
      return true;
    default:
      return false;
  }
}

/** Snapshot do backend → estado da UI (preserva o que é só de UI). */
export function fromSnapshot(
  snapshot: CodeSessionState,
  previous: CodeSessionUi | undefined,
): CodeSessionUi {
  const goal = snapshot.goal ?? null;
  const sameGoal =
    Boolean(goal && previous?.goal) && goal!.createdAt === previous!.goal!.createdAt;
  return {
    conversationId: snapshot.conversationId,
    permissionMode: snapshot.permissionMode,
    planMode: snapshot.planMode,
    plan: snapshot.plan ?? null,
    goal,
    goalRounds: sameGoal ? (previous?.goalRounds ?? []) : [],
    goalRoundsLoading: sameGoal ? (previous?.goalRoundsLoading ?? false) : false,
    goalRoundsError: sameGoal ? (previous?.goalRoundsError ?? null) : null,
    goalStarting: false,
    dismissedGoalRevision: sameGoal ? (previous?.dismissedGoalRevision ?? null) : null,
    todos: snapshot.todos ?? [],
    context: snapshot.context ?? null,
    changes: snapshot.changes ?? null,
    jobs: snapshot.jobs ?? [],
    approvals: snapshot.approvals ?? [],
    questions: snapshot.questions ?? [],
    questionAnswers: previous?.questionAnswers ?? {},
    resolutions: previous?.resolutions ?? {},
    loading: false,
    error: null,
  };
}

interface CodeStoreState {
  byConversation: Record<string, CodeSessionUi>;
  load: (conversationId: string) => Promise<void>;
  refresh: (conversationId: string) => Promise<void>;
  reset: (conversationId?: string) => void;
  applyEvent: (conversationId: string, event: TurnEvent) => void;
  respondApproval: (
    conversationId: string,
    approvalId: string,
    decision: ApprovalDecision,
    options?: {
      scope?: ApprovalScope | null;
      feedback?: string | null;
      choice?: PlanApprovalChoice | null;
      planMarkdown?: string | null;
      remember?: boolean;
    },
  ) => Promise<boolean>;
  respondQuestion: (
    conversationId: string,
    requestId: string,
    answers: AskUserAnswer[],
    skipped?: boolean,
  ) => Promise<boolean>;
  setPermissionMode: (conversationId: string, mode: PermissionMode) => Promise<boolean>;
  setPlanMode: (conversationId: string, enabled: boolean) => Promise<boolean>;
  /** Cria o objetivo da sessão (UI: diálogo "Criar e começar"). */
  createGoal: (conversationId: string, input: CreateGoalInput) => Promise<boolean>;
  /**
   * Aplica uma ação do usuário sobre o objetivo, com CAS (`expectedRevision`)
   * e atualização otimista nos toggles de pausa/continuidade. Sempre substitui
   * o estado pelo snapshot autoritativo do backend.
   */
  updateGoal: (
    conversationId: string,
    action: GoalAction,
    input?: UpdateGoalInput | null,
    expectedRevision?: number | null,
  ) => Promise<boolean>;
  /** Carrega o histórico de rodadas para o painel central. */
  loadGoalRounds: (conversationId: string, limit?: number) => Promise<void>;
  /** Dispensa o card de atenção desta revisão (UI-only). */
  dismissGoalAttention: (conversationId: string, revision: number) => void;
  /** Guarda síncrona do driver de rodadas (não confundir com `busy` de IPC). */
  setGoalStarting: (conversationId: string, starting: boolean) => void;
  refreshJobs: (conversationId: string) => Promise<void>;
  killJob: (conversationId: string, jobId: string) => Promise<void>;
  revertTurn: (conversationId: string, turnId: string) => Promise<boolean>;
  revertFile: (conversationId: string, path: string) => Promise<boolean>;
  compact: (conversationId: string) => Promise<boolean>;
}

function patch(
  state: Record<string, CodeSessionUi>,
  conversationId: string,
  update: (current: CodeSessionUi) => CodeSessionUi,
): Record<string, CodeSessionUi> {
  const current = state[conversationId] ?? emptyCodeSession(conversationId);
  return { ...state, [conversationId]: update(current) };
}

/**
 * Atualização otimista dos toggles do objetivo (pausa/retomada/armar/desarmar).
 * `null` = ação sem otimista (o snapshot do backend é a resposta).
 */
function optimisticGoal(goal: GoalView | null, action: GoalAction): GoalView | null {
  if (!goal) return null;
  switch (action) {
    case 'pause':
      return {
        ...goal,
        status: 'paused',
        autoContinue: false,
        pauseReason: 'user',
        pauseDetail: null,
      };
    case 'resume':
      return {
        ...goal,
        status: 'active',
        autoContinue: true,
        pauseReason: null,
        pauseDetail: null,
        blockerReason: null,
        blockerStreak: 0,
        stalledRounds: 0,
      };
    case 'arm':
      return { ...goal, autoContinue: true };
    case 'disarm':
      return { ...goal, autoContinue: false };
    default:
      return null;
  }
}

export const useCodeStore = create<CodeStoreState>()((set, get) => ({
  byConversation: {},

  load: async (conversationId) => {
    set((state) => ({ byConversation: patch(state.byConversation, conversationId, (current) => ({ ...current, loading: true, error: null })) }));
    try {
      const snapshot = await api.getCodeSessionState(conversationId);
      set((state) => ({
        byConversation: {
          ...state.byConversation,
          [conversationId]: fromSnapshot(snapshot, state.byConversation[conversationId]),
        },
      }));
    } catch (error) {
      set((state) => ({
        byConversation: patch(state.byConversation, conversationId, (current) => ({
          ...current,
          loading: false,
          error: String(error),
        })),
      }));
    }
  },

  refresh: async (conversationId) => {
    try {
      const snapshot = await api.getCodeSessionState(conversationId);
      set((state) => ({
        byConversation: {
          ...state.byConversation,
          [conversationId]: fromSnapshot(snapshot, state.byConversation[conversationId]),
        },
      }));
    } catch {
      // Silencioso: a UI mantém o último snapshot conhecido.
    }
  },

  reset: (conversationId) => {
    if (!conversationId) {
      set({ byConversation: {} });
      return;
    }
    set((state) => {
      const next = { ...state.byConversation };
      delete next[conversationId];
      return { byConversation: next };
    });
  },

  applyEvent: (conversationId, event) => {
    if (!isCodeEvent(event)) return;
    set((state) => ({
      byConversation: patch(state.byConversation, conversationId, (current) => applyCodeEvent(current, event)),
    }));
  },

  respondApproval: async (conversationId, approvalId, decision, options) => {
    try {
      const ok = await api.respondApproval(approvalId, decision, {
        scope: options?.scope ?? null,
        feedback: options?.feedback ?? null,
        choice: options?.choice ?? null,
        planMarkdown: options?.planMarkdown ?? null,
      });
      if (!ok) {
        toast.error('Esta aprovação já não está disponível', {
          description: 'Atualizando o estado da sessão…',
        });
        await get().refresh(conversationId);
        return false;
      }
      // Decisão de plano muda modo/permissão e projeção: sincroniza o snapshot
      // (o evento `plan_updated` é emitido depois que a tool destrava).
      if (options?.choice) await get().refresh(conversationId);
      return ok;
    } catch (error) {
      toast.error('Não foi possível responder à aprovação', { description: String(error) });
      return false;
    }
  },

  respondQuestion: async (conversationId, requestId, answers, skipped = false) => {
    try {
      const ok = await api.respondQuestion(requestId, answers, skipped);
      if (ok) {
        set((state) => ({
          byConversation: patch(state.byConversation, conversationId, (current) => ({
            ...current,
            questions: current.questions.filter((entry) => entry.id !== requestId),
            questionAnswers: {
              ...current.questionAnswers,
              [requestId]: { answers, skipped },
            },
          })),
        }));
      }
      return ok;
    } catch (error) {
      toast.error('Não foi possível enviar a resposta', { description: String(error) });
      return false;
    }
  },

  setPermissionMode: async (conversationId, mode) => {
    const previous = get().byConversation[conversationId];
    set((state) => ({
      byConversation: patch(state.byConversation, conversationId, (current) => ({
        ...current,
        permissionMode: mode,
      })),
    }));
    try {
      const snapshot = await api.setPermissionMode(conversationId, mode);
      set((state) => ({
        byConversation: { ...state.byConversation, [conversationId]: fromSnapshot(snapshot, previous) },
      }));
      return true;
    } catch (error) {
      if (previous) {
        set((state) => ({ byConversation: { ...state.byConversation, [conversationId]: previous } }));
      }
      toast.error('Não foi possível alterar o modo de permissão', { description: String(error) });
      return false;
    }
  },

  setPlanMode: async (conversationId, enabled) => {
    const previous = get().byConversation[conversationId];
    // Otimista, como o chip de permissão: o toggle responde antes do IPC.
    set((state) => ({
      byConversation: patch(state.byConversation, conversationId, (current) => ({
        ...current,
        planMode: enabled,
      })),
    }));
    try {
      const snapshot = await api.setPlanMode(conversationId, enabled);
      set((state) => ({
        byConversation: {
          ...state.byConversation,
          [conversationId]: fromSnapshot(snapshot, previous),
        },
      }));
      return true;
    } catch (error) {
      if (previous) {
        set((state) => ({
          byConversation: { ...state.byConversation, [conversationId]: previous },
        }));
      }
      toast.error('Não foi possível alterar o modo Plano', { description: String(error) });
      return false;
    }
  },

  createGoal: async (conversationId, input) => {
    try {
      const snapshot = await api.createGoal(conversationId, input);
      set((state) => ({
        byConversation: {
          ...state.byConversation,
          [conversationId]: fromSnapshot(snapshot, state.byConversation[conversationId]),
        },
      }));
      return true;
    } catch (error) {
      toast.error('Não foi possível criar o objetivo', { description: String(error) });
      return false;
    }
  },

  updateGoal: async (conversationId, action, input, expectedRevision) => {
    const previous = get().byConversation[conversationId];
    const optimistic = optimisticGoal(previous?.goal ?? null, action);
    if (optimistic) {
      set((state) => ({
        byConversation: patch(state.byConversation, conversationId, (current) => ({
          ...current,
          goal: optimistic,
        })),
      }));
    }
    try {
      const snapshot = await api.updateGoal(
        conversationId,
        action,
        input ?? null,
        expectedRevision ?? previous?.goal?.revision ?? null,
      );
      set((state) => ({
        byConversation: {
          ...state.byConversation,
          [conversationId]: fromSnapshot(snapshot, state.byConversation[conversationId]),
        },
      }));
      return true;
    } catch (error) {
      if (previous) {
        set((state) => ({
          byConversation: { ...state.byConversation, [conversationId]: previous },
        }));
      }
      const message = String(error);
      if (message.includes('GOAL_STALE_REVISION')) {
        toast.error('O objetivo mudou em outra ação', {
          description: 'Atualizando o estado da sessão…',
        });
        await get().refresh(conversationId);
      } else {
        toast.error('Não foi possível atualizar o objetivo', { description: message });
      }
      return false;
    }
  },

  loadGoalRounds: async (conversationId, limit = 100) => {
    set((state) => ({
      byConversation: patch(state.byConversation, conversationId, (current) => ({
        ...current,
        goalRoundsLoading: true,
        goalRoundsError: null,
      })),
    }));
    try {
      const goalRounds = await api.listGoalRounds(conversationId, limit);
      set((state) => ({
        byConversation: patch(state.byConversation, conversationId, (current) => ({
          ...current,
          goalRounds,
          goalRoundsLoading: false,
        })),
      }));
    } catch (error) {
      set((state) => ({
        byConversation: patch(state.byConversation, conversationId, (current) => ({
          ...current,
          goalRoundsLoading: false,
          goalRoundsError: String(error),
        })),
      }));
    }
  },

  dismissGoalAttention: (conversationId, revision) => {
    set((state) => ({
      byConversation: patch(state.byConversation, conversationId, (current) => ({
        ...current,
        dismissedGoalRevision: revision,
      })),
    }));
  },

  setGoalStarting: (conversationId, goalStarting) => {
    set((state) => ({
      byConversation: patch(state.byConversation, conversationId, (current) => ({
        ...current,
        goalStarting,
      })),
    }));
  },

  refreshJobs: async (conversationId) => {
    try {
      const jobs = await api.listJobs(conversationId);
      set((state) => ({
        byConversation: patch(state.byConversation, conversationId, (current) => ({ ...current, jobs })),
      }));
    } catch {
      // silencioso
    }
  },

  killJob: async (conversationId, jobId) => {
    try {
      const job = await api.killJob(jobId);
      set((state) => ({
        byConversation: patch(state.byConversation, conversationId, (current) => ({
          ...current,
          jobs: upsertJob(current.jobs, job),
        })),
      }));
    } catch (error) {
      toast.error('Não foi possível parar o processo', { description: String(error) });
    }
  },

  revertTurn: async (conversationId, turnId) => {
    try {
      const ok = await api.revertTurn(conversationId, turnId);
      if (ok) {
        toast.success('Turno revertido');
        await get().refresh(conversationId);
      }
      return ok;
    } catch (error) {
      toast.error('Não foi possível reverter o turno', { description: String(error) });
      return false;
    }
  },

  revertFile: async (conversationId, path) => {
    try {
      const ok = await api.revertFile(conversationId, path);
      if (ok) {
        toast.success(`Arquivo revertido: ${path}`);
        await get().refresh(conversationId);
      }
      return ok;
    } catch (error) {
      toast.error('Não foi possível reverter o arquivo', { description: String(error) });
      return false;
    }
  },

  compact: async (conversationId) => {
    try {
      const ok = await api.compactSession(conversationId);
      await get().refresh(conversationId);
      return ok;
    } catch (error) {
      toast.error('Não foi possível compactar o contexto', { description: String(error) });
      return false;
    }
  },
}));
