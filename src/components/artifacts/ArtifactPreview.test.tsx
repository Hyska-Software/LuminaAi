// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Artifact, ArtifactContent, ArtifactKind } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  getArtifactPreview: vi.fn(),
  saveArtifact: vi.fn(),
  openArtifact: vi.fn(),
  decodeBase64: vi.fn(),
  loadPdf: vi.fn(),
  renderPdfPage: vi.fn(),
  isPdfRenderCancelled: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    getArtifactPreview: mocks.getArtifactPreview,
    saveArtifact: mocks.saveArtifact,
    openArtifact: mocks.openArtifact,
  },
}));

// The real helper pulls pdf.js + a worker; the panel tests only need its contract.
vi.mock('@/lib/pdf', () => ({
  decodeBase64: mocks.decodeBase64,
  loadPdf: mocks.loadPdf,
  renderPdfPage: mocks.renderPdfPage,
  isPdfRenderCancelled: mocks.isPdfRenderCancelled,
}));

// Imported after the mocks above.
import { ArtifactPreview } from '@/components/artifacts/ArtifactPreview';

afterEach(() => cleanup());

function artifact(kind: ArtifactKind, overrides: Partial<Artifact> = {}): Artifact {
  const extensions: Record<ArtifactKind, string> = {
    markdown: 'md',
    code: 'py',
    text: 'txt',
    html: 'html',
    csv: 'csv',
    json: 'json',
    svg: 'svg',
    image: 'png',
    pdf: 'pdf',
    docx: 'docx',
    xlsx: 'xlsx',
    pptx: 'pptx',
    binary: 'bin',
  };
  return {
    id: `artifact-${kind}`,
    conversationId: 'conv-1',
    name: `arquivo.${extensions[kind]}`,
    mimeType: `application/${kind}`,
    kind,
    size: 2048,
    createdAt: 1,
    ...overrides,
  };
}

function contentFor(
  kind: ArtifactKind,
  overrides: Partial<ArtifactContent> = {},
): ArtifactContent {
  return { artifact: artifact(kind), content: null, dataBase64: null, ...overrides };
}

function pdfContent(): ArtifactContent {
  return contentFor('pdf', { dataBase64: 'JVBERi0xLjQ=' });
}

function pdfHandle(numPages = 2) {
  return {
    pdf: { numPages, getPage: vi.fn() },
    numPages,
    destroy: vi.fn(async () => undefined),
  };
}

function pdfRenderHandle() {
  return {
    promise: Promise.resolve({ width: 612, height: 792, pixelWidth: 612, pixelHeight: 612 }),
    cancel: vi.fn(),
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.decodeBase64.mockReturnValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  mocks.loadPdf.mockResolvedValue(pdfHandle());
  mocks.renderPdfPage.mockImplementation(() => pdfRenderHandle());
  mocks.isPdfRenderCancelled.mockReturnValue(false);
  mocks.getArtifactPreview.mockResolvedValue(null);
  mocks.saveArtifact.mockResolvedValue('/tmp/arquivo');
  mocks.openArtifact.mockResolvedValue(undefined);
});

