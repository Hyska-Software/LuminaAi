// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolPresentationCard } from './ToolPresentationCard';
import type { ToolPresentation } from '@/lib/types';

afterEach(() => cleanup());

describe('ToolPresentationCard', () => {
  it('renderiza e expande o diff de uma alteração de arquivo', () => {
    const presentation: ToolPresentation = {
      kind: 'file_change',
      path: 'src/app.ts',
      change: 'modified',
      added: 2,
      removed: 1,
      diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,3 @@\n+export const b = 2;\n export const a = 1;\n',
    };
    render(<ToolPresentationCard presentation={presentation} />);
    expect(screen.getByText(/Alterou src\/app\.ts/)).toBeTruthy();
    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.getByText('−1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
  });

  it('mostra respostas do usuário e o estado "pulada"', () => {
    render(
      <ToolPresentationCard
        presentation={{
          kind: 'answers',
          answers: [{ questionId: 'db', selected: ['SQLite'], custom: null }],
          skipped: false,
        }}
      />,
    );
    expect(screen.getByText('Respostas do usuário')).toBeTruthy();
    expect(screen.getByText('SQLite')).toBeTruthy();

    cleanup();
    render(
      <ToolPresentationCard
        presentation={{ kind: 'answers', answers: [], skipped: true }}
      />,
    );
    expect(screen.getByText(/preferiu não responder/)).toBeTruthy();
  });

  it('não renderiza apresentações informativas desconhecidas', () => {
    const { container } = render(
      <ToolPresentationCard presentation={{ kind: 'output', lines: 10 }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
