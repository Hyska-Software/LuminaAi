import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';
import { isSvgMarkup, sanitizeSvg } from '@/lib/genui/sanitize';
import { cn } from '@/lib/utils';
import { Badge, Button, IconButton } from '@/components/ui';
import { BinaryPreview } from './BinaryPreview';
import { PreviewLoading, useArtifactPreview, type ArtifactViewProps } from './previewSupport';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.25;

const CHECKERBOARD: CSSProperties = {
  backgroundColor: 'var(--surface)',
  backgroundImage:
    'linear-gradient(45deg, var(--surface-hover) 25%, transparent 25%, transparent 75%, var(--surface-hover) 75%), ' +
    'linear-gradient(45deg, var(--surface-hover) 25%, transparent 25%, transparent 75%, var(--surface-hover) 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 8px 8px',
};

const MIME_FORMATS: Record<string, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/jpg': 'JPEG',
  'image/webp': 'WEBP',
  'image/gif': 'GIF',
  'image/avif': 'AVIF',
  'image/bmp': 'BMP',
  'image/x-bmp': 'BMP',
  'image/x-icon': 'ICO',
  'image/vnd.microsoft.icon': 'ICO',
  'image/tiff': 'TIFF',
  'image/svg+xml': 'SVG',
};

const EXTENSION_FORMATS: Record<string, string> = {
  png: 'PNG',
  jpg: 'JPEG',
  jpeg: 'JPEG',
  webp: 'WEBP',
  gif: 'GIF',
  avif: 'AVIF',
  bmp: 'BMP',
  ico: 'ICO',
  tif: 'TIFF',
  tiff: 'TIFF',
  svg: 'SVG',
};

const EXTENSION_MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
};

