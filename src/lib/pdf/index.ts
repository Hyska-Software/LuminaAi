/**
 * Thin wrapper around `pdfjs-dist` used by the artifact panel.
 *
 * PDF.js is heavy and only needed when a PDF is actually opened, so the module
 * is loaded through a dynamic `import()`. The worker is emitted by Vite as an
 * asset via `?url` and configured on `GlobalWorkerOptions` before the first
 * document load.
 */
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { ensurePdfJsByteHelpers } from './shims';

export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

/** An open PDF document plus the loading task needed to release its worker. */
export interface PdfDocumentHandle {
  pdf: PDFDocumentProxy;
  numPages: number;
  /** Terminates the worker and releases the document. */
  destroy: () => Promise<void>;
}

export interface RenderPdfPageOptions {
  /** Backing-store scale factor. Defaults to `window.devicePixelRatio` (clamped to 2). */
  devicePixelRatio?: number;
}

export interface RenderedPdfPage {
  /** Canvas/CSS size in CSS pixels. */
  width: number;
  height: number;
  /** Backing store size in device pixels. */
  pixelWidth: number;
  pixelHeight: number;
}

export interface RenderPdfPageHandle {
  promise: Promise<RenderedPdfPage>;
  /** Cancels the underlying pdf.js render task (safe to call at any time). */
  cancel: () => void;
}

/** Internal marker used when a render is cancelled before/after pdf.js starts. */
export class PdfRenderCancelledError extends Error {
  constructor() {
    super('Renderização do PDF cancelada.');
    this.name = 'PdfRenderCancelledError';
  }
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function loadPdfJs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      ensurePdfJsByteHelpers();
      const pdfjs = await import('pdfjs-dist');
      // Node/jsdom (tests) has no `Worker`: pdf.js then uses its fake worker and
      // must not be pointed at the browser worker URL.
      if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      }
      return pdfjs;
    })().catch((error: unknown) => {
      pdfjsPromise = null;
      throw error;
    });
  }
  return pdfjsPromise;
}

/** Decodes a base64 payload (optionally a `data:` URL) into raw bytes. */
export function decodeBase64(dataBase64: string): Uint8Array {
  const payload = dataBase64.replace(/^\s*data:[^,]*,\s*/i, '').replace(/\s+/g, '');
  if (!payload) throw new Error('PDF sem dados para visualização.');
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Loads a PDF from raw bytes (or a base64 payload) without blocking the bundle. */
export async function loadPdf(source: Uint8Array | string): Promise<PdfDocumentHandle> {
  const data = typeof source === 'string' ? decodeBase64(source) : source;
  const { getDocument } = await loadPdfJs();
  const loadingTask = getDocument({ data });

  let pdf: PDFDocumentProxy;
  try {
    pdf = await loadingTask.promise;
  } catch (error) {
    await loadingTask.destroy().catch(() => undefined);
    throw error;
  }

  let released = false;
  return {
    pdf,
    numPages: pdf.numPages,
    destroy: async () => {
      if (released) return;
      released = true;
      await loadingTask.destroy();
    },
  };
}

function normalizeRatio(value: number | undefined): number {
  const ratio = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
  // A 3× backing store for a zoomed A4 page would cost dozens of MB; 2× is
  // crisp on every desktop display we target and keeps the canvas bounded.
  return Math.min(2, ratio);
}

/** Converts device pixel ratio into the `transform` pdf.js expects for a crisp canvas. */
function pixelTransform(ratio: number): [number, number, number, number, number, number] | null {
  if (ratio === 1) return null;
  return [ratio, 0, 0, ratio, 0, 0];
}

/**
 * Renders one page of an already-loaded PDF into the given canvas.
 *
 * The render starts immediately; callers should hold the returned handle and
 * `cancel()` it before starting another render on the same canvas.
 */
export function renderPdfPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1,
  options: RenderPdfPageOptions = {},
): RenderPdfPageHandle {
  let cancelled = false;
  let renderTask: RenderTask | null = null;
  const ratio = normalizeRatio(
    options.devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1),
  );
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

  const promise = (async (): Promise<RenderedPdfPage> => {
    const page = await pdf.getPage(pageNumber);
    if (cancelled) throw new PdfRenderCancelledError();

    const viewport = page.getViewport({ scale: safeScale });
    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));

    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const transform = pixelTransform(ratio);
    const task = page.render(transform ? { canvas, viewport, transform } : { canvas, viewport });
    renderTask = task;
    if (cancelled) {
      task.cancel();
      throw new PdfRenderCancelledError();
    }

    await task.promise;
    if (cancelled) throw new PdfRenderCancelledError();
    return { width, height, pixelWidth, pixelHeight };
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        /* the task may already have settled */
      }
    },
  };
}

/** True when the error is a cancelled render (not a real failure to show the user). */
export function isPdfRenderCancelled(error: unknown): boolean {
  if (error instanceof PdfRenderCancelledError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'RenderingCancelledException'
  );
}
