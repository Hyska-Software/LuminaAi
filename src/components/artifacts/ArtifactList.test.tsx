// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Artifact } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  saveArtifact: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: { saveArtifact: mocks.saveArtifact } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// Imported after the mocks above.
import { ArtifactList } from '@/components/artifacts/ArtifactList';
import { useUiStore } from '@/lib/store';

afterEach(() => cleanup());

beforeEach(() => {
  vi.resetAllMocks();
  mocks.saveArtifact.mockResolvedValue('/tmp/arquivo');
  useUiStore.setState({
    artifactPanelOpen: false,
    artifactPanelView: 'list',
    activeArtifactId: null,
    artifacts: [],
  });
});

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'a-1',
    conversationId: 'conv-1',
    name: 'relatorio.md',
    mimeType: 'text/markdown',
    kind: 'markdown',
    language: 'markdown',
    size: 2048,
    createdAt: 1,
    ...overrides,
  };
}

function fixture(): Artifact[] {
  return [
    artifact(),
    artifact({
      id: 'a-2',
      name: 'vendas.csv',
      mimeType: 'text/csv',
      kind: 'csv',
      language: 'csv',
      size: 512,
      createdAt: 2,
    }),
  ];
}

describe('ArtifactList', () => {
  it('renderiza um card compacto por artefato', () => {
    render(<ArtifactList artifacts={fixture()} />);

    expect(screen.getByText('relatorio.md')).toBeTruthy();
    expect(screen.getByText('vendas.csv')).toBeTruthy();
    expect(screen.getByText(/Markdown · 2 KB/)).toBeTruthy();
    expect(screen.getByText(/CSV · 512 B/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Abrir' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Salvar vendas.csv como…' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Artefatos da conversa' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('destaca apenas o artefato ativo', () => {
    const { container } = render(<ArtifactList artifacts={fixture()} activeId="a-2" />);

    const active = container.querySelectorAll('[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain('vendas.csv');
  });

  it('usa onSelect quando fornecido, sem abrir a prévia no store', () => {
    const onSelect = vi.fn();
    render(<ArtifactList artifacts={fixture()} onSelect={onSelect} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Abrir' })[0]!);

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a-1' }));
    expect(useUiStore.getState().activeArtifactId).toBeNull();
  });

  it('sem onSelect, abre a prévia pelo store (comportamento do card)', () => {
    render(<ArtifactList artifacts={fixture()} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Abrir' })[1]!);

    expect(useUiStore.getState()).toMatchObject({
      activeArtifactId: 'a-2',
      artifactPanelView: 'preview',
      artifactPanelOpen: true,
    });
  });

  it('mostra o estado vazio quando não há artefatos', () => {
    render(<ArtifactList artifacts={[]} />);

    expect(screen.getByText('Nenhum artefato nesta conversa')).toBeTruthy();
    expect(screen.getByText(/Quando o modelo criar um arquivo/)).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
