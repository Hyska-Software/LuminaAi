// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Artifact, ArtifactContent, ArtifactKind } from '@/lib/types';
import { CodePreview } from './CodePreview';

afterEach(() => cleanup());

function contentFor(
  kind: ArtifactKind,
  text: string | null,
  overrides: Partial<Artifact> = {},
): ArtifactContent {
  return {
    artifact: {
      id: `artifact-${kind}`,
      conversationId: 'conv-1',
      name: kind === 'text' ? 'notas.txt' : 'main.py',
      mimeType: kind === 'text' ? 'text/plain' : 'text/x-python',
      kind,
      size: 128,
      createdAt: 1,
      ...overrides,
    },
    content: text,
    dataBase64: null,
  };
}

const WRAP_LABEL = 'Quebrar linhas';

describe('CodePreview', () => {
  it('mostra badge de linguagem, contagem de linhas e o código', () => {
    render(
      <CodePreview
        content={contentFor('code', 'def soma(a, b):\n    return a + b\n', { name: 'main.py' })}
      />,
    );

    expect(screen.getByRole('toolbar', { name: 'Controles do código' })).toBeTruthy();
    expect(screen.getByText('Python')).toBeTruthy();
    expect(screen.getByText('2 linhas')).toBeTruthy();
    expect(screen.getByText('main.py')).toBeTruthy();
    expect(document.querySelector('pre')?.textContent).toContain('def soma');
  });

  it('conta uma linha no singular', () => {
    render(<CodePreview content={contentFor('code', 'console.log(1)', { name: 'app.ts' })} />);

    expect(screen.getByText('1 linha')).toBeTruthy();
    expect(screen.getByText('TypeScript')).toBeTruthy();
  });

  it('respeita a linguagem explícita do backend', () => {
    render(
      <CodePreview
        content={contentFor('code', 'fn main() {}', { name: 'programa.txt', language: 'rust' })}
      />,
    );

    expect(screen.getByText('Rust')).toBeTruthy();
  });

  it('infere a linguagem pela extensão quando o backend não informa', () => {
    render(<CodePreview content={contentFor('code', 'body { margin: 0; }', { name: 'estilo.css' })} />);

    expect(screen.getByText('CSS')).toBeTruthy();
  });

  it('inicia com quebra de linhas desativada em código e ativada em texto', () => {
    const first = render(<CodePreview content={contentFor('code', 'const a = 1;', { name: 'app.ts' })} />);

    expect(screen.getByRole('button', { name: WRAP_LABEL }).getAttribute('aria-pressed')).toBe('false');
    first.unmount();

    render(<CodePreview content={contentFor('text', 'linha longa', { name: 'notas.txt' })} />);

    expect(screen.getByRole('button', { name: WRAP_LABEL }).getAttribute('aria-pressed')).toBe('true');
  });

  it('alterna a quebra de linhas do bloco de código', () => {
    render(<CodePreview content={contentFor('code', 'const a = 1;', { name: 'app.ts' })} />);

    const toggle = screen.getByRole('button', { name: WRAP_LABEL });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('pre [class*="whitespace-pre-wrap"]')).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('pre [class*="whitespace-pre-wrap"]')).toBeTruthy();

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('pre [class*="whitespace-pre-wrap"]')).toBeNull();
  });

  it('não mostra números de linha em texto simples', () => {
    render(<CodePreview content={contentFor('text', 'primeira\nsegunda', { name: 'notas.txt' })} />);

    expect(document.querySelectorAll('.table-cell.select-none')).toHaveLength(0);
    expect(screen.getByText('Texto')).toBeTruthy();
  });

  it('mostra números de linha em código', () => {
    render(<CodePreview content={contentFor('code', 'a = 1\nb = 2', { name: 'script.py' })} />);

    expect(document.querySelectorAll('.table-cell.select-none').length).toBe(2);
  });

  it('mostra um estado vazio para arquivo sem conteúdo', () => {
    render(<CodePreview content={contentFor('code', '  \n', { name: 'vazio.py' })} />);

    expect(screen.getByText('Nada para exibir.')).toBeTruthy();
    expect(screen.queryByRole('toolbar')).toBeNull();
  });
});
