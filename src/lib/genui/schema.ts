/**
 * Schema for the model-emitted generative UI (` ```ui ` blocks).
 *
 * The renderer is **declarative only**: JSON is parsed, whitelisted and
 * sanitized — never `eval`ed and never turned into arbitrary React. Unknown
 * component types are rejected so `GenUIBlock` can fall back to a code block
 * with a discreet warning (docs/ARCHITECTURE.md §9).
 */

export const GENUI_TYPES = [
  'card',
  'stack',
  'grid',
  'tabs',
  'table',
  'chart',
  'stat',
  'progress',
  'timeline',
  'steps',
  'callout',
  'quote',
  'code',
  'list',
  'image',
  'badge',
  'divider',
  'link',
  'keyvalue',
] as const;

export type GenUIComponentType = (typeof GENUI_TYPES)[number];

export type GenUIValue = string | number | boolean | null | GenUIValue[] | { [key: string]: GenUIValue };

export interface GenUIComponent {
  type: GenUIComponentType;
  props?: Record<string, GenUIValue>;
  children?: GenUIComponent[];
}

export interface GenUISpec {
  components: GenUIComponent[];
}

export interface GenUIParseResult {
  spec: GenUISpec | null;
  error: string | null;
}

export const GENUI_LIMITS = {
  /** Maximum nesting depth (root = 1). */
  depth: 8,
  /** Maximum number of components in a single block. */
  nodes: 300,
  /** Maximum length of a single string prop. */
  string: 4000,
  /** Maximum number of entries in a prop array. */
  array: 200,
  /** Maximum number of props per component. */
  props: 24,
  /** Maximum raw source length accepted. */
  source: 200_000,
} as const;

/* ------------------------------------------------------------------ */
/* Chart helpers                                                       */
/* ------------------------------------------------------------------ */

export const CHART_TYPES = ['bar', 'line', 'pie'] as const;
export type ChartKind = (typeof CHART_TYPES)[number];

export interface ChartDatum {
  label: string;
  value: number;
}

export interface ChartSpec {
  type: ChartKind;
  data: ChartDatum[];
  title?: string;
  suffix?: string;
}

/** Hard cap for plotted points. */
const MAX_CHART_POINTS = 60;

function clampString(value: string, max: number = GENUI_LIMITS.string): string {
  const cleaned = value.replace(/\u0000/g, '');
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isForbiddenKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function sanitizeValue(value: unknown, depth = 0): GenUIValue | undefined {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return clampString(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (depth >= 4) return undefined;
  if (Array.isArray(value)) {
    const out: GenUIValue[] = [];
    for (const entry of value.slice(0, GENUI_LIMITS.array)) {
      const sanitized = sanitizeValue(entry, depth + 1);
      if (sanitized !== undefined) out.push(sanitized);
    }
    return out;
  }
  if (isPlainObject(value)) {
    const out: Record<string, GenUIValue> = {};
    let count = 0;
    for (const [key, entry] of Object.entries(value)) {
      if (count >= GENUI_LIMITS.props) break;
      if (isForbiddenKey(key) || key.length > 64 || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key)) continue;
      const sanitized = sanitizeValue(entry, depth + 1);
      if (sanitized === undefined) continue;
      out[key] = sanitized;
      count += 1;
    }
    return out;
  }
  return undefined;
}

function sanitizeProps(raw: Record<string, unknown>): Record<string, GenUIValue> {
  const out: Record<string, GenUIValue> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (count >= GENUI_LIMITS.props) break;
    if (isForbiddenKey(key) || key.length > 64 || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key)) continue;
    const sanitized = sanitizeValue(value);
    if (sanitized === undefined) continue;
    out[key] = sanitized;
    count += 1;
  }
  return out;
}

interface ParseCounter {
  nodes: number;
}

function parseComponent(raw: unknown, depth: number, counter: ParseCounter): GenUIComponent {
  if (depth > GENUI_LIMITS.depth) {
    throw new Error(`UI generativa excede a profundidade máxima de ${GENUI_LIMITS.depth} níveis.`);
  }
  counter.nodes += 1;
  if (counter.nodes > GENUI_LIMITS.nodes) {
    throw new Error(`UI generativa excede o limite de ${GENUI_LIMITS.nodes} componentes.`);
  }
  if (!isPlainObject(raw)) throw new Error('Componente inválido: esperado um objeto.');
  const type = raw.type;
  if (typeof type !== 'string' || !(GENUI_TYPES as readonly string[]).includes(type)) {
    throw new Error(`Componente desconhecido: "${String(type)}".`);
  }
  const component: GenUIComponent = { type: type as GenUIComponentType };
  if (raw.props !== undefined) {
    if (!isPlainObject(raw.props)) throw new Error(`"props" de "${type}" deve ser um objeto.`);
    component.props = sanitizeProps(raw.props);
  }
  if (raw.children !== undefined) {
    if (!Array.isArray(raw.children)) throw new Error(`"children" de "${type}" deve ser uma lista.`);
    component.children = raw.children.map((child) => parseComponent(child, depth + 1, counter));
  }
  return component;
}

