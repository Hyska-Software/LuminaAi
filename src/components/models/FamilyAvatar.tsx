import { cn } from '@/lib/utils';

export interface FamilyAvatarProps {
  family?: string | null;
  /** Used for the fallback initials when the family is unknown. */
  name?: string | null;
  size?: number;
  className?: string;
  title?: string;
}

interface FamilyVisual {
  initials: string;
  className: string;
}

/** Token-only colors per model family (no raw hex, light/dark safe). */
const FAMILY_VISUALS: Record<string, FamilyVisual> = {
  claude: { initials: 'C', className: 'bg-warning-soft text-warning' },
  deepseek: { initials: 'DS', className: 'bg-surface-active text-accent' },
  gemini: { initials: 'Gm', className: 'bg-accent-soft text-accent' },
  glm: { initials: 'GL', className: 'bg-accent-soft text-accent' },
  gpt: { initials: 'G', className: 'bg-success-soft text-success' },
  grok: { initials: 'X', className: 'bg-surface-active text-foreground' },
  hy: { initials: 'H', className: 'bg-accent-soft text-accent' },
  kimi: { initials: 'K', className: 'bg-accent-soft text-accent' },
  longcat: { initials: 'L', className: 'bg-success-soft text-success' },
  mimo: { initials: 'Mi', className: 'bg-danger-soft text-danger' },
  minimax: { initials: 'MM', className: 'bg-danger-soft text-danger' },
  mistral: { initials: 'M', className: 'bg-warning-soft text-warning' },
  muse: { initials: 'Mu', className: 'bg-warning-soft text-warning' },
  nemotron: { initials: 'N', className: 'bg-success-soft text-success' },
  qwen: { initials: 'Q', className: 'bg-accent-soft text-accent' },
  step: { initials: 'S', className: 'bg-success-soft text-success' },
};

const FALLBACKS: FamilyVisual[] = [
  { initials: '?', className: 'bg-surface-hover text-foreground-muted' },
];

function fallbackInitials(family?: string | null, name?: string | null): string {
  const source = (family || name || '?').trim();
  const letters = source.replace(/[^a-zA-Z0-9]/g, '');
  return (letters.slice(0, 2) || '?').toUpperCase();
}

/** Deterministic visual identity for a model family. */
export function familyAvatarVisual(family?: string | null, name?: string | null): FamilyVisual {
  const key = (family ?? '').toLowerCase().trim();
  const known = FAMILY_VISUALS[key];
  if (known) return known;
  if (!key && !name) return FALLBACKS[0];
  return { initials: fallbackInitials(family, name), className: 'bg-surface-hover text-foreground-muted' };
}

/** Round avatar with the family initials (decorative when the name is adjacent). */
export function FamilyAvatar({ family, name, size = 20, className, title }: FamilyAvatarProps) {
  const visual = familyAvatarVisual(family, name);
  const fontSize = Math.max(8, Math.round(size * (visual.initials.length > 1 ? 0.34 : 0.44)));

  return (
    <span
      aria-hidden
      title={title}
      style={{ width: size, height: size, fontSize }}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold uppercase leading-none tracking-tight',
        visual.className,
        className,
      )}
    >
      {visual.initials}
    </span>
  );
}
