/**
 * Normalizador + validador estrutural da UI generativa.
 *
 * Ordem do pipeline: parse do JSON → normalização (coerções seguras, formas
 * legadas, truncamentos) → validação contra `data/genui-contract.json` →
 * diagnósticos com `code`/`path` estáveis. Nunca lança: qualquer problema vira
 * diagnóstico. O lint de design (`lint.ts`) roda só quando não há erros.
 *
 * Paridade obrigatória com o backend Rust (`src-tauri/src/tools/genui`):
 * os casos ficam em `data/genui-fixtures.json` e são executados pelos dois
 * lados. Texto é contado por code points (não bytes/UTF-16) para que o corte
 * em `maxChars` seja idêntico nas duas linguagens.
 */
import {
  GENUI_CONTRACT,
  GENUI_DIAGNOSTICS_PER_CODE,
  GENUI_ICONS,
  GENUI_TAB_LABEL_MAX_CHARS,
  componentSpec,
  type GenUIArraySpec,
  type GenUIComponentSpec,
  type GenUIItemSpec,
  type GenUIPropSpec,
} from './contract';
import { capDiagnostics, createDiagnosticSink, type DiagnosticSink } from './diagnostics';
import type { GenUIComponent, GenUIDiagnostic, GenUISpec, GenUIValue } from './types';

const LIMITS = GENUI_CONTRACT.limits;
const TAB_LABEL_MAX_CHARS = GENUI_TAB_LABEL_MAX_CHARS;

export interface GenUINormalizeResult {
  /** Árvore canônica; `null` sempre que houver qualquer erro. */
  spec: GenUISpec | null;
  diagnostics: GenUIDiagnostic[];
}

