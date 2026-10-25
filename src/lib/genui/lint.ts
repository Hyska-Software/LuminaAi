/**
 * Lint de design da UI generativa.
 *
 * Diferente do validador estrutural (que impede renderização), estas regras são
 * de **qualidade visual/UX**: todas viram avisos com um `hint` acionável. A
 * mesma lista de regras vem de `data/genui-contract.json` e é documentada no
 * system prompt — o agente recebe os avisos pela ferramenta `validate_ui`.
 *
 * O linter só roda quando a árvore normalizada não tem erros.
 */
import { GENUI_CONTRACT, GENUI_RULE_MAP } from './contract';
import { capDiagnostics } from './diagnostics';
import { asStringArray, propArray, propNumber, propObjectArray, propString } from './props';
import type { GenUIComponent, GenUIDiagnostic, GenUISpec, GenUIValue } from './types';

const DIAGNOSTICS_PER_CODE = GENUI_CONTRACT.limits.diagnosticsPerCode;

function ruleParams(id: string): Record<string, number> {
  return GENUI_RULE_MAP.get(id)?.params ?? {};
}

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

const MARKDOWN_PATTERNS: readonly RegExp[] = [
  /\*\*[^*\n]{1,80}\*\*/,
  /__[^_\n]{1,80}__/,
  /`[^`\n]{1,80}`/,
  /\[[^\]\n]{1,80}\]\([^)\n]{1,200}\)/,
  /(?:^|\n)\s{0,3}#{1,6}\s/,
];

const TEXT_KEYS = ['title', 'subtitle', 'footer', 'label', 'caption', 'cite', 'hint', 'text'];

function collectStrings(value: GenUIValue | undefined, into: string[], depth = 0): void {
  if (depth > 4 || value === undefined || value === null) return;
  if (typeof value === 'string') {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, into, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const entry of Object.values(value)) collectStrings(entry, into, depth + 1);
  }
}

function hasMarkdown(text: string): boolean {
  return MARKDOWN_PATTERNS.some((pattern) => pattern.test(text));
}

/** Conta code points (não unidades UTF-16) para casar com `chars().count()` do Rust. */
function textLength(text: string): number {
  return Array.from(text).length;
}

function hasEmoji(text: string): boolean {
  return EMOJI_PATTERN.test(text);
}

function isShouting(text: string): boolean {
  const letters = Array.from(text).filter((char) => /\p{L}/u.test(char));
  if (letters.length < 8) return false;
  const upper = letters.filter((char) => char === char.toUpperCase() && char !== char.toLowerCase()).length;
  return upper / letters.length > 0.7;
}

function endsWithPeriod(text: string): boolean {
  return text.trim().endsWith('.');
}

function labelOf(item: Record<string, GenUIValue>): string {
  return propString(item, 'label', propString(item, 'title')).trim();
}

/** Roda todas as regras de design do contrato sobre uma árvore normalizada. */
export function lintGenUI(spec: GenUISpec): GenUIDiagnostic[] {
  const diagnostics: GenUIDiagnostic[] = [];
  const push = (id: string, path: string): void => {
    const rule = GENUI_RULE_MAP.get(id);
    if (!rule) return;
    diagnostics.push({
      code: rule.id,
      severity: rule.severity,
      path,
      message: rule.message,
      hint: rule.hint,
    });
  };

  let nodes = 0;
  let maxDepth = 0;
  let cards = 0;
  let dividers = 0;

  const rootMax = ruleParams('ui.root-count').max ?? 4;
  if (spec.components.length > rootMax) push('ui.root-count', 'components');

  const visit = (components: GenUIComponent[], depth: number, prefix: string, parentType?: string): void => {
    components.forEach((node, index) => visitNode(node, depth, `${prefix}[${index}]`, parentType));
  };

  const visitNode = (node: GenUIComponent, depth: number, path: string, parentType?: string): void => {
    nodes += 1;
    maxDepth = Math.max(maxDepth, depth);
    const props = node.props;
    const children = node.children ?? [];

    switch (node.type) {
      case 'card': {
        if (depth === 1 && !propString(props, 'title').trim()) push('ui.card-title', `${path}.props.title`);
        if (parentType === 'card') push('ui.card-nested', path);
        cards += 1;
        if (cards > (ruleParams('ui.cards-count').max ?? 4)) push('ui.cards-count', path);
        break;
      }
      case 'grid': {
        const columns = Math.max(1, Math.min(4, Math.round(propNumber(props, 'columns', 2) ?? 2)));
        if (children.length > 0 && children.length % columns !== 0) push('ui.grid-orphans', path);
        if (children.length > columns * (ruleParams('ui.grid-crowded').factor ?? 3)) {
          push('ui.grid-crowded', path);
        }
        break;
      }
      case 'divider': {
        dividers += 1;
        if (dividers > (ruleParams('ui.divider-count').max ?? 2)) push('ui.divider-count', path);
        break;
      }
      case 'chart': {
        const type = propString(props, 'type', 'bar');
        const data = propArray(props, 'data') ?? [];
        if (!propString(props, 'title').trim()) push('ui.chart-title', `${path}.props.title`);
        if (data.length < (ruleParams('ui.chart-points-min').min ?? 2)) push('ui.chart-points-min', path);
        if (type === 'pie' && data.length > (ruleParams('ui.chart-pie-slices').max ?? 7)) {
          push('ui.chart-pie-slices', path);
        }
        break;
      }
      case 'table': {
        const columns = asStringArray(props?.columns);
        if (columns.length > (ruleParams('ui.table-columns').max ?? 8)) push('ui.table-columns', path);
        const rows = propArray(props, 'rows') ?? [];
        rows.forEach((row, rowIndex) => {
          if (Array.isArray(row) && row.length !== columns.length) {
            push('ui.table-arity', `${path}.props.rows[${rowIndex}]`);
          }
        });
        break;
      }
      case 'stat': {
        // Thresholds vêm dos `params` da regra no contrato (sem número mágico
        // duplicado com o Rust).
        const stat = ruleParams('ui.stat-long');
        if (
          textLength(propString(props, 'label')) > (stat.label ?? 32) ||
          textLength(propString(props, 'value')) > (stat.value ?? 20) ||
          textLength(propString(props, 'hint')) > (stat.hint ?? 100)
        ) {
          push('ui.stat-long', path);
        }
        break;
      }
      case 'list': {
        if ((propArray(props, 'items') ?? []).length > (ruleParams('ui.list-long').max ?? 20)) {
          push('ui.list-long', path);
        }
        break;
      }
      case 'timeline': {
        if ((propArray(props, 'items') ?? []).length > (ruleParams('ui.timeline-long').max ?? 12)) {
          push('ui.timeline-long', path);
        }
        break;
      }
      case 'steps': {
        if ((propArray(props, 'items') ?? []).length > (ruleParams('ui.steps-long').max ?? 10)) {
          push('ui.steps-long', path);
        }
        break;
      }
      case 'keyvalue': {
        if ((propArray(props, 'items') ?? []).length > (ruleParams('ui.keyvalue-long').max ?? 12)) {
          push('ui.keyvalue-long', path);
        }
        break;
      }
      case 'tabs': {
        if (children.length > (ruleParams('ui.tabs-count').max ?? 6)) push('ui.tabs-count', path);
        break;
      }
      case 'actions': {
        lintActions(propObjectArray(props, 'items'), path, push);
        break;
      }
      case 'callout': {
        // Estilo descontinuado (auditoria de produto): caixas coloridas de nota
        // não fazem parte do padrão do chat. Mensagens antigas continuam
        // renderizando; novas respostas recebem este aviso via validate_ui.
        push('ui.callout-style', path);
        break;
      }
      case 'section': {
        if (!propString(props, 'title').trim() && !propString(props, 'eyebrow').trim()) {
          push('ui.section-header', path);
        }
        break;
      }
      case 'choices': {
        if (!propString(props, 'submitLabel').trim()) push('ui.choices-submit', path);
        break;
      }
      default:
        break;
    }

    if (['card', 'stack', 'grid', 'reveal'].includes(node.type) && children.length === 0) {
      push('ui.empty-container', path);
    }

    lintCopy(node, path, push);

    if (node.children?.length) {
      visit(node.children, depth + 1, `${path}.children`, node.type);
    }
  };

  visit(spec.components, 1, 'components');

  const density = ruleParams('ui.density');
  if (nodes > (density.nodes ?? 60) || maxDepth > (density.depth ?? 5)) {
    push('ui.density', 'components');
  }

  return capDiagnostics(diagnostics, DIAGNOSTICS_PER_CODE);
}

type PushRule = (id: string, path: string) => void;

function lintActions(items: Record<string, GenUIValue>[], path: string, push: PushRule): void {
  const labels = items.map(labelOf).filter((label) => label !== '');
  const seen = new Set<string>();
  for (const label of labels) {
    const key = label.toLowerCase();
    if (seen.has(key)) {
      push('ui.duplicate-action', `${path}.props.items`);
      break;
    }
    seen.add(key);
  }

  const primaries = items.filter((item) => propString(item, 'tone') === 'primary').length;
  if (primaries > 1) push('ui.action-primary', `${path}.props.items`);

  const maxLabel = ruleParams('ui.action-label-long').max ?? 40;
  items.forEach((item, index) => {
    const label = propString(item, 'label');
    if (textLength(label) > maxLabel) push('ui.action-label-long', `${path}.props.items[${index}].label`);
    if (endsWithPeriod(label)) push('ui.label-period', `${path}.props.items[${index}].label`);
    if (hasEmoji(label)) push('ui.emoji', `${path}.props.items[${index}].label`);
    if (isShouting(label)) push('ui.shouting', `${path}.props.items[${index}].label`);
  });
}

function lintCopy(node: GenUIComponent, path: string, push: PushRule): void {
  const props = node.props;
  if (!props) return;

  // Markdown não é renderizado dentro de props; `code` é o caso legítimo de
  // texto com sintaxe (inclusive crases) e fica de fora.
  if (node.type !== 'code') {
    const strings: string[] = [];
    collectStrings(props, strings);
    if (strings.some(hasMarkdown)) push('ui.markdown-in-props', `${path}.props`);
  }

  for (const key of TEXT_KEYS) {
    const value = props[key];
    if (typeof value !== 'string' || value.trim() === '') continue;
    if (['title', 'label'].includes(key)) {
      if (endsWithPeriod(value)) push('ui.label-period', `${path}.props.${key}`);
      if (hasEmoji(value)) push('ui.emoji', `${path}.props.${key}`);
      if (isShouting(value)) push('ui.shouting', `${path}.props.${key}`);
    }
  }
}
