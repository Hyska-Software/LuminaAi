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

export { PlanCard, MAX_PLAN_CHARS } from './PlanCard';
export type { PlanAction, PlanCardProps } from './PlanCard';
export {
  PresentationBoundary,
  normalizeGoalPresentation,
  normalizePlanPresentation,
} from './ToolPresentationCard';

export { GoalCard } from './GoalCard';
export type { GoalCardAction, GoalCardProps } from './GoalCard';

export { GoalAttentionCard } from './GoalAttentionCard';
export type { GoalAttentionCardProps } from './GoalAttentionCard';

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

export {
  CacheChipSegment,
  CacheDiagnostics,
  CacheHitChip,
  cacheAriaLabel,
  cacheStateSentence,
} from './CacheHitChip';
export type { CacheDiagnosticsProps, CacheHitChipProps } from './CacheHitChip';

export { CacheDiagnosticsDialog } from './CacheDiagnosticsDialog';
export type { CacheDiagnosticsDialogProps } from './CacheDiagnosticsDialog';
export { CACHE_DIAGNOSTICS_EVENT, requestCacheDiagnostics } from './cacheDiagnosticsRequest';
export {
  buildCacheDiagnostics,
  cacheStateBadgeTone,
  formatCacheTtl,
  RECENT_BREAKS_LIMIT,
} from './cacheDiagnostics';
export type {
  CacheBreakEntry,
  CacheDiagnosticsInput,
  CacheDiagnosticsView,
} from './cacheDiagnostics';

export { JobsBar } from './JobsBar';
export type { JobsBarProps } from './JobsBar';

export { TurnFooter } from './TurnFooter';
export type { TurnFooterProps } from './TurnFooter';
