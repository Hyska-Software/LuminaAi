import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button, IconButton, Spinner, Tooltip } from '@/components/ui';
import {
  decodeBase64,
  isPdfRenderCancelled,
  loadPdf,
  renderPdfPage,
  type PdfDocumentHandle,
} from '@/lib/pdf';
import { cn } from '@/lib/utils';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface FilePreviewPdfProps {
  /** Caminho relativo ao workspace; usado nos nomes acessíveis do canvas/região. */
  path: string;
  /** Payload base64 sem o prefixo `data:` (contrato de `read_workspace_file`). */
  dataBase64: string;
  className?: string;
}

/**
 * Visualizador de PDF da aba central do Code (WORKBENCH §7.1), com pdf.js por
 * meio de `@/lib/pdf` (carregamento tardio do módulo + worker).
 *
 * Uma página por vez no `<canvas>`, navegação, zoom e "ajustar à largura";
 * falha de carregamento/renderização cai em painel de retry em vez de tela
 * vazia. O handle do documento é destruído no cleanup — o worker do pdf.js é
 * liberado ao fechar a aba/trocar de arquivo. Implementação isolada no
 * workbench de código (o preview de artefatos não é reutilizado aqui).
 */
export function FilePreviewPdf({ path, dataBase64, className }: FilePreviewPdfProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [renderAttempt, setRenderAttempt] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [baseScale, setBaseScale] = useState(1);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const documentRef = useRef<PdfDocumentHandle | null>(null);

  // Load (and release) the document. The handle owns the pdf.js worker, so the
  // effect cleanup destroys it whenever the file or the retry token change.
  useEffect(() => {
    if (!dataBase64) return;
    let cancelled = false;
    let handle: PdfDocumentHandle | null = null;

    setStatus('loading');
    setError(null);
    setRenderError(null);
    setNumPages(0);
    setPageNumber(1);
    setZoom(1);
    setBaseScale(1);
    documentRef.current = null;

    (async () => {
      try {
        const loaded = await loadPdf(decodeBase64(dataBase64));
        if (cancelled) {
          await loaded.destroy().catch(() => undefined);
          return;
        }
        handle = loaded;
        documentRef.current = loaded;
        setNumPages(loaded.numPages);

        // Ajusta a primeira página à largura do painel (só quando o DOM pode
        // medir; nunca amplia páginas pequenas).
        const container = scrollRef.current;
        if (container && container.clientWidth > 0) {
          try {
            const firstPage = await loaded.pdf.getPage(1);
            const naturalWidth = firstPage.getViewport({ scale: 1 }).width;
            if (!cancelled && naturalWidth > 0) {
              const fit = (container.clientWidth - 24) / naturalWidth;
              setBaseScale(Math.min(1, Math.max(MIN_ZOOM, fit)));
            }
          } catch {
            /* fit é best-effort: fica em 100% */
          }
        }
        if (!cancelled) setStatus('ready');
      } catch (loadError: unknown) {
        if (!cancelled) {
          setError(errorMessage(loadError));
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      documentRef.current = null;
      if (handle) void handle.destroy().catch(() => undefined);
    };
  }, [dataBase64, attempt]);

  // Render the current page whenever page/zoom changes, cancelling the previous
  // render so pdf.js never gets two renders on the same canvas.
  useEffect(() => {
    if (status !== 'ready') return;
    const handle = documentRef.current;
    const canvas = canvasRef.current;
    if (!handle || !canvas) return;

    let active = true;
    setRendering(true);
    setRenderError(null);
    const render = renderPdfPage(handle.pdf, pageNumber, canvas, baseScale * zoom, {
      devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
    });
    render.promise
      .then(() => {
        if (active) setRendering(false);
      })
      .catch((renderFailure: unknown) => {
        if (!active || isPdfRenderCancelled(renderFailure)) return;
        setRenderError(errorMessage(renderFailure));
        setRendering(false);
      });

    return () => {
      active = false;
      render.cancel();
    };
  }, [status, pageNumber, baseScale, zoom, renderAttempt]);

  if (status === 'error') {
    return (
      <div
        className={cn(
          'flex h-full flex-col items-center justify-center gap-3 px-6 text-center',
          className,
        )}
      >
        <span className="flex size-9 items-center justify-center rounded-xl border border-danger/30 bg-danger-soft text-danger">
          <AlertTriangle aria-hidden className="size-4" strokeWidth={1.75} />
        </span>
        <p className="text-[13px] font-medium text-foreground">Não foi possível renderizar o PDF</p>
        <p className="max-w-sm text-xs leading-relaxed text-foreground-muted">{error}</p>
        <Button size="sm" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const ready = status === 'ready';
  const goToPage = (next: number) => {
    if (!ready) return;
    setPageNumber(Math.min(numPages || 1, Math.max(1, next)));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!ready) return;
    switch (event.key) {
      case 'ArrowLeft':
      case 'PageUp':
        event.preventDefault();
        goToPage(pageNumber - 1);
        break;
      case 'ArrowRight':
      case 'PageDown':
        event.preventDefault();
        goToPage(pageNumber + 1);
        break;
      case 'Home':
        event.preventDefault();
        goToPage(1);
        break;
      case 'End':
        event.preventDefault();
        goToPage(numPages || 1);
        break;
      case '+':
      case '=':
        event.preventDefault();
        setZoom((value) => clampZoom(value + ZOOM_STEP));
        break;
      case '-':
      case '_':
        event.preventDefault();
        setZoom((value) => clampZoom(value - ZOOM_STEP));
        break;
      default:
        break;
    }
  };

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div
        role="toolbar"
        aria-label="Controles do PDF"
        className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-surface-raised px-2 py-1.5"
      >
        <IconButton
          label="Página anterior"
          size="sm"
          disabled={!ready || pageNumber <= 1}
          onClick={() => goToPage(pageNumber - 1)}
        >
          <ChevronLeft aria-hidden className="size-4" strokeWidth={1.8} />
        </IconButton>
        <span
          aria-live="polite"
          className="min-w-[104px] text-center text-[11px] tabular-nums text-foreground-muted"
        >
          {ready ? `Página ${pageNumber} de ${numPages}` : 'Carregando…'}
        </span>
        <IconButton
          label="Próxima página"
          size="sm"
          disabled={!ready || pageNumber >= numPages}
          onClick={() => goToPage(pageNumber + 1)}
        >
          <ChevronRight aria-hidden className="size-4" strokeWidth={1.8} />
        </IconButton>
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        <IconButton
          label="Diminuir zoom"
          size="sm"
          disabled={!ready || zoom <= MIN_ZOOM}
          onClick={() => setZoom((value) => clampZoom(value - ZOOM_STEP))}
        >
          <ZoomOut aria-hidden className="size-4" strokeWidth={1.8} />
        </IconButton>
        <span
          aria-live="polite"
          className="w-10 text-center text-[11px] tabular-nums text-foreground-muted"
        >
          {Math.round(zoom * 100)}%
        </span>
        <IconButton
          label="Aumentar zoom"
          size="sm"
          disabled={!ready || zoom >= MAX_ZOOM}
          onClick={() => setZoom((value) => clampZoom(value + ZOOM_STEP))}
        >
          <ZoomIn aria-hidden className="size-4" strokeWidth={1.8} />
        </IconButton>
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        <Tooltip content="Ajustar à largura" side="bottom">
          <IconButton
            label="Ajustar à largura"
            size="sm"
            disabled={!ready}
            onClick={() => setZoom(1)}
          >
            <Maximize2 aria-hidden className="size-4" strokeWidth={1.8} />
          </IconButton>
        </Tooltip>
        {rendering ? (
          <Spinner size="xs" className="ml-auto text-foreground-subtle" label="Renderizando página" />
        ) : null}
      </div>

      <div
        ref={scrollRef}
        role="region"
        aria-label={`Prévia do PDF ${path}`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="min-h-0 flex-1 overflow-auto bg-surface p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        {!ready ? (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <Spinner size="md" className="text-accent" label="Carregando PDF" />
            <span className="text-xs text-foreground-muted">Carregando PDF…</span>
          </div>
        ) : (
          <div className="relative flex min-h-full justify-center">
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={`Página ${pageNumber} de ${numPages} do PDF ${path}`}
              className="h-auto max-w-none rounded-md border border-border bg-background shadow-sm"
            />
            {renderError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background px-4 text-center">
                <AlertTriangle aria-hidden className="size-4 text-danger" strokeWidth={1.75} />
                <p className="text-xs text-foreground-muted">
                  Não foi possível renderizar esta página.
                </p>
                <p className="max-w-sm text-[11px] leading-relaxed text-foreground-subtle">
                  {renderError}
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setRenderAttempt((value) => value + 1)}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export default FilePreviewPdf;
