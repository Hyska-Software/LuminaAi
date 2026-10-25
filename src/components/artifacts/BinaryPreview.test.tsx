// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Artifact, ArtifactContent, ArtifactKind } from '@/lib/types';

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
import { BinaryPreview } from '@/components/artifacts/BinaryPreview';

afterEach(() => cleanup());

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getArtifactPreview.mockResolvedValue(null);
  mocks.saveArtifact.mockResolvedValue('/tmp/arquivo.bin');
  mocks.openArtifact.mockResolvedValue(undefined);
});

function artifact(kind: ArtifactKind, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: `artifact-${kind}`,
    conversationId: 'conv-1',
    name: `arquivo.${kind}`,
    mimeType: 'application/octet-stream',
    kind,
    size: 1024,
    createdAt: 1,
    ...overrides,
  };
}

function contentFor(kind: ArtifactKind, overrides: Partial<ArtifactContent> = {}): ArtifactContent {
  return { artifact: artifact(kind), content: null, dataBase64: null, ...overrides };
}

function base64Of(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes));
}

const PDF_PREFIX = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]; // "%PDF-1.4"

describe('BinaryPreview — arquivo binário com hexdump', () => {
  it('mostra formato detectado e os primeiros bytes em hexdump', async () => {
    mocks.getArtifactPreview.mockResolvedValue({
      kind: 'binary',
      format: 'application/pdf',
      previewBase64: base64Of(PDF_PREFIX),
      previewBytes: PDF_PREFIX.length,
    });

    render(<BinaryPreview content={contentFor('binary')} />);

    expect(await screen.findByText('Primeiros 8 bytes')).toBeTruthy();
    expect(screen.getByText('00000000')).toBeTruthy();
    expect(screen.getByText(/25 50 44 46 2d 31 2e 34/)).toBeTruthy();
    expect(screen.getByText(/\|%PDF-1.4\|/)).toBeTruthy();
    expect(screen.getByText(/application\/pdf/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar como…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir' })).toBeTruthy();
    expect(mocks.getArtifactPreview).toHaveBeenCalledWith('artifact-binary');
  });

  it('colapsa e expande o bloco de bytes com aria-expanded', async () => {
    mocks.getArtifactPreview.mockResolvedValue({
      kind: 'binary',
      format: 'application/pdf',
      previewBase64: base64Of(PDF_PREFIX),
      previewBytes: PDF_PREFIX.length,
    });

    render(<BinaryPreview content={contentFor('binary')} />);

    const toggle = await screen.findByRole('button', { name: /Primeiros 8 bytes/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('00000000')).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('00000000')).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByText('00000000')).toBeTruthy();
  });

  it('trunca o hexdump em previewBytes quando o payload é maior', async () => {
    mocks.getArtifactPreview.mockResolvedValue({
      kind: 'binary',
      format: 'application/octet-stream',
      previewBase64: base64Of(PDF_PREFIX),
      previewBytes: 4,
    });

    render(<BinaryPreview content={contentFor('binary')} />);

    expect(await screen.findByText('Primeiros 4 bytes')).toBeTruthy();
    expect(screen.getByText(/25 50 44 46/)).toBeTruthy();
    expect(screen.queryByText(/2d 31 2e 34/)).toBeNull();
  });
});

describe('BinaryPreview — fallback', () => {
  it('mantém o cartão sem prévia quando o backend devolve null', () => {
    render(<BinaryPreview content={contentFor('binary')} />);

    expect(screen.getByText(/prévia não disponível/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Primeiros/ })).toBeNull();
  });

  it('mostra o motivo quando a prévia é unsupported', async () => {
    mocks.getArtifactPreview.mockResolvedValue({
      kind: 'unsupported',
      reason: 'Formato não reconhecido para hexdump.',
    });

    render(<BinaryPreview content={contentFor('binary')} />);

    expect(await screen.findByText('Formato não reconhecido para hexdump.')).toBeTruthy();
    expect(screen.getByText(/prévia não disponível/)).toBeTruthy();
  });

  it('mostra o erro e permite tentar novamente', async () => {
    mocks.getArtifactPreview
      .mockRejectedValueOnce(new Error('Falha ao ler o arquivo'))
      .mockResolvedValueOnce({
        kind: 'binary',
        format: 'application/pdf',
        previewBase64: base64Of(PDF_PREFIX),
        previewBytes: PDF_PREFIX.length,
      });

    render(<BinaryPreview content={contentFor('binary')} />);

    expect(await screen.findByText(/Não foi possível ler os primeiros bytes/)).toBeTruthy();
    expect(screen.getByText(/Falha ao ler o arquivo/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByText('Primeiros 8 bytes')).toBeTruthy();
    expect(mocks.getArtifactPreview).toHaveBeenCalledTimes(2);
  });

  it('não busca preview para outros kinds (fallback de PDF/Office/Markdown)', () => {
    render(
      <BinaryPreview content={contentFor('pdf')} detail="Este PDF veio sem os dados para a prévia." />,
    );

    expect(screen.getByText(/prévia não disponível/)).toBeTruthy();
    expect(screen.getByText('Este PDF veio sem os dados para a prévia.')).toBeTruthy();
    expect(mocks.getArtifactPreview).not.toHaveBeenCalled();
  });
});