interface NormalizeContext {
  sink: DiagnosticSink;
  nodes: number;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function charLength(text: string): number {
  return Array.from(text).length;
}

function sliceChars(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('');
}

function error(ctx: NormalizeContext, code: string, path: string, message: string, hint?: string): void {
  ctx.sink.add({ code, severity: 'error', path, message, hint });
}

function warning(ctx: NormalizeContext, code: string, path: string, message: string, hint?: string): void {
  ctx.sink.add({ code, severity: 'warning', path, message, hint });
}

function stripCodeFence(source: string): string {
  const fence = source.match(/^\s*```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```\s*$/);
  return (fence?.[1] ?? source).trim();
}

/* ------------------------------------------------------------------ */
/* Parse do texto → lista de componentes crus                           */
/* ------------------------------------------------------------------ */

function parseSource(source: unknown, ctx: NormalizeContext): unknown[] {
  if (typeof source !== 'string') {
    error(ctx, 'ui.invalid-json', '', 'O bloco `ui` está vazio.');
    return [];
  }
  if (charLength(source) > LIMITS.sourceChars) {
    error(
      ctx,
      'ui.source-too-large',
      '',
      `O bloco de UI generativa excede ${LIMITS.sourceChars} caracteres.`,
    );
    return [];
  }
  const text = stripCodeFence(source);
  if (!text) {
    error(ctx, 'ui.invalid-json', '', 'O bloco `ui` está vazio.');
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (parseError) {
    const detail = parseError instanceof Error ? parseError.message : String(parseError);
    error(ctx, 'ui.invalid-json', '', `JSON inválido: ${detail}`);
    return [];
  }

  let root: unknown = parsed;
  if (isPlainObject(parsed)) {
    if ('version' in parsed && parsed.version !== 2) {
      warning(
        ctx,
        'ui.version-mismatch',
        'version',
        `Versão ${String(parsed.version)} desconhecida; o bloco foi lido como versão 2.`,
      );
    }
    if (!('components' in parsed)) {
      error(
        ctx,
        'ui.invalid-root',
        '',
        'Estrutura inválida: esperado um objeto { "version"?: 2, "components": [...] }.',
      );
      return [];
    }
    root = parsed.components;
  }

  if (!Array.isArray(root)) {
    error(
      ctx,
      'ui.invalid-root',
      '',
      'Estrutura inválida: `components` deve ser uma lista de componentes.',
    );
    return [];
  }
  if (root.length === 0) {
    error(ctx, 'ui.empty', 'components', 'Nenhum componente para renderizar.');
    return [];
  }
  return root;
}

/* ------------------------------------------------------------------ */
/* Pipeline público                                                    */
/* ------------------------------------------------------------------ */

/**
 * Normaliza e valida um bloco `ui` cru (texto JSON). O retorno é determinístico
 * e nunca lança — o mesmo contrato vale para o renderer e para o backend.
 */
export function normalizeGenUI(source: unknown): GenUINormalizeResult {
  const ctx: NormalizeContext = { sink: createDiagnosticSink(), nodes: 0 };
  const rawComponents = parseSource(source, ctx);
  const components: GenUIComponent[] = [];
  rawComponents.forEach((raw, index) => {
    const node = normalizeComponent(raw, `components[${index}]`, 1, ctx);
    if (node) components.push(node);
  });

  const diagnostics = capDiagnostics(ctx.sink.list(), GENUI_DIAGNOSTICS_PER_CODE);
  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  return { spec: hasErrors ? null : { components }, diagnostics };
}

/* ------------------------------------------------------------------ */
/* Componentes                                                         */
/* ------------------------------------------------------------------ */

function normalizeComponent(
  raw: unknown,
  path: string,
  depth: number,
  ctx: NormalizeContext,
): GenUIComponent | null {
  ctx.nodes += 1;
  if (depth > LIMITS.depth) {
    error(
      ctx,
      'ui.too-deep',
      path,
      `Profundidade máxima de ${LIMITS.depth} níveis excedida na UI generativa.`,
    );
    return null;
  }
  if (ctx.nodes > LIMITS.nodes) {
    error(ctx, 'ui.too-many-nodes', path, `Máximo de ${LIMITS.nodes} componentes por bloco.`);
    return null;
  }
  if (!isPlainObject(raw)) {
    error(ctx, 'ui.invalid-component', path, 'Componente inválido: esperado um objeto.');
    return null;
  }

  const type = raw.type;
  if (typeof type !== 'string' || type.trim() === '') {
    error(ctx, 'ui.missing-type', `${path}.type`, 'Todo componente precisa de `type` (string).');
    return null;
  }
  const spec = componentSpec(type);
  if (!spec) {
    error(ctx, 'ui.unknown-type', `${path}.type`, `Componente desconhecido: "${type}".`);
    return null;
  }

  const prepared = applyLegacy(spec, raw, path, ctx);
  const props = normalizeProps(spec, prepared.props, path, ctx);
  const rawProps = isPlainObject(prepared.props) ? prepared.props : {};
  checkRequiredProps(spec, props, rawProps, path, ctx);
  if (spec.type === 'progress') normalizeProgress(props, path, ctx);
  const children = normalizeChildren(spec, prepared, path, depth, ctx);

  const node: GenUIComponent = { type: spec.type };
  if (Object.keys(props).length) node.props = props;
  if (children?.length) node.children = children;
  if (spec.type === 'actions') validateActions(props, path, ctx);
  return node;
}

function normalizeChildren(
  spec: GenUIComponentSpec,
  prepared: Record<string, unknown>,
  path: string,
  depth: number,
  ctx: NormalizeContext,
): GenUIComponent[] | undefined {
  const rawChildren = prepared.children;
  if (rawChildren === undefined || rawChildren === null) {
    if (spec.type === 'tabs') {
      error(
        ctx,
        'ui.tabs-empty',
        `${path}.children`,
        '`tabs` precisa de pelo menos um painel em `children`.',
      );
    }
    return undefined;
  }
  if (!Array.isArray(rawChildren)) {
    error(ctx, 'ui.invalid-children', `${path}.children`, `\`children\` de \`${spec.type}\` deve ser uma lista.`);
    return undefined;
  }
  if (!spec.acceptsChildren) {
    if (rawChildren.length > 0) {
      error(
        ctx,
        'ui.children-not-allowed',
        `${path}.children`,
        `\`${spec.type}\` não aceita \`children\`; use um container (card, stack, grid, tabs, reveal, callout).`,
      );
    }
    return undefined;
  }

  const children: GenUIComponent[] = [];
  rawChildren.forEach((rawChild, index) => {
    const childPath = `${path}.children[${index}]`;
    const child =
      spec.type === 'tabs'
        ? normalizeTabPanel(rawChild, childPath, depth + 1, ctx)
        : normalizeComponent(rawChild, childPath, depth + 1, ctx);
    if (child) children.push(child);
  });
  if (spec.type === 'tabs' && children.length === 0) {
    error(ctx, 'ui.tabs-empty', `${path}.children`, '`tabs` precisa de pelo menos um painel em `children`.');
  }
  return children.length ? children : undefined;
}

function normalizeTabPanel(
  raw: unknown,
  path: string,
  depth: number,
  ctx: NormalizeContext,
): GenUIComponent | null {
  if (!isPlainObject(raw)) return normalizeComponent(raw, path, depth, ctx);
  if (raw.props !== undefined && !isPlainObject(raw.props)) {
    return normalizeComponent(raw, path, depth, ctx);
  }

  const rawProps = isPlainObject(raw.props) ? { ...raw.props } : {};
  // `title` só é forma legada de rótulo quando o componente do painel não tem
  // uma prop `title` de verdade (reveal/card/code/chart têm e precisam manter).
  const panelDeclaresTitle = Object.hasOwn(componentSpec(raw.type)?.props ?? {}, 'title');
  const legacyTitle =
    !panelDeclaresTitle && rawProps.label === undefined && rawProps.title !== undefined;
  const labelRaw = rawProps.label !== undefined ? rawProps.label : legacyTitle ? rawProps.title : undefined;
  delete rawProps.label;
  if (legacyTitle) delete rawProps.title;
  const label = normalizeTabLabel(labelRaw, `${path}.props.label`, ctx);

  const node = normalizeComponent({ ...raw, props: rawProps }, path, depth, ctx);
  if (!node) return null;
  if (legacyTitle) {
    warning(
      ctx,
      'ui.legacy-shape',
      `${path}.props`,
      '`title` do painel foi normalizado para `props.label`.',
    );
  }
  if (label !== undefined) {
    node.props = { ...(node.props ?? {}), label };
  } else {
    error(
      ctx,
      'ui.tabs-label',
      `${path}.props.label`,
      'Cada painel de `tabs` precisa de `props.label` com o nome da aba.',
    );
  }
  return node;
}

function normalizeTabLabel(
  value: unknown,
  path: string,
  ctx: NormalizeContext,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') {
    warning(ctx, 'ui.coerced', path, 'Rótulo da aba convertido para texto.');
    return truncateText(String(value), TAB_LABEL_MAX_CHARS, path, ctx);
  }
  if (typeof value !== 'string') {
    error(ctx, 'ui.prop-type', path, 'O rótulo da aba deve ser texto.');
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return truncateText(trimmed, TAB_LABEL_MAX_CHARS, path, ctx);
}

function checkRequiredProps(
  spec: GenUIComponentSpec,
  props: Record<string, GenUIValue>,
  rawProps: Record<string, unknown>,
  path: string,
  ctx: NormalizeContext,
): void {
  for (const [name, propSpec] of Object.entries(spec.props)) {
    if (!propSpec.required) continue;
    // Prop ausente de verdade: erro. Prop presente mas com tipo inválido já
    // gera `ui.prop-type`; não duplicar como ausente.
    if (!(name in rawProps)) {
      error(ctx, 'ui.missing-prop', `${path}.props.${name}`, `\`${spec.type}\` requer a prop \`${name}\`.`);
      continue;
    }
    const value = props[name];
    if (value === undefined) continue;
    if (propSpec.type === 'text' && typeof value === 'string' && value.trim() === '') {
      error(
        ctx,
        'ui.missing-prop',
        `${path}.props.${name}`,
        `\`${spec.type}.${name}\` não pode ficar vazio.`,
      );
    }
  }
}

/**
 * `progress` aceita qualquer número no contrato (para não bloquear a render por
 * um valor estranho), mas o valor exibido é sempre 0..max e o ajuste é
 * sinalizado — o agente corrige na próxima emissão.
 */
function normalizeProgress(
  props: Record<string, GenUIValue>,
  path: string,
  ctx: NormalizeContext,
): void {
  const value = props.value;
  if (typeof value !== 'number') return;
  const max = typeof props.max === 'number' && props.max > 0 ? props.max : 100;
  if (value >= 0 && value <= max) return;
  props.value = Math.min(max, Math.max(0, value));
  warning(ctx, 'ui.clamped', `${path}.props.value`, `Valor ajustado para o intervalo 0–${max}.`);
}

function validateActions(
  props: Record<string, GenUIValue>,
  path: string,
  ctx: NormalizeContext,
): void {  const items = Array.isArray(props.items) ? props.items : [];
  items.forEach((item, index) => {
    if (!isPlainObject(item)) return;
    const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
    const copy = typeof item.copy === 'string' ? item.copy.trim() : '';
    if ((prompt !== '') === (copy !== '')) {
      error(
        ctx,
        'ui.action-invalid',
        `${path}.props.items[${index}]`,
        'Cada ação precisa de exatamente um de `prompt` ou `copy` (não ambos, não nenhum).',
      );
    }
  });
}

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

function normalizeProps(
  spec: GenUIComponentSpec,
  rawProps: unknown,
  path: string,
  ctx: NormalizeContext,
): Record<string, GenUIValue> {
  const props: Record<string, GenUIValue> = {};
  if (rawProps === undefined || rawProps === null) return props;
  if (!isPlainObject(rawProps)) {
    error(ctx, 'ui.invalid-props', `${path}.props`, `\`props\` de \`${spec.type}\` deve ser um objeto.`);
    return props;
  }

  for (const [name, propSpec] of Object.entries(spec.props)) {
    if (!(name in rawProps)) continue;
    const value = normalizeProp(rawProps[name], propSpec, `${path}.props.${name}`, ctx);
    if (value !== undefined) props[name] = value;
  }

  const unknown = Object.keys(rawProps)
    .filter((key) => !(key in spec.props))
    .sort();
  for (const key of unknown) {
    warning(ctx, 'ui.unknown-prop', `${path}.props.${key}`, `Prop desconhecida em \`${spec.type}\`: \`${key}\`.`);
  }
  return props;
}

function normalizeProp(
  value: unknown,
  spec: GenUIPropSpec,
  path: string,
  ctx: NormalizeContext,
): GenUIValue | undefined {
  switch (spec.type) {
    case 'text':
      return normalizeText(value, spec.maxChars, path, ctx);
    case 'number':
      return normalizeNumber(value, spec, path, ctx);
    case 'boolean':
      return normalizeBoolean(value, path, ctx);
    case 'enum':
      return normalizeEnum(value, spec, path, ctx);
    case 'icon':
      return normalizeIcon(value, path, ctx);
    case 'url':
      return normalizeUrl(value, path, ctx, false);
    case 'imageSrc':
      return normalizeUrl(value, path, ctx, true);
    case 'array':
      return spec.items ? normalizeArray(value, spec.items, path, ctx) : undefined;
    default:
      return undefined;
  }
}

function truncateText(text: string, max: number, path: string, ctx: NormalizeContext): string {
  if (charLength(text) <= max) return text;
  warning(ctx, 'ui.text-truncated', path, `Texto truncado em ${max} caracteres.`);
  return sliceChars(text, max);
}

function normalizeText(
  value: unknown,
  maxChars: number | undefined,
  path: string,
  ctx: NormalizeContext,
): string | undefined {
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    warning(ctx, 'ui.coerced', path, 'Valor convertido para texto.');
    text = String(value);
  } else {
    error(ctx, 'ui.prop-type', path, 'Esperado texto.');
    return undefined;
  }
  return truncateText(text, maxChars ?? LIMITS.stringChars, path, ctx);
}

const NUMERIC_STRING = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function normalizeNumber(
  value: unknown,
  spec: Pick<GenUIPropSpec, 'min' | 'max'>,
  path: string,
  ctx: NormalizeContext,
): number | undefined {
  let numeric: number | undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    numeric = value;
  } else if (typeof value === 'string' && NUMERIC_STRING.test(value.trim())) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      numeric = parsed;
      warning(ctx, 'ui.coerced', path, 'Texto numérico convertido para número.');
    }
  }
  if (numeric === undefined) {
    error(ctx, 'ui.prop-type', path, 'Esperado um número.');
    return undefined;
  }
  if (spec.min !== undefined && numeric < spec.min) {
    numeric = spec.min;
    warning(ctx, 'ui.clamped', path, `Valor ajustado para o mínimo de ${spec.min}.`);
  }
  if (spec.max !== undefined && numeric > spec.max) {
    numeric = spec.max;
    warning(ctx, 'ui.clamped', path, `Valor ajustado para o máximo de ${spec.max}.`);
  }
  return numeric;
}

