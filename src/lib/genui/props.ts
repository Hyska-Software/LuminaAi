/**
 * Acessores de props usados pelo renderer e pelo lint.
 *
 * Os valores já passaram pela normalização, mas os acessores continuam
 * defensivos: um spec salvo em mensagem antiga ou um fixture manipulado nunca
 * pode derrubar a renderização.
 */
import type { GenUIValue } from './types';

export function propString(
  props: Record<string, GenUIValue> | undefined,
  key: string,
  fallback = '',
): string {
  const value = props?.[key];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;
}

export function propNumber(
  props: Record<string, GenUIValue> | undefined,
  key: string,
  fallback?: number,
): number | undefined {
  const value = props?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function propBool(
  props: Record<string, GenUIValue> | undefined,
  key: string,
  fallback = false,
): boolean {
  const value = props?.[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function propArray(
  props: Record<string, GenUIValue> | undefined,
  key: string,
): GenUIValue[] | undefined {
  const value = props?.[key];
  return Array.isArray(value) ? value : undefined;
}

/** Narrows a sanitized value to a string array (e.g. table columns). */
export function asStringArray(value: GenUIValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string | number => typeof entry === 'string' || typeof entry === 'number')
    .map((entry) => String(entry));
}

/** Reads `items` as a list of plain objects (timeline, steps, keyvalue, …). */
export function propObjectArray(
  props: Record<string, GenUIValue> | undefined,
  key: string,
): Record<string, GenUIValue>[] {
  const value = props?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Record<string, GenUIValue> =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry),
  );
}
