// @vitest-environment jsdom
/**
 * `FamilyAvatar` — independent worst-case spec (edge layer).
 *
 * The lead-owned `FamilyAvatar.test.tsx` covers the happy path; this file is
 * deliberately adversarial: hostile families/names, extreme sizes, Unicode and
 * astral text, DOM injection attempts, token-only styling, accessibility and a
 * `ModelRow` integration smoke over the *real* catalog.
 *
 * Expected brands are hardcoded from the official collection
 * (`@lobehub/icons-static-svg@1.98.0`, MIT — https://icons.lobehub.com), not
 * imported from the production mapping.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { catalog } from '@/lib/catalog';
import type { ModelInfo } from '@/lib/types';
import type { ModelListEntry } from '@/lib/modelMenu';
import { ModelRow, modelOptionId } from './ModelRow';
import { FamilyAvatar, familyAvatarVisual } from './FamilyAvatar';

afterEach(cleanup);

/** Official LobeHub `<title>` per catalog family (`null` = no official mark). */
const OFFICIAL_TITLE_BY_FAMILY: Readonly<Record<string, string | null>> = {
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
  default: null,
};

/** Independent family → icon-key table (same provenance as above). */
const EXPECTED_ICON_BY_FAMILY: Readonly<Record<string, string | null>> = {
  claude: 'claude',
  deepseek: 'deepseek',
  gemini: 'gemini',
  glm: 'zai',
  gpt: 'openai',
  grok: 'grok',
  hy: 'hunyuan',
  kimi: 'kimi',
  longcat: 'longcat',
  mimo: 'xiaomimimo',
  minimax: 'minimax',
  mistral: 'mistral',
  muse: 'meta',
  nemotron: 'nvidia',
  qwen: 'qwen',
  step: 'stepfun',
  default: null,
};

const FALLBACK_CLASSES = ['bg-surface-hover', 'text-foreground-muted'];

/** Base layout classes of the tile (API contract, not brand styling). */
const BASE_TILE_CLASSES = [
  'inline-flex',
  'shrink-0',
  'select-none',
  'items-center',
  'justify-center',
  'rounded-full',
];

/** Families whose fallback name → initials are known from the catalog data. */
const FALLBACK_INITIALS_BY_NAME: Readonly<Record<string, string>> = {
  'Beam Free': 'BF',
  'Omen Alpha': 'OA',
  'Big Pickle': 'BP',
  'Flint 40B Free': 'F4',
};

function catalogFamilies(): string[] {
  const families = new Set<string>();
  for (const provider of catalog.providers) {
    for (const model of provider.models) families.add(model.family);
  }
  return [...families].sort();
}

function firstModelFor(family: string): ModelInfo {
  for (const provider of catalog.providers) {
    const model = provider.models.find((candidate) => candidate.family === family);
    if (model) return model;
  }
  throw new Error(`família sem modelo no catálogo: ${family}`);
}

function entryFor(family: string): ModelListEntry {
  for (const provider of catalog.providers) {
    const model = provider.models.find((candidate) => candidate.family === family);
    if (model) {
      return {
        providerId: provider.id,
        providerName: provider.name,
        providerShortName: provider.shortName,
        model,
        favorite: false,
      };
    }
  }
  throw new Error(`família sem entrada no catálogo: ${family}`);
}

function tileOf(container: HTMLElement): HTMLElement {
  const tile = container.firstElementChild;
  if (!(tile instanceof HTMLElement)) throw new Error('FamilyAvatar não renderizou um elemento');
  return tile;
}

function glyphTitleOf(container: HTMLElement): string | null {
  return container.querySelector('svg title')?.textContent ?? null;
}

function glyphFontSize(size: number): number {
  return Math.max(8, Math.round(size * 0.58));
}

function initialsFontSize(size: number, initials: string): number {
  return Math.max(8, Math.round(size * (initials.length > 1 ? 0.34 : 0.44)));
}

