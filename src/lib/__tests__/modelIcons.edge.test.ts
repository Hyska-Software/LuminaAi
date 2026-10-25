import { describe, expect, it } from 'vitest';

import { catalog } from '@/lib/catalog';
import { MODEL_ICON_SVG } from '@/lib/modelIconAssets';
import {
  fallbackInitials,
  MODEL_ICON_KEYS,
  MODEL_ICON_LABELS,
  modelIconForFamily,
  modelIconLabel,
  normalizeModelFamily,
} from '@/lib/modelIcons';

/**
 * Independent edge-case spec for the model-brand data layer.
 *
 * This file deliberately does NOT import the expected mapping from
 * `src/lib/modelIcons.ts`: the table below was typed by hand from the official
 * sources and is the reference the implementation is checked against.
 *
 * Provenance of the expected data:
 * - `@lobehub/icons@6.9.0` → `modelMappings` table, read from
 *   https://raw.githubusercontent.com/lobehub/lobe-icons/master/src/features/modelConfig.ts
 *   and cross-checked against the published tarball extracted at
 *   `.research/lobehub-inspect/icons/package/es/features/modelConfig.mjs`
 *   (both are byte-for-byte equivalent for the relevant entries).
 * - `@lobehub/icons-static-svg@1.98.0` → `<title>` of each bundled SVG, read
 *   from `node_modules/@lobehub/icons-static-svg/icons/*.svg`.
 * - `data/catalog.json` → real families/model ids exposed by the app.
 *
 * The official table resolves *model ids* by keyword/regex; the app resolves
 * the catalog *family* enum. The mapping below is the family-level translation
 * of those rules (e.g. `^glm-5`/`^glm-4` → ZAI, old `^glm-` → ChatGLM; the
 * catalog only ships GLM-5.x, hence `glm → zai`).
 */

/** Official `<title>` of each LobeHub mark, exactly as shipped in the SVG. */
const OFFICIAL_TITLES = {
  claude: 'Claude',
  deepseek: 'DeepSeek',
  gemini: 'Gemini',
  zai: 'Z.ai',
  openai: 'OpenAI',
  grok: 'Grok',
  hunyuan: 'Hunyuan',
  kimi: 'Kimi',
  longcat: 'LongCat',
  xiaomimimo: 'XiaomiMiMo',
  minimax: 'Minimax',
  mistral: 'Mistral',
  meta: 'Meta',
  nvidia: 'Nvidia',
  qwen: 'Qwen',
  stepfun: 'StepFun',
} as const;

type ExpectedIconKey = keyof typeof OFFICIAL_TITLES;

