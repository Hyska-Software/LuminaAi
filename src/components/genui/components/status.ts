import {
  AlertCircle,
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleDot,
  type LucideIcon,
} from 'lucide-react';

/**
 * Semântica visual dos estados usados por `checklist` e pelos itens de `list`.
 *
 * O texto (`label`) é obrigatório para leitores de tela: nenhum estado pode ser
 * comunicado apenas pela cor. A cor vem de tokens do design system.
 */
export type GenUIStatus = 'done' | 'active' | 'pending' | 'disabled' | 'error';

interface GenUIStatusMeta {
  label: string;
  icon: LucideIcon;
  className: string;
}

const STATUS_META: Record<GenUIStatus, GenUIStatusMeta> = {
  done: { label: 'Concluído', icon: CheckCircle2, className: 'text-success' },
  active: { label: 'Em andamento', icon: CircleDot, className: 'text-accent' },
  pending: { label: 'Pendente', icon: Circle, className: 'text-foreground-subtle' },
  disabled: { label: 'Desativado', icon: CircleDashed, className: 'text-foreground-subtle' },
  error: { label: 'Erro', icon: AlertCircle, className: 'text-danger' },
};

/** Normaliza um status vindo de props; desconhecido cai no default `pending`. */
export function statusKey(status: string | undefined): GenUIStatus {
  if (status && Object.hasOwn(STATUS_META, status)) return status as GenUIStatus;
  return 'pending';
}

/** Metadados (texto + ícone + cor) de um status, com fallback defensivo. */
export function statusMeta(status: string | undefined): GenUIStatusMeta {
  return STATUS_META[statusKey(status)];
}
