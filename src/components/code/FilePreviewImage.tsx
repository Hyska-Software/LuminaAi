import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { FileWarning, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';
import { Badge, Button, IconButton } from '@/components/ui';
import { cn } from '@/lib/utils';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.25;
/** Folga interna (px) entre a imagem e a borda da área de visualização. */
const STAGE_PADDING = 32;

/**
 * Xadrez de transparência montado com os tokens do tema (`--surface` /
 * `--surface-hover`) — nenhuma cor solta fora de `src/styles/globals.css`.
 */
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
  svg: 'SVG',
};

/** Extensão em minúsculas do caminho (sem o ponto), ou `null`. */
function extensionOf(path: string): string | null {
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** Rótulo humano do formato da imagem (PNG/JPEG/WEBP/…). */
export function imageFormatLabel(mimeType: string | null | undefined, path: string): string {
  const mime = mimeType?.trim().toLowerCase();
  if (mime && MIME_FORMATS[mime]) return MIME_FORMATS[mime];
  const extension = extensionOf(path);
  if (extension && EXTENSION_FORMATS[extension]) return EXTENSION_FORMATS[extension];
  if (mime) {
    const subtype = mime.split('/')[1];
    if (subtype) return subtype.replace(/^x-/, '').toUpperCase();
  }
  return extension ? extension.toUpperCase() : 'IMG';
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

type ViewMode = 'fit' | 'actual' | 'custom';

export interface FilePreviewImageProps {
  /** Caminho relativo ao workspace; vira o `alt` e o nome acessível da região. */
  path: string;
  /** MIME reportado pelo backend (`image/…`). */
  mimeType: string;
  /** Payload base64 sem o prefixo `data:` (contrato de `read_workspace_file`). */
  dataBase64: string;
  className?: string;
}

/**
 * Visualizador de imagem da aba central do Code (WORKBENCH §7.1).
 *
 * Fundo xadrez para transparência, zoom (+/−/%), "Ajustar à janela" e
 * "Tamanho real"; as dimensões vêm do próprio `<img>` ao carregar. A navegação
 * por teclado (`+`/`-`/`0`/`1`) vive na região focável — mesmo contrato do
 * visualizador de artefatos, implementado isolado no workbench de código.
 *
 * Honesto por construção: sem payload não há imagem (o `FilePreview` decide
 * entre o cartão de prévia omitida e o de formato sem prévia); aqui um payload
 * que o navegador não decodifica (ex.: TIFF) cai em aviso explícito.
 */
export function FilePreviewImage({
  path,
  mimeType,
  dataBase64,
  className,
}: FilePreviewImageProps) {
  const { t } = useTranslation('code');
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<ViewMode>('fit');
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const src = useMemo(
    () =>
      dataBase64.startsWith('data:')
        ? dataBase64
        : `data:${mimeType || 'image/png'};base64,${dataBase64}`,
    [dataBase64, mimeType],
  );

  /* Um novo payload recomeça em "Ajustar à janela" (sem carregar o zoom anterior). */
  useEffect(() => {
    setMode('fit');
    setZoom(1);
    setMeasured(null);
    setFailed(false);
  }, [src]);

  /* Mede a área de visualização para calcular o percentual real do "ajustar".
     Re-observa quando a área volta a existir (depois de um erro de payload). */
  useEffect(() => {
    if (failed) return;
    const node = stageRef.current;
    if (!node) return;
    const measure = () =>
      setStageSize({ width: node.clientWidth, height: node.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [failed]);

  /** Escala do "ajustar à janela" (nunca amplia além do tamanho natural). */
  const fitScale = useMemo(() => {
    if (!measured || measured.width <= 0 || measured.height <= 0) return 1;
    if (stageSize.width <= 0 || stageSize.height <= 0) return 1;
    /* Imagens muito maiores que o painel podem exigir < 25%: o valor mostrado
       precisa ser o real, então o piso da escala de ajuste é bem pequeno. */
    return Math.min(
      1,
      Math.max(
        0.05,
        Math.min(
          (stageSize.width - STAGE_PADDING) / measured.width,
          (stageSize.height - STAGE_PADDING) / measured.height,
        ),
      ),
    );
  }, [measured, stageSize]);

  const baseScale = mode === 'fit' ? fitScale : mode === 'actual' ? 1 : zoom;

  /* Ao sair de "ajustar/tamanho real" o primeiro passo é relativo à escala
     atual (evita saltar de uma imagem grande em 10% para 35% de uma vez). */
  const zoomIn = () => {
    setMode('custom');
    setZoom(clampZoom(mode === 'custom' ? zoom + ZOOM_STEP : baseScale * (1 + ZOOM_STEP)));
  };

  const zoomOut = () => {
    setMode('custom');
    setZoom(clampZoom(mode === 'custom' ? zoom - ZOOM_STEP : baseScale * (1 - ZOOM_STEP)));
  };

  const fitToWindow = () => {
    setMode('fit');
    setZoom(1);
  };

  const actualSize = () => {
    setMode('actual');
    setZoom(1);
  };

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

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      setMeasured({ width: image.naturalWidth, height: image.naturalHeight });
    }
  };

  const formatLabel = imageFormatLabel(mimeType, path);
  const dimensions = measured ? `${measured.width} × ${measured.height}` : null;
  /* No modo "personalizado" o tamanho é explícito em px: sem depender de
     transform, a área de rolagem cresce junto com a imagem (dá para rolar). */
  const customWidth =
    mode === 'custom' && measured ? Math.round(measured.width * zoom) : undefined;

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div
        role="toolbar"
        aria-label={t('code:image.controls')}
        className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-surface-hover px-2 py-1.5"
      >
        <Badge tone="accent" size="sm" title={formatLabel}>
          {formatLabel}
        </Badge>
        <span
          className={cn(
            'px-1 text-[11px] tabular-nums',
            dimensions ? 'text-foreground-muted' : 'text-foreground-subtle',
          )}
          title={t('code:image.dimensionsTitle')}
        >
          {dimensions ?? '—'}
        </span>
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        <IconButton
          label={t('code:image.zoomOut')}
          size="sm"
          disabled={mode === 'custom' && zoom <= MIN_ZOOM}
          onClick={zoomOut}
        >
          <ZoomOut aria-hidden className="size-4" strokeWidth={1.8} />
        </IconButton>
        <span
          aria-live="polite"
          className="w-12 text-center text-[11px] tabular-nums text-foreground-muted"
        >
          {Math.round(baseScale * 100)}%
        </span>
        <IconButton
          label={t('code:image.zoomIn')}
          size="sm"
          disabled={mode === 'custom' && zoom >= MAX_ZOOM}
          onClick={zoomIn}
        >
          <ZoomIn aria-hidden className="size-4" strokeWidth={1.8} />
        </IconButton>
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        <Button
          size="sm"
          variant={mode === 'fit' ? 'subtle' : 'ghost'}
          aria-pressed={mode === 'fit'}
          onClick={fitToWindow}
          leftIcon={<Minimize2 aria-hidden className="size-3.5" strokeWidth={1.8} />}
        >
          {t('code:image.fit')}
        </Button>
        <Button
          size="sm"
          variant={mode === 'actual' ? 'subtle' : 'ghost'}
          aria-pressed={mode === 'actual'}
          onClick={actualSize}
          leftIcon={<Maximize2 aria-hidden className="size-3.5" strokeWidth={1.8} />}
        >
          {t('code:image.actual')}
        </Button>
      </div>

      {failed ? (
        <div
          role="alert"
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center"
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-surface-hover text-foreground-muted">
            <FileWarning aria-hidden className="size-4" strokeWidth={1.75} />
          </span>
          <p className="text-[12.5px] font-medium text-foreground">
            {t('code:image.failedTitle')}
          </p>
          <p className="max-w-64 text-[12px] leading-relaxed text-foreground-muted">
            {t('code:image.failedDescription')}
          </p>
        </div>
      ) : (
        <div
          ref={stageRef}
          role="region"
          aria-label={t('code:image.region', { path })}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          style={CHECKERBOARD}
          className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
        >
          <div
            className={cn(
              'flex items-center justify-center p-4',
              mode === 'fit' ? 'h-full w-full' : 'min-h-full w-max min-w-full',
            )}
          >
            <img
              src={src}
              alt={path}
              draggable={false}
              onLoad={handleLoad}
              onError={() => setFailed(true)}
              style={customWidth != null ? { width: `${customWidth}px` } : undefined}
              className={cn(
                'rounded-lg shadow-sm',
                mode === 'fit' ? 'max-h-full max-w-full object-contain' : 'max-h-none max-w-none',
              )}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default FilePreviewImage;
