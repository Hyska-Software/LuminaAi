import {
  Bot,
  Boxes,
  LibraryBig,
  Package,
  Sparkles,
  SquareTerminal,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import type { BadgeTone } from '@/components/ui';
import type { SkillSummary } from '@/lib/types';

/**
 * Skill repositories read by the app (FILES §7.2/§7.4).
 *
 * `user` is the Zylara data directory (the only wriable origin); the other
 * external origins are the default skill folders of other agents, which the
 * app only reads — they can be disabled but never deleted.
 */
export interface SkillSourceMeta {
  /** Backend `SkillSummary.source` value. */
  key: string;
  /** Section title in the Skills view (plural). */
  groupLabel: string;
  /** Short badge label shown on each skill row / settings list. */
  label: string;
  tone: BadgeTone;
  icon: LucideIcon;
  /** Origin owned by another agent: read-only, but can be disabled. */
  external: boolean;
}

/** Canonical order used by the Skills view (FILES §7.4). */
export const SKILL_SOURCES: readonly SkillSourceMeta[] = [
  {
    key: 'user',
    groupLabel: 'Zylara',
    label: 'Do Zylara',
    tone: 'accent',
    icon: Sparkles,
    external: false,
  },
  {
    key: 'agents',
    groupLabel: 'Agentes',
    label: 'Agentes',
    tone: 'muted',
    icon: Boxes,
    external: true,
  },
  {
    key: 'codex',
    groupLabel: 'Codex',
    label: 'Codex',
    tone: 'muted',
    icon: SquareTerminal,
    external: true,
  },
  {
    key: 'claude',
    groupLabel: 'Claude',
    label: 'Claude',
    tone: 'muted',
    icon: Bot,
    external: true,
  },
  {
    key: 'opencode',
    groupLabel: 'OpenCode',
    label: 'OpenCode',
    tone: 'muted',
    icon: Terminal,
    external: true,
  },
  {
    key: 'bundled',
    groupLabel: 'Embutidas',
    label: 'Embutida',
    tone: 'success',
    icon: Package,
    external: false,
  },
];

function fallbackMeta(source: string): SkillSourceMeta {
  const label = source.trim() || 'Outra origem';
  return {
    key: source,
    groupLabel: label,
    label,
    tone: 'muted',
    icon: LibraryBig,
    external: false,
  };
}

export function skillSourceMeta(source: string): SkillSourceMeta {
  return SKILL_SOURCES.find((entry) => entry.key === source) ?? fallbackMeta(source);
}

/** True when the skill comes from another agent's read-only repository. */
export function isExternalSkillSource(source: string): boolean {
  return skillSourceMeta(source).external;
}

export interface SkillGroup {
  source: string;
  meta: SkillSourceMeta;
  skills: SkillSummary[];
}

/**
 * Groups skills in the canonical origin order, keeping only non-empty groups;
 * unknown origins are appended at the end in first-seen order.
 */
export function groupSkillsBySource(skills: SkillSummary[]): SkillGroup[] {
  const bySource = new Map<string, SkillSummary[]>();
  for (const skill of skills) {
    const list = bySource.get(skill.source) ?? [];
    list.push(skill);
    bySource.set(skill.source, list);
  }

  const groups: SkillGroup[] = [];
  for (const meta of SKILL_SOURCES) {
    const list = bySource.get(meta.key);
    if (list?.length) groups.push({ source: meta.key, meta, skills: list });
  }

  const known = new Set(SKILL_SOURCES.map((entry) => entry.key));
  for (const [source, list] of bySource) {
    if (known.has(source) || !list.length) continue;
    groups.push({ source, meta: fallbackMeta(source), skills: list });
  }
  return groups;
}

export interface SkillOriginCounts {
  total: number;
  /** Skills from the Zylara data directory (`source === 'user'`). */
  zylara: number;
  /** Skills found in other agents' repositories (all read-only origins). */
  external: number;
  bundled: number;
  /** Unknown origins, if the backend ever adds one. */
  other: number;
}

export function countSkillsByOrigin(skills: SkillSummary[]): SkillOriginCounts {
  const counts: SkillOriginCounts = { total: skills.length, zylara: 0, external: 0, bundled: 0, other: 0 };
  for (const skill of skills) {
    const meta = skillSourceMeta(skill.source);
    if (meta.key === 'user') counts.zylara += 1;
    else if (meta.external) counts.external += 1;
    else if (meta.key === 'bundled') counts.bundled += 1;
    else counts.other += 1;
  }
  return counts;
}