describe('ArtifactPreview — PDF', () => {
  it('renderiza a primeira página com navegação e zoom', async () => {
    render(<ArtifactPreview content={pdfContent()} />);

    expect(await screen.findByText('Página 1 de 2')).toBeTruthy();
    const canvas = screen.getByRole('img', { name: /Página 1 de 2 do PDF arquivo\.pdf/ });
    expect(canvas.tagName).toBe('CANVAS');
    expect(mocks.decodeBase64).toHaveBeenCalledWith('JVBERi0xLjQ=');
    expect(mocks.loadPdf).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.renderPdfPage).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
    expect(await screen.findByText('Página 2 de 2')).toBeTruthy();
    await waitFor(() =>
      expect(mocks.renderPdfPage).toHaveBeenLastCalledWith(
        expect.anything(),
        2,
        expect.anything(),
        expect.any(Number),
        expect.anything(),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Aumentar zoom' }));
    expect(await screen.findByText('125%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Diminuir zoom' }));
    expect(await screen.findByText('100%')).toBeTruthy();

    // Navigation is disabled at the edges.
    expect(
      (screen.getByRole('button', { name: 'Próxima página' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('mostra o estado de carregamento enquanto o pdf.js não responde', async () => {
    const pending = deferred<ReturnType<typeof pdfHandle>>();
    mocks.loadPdf.mockReturnValue(pending.promise);

    render(<ArtifactPreview content={pdfContent()} />);

    expect(screen.getByText('Carregando PDF…')).toBeTruthy();

    pending.resolve(pdfHandle(1));
    expect(await screen.findByText('Página 1 de 1')).toBeTruthy();
  });

  it('mostra erro e tenta novamente', async () => {
    mocks.loadPdf
      .mockRejectedValueOnce(new Error('PDF corrompido'))
      .mockResolvedValueOnce(pdfHandle(1));

    render(<ArtifactPreview content={pdfContent()} />);

    expect(await screen.findByText('Não foi possível renderizar o PDF')).toBeTruthy();
    expect(screen.getByText('PDF corrompido')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByText('Página 1 de 1')).toBeTruthy();
    expect(mocks.loadPdf).toHaveBeenCalledTimes(2);
  });

  it('cai no cartão binário quando o PDF não tem dados', () => {
    render(<ArtifactPreview content={contentFor('pdf')} />);

    expect(screen.getByText(/prévia não disponível/)).toBeTruthy();
    expect(screen.getByText(/veio sem os dados/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar como…' })).toBeTruthy();
    expect(mocks.loadPdf).not.toHaveBeenCalled();
  });
});

describe('ArtifactPreview — DOCX', () => {
  it('renderiza o HTML do backend no iframe sandbox', async () => {
    mocks.getArtifactPreview.mockResolvedValue({
      kind: 'docx',
      html: '<h1>Contrato de serviços</h1><p>Partes: ACME</p>',
    });

    render(<ArtifactPreview content={contentFor('docx')} />);

    const frame = (await screen.findByTitle('arquivo.docx')) as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('srcdoc')).toContain('Contrato de serviços');
    expect(mocks.getArtifactPreview).toHaveBeenCalledWith('artifact-docx');
  });

  it('mostra carregamento enquanto a prévia é convertida', () => {
    mocks.getArtifactPreview.mockReturnValue(new Promise(() => undefined));

    render(<ArtifactPreview content={contentFor('docx')} />);

    expect(screen.getByText('Carregando documento…')).toBeTruthy();
  });

  it('mostra erro e tenta novamente', async () => {
    mocks.getArtifactPreview
      .mockRejectedValueOnce(new Error('Falha ao converter o DOCX'))
      .mockResolvedValueOnce({ kind: 'docx', html: '<p>Depois da nova tentativa</p>' });

    render(<ArtifactPreview content={contentFor('docx')} />);

    expect(await screen.findByText('Não foi possível carregar a prévia')).toBeTruthy();
    expect(screen.getByText('Falha ao converter o DOCX')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    const frame = (await screen.findByTitle('arquivo.docx')) as HTMLIFrameElement;
    expect(frame.getAttribute('srcdoc')).toContain('Depois da nova tentativa');
    expect(mocks.getArtifactPreview).toHaveBeenCalledTimes(2);
  });

  it('cai no cartão binário quando a prévia é unsupported', async () => {
    mocks.getArtifactPreview.mockResolvedValue({
      kind: 'unsupported',
      reason: 'Arquivo DOCX corrompido.',
    });

    render(<ArtifactPreview content={contentFor('docx')} />);

    expect(await screen.findByText('Arquivo DOCX corrompido.')).toBeTruthy();
    expect(screen.getByText(/prévia não disponível/)).toBeTruthy();
  });
});

describe('ArtifactPreview — XLSX', () => {
  function xlsxPreview() {
    return {
      kind: 'xlsx',
      sheets: [
        {
          name: 'Vendas',
          rows: [
            ['Mês', 'Receita'],
            ['Julho', '1410000'],
          ],
          truncated: false,
        },
        {
          name: 'Resumo',
          rows: [
            ['Total', '=SUM(B2:B3)'],
            ['', ''],
          ],
          truncated: true,
        },
      ],
    };
  }

  it('mostra abas com aria-selected, grade e alinhamento numérico', async () => {
    mocks.getArtifactPreview.mockResolvedValue(xlsxPreview());

    render(<ArtifactPreview content={contentFor('xlsx')} />);

    const vendasTab = await screen.findByRole('tab', { name: 'Vendas' });
    const resumoTab = screen.getByRole('tab', { name: 'Resumo' });
    expect(vendasTab.getAttribute('aria-selected')).toBe('true');
    expect(resumoTab.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tablist', { name: 'Planilhas do arquivo' })).toBeTruthy();

    const numeric = screen.getByText('1410000');
    expect(numeric.className).toContain('text-right');
    expect(screen.getByText('Julho')).toBeTruthy();
    expect(screen.queryByText(/Prévia truncada/)).toBeNull();

    fireEvent.click(resumoTab);
    expect(await screen.findByText(/Prévia truncada/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Resumo' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Vendas' }).getAttribute('aria-selected')).toBe('false');
  });

  it('navega entre abas pelo teclado', async () => {
    mocks.getArtifactPreview.mockResolvedValue(xlsxPreview());

    render(<ArtifactPreview content={contentFor('xlsx')} />);

    const vendasTab = await screen.findByRole('tab', { name: 'Vendas' });
    fireEvent.keyDown(vendasTab, { key: 'ArrowRight' });

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Resumo' }).getAttribute('aria-selected')).toBe(
        'true',
      ),
    );
  });

  it('avisa quando a planilha está vazia', async () => {
    mocks.getArtifactPreview.mockResolvedValue({
      kind: 'xlsx',
      sheets: [{ name: 'Vazia', rows: [], truncated: false }],
    });

    render(<ArtifactPreview content={contentFor('xlsx')} />);

    expect(await screen.findByText('Planilha vazia.')).toBeTruthy();
  });

  it('avisa quando não há abas', async () => {
    mocks.getArtifactPreview.mockResolvedValue({ kind: 'xlsx', sheets: [] });

    render(<ArtifactPreview content={contentFor('xlsx')} />);

    expect(await screen.findByText('Planilha sem abas para exibir.')).toBeTruthy();
  });

  it('cai no cartão binário quando a prévia é unsupported', async () => {
    mocks.getArtifactPreview.mockResolvedValue({
      kind: 'unsupported',
      reason: 'Planilha protegida por senha.',
    });

    render(<ArtifactPreview content={contentFor('xlsx')} />);

    expect(await screen.findByText('Planilha protegida por senha.')).toBeTruthy();
    expect(screen.getByText(/prévia não disponível/)).toBeTruthy();
  });
});

describe('ArtifactPreview — PPTX', () => {
  it('mostra cartões numerados com título, bullets e notas', async () => {
    mocks.getArtifactPreview.mockResolvedValue({
      kind: 'pptx',
      slides: [
        {
          index: 1,
          texts: ['Relatório Q3', 'Receita cresceu 12%', 'Meta atingida'],
          notes: 'Falar sobre a margem.',
        },
        { index: 2, texts: [], notes: null },
      ],
    });

    render(<ArtifactPreview content={contentFor('pptx')} />);

    expect(await screen.findByText(/Prévia simplificada/)).toBeTruthy();
    expect(screen.getByText('Slide 1')).toBeTruthy();
    expect(screen.getByText('Relatório Q3')).toBeTruthy();
    expect(screen.getByText('Receita cresceu 12%')).toBeTruthy();
    expect(screen.getByText(/Falar sobre a margem/)).toBeTruthy();
    expect(screen.getByText('Slide 2')).toBeTruthy();
    expect(screen.getByText('Slide sem texto')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Slides da apresentação' })).toBeTruthy();
  });

  it('avisa quando não há slides', async () => {
    mocks.getArtifactPreview.mockResolvedValue({ kind: 'pptx', slides: [] });

    render(<ArtifactPreview content={contentFor('pptx')} />);

    expect(await screen.findByText('Apresentação sem slides para exibir.')).toBeTruthy();
  });

  it('cai no cartão binário quando a prévia é unsupported', async () => {
    mocks.getArtifactPreview.mockResolvedValue({
      kind: 'unsupported',
      reason: 'Apresentação corrompida.',
    });

    render(<ArtifactPreview content={contentFor('pptx')} />);

    expect(await screen.findByText('Apresentação corrompida.')).toBeTruthy();
    expect(screen.getByText(/prévia não disponível/)).toBeTruthy();
  });
});

describe('ArtifactPreview — mídia e texto', () => {
  it('renderiza imagens via data URL', () => {
    render(
      <ArtifactPreview
        content={contentFor('image', {
          artifact: artifact('image', { name: 'grafico.png', mimeType: 'image/png' }),
          dataBase64: 'aGVsbG8=',
        })}
      />,
    );

    const image = screen.getByRole('img', { name: 'grafico.png' }) as HTMLImageElement;
    expect(image.src).toBe('data:image/png;base64,aGVsbG8=');
  });

  it('mantém o cartão binário para arquivos sem prévia', () => {
    render(<ArtifactPreview content={contentFor('binary')} />);

    expect(screen.getByText(/prévia não disponível/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir' })).toBeTruthy();
  });
});
