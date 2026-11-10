import 'i18next';

/**
 * Runtime catalogs are strongly typed by `resources.ts`, but the app needs
 * cross-namespace calls (`t('common:actions.cancel')`) and namespaced
 * `useTranslation('agents')` hooks that occasionally reach into `common`.
 * i18next's literal-key types reject those combinations, so we keep the
 * compile-time surface permissive and enforce catalog/key correctness with
 * `pnpm i18n:check` and the catalog parity test.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: Record<string, Record<string, string>>;
    returnNull: false;
  }
}
