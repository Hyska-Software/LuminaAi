import {
  clampSidebarWidth,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_STEP,
} from '@/lib/store';
import { PanelResizer } from './PanelResizer';

/** Accessible label of the sidebar resize handle (DESIGN §12). */
export const SIDEBAR_RESIZER_LABEL = 'Redimensionar barra lateral';
/** Discoverability hint shown as the native tooltip. */
export const SIDEBAR_RESIZER_HINT = 'Arraste para redimensionar · duplo clique para restaurar';

export interface SidebarResizerProps {
  /** Effective sidebar width in px (already clamped by the caller). */
  width: number;
  /** Transient resize callback fired while dragging and while stepping with keys. */
  onResize: (width: number) => void;
  /** Commit callback fired once the drag ends (or on each keyboard step). */
  onResizeEnd: (width: number) => void;
  /** Restores the default width (double click). */
  onReset: () => void;
  className?: string;
}

/**
 * Sidebar resize handle: the generic `PanelResizer` configured with the
 * sidebar bounds and the left-anchored (`start`) drag direction.
 */
export function SidebarResizer({
  width,
  onResize,
  onResizeEnd,
  onReset,
  className,
}: SidebarResizerProps) {
  return (
    <PanelResizer
      value={clampSidebarWidth(width)}
      min={SIDEBAR_WIDTH_MIN}
      max={SIDEBAR_WIDTH_MAX}
      step={SIDEBAR_WIDTH_STEP}
      side="start"
      label={SIDEBAR_RESIZER_LABEL}
      hint={SIDEBAR_RESIZER_HINT}
      onResize={onResize}
      onResizeEnd={onResizeEnd}
      onReset={onReset}
      className={className}
    />
  );
}
