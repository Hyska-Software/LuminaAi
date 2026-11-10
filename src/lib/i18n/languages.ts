/**
 * Single registry of every language the renderer can display.
 *
 * Adding a language = add an entry here, add the matching JSON files under
 * `src/locales/<code>/`, and call `pnpm i18n:check`. Components never change.
 */

export const SUPPORTED_LANGUAGES = [
  {
    code: 'en',
    nativeName: 'English',
    englishName: 'English',
    intlLocale: 'en-US',
    promptName: 'English',
    direction: 'ltr',
  },
  {
    code: 'pt-BR',
    nativeName: 'Português (Brasil)',
    englishName: 'Portuguese (Brazil)',
    intlLocale: 'pt-BR',
    promptName: 'Brazilian Portuguese',
    direction: 'ltr',
  },
  {
    code: 'es',
    nativeName: 'Español',
    englishName: 'Spanish',
    intlLocale: 'es',
    promptName: 'Spanish',
    direction: 'ltr',
  },
] as const;

export type AppLocale = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export interface LanguageMeta {
  code: AppLocale;
  nativeName: string;
  englishName: string;
  intlLocale: string;
  promptName: string;
  direction: 'ltr' | 'rtl';
}

export const DEFAULT_LANGUAGE: AppLocale = 'en';

const LANGUAGE_CODES = new Set<string>(SUPPORTED_LANGUAGES.map((item) => item.code));

/** Narrows an untrusted value (disk, IPC, localStorage) to a supported locale. */
export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && LANGUAGE_CODES.has(value);
}

/** Supported locale or the English fallback. Never throws. */
export function normalizeLanguage(value: unknown): AppLocale {
  return isAppLocale(value) ? value : DEFAULT_LANGUAGE;
}

export function languageMeta(code: AppLocale): LanguageMeta {
  return SUPPORTED_LANGUAGES.find((item) => item.code === code) ?? SUPPORTED_LANGUAGES[0];
}
