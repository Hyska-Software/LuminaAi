import {
  AlertCircle,
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleDot,
  type LucideIcon,
} from 'lucide-react';
import { i18n } from '@/lib/i18n';

/**
 * Semântica visual dos estados usados por `checklist` e pelos itens de `list`.
 *
 * O texto (`label`) é obrigatório para leitores de tela: nenhum estado pode ser
 * comunicado apenas pela cor. A cor vem de tokens do design system.
 */
export type GenUIStatus = 'done' | 'active' | 'pending' | 'disabled' | 'error';

type GenUIStatusKey =
  | 'status.done'
  | 'status.active'
  | 'status.pending'
  | 'status.disabled'
  | 'status.error';

/** Resolved per call so the current locale is always applied. */
const t = i18n.getFixedT(null, 'genui');

interface GenUIStatusMeta {
  label: string;
  icon: LucideIcon;
  className: string;
}

interface GenUIStatusDefinition {
  labelKey: GenUIStatusKey;
  icon: LucideIcon;
  className: string;
}

const STATUS_META: Record<GenUIStatus, GenUIStatusDefinition> = {
  done: { labelKey: 'status.done', icon: CheckCircle2, className: 'text-success' },
  active: { labelKey: 'status.active', icon: CircleDot, className: 'text-accent' },
  pending: { labelKey: 'status.pending', icon: Circle, className: 'text-foreground-subtle' },
  disabled: { labelKey: 'status.disabled', icon: CircleDashed, className: 'text-foreground-subtle' },
  error: { labelKey: 'status.error', icon: AlertCircle, className: 'text-danger' },
};

/** Normaliza um status vindo de props; desconhecido cai no default `pending`. */
export function statusKey(status: string | undefined): GenUIStatus {
  if (status && Object.hasOwn(STATUS_META, status)) return status as GenUIStatus;
  return 'pending';
}

/**
 * Metadados (texto + ícone + cor) de um status, com fallback defensivo.
 *
 * O rótulo é resolvido a cada chamada para acompanhar a troca de idioma.
 */
export function statusMeta(status: string | undefined): GenUIStatusMeta {
  const meta = STATUS_META[statusKey(status)];
  return { label: t(meta.labelKey), icon: meta.icon, className: meta.className };
}
