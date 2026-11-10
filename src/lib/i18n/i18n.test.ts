import { afterEach, describe, expect, it } from 'vitest';

import {
  NAMESPACES,
  getLanguage,
  i18n,
  initI18n,
  setLanguage,
} from './index';
import { compareText, formatDate, formatNumber } from './format';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from './languages';
import { resources } from './resources';

function flatten(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      for (const [key, text] of flatten(entry, `${prefix}[${index}]`)) out.set(key, text);
    });
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const next = prefix ? `${prefix}.${key}` : key;
      for (const [child, text] of flatten(entry, next)) out.set(child, text);
    }
    return out;
  }
  out.set(prefix, String(value));
  return out;
}

const PLURAL = /(_|\.)(zero|one|two|few|many|other)$/;
const baseKey = (key: string) => key.replace(PLURAL, '');

function placeholders(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1]).sort();
}

afterEach(async () => {
  await setLanguage('pt-BR', { persist: false });
});

describe('i18n catalogs', () => {
  it('registers every supported language and namespace', async () => {
    await initI18n();
    expect(DEFAULT_LANGUAGE).toBe('en');
    expect(SUPPORTED_LANGUAGES.map((entry) => entry.code)).toEqual(['en', 'pt-BR', 'es']);
    for (const language of SUPPORTED_LANGUAGES) {
      expect(Object.keys(resources[language.code]).sort()).toEqual([...NAMESPACES].sort());
    }
  });

  it('keeps key and placeholder parity with English', () => {
    const english = resources.en;
    const englishByNamespace = Object.fromEntries(
      NAMESPACES.map((namespace) => [namespace, flatten(english[namespace])]),
    );
    for (const language of SUPPORTED_LANGUAGES.filter((entry) => entry.code !== 'en')) {
      for (const namespace of NAMESPACES) {
        const catalog = flatten(resources[language.code][namespace]);
        const expected = englishByNamespace[namespace];
        const expectedBases = new Set([...expected.keys()].map(baseKey));
        const bases = new Set([...catalog.keys()].map(baseKey));
        expect([...bases].sort()).toEqual([...expectedBases].sort());
        for (const [key, value] of expected) {
          const translated = catalog.get(key);
          expect(translated, `${language.code}/${namespace}:${key}`).toBeTruthy();
          expect(
            placeholders(translated ?? '', /\{\{(\w+)\}\}/g),
            `${language.code}/${namespace}:${key}`,
          ).toEqual(placeholders(value, /\{\{(\w+)\}\}/g));
        }
      }
    }
  });
});

describe('i18n language state', () => {
  it('switches language, document lang/dir and formatters', async () => {
    await initI18n();
    await setLanguage('en', { persist: false });
    expect(getLanguage()).toBe('en');
    expect(i18n.t('common:conversation.defaultTitle')).toBe('New chat');
    expect(document.documentElement.lang).toBe('en');
    expect(formatNumber(1234.5)).toContain('1,234.5');
    expect(compareText('ÁrvoRe', 'arvore')).toBe(0);
    expect(formatDate(0, { timeZone: 'UTC', year: 'numeric' })).toContain('1970');

    await setLanguage('pt-BR', { persist: false });
    expect(getLanguage()).toBe('pt-BR');
    expect(i18n.t('common:conversation.defaultTitle')).toBe('Nova conversa');
    expect(document.documentElement.lang).toBe('pt-BR');
  });

  it('normalizes unknown languages to English', async () => {
    await setLanguage('fr', { persist: false });
    expect(getLanguage()).toBe('en');
    await setLanguage('pt-BR', { persist: false });
  });
});
