/**
 * Garante que a documentação da UI generativa não saia de sincronia:
 * - todo exemplo ```ui de docs/GENUI.md é válido e não gera avisos de design;
 * - todo componente, regra e ícone do contrato está documentado;
 * - os exemplos canônicos usados pelo system prompt são válidos.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GENUI_COMPONENTS,
  GENUI_CONTRACT,
  GENUI_ICONS,
  parseGenUI,
} from '@/lib/genui';

const doc = readFileSync('docs/GENUI.md', 'utf8');

function uiBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const pattern = /```ui\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null = pattern.exec(markdown);
  while (match) {
    blocks.push(match[1]);
    match = pattern.exec(markdown);
  }
  return blocks;
}

describe('docs/GENUI.md', () => {
  const blocks = uiBlocks(doc);

  it('tem exemplos ```ui suficientes', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(3);
  });

  for (const [index, block] of blocks.entries()) {
    it(`exemplo ${index + 1} é válido e sem avisos`, () => {
      const result = parseGenUI(block);
      expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
      expect(result.warnings.map((warning) => warning.code)).toEqual([]);
      expect(result.spec).not.toBeNull();
    });
  }

  it('documenta todos os componentes do contrato', () => {
    for (const component of GENUI_COMPONENTS) {
      expect(doc).toContain(`\`${component.type}\``);
    }
  });

  it('documenta todas as regras de design do contrato', () => {
    for (const rule of GENUI_CONTRACT.rules) {
      expect(doc).toContain(rule.id);
    }
  });

  it('documenta todos os ícones das ações', () => {
    for (const icon of GENUI_ICONS) {
      expect(doc).toContain(icon);
    }
  });

  it('aponta o contrato como fonte única', () => {
    expect(doc).toContain('data/genui-contract.json');
    expect(doc).toContain('data/genui-fixtures.json');
    expect(doc).toContain('validate_ui');
  });

  it('o exemplo "Ruim" (§12.7) realmente é inválido pelo motivo documentado', () => {
    const section = doc.slice(doc.indexOf('### 12.7 Ruim'));
    const match = /```json\r?\n([\s\S]*?)```/.exec(section);
    expect(match).not.toBeNull();
    const result = parseGenUI(match?.[1] ?? '');
    expect(result.spec).toBeNull();
    const errors = result.diagnostics
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => diagnostic.code);
    expect(errors).toEqual(['ui.action-invalid']);
    expect(result.warnings).toEqual([]);
  });
});

describe('exemplos canônicos do system prompt', () => {
  for (const file of [
    'data/genui-example.json',
    'data/genui-example-minimal.json',
    'data/genui-example-interactive.json',
  ]) {
    it(`${file} é válido e sem avisos`, () => {
      const result = parseGenUI(readFileSync(file, 'utf8'));
      expect(result.error).toBeNull();
      expect(result.warnings).toEqual([]);
    });
  }
});
