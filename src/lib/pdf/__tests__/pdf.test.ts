// @vitest-environment node
/**
 * These tests run in the plain Node environment: no DOM, no canvas and no
 * worker. `loadPdf` still works because pdf.js falls back to its "fake worker"
 * on Node; rendering to a canvas is covered with a fake canvas/page (jsdom has
 * no 2D context either, so the real rasterization is verified by `pnpm build`
 * + the desktop app).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  decodeBase64,
  isPdfRenderCancelled,
  loadPdf,
  renderPdfPage,
} from '..';

const FIXTURE = new URL('../../../../src-tauri/src/documents/testdata/contrato-servicos.pdf', import.meta.url);
const fixtureBytes = new Uint8Array(readFileSync(FIXTURE));

describe('decodeBase64', () => {
  it('decodifica o fixture PDF byte a byte', () => {
    const decoded = decodeBase64(Buffer.from(fixtureBytes).toString('base64'));

    expect(decoded.length).toBe(fixtureBytes.length);
    expect(Array.from(decoded.slice(0, 8))).toEqual(Array.from(fixtureBytes.slice(0, 8)));
  });

  it('aceita data URL e quebras de linha', () => {
    const base64 = Buffer.from('PDF de teste', 'utf8').toString('base64');
    const wrapped = `data:application/pdf;base64,${base64.slice(0, 4)}\n${base64.slice(4)}`;

    expect(Buffer.from(decodeBase64(wrapped)).toString('utf8')).toBe('PDF de teste');
  });

  it('rejeita payload vazio', () => {
    expect(() => decodeBase64('   ')).toThrow(/sem dados/i);
  });
});

describe('loadPdf', () => {
  it('carrega o fixture real com 2 páginas', async () => {
    const handle = await loadPdf(fixtureBytes);

    try {
      expect(handle.numPages).toBe(2);
      const page = await handle.pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      expect(viewport.width).toBe(612);
      expect(viewport.height).toBe(792);
    } finally {
      await handle.destroy();
    }
  }, 20_000);

  it('rejeita um arquivo que não é PDF', async () => {
    await expect(loadPdf(new TextEncoder().encode('isto não é um PDF'))).rejects.toBeTruthy();
  });
});

interface FakeRenderTask {
  promise: Promise<void>;
  cancel: () => void;
}

function fakeCanvas() {
  const canvas = {
    width: 0,
    height: 0,
    style: {} as CSSStyleDeclaration,
  };
  return canvas as unknown as HTMLCanvasElement;
}

function fakePdf(render: (params: unknown) => FakeRenderTask) {
  const getViewport = vi.fn(() => ({ width: 612, height: 792 }));
  const getPage = vi.fn(async () => ({ getViewport, render }));
  return { pdf: { getPage } as unknown as PDFDocumentProxy, getPage, getViewport };
}

describe('renderPdfPage', () => {
  it('dimensiona o canvas pelo devicePixelRatio e aplica o transform', async () => {
    const render = vi.fn(
      (): FakeRenderTask => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    );
    const { pdf } = fakePdf(render);
    const canvas = fakeCanvas();

    const handle = renderPdfPage(pdf, 1, canvas, 1, { devicePixelRatio: 2 });
    const rendered = await handle.promise;

    expect(rendered).toEqual({ width: 612, height: 792, pixelWidth: 1224, pixelHeight: 1584 });
    expect(canvas.width).toBe(1224);
    expect(canvas.height).toBe(1584);
    expect(canvas.style.width).toBe('612px');
    expect(canvas.style.height).toBe('792px');
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({ canvas, transform: [2, 0, 0, 2, 0, 0] }),
    );
  });

  it('não aplica transform quando o pixel ratio é 1', async () => {
    const render = vi.fn(
      (_params: unknown): FakeRenderTask => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    );
    const { pdf } = fakePdf(render);

    await renderPdfPage(pdf, 2, fakeCanvas(), 1.5, { devicePixelRatio: 1 }).promise;

    expect(render).toHaveBeenCalledWith(expect.objectContaining({ viewport: { width: 612, height: 792 } }));
    expect(render.mock.calls[0]?.[0]).not.toHaveProperty('transform');
  });

  it('cancelar rejeita a promise e cancela a tarefa do pdf.js', async () => {
    let rejectRender: (error: unknown) => void = () => undefined;
    const taskPromise = new Promise<void>((_resolve, reject) => {
      rejectRender = reject;
    });
    const cancel = vi.fn(() => {
      const error = new Error('render cancelled');
      error.name = 'RenderingCancelledException';
      rejectRender(error);
    });
    const render = vi.fn((): FakeRenderTask => ({ promise: taskPromise, cancel }));
    const { pdf } = fakePdf(render);

    const handle = renderPdfPage(pdf, 1, fakeCanvas(), 1, { devicePixelRatio: 1 });
    await vi.waitFor(() => expect(render).toHaveBeenCalled());
    handle.cancel();

    await expect(handle.promise).rejects.toSatisfy(isPdfRenderCancelled);
    expect(cancel).toHaveBeenCalled();
  });

  it('cancelar antes do getPage resolver evita o render', async () => {
    let resolvePage: (page: unknown) => void = () => undefined;
    const pagePromise = new Promise<unknown>((resolve) => {
      resolvePage = resolve;
    });
    const render = vi.fn((): FakeRenderTask => ({ promise: Promise.resolve(), cancel: vi.fn() }));
    const pdf = { getPage: vi.fn(() => pagePromise) } as unknown as PDFDocumentProxy;

    const handle = renderPdfPage(pdf, 1, fakeCanvas(), 1, { devicePixelRatio: 1 });
    handle.cancel();
    resolvePage({ getViewport: () => ({ width: 612, height: 792 }), render });

    await expect(handle.promise).rejects.toSatisfy(isPdfRenderCancelled);
    expect(render).not.toHaveBeenCalled();
  });
});

describe('isPdfRenderCancelled', () => {
  it('reconhece cancelamento do pdf.js e erros comuns', () => {
    const cancelled = new Error('cancelled');
    cancelled.name = 'RenderingCancelledException';

    expect(isPdfRenderCancelled(cancelled)).toBe(true);
    expect(isPdfRenderCancelled(new Error('falha real'))).toBe(false);
    expect(isPdfRenderCancelled(null)).toBe(false);
    expect(isPdfRenderCancelled('cancelled')).toBe(false);
  });
});
