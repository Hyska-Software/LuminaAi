// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WorkspaceFileEntry } from '@/lib/types';
import { FileTree } from './FileTree';

const entries: WorkspaceFileEntry[] = [
  {
    path: 'src',
    name: 'src',
    isDir: true,
    depth: 0,
    children: [
      { path: 'src/app.ts', name: 'app.ts', isDir: false, depth: 1, gitStatus: 'M' },
      { path: 'src/util.ts', name: 'util.ts', isDir: false, depth: 1 },
      {
        path: 'src/components',
        name: 'components',
        isDir: true,
        depth: 1,
        children: [{ path: 'src/components/Button.tsx', name: 'Button.tsx', isDir: false, depth: 2 }],
      },
    ],
  },
  { path: 'README.md', name: 'README.md', isDir: false, depth: 0, gitStatus: '?' },
];

function renderTree(overrides: Partial<ComponentProps<typeof FileTree>> = {}) {
  const props = {
    entries,
    onSelectFile: vi.fn(),
    onToggleDir: vi.fn(),
    ...overrides,
  };
  render(<FileTree {...props} />);
  return props;
}

const tree = () => screen.getByRole('tree', { name: 'Árvore de arquivos do workspace' });
const row = (name: string | RegExp) => screen.getByRole('treeitem', { name });

afterEach(cleanup);

describe('FileTree', () => {
  it('renders folders and files with aria-expanded on expanded dirs', () => {
    renderTree();
    expect(row('src').getAttribute('aria-expanded')).toBe('true');
    expect(row(/app\.ts/).getAttribute('aria-level')).toBe('2');
    expect(row(/README\.md/)).toBeTruthy();
  });

  it('expands/collapses a directory and notifies the container', () => {
    const props = renderTree();
    fireEvent.click(row('src'));
    expect(props.onToggleDir).toHaveBeenCalledWith('src');
    expect(row('src').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('treeitem', { name: /app\.ts/ })).toBeNull();
    // Grandchildren of a collapsed folder stay hidden too.
    expect(screen.queryByRole('treeitem', { name: /Button\.tsx/ })).toBeNull();

    fireEvent.click(row('src'));
    expect(props.onToggleDir).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('treeitem', { name: /app\.ts/ })).toBeTruthy();
  });

  it('selects a file on click and marks it with aria-selected', () => {
    const props = renderTree();
    fireEvent.click(row(/app\.ts/));
    expect(props.onSelectFile).toHaveBeenCalledWith('src/app.ts');
    expect(row(/app\.ts/).getAttribute('aria-selected')).toBe('true');
    expect(row(/README\.md/).getAttribute('aria-selected')).toBe('false');
  });

  it('respects a controlled selectedPath', () => {
    renderTree({ selectedPath: 'README.md' });
    expect(row(/README\.md/).getAttribute('aria-selected')).toBe('true');
    expect(row(/app\.ts/).getAttribute('aria-selected')).toBe('false');
  });

  it('filters by name and reports the visible/total count', () => {
    renderTree({ totalCount: 5000 });
    fireEvent.change(screen.getByRole('textbox', { name: 'Filtrar arquivos' }), {
      target: { value: 'BUTTON' },
    });
    expect(screen.queryByRole('treeitem', { name: /README\.md/ })).toBeNull();
    expect(screen.getByRole('treeitem', { name: /Button\.tsx/ })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(
      'Mostrando 1 de 5000 arquivos — refine a busca',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtro' }));
    expect(screen.getByRole('treeitem', { name: /README\.md/ })).toBeTruthy();
  });

  it('shows git state badges with accessible labels', () => {
    renderTree();
    expect(screen.getByLabelText('Estado no Git: Modificado').textContent).toBe('M');
    expect(screen.getByLabelText('Estado no Git: Não rastreado').textContent).toBe('?');
  });

  it('navigates with the keyboard and selects with Enter', () => {
    const props = renderTree();
    fireEvent.keyDown(tree(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(row('src'));
    fireEvent.keyDown(tree(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(row(/app\.ts/));
    fireEvent.keyDown(tree(), { key: 'Enter' });
    expect(props.onSelectFile).toHaveBeenCalledWith('src/app.ts');
  });

  it('collapses with ArrowLeft, expands with ArrowRight and jumps to the parent', () => {
    const props = renderTree();
    fireEvent.keyDown(tree(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(row('src'));
    fireEvent.keyDown(tree(), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(row(/app\.ts/));

    fireEvent.keyDown(tree(), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(row('src'));
    // Expanded dir: ArrowLeft collapses before moving to the parent.
    fireEvent.keyDown(tree(), { key: 'ArrowLeft' });
    expect(props.onToggleDir).toHaveBeenCalledWith('src');
    expect(row('src').getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(tree(), { key: 'ArrowRight' });
    expect(row('src').getAttribute('aria-expanded')).toBe('true');
  });

  it('renders the loading skeleton', () => {
    render(<FileTree entries={[]} loading />);
    expect(screen.getByRole('status', { name: 'Carregando a árvore' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Carregando arquivos' })).toBeTruthy();
  });

  it('renders honest empty and error states', () => {
    const { unmount } = render(<FileTree entries={[]} />);
    expect(screen.getByText('Nenhum arquivo para mostrar')).toBeTruthy();
    unmount();

    render(<FileTree entries={[]} error="Acesso negado à pasta." />);
    expect(screen.getByText('Não foi possível ler a pasta')).toBeTruthy();
    expect(screen.getByText('Acesso negado à pasta.')).toBeTruthy();
  });
});
