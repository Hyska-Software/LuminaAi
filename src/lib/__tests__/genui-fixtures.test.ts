/**
 * Teste de paridade do contrato GenUI v2.
 *
 * `data/genui-fixtures.json` é executado por este teste (TypeScript) e pelo
 * backend Rust (`src-tauri/src/tools/genui`). Qualquer divergência de
 * normalização, validação ou lint aparece aqui como falha — é o mecanismo que
 * impede a documentação do prompt e os dois validadores de saírem de sincronia.
 */
import fixturesData from '@data/genui-fixtures.json';
import { describe, expect, it } from 'vitest';
import { GENUI_CONTRACT, GENUI_TYPES, parseGenUI, runGenUIAction } from '@/lib/genui';

interface FixtureCase {
  name: string;
  source: string;
  errors?: string[];
  warnings?: string[];
  normalized?: { components: unknown[] };
}

const fixtures = fixturesData as unknown as { version: number; cases: FixtureCase[] };

function codes(result: ReturnType<typeof parseGenUI>, severity: 'error' | 'warning'): string[] {
  return result.diagnostics
    .filter((diagnostic) => diagnostic.severity === severity)
    .map((diagnostic) => diagnostic.code)
    .sort();
}

describe('corpus de paridade GenUI v2', () => {
  it('declara a mesma versão do contrato', () => {
    expect(fixtures.version).toBe(GENUI_CONTRACT.version);
  });

  it('cobre todas as regras de design de bloco do contrato', () => {
    const covered = new Set(fixtures.cases.flatMap((fixture) => fixture.warnings ?? []));
    const missing = GENUI_CONTRACT.rules
      .filter((rule) => rule.scope === 'block' && !covered.has(rule.id))
      .map((rule) => rule.id);
    expect(missing).toEqual([]);
  });

  it('cobre todos os códigos de erro documentados (exceto o limite de tamanho)', () => {
    const covered = new Set(fixtures.cases.flatMap((fixture) => fixture.errors ?? []));
    const documented = [
      'ui.invalid-json',
      'ui.invalid-root',
      'ui.empty',
      'ui.invalid-component',
      'ui.missing-type',
      'ui.unknown-type',
      'ui.invalid-props',
      'ui.invalid-children',
      'ui.children-not-allowed',
      'ui.missing-prop',
      'ui.prop-type',
      'ui.invalid-url',
      'ui.array-size',
      'ui.too-deep',
      'ui.too-many-nodes',
      'ui.action-invalid',
      'ui.tabs-empty',
      'ui.tabs-label',
    ];
    expect(documented.filter((code) => !covered.has(code))).toEqual([]);
  });

  it('cobre todos os avisos de normalização', () => {
    const covered = new Set(fixtures.cases.flatMap((fixture) => fixture.warnings ?? []));
    const documented = [
      'ui.version-mismatch',
      'ui.unknown-prop',
      'ui.coerced',
      'ui.enum-default',
      'ui.text-truncated',
      'ui.array-truncated',
      'ui.clamped',
      'ui.icon-unknown',
      'ui.legacy-shape',
    ];
    expect(documented.filter((code) => !covered.has(code))).toEqual([]);
  });

  it('rejeita blocos acima do limite de tamanho', () => {
    const huge = `{"components":[{"type":"badge","props":{"label":"${'a'.repeat(
      GENUI_CONTRACT.limits.sourceChars,
    )}"}}]}`;
    const result = parseGenUI(huge);
    expect(result.spec).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('ui.source-too-large');
  });

  it('tem cobertura para todos os tipos do contrato', () => {
    const coverage = new Set(GENUI_TYPES);
    const seen = new Set<string>();
    for (const fixture of fixtures.cases) {
      for (const type of coverage) {
        if (fixture.source.includes(`"type":"${type}"`) || fixture.source.includes(`"type": "${type}"`)) {
          seen.add(type);
        }
      }
    }
    expect([...coverage].filter((type) => !seen.has(type))).toEqual([]);
  });

  for (const fixture of fixtures.cases) {
    it(fixture.name, () => {
      const result = parseGenUI(fixture.source);
      expect(codes(result, 'error')).toEqual([...(fixture.errors ?? [])].sort());
      expect(codes(result, 'warning')).toEqual([...(fixture.warnings ?? [])].sort());

      if ((fixture.errors ?? []).length > 0) {
        expect(result.spec).toBeNull();
        expect(result.error).toBeTruthy();
        return;
      }

      expect(result.spec).not.toBeNull();
      if (fixture.normalized) {
        expect(result.spec?.components).toEqual(fixture.normalized.components);
      }
    });
  }
});

describe('ações interativas', () => {
  it('prompt preenche o composer via evento zylara:suggest', async () => {
    const received: string[] = [];
    const listener = (event: Event) => {
      received.push((event as CustomEvent<string>).detail);
    };
    window.addEventListener('zylara:suggest', listener);
    try {
      const outcome = await runGenUIAction({ label: 'Ver', prompt: 'Detalhe a receita.' });
      expect(outcome.ok).toBe(true);
      expect(received).toEqual(['Detalhe a receita.']);
    } finally {
      window.removeEventListener('zylara:suggest', listener);
    }
  });

  it('recusa ação sem conteúdo', async () => {
    const outcome = await runGenUIAction({ label: 'Vazia' });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toBeTruthy();
  });
});
