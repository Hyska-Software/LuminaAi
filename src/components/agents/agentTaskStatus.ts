import type { AgentTaskStatus } from '@/lib/types';

export interface TaskStatusMeta {
  labelKey: string;
  tone: string;
  badge: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}

/** Single source for task labels/colors used by the board, activity and dialogs. */
const TASK_STATUS_META: Record<AgentTaskStatus, TaskStatusMeta> = {
  queued: { labelKey: 'taskStatus.queued', tone: 'text-foreground-muted', badge: 'neutral' },
  accepted: { labelKey: 'taskStatus.accepted', tone: 'text-accent', badge: 'accent' },
  running: { labelKey: 'taskStatus.running', tone: 'text-accent', badge: 'accent' },
  waiting_input: { labelKey: 'taskStatus.waitingInput', tone: 'text-warning', badge: 'warning' },
  waiting_approval: {
    labelKey: 'taskStatus.waitingApproval',
    tone: 'text-warning',
    badge: 'warning',
  },
  review: { labelKey: 'taskStatus.review', tone: 'text-accent', badge: 'accent' },
  handoff_pending: {
    labelKey: 'taskStatus.handoffPending',
    tone: 'text-warning',
    badge: 'warning',
  },
  done: { labelKey: 'taskStatus.done', tone: 'text-success', badge: 'success' },
  cancelled: {
    labelKey: 'taskStatus.cancelled',
    tone: 'text-foreground-subtle',
    badge: 'neutral',
  },
  failed: { labelKey: 'taskStatus.failed', tone: 'text-danger', badge: 'danger' },
  declined: { labelKey: 'taskStatus.declined', tone: 'text-danger', badge: 'danger' },
};

export function taskStatusMeta(status: AgentTaskStatus): TaskStatusMeta {
  return TASK_STATUS_META[status] ?? TASK_STATUS_META.queued;
}

export const TASK_ATTENTION_STATUSES: AgentTaskStatus[] = [
  'waiting_input',
  'waiting_approval',
  'handoff_pending',
  'review',
];

export const TASK_TERMINAL_STATUSES: AgentTaskStatus[] = [
  'done',
  'failed',
  'cancelled',
  'declined',
];

export const TASK_RESUMABLE_STATUSES: AgentTaskStatus[] = [
  'waiting_input',
  'waiting_approval',
  'review',
];

export const TASK_BOARD_COLUMNS: Array<{
  id: string;
  titleKey: string;
  statuses: AgentTaskStatus[];
}> = [
  { id: 'queued', titleKey: 'board.columns.queued', statuses: ['queued', 'accepted'] },
  { id: 'running', titleKey: 'board.columns.running', statuses: ['running'] },
  {
    id: 'attention',
    titleKey: 'board.columns.attention',
    statuses: ['waiting_input', 'waiting_approval', 'handoff_pending'],
  },
  { id: 'review', titleKey: 'board.columns.review', statuses: ['review'] },
  { id: 'done', titleKey: 'board.columns.done', statuses: ['done'] },
  { id: 'closed', titleKey: 'board.columns.closed', statuses: ['failed', 'cancelled', 'declined'] },
];
