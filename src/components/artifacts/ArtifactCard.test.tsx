// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Artifact } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  saveArtifact: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: { saveArtifact: mocks.saveArtifact } }));
vi.mock('sonner', () => ({ toast: toastMocks }));

// Imported after the mocks above.
import { ArtifactCard } from '@/components/artifacts/ArtifactCard';
import { useUiStore } from '@/lib/store';

afterEach(() => cleanup());

beforeEach(() => {
  vi.resetAllMocks();
  mocks.saveArtifact.mockResolvedValue('/tmp/relatorio.md');
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
    messageId: 'assistant-1',
    name: 'relatorio.md',
    mimeType: 'text/markdown',
    kind: 'markdown',
    language: 'markdown',
    size: 2048,
    createdAt: 1,
    ...overrides,
  };
}

describe('ArtifactCard — small card', () => {
  it('mostra nome truncável, subtítulo "tipo · tamanho" e as ações existentes', () => {
    render(<ArtifactCard artifact={artifact()} />);

    const name = screen.getByText('relatorio.md');
    expect(name.className).toContain('truncate');
    expect(name.className).toContain('text-[13px]');
    expect(screen.getByText(/Markdown · 2 KB/)).toBeTruthy();

    // Os mesmos dois botões de antes: "Abrir" e "Salvar como…".
    expect(screen.getByRole('button', { name: 'Abrir' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar relatorio.md como…' })).toBeTruthy();
  });

  it('clique no nome ou em "Abrir" abre a prévia pelo store', () => {
    render(<ArtifactCard artifact={artifact()} />);

    fireEvent.click(screen.getByText('relatorio.md'));

    expect(useUiStore.getState()).toMatchObject({
      activeArtifactId: 'a-1',
      artifactPanelView: 'preview',
      artifactPanelOpen: true,
    });
  });

  it('respeita onOpen sem tocar no store', () => {
    const onOpen = vi.fn();
    const entry = artifact();
    render(<ArtifactCard artifact={entry} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));

    expect(onOpen).toHaveBeenCalledWith(entry);
    expect(useUiStore.getState().activeArtifactId).toBeNull();
  });

  it('salva o artefato com o mesmo comportamento do card anterior', () => {
    render(<ArtifactCard artifact={artifact()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Salvar relatorio.md como…' }));

    expect(mocks.saveArtifact).toHaveBeenCalledWith('a-1', 'relatorio.md');
  });

  it('destaca o artefato ativo quando active é verdadeiro', () => {
    const { container } = render(<ArtifactCard artifact={artifact()} active />);

    const card = container.querySelector('[data-active="true"]');
    expect(card).toBeTruthy();
    expect(card?.textContent).toContain('relatorio.md');
  });

  it('não marca data-active quando inativo', () => {
    const { container } = render(<ArtifactCard artifact={artifact()} />);

    expect(container.querySelector('[data-active="true"]')).toBeNull();
  });
});
