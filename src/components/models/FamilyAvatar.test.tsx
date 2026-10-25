// @vitest-environment jsdom
/**
 * `FamilyAvatar` — tile circular com os glifos de marca da LobeHub.
 *
 * A camada de dados (`src/lib/modelIcons.ts` + `src/lib/modelIconAssets.ts`) já
 * resolve família → marca; aqui a especificação é visual e local: cada família
 * do catálogo com marca oficial pinta um SVG mono (`currentColor`) cujo
 * `<title>` é o título oficial da LobeHub, e famílias sem marca caem nas
 * iniciais do **nome do modelo** (nunca da família).
 *
 * Os títulos esperados abaixo são a fonte oficial da coleção
 * (`@lobehub/icons-static-svg@1.98.0`, MIT — https://icons.lobehub.com) e estão
 * hardcoded de propósito: se um asset mudar de título, este teste deve quebrar.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { catalog } from '@/lib/catalog';
import {
  fallbackInitials,
  MODEL_ICON_LABELS,
  modelIconForFamily,
  type ModelIconKey,
} from '@/lib/modelIcons';
import { FamilyAvatar, familyAvatarVisual } from './FamilyAvatar';

afterEach(cleanup);

/** Título oficial da LobeHub por família do catálogo (spec vigilante). */
const OFFICIAL_TITLES: Readonly<Record<string, string>> = {
  claude: 'Claude',
  deepseek: 'DeepSeek',
  gemini: 'Gemini',
  glm: 'Z.ai',
  gpt: 'OpenAI',
  grok: 'Grok',
  hy: 'Hunyuan',
  kimi: 'Kimi',
  longcat: 'LongCat',
  mimo: 'XiaomiMiMo',
  minimax: 'Minimax',
  mistral: 'Mistral',
  muse: 'Meta',
  nemotron: 'Nvidia',
  qwen: 'Qwen',
  step: 'StepFun',
};

/** Tokens do tile por marca (docs/MODEL_ICONS.md §3 — nenhum hex solto). */
const ICON_TILE_CLASSES: Readonly<Record<ModelIconKey, string>> = {
  claude: 'bg-warning-soft text-warning',
  deepseek: 'bg-surface-active text-accent',
  gemini: 'bg-accent-soft text-accent',
  zai: 'bg-accent-soft text-accent',
  openai: 'bg-success-soft text-success',
  grok: 'bg-surface-active text-foreground',
  hunyuan: 'bg-accent-soft text-accent',
  kimi: 'bg-accent-soft text-accent',
  longcat: 'bg-success-soft text-success',
  xiaomimimo: 'bg-danger-soft text-danger',
  minimax: 'bg-danger-soft text-danger',
  mistral: 'bg-warning-soft text-warning',
  meta: 'bg-warning-soft text-warning',
  nvidia: 'bg-success-soft text-success',
  qwen: 'bg-accent-soft text-accent',
  stepfun: 'bg-success-soft text-success',
};

const FALLBACK_CLASSES = 'bg-surface-hover text-foreground-muted';

/** Alto-falante: ~58% do tile, mínimo de 8px, arredondado. */
function glyphFontSize(size: number): number {
  return Math.max(8, Math.round(size * 0.58));
}

/** Iniciais de fallback: tamanho de fonte preservado do avatar original. */
function initialsFontSize(size: number, initials: string): number {
  return Math.max(8, Math.round(size * (initials.length > 1 ? 0.34 : 0.44)));
}

function catalogFamilies(): string[] {
  const families = new Set<string>();
  for (const provider of catalog.providers) {
    for (const model of provider.models) families.add(model.family);
  }
  return [...families].sort();
}

/** Um modelo real do catálogo por família (os testes não inventam dados). */
function catalogModelFor(family: string): { name: string } {
  for (const provider of catalog.providers) {
    const model = provider.models.find((candidate) => candidate.family === family);
    if (model) return model;
  }
  throw new Error(`Família sem modelo no catálogo: ${family}`);
}

function tileOf(container: HTMLElement): HTMLElement {
  const tile = container.firstElementChild;
  if (!(tile instanceof HTMLElement)) throw new Error('FamilyAvatar não renderizou o tile');
  return tile;
}

