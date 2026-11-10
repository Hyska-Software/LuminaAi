import { Bot, Code, MessageSquare, type LucideIcon } from 'lucide-react';
import type { LayoutMode } from './store/uiStore';

export interface LayoutModeMeta {
  value: LayoutMode;
  /** Translation key in the `common` namespace. */
  labelKey: string;
  /** Translation key in the `common` namespace. */
  titleKey: string;
  /** Translation key in the `common` namespace. */
  descriptionKey: string;
  icon: LucideIcon;
}

/**
 * Chat | Code | Agentes, in selector order. Shared by the title-bar switcher,
 * the right-click visibility menu and Settings so labels never drift.
 */
export const LAYOUT_MODES = [
  {
    value: 'chat',
    labelKey: 'layouts.chat.label',
    titleKey: 'layouts.chat.title',
    descriptionKey: 'layouts.chat.description',
    icon: MessageSquare,
  },
  {
    value: 'code',
    labelKey: 'layouts.code.label',
    titleKey: 'layouts.code.title',
    descriptionKey: 'layouts.code.description',
    icon: Code,
  },
  {
    value: 'agent',
    labelKey: 'layouts.agent.label',
    titleKey: 'layouts.agent.title',
    descriptionKey: 'layouts.agent.description',
    icon: Bot,
  },
] as const satisfies readonly LayoutModeMeta[];

/** Which layout buttons are offered by the title-bar switcher (persisted). */
export type LayoutVisibility = Record<LayoutMode, boolean>;

export const DEFAULT_LAYOUT_VISIBILITY: LayoutVisibility = {
  chat: true,
  code: true,
  agent: true,
};

/**
 * Defensive read of a persisted map: unknown keys are ignored, missing keys mean
 * "enabled" (older snapshots) and an all-off map is repaired to the default so
 * the app can never lose its way back to a layout.
 */
export function sanitizeLayoutVisibility(value: unknown): LayoutVisibility {
  if (!value || typeof value !== 'object') return { ...DEFAULT_LAYOUT_VISIBILITY };
  const input = value as Partial<Record<LayoutMode, unknown>>;
  const next: LayoutVisibility = {
    chat: typeof input.chat === 'boolean' ? input.chat : true,
    code: typeof input.code === 'boolean' ? input.code : true,
    agent: typeof input.agent === 'boolean' ? input.agent : true,
  };
  return next.chat || next.code || next.agent ? next : { ...DEFAULT_LAYOUT_VISIBILITY };
}

/** Enabled modes in selector order (Chat → Code → Agentes). */
export function enabledLayoutModes(visibility: LayoutVisibility): LayoutMode[] {
  return LAYOUT_MODES.filter((mode) => visibility[mode.value]).map((mode) => mode.value);
}

/** First enabled mode in selector order; `sanitizeLayoutVisibility` guarantees at least one. */
export function firstEnabledLayout(visibility: LayoutVisibility): LayoutMode {
  return enabledLayoutModes(visibility)[0] ?? 'chat';
}
