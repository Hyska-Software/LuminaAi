import { describe, expect, it } from 'vitest';
import {
  CHART_TYPES,
  GENUI_LIMITS,
  GENUI_TYPES,
  asStringArray,
  chartFromProps,
  parseChartSpec,
  parseGenUI,
  propArray,
  propBool,
  propNumber,
  propObjectArray,
  propString,
} from '@/lib/genui/schema';
import { GENUI_CONTRACT, GENUI_ICONS } from '@/lib/genui/contract';
import { isSvgMarkup, sanitizeSvg } from '@/lib/genui/sanitize';
import { parseCsv } from '@/components/artifacts/csv';

describe('parseGenUI', () => {
  it('accepts a valid component tree', () => {
    const source = JSON.stringify({
      components: [
        {
          type: 'card',
          props: { title: 'Resumo' },
          children: [
            { type: 'stat', props: { label: 'Receita', value: 'R$ 12.400' } },
            { type: 'list', props: { items: ['um', 'dois'], ordered: true } },
          ],
        },
      ],
    });
    const { spec, error } = parseGenUI(source);
    expect(error).toBeNull();
    expect(spec?.components).toHaveLength(1);
    expect(spec?.components[0].children).toHaveLength(2);
  });

  it('accepts a bare array of components', () => {
    const { spec, error } = parseGenUI('[{"type":"badge","props":{"label":"novo"}}]');
    expect(error).toBeNull();
    expect(spec?.components[0].type).toBe('badge');
  });

  it('rejects invalid JSON', () => {
    const { spec, error } = parseGenUI('{"components":[');
    expect(spec).toBeNull();
    expect(error).toMatch(/JSON/i);
  });

  it('rejects unknown component types (incluindo tipos herdados de Object.prototype)', () => {
    for (const kind of ['iframe', 'constructor', 'toString', '__proto__']) {
      const { spec, diagnostics } = parseGenUI(`{"components":[{"type":"${kind}","props":{}}]}`);
      expect(spec).toBeNull();
      expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('ui.unknown-type');
    }
  });

  it('rejects nesting deeper than the limit', () => {
    let node: Record<string, unknown> = { type: 'stat', props: { label: 'a', value: 'b' } };
    for (let index = 0; index < GENUI_LIMITS.depth + 1; index += 1) {
      node = { type: 'card', children: [node] };
    }
    const { spec, diagnostics } = parseGenUI(JSON.stringify({ components: [node] }));
    expect(spec).toBeNull();
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('ui.too-deep');
  });

  it('rejects trees with too many components', () => {
    const children = Array.from({ length: GENUI_LIMITS.nodes + 1 }, () => ({
      type: 'badge',
      props: { label: 'x' },
    }));
    const { spec, diagnostics } = parseGenUI(JSON.stringify({ components: children }));
    expect(spec).toBeNull();
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('ui.too-many-nodes');
  });

  it('rejects empty component lists', () => {
    const { error } = parseGenUI('{"components":[]}');
    expect(error).toMatch(/Nenhum componente/i);
  });

  it('exposes every renderer primitive in the whitelist', () => {
    for (const type of [
      'card',
      'stack',
      'grid',
      'tabs',
      'reveal',
      'section',
      'table',
      'chart',
      'stat',
      'progress',
      'timeline',
      'steps',
      'checklist',
      'callout',
      'quote',
      'text',
      'code',
      'list',
      'image',
      'source',
      'badge',
      'divider',
      'link',
      'keyvalue',
      'actions',
      'choices',
    ]) {
      expect(GENUI_TYPES).toContain(type);
    }
    expect(GENUI_TYPES).toHaveLength(26);
  });

  it('keeps the limits aligned with the shared contract', () => {
    expect(GENUI_LIMITS.source).toBe(GENUI_CONTRACT.limits.sourceChars);
    expect(GENUI_LIMITS.depth).toBe(GENUI_CONTRACT.limits.depth);
    expect(GENUI_LIMITS.nodes).toBe(GENUI_CONTRACT.limits.nodes);
    expect(GENUI_LIMITS.nodes).toBe(120);
    expect(GENUI_LIMITS.depth).toBe(8);
  });

  it('keeps the contract internally consistent', () => {
    const types = GENUI_CONTRACT.components.map((component) => component.type);
    expect(new Set(types).size).toBe(types.length);
    expect(new Set(GENUI_ICONS).size).toBe(GENUI_ICONS.length);
    for (const rule of GENUI_CONTRACT.rules) {
      expect(rule.prompt.trim()).not.toBe('');
      expect(rule.hint.trim()).not.toBe('');
      expect(['error', 'warning']).toContain(rule.severity);
      expect(['block', 'message']).toContain(rule.scope);
    }
    // Toda regra de bloco tem um `params` numérico ou é estrutural.
    const withParams = GENUI_CONTRACT.rules.filter((rule) => rule.params);
    expect(withParams.length).toBeGreaterThan(8);
  });
});