function stripCodeFence(source: string): string {
  const fence = source.match(/^\s*```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```\s*$/);
  return (fence?.[1] ?? source).trim();
}

function parseJson(source: string): { value: unknown; error: string | null } {
  if (typeof source !== 'string') return { value: null, error: 'Bloco vazio.' };
  if (source.length > GENUI_LIMITS.source) {
    return { value: null, error: 'O bloco de UI generativa é grande demais para ser renderizado.' };
  }
  const trimmed = stripCodeFence(source);
  if (!trimmed) return { value: null, error: 'O bloco de UI generativa está vazio.' };
  try {
    return { value: JSON.parse(trimmed) as unknown, error: null };
  } catch (error) {
    return {
      value: null,
      error: `JSON inválido: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Parses and validates a generative UI source string. Never throws.
 * Accepts either `{ "components": [...] }` or a bare component array.
 */
export function parseGenUI(source: string): GenUIParseResult {
  const { value, error } = parseJson(source);
  if (error) return { spec: null, error };

  const root = isPlainObject(value) && 'components' in value ? value.components : value;
  if (!Array.isArray(root)) {
    return { spec: null, error: 'Estrutura inválida: esperado "components" como lista de componentes.' };
  }
  if (root.length === 0) return { spec: null, error: 'Nenhum componente para renderizar.' };

  try {
    const counter: ParseCounter = { nodes: 0 };
    const components = root.map((entry) => parseComponent(entry, 1, counter));
    return { spec: { components }, error: null };
  } catch (parseError) {
    return { spec: null, error: parseError instanceof Error ? parseError.message : String(parseError) };
  }
}

function buildChart(raw: unknown): ChartSpec {
  if (!isPlainObject(raw)) throw new Error('Dados do gráfico inválidos: esperado um objeto.');
  const typeRaw = typeof raw.type === 'string' ? raw.type : typeof raw.chartType === 'string' ? raw.chartType : 'bar';
  if (!(CHART_TYPES as readonly string[]).includes(typeRaw)) {
    throw new Error(`Tipo de gráfico não suportado: "${typeRaw}".`);
  }
  const dataRaw = Array.isArray(raw.data)
    ? raw.data
    : Array.isArray(raw.labels) && Array.isArray(raw.values)
      ? (raw.labels as unknown[]).map((label, index) => ({
          label,
          value: (raw.values as unknown[])[index],
        }))
      : null;
  if (!dataRaw) throw new Error('Dados do gráfico ausentes: informe "data" com [{ label, value }].');

  const data: ChartDatum[] = [];
  for (const entry of dataRaw.slice(0, MAX_CHART_POINTS)) {
    let label = '';
    let value: unknown;
    if (isPlainObject(entry)) {
      label = typeof entry.label === 'string' ? entry.label : String(entry.name ?? '');
      value = entry.value;
    } else if (Array.isArray(entry)) {
      label = String(entry[0] ?? '');
      value = entry[1];
    }
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) continue;
    data.push({ label: clampString(label || '—', 80), value: numeric });
  }
  if (!data.length) throw new Error('Nenhum valor numérico válido no gráfico.');

  const title = typeof raw.title === 'string' ? clampString(raw.title, 160) : undefined;
  const suffix = typeof raw.suffix === 'string' ? clampString(raw.suffix, 24) : undefined;
  return { type: typeRaw as ChartKind, data, title, suffix };
}

/** Parses the contents of a ` ```chart ` fenced block. Never throws. */
export function parseChartSpec(source: string): { chart: ChartSpec | null; error: string | null } {
  const { value, error } = parseJson(source);
  if (error) return { chart: null, error };
  try {
    return { chart: buildChart(value), error: null };
  } catch (chartError) {
    return { chart: null, error: chartError instanceof Error ? chartError.message : String(chartError) };
  }
}

/** Builds a chart spec from already-sanitized genui chart props. */
export function chartFromProps(
  props: Record<string, GenUIValue> | undefined,
): { chart: ChartSpec | null; error: string | null } {
  if (!props) return { chart: null, error: 'Gráfico sem dados.' };
  try {
    return { chart: buildChart(props), error: null };
  } catch (chartError) {
    return { chart: null, error: chartError instanceof Error ? chartError.message : String(chartError) };
  }
}

/* ------------------------------------------------------------------ */
/* Prop accessors used by the renderer                                 */
/* ------------------------------------------------------------------ */

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