function normalizeBoolean(value: unknown, path: string, ctx: NormalizeContext): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      warning(ctx, 'ui.coerced', path, 'Texto "true" convertido para booleano.');
      return true;
    }
    if (normalized === 'false') {
      warning(ctx, 'ui.coerced', path, 'Texto "false" convertido para booleano.');
      return false;
    }
  }
  error(ctx, 'ui.prop-type', path, 'Esperado booleano.');
  return undefined;
}

function normalizeEnum(
  value: unknown,
  spec: GenUIPropSpec,
  path: string,
  ctx: NormalizeContext,
): GenUIValue | undefined {
  if (typeof value !== 'string') {
    error(ctx, 'ui.prop-type', path, 'Esperado texto com um dos valores permitidos.');
    return undefined;
  }
  const raw = value.trim();
  const values = spec.values ?? [];
  const exact = values.find((entry) => entry === raw);
  if (exact !== undefined) return exact;
  const insensitive = values.find((entry) => entry.toLowerCase() === raw.toLowerCase());
  if (insensitive !== undefined) {
    warning(ctx, 'ui.coerced', path, `Valor normalizado para "${insensitive}".`);
    return insensitive;
  }
  if (spec.default !== undefined) {
    warning(ctx, 'ui.enum-default', path, `Valor inválido; usando o padrão "${String(spec.default)}".`);
    return spec.default;
  }
  error(
    ctx,
    'ui.prop-type',
    path,
    `Valor inválido: "${raw}". Use ${values.map((entry) => `\`${entry}\``).join(', ') || 'um valor permitido'}.`,
  );
  return undefined;
}

function normalizeIcon(value: unknown, path: string, ctx: NormalizeContext): string | undefined {
  if (typeof value !== 'string') {
    error(ctx, 'ui.prop-type', path, 'O ícone deve ser o nome de um ícone do contrato.');
    return undefined;
  }
  const name = value.trim();
  if (GENUI_ICONS.includes(name)) return name;
  warning(ctx, 'ui.icon-unknown', path, `Ícone desconhecido: "${name}"; será omitido.`);
  return undefined;
}

const URL_PATTERN = /^https?:\/\//i;
const DATA_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|webp|gif)[;,]/i;

function normalizeUrl(
  value: unknown,
  path: string,
  ctx: NormalizeContext,
  allowDataImage: boolean,
): string | undefined {
  if (typeof value !== 'string') {
    error(ctx, 'ui.prop-type', path, 'A URL deve ser texto.');
    return undefined;
  }
  const url = value.trim();
  if (URL_PATTERN.test(url)) return url;
  if (allowDataImage && DATA_IMAGE_PATTERN.test(url)) return url;
  error(ctx, 'ui.invalid-url', path, 'URLs devem começar com http:// ou https://.');
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Arrays e itens                                                      */
/* ------------------------------------------------------------------ */

function normalizeArray(
  value: unknown,
  spec: GenUIArraySpec,
  path: string,
  ctx: NormalizeContext,
): GenUIValue[] | undefined {
  if (!Array.isArray(value)) {
    error(ctx, 'ui.prop-type', path, 'Esperado um array.');
    return undefined;
  }
  let list = value;
  if (list.length > LIMITS.arrayItems) {
    list = list.slice(0, LIMITS.arrayItems);
    warning(ctx, 'ui.array-truncated', path, `Array truncado em ${LIMITS.arrayItems} itens.`);
  }
  if (list.length > spec.maxItems) {
    list = list.slice(0, spec.maxItems);
    warning(ctx, 'ui.array-truncated', path, `Array truncado em ${spec.maxItems} itens.`);
  }
  if (list.length < spec.minItems) {
    error(
      ctx,
      'ui.array-size',
      path,
      `Este array precisa de pelo menos ${spec.minItems} ${spec.minItems === 1 ? 'item' : 'itens'}.`,
    );
  }
  const items: GenUIValue[] = [];
  list.forEach((entry, index) => {
    const normalized = normalizeItem(entry, spec.item, `${path}[${index}]`, ctx);
    if (normalized !== undefined) items.push(normalized);
  });
  return items;
}

function normalizeItem(
  value: unknown,
  spec: GenUIItemSpec,
  path: string,
  ctx: NormalizeContext,
): GenUIValue | undefined {
  switch (spec.type) {
    case 'text':
      return normalizeText(value, spec.maxChars, path, ctx);
    case 'number':
      return normalizeNumber(value, spec, path, ctx);
    case 'scalar':
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
      }
      error(ctx, 'ui.prop-type', path, 'Esperado texto, número ou booleano.');
      return undefined;
    case 'array': {
      if (!Array.isArray(value)) {
        error(ctx, 'ui.prop-type', path, 'Esperado um array.');
        return undefined;
      }
      let list = value;
      if (spec.maxItems !== undefined && list.length > spec.maxItems) {
        list = list.slice(0, spec.maxItems);
        warning(ctx, 'ui.array-truncated', path, `Array truncado em ${spec.maxItems} itens.`);
      }
      if (spec.minItems !== undefined && list.length < spec.minItems) {
        error(ctx, 'ui.array-size', path, `Este array precisa de pelo menos ${spec.minItems} itens.`);
      }
      const items: GenUIValue[] = [];
      list.forEach((entry, index) => {
        if (!spec.item) return;
        const normalized = normalizeItem(entry, spec.item, `${path}[${index}]`, ctx);
        if (normalized !== undefined) items.push(normalized);
      });
      return items;
    }
    case 'object': {
      if (!isPlainObject(value)) {
        error(ctx, 'ui.prop-type', path, 'Esperado um objeto.');
        return undefined;
      }
      const props: Record<string, GenUIValue> = {};
      for (const [name, propSpec] of Object.entries(spec.props ?? {})) {
        if (!(name in value)) {
          if (propSpec.required) {
            error(ctx, 'ui.missing-prop', `${path}.${name}`, `Este item requer a prop \`${name}\`.`);
          }
          continue;
        }
        const normalized = normalizeProp(value[name], propSpec, `${path}.${name}`, ctx);
        if (normalized === undefined) continue;
        if (propSpec.type === 'text' && typeof normalized === 'string' && normalized.trim() === '') {
          if (propSpec.required) {
            error(ctx, 'ui.missing-prop', `${path}.${name}`, `\`${name}\` não pode ficar vazio.`);
          }
          continue;
        }
        props[name] = normalized;
      }
      const unknown = Object.keys(value)
        .filter((key) => !(key in (spec.props ?? {})))
        .sort();
      for (const key of unknown) {
        warning(ctx, 'ui.unknown-prop', `${path}.${key}`, `Prop desconhecida: \`${key}\`.`);
      }
      return props;
    }
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Formas legadas (normalizadas com aviso)                             */
/* ------------------------------------------------------------------ */

