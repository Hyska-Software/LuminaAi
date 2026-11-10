// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkspaceFileContent } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  readWorkspaceFile: vi.fn(),
  getFileDiffHead: vi.fn(),
  openWorkspaceInExplorer: vi.fn(),
  decodeBase64: vi.fn(),
  loadPdf: vi.fn(),
  renderPdfPage: vi.fn(),
  isPdfRenderCancelled: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    readWorkspaceFile: mocks.readWorkspaceFile,
    getFileDiffHead: mocks.getFileDiffHead,
    openWorkspaceInExplorer: mocks.openWorkspaceInExplorer,
  },
}));

// O helper real carrega pdf.js + worker; aqui só interessa o contrato do viewer.
vi.mock('@/lib/pdf', () => ({
  decodeBase64: mocks.decodeBase64,
  loadPdf: mocks.loadPdf,
  renderPdfPage: mocks.renderPdfPage,
  isPdfRenderCancelled: mocks.isPdfRenderCancelled,
}));

import { CodeFileView } from './CodeFileView';

function fileContent(overrides: Partial<WorkspaceFileContent> = {}): WorkspaceFileContent {
  return {
    path: 'src/app.ts',
    text: 'const total = 1;\nexport default total;\n',
    truncated: false,
    size: 48,
    ...overrides,
  };
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
    promise: Promise.resolve({ width: 612, height: 792, pixelWidth: 612, pixelHeight: 792 }),
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

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  // O conteúdo devolvido espelha o caminho pedido (como o backend real).
  mocks.readWorkspaceFile.mockImplementation(async (_workspaceId: string, path: string) =>
    fileContent({ path }),
  );
  mocks.getFileDiffHead.mockResolvedValue('');
  mocks.openWorkspaceInExplorer.mockResolvedValue(undefined);
  mocks.decodeBase64.mockReturnValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  mocks.loadPdf.mockResolvedValue(pdfHandle());
  mocks.renderPdfPage.mockImplementation(() => pdfRenderHandle());
  mocks.isPdfRenderCancelled.mockReturnValue(false);
});