function canonBrand(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function expectNoLooseColors(html: string, context: string) {
  expect(html, context).not.toMatch(/#[0-9a-f]{3,8}/i);
  expect(html, context).not.toMatch(/\b(rgb|rgba|hsl|hsla)\s*\(/i);
  expect(html, context).not.toMatch(/style="[^"]*(?:color|background)/i);
}

function expectNoFocusable(tile: HTMLElement, context: string) {
  expect(
    tile.querySelector('a, button, input, select, textarea, [tabindex], [contenteditable]'),
    context,
  ).toBeNull();
  expect(tile.hasAttribute('tabindex'), context).toBe(false);
}

describe('FamilyAvatar — pior caso de família', () => {
  const hostileFamilies: readonly (string | null | undefined)[] = [
    null,
    undefined,
    '',
    ' ',
    '   ',
    '\t\n',
    'desconhecida',
    'outros',
    'constructor',
    'CONSTRUCTOR',
    '__proto__',
    'toString',
    '🔥',
    'ＧＰＴ',
    'Ｃｌａｕｄｅ',
    'Claude\u0301',
    'claude\u200b',
    'glm-5.1',
    'x'.repeat(5_000),
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
  ];

  it.each(hostileFamilies)(
    'família hostil %j cai no fallback do nome sem injetar DOM',
    (family) => {
      const { container } = render(<FamilyAvatar family={family} name="Big Pickle" />);
      const tile = tileOf(container);
      const html = container.innerHTML;

      expect(container.querySelector('svg'), String(family)).toBeNull();
      expect(tile.textContent).toBe('BP');
      for (const cls of FALLBACK_CLASSES) expect(tile.classList.contains(cls), cls).toBe(true);
      expect(html).not.toContain('<script');
      expect(html).not.toContain('onerror=');
      expectNoLooseColors(html, String(family));
    },
  );

  it('família hostil sem nome nunca fica vazia, nunca vira SVG e não vaza tags', () => {
    for (const family of [null, undefined, '', '   ', '🔥', 'constructor', '<script>x</script>']) {
      const { container, unmount } = render(<FamilyAvatar family={family} />);
      const tile = tileOf(container);
      const initials = tile.textContent ?? '';

      // No name: the fallback derives initials from the family itself.
      expect(initials.length, String(family)).toBeGreaterThan(0);
      expect(Array.from(initials).length, String(family)).toBeLessThanOrEqual(2);
      expect(initials, String(family)).not.toMatch(/[<>]/);
      expect(container.querySelector('svg'), String(family)).toBeNull();
      unmount();
    }
  });

  it('sem família e sem nome permanece neutro ("?")', () => {
    const { container } = render(<FamilyAvatar />);
    expect(tileOf(container).textContent).toBe('?');
  });

  it('família com caixa/aliases continua resolvendo a marca', () => {
    expect(glyphTitleOf(render(<FamilyAvatar family="  MUSE " name="Muse" />).container)).toBe(
      'Meta',
    );
    expect(glyphTitleOf(render(<FamilyAvatar family="ChatGLM" name="GLM" />).container)).toBe(
      'Z.ai',
    );
    expect(glyphTitleOf(render(<FamilyAvatar family="MOONSHOT" name="Kimi" />).container)).toBe(
      'Kimi',
    );
  });

  it('nome gigante não quebra o fallback e mantém no máximo 2 code points', () => {
    const hugeName = 'Super '.repeat(20_000);
    const { container } = render(<FamilyAvatar family="default" name={hugeName} />);
    const tile = tileOf(container);
    const initials = tile.textContent ?? '';

    expect(initials.length).toBeGreaterThan(0);
    expect(Array.from(initials).length).toBeLessThanOrEqual(2);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('FamilyAvatar — todas as famílias do catálogo', () => {
  it('cobre exatamente as 17 famílias reais com a spec hardcoded', () => {
    expect(catalogFamilies()).toEqual([...Object.keys(OFFICIAL_TITLE_BY_FAMILY)].sort());
  });

  it('cada família do catálogo renderiza o SVG oficial ou o fallback de iniciais', () => {
    for (const family of catalogFamilies()) {
      const model = firstModelFor(family);
      const expectedTitle = OFFICIAL_TITLE_BY_FAMILY[family];
      const { container, unmount } = render(<FamilyAvatar family={family} name={model.name} />);
      const tile = tileOf(container);

      if (expectedTitle) {
        const svg = container.querySelector('svg');
        expect(svg, family).not.toBeNull();
        expect(container.querySelectorAll('svg'), family).toHaveLength(1);
        expect(glyphTitleOf(container), family).toBe(expectedTitle);
        expect(svg!.getAttribute('viewBox'), family).toBe('0 0 24 24');
        expect(svg!.getAttribute('fill'), family).toBe('currentColor');
        expect(tile.getAttribute('aria-hidden'), family).toBe('true');
      } else {
        expect(container.querySelector('svg'), family).toBeNull();
        expect(tile.textContent, family).toBe(FALLBACK_INITIALS_BY_NAME[model.name]);
      }

      expectNoLooseColors(container.innerHTML, family);
      unmount();
    }
  });
});

describe('FamilyAvatar — tamanhos extremos', () => {
  it.each([1, 8, 64, 256])('marca em %dpx: tile quadrado e glifo em 1em proporcional', (size) => {
    const { container } = render(<FamilyAvatar family="claude" name="Claude Haiku 5.5" size={size} />);
    const tile = tileOf(container);
    const glyph = tile.firstElementChild;

    expect(tile.style.width).toBe(`${size}px`);
    expect(tile.style.height).toBe(`${size}px`);
    expect(glyph).toBeInstanceOf(HTMLElement);
    // Glyph is a font-sized wrapper: the SVG itself uses width/height="1em".
    expect(Number.parseFloat((glyph as HTMLElement).style.fontSize)).toBe(glyphFontSize(size));
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('1em');
    expect(svg?.getAttribute('height')).toBe('1em');
    // Minimum-legibility clamp: below ~14px the glyph intentionally exceeds the
    // tile (call sites use 18–32px); the style value itself stays deterministic.
    if (size >= 14) expect(glyphFontSize(size)).toBeLessThanOrEqual(size);
  });

  it.each([1, 8, 64, 256])(
    'fallback de 2 iniciais em %dpx usa a escala de 2 letras',
    (size) => {
      const { container } = render(<FamilyAvatar family="default" name="Beam Free" size={size} />);
      const tile = tileOf(container);

      expect(tile.style.width).toBe(`${size}px`);
      expect(tile.style.height).toBe(`${size}px`);
      expect(tile.textContent).toBe('BF');
      expect(Number.parseFloat(tile.style.fontSize)).toBe(initialsFontSize(size, 'BF'));
    },
  );

  it.each([1, 8, 64, 256])(
    'fallback de 1 inicial em %dpx usa a escala de 1 letra',
    (size) => {
      const { container } = render(<FamilyAvatar family="default" name="A" size={size} />);
      const tile = tileOf(container);

      expect(tile.textContent).toBe('A');
      expect(Number.parseFloat(tile.style.fontSize)).toBe(initialsFontSize(size, 'A'));
    },
  );

  it('tamanho padrão é 20px (contrato da API)', () => {
    const { container } = render(<FamilyAvatar family="gpt" name="GPT 6 Luna" />);
    expect(tileOf(container).style.width).toBe('20px');
    expect(tileOf(container).style.height).toBe('20px');
  });

  it('tamanho extremo não vaza cor/estilo cru para o DOM', () => {
    const { container } = render(<FamilyAvatar family="qwen" name="Qwen" size={256} />);
    expectNoLooseColors(container.innerHTML, 'size=256');
  });
});

describe('FamilyAvatar — classes, tokens e title', () => {
  it('toda marca usa apenas tokens de cor (um bg-* e um text-*)', () => {
    for (const family of catalogFamilies()) {
      const expectedTitle = OFFICIAL_TITLE_BY_FAMILY[family];
      if (!expectedTitle) continue;
      const { container, unmount } = render(
        <FamilyAvatar family={family} name={firstModelFor(family).name} />,
      );
      const tile = tileOf(container);
      const bg = [...tile.classList].filter((cls) => cls.startsWith('bg-'));
      const text = [...tile.classList].filter((cls) => cls.startsWith('text-'));

      expect(bg, family).toHaveLength(1);
      expect(text, family).toHaveLength(1);
      for (const cls of BASE_TILE_CLASSES) expect(tile.classList.contains(cls), cls).toBe(true);
      unmount();
    }
  });

  it('fallback usa exatamente os tokens neutros + classes base', () => {
    const { container } = render(<FamilyAvatar family="default" name="Big Pickle" />);
    const tile = tileOf(container);

    for (const cls of [...FALLBACK_CLASSES, ...BASE_TILE_CLASSES]) {
      expect(tile.classList.contains(cls), cls).toBe(true);
    }
  });

  it('mescla className do consumidor sem perder tokens da marca', () => {
    const { container } = render(
      <FamilyAvatar
        family="gemini"
        name="Gemini 4 Argon"
        className="ring-2 ring-accent/40 shadow-sm"
      />,
    );
    const tile = tileOf(container);

    for (const cls of ['ring-2', 'ring-accent/40', 'shadow-sm', 'bg-accent-soft', 'text-accent']) {
      expect(tile.classList.contains(cls), cls).toBe(true);
    }
  });

  it('repassa title em marca, fallback e title vazio; undefined não cria atributo', () => {
    const branded = render(<FamilyAvatar family="claude" name="Claude" title="Claude — Anthropic" />);
    expect(tileOf(branded.container).getAttribute('title')).toBe('Claude — Anthropic');

    const fallback = render(<FamilyAvatar family="default" name="Beam Free" title="Beam Free" />);
    expect(tileOf(fallback.container).getAttribute('title')).toBe('Beam Free');

    const empty = render(<FamilyAvatar family="gpt" name="GPT" title="" />);
    expect(tileOf(empty.container).getAttribute('title')).toBe('');

    const absent = render(<FamilyAvatar family="gpt" name="GPT" />);
    expect(tileOf(absent.container).hasAttribute('title')).toBe(false);
  });
});

describe('FamilyAvatar — Unicode, emoji e astral', () => {
  it('iniciais unicode são renderizadas como texto (sem entidades/tags)', () => {
    const accented = render(<FamilyAvatar family="default" name="Ómega α" />);
    expect(tileOf(accented.container).textContent).toBe('ÓΑ');

    const emoji = render(<FamilyAvatar family="default" name="🔥 Fire Model" />);
    expect(tileOf(emoji.container).textContent).toBe('FM');

    const onlyEmoji = render(<FamilyAvatar family="default" name="🔥🔥" />);
    expect(tileOf(onlyEmoji.container).textContent).toBe('?');
  });

  it('iniciais astrais: 2 code points, texto bem-formado e escala de 2 letras', () => {
    const { container } = render(<FamilyAvatar family="default" name="𠀀𠀁" size={64} />);
    const tile = tileOf(container);
    const initials = tile.textContent ?? '';

    expect(initials).toBe('𠀀𠀁');
    expect(Array.from(initials)).toHaveLength(2);
    // 4 unidades UTF-16 → o componente entra no ramo "mais de uma inicial"
    // (0.34); visualmente são 2 glifos, então a escala é a esperada.
    expect(Number.parseFloat(tile.style.fontSize)).toBe(Math.round(64 * 0.34));
  });

  it('nome com HTML é escapado como texto, nunca vira markup', () => {
    const { container } = render(
      <FamilyAvatar family="default" name="<script>alert(1)</script>" />,
    );
    const tile = tileOf(container);

    expect(tile.textContent).toBe('SA');
    expect(container.innerHTML).not.toContain('<script');
    expect(container.innerHTML).not.toContain('onerror=');
  });
});

describe('FamilyAvatar — acessibilidade', () => {
  it('marca: tile decorativo, sem elementos focáveis e sem tabindex', () => {
    const { container } = render(<FamilyAvatar family="nemotron" name="Nemotron 3 Ultra" />);
    const tile = tileOf(container);

    expect(tile.tagName).toBe('SPAN');
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.hasAttribute('role')).toBe(false);
    expectNoFocusable(tile, 'marca');
    expect(container.querySelector('svg')?.hasAttribute('tabindex')).toBe(false);
    expect(container.querySelector('svg')?.hasAttribute('focusable')).toBe(false);
  });

  it('fallback: tile decorativo, sem elementos focáveis e sem tabindex', () => {
    const { container } = render(<FamilyAvatar family="default" name="Omen Alpha" />);
    const tile = tileOf(container);

    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expectNoFocusable(tile, 'fallback');
  });

  it('nenhuma família do catálogo cria elementos focáveis', () => {
    for (const family of catalogFamilies()) {
      const { container, unmount } = render(
        <FamilyAvatar family={family} name={firstModelFor(family).name} />,
      );
      const tile = tileOf(container);
      expect(tile.getAttribute('aria-hidden'), family).toBe('true');
      expectNoFocusable(tile, family);
      unmount();
    }
  });
});

describe('familyAvatarVisual — contrato de pior caso', () => {
  it('resolve todas as famílias do catálogo para o ícone/rótulo/tokens corretos', () => {
    for (const family of catalogFamilies()) {
      const visual = familyAvatarVisual(family, firstModelFor(family).name);
      const expectedIcon = EXPECTED_ICON_BY_FAMILY[family];
      const expectedTitle = OFFICIAL_TITLE_BY_FAMILY[family];

      expect(visual.icon, family).toBe(expectedIcon);
      if (expectedIcon && expectedTitle) {
        expect(visual.label, family).not.toBeNull();
        expect(canonBrand(visual.label ?? ''), family).toBe(canonBrand(expectedTitle));
        expect(visual.className, family).toMatch(/^bg-\S+ text-\S+/);
      } else {
        expect(visual.label, family).toBeNull();
        for (const cls of FALLBACK_CLASSES) {
          expect(visual.className.split(' '), family).toContain(cls);
        }
      }

      expect(visual.initials.length, family).toBeGreaterThan(0);
      expect(Array.from(visual.initials).length, family).toBeLessThanOrEqual(2);
      expect(visual.className, family).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });

  it('famílias hostis nunca devolvem marca nem classes sujas', () => {
    for (const family of [
      null,
      undefined,
      '',
      '   ',
      'desconhecida',
      'constructor',
      '__proto__',
      '🔥',
      'ＧＰＴ',
      'x'.repeat(5_000),
      '<script>alert(1)</script>',
    ]) {
      const visual = familyAvatarVisual(family, 'Big Pickle');
      expect(visual.icon, String(family)).toBeNull();
      expect(visual.label, String(family)).toBeNull();
      expect(visual.initials, String(family)).toBe('BP');
      expect(visual.className, String(family)).toBe(FALLBACK_CLASSES.join(' '));
    }
  });
});

describe('integração — ModelRow com entries reais do catálogo', () => {
  it('cada família renderiza a linha com o SVG/título oficial correto', () => {
    for (const family of catalogFamilies()) {
      const entry = entryFor(family);
      const id = modelOptionId('edge-list', entry);
      const { container, unmount } = render(
        <ModelRow
          entry={entry}
          id={id}
          active={false}
          selected={false}
          onActivate={() => {}}
          onPick={() => {}}
        />,
      );

      const option = container.querySelector('[role="option"]');
      expect(option, family).not.toBeNull();
      expect(option!.id, family).toBe(id);
      expect(option!.textContent, family).toContain(entry.model.name);

      const expectedTitle = OFFICIAL_TITLE_BY_FAMILY[family];
      const avatar = option!.querySelector<HTMLElement>('span[aria-hidden="true"]');
      expect(avatar, family).not.toBeNull();

      if (expectedTitle) {
        expect(glyphTitleOf(option as HTMLElement), family).toBe(expectedTitle);
        expect(avatar!.style.width, family).toBe('24px');
      } else {
        expect(option!.querySelector('svg'), family).toBeNull();
        expect(avatar!.textContent, family).toBe(FALLBACK_INITIALS_BY_NAME[entry.model.name]);
        expect(avatar!.style.width, family).toBe('24px');
      }

      expectNoLooseColors(container.innerHTML, family);
      unmount();
    }
  });

  it('variante compact usa o tile de 20px e mantém o glifo da marca', () => {
    const entry = entryFor('claude');
    const { container } = render(
      <ModelRow
        entry={entry}
        id="compact-option"
        active
        selected
        variant="compact"
        onActivate={() => {}}
        onPick={() => {}}
      />,
    );

    const avatar = container.querySelector<HTMLElement>('span[aria-hidden="true"]');
    expect(avatar?.style.width).toBe('20px');
    expect(avatar?.style.height).toBe('20px');
    expect(glyphTitleOf(container)).toBe('Claude');
    expect(container.querySelector('[role="option"]')?.getAttribute('aria-selected')).toBe('true');
  });

  it('ModelRow não introduz hex solto em nenhuma variante', () => {
    const entry = entryFor('glm');
    for (const variant of ['compact', 'dialog'] as const) {
      const { container, unmount } = render(
        <ModelRow
          entry={entry}
          id={`row-${variant}`}
          active={false}
          selected={false}
          variant={variant}
          onActivate={() => {}}
          onPick={() => {}}
        />,
      );
      expectNoLooseColors(container.innerHTML, variant);
      unmount();
    }
  });
});
