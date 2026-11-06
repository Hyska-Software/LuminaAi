import type { AgentTaskStatus } from '@/lib/types';

export interface TaskStatusMeta {
  label: string;
  tone: string;
  badge: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}

/** Single source for task labels/colors used by the board, activity and dialogs. */
export const TASK_STATUS_META: Record<AgentTaskStatus, TaskStatusMeta> = {
  queued: { label: 'Na fila', tone: 'text-foreground-muted', badge: 'neutral' },
  accepted: { label: 'Aceita', tone: 'text-accent', badge: 'accent' },
  running: { label: 'Executando', tone: 'text-accent', badge: 'accent' },
  waiting_input: { label: 'Aguardando resposta', tone: 'text-warning', badge: 'warning' },
  waiting_approval: { label: 'Aguardando aprovação', tone: 'text-warning', badge: 'warning' },
  review: { label: 'Em revisão', tone: 'text-accent', badge: 'accent' },
  handoff_pending: { label: 'Transferida', tone: 'text-warning', badge: 'warning' },
  done: { label: 'Concluída', tone: 'text-success', badge: 'success' },
  cancelled: { label: 'Cancelada', tone: 'text-foreground-subtle', badge: 'neutral' },
  failed: { label: 'Falhou', tone: 'text-danger', badge: 'danger' },
  declined: { label: 'Recusada', tone: 'text-danger', badge: 'danger' },
};

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
  title: string;
  statuses: AgentTaskStatus[];
}> = [
  { id: 'queued', title: 'Em fila', statuses: ['queued', 'accepted'] },
  { id: 'running', title: 'Em andamento', statuses: ['running'] },
  { id: 'attention', title: 'Aguardando', statuses: ['waiting_input', 'waiting_approval', 'handoff_pending'] },
  { id: 'review', title: 'Revisão', statuses: ['review'] },
  { id: 'done', title: 'Concluídas', statuses: ['done'] },
  { id: 'closed', title: 'Encerradas', statuses: ['failed', 'cancelled', 'declined'] },
];
