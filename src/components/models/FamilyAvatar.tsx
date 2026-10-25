import { MODEL_ICON_SVG } from '@/lib/modelIconAssets';
import {
  MODEL_ICON_LABELS,
  fallbackInitials,
  modelIconForFamily,
  type ModelIconKey,
} from '@/lib/modelIcons';
import { cn } from '@/lib/utils';

export interface FamilyAvatarProps {
  family?: string | null;
  /** Used for the fallback initials when the family has no brand mark. */
  name?: string | null;
  size?: number;
  className?: string;
  title?: string;
}

/** Resolved visual identity of a model tile. */
export interface FamilyVisual {
  /** LobeHub mark of the family (`null` when the collection has no brand). */
  icon: ModelIconKey | null;
  /** Human label of the mark (`null` when `icon` is `null`). */
  label: string | null;
  /** Name-based initials used by the brand-less fallback tile. */
  initials: string;
  /** Token-only classes of the tile (background + glyph color). */
  className: string;
}

interface BrandVisual {
  /**
   * Legacy initials kept for API compatibility: they are not painted when the
   * LobeHub glyph exists, but consumers of `familyAvatarVisual` still get them.
   */
  initials: string;
  className: string;
}

/** Token-only colors per LobeHub mark (no raw hex, light/dark safe). */
const BRAND_VISUALS: Readonly<Record<ModelIconKey, BrandVisual>> = {
  claude: { initials: 'C', className: 'bg-warning-soft text-warning' },
  deepseek: { initials: 'DS', className: 'bg-surface-active text-accent' },
  gemini: { initials: 'Gm', className: 'bg-accent-soft text-accent' },
  zai: { initials: 'GL', className: 'bg-accent-soft text-accent' },
  openai: { initials: 'G', className: 'bg-success-soft text-success' },
  grok: { initials: 'X', className: 'bg-surface-active text-foreground' },
  hunyuan: { initials: 'H', className: 'bg-accent-soft text-accent' },
  kimi: { initials: 'K', className: 'bg-accent-soft text-accent' },
  longcat: { initials: 'L', className: 'bg-success-soft text-success' },
  xiaomimimo: { initials: 'Mi', className: 'bg-danger-soft text-danger' },
  minimax: { initials: 'MM', className: 'bg-danger-soft text-danger' },
  mistral: { initials: 'M', className: 'bg-warning-soft text-warning' },
  meta: { initials: 'Mu', className: 'bg-warning-soft text-warning' },
  nvidia: { initials: 'N', className: 'bg-success-soft text-success' },
  qwen: { initials: 'Q', className: 'bg-accent-soft text-accent' },
  stepfun: { initials: 'S', className: 'bg-success-soft text-success' },
};

const FALLBACK_CLASSNAME = 'bg-surface-hover text-foreground-muted';

/**
 * The mono SVGs are painted with `currentColor` and sized at `1em`, so the tile
 * paints the glyph at ~58% of its own size (min 8px, rounded).
 */
function glyphFontSize(size: number): number {
  return Math.max(8, Math.round(size * 0.58));
}

/** Fallback initials keep the original avatar typographic scale. */
function initialsFontSize(size: number, initials: string): number {
  return Math.max(8, Math.round(size * (initials.length > 1 ? 0.34 : 0.44)));
}

/** Deterministic visual identity for a model family (token-only classes). */
export function familyAvatarVisual(family?: string | null, name?: string | null): FamilyVisual {
  const icon = modelIconForFamily(family);
  if (!icon) {
    // No official brand in the LobeHub collection: the model *name* is the
    // useful identity (Beam Free → BF, not DE from the `default` family).
    return {
      icon: null,
      label: null,
      initials: fallbackInitials(name, family),
      className: FALLBACK_CLASSNAME,
    };
  }
  const brand = BRAND_VISUALS[icon];
  return { icon, label: MODEL_ICON_LABELS[icon], initials: brand.initials, className: brand.className };
}

/**
 * Round model tile: the official LobeHub brand glyph when the family has one,
 * otherwise the model name initials. Decorative when the name is adjacent.
 */
export function FamilyAvatar({ family, name, size = 20, className, title }: FamilyAvatarProps) {
  const visual = familyAvatarVisual(family, name);
  const { icon } = visual;
  const fontSize = icon ? glyphFontSize(size) : initialsFontSize(size, visual.initials);

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
      {icon ? (
        // Trusted internal constant (bundled LobeHub SVG, MIT): never user input.
        <span
          style={{ fontSize: glyphFontSize(size) }}
          className="[&>svg]:block"
          dangerouslySetInnerHTML={{ __html: MODEL_ICON_SVG[icon] }}
        />
      ) : (
        visual.initials
      )}
    </span>
  );
}
