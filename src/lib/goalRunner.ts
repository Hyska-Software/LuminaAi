/**
 * Regras puras do sistema de Goal (docs/goals/code-goals/PLAN.md §7.6/§10).
 *
 * Este módulo não conhece stores nem React: recebe o snapshot da sessão e
 * responde se a próxima rodada automática pode começar, além dos rótulos pt-BR
 * usados pela UI. A verdade final é sempre o preflight do backend
 * (`goal_can_continue`); aqui evitamos IPC/turno quando a resposta local já é
 * não.
 */
import type { GoalPauseReason, GoalRound, GoalStatus, GoalView, TurnKind } from './types';

/** Entrada da decisão de autocontinuação (snapshot do `codeStore` + chatStore). */
export interface GoalContinuationInput {
  goal: GoalView | null | undefined;
  planMode: boolean;
  approvalCount: number;
  questionCount: number;
  streaming: boolean;
  activeId: string | null;
  conversationId: string;
  layoutMode: 'chat' | 'code' | 'agent';
  /** Agentes só rodam o loop de objetivo quando a thread tem workspace. */
  hasWorkspace?: boolean;
}

/**
 * `done` de um turno bem-sucedido deve iniciar a próxima rodada?
 *
 * Exige: objetivo ativo e armado, orçamento restante, nenhum plano/aprovação/
 * pergunta pendente, nenhum streaming, a sessão do objetivo ativa e o layout
 * Code visível. Sempre chame `api.goalCanContinue` depois (o backend revalida
 * e pode recusar por `interrupted`/`busy`/`no_workspace`).
 */
export function shouldContinueGoal(input: GoalContinuationInput): boolean {
  const { goal } = input;
  if (!goal) return false;
  const codeCapable =
    input.layoutMode === 'code' ||
    (input.layoutMode === 'agent' && input.hasWorkspace === true);
  if (!codeCapable) return false;
  if (input.activeId !== input.conversationId) return false;
  if (input.streaming) return false;
  if (input.planMode) return false;
  if (input.approvalCount > 0 || input.questionCount > 0) return false;
  if (goal.status !== 'active' || !goal.autoContinue) return false;
  return goal.rounds < goal.maxRounds;
}

/** O objetivo pode rodar uma rodada manual ("Nova rodada") agora? */
export function canStartGoalRound(input: Omit<GoalContinuationInput, 'layoutMode'>): boolean {
  const { goal } = input;
  if (!goal) return false;
  if (input.activeId !== input.conversationId) return false;
  if (input.streaming) return false;
  if (input.planMode) return false;
  if (input.approvalCount > 0 || input.questionCount > 0) return false;
  return goal.status === 'active' && goal.rounds < goal.maxRounds;
}

/** Rótulo do status do objetivo para pill/badge/cards. */
export function goalStatusLabel(goal: GoalView, streaming = false): string {
  if (streaming && goal.status === 'active') return 'Trabalhando';
  switch (goal.status) {
    case 'active':
      return goal.autoContinue ? 'Automático' : 'Manual';
    case 'paused':
      return 'Pausado';
    case 'completed':
      return 'Concluído';
    case 'blocked':
      return 'Bloqueado';
    default:
      return 'Objetivo';
  }
}

/** Texto curto do motivo de pausa (quando houver). */
export function goalPauseReasonLabel(reason: GoalPauseReason | null | undefined): string | null {
  switch (reason) {
    case 'user':
      return 'Pausado por você';
    case 'error':
      return 'Pausado após um erro';
    case 'max_rounds':
      return 'Limite de rodadas atingido';
    case 'stalled':
      return 'Sem progresso em 3 rodadas';
    case 'interrupted':
      return 'Rodada anterior interrompida';
    default:
      return null;
  }
}

/** Linha de rodada (`3 de 25`); sem objetivo devolve string vazia. */
export function goalRoundLabel(goal: GoalView | null | undefined): string {
  if (!goal) return '';
  return `Rodada ${goal.rounds} de ${goal.maxRounds}`;
}

/** Número da próxima rodada (1-based, limitado ao orçamento). */
export function goalNextRound(goal: GoalView): number {
  return Math.min(goal.rounds + 1, goal.maxRounds);
}

/** Rodada em andamento? */
export function goalIsRunning(
  goal: GoalView | null | undefined,
  streaming: boolean,
  streamingTurnKind?: TurnKind | null,
  streamingConversationId?: string | null,
  conversationId?: string | null,
): boolean {
  return Boolean(
    goal &&
      streaming &&
      streamingTurnKind === 'goal_round' &&
      streamingConversationId === conversationId,
  );
}

/** Motivo de recusa do preflight (`GOAL_*`/`goal_can_continue.reason`) em pt-BR. */
export function goalContinuationReasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case 'no_goal':
      return 'Defina um objetivo para esta sessão.';
    case 'not_code':
      return 'O objetivo só existe em sessões do layout Code.';
    case 'completed':
      return 'Objetivo concluído.';
    case 'blocked':
      return 'Objetivo bloqueado.';
    case 'paused':
      return 'Objetivo pausado.';
    case 'not_armed':
      return 'Continuidade automática desativada.';
    case 'max_rounds':
      return 'Limite de rodadas atingido.';
    case 'plan_mode':
      return 'Modo Plano ativo: aprove o plano para continuar.';
    case 'pending_approval':
      return 'Há uma aprovação ou pergunta pendente.';
    case 'busy':
      return 'Já existe um turno em andamento nesta sessão.';
    case 'no_workspace':
      return 'Abra uma pasta para trabalhar no objetivo.';
    case 'interrupted':
      return 'A última rodada foi interrompida. Retome para continuar.';
    default:
      return reason ? `Não foi possível continuar: ${reason}` : 'Não foi possível continuar.';
  }
}

/** Resumo textual do progresso das rodadas (painel/popover). */
export function goalProgressSummary(goal: GoalView, rounds: readonly GoalRound[] = []): string {
  const finished = rounds.filter((round) => round.outcome != null);
  const totalMs = finished.reduce((total, round) => total + (round.durationMs ?? 0), 0);
  const parts = [`${goal.rounds}/${goal.maxRounds} rodadas`];
  if (finished.length > 0) parts.push(`${finished.length} concluídas`);
  if (totalMs > 0) parts.push(`${Math.round(totalMs / 1000)}s`);
  return parts.join(' · ');
}

/** Os três estados que exigem atenção do usuário (card no fim do transcript). */
export function goalNeedsAttention(goal: GoalView | null | undefined): boolean {
  if (!goal) return false;
  if (goal.status === 'blocked' || goal.status === 'completed') return true;
  if (goal.status !== 'paused') return false;
  return goal.pauseReason !== 'user';
}

/** O objetivo pode ser estendido (limite de rodadas)? */
export function goalCanExtend(goal: GoalView | null | undefined): boolean {
  return Boolean(goal && goal.status === 'paused' && goal.pauseReason === 'max_rounds');
}

/** Status visual do objetivo para o pill (tokens de cor ficam no componente). */
export function goalStatusTone(
  goal: GoalView | null | undefined,
): 'neutral' | 'accent' | 'warning' | 'danger' | 'success' {
  if (!goal) return 'neutral';
  switch (goal.status) {
    case 'active':
      return 'accent';
    case 'paused':
      return 'warning';
    case 'blocked':
      return 'danger';
    case 'completed':
      return 'success';
    default:
      return 'neutral';
  }
}

/** Ordem canônica dos status para filtros/menus (não usada ainda, estável). */
export const GOAL_STATUS_ORDER: readonly GoalStatus[] = [
  'active',
  'paused',
  'completed',
  'blocked',
];
