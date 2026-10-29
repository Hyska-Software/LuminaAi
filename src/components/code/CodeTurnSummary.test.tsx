// @vitest-environment jsdom
/**
 * Card de fecho de turno do layout Code (WORKBENCH §5.1). O modelo puro
 * (`lib/codeTurnSummary`) já é testado à parte; aqui cobrimos o card: quando
 * aparece, título/totais/linhas, o colapso de 4 linhas com expandir/recolher e
 * a formatação pt-BR dos contadores.
 *
 * Também cobrimos a ação de cada linha (WORKBENCH §7.2): com `workspaceId`, o
 * clique abre o diff do arquivo como aba central via `uiStore` — reusando o
 * `knownDiff` do modelo ou deixando o `null` para o `CodeDiffView` buscar.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useUiStore } from '@/lib/store';
import type { ChatMessage, FileChangeKind, ToolCallRecord } from '@/lib/types';

// O barrel de stores importa a superfície Tauri; o card só grava o alvo no
// `uiStore` (o IPC do diff acontece depois, no `CodeDiffView`).
vi.mock('@/lib/api', () => ({ api: {} }));

import { CodeTurnSummary } from './CodeTurnSummary';

const DIFF = '@@ -1 +1 @@\n-antes\n+depois';

function fileChange(
  path: string,
  added: number,
  removed: number,
  change: FileChangeKind = 'modified',
  diff?: string,
): ToolCallRecord {
  return {
    id: `call-${path}`,
    name: 'edit_file',
    arguments: '{}',
    status: 'done',
    presentation: {
      kind: 'file_change',
      path,
      change,
      added,
      removed,
      ...(diff ? { diff } : {}),
    },
  };
}

function assistantMessage(toolCalls: ToolCallRecord[] = []): ChatMessage {
  return {
    id: 'assistant-1',
    conversationId: 'conversation-1',
    role: 'assistant',
    content: 'Pronto.',
    status: 'complete',
    toolCalls,
    citations: [],
    attachments: [],
    createdAt: 1,
  };
}

const summaryGroup = () => screen.queryByRole('group', { name: 'Resumo do turno' });
const rows = () => screen.queryAllByRole('listitem');
const diffButton = (path: string) => screen.queryByRole('button', { name: `Abrir diff de ${path}` });

function resetUi(): void {
  useUiStore.setState({ codeDiffTab: null, codeView: 'session' });
}

afterEach(() => {
  cleanup();
  resetUi();
});

describe('CodeTurnSummary', () => {
  it('não renderiza nada quando o turno não alterou arquivos', () => {
    const message = assistantMessage([
      { id: 'call-1', name: 'read_file', arguments: '{}', status: 'done' },
    ]);
    const { container } = render(<CodeTurnSummary message={message} />);

    expect(container.firstChild).toBeNull();
    expect(summaryGroup()).toBeNull();
  });

  it('mostra título, totais e uma linha por arquivo com os contadores', () => {
    render(
      <CodeTurnSummary
        message={assistantMessage([
          fileChange('src/app.ts', 12, 3),
          fileChange('docs/DESIGN.md', 30, 4, 'created'),
        ])}
      />,
    );

    expect(summaryGroup()).toBeTruthy();
    expect(screen.getByText('2 arquivos alterados')).toBeTruthy();
    // Totais do turno: +12 +30 e −3 −4.
    expect(screen.getByText('+42')).toBeTruthy();
    expect(screen.getByText('−7')).toBeTruthy();

    expect(rows()).toHaveLength(2);
    const [first, second] = rows();
    expect(first.textContent).toContain('docs/DESIGN.md');
    expect(first.textContent).toContain('+30');
    expect(first.textContent).toContain('−4');
    expect(second.textContent).toContain('src/app.ts');
    expect(second.textContent).toContain('+12');
    expect(second.textContent).toContain('−3');
    // O path completo fica no `title` da linha truncada.
    expect(screen.getByTitle('src/app.ts')).toBeTruthy();
  });

  it('usa o singular e os contadores no padrão pt-BR', () => {
    render(<CodeTurnSummary message={assistantMessage([fileChange('src/app.ts', 1234, 98)])} />);

    expect(screen.getByText('1 arquivo alterado')).toBeTruthy();
    // Total do card e contador da linha usam `toLocaleString('pt-BR')`.
    expect(screen.getAllByText('+1.234')).toHaveLength(2);
    expect(screen.getAllByText('−98')).toHaveLength(2);
    expect(rows()).toHaveLength(1);
  });

  it('recolhe em 4 linhas e expande/recolhe os 6 arquivos pelo botão', () => {
    render(
      <CodeTurnSummary
        message={assistantMessage([
          fileChange('a.ts', 1, 0),
          fileChange('b.ts', 1, 0),
          fileChange('c.ts', 1, 0),
          fileChange('d.ts', 1, 0),
          fileChange('e.ts', 1, 0),
          fileChange('f.ts', 1, 0),
        ])}
      />,
    );

    expect(screen.getByText('6 arquivos alterados')).toBeTruthy();
    expect(rows()).toHaveLength(4);
    expect(screen.queryByText('e.ts')).toBeNull();

    const expand = screen.getByRole('button', { name: 'Todos os 6 arquivos' });
    const list = screen.getByRole('list', { name: 'Arquivos alterados' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(expand.getAttribute('aria-controls')).toBe(list.id);

    fireEvent.click(expand);
    expect(rows()).toHaveLength(6);
    expect(screen.getByText('e.ts')).toBeTruthy();
    const collapse = screen.getByRole('button', { name: 'Mostrar menos' });
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    expect(collapse.getAttribute('aria-controls')).toBe(list.id);

    fireEvent.click(collapse);
    expect(rows()).toHaveLength(4);
    const expandAgain = screen.getByRole('button', { name: 'Todos os 6 arquivos' });
    expect(expandAgain.getAttribute('aria-expanded')).toBe('false');
  });

  it('com até 4 arquivos não mostra o botão de expandir', () => {
    render(
      <CodeTurnSummary
        message={assistantMessage([
          fileChange('a.ts', 2, 0),
          fileChange('b.ts', 0, 1),
          fileChange('c.ts', 5, 5),
          fileChange('d.ts', 0, 0),
        ])}
      />,
    );

    expect(rows()).toHaveLength(4);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('abre o diff com o patch conhecido do turno como aba central', () => {
    render(
      <CodeTurnSummary
        workspaceId="ws-1"
        message={assistantMessage([fileChange('src/app.ts', 12, 3, 'modified', DIFF)])}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir diff de src/app.ts' }));

    expect(useUiStore.getState().codeView).toBe('diff');
    expect(useUiStore.getState().codeDiffTab).toEqual({
      workspaceId: 'ws-1',
      path: 'src/app.ts',
      staged: false,
      knownDiff: DIFF,
    });
  });

  it('sem patch no turno abre a aba e deixa o CodeDiffView buscar o diff', () => {
    render(
      <CodeTurnSummary
        workspaceId="ws-1"
        message={assistantMessage([fileChange('src/app.ts', 2, 1)])}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir diff de src/app.ts' }));

    const state = useUiStore.getState();
    expect(state.codeView).toBe('diff');
    expect(state.codeDiffTab).toEqual({
      workspaceId: 'ws-1',
      path: 'src/app.ts',
      staged: false,
      knownDiff: null,
    });
  });

  it('sem workspaceId as linhas continuam informativas e sem botão de diff', () => {
    const message = assistantMessage([fileChange('src/app.ts', 12, 3)]);

    const { rerender } = render(<CodeTurnSummary message={message} />);
    expect(diffButton('src/app.ts')).toBeNull();
    expect(screen.getByText('1 arquivo alterado')).toBeTruthy();
    expect(screen.getByText('src/app.ts')).toBeTruthy();
    // Total do card + contador da linha (mesmo arquivo).
    expect(screen.getAllByText('+12')).toHaveLength(2);
    expect(screen.getAllByText('−3')).toHaveLength(2);

    // `null` e string vazia/em branco também não abrem diff.
    rerender(<CodeTurnSummary message={message} workspaceId={null} />);
    expect(diffButton('src/app.ts')).toBeNull();

    rerender(<CodeTurnSummary message={message} workspaceId="   " />);
    expect(diffButton('src/app.ts')).toBeNull();

    expect(useUiStore.getState().codeDiffTab).toBeNull();
  });
});
