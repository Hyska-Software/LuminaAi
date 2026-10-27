/**
 * Cards do agente do harness de código (WORKBENCH §5).
 *
 * Todos são puramente apresentacionais: recebem os contratos de
 * `src/lib/types.ts` por props e sobem decisões por callback — nenhum card
 * chama `api` ou store. A integração (timeline do ChatView, painéis) é do
 * container.
 */
export { ApprovalCard } from './ApprovalCard';
export type {
  ApprovalCardProps,
  ApprovalDecisionOptions,
  ApprovalResolution,
} from './ApprovalCard';

export { PlanCard } from './PlanCard';
export type { PlanAction, PlanCardProps } from './PlanCard';

export { TodoCard } from './TodoCard';
export type { TodoCardProps } from './TodoCard';

export { AskUserCard } from './AskUserCard';
export type {
  AskUserAnswer,
  AskUserCardProps,
  AskUserOption,
  AskUserQuestion,
} from './AskUserCard';

export { ContextMeter } from './ContextMeter';
export type { ContextMeterProps } from './ContextMeter';

export { JobsBar } from './JobsBar';
export type { JobsBarProps } from './JobsBar';

export { TurnFooter } from './TurnFooter';
export type { TurnFooterProps } from './TurnFooter';
