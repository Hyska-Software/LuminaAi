import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import {
  clampSidePanelWidth,
  SIDE_PANEL_WIDTH_DEFAULT,
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_WIDTH_MIN,
  useUiStore,
  type SidePanelMode,
} from './store';

/**
 * Minimum window width (px) where the docked layout is allowed. Below it the
 * side panel always floats over the chat (the drawer model), so narrow windows
 * keep a usable conversation column. docs/DESIGN.md §5/§13.
 */
export const SIDE_PANEL_DOCK_MIN_VIEWPORT = 1120;

/** Conversation width the docked panel always leaves free, in px. */
export const SIDE_PANEL_MIN_CHAT_WIDTH = 480;

/** Overlay mode never takes more than this fraction of the window. */
export const SIDE_PANEL_OVERLAY_VIEWPORT_RATIO = 0.92;

/** Resolved layout of the right side panel for the current window/mode. */
export interface SidePanelLayout {
  /** Persisted preference (`overlay` | `docked`). */
  mode: SidePanelMode;
  /** `true` when the panel actually splits the row (docked preference + room). */
  docked: boolean;
  /** `true` when the window is wide enough to honor the docked preference. */
  canDock: boolean;
  /** Effective width in px (preview/persisted width clamped to the viewport). */
  width: number;
  /** Responsive upper bound used by the resize handle for this viewport/mode. */
  maxWidth: number;
  /** Current viewport width in px (0 outside the browser). */
  viewportWidth: number;
}

export interface SidePanelLayoutInput {
  mode: SidePanelMode;
  viewportWidth: number;
  sidebarOpen: boolean;
  sidebarWidth: number;
  /** Persisted width in px. */
  width: number;
  /** Transient width while dragging; overrides `width` when provided. */
  previewWidth?: number | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeRound(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

/**
 * Resolves the right side panel layout: the persisted overlay/docked preference
 * combined with the available window space.
 *
 * Responsive rules:
 * - `docked` is only honored when the window is at least
 *   `SIDE_PANEL_DOCK_MIN_VIEWPORT` wide; otherwise the panel falls back to
 *   overlay (the preference is kept for when the window grows again).
 * - Docked: the width may grow until the chat keeps `SIDE_PANEL_MIN_CHAT_WIDTH`
 *   (the sidebar, when open, is discounted from the available space).
 * - Overlay: the width may grow until `92%` of the window.
 * - Both modes clamp the stored width on the fly, so shrinking the window never
 *   leaves the panel wider than the space it has.
 */
export function resolveSidePanelLayout(input: SidePanelLayoutInput): SidePanelLayout {
  const viewportWidth = Math.max(0, safeRound(input.viewportWidth));
  const canDock = viewportWidth >= SIDE_PANEL_DOCK_MIN_VIEWPORT;
  const docked = input.mode === 'docked' && canDock;

  const overlayMax = clamp(
    Math.floor(viewportWidth * SIDE_PANEL_OVERLAY_VIEWPORT_RATIO),
    SIDE_PANEL_WIDTH_MIN,
    SIDE_PANEL_WIDTH_MAX,
  );
  const dockedAvailable =
    viewportWidth -
    (input.sidebarOpen ? safeRound(input.sidebarWidth) : 0) -
    SIDE_PANEL_MIN_CHAT_WIDTH;
  const dockedMax = clamp(dockedAvailable, SIDE_PANEL_WIDTH_MIN, SIDE_PANEL_WIDTH_MAX);
  const maxWidth = docked ? dockedMax : overlayMax;

  const requested = input.previewWidth ?? input.width;
  // `clampSidePanelWidth` also rounds and rejects invalid input (fallback = default).
  const width = clamp(clampSidePanelWidth(requested), SIDE_PANEL_WIDTH_MIN, maxWidth);

  return { mode: input.mode, docked, canDock, width, maxWidth, viewportWidth };
}

/** Subscribes to the window width without tearing during concurrent renders. */
export function useViewportWidth(): number {
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener('resize', onStoreChange);
    window.addEventListener('orientationchange', onStoreChange);
    return () => {
      window.removeEventListener('resize', onStoreChange);
      window.removeEventListener('orientationchange', onStoreChange);
    };
  }, []);

  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined') return 0;
    return window.innerWidth;
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}

/**
 * Reactive panel layout. Pass a transient `previewWidth` while the user drags
 * the divider so the panel (and the chat, in docked mode) follow the pointer.
 */
export function useSidePanelLayout(previewWidth: number | null = null): SidePanelLayout {
  const mode = useUiStore((state) => state.sidePanelMode);
  const width = useUiStore((state) => state.sidePanelWidth);
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const sidebarWidth = useUiStore((state) => state.sidebarWidth);
  const viewportWidth = useViewportWidth();

  return useMemo(
    () =>
      resolveSidePanelLayout({
        mode,
        viewportWidth,
        sidebarOpen,
        sidebarWidth,
        width,
        previewWidth,
      }),
    [mode, viewportWidth, sidebarOpen, sidebarWidth, width, previewWidth],
  );
}

/** Resize controls shared by the artifact and sources panels. */
export interface SidePanelResize {
  /** Layout currently applied to the panel (width already viewport-clamped). */
  layout: SidePanelLayout;
  /** Persisted preference; toggling it flips overlay ↔ docked. */
  mode: SidePanelMode;
  setMode: (mode: SidePanelMode) => void;
  /** Transient resize (drag); the persisted width is untouched until release. */
  onResize: (width: number) => void;
  /** Commits the final width (drag release / keyboard step). */
  onResizeEnd: (width: number) => void;
  /** Restores `SIDE_PANEL_WIDTH_DEFAULT` (double click). */
  onReset: () => void;
}

/**
 * Width/layout state for a right side panel. Keeps the drag preview local so
 * pointer moves never write to `localStorage`, and commits only on release.
 */
export function useSidePanelResize(): SidePanelResize {
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const layout = useSidePanelLayout(previewWidth);
  const mode = useUiStore((state) => state.sidePanelMode);
  const setSidePanelWidth = useUiStore((state) => state.setSidePanelWidth);
  const setSidePanelMode = useUiStore((state) => state.setSidePanelMode);

  const clampToLayout = useCallback(
    (width: number) => clamp(Math.round(width), SIDE_PANEL_WIDTH_MIN, layout.maxWidth),
    [layout.maxWidth],
  );

  const onResize = useCallback(
    (width: number) => {
      setPreviewWidth(clampToLayout(width));
    },
    [clampToLayout],
  );

  const onResizeEnd = useCallback(
    (width: number) => {
      setSidePanelWidth(clampToLayout(width));
      setPreviewWidth(null);
    },
    [clampToLayout, setSidePanelWidth],
  );

  const onReset = useCallback(() => {
    setSidePanelWidth(SIDE_PANEL_WIDTH_DEFAULT);
    setPreviewWidth(null);
  }, [setSidePanelWidth]);

  return { layout, mode, setMode: setSidePanelMode, onResize, onResizeEnd, onReset };
}
