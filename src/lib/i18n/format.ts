/**
 * Locale-aware formatting helpers. Every user-visible date/number must go
 * through this module so switching the interface language updates the output.
 */
import { getLanguage } from './index';
import { languageMeta } from './languages';

export type DateInput = number | Date | string;

const collatorCache = new Map<string, Intl.Collator>();
const numberFormatCache = new Map<string, Intl.NumberFormat>();
const dateFormatCache = new Map<string, Intl.DateTimeFormat>();

function cacheKey(locale: string, options?: object): string {
  return `${locale}\u0000${options ? JSON.stringify(options) : ''}`;
}

export function intlLocale(): string {
  return languageMeta(getLanguage()).intlLocale;
}

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  const locale = intlLocale();
  const key = cacheKey(locale, options);
  let formatter = numberFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormatCache.set(key, formatter);
  }
  return formatter.format(value);
}

export function formatPercent(value: number, fractionDigits = 0): string {
  return formatNumber(value, {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatDate(value: DateInput, options?: Intl.DateTimeFormatOptions): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return '—';
  const locale = intlLocale();
  const key = cacheKey(locale, options);
  let formatter = dateFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateFormatCache.set(key, formatter);
  }
  return formatter.format(date);
}

export function formatDateTime(value: DateInput): string {
  return formatDate(value, { dateStyle: 'short', timeStyle: 'short' });
}

export function formatDateMedium(value: DateInput): string {
  return formatDate(value, { dateStyle: 'medium' });
}

export function formatTime(value: DateInput, options?: Intl.DateTimeFormatOptions): string {
  return formatDate(value, options ?? { hour: '2-digit', minute: '2-digit' });
}

export function formatCurrency(value: number, currency = 'USD'): string {
  return formatNumber(value, {
    style: 'currency',
    currency,
    maximumFractionDigits: value < 1 ? 4 : 2,
  });
}

export function createTextCollator(options: Intl.CollatorOptions = {}): Intl.Collator {
  const locale = intlLocale();
  const key = cacheKey(locale, options);
  let collator = collatorCache.get(key);
  if (!collator) {
    collator = new Intl.Collator(locale, options);
    collatorCache.set(key, collator);
  }
  return collator;
}

export function compareText(left: string, right: string): number {
  return createTextCollator({ sensitivity: 'base', numeric: true }).compare(left, right);
}

export function localeLowerCase(value: string): string {
  return value.toLocaleLowerCase(intlLocale());
}

export function localeUpperCase(value: string): string {
  return value.toLocaleUpperCase(intlLocale());
}

export function formatList(items: readonly string[], type: Intl.ListFormatType = 'conjunction'): string {
  if (items.length === 0) return '';
  return new Intl.ListFormat(intlLocale(), { style: 'long', type }).format(items);
}
