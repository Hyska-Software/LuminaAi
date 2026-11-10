import { useTranslation } from 'react-i18next';

import { intlLocale } from './format';

/**
 * Subscribes a component to the active language and returns its `Intl` locale.
 * Use this in components that only format dates/numbers and have no other
 * translated copy (otherwise `useTranslation` already subscribes).
 */
export function useIntlLocale(): string {
  useTranslation();
  return intlLocale();
}
