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
import { t } from '@/lib/i18n';
import type { SkillSummary } from '@/lib/types';

/**
 * Skill repositories read by the app (FILES §7.2/§7.4).
 *
 * `user` is the Zylara data directory (the only wriable origin); the other
 * external origins are the default skill folders of other agents, which the
 * app only reads — they can be disabled but never deleted.
 */
type SkillSourceKey = 'user' | 'agents' | 'codex' | 'claude' | 'opencode' | 'bundled';
type SkillSourceGroupKey = `library:skills.sources.${SkillSourceKey}.group`;
type SkillSourceLabelKey = `library:skills.sources.${SkillSourceKey}.label`;

export interface SkillSourceMeta {
  /** Backend `SkillSummary.source` value. */
  key: string;
  /** Translation key of the section title (plural), or `null` for unknown origins. */
  groupLabelKey: SkillSourceGroupKey | null;
  /** Translation key of the short badge label, or `null` for unknown origins. */
  labelKey: SkillSourceLabelKey | null;
  /** Section title in the Skills view, resolved on access. */
  readonly groupLabel: string;
  /** Short badge label shown on each skill row / settings list, resolved on access. */
  readonly label: string;
  tone: BadgeTone;
  icon: LucideIcon;
  /** Origin owned by another agent: read-only, but can be disabled. */
  external: boolean;
}

function sourceMeta(
  key: SkillSourceKey,
  groupLabelKey: SkillSourceGroupKey,
  labelKey: SkillSourceLabelKey,
  tone: BadgeTone,
  icon: LucideIcon,
  external: boolean,
): SkillSourceMeta {
  return {
    key,
    groupLabelKey,
    labelKey,
    tone,
    icon,
    external,
    get groupLabel() {
      return t(groupLabelKey);
    },
    get label() {
      return t(labelKey);
    },
  };
}

/** Canonical order used by the Skills view (FILES §7.4). */
export const SKILL_SOURCES: readonly SkillSourceMeta[] = [
  sourceMeta(
    'user',
    'library:skills.sources.user.group',
    'library:skills.sources.user.label',
    'accent',
    Sparkles,
    false,
  ),
  sourceMeta(
    'agents',
    'library:skills.sources.agents.group',
    'library:skills.sources.agents.label',
    'muted',
    Boxes,
    true,
  ),
  sourceMeta(
    'codex',
    'library:skills.sources.codex.group',
    'library:skills.sources.codex.label',
    'muted',
    SquareTerminal,
    true,
  ),
  sourceMeta(
    'claude',
    'library:skills.sources.claude.group',
    'library:skills.sources.claude.label',
    'muted',
    Bot,
    true,
  ),
  sourceMeta(
    'opencode',
    'library:skills.sources.opencode.group',
    'library:skills.sources.opencode.label',
    'muted',
    Terminal,
    true,
  ),
  sourceMeta(
    'bundled',
    'library:skills.sources.bundled.group',
    'library:skills.sources.bundled.label',
    'success',
    Package,
    false,
  ),
];

function fallbackMeta(source: string): SkillSourceMeta {
  const raw = source.trim();
  return {
    key: source,
    groupLabelKey: null,
    labelKey: null,
    get groupLabel() {
      return raw || t('library:skills.sources.other');
    },
    get label() {
      return raw || t('library:skills.sources.other');
    },
    tone: 'muted',
    icon: LibraryBig,
    external: false,
  };
}

export function skillSourceMeta(source: string): SkillSourceMeta {
  return SKILL_SOURCES.find((entry) => entry.key === source) ?? fallbackMeta(source);
}

/**
 * Display metadata of a skill. Built-in skills ship their `SKILL.md` in English,
 * so their name/description are localized; user and external skills keep the
 * metadata exactly as the repository provides it.
 */
export function localizedSkillMeta(skill: Pick<SkillSummary, 'name' | 'description'>): {
  name: string;
  description: string;
} {
  switch (skill.name) {
    case 'imagens':
      return {
        name: t('library:skills.builtin.imagens.name'),
        description: t('library:skills.builtin.imagens.description'),
      };
    case 'pdf':
      return {
        name: t('library:skills.builtin.pdf.name'),
        description: t('library:skills.builtin.pdf.description'),
      };
    case 'office-docx':
      return {
        name: t('library:skills.builtin.office-docx.name'),
        description: t('library:skills.builtin.office-docx.description'),
      };
    case 'office-pptx':
      return {
        name: t('library:skills.builtin.office-pptx.name'),
        description: t('library:skills.builtin.office-pptx.description'),
      };
    case 'office-xlsx':
      return {
        name: t('library:skills.builtin.office-xlsx.name'),
        description: t('library:skills.builtin.office-xlsx.description'),
      };
    default:
      return { name: skill.name, description: skill.description };
  }
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