export function artifactExtension(name?: string | null): string | null {
  if (!name) return null;
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** Human-readable image format for the toolbar badge (PNG/JPEG/WEBP/…). */
export function imageFormatLabel(mimeType?: string | null, name?: string | null): string {
  const mime = mimeType?.trim().toLowerCase();
  if (mime && MIME_FORMATS[mime]) return MIME_FORMATS[mime];
  const extension = artifactExtension(name);
  if (extension && EXTENSION_FORMATS[extension]) return EXTENSION_FORMATS[extension];
  if (mime) {
    const subtype = mime.split('/')[1];
    if (subtype) return subtype.replace(/^x-/, '').toUpperCase();
  }
  return extension ? extension.toUpperCase() : 'IMG';
}

/** MIME used to build the fallback data URL from the raw content payload. */
export function imageMimeType(mimeType?: string | null, name?: string | null): string {
  const mime = mimeType?.trim().toLowerCase();
  if (mime && mime.startsWith('image/')) return mime;
  const extension = artifactExtension(name);
  if (extension && EXTENSION_MIMES[extension]) return EXTENSION_MIMES[extension];
  return 'image/png';
}

function toDataUrl(mime: string, payload: string): string {
  if (payload.startsWith('data:')) return payload;
  return `data:${mime || 'application/octet-stream'};base64,${payload}`;
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

function svgDimensions(markup: string): { width: number; height: number } | null {
  const viewBox = /viewBox\s*=\s*["']([^"']+)["']/i.exec(markup);
  if (viewBox) {
    const parts = viewBox[1]
      .trim()
      .split(/[\s,]+/)
      .map((value) => Number.parseFloat(value));
    if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
      return { width: parts[2], height: parts[3] };
    }
  }
  const width = /\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(markup);
  const height = /\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(markup);
  if (width && height) {
    return { width: Number.parseFloat(width[1]), height: Number.parseFloat(height[1]) };
  }
  return null;
}

type ViewMode = 'fit' | 'actual' | 'custom';

interface ViewerControls {
  zoom: number;
  mode: ViewMode;
  dragging: boolean;
  canPan: boolean;
  contentStyle: CSSProperties | undefined;
  contentClassName: string;
  wrapperClassName: string;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToWindow: () => void;
  actualSize: () => void;
  handleKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
}

/** Shared fit/actual/custom zoom + drag-to-pan state for image and SVG previews. */
function useViewerControls(): ViewerControls {
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<ViewMode>('fit');
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const fitToWindow = useCallback(() => {
    setMode('fit');
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const actualSize = useCallback(() => {
    setMode('actual');
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => {
    setMode('custom');
    setZoom((value) => clampZoom(value + ZOOM_STEP));
  }, []);

  const zoomOut = useCallback(() => {
    setMode('custom');
    setZoom((value) => clampZoom(value - ZOOM_STEP));
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case '+':
      case '=':
        event.preventDefault();
        zoomIn();
        break;
      case '-':
      case '_':
        event.preventDefault();
        zoomOut();
        break;
      case '0':
        event.preventDefault();
        fitToWindow();
        break;
      case '1':
        event.preventDefault();
        actualSize();
        break;
      default:
        break;
    }
  };

  const canPan = mode === 'custom' && zoom > 1;

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canPan || event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    setDragging(true);
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (typeof event.currentTarget.releasePointerCapture === 'function') {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    }
    endDrag();
  };

  return {
    zoom,
    mode,
    dragging,
    canPan,
    contentStyle:
      mode === 'custom'
        ? { transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }
        : undefined,
    contentClassName: mode === 'actual' ? 'max-h-none max-w-none' : 'max-h-full max-w-full object-contain',
    wrapperClassName: mode === 'actual' ? 'min-h-full w-max min-w-full' : 'h-full w-full overflow-hidden',
    zoomIn,
    zoomOut,
    fitToWindow,
    actualSize,
    handleKeyDown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave: endDrag,
  };
}

function ViewerToolbar({
  label,
  formatLabel,
  dimensions,
  controls,
}: {
  label: string;
  formatLabel: string;
  dimensions: string | null;
  controls: ViewerControls;
}) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-surface-raised px-2 py-1.5"
    >
      <Badge tone="accent" size="sm" title={formatLabel}>
        {formatLabel}
      </Badge>
      <span
        className={cn(
          'px-1 text-[11px] tabular-nums',
          dimensions ? 'text-foreground-muted' : 'text-foreground-subtle',
        )}
        title="Dimensões da imagem em pixels"
      >
        {dimensions ?? '—'}
      </span>
      <span aria-hidden className="mx-1 h-4 w-px bg-border" />
      <IconButton
        label="Diminuir zoom"
        size="sm"
        disabled={controls.zoom <= MIN_ZOOM}
        onClick={controls.zoomOut}
      >
        <ZoomOut aria-hidden className="size-4" strokeWidth={1.8} />
      </IconButton>
      <span
        aria-live="polite"
        className="w-12 text-center text-[11px] tabular-nums text-foreground-muted"
      >
        {Math.round(controls.zoom * 100)}%
      </span>
      <IconButton
        label="Aumentar zoom"
        size="sm"
        disabled={controls.zoom >= MAX_ZOOM}
        onClick={controls.zoomIn}
      >
        <ZoomIn aria-hidden className="size-4" strokeWidth={1.8} />
      </IconButton>
      <span aria-hidden className="mx-1 h-4 w-px bg-border" />
      <Button
        size="sm"
        variant={controls.mode === 'fit' ? 'subtle' : 'ghost'}
        aria-pressed={controls.mode === 'fit'}
        onClick={controls.fitToWindow}
        leftIcon={<Minimize2 aria-hidden className="size-3.5" strokeWidth={1.8} />}
      >
        Ajustar à janela
      </Button>
      <Button
        size="sm"
        variant={controls.mode === 'actual' ? 'subtle' : 'ghost'}
        aria-pressed={controls.mode === 'actual'}
        onClick={controls.actualSize}
        leftIcon={<Maximize2 aria-hidden className="size-3.5" strokeWidth={1.8} />}
      >
        Tamanho real
      </Button>
    </div>
  );
}

function ViewerStage({
  label,
  controls,
  children,
}: {
  label: string;
  controls: ViewerControls;
  children: ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      onKeyDown={controls.handleKeyDown}
      style={CHECKERBOARD}
      className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
    >
      <div
        className={cn(
          'flex items-center justify-center p-4',
          controls.wrapperClassName,
          controls.canPan && 'cursor-grab',
          controls.dragging && 'cursor-grabbing',
        )}
        onPointerDown={controls.onPointerDown}
        onPointerMove={controls.onPointerMove}
        onPointerUp={controls.onPointerUp}
        onPointerCancel={controls.onPointerUp}
        onPointerLeave={controls.onPointerLeave}
      >
        {children}
      </div>
    </div>
  );
}

function isDataUrlPayload(value: string): boolean {
  return /^data:image\//i.test(value);
}

/**
 * Image preview with a transparency checkerboard, zoom (25%–800%), fit/actual
 * size and drag-to-pan. The backend preview is authoritative: converted formats
 * (TIFF → PNG) come with their own base64; web-safe formats reuse the content
 * payload; unsupported/failed previews still try the raw base64 before falling
 * back to the binary card.
 */
export function ImagePreview({ content, className, showArtifactActions }: ArtifactViewProps) {
  const { artifact, dataBase64, content: text } = content;
  const { state, retry } = useArtifactPreview(artifact.id);
  const [loadFailed, setLoadFailed] = useState(false);
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const controls = useViewerControls();

  const preview = state.status === 'ready' ? state.preview : null;
  const imagePreview = preview?.kind === 'image' ? preview : null;
  const unsupportedReason = preview?.kind === 'unsupported' ? preview.reason : null;
  const errorMessage = state.status === 'error' ? state.message : null;

  const rawBase64 = dataBase64 && !dataBase64.startsWith('data:') ? dataBase64 : null;
  const rawDataUrl =
    dataBase64 && dataBase64.startsWith('data:')
      ? dataBase64
      : text && isDataUrlPayload(text)
        ? text
        : null;
  const fallbackMime = imageMimeType(artifact.mimeType, artifact.name);
  const fallbackSrc = rawBase64 ? toDataUrl(fallbackMime, rawBase64) : rawDataUrl;

  const previewPayload = imagePreview ? (imagePreview.dataBase64 ?? rawBase64 ?? rawDataUrl) : null;
  const src = imagePreview?.dataBase64
    ? toDataUrl(imagePreview.mime || fallbackMime, imagePreview.dataBase64)
    : previewPayload
      ? toDataUrl(imagePreview?.mime || fallbackMime, previewPayload)
      : fallbackSrc;

  useEffect(() => {
    setLoadFailed(false);
    setMeasured(null);
  }, [src]);

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      setMeasured({ width: image.naturalWidth, height: image.naturalHeight });
    }
  };

  if (!src) {
    if (state.status === 'loading') {
      return <PreviewLoading label="Carregando imagem…" className={className} />;
    }
    return (
      <BinaryPreview
        content={content}
        className={className}
        showArtifactActions={showArtifactActions}
        detail={
          errorMessage ?? unsupportedReason ?? 'A imagem não tem dados para visualização.'
        }
        onRetry={errorMessage ? retry : undefined}
      />
    );
  }

  if (loadFailed) {
    return (
      <BinaryPreview
        content={content}
        className={className}
        showArtifactActions={showArtifactActions}
        detail={unsupportedReason ?? 'Não foi possível decodificar a imagem.'}
        onRetry={() => {
          setLoadFailed(false);
          retry();
        }}
      />
    );
  }

  const width = imagePreview?.width ?? measured?.width ?? null;
  const height = imagePreview?.height ?? measured?.height ?? null;
  const dimensions = width && height ? `${width} × ${height}` : null;
  const formatLabel = imageFormatLabel(imagePreview?.mime ?? artifact.mimeType, artifact.name);

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <ViewerToolbar
        label="Controles da imagem"
        formatLabel={formatLabel}
        dimensions={dimensions}
        controls={controls}
      />
      <ViewerStage label="Visualização da imagem" controls={controls}>
        <img
          src={src}
          alt={artifact.name}
          draggable={false}
          onLoad={handleLoad}
          onError={() => setLoadFailed(true)}
          style={controls.contentStyle}
          className={cn(
            'rounded-lg border border-border shadow-sm',
            controls.contentClassName,
            !controls.dragging && 'transition-transform duration-150 motion-reduce:transition-none',
          )}
        />
      </ViewerStage>
    </div>
  );
}