function glyphTitleOf(container: HTMLElement): string | null {
  return container.querySelector('svg title')?.textContent ?? null;
}

describe('FamilyAvatar — glifos de marca da LobeHub', () => {
  it('cobre exatamente as famílias com marca do catálogo (sem sobras nos dois lados)', () => {
    const families = catalogFamilies();
    expect(families.length).toBeGreaterThan(0);

    const branded = families.filter((family) => modelIconForFamily(family) !== null);
    expect(branded.sort()).toEqual(Object.keys(OFFICIAL_TITLES).sort());

    const fallbackOnly = families.filter((family) => modelIconForFamily(family) === null);
    expect(fallbackOnly).toEqual(['default']);
  });

  it.each(Object.entries(OFFICIAL_TITLES))(
    'família %s renderiza o SVG oficial "%s"',
    (family, title) => {
      const model = catalogModelFor(family);
      const { container } = render(<FamilyAvatar family={family} name={model.name} />);

      const svg = container.querySelector('svg');
      expect(svg, `família ${family}`).not.toBeNull();
      // Asset mono 24×24: herda a cor do token do tile (claro/escuro).
      expect(svg!.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg!.getAttribute('fill')).toBe('currentColor');
      expect(container.querySelectorAll('svg')).toHaveLength(1);
      expect(glyphTitleOf(container)).toBe(title);
      // O título é o único texto do glifo (não vaza iniciais junto da marca).
      expect(container.querySelectorAll('svg title')).toHaveLength(1);
    },
  );

  it.each(Object.entries(OFFICIAL_TITLES))(
    'família %s usa os tokens de cor da marca e nunca hex solto',
    (family) => {
      const icon = modelIconForFamily(family);
      expect(icon, `família ${family}`).not.toBeNull();
      const { container } = render(<FamilyAvatar family={family} name={catalogModelFor(family).name} />);

      const tile = tileOf(container);
      for (const cls of ICON_TILE_CLASSES[icon!].split(' ')) {
        expect(tile.classList.contains(cls), `${family}: ${cls}`).toBe(true);
      }
      expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
    },
  );
});

describe('FamilyAvatar — fallback sem marca', () => {
  it('família default mostra as iniciais do NOME do modelo, não da família', () => {
    const { container } = render(<FamilyAvatar family="default" name="Beam Free" />);

    expect(container.querySelector('svg')).toBeNull();
    const tile = tileOf(container);
    expect(tile.textContent).toBe('BF');
    // "default" daria "DE": o nome do modelo é a identidade útil.
    expect(tile.textContent).not.toBe('DE');
    for (const cls of FALLBACK_CLASSES.split(' ')) {
      expect(tile.classList.contains(cls), cls).toBe(true);
    }
  });

  it('família desconhecida também cai nas iniciais do nome', () => {
    const { container } = render(<FamilyAvatar family="desconhecida" name="Omen Alpha" />);

    expect(container.querySelector('svg')).toBeNull();
    expect(tileOf(container).textContent).toBe('OA');
  });

  it('sem família e sem nome permanece neutro (?)', () => {
    const { container } = render(<FamilyAvatar />);

    expect(container.querySelector('svg')).toBeNull();
    const tile = tileOf(container);
    expect(tile.textContent).toBe('?');
    expect(tile.classList.contains('bg-surface-hover')).toBe(true);
  });

  it('nome de uma palavra usa as duas primeiras letras', () => {
    const { container } = render(<FamilyAvatar family="outros" name="Flint" />);
    expect(tileOf(container).textContent).toBe('FL');
  });
});

