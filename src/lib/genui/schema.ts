/**
 * Fachada pública do núcleo da UI generativa.
 *
 * `parseGenUI` é o único ponto que o renderer precisa para transformar o texto
 * do bloco ` ```ui ` em uma árvore segura: normaliza, valida contra o contrato e
 * roda o lint de design. Também vivem aqui os helpers de gráfico (` ```chart `)
 * e os acessores de props reexportados de `props.ts`.
 */
import { GENUI_CONTRACT, GENUI_LIMITS, GENUI_TYPES } from './contract';
import { lintGenUI } from './lint';
import { normalizeGenUI } from './normalize';
import type { GenUIDiagnostic, GenUIParseResult, GenUIValue } from './types';

export { GENUI_LIMITS, GENUI_TYPES };
export type {
  GenUIComponent,
  GenUIDiagnostic,
  GenUIParseResult,
  GenUISpec,
  GenUIValue,
} from './types';
export {
  asStringArray,
  propArray,
  propBool,
  propNumber,
  propObjectArray,
  propString,
} from './props';

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

function clampString(value: string, max: number = GENUI_CONTRACT.limits.stringChars): string {
  const cleaned = value.replace(/\u0000/g, '');
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripCodeFence(source: string): string {
  const fence = source.match(/^\s*```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```\s*$/);
  return (fence?.[1] ?? source).trim();
}

function parseJson(source: string): { value: unknown; error: string | null } {
  if (typeof source !== 'string') return { value: null, error: 'Bloco vazio.' };
  if (source.length > GENUI_CONTRACT.limits.sourceChars) {
    return { value: null, error: 'O bloco de gráfico é grande demais para ser renderizado.' };
  }
  const trimmed = stripCodeFence(source);
  if (!trimmed) return { value: null, error: 'O bloco de gráfico está vazio.' };
  try {
    return { value: JSON.parse(trimmed) as unknown, error: null };
  } catch (error) {
    return {
      value: null,
      error: `JSON inválido: ${error instanceof Error ? error.message : String(error)}`,
    };
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

/** Builds a chart spec from already-normalized genui chart props. */
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
/* Pipeline público                                                    */
/* ------------------------------------------------------------------ */

/**
 * Parseia, normaliza, valida e lint a UI generativa de um bloco ` ```ui `.
 * Nunca lança. `spec` é `null` quando existe qualquer erro (o bloco degrada
 * para código no renderer); avisos de design chegam em `warnings`.
 *
 * O try/catch é rede de segurança: o parser roda dentro da mensagem e uma
 * exceção inesperada não pode derrubar o chat inteiro (só há ErrorBoundary na
 * raiz do app). Erros de contrato são diagnósticos, não exceções.
 */
export function parseGenUI(source: string): GenUIParseResult {
  try {
    const { spec, diagnostics } = normalizeGenUI(source);
    const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    if (!spec || errors.length > 0) {
      return {
        spec: null,
        diagnostics,
        error: errors[0]?.message ?? 'Não foi possível renderizar a UI generativa.',
        warnings,
      };
    }
    const lint = lintGenUI(spec);
    return {
      spec,
      diagnostics: [...diagnostics, ...lint],
      error: null,
      warnings: [...warnings, ...lint],
    };
  } catch (unexpected) {
    const message = `Falha inesperada ao interpretar a UI generativa: ${
      unexpected instanceof Error ? unexpected.message : String(unexpected)
    }`;
    const diagnostic: GenUIDiagnostic = {
      code: 'ui.invalid-json',
      severity: 'error',
      path: '',
      message,
    };
    return { spec: null, diagnostics: [diagnostic], error: message, warnings: [] };
  }
}
