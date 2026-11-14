import { describe, expect, it } from 'vitest';
import { catalog } from '@/lib/catalog';
import { PROVIDER_ICON_SVG } from '@/lib/providerIconAssets';
import {
  normalizeProviderId,
  PROVIDER_ICON_KEYS,
  PROVIDER_ICON_LABELS,
  providerIconFor,
  providerIconLabel,
} from '@/lib/providerIcons';

/**
 * The expected mapping from every bundled catalog provider to the LobeHub mark.
 * This is the spec: OpenCode Go/Zen share the OpenCode mark; the direct API
 * providers use their vendor mark.
 */
const EXPECTED_PROVIDER_ICONS: Readonly<Record<string, string>> = {
  'opencode-go': 'opencode',
  'opencode-zen': 'opencode',
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'gemini',
};

/** Vendor aliases accepted by the resolver. */
const EXPECTED_ALIASES: Readonly<Record<string, string>> = {
  opencode: 'opencode',
  chatgpt: 'openai',
  claude: 'anthropic',
  google: 'gemini',
};

/** Official `<title>` shipped inside each mono SVG. */
const EXPECTED_SVG_TITLES: Readonly<Record<string, string>> = {
  opencode: 'opencode',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
};

describe('providerIconFor', () => {
  it('mapeia todo provedor do catálogo para a marca correta da LobeHub', () => {
    expect(catalog.providers.length).toBeGreaterThan(0);
    for (const provider of catalog.providers) {
      expect(providerIconFor(provider.id), provider.id).toBe(EXPECTED_PROVIDER_ICONS[provider.id]);
    }
  });

  it('aceita os aliases de fornecedor', () => {
    for (const [alias, icon] of Object.entries(EXPECTED_ALIASES)) {
      expect(providerIconFor(alias), alias).toBe(icon);
    }
  });

  it('normaliza o id antes de resolver (trim, caixa e separadores)', () => {
    expect(providerIconFor('  OpenCode-Go ')).toBe('opencode');
    expect(providerIconFor('opencode_zen')).toBe('opencode');
    expect(providerIconFor('OpenAI')).toBe('openai');
    // Internal whitespace becomes `-`, so a two-word vendor name is not a hit.
    expect(normalizeProviderId('Open AI')).toBe('open-ai');
    expect(providerIconFor('Open AI')).toBeNull();
    expect(normalizeProviderId(' Gemini ')).toBe('gemini');
  });

  it('devolve null para ids desconhecidos, vazios ou de protótipo', () => {
    for (const value of [
      undefined,
      null,
      '',
      '   ',
      'vercel',
      'openrouter',
      'constructor',
      'toString',
      '__proto__',
      'hasOwnProperty',
    ]) {
      expect(providerIconFor(value), String(value)).toBeNull();
    }
  });
});

describe('providerIconLabel', () => {
  it('rotula as marcas empacotadas com o nome comercial', () => {
    expect(providerIconLabel('opencode-go')).toBe('OpenCode');
    expect(providerIconLabel('openai')).toBe('OpenAI');
    expect(providerIconLabel('anthropic')).toBe('Anthropic');
    expect(providerIconLabel('gemini')).toBe('Gemini');
  });

  it('devolve null quando não há marca', () => {
    expect(providerIconLabel('openrouter')).toBeNull();
    expect(providerIconLabel(null)).toBeNull();
  });
});

describe('PROVIDER_ICON_SVG', () => {
  it('tem exatamente as mesmas chaves do rótulo', () => {
    expect(Object.keys(PROVIDER_ICON_SVG).sort()).toEqual([...PROVIDER_ICON_KEYS].sort());
    expect(PROVIDER_ICON_KEYS.sort()).toEqual(Object.keys(PROVIDER_ICON_LABELS).sort());
  });

  it('empacota SVGs mono 24×24 com título oficial', () => {
    for (const key of PROVIDER_ICON_KEYS) {
      const svg = PROVIDER_ICON_SVG[key];
      expect(svg, key).toContain('viewBox="0 0 24 24"');
      expect(svg, key).toContain('fill="currentColor"');
      expect(svg, key).not.toMatch(/fill="#[0-9a-f]{3,8}"/i);
      expect(svg, key).toContain(`<title>${EXPECTED_SVG_TITLES[key]}</title>`);
      expect(svg, key).toMatch(/<path\b/);
    }
  });
});