describe('FamilyAvatar — acessibilidade e props', () => {
  it('o tile é decorativo (aria-hidden) e não contém elementos focáveis', () => {
    const { container } = render(<FamilyAvatar family="claude" name="Claude Haiku 5.5" />);
    const tile = tileOf(container);

    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.querySelector('a, button, input, select, textarea, [tabindex], [contenteditable]')).toBeNull();
    expect(tile.hasAttribute('tabindex')).toBe(false);
  });

  it('o fallback também é decorativo e não focável', () => {
    const { container } = render(<FamilyAvatar family="default" name="Big Pickle" />);
    const tile = tileOf(container);

    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.querySelector('a, button, input, select, textarea, [tabindex], [contenteditable]')).toBeNull();
  });

  it('repassa a prop title ao tile', () => {
    const { container } = render(
      <FamilyAvatar family="gpt" name="GPT 5" title="GPT 5 — OpenAI" />,
    );
    expect(tileOf(container).getAttribute('title')).toBe('GPT 5 — OpenAI');
  });

  it('mescla o className do consumidor com as classes base do tile', () => {
    const { container } = render(
      <FamilyAvatar family="qwen" name="Qwen3.7 Max" className="ring-2 ring-accent/40" />,
    );
    const tile = tileOf(container);

    for (const cls of ['inline-flex', 'shrink-0', 'select-none', 'items-center', 'justify-center', 'rounded-full']) {
      expect(tile.classList.contains(cls), cls).toBe(true);
    }
    expect(tile.classList.contains('ring-2')).toBe(true);
    expect(tile.classList.contains('ring-accent/40')).toBe(true);
    expect(tile.classList.contains('bg-accent-soft')).toBe(true);
  });
});

describe('FamilyAvatar — tamanhos', () => {
  it.each([20, 24, 32])('tile de %dpx: largura/altura iguais e glifo proporcional', (size) => {
    const { container } = render(<FamilyAvatar family="gemini" name="Gemini 3 Flash" size={size} />);
    const tile = tileOf(container);

    expect(tile.style.width).toBe(`${size}px`);
    expect(tile.style.height).toBe(`${size}px`);

    const glyph = tile.firstElementChild;
    if (!(glyph instanceof HTMLElement)) throw new Error('glifo não renderizado como elemento');
    expect(glyphFontSize(size)).toBe(Math.round(size * 0.58));
    expect(Number.parseFloat(glyph.style.fontSize)).toBe(glyphFontSize(size));
    // O SVG usa width/height "1em": 58% do tile nunca excede o tile.
    expect(Number.parseFloat(glyph.style.fontSize)).toBeLessThanOrEqual(size);
  });

  it.each([20, 24, 32])('fallback de %dpx mantém o dimensionamento das iniciais', (size) => {
    const { container } = render(<FamilyAvatar family="default" name="Beam Free" size={size} />);
    const tile = tileOf(container);

    expect(tile.style.width).toBe(`${size}px`);
    expect(tile.style.height).toBe(`${size}px`);
    expect(Number.parseFloat(tile.style.fontSize)).toBe(initialsFontSize(size, 'BF'));
  });
});

describe('familyAvatarVisual', () => {
  it.each(Object.entries(OFFICIAL_TITLES))('resolve %s → marca e tokens corretos', (family) => {
    const icon = modelIconForFamily(family);
    expect(icon, `família ${family}`).not.toBeNull();

    const visual = familyAvatarVisual(family, catalogModelFor(family).name);
    expect(visual.icon).toBe(icon);
    expect(visual.label).toBe(MODEL_ICON_LABELS[icon!]);
    expect(visual.className).toBe(ICON_TILE_CLASSES[icon!]);
    expect(visual.initials.length).toBeGreaterThanOrEqual(1);
    expect(visual.initials.length).toBeLessThanOrEqual(2);
    expect(visual.className).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it('normaliza caixa e aliases de fornecedor', () => {
    expect(familyAvatarVisual('  Claude ').icon).toBe('claude');
    expect(familyAvatarVisual('Anthropic').icon).toBe('claude');
    expect(familyAvatarVisual('ChatGLM').icon).toBe('zai');
    expect(familyAvatarVisual('Moonshot').icon).toBe('kimi');
  });

  it('fallback: icon/label nulos, iniciais do nome e classes neutras', () => {
    const visual = familyAvatarVisual('default', 'Beam Free');
    expect(visual.icon).toBeNull();
    expect(visual.label).toBeNull();
    expect(visual.initials).toBe('BF');
    expect(visual.initials).toBe(fallbackInitials('Beam Free', 'default'));
    expect(visual.className).toBe(FALLBACK_CLASSES);
  });

  it('fallback sem nome nem família devolve "?" e continua sem marca', () => {
    const visual = familyAvatarVisual(null, null);
    expect(visual.icon).toBeNull();
    expect(visual.label).toBeNull();
    expect(visual.initials).toBe('?');
    expect(visual.className).toBe(FALLBACK_CLASSES);
  });
});