function applyLegacy(
  spec: GenUIComponentSpec,
  raw: Record<string, unknown>,
  path: string,
  ctx: NormalizeContext,
): Record<string, unknown> {
  const prepared: Record<string, unknown> = { ...raw };
  if (raw.props !== undefined && isPlainObject(raw.props)) prepared.props = { ...raw.props };
  const props = isPlainObject(prepared.props) ? prepared.props : undefined;
  if (!props) return prepared;

  if (spec.type === 'chart') {
    if (props.type === undefined && typeof props.chartType === 'string') {
      props.type = props.chartType;
      delete props.chartType;
      warning(ctx, 'ui.legacy-shape', `${path}.props`, '`chartType` foi normalizado para `type`.');
    }
    if (
      !Array.isArray(props.data) &&
      Array.isArray(props.labels) &&
      Array.isArray(props.values)
    ) {
      const labels = props.labels;
      const values = props.values;
      props.data = labels.map((label, index) => ({ label, value: values[index] }));
      delete props.labels;
      delete props.values;
      warning(ctx, 'ui.legacy-shape', `${path}.props`, '`labels` + `values` foram normalizados para `data`.');
    }
    if (Array.isArray(props.data) && props.data.some((entry) => Array.isArray(entry))) {
      props.data = props.data.map((entry) =>
        Array.isArray(entry) ? { label: entry[0], value: entry[1] } : entry,
      );
      warning(ctx, 'ui.legacy-shape', `${path}.props`, 'Pares [rótulo, valor] foram normalizados para { label, value }.');
    }
  }

  if (spec.type === 'keyvalue' && !Array.isArray(props.items) && isPlainObject(props.items)) {
    // Ordem canônica = labels ordenados por code unit/code point. O Rust usa
    // BTreeMap (ordem determinística); sem o sort o TS preservaria a ordem de
    // inserção e a árvore normalizada divergiria com 2+ chaves.
    const entries = Object.entries(props.items).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    props.items = entries.map(([label, value]) => ({ label, value }));
    warning(ctx, 'ui.legacy-shape', `${path}.props`, 'Objeto de pares foi normalizado para `items`.');
  }

  if (spec.type === 'list' && typeof props.items === 'string') {
    props.items = [{ text: props.items }];
    warning(ctx, 'ui.legacy-shape', `${path}.props`, '`items` como texto foi normalizado para um array.');
  }
  if ((spec.type === 'list' || spec.type === 'steps' || spec.type === 'timeline') && Array.isArray(props.items)) {
    if (props.items.some((entry) => typeof entry === 'string' || typeof entry === 'number')) {
      const key = spec.type === 'list' ? 'text' : 'title';
      props.items = props.items.map((entry) =>
        typeof entry === 'string' || typeof entry === 'number' ? { [key]: entry } : entry,
      );
      warning(ctx, 'ui.legacy-shape', `${path}.props`, 'Itens em texto foram normalizados para objetos.');
    }
  }

  if (spec.type === 'tabs' && Array.isArray(props.tabs)) {
    const labels = props.tabs;
    if (Array.isArray(prepared.children)) {
      prepared.children = prepared.children.map((child, index) => {
        if (!isPlainObject(child)) return child;
        const childProps = isPlainObject(child.props) ? { ...child.props } : {};
        if (!('label' in childProps) && typeof labels[index] === 'string') {
          childProps.label = labels[index];
        }
        return { ...child, props: childProps };
      });
    }
    delete props.tabs;
    warning(ctx, 'ui.legacy-shape', `${path}.props`, '`tabs` com nomes foi normalizado para `props.label` nos painéis.');
  }

  return prepared;
}
