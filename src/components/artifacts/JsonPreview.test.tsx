// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Artifact, ArtifactContent } from '@/lib/types';
import { JsonPreview } from './JsonPreview';
import { JsonTree } from './JsonTree';

afterEach(() => cleanup());

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'artifact-json',
    conversationId: 'conv-1',
    name: 'dados.json',
    mimeType: 'application/json',
    kind: 'json',
    size: 128,
    createdAt: 1,
    ...overrides,
  };
}

function contentFor(json: string, overrides: Partial<Artifact> = {}): ArtifactContent {
  return { artifact: artifact(overrides), content: json, dataBase64: null };
}

function jsonContent(value: unknown, overrides: Partial<Artifact> = {}): ArtifactContent {
  return contentFor(JSON.stringify(value), overrides);
}

describe('JsonPreview — árvore', () => {
  it('renderiza chaves ordenadas e valores tipados por token', () => {
    render(
      <JsonPreview
        content={jsonContent({ zeta: 1, alpha: 'A', lista: [10, 20], nada: null, ativo: false })}
      />,
    );

    const tree = screen.getByRole('group', { name: 'Árvore do JSON dados.json' });
    const text = tree.textContent ?? '';
    expect(text).toContain('"alpha"');
    expect(text).toContain('"zeta"');
    // chaves ordenadas alfabeticamente
    expect(text.indexOf('"alpha"')).toBeLessThan(text.indexOf('"zeta"'));

    expect(screen.getByText('"A"').className).toContain('text-success');
    expect(screen.getByText('10').className).toContain('text-warning');
    expect(screen.getByText('null').className).toContain('text-foreground-subtle');
    expect(screen.getByText('false').className).toContain('text-warning');

    expect(text).toContain('5 chaves');
    expect(text).toContain('2 itens');
  });

  it('colapsa e expande nós profundos com aria-expanded', () => {
    render(<JsonPreview content={jsonContent({ a: { b: { c: 1 } } })} />);

    // Profundidade inicial 2: `b` (nível 2) começa recolhido.
    expect(screen.queryByText('1')).toBeNull();
    const expand = screen.getByRole('button', { name: 'Expandir b' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(expand);
    expect(screen.getByText('1')).toBeTruthy();
    const collapse = screen.getByRole('button', { name: 'Recolher b' });
    expect(collapse.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(collapse);
    expect(screen.queryByText('1')).toBeNull();
  });

  it('lida com arrays/objetos aninhados e contagens no singular', () => {
    render(<JsonPreview content={jsonContent({ itens: [{ id: 1, nome: 'A' }] })} />);

    expect(screen.getByText('1 chave')).toBeTruthy();
    expect(screen.getByText('1 item')).toBeTruthy();
    // Objetos dentro do array (nível 2) começam recolhidos.
    expect(screen.queryByText('1')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Expandir [0]' }));
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('"A"')).toBeTruthy();
  });

  it('trunca documentos que passam do limite de nós e avisa', () => {
    render(<JsonTree value={{ a: 1, b: 2, c: 3, d: 4 }} maxNodes={3} />);

    expect(screen.getByText(/Prévia truncada — JSON muito extenso/)).toBeTruthy();
    expect(screen.queryByText('d')).toBeNull();
  });

  it('mostra o estado vazio para conteúdo em branco', () => {
    render(<JsonPreview content={contentFor('   ')} />);

    expect(screen.getByText('JSON vazio.')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('mostra o estado vazio quando o conteúdo está longe de JSON', () => {
    render(<JsonPreview content={contentFor('Erro: arquivo indisponível')} />);

    expect(screen.getByText('Conteúdo sem JSON para visualizar.')).toBeTruthy();
  });
});

describe('JsonPreview — modo código', () => {
  it('alterna entre Árvore e Código pelo SegmentedControl', () => {
    const { container } = render(<JsonPreview content={jsonContent({ nome: 'Ana', idade: 30 })} />);

    const treeRadio = screen.getByRole('radio', { name: 'Árvore' });
    const codeRadio = screen.getByRole('radio', { name: 'Código' });
    expect(treeRadio.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(codeRadio);

    expect(codeRadio.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Recolher JSON' })).toBeNull();
    expect(container.textContent).toContain('"Ana"');
    expect(container.textContent).toContain('"nome"');
    // Cabeçalho do CodeBlock: nome do artefato + contagem de linhas.
    expect(screen.getByText('dados.json')).toBeTruthy();
    expect(screen.getByText('4 linhas')).toBeTruthy();

    fireEvent.click(treeRadio);
    expect(screen.getByRole('button', { name: 'Recolher JSON' })).toBeTruthy();
  });

  it('exibe o texto cru com aviso discreto quando o JSON é inválido', () => {
    const raw = '{"nome": "Ana",}';
    const { container } = render(<JsonPreview content={contentFor(raw)} />);

    expect(screen.getByText(/JSON inválido/)).toBeTruthy();
    expect(screen.getByText(/exibindo o conteúdo original/)).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(container.textContent).toContain('"nome"');
  });
});
