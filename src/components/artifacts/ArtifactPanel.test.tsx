// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Artifact } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  getArtifactContent: vi.fn(),
  saveArtifact: vi.fn(),
  openArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
  decodeBase64: vi.fn(),
  loadPdf: vi.fn(),
  renderPdfPage: vi.fn(),
  isPdfRenderCancelled: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    getArtifactContent: mocks.getArtifactContent,
    saveArtifact: mocks.saveArtifact,
    openArtifact: mocks.openArtifact,
    deleteArtifact: mocks.deleteArtifact,
  },
}));

// O painel importa ArtifactPreview, que carrega o pdf.js real; o contrato basta.
vi.mock('@/lib/pdf', () => ({
  decodeBase64: mocks.decodeBase64,
  loadPdf: mocks.loadPdf,
  renderPdfPage: mocks.renderPdfPage,
  isPdfRenderCancelled: mocks.isPdfRenderCancelled,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// Imported after the mocks above.
import { ArtifactPanel } from '@/components/artifacts/ArtifactPanel';
import { useUiStore } from '@/lib/store';

afterEach(() => cleanup());

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

function otherArtifact(): Artifact {
  return artifact({
    id: 'a-2',
    name: 'vendas.csv',
    mimeType: 'text/csv',
    kind: 'csv',
    language: 'csv',
    size: 512,
    createdAt: 2,
  });
}

function resetStore(): void {
  useUiStore.setState({
    artifactPanelOpen: true,
    artifactPanelView: 'list',
    activeArtifactId: null,
    artifacts: [],
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  resetStore();
  mocks.getArtifactContent.mockImplementation((id: string) => {
    const found = useUiStore.getState().artifacts.find((entry) => entry.id === id) ?? artifact();
    return Promise.resolve({ artifact: found, content: 'conteúdo do artefato', dataBase64: null });
  });
  mocks.saveArtifact.mockResolvedValue('/tmp/arquivo');
  mocks.openArtifact.mockResolvedValue(undefined);
  mocks.deleteArtifact.mockResolvedValue(undefined);
  mocks.isPdfRenderCancelled.mockReturnValue(false);
});

describe('ArtifactPanel — modo lista', () => {
  it('mostra os artefatos com título, badge de contagem e rodapé', () => {
    useUiStore.setState({ artifacts: [artifact(), otherArtifact()] });

    render(<ArtifactPanel />);

    const heading = screen.getByRole('heading', { name: 'Artefatos' });
    expect(heading).toBeTruthy();
    const header = heading.closest('header');
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByText('2')).toBeTruthy();
    expect(screen.getByText('relatorio.md')).toBeTruthy();
    expect(screen.getByText('vendas.csv')).toBeTruthy();
    expect(screen.getByText('2 artefatos')).toBeTruthy();
    // O modo lista não carrega conteúdo de artefato.
    expect(mocks.getArtifactContent).not.toHaveBeenCalled();
  });

  it('mostra o estado vazio discreto quando não há artefatos', () => {
    render(<ArtifactPanel />);

    expect(screen.getByRole('heading', { name: 'Artefatos' })).toBeTruthy();
    expect(screen.getByText('Nenhum artefato nesta conversa')).toBeTruthy();
    expect(screen.getByText(/Quando o modelo criar um arquivo/)).toBeTruthy();
    expect(screen.getByText('0 artefatos')).toBeTruthy();
  });

  it('fecha o painel pelo botão do header no modo lista', () => {
    useUiStore.setState({ artifacts: [artifact()] });
    render(<ArtifactPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Fechar painel de artefatos' }));

    expect(useUiStore.getState().artifactPanelOpen).toBe(false);
  });
});

describe('ArtifactPanel — modo preview', () => {
  it('mantém as ações anteriores e adiciona "Ver lista"', async () => {
    useUiStore.setState({
      artifacts: [artifact(), otherArtifact()],
      activeArtifactId: 'a-1',
      artifactPanelView: 'preview',
    });

    render(<ArtifactPanel />);

    expect(await screen.findByRole('heading', { name: 'relatorio.md' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ver lista de artefatos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Artefato anterior' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Próximo artefato' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar como…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir no aplicativo padrão' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Excluir artefato' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fechar painel de artefatos' })).toBeTruthy();
  });

  it('clicar em "Abrir" na lista entra na prévia e carrega o conteúdo', async () => {
    useUiStore.setState({ artifacts: [artifact(), otherArtifact()] });
    render(<ArtifactPanel />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Abrir' })[1]!);

    expect(await screen.findByRole('heading', { name: 'vendas.csv' })).toBeTruthy();
    await waitFor(() => expect(mocks.getArtifactContent).toHaveBeenCalledWith('a-2'));
    expect(useUiStore.getState()).toMatchObject({
      artifactPanelView: 'preview',
      activeArtifactId: 'a-2',
      artifactPanelOpen: true,
    });
  });

  it('"Ver lista" volta para a lista destacando o artefato ativo', async () => {
    useUiStore.setState({
      artifacts: [artifact(), otherArtifact()],
      activeArtifactId: 'a-1',
      artifactPanelView: 'preview',
    });
    const { container } = render(<ArtifactPanel />);

    expect(await screen.findByRole('heading', { name: 'relatorio.md' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ver lista de artefatos' }));

    expect(await screen.findByRole('heading', { name: 'Artefatos' })).toBeTruthy();
    expect(useUiStore.getState().artifactPanelView).toBe('list');
    const active = container.querySelectorAll('[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain('relatorio.md');
  });

  it('cai para a lista quando a view é preview mas não há artefato ativo', () => {
    useUiStore.setState({
      artifacts: [artifact()],
      activeArtifactId: null,
      artifactPanelView: 'preview',
    });

    render(<ArtifactPanel />);

    expect(screen.getByRole('heading', { name: 'Artefatos' })).toBeTruthy();
    expect(screen.getByText('relatorio.md')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ver lista de artefatos' })).toBeNull();
  });
});

describe('ArtifactPanel — exclusão', () => {
  it('excluir o artefato ativo seleciona o próximo da lista', async () => {
    useUiStore.setState({
      artifacts: [artifact(), otherArtifact()],
      activeArtifactId: 'a-2',
      artifactPanelView: 'preview',
    });
    render(<ArtifactPanel />);

    expect(await screen.findByRole('heading', { name: 'vendas.csv' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir artefato' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(mocks.deleteArtifact).toHaveBeenCalledWith('a-2'));
    await waitFor(() =>
      expect(useUiStore.getState()).toMatchObject({
        artifactPanelView: 'preview',
        activeArtifactId: 'a-1',
      }),
    );
    expect(await screen.findByRole('heading', { name: 'relatorio.md' })).toBeTruthy();
  });

  it('excluir o último artefato fecha o painel', async () => {
    useUiStore.setState({
      artifacts: [artifact()],
      activeArtifactId: 'a-1',
      artifactPanelView: 'preview',
    });
    render(<ArtifactPanel />);

    expect(await screen.findByRole('heading', { name: 'relatorio.md' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir artefato' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(mocks.deleteArtifact).toHaveBeenCalledWith('a-1'));
    await waitFor(() => expect(useUiStore.getState().artifactPanelOpen).toBe(false));
    expect(useUiStore.getState().artifacts).toHaveLength(0);
  });
});
