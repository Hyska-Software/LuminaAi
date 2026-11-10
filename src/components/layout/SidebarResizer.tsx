import { useTranslation } from 'react-i18next';
import {
  clampSidebarWidth,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_STEP,
} from '@/lib/store';
import { PanelResizer } from './PanelResizer';

/** Translation key of the sidebar resize handle label (DESIGN §12). */
export const SIDEBAR_RESIZER_LABEL = 'panelResizer.sidebarLabel' as const;
/** Translation key of the discoverability hint shown as the native tooltip. */
export const SIDEBAR_RESIZER_HINT = 'panelResizer.hint' as const;

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
  const { t } = useTranslation('common');
  return (
    <PanelResizer
      value={clampSidebarWidth(width)}
      min={SIDEBAR_WIDTH_MIN}
      max={SIDEBAR_WIDTH_MAX}
      step={SIDEBAR_WIDTH_STEP}
      side="start"
      label={t(SIDEBAR_RESIZER_LABEL)}
      hint={t(SIDEBAR_RESIZER_HINT)}
      onResize={onResize}
      onResizeEnd={onResizeEnd}
      onReset={onReset}
      className={className}
    />
  );
}