/**
 * SVG preview: uses the same checkerboard/zoom stage as images, but injects the
 * sanitized markup (`sanitizeSvg` strips scripts, event handlers and
 * `javascript:` URLs). Markup that is not an SVG document is shown as text.
 */
export function SvgPreview({ content, className }: ArtifactViewProps) {
  const { artifact, content: markup } = content;
  const raw = markup ?? '';
  const sanitized = useMemo(() => sanitizeSvg(raw), [raw]);
  const controls = useViewerControls();

  const isSvg = sanitized.length > 0 && isSvgMarkup(sanitized);

  if (!isSvg) {
    return (
      <div className={cn('flex h-full flex-col', className)}>
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-3 py-1.5">
          <Badge tone="outline" size="sm">
            SVG
          </Badge>
          <span className="text-[11px] text-foreground-subtle">
            Markup não reconhecido como SVG; exibindo como texto.
          </span>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[12px] leading-relaxed text-foreground-muted">
          {raw}
        </pre>
      </div>
    );
  }

  const dimensions = svgDimensions(sanitized);

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <ViewerToolbar
        label="Controles do SVG"
        formatLabel="SVG"
        dimensions={dimensions ? `${dimensions.width} × ${dimensions.height}` : null}
        controls={controls}
      />
      <ViewerStage label="Visualização do SVG" controls={controls}>
        <div
          style={controls.contentStyle}
          className={cn(
            'flex items-center justify-center [&_svg]:h-auto [&_svg]:max-w-full',
            controls.mode === 'actual'
              ? '[&_svg]:max-h-none [&_svg]:max-w-none'
              : '[&_svg]:max-h-full',
            !controls.dragging && 'transition-transform duration-150 motion-reduce:transition-none',
          )}
          // sanitizeSvg removes scripts, event handlers and javascript: URLs.
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
      </ViewerStage>
    </div>
  );
}
