// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Artifact, ArtifactContent } from '@/lib/types';
import { MarkdownPreview } from './MarkdownPreview';

afterEach(() => cleanup());

function contentFor(text: string | null, overrides: Partial<Artifact> = {}): ArtifactContent {
  return {
    artifact: {
      id: 'artifact-markdown',
      conversationId: 'conv-1',
      name: 'notas.md',
      mimeType: 'text/markdown',
      kind: 'markdown',
      language: 'markdown',
      size: 128,
      createdAt: 1,
      ...overrides,
    },
    content: text,
    dataBase64: null,
  };
}

describe('MarkdownPreview', () => {
  it('renderiza o documento com o pipeline de Markdown do chat', () => {
    render(<MarkdownPreview content={contentFor('# Título\n\nTexto **forte** e `código`.')} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Título' })).toBeTruthy();
    expect(screen.getByText('forte').tagName).toBe('STRONG');
    expect(screen.getByRole('region', { name: 'Prévia do Markdown' })).toBeTruthy();
    // O componente `Markdown` do chat aplica a classe de prosa da Zylara.
    expect(document.querySelector('.zylara-prose')).toBeTruthy();
  });

  it('alterna entre Documento e Código', () => {
    render(<MarkdownPreview content={contentFor('# Título\n\n- item')} />);

    const group = screen.getByRole('radiogroup', {
      name: 'Modo de visualização do Markdown',
    });
    expect(group).toBeTruthy();
    // Documento é o modo inicial: o nome do arquivo só aparece no CodeBlock.
    expect(screen.queryByText('notas.md')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Título' })).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Código' }));

    expect(screen.getByText('notas.md')).toBeTruthy();
    expect(document.querySelector('pre')?.textContent).toContain('# Título');
    expect(screen.queryByRole('heading', { level: 1, name: 'Título' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Documento' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Título' })).toBeTruthy();
    expect(screen.queryByText('notas.md')).toBeNull();
  });

  it('mostra um estado vazio discreto para Markdown em branco', () => {
    render(<MarkdownPreview content={contentFor('   \n\t')} />);

    expect(screen.getByText('Markdown vazio.')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});
