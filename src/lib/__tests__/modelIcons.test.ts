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
 * The expected mapping from the catalog family to the LobeHub mark. This is
 * the spec written against LobeHub's own `modelMappings` table
 * (`@lobehub/icons/es/features/modelConfig.mjs`, v6.9.0) — see
 * `docs/MODEL_ICONS.md`.
 */
const EXPECTED_FAMILY_ICONS: Readonly<Record<string, string>> = {
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
};

/** Families intentionally without a brand mark (fallback initials). */
const FALLBACK_FAMILIES = new Set(['default']);

function catalogFamilies(): string[] {
  const families = new Set<string>();
  for (const provider of catalog.providers) {
    for (const model of provider.models) families.add(model.family);
  }
  return [...families].sort();
}

describe('modelIconForFamily', () => {
  it('mapeia toda família do catálogo para a marca correta da LobeHub', () => {
    const families = catalogFamilies();
    expect(families.length).toBeGreaterThan(0);

    for (const family of families) {
      if (FALLBACK_FAMILIES.has(family)) {
        expect(modelIconForFamily(family), family).toBeNull();
        continue;
      }
      expect(modelIconForFamily(family), family).toBe(EXPECTED_FAMILY_ICONS[family]);
    }
  });

  it('cobre todas as famílias mapeadas do catálogo (sem sobras nos dois lados)', () => {
    const mapped = catalogFamilies().filter((family) => !FALLBACK_FAMILIES.has(family));
    expect(mapped.sort()).toEqual(Object.keys(EXPECTED_FAMILY_ICONS).sort());
  });

  it('resolve aliases de fornecedor e linha de modelo', () => {
    expect(modelIconForFamily('anthropic')).toBe('claude');
    expect(modelIconForFamily('openai')).toBe('openai');
    expect(modelIconForFamily('zhipu')).toBe('zai');
    expect(modelIconForFamily('chatglm')).toBe('zai');
    expect(modelIconForFamily('moonshot')).toBe('kimi');
    expect(modelIconForFamily('hunyuan')).toBe('hunyuan');
    expect(modelIconForFamily('nvidia')).toBe('nvidia');
    expect(modelIconForFamily('stepfun')).toBe('stepfun');
    expect(modelIconForFamily('meta')).toBe('meta');
    expect(modelIconForFamily('xai')).toBe('grok');
    expect(modelIconForFamily('xiaomi-mimo')).toBe('xiaomimimo');
  });

  it('normaliza caixa, espaços e separadores', () => {
    expect(normalizeModelFamily('  GPT  ')).toBe('gpt');
    expect(normalizeModelFamily('Xiaomi_MiMo')).toBe('xiaomi-mimo');
    expect(modelIconForFamily('  GLM ')).toBe('zai');
    expect(modelIconForFamily('Muse')).toBe('meta');
  });

  it('retorna null para famílias sem marca oficial na coleção', () => {
    expect(modelIconForFamily('default')).toBeNull();
    expect(modelIconForFamily('outros')).toBeNull();
    expect(modelIconForFamily('desconhecida')).toBeNull();
    expect(modelIconForFamily('')).toBeNull();
    expect(modelIconForFamily(null)).toBeNull();
    expect(modelIconForFamily(undefined)).toBeNull();
  });

  it('expõe rótulo apenas quando há marca', () => {
    expect(modelIconLabel('gpt')).toBe('OpenAI');
    expect(modelIconLabel('muse')).toBe('Meta');
    expect(modelIconLabel('default')).toBeNull();
  });

  it('não vaza chaves herdadas de Object.prototype (guard de own-property)', () => {
    // Regressão: um lookup direto no Record devolvia `Object`/funções para
    // `constructor`, `toString`, etc., quebrando o contrato `| null`.
    expect(modelIconForFamily('constructor')).toBeNull();
    expect(modelIconForFamily('CONSTRUCTOR')).toBeNull();
    expect(modelIconForFamily('toString')).toBeNull();
    expect(modelIconForFamily('hasOwnProperty')).toBeNull();
    expect(modelIconForFamily('__proto__')).toBeNull();
    expect(modelIconLabel('constructor')).toBeNull();
  });
});

describe('MODEL_ICON_SVG (assets LobeHub)', () => {
  it('tem exatamente um SVG para cada chave de ícone', () => {
    expect(Object.keys(MODEL_ICON_SVG).sort()).toEqual([...MODEL_ICON_KEYS].sort());
    expect([...MODEL_ICON_KEYS].sort()).toEqual(Object.keys(MODEL_ICON_LABELS).sort());
  });

  it.each(MODEL_ICON_KEYS)('%s é um SVG 24×24 com currentColor', (key) => {
    const svg = MODEL_ICON_SVG[key];
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 24 24"');
    // Mono asset: painted by the parent's text color, never a hardcoded brand
    // fill (this is what keeps it readable in light and dark themes).
    expect(svg).toContain('fill="currentColor"');
    expect(svg).not.toMatch(/fill="#[0-9a-f]{3,8}"/i);
    expect(svg).toContain('<title>');
    expect(svg.replace(/<[^>]+>/g, '').trim().length).toBeGreaterThan(0);
  });
});

describe('fallbackInitials', () => {
  it('usa o nome do modelo (não a família) para famílias sem marca', () => {
    expect(fallbackInitials('Beam Free', 'default')).toBe('BF');
    expect(fallbackInitials('Big Pickle', 'default')).toBe('BP');
    expect(fallbackInitials('Omen Alpha', 'default')).toBe('OA');
  });

  it('cai para a família quando não há nome e nunca devolve vazio', () => {
    expect(fallbackInitials(null, 'default')).toBe('DE');
    expect(fallbackInitials('', null)).toBe('?');
    expect(fallbackInitials(null, null)).toBe('?');
  });

  it('remove acentos/símbolos, limita a 2 letras e maiúsculiza', () => {
    expect(fallbackInitials('ómega-α')).toBe('ÓΑ');
    expect(fallbackInitials('123 model')).toBe('1M');
    expect(fallbackInitials('🔥 fire model')).toBe('FM');
    expect(fallbackInitials('Flint')).toBe('FL');
  });

  it('nunca passa de 2 caracteres mesmo quando o uppercase expande', () => {
    // Regressão: `ﬃ`.toUpperCase() === 'FFI' — fatiar antes do uppercase dava 3.
    expect(fallbackInitials('ﬃ')).toBe('FF');
    expect(Array.from(fallbackInitials('ﬃ'))).toHaveLength(2);
    expect(fallbackInitials('ß')).toBe('SS');
  });
});
