// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Artifact, ArtifactContent } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  getArtifactPreview: vi.fn(),
  saveArtifact: vi.fn(),
  openArtifact: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    getArtifactPreview: mocks.getArtifactPreview,
    saveArtifact: mocks.saveArtifact,
    openArtifact: mocks.openArtifact,
  },
}));

// Imported after the mocks above.
import { ArchivePreview } from '@/components/artifacts/ArchivePreview';

afterEach(() => cleanup());

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getArtifactPreview.mockResolvedValue(null);
  mocks.saveArtifact.mockResolvedValue('/tmp/pacote.zip');
  mocks.openArtifact.mockResolvedValue(undefined);
});

function archiveArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'artifact-archive',
    conversationId: 'conv-1',
    name: 'pacote.zip',
    mimeType: 'application/zip',
    kind: 'archive',
    size: 4096,
    createdAt: 1,
    ...overrides,
  };
}

function archiveContent(overrides: Partial<ArtifactContent> = {}): ArtifactContent {
  return { artifact: archiveArtifact(), content: null, dataBase64: null, ...overrides };
}

const ARCHIVE_PREVIEW = {
  kind: 'archive' as const,
  format: 'zip',
  entries: [
    { name: 'src/main.rs', size: 2048, compressedSize: 512, isDir: false },
    { name: 'src/', size: 0, compressedSize: 0, isDir: true },
  ],
  totalEntries: 2,
  truncated: false,
};

describe('ArchivePreview', () => {
  it('lista as entradas na ordem do backend com resumo de arquivos e tamanho', async () => {
    mocks.getArtifactPreview.mockResolvedValue(ARCHIVE_PREVIEW);

    render(<ArchivePreview content={archiveContent()} />);

    const list = await screen.findByRole('list', { name: 'Entradas do arquivo compactado' });
    const items = Array.from(list.querySelectorAll('li')).map((item) => item.textContent ?? '');
    expect(items[0]).toContain('src/main.rs');
    expect(items[1]).toContain('src/');

    expect(screen.getByText(/1 arquivo · 2 KB · 1 pasta/)).toBeTruthy();
    expect(screen.getByText('ZIP')).toBeTruthy();
    expect(screen.getByTitle('src/main.rs')).toBeTruthy();
    expect(screen.getByText('2 KB')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(mocks.getArtifactPreview).toHaveBeenCalledWith('artifact-archive');
  });

  it('avisa quando a listagem está truncada', async () => {
    mocks.getArtifactPreview.mockResolvedValue({
      ...ARCHIVE_PREVIEW,
      totalEntries: 5,
      truncated: true,
    });

    render(<ArchivePreview content={archiveContent()} />);

    expect(await screen.findByText('Mostrando 2 de 5 entradas')).toBeTruthy();
  });

  it('mostra estado vazio quando o arquivo não tem entradas', async () => {
    mocks.getArtifactPreview.mockResolvedValue({
      kind: 'archive',
      format: 'zip',
      entries: [],
      totalEntries: 0,
      truncated: false,
    });

    render(<ArchivePreview content={archiveContent()} />);

    expect(await screen.findByText('Arquivo compactado vazio.')).toBeTruthy();
  });

  it('mostra loading enquanto a prévia é lida', () => {
    mocks.getArtifactPreview.mockReturnValue(new Promise(() => undefined));

    render(<ArchivePreview content={archiveContent()} />);

    const status = screen.getByRole('status');
    expect(status).toBeTruthy();
    expect(screen.getAllByText('Lendo arquivo compactado…').length).toBeGreaterThan(0);
  });

  it('cai no cartão binário quando o formato é unsupported', async () => {
    mocks.getArtifactPreview.mockResolvedValue({
      kind: 'unsupported',
      reason: 'Formato RAR não suportado; use Salvar/Abrir.',
    });

    render(<ArchivePreview content={archiveContent({ artifact: archiveArtifact({ name: 'dados.rar' }) })} />);

    expect(await screen.findByText('Formato RAR não suportado; use Salvar/Abrir.')).toBeTruthy();
    expect(screen.getByText(/prévia não disponível/)).toBeTruthy();
  });

  it('mostra erro e permite tentar novamente', async () => {
    mocks.getArtifactPreview
      .mockRejectedValueOnce(new Error('ZIP corrompido'))
      .mockResolvedValueOnce(ARCHIVE_PREVIEW);

    render(<ArchivePreview content={archiveContent()} />);

    expect(await screen.findByText('Não foi possível carregar a prévia')).toBeTruthy();
    expect(screen.getByText('ZIP corrompido')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByRole('list', { name: 'Entradas do arquivo compactado' })).toBeTruthy();
    expect(mocks.getArtifactPreview).toHaveBeenCalledTimes(2);
  });
});