describe('chart spec', () => {
  it('parses data arrays', () => {
    const { chart, error } = parseChartSpec(
      JSON.stringify({
        type: 'bar',
        title: 'Receita',
        data: [
          { label: 'Jan', value: 3.2 },
          { label: 'Fev', value: 4.1 },
        ],
      }),
    );
    expect(error).toBeNull();
    expect(chart?.type).toBe('bar');
    expect(chart?.data).toEqual([
      { label: 'Jan', value: 3.2 },
      { label: 'Fev', value: 4.1 },
    ]);
    expect(chart?.title).toBe('Receita');
  });

  it('parses labels + values shorthand', () => {
    const { chart } = parseChartSpec(
      JSON.stringify({ type: 'line', labels: ['A', 'B'], values: [1, '2'] }),
    );
    expect(chart?.data).toEqual([
      { label: 'A', value: 1 },
      { label: 'B', value: 2 },
    ]);
  });

  it('accepts only the documented chart types', () => {
    expect(CHART_TYPES).toEqual(['bar', 'line', 'pie']);
    expect(parseChartSpec('{"type":"donut","data":[]}').chart).toBeNull();
  });

  it('reports an error when there is no numeric data', () => {
    const { chart, error } = parseChartSpec('{"type":"bar","data":[]}');
    expect(chart).toBeNull();
    expect(error).toMatch(/Nenhum valor/i);
  });

  it('builds a chart from component props', () => {
    const { chart, error } = chartFromProps({ type: 'pie', data: [{ label: 'A', value: 2 }] });
    expect(error).toBeNull();
    expect(chart?.type).toBe('pie');
  });

  it('returns an error for missing props', () => {
    expect(chartFromProps(undefined).chart).toBeNull();
  });
});

describe('prop accessors', () => {
  const props = {
    title: 'Oi',
    count: '7',
    active: true,
    items: ['a', 'b'],
    records: [{ title: 'a' }, { title: 'b' }],
  };

  it('reads typed values', () => {
    expect(propString(props, 'title', 'x')).toBe('Oi');
    expect(propString(props, 'missing', 'x')).toBe('x');
    expect(propNumber(props, 'count', 0)).toBe(7);
    expect(propBool(props, 'active')).toBe(true);
    expect(propArray(props, 'items')).toEqual(['a', 'b']);
    expect(asStringArray(props.items)).toEqual(['a', 'b']);
    expect(propObjectArray(props, 'records')).toHaveLength(2);
  });

  it('returns fallbacks for missing values', () => {
    expect(propNumber(props, 'missing', 3)).toBe(3);
    expect(propBool(props, 'missing')).toBe(false);
    expect(propArray(props, 'missing')).toBeUndefined();
    expect(propObjectArray(props, 'missing')).toEqual([]);
  });
});

describe('SVG sanitizer', () => {
  it('detects SVG markup', () => {
    expect(isSvgMarkup('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe(true);
    expect(isSvgMarkup('<div></div>')).toBe(false);
  });

  it('removes scripts, event handlers and javascript URLs', () => {
    const dirty =
      '<svg onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a><rect width="10"/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/onload/i);
    expect(clean).not.toContain('javascript:');
    expect(clean).toContain('<rect');
  });

  it('removes iframes and srcdoc payloads', () => {
    const clean = sanitizeSvg('<svg><iframe srcdoc="<script>alert(1)</script>"></iframe></svg>');
    expect(clean).not.toMatch(/iframe/i);
    expect(clean).not.toMatch(/srcdoc/i);
  });

  it('returns an empty string for empty input', () => {
    expect(sanitizeSvg('')).toBe('');
  });
});

describe('CSV parser', () => {
  it('parses quoted fields and escaped quotes', () => {
    const parsed = parseCsv('nome,valor\n"silva, joão",12\n"diz ""oi""",7\n');
    expect(parsed.rows).toEqual([
      ['nome', 'valor'],
      ['silva, joão', '12'],
      ['diz "oi"', '7'],
    ]);
    expect(parsed.truncated).toBe(false);
    expect(parsed.totalRows).toBe(3);
  });

  it('handles CRLF line endings', () => {
    const parsed = parseCsv('a,b\r\n1,2\r\n');
    expect(parsed.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('caps the number of parsed rows', () => {
    const source = ['header', ...Array.from({ length: 20 }, (_, index) => `row${index}`)].join('\n');
    const parsed = parseCsv(source, 5);
    expect(parsed.rows).toHaveLength(5);
    expect(parsed.truncated).toBe(true);
    expect(parsed.totalRows).toBe(21);
  });

  it('strips a UTF-8 BOM', () => {
    const parsed = parseCsv('\uFEFFa,b\n1,2');
    expect(parsed.rows[0]).toEqual(['a', 'b']);
  });
});