describe('CodeFileView', () => {
  it('carrega o arquivo do workspace e renderiza o código com highlight', async () => {
    render(<CodeFileView target={{ workspaceId: 'ws-1', path: 'src/app.ts' }} />);

    expect(screen.getByRole('status', { name: 'Carregando arquivo' })).toBeTruthy();
    expect(await screen.findByLabelText('Conteúdo de src/app.ts')).toBeTruthy();
    expect(mocks.readWorkspaceFile).toHaveBeenCalledWith('ws-1', 'src/app.ts');
    expect(screen.getByText('src/app.ts')).toBeTruthy();
    expect(screen.getByText('TypeScript')).toBeTruthy();
  });

  it('carrega o diff contra HEAD e renderiza as marcas inline', async () => {
    mocks.readWorkspaceFile.mockResolvedValue(
      fileContent({ path: 'src/app.ts', text: 'a\nc\n' }),
    );
    mocks.getFileDiffHead.mockResolvedValue('@@ -1,2 +1,2 @@\n a\n-b\n+c');

    render(<CodeFileView target={{ workspaceId: 'ws-1', path: 'src/app.ts' }} />);

    expect(await screen.findByLabelText('Conteúdo de src/app.ts')).toBeTruthy();
    expect(mocks.getFileDiffHead).toHaveBeenCalledWith('ws-1', 'src/app.ts');
    expect(await screen.findByLabelText('Adições: 1, remoções: 1')).toBeTruthy();

    const pre = screen.getByLabelText('Conteúdo de src/app.ts');
    expect(pre.querySelector('[data-diff-tone="modified"]')?.textContent).toContain('c');
    expect(screen.getByRole('note', { name: '1 linha removida aqui' })).toBeTruthy();
  });

  it('mantém o conteúdo quando o diff falha e mostra o aviso', async () => {
    mocks.getFileDiffHead.mockRejectedValueOnce('EXEC_FAILED: git falhou');

    render(<CodeFileView target={{ workspaceId: 'ws-1', path: 'src/app.ts' }} />);

    expect(await screen.findByLabelText('Conteúdo de src/app.ts')).toBeTruthy();
    expect(
      await screen.findByRole('img', { name: 'Não foi possível carregar as alterações' }),
    ).toBeTruthy();
  });

  it('descarta a resposta velha do diff quando o alvo muda', async () => {
    const pending = deferred<string>();
    mocks.getFileDiffHead
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce('');

    const { rerender } = render(
      <CodeFileView target={{ workspaceId: 'ws-1', path: 'src/velho.ts' }} />,
    );
    rerender(<CodeFileView target={{ workspaceId: 'ws-1', path: 'src/novo.ts' }} />);

    expect(await screen.findByLabelText('Conteúdo de src/novo.ts')).toBeTruthy();

    await act(async () => {
      pending.resolve('@@ -1 +1 @@\n-a\n+b');
      await pending.promise;
    });

    expect(screen.queryByText('+1')).toBeNull();
    expect(screen.getByLabelText('Conteúdo de src/novo.ts')).toBeTruthy();
  });

  it('mostra erro de leitura e tenta novamente', async () => {
    mocks.readWorkspaceFile.mockRejectedValueOnce('FS_NOT_FOUND: arquivo removido');
    render(<CodeFileView target={{ workspaceId: 'ws-1', path: 'src/sumiu.ts' }} />);

    expect(await screen.findByText('Não foi possível abrir o arquivo')).toBeTruthy();
    expect(screen.getByText(/FS_NOT_FOUND/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByLabelText('Conteúdo de src/sumiu.ts')).toBeTruthy();
    expect(mocks.readWorkspaceFile).toHaveBeenCalledTimes(2);
  });

  it('recarrega o arquivo pelo botão do cabeçalho', async () => {
    render(<CodeFileView target={{ workspaceId: 'ws-1', path: 'src/app.ts' }} />);
    await screen.findByLabelText('Conteúdo de src/app.ts');

    fireEvent.click(screen.getByRole('button', { name: 'Recarregar arquivo' }));

    await waitFor(() => expect(mocks.readWorkspaceFile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.getFileDiffHead).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByLabelText('Conteúdo de src/app.ts')).toBeTruthy(),
    );
  });

  it('abre o arquivo no editor externo (ação do workspace)', async () => {
    render(<CodeFileView target={{ workspaceId: 'ws-1', path: 'src/app.ts' }} />);
    await screen.findByLabelText('Conteúdo de src/app.ts');

    fireEvent.click(screen.getByRole('button', { name: 'Abrir no editor externo' }));

    expect(mocks.openWorkspaceInExplorer).toHaveBeenCalledWith('ws-1');
  });

  it('renderiza a prévia real de imagem', async () => {
    mocks.readWorkspaceFile.mockResolvedValue(
      fileContent({
        path: 'assets/logo.png',
        text: '',
        binary: true,
        size: 2048,
        mimeType: 'image/png',
        dataBase64: 'iVBORw0KGgo=',
      }),
    );

    render(<CodeFileView target={{ workspaceId: 'ws-1', path: 'assets/logo.png' }} />);

    expect(await screen.findByRole('toolbar', { name: 'Controles da imagem' })).toBeTruthy();
    const image = screen.getByAltText('assets/logo.png') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(screen.getByText('PNG')).toBeTruthy();
  });

  it('renderiza o PDF com pdf.js na aba central', async () => {
    mocks.readWorkspaceFile.mockResolvedValue(
      fileContent({
        path: 'docs/manual.pdf',
        text: '',
        binary: true,
        size: 4096,
        mimeType: 'application/pdf',
        dataBase64: 'JVBERi0xLjQ=',
      }),
    );

    render(<CodeFileView target={{ workspaceId: 'ws-1', path: 'docs/manual.pdf' }} />);

    expect(await screen.findByText('Página 1 de 2')).toBeTruthy();
    expect(mocks.readWorkspaceFile).toHaveBeenCalledWith('ws-1', 'docs/manual.pdf');
    expect(
      screen.getByRole('img', { name: 'Página 1 de 2 do PDF docs/manual.pdf' }).tagName,
    ).toBe('CANVAS');
  });

  it('mostra cartão honesto quando o backend omitiu o payload', async () => {
    mocks.readWorkspaceFile.mockResolvedValue(
      fileContent({
        path: 'docs/imenso.pdf',
        text: '',
        binary: true,
        size: 30 * 1024 * 1024,
        mimeType: 'application/pdf',
        previewOmitted: true,
      }),
    );

    render(<CodeFileView target={{ workspaceId: 'ws-1', path: 'docs/imenso.pdf' }} />);

    expect(await screen.findByText('Prévia não disponível')).toBeTruthy();
    expect(screen.getByText(/30 MB/)).toBeTruthy();
    expect(mocks.loadPdf).not.toHaveBeenCalled();
  });

  it('descarta a resposta velha quando o alvo muda com uma requisição em voo', async () => {
    const pending = deferred<WorkspaceFileContent>();
    mocks.readWorkspaceFile
      .mockImplementationOnce(() => pending.promise)
      .mockImplementationOnce(async () => fileContent({ path: 'src/novo.ts' }));

    const { rerender } = render(
      <CodeFileView target={{ workspaceId: 'ws-1', path: 'src/velho.ts' }} />,
    );
    rerender(<CodeFileView target={{ workspaceId: 'ws-1', path: 'src/novo.ts' }} />);

    expect(await screen.findByLabelText('Conteúdo de src/novo.ts')).toBeTruthy();

    // A resposta antiga chega depois: precisa ser ignorada.
    await act(async () => {
      pending.resolve(fileContent({ path: 'src/velho.ts' }));
      await pending.promise;
    });

    expect(mocks.readWorkspaceFile).toHaveBeenCalledTimes(2);
    expect(screen.queryByLabelText('Conteúdo de src/velho.ts')).toBeNull();
    expect(screen.getByLabelText('Conteúdo de src/novo.ts')).toBeTruthy();
  });
});