/** Catalog family → LobeHub mark (hand-checked against the official table). */
const EXPECTED_FAMILY_ICONS: Readonly<Record<string, ExpectedIconKey | null>> = {
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

/** Family whose models intentionally fall back to initials (no official mark). */
const FALLBACK_FAMILY = 'default';

const OFFICIAL_KEYS = (Object.keys(OFFICIAL_TITLES) as ExpectedIconKey[]).sort();

function allModels() {
  return catalog.providers.flatMap((provider) => provider.models);
}

function catalogFamilies(): string[] {
  return [...new Set(allModels().map((model) => model.family))].sort();
}

function svgTitle(svg: string): string | null {
  const match = svg.match(/<title>([^<]*)<\/title>/);
  return match?.[1] ?? null;
}

/** Normalizes a brand name for loose comparisons (case/spacing/punctuation). */
function canonBrand(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Inputs that must never crash and must never leak an arbitrary value. */
const HOSTILE_INPUTS: readonly (string | null | undefined)[] = [
  null,
  undefined,
  '',
  ' ',
  '   ',
  '\t\n\r',
  '\u00a0',
  '\u200b',
  'default',
  'outros',
  'desconhecida',
  'constructor',
  'CONSTRUCTOR',
  'hasOwnProperty',
  'valueOf',
  'toLocaleString',
  'toString',
  '__proto__',
  'prototype',
  '<script>alert(1)</script>',
  '<svg onload="alert(1)">',
  '"><img src=x onerror=alert(1)>',
  'javascript:alert(1)',
  'gpt\u200b',
  'Ｃｌａｕｄｅ',
  'Claude\u0301',
  'GLM-5.1',
  'glm 5',
  'x'.repeat(200_000),
];

describe('auditoria do mapping oficial família → marca', () => {
  it('cobre exatamente as 17 famílias reais do catálogo (spec e dados não divergem)', () => {
    const families = catalogFamilies();
    expect(families).toEqual([...Object.keys(EXPECTED_FAMILY_ICONS)].sort());
    expect(families).toHaveLength(17);
    expect(families).toContain(FALLBACK_FAMILY);
  });

  it('mapeia cada família do catálogo para a marca correta da LobeHub', () => {
    for (const family of catalogFamilies()) {
      const context = `família "${family}"`;
      expect(Object.hasOwn(EXPECTED_FAMILY_ICONS, family), `família sem spec: ${family}`).toBe(true);
      expect(modelIconForFamily(family), context).toBe(EXPECTED_FAMILY_ICONS[family]);
    }
  });

  it('casos críticos: glm→Z.ai (NÃO ChatGLM), muse→Meta, hy→Hunyuan, nemotron→Nvidia, step→StepFun, mimo→XiaomiMiMo', () => {
    // GLM-5.x is explicitly mapped to ZAI by the official table (`^glm-5`,
    // `-glm-5`); ChatGLM only wins for the older `^glm-` / `-glm-` lines.
    expect(modelIconForFamily('glm')).toBe('zai');
    expect(modelIconForFamily('glm')).not.toBe('chatglm');
    expect(MODEL_ICON_KEYS.map(String)).not.toContain('chatglm');
    expect(svgTitle(MODEL_ICON_SVG.zai)).toBe('Z.ai');

    expect(modelIconForFamily('muse')).toBe('meta');
    expect(svgTitle(MODEL_ICON_SVG.meta)).toBe('Meta');

    expect(modelIconForFamily('hy')).toBe('hunyuan');
    expect(svgTitle(MODEL_ICON_SVG.hunyuan)).toBe('Hunyuan');

    expect(modelIconForFamily('nemotron')).toBe('nvidia');
    expect(svgTitle(MODEL_ICON_SVG.nvidia)).toBe('Nvidia');

    expect(modelIconForFamily('step')).toBe('stepfun');
    expect(svgTitle(MODEL_ICON_SVG.stepfun)).toBe('StepFun');

    expect(modelIconForFamily('mimo')).toBe('xiaomimimo');
    expect(svgTitle(MODEL_ICON_SVG.xiaomimimo)).toBe('XiaomiMiMo');
  });

  it('resolve o rótulo de cada família com marca e devolve null no fallback', () => {
    for (const family of catalogFamilies()) {
      const icon = EXPECTED_FAMILY_ICONS[family];
      if (icon) {
        expect(modelIconLabel(family), family).toBe(MODEL_ICON_LABELS[icon]);
      } else {
        expect(modelIconLabel(family), family).toBeNull();
      }
    }
  });
});

describe('cobertura de todos os modelos do catálogo', () => {
  it('todo modelo de todo provider resolve para a marca da sua família', () => {
    const models = allModels();
    expect(models.length).toBeGreaterThan(0);

    for (const provider of catalog.providers) {
      for (const model of provider.models) {
        const context = `${provider.id}/${model.id} (family=${model.family})`;
        expect(
          Object.hasOwn(EXPECTED_FAMILY_ICONS, model.family),
          `família fora da spec: ${context}`,
        ).toBe(true);

        const expected = EXPECTED_FAMILY_ICONS[model.family];
        expect(modelIconForFamily(model.family), context).toBe(expected);

        if (expected) {
          const title = OFFICIAL_TITLES[expected];
          expect(svgTitle(MODEL_ICON_SVG[expected]), context).toBe(title);
          expect(canonBrand(modelIconLabel(model.family) ?? ''), context).toBe(canonBrand(title));
        } else {
          expect(modelIconLabel(model.family), context).toBeNull();
          // The fallback tile must always have usable initials for these models.
          expect(fallbackInitials(model.name, model.family), context).not.toBe('');
        }
      }
    }
  });

  it('famílias com marca nunca caem no fallback e o fallback só existe onde não há marca', () => {
    const byFamily = new Map<string, ReturnType<typeof allModels>>();
    for (const model of allModels()) {
      const list = byFamily.get(model.family) ?? [];
      list.push(model);
      byFamily.set(model.family, list);
    }

    for (const [family, models] of byFamily) {
      const expected = EXPECTED_FAMILY_ICONS[family];
      for (const model of models) {
        expect(modelIconForFamily(model.family), `${family}/${model.id}`).toBe(expected);
      }
    }

    // Guard against a catalog refresh that introduces an unmapped family and
    // silently degrades the picker to initials.
    expect([...byFamily.keys()].filter((family) => !(family in EXPECTED_FAMILY_ICONS))).toEqual([]);
  });
});

describe('aliases de resiliência (fornecedor / linha de modelo)', () => {
  // The app maps aliases to the primary mark of the vendor. This is a product
  // decision and intentionally does not replicate every official keyword 1:1
  // (official table: `chatglm`→ChatGLM, `glm-v`→GLMV, `anthropic`→Anthropic,
  // `google`→Google). Canonical catalog families are unaffected.
  const ALIASES: ReadonlyArray<readonly [string, ExpectedIconKey]> = [
    ['anthropic', 'claude'],
    ['google', 'gemini'],
    ['zhipu', 'zai'],
    ['chatglm', 'zai'],
    ['glmv', 'zai'],
    ['glm-v', 'zai'],
    ['codex', 'openai'],
    ['openai', 'openai'],
    ['xai', 'grok'],
    ['moonshot', 'kimi'],
    ['hunyuan', 'hunyuan'],
    ['xiaomimimo', 'xiaomimimo'],
    ['xiaomi-mimo', 'xiaomimimo'],
    ['meta', 'meta'],
    ['metaai', 'meta'],
    ['nvidia', 'nvidia'],
    ['stepfun', 'stepfun'],
    ['zai', 'zai'],
  ];

  it.each(ALIASES)('%s resolve para a marca principal %s', (alias, expected) => {
    expect(modelIconForFamily(alias)).toBe(expected);
    expect(MODEL_ICON_KEYS).toContain(expected);
  });
});

describe('normalizeModelFamily', () => {
  it('normaliza caixa, espaços, tabs e underscores', () => {
    expect(normalizeModelFamily('  GPT  ')).toBe('gpt');
    expect(normalizeModelFamily('Xiaomi_MiMo')).toBe('xiaomi-mimo');
    expect(normalizeModelFamily('Xiaomi MiMo')).toBe('xiaomi-mimo');
    expect(normalizeModelFamily('\tGLM\n')).toBe('glm');
    expect(normalizeModelFamily('MiniMax M3')).toBe('minimax-m3');
    expect(normalizeModelFamily('MUSE')).toBe('muse');
  });

  it('trata null/undefined como string vazia', () => {
    expect(normalizeModelFamily(null)).toBe('');
    expect(normalizeModelFamily(undefined)).toBe('');
    expect(normalizeModelFamily('')).toBe('');
    expect(normalizeModelFamily('   ')).toBe('');
  });

  it('é idempotente para as famílias reais e aliases', () => {
    const samples = [...catalogFamilies(), 'anthropic', 'xiaomi_mimo', '  GPT  '];
    for (const sample of samples) {
      const once = normalizeModelFamily(sample);
      expect(normalizeModelFamily(once), sample).toBe(once);
    }
  });
});

describe('inputs hostis (nunca quebram, nunca inventam marca)', () => {
  it('devolve null para famílias vazias, desconhecidas, unicode e ids de modelo', () => {
    for (const input of HOSTILE_INPUTS) {
      expect(modelIconForFamily(input), String(input)).toBeNull();
    }
  });

  it('não confunde nomes herdados de Object.prototype com marcas', () => {
    // `FAMILY_TO_ICON[key]` must not read the prototype chain: an inherited
    // property (e.g. `constructor`) would leak a function instead of `null`.
    const inherited = [
      'constructor',
      'CONSTRUCTOR',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
      'toLocaleString',
      'toString',
      'valueOf',
      '__proto__',
      '__defineGetter__',
    ];
    for (const name of inherited) {
      expect(modelIconForFamily(name), name).toBeNull();
      expect(modelIconLabel(name), name).toBeNull();
    }
  });

  it('só devolve chaves do conjunto de ícones conhecidos', () => {
    for (const input of HOSTILE_INPUTS) {
      const icon = modelIconForFamily(input);
      if (icon !== null) {
        expect(MODEL_ICON_KEYS, String(input)).toContain(icon);
        expect(typeof icon, String(input)).toBe('string');
      }
      const label = modelIconLabel(input);
      expect(label === null || typeof label === 'string', String(input)).toBe(true);
    }
  });

  it('strings gigantes são rejeitadas sem estourar', () => {
    const huge = 'gpt'.repeat(100_000);
    expect(huge.length).toBe(300_000);
    expect(modelIconForFamily(huge)).toBeNull();
    expect(modelIconLabel(huge)).toBeNull();
    expect(fallbackInitials(huge)).not.toBe('');
  });
});

describe('fallbackInitials', () => {
  it('cobre todos os nomes do catálogo: nunca vazio, ≤2 code points, sem marcação', () => {
    for (const model of allModels()) {
      const initials = fallbackInitials(model.name, model.family);
      const context = `${model.id} (${model.name})`;
      expect(initials.length, context).toBeGreaterThan(0);
      expect(Array.from(initials).length, context).toBeLessThanOrEqual(2);
      expect(initials, context).toBe(initials.toUpperCase());
      expect(initials, context).not.toMatch(/[<>&"'`\\/]/);
    }
  });

  it('usa o nome do modelo, duas palavras → uma letra de cada', () => {
    expect(fallbackInitials('Beam Free', 'default')).toBe('BF');
    expect(fallbackInitials('Big Pickle', 'default')).toBe('BP');
    expect(fallbackInitials('Omen Alpha', 'default')).toBe('OA');
    expect(fallbackInitials('DeepSeek V4.1 Flash')).toBe('DV');
    expect(fallbackInitials('MiMo-V2.5')).toBe('MV');
  });

  it('cai para a família e depois para "?" sem nunca devolver vazio', () => {
    expect(fallbackInitials(null, 'default')).toBe('DE');
    expect(fallbackInitials('   ', 'deepseek')).toBe('DE');
    expect(fallbackInitials(undefined, undefined)).toBe('?');
    expect(fallbackInitials('', '')).toBe('?');
    expect(fallbackInitials('   ', null)).toBe('?');
    expect(fallbackInitials('🔥')).toBe('?');
    expect(fallbackInitials('!!! ???')).toBe('?');
  });

  it('lida com unicode, acentos, emoji e HTML sem vazar tags', () => {
    expect(fallbackInitials('ómega-α')).toBe('ÓΑ');
    expect(fallbackInitials('123 model')).toBe('1M');
    expect(fallbackInitials('🔥 fire model')).toBe('FM');
    // Astral letters are single code points: a single word yields its first
    // two letters (`𠀀𠀁`), which is still within the 2-code-point invariant.
    expect(fallbackInitials('𠀀𠀁')).toBe('𠀀𠀁');
    expect(Array.from(fallbackInitials('𠀀𠀁'))).toHaveLength(2);
    // No lone surrogates: the result is always well-formed Unicode.
    expect(fallbackInitials('𠀀𠀁')).toBe(Array.from(fallbackInitials('𠀀𠀁')).join(''));
    expect(fallbackInitials('<script>alert(1)</script>')).toBe('SA');
    // Markup is tokenized as plain text: whatever the letters, nothing from the
    // tags may survive in the rendered fallback.
    const markupInitials = fallbackInitials('<b>Bold</b> Name');
    expect(markupInitials.length).toBeGreaterThan(0);
    expect(Array.from(markupInitials).length).toBeLessThanOrEqual(2);
    expect(markupInitials).not.toMatch(/[<>]/);
    expect(fallbackInitials('<script>alert(1)</script>')).not.toMatch(/[<>]/);
  });

  it('respeita o invariante de 2 letras mesmo em unicode hostil', () => {
    const names = [
      '',
      ' ',
      '\t\n',
      '🔥',
      '???',
      '<script>alert(1)</script>',
      '<svg onload="alert(1)">',
      'a'.repeat(1_000),
      'ÓMEGA α',
      '𠀀𠀁',
      'ß',
      'ﬀ',
      'ﬃ',
      'ﬄ',
      'İ',
      'i̇',
    ];
    for (const name of names) {
      const initials = fallbackInitials(name);
      const context = JSON.stringify(name);
      expect(initials.length, context).toBeGreaterThan(0);
      expect(Array.from(initials).length, context).toBeLessThanOrEqual(2);
      expect(initials, context).not.toMatch(/[<>&"'`\\/]/);
    }
  });
});

describe('integridade dos assets LobeHub', () => {
  it('paridade exata entre chaves de ícone, rótulos e SVGs', () => {
    expect(OFFICIAL_KEYS).toHaveLength(16);
    expect([...MODEL_ICON_KEYS].sort()).toEqual(OFFICIAL_KEYS);
    expect(Object.keys(MODEL_ICON_LABELS).sort()).toEqual(OFFICIAL_KEYS);
    expect(Object.keys(MODEL_ICON_SVG).sort()).toEqual(OFFICIAL_KEYS);
    expect(new Set(MODEL_ICON_KEYS).size).toBe(OFFICIAL_KEYS.length);
  });

  it.each(OFFICIAL_KEYS)('%s é um SVG mono 24×24 com o <title> oficial', (key) => {
    const svg = MODEL_ICON_SVG[key];
    expect(typeof svg).toBe('string');
    expect(svg.length).toBeGreaterThan(0);
    expect(svg.trimStart().startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toContain(`<title>${OFFICIAL_TITLES[key]}</title>`);
    expect(svgTitle(svg)).toBe(OFFICIAL_TITLES[key]);
    expect(svg).toContain('<path');

    // Mono asset: every paint must come from `currentColor`; no brand hex,
    // rgb()/hsl() literal, inline fill or external reference.
    const fills = [...svg.matchAll(/\bfill="([^"]*)"/g)].map((match) => match[1]);
    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) expect(fill, key).toBe('currentColor');
    expect(svg, key).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(svg, key).not.toMatch(/\b(rgb|rgba|hsl|hsla)\s*\(/i);
    expect(svg, key).not.toMatch(/<script/i);
    expect(svg, key).not.toMatch(/\son\w+\s*=/i);
    expect(svg, key).not.toMatch(/\b(xlink:)?href\s*=/i);
    expect(svg, key).not.toMatch(/<image\b|<use\b/i);
  });

  it.each(OFFICIAL_KEYS)('%s parseia como XML SVG válido e expõe raiz/título', (key) => {
    const doc = new DOMParser().parseFromString(MODEL_ICON_SVG[key], 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const root = doc.documentElement;
    expect(root.tagName.toLowerCase()).toBe('svg');
    expect(root.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(root.getAttribute('fill')).toBe('currentColor');
    expect(root.querySelector('title')?.textContent).toBe(OFFICIAL_TITLES[key]);
    expect(root.querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('rótulos de exibição são coerentes com os títulos oficiais (caixa/espaços)', () => {
    for (const key of OFFICIAL_KEYS) {
      expect(canonBrand(MODEL_ICON_LABELS[key]), key).toBe(canonBrand(OFFICIAL_TITLES[key]));
    }
  });

  it('cada família mapeada aponta para um SVG com o título oficial correspondente', () => {
    for (const [family, icon] of Object.entries(EXPECTED_FAMILY_ICONS)) {
      if (!icon) continue;
      expect(svgTitle(MODEL_ICON_SVG[icon]), family).toBe(OFFICIAL_TITLES[icon]);
    }
  });
});
