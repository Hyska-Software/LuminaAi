// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveSidePanelLayout,
  SIDE_PANEL_DOCK_MIN_VIEWPORT,
  SIDE_PANEL_MIN_CHAT_WIDTH,
  useSidePanelResize,
  type SidePanelLayoutInput,
} from '@/lib/sidePanel';
import {
  SIDE_PANEL_WIDTH_DEFAULT,
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_WIDTH_MIN,
  useUiStore,
} from '@/lib/store';

const originalInnerWidth = window.innerWidth;

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
}

function layout(overrides: Partial<SidePanelLayoutInput> = {}) {
  return resolveSidePanelLayout({
    mode: 'overlay',
    viewportWidth: 1440,
    sidebarOpen: true,
    sidebarWidth: 272,
    width: SIDE_PANEL_WIDTH_DEFAULT,
    ...overrides,
  });
}

beforeEach(() => {
  setViewportWidth(originalInnerWidth);
  useUiStore.setState({ sidePanelWidth: SIDE_PANEL_WIDTH_DEFAULT, sidePanelMode: 'overlay' });
});

afterEach(() => {
  setViewportWidth(originalInnerWidth);
});

describe('resolveSidePanelLayout — overlay', () => {
  it('keeps the persisted width inside the enlarged bounds', () => {
    expect(SIDE_PANEL_WIDTH_MAX).toBe(900);

    expect(layout({ width: 600 }).width).toBe(600);
    expect(layout({ width: 600 }).docked).toBe(false);
    expect(layout({ width: 600 }).maxWidth).toBe(SIDE_PANEL_WIDTH_MAX);
  });

  it('caps the width at 92% of the window', () => {
    const narrow = layout({ viewportWidth: 900, width: 900 });

    expect(narrow.maxWidth).toBe(Math.floor(900 * 0.92));
    expect(narrow.width).toBe(narrow.maxWidth);
  });

  it('never goes below the minimum even in a tiny window', () => {
    const tiny = layout({ viewportWidth: 300, width: 900 });

    expect(tiny.maxWidth).toBe(SIDE_PANEL_WIDTH_MIN);
    expect(tiny.width).toBe(SIDE_PANEL_WIDTH_MIN);
  });

  it('falls back to the default for invalid widths', () => {
    const invalid = layout({ width: Number.NaN });
    expect(invalid.width).toBe(SIDE_PANEL_WIDTH_DEFAULT);

    const infinite = layout({ width: Number.POSITIVE_INFINITY });
    expect(infinite.width).toBe(SIDE_PANEL_WIDTH_DEFAULT);
  });
});

describe('resolveSidePanelLayout — docked', () => {
  it('only honors the docked preference when the window is wide enough', () => {
    const cramped = layout({
      mode: 'docked',
      viewportWidth: SIDE_PANEL_DOCK_MIN_VIEWPORT - 1,
      width: 600,
    });

    expect(cramped.canDock).toBe(false);
    expect(cramped.docked).toBe(false);
    // Preference kept so the panel docks again when the window grows.
    expect(cramped.mode).toBe('docked');

    const wide = layout({ mode: 'docked', viewportWidth: SIDE_PANEL_DOCK_MIN_VIEWPORT });
    expect(wide.canDock).toBe(true);
    expect(wide.docked).toBe(true);
  });

  it('leaves the conversation the minimum width, discounting the sidebar', () => {
    const docked = layout({ mode: 'docked', viewportWidth: 1400, width: 900 });

    expect(docked.maxWidth).toBe(
      1400 - 272 - SIDE_PANEL_MIN_CHAT_WIDTH,
    );
    expect(docked.width).toBe(docked.maxWidth);
    expect(docked.width + 272 + SIDE_PANEL_MIN_CHAT_WIDTH).toBe(1400);
  });

  it('frees more room when the sidebar is collapsed', () => {
    const withSidebar = layout({ mode: 'docked', viewportWidth: 1300, sidebarOpen: true });
    const withoutSidebar = layout({ mode: 'docked', viewportWidth: 1300, sidebarOpen: false });

    expect(withoutSidebar.maxWidth).toBeGreaterThan(withSidebar.maxWidth);
    expect(withoutSidebar.maxWidth).toBe(1300 - SIDE_PANEL_MIN_CHAT_WIDTH);
  });

  it('never shrinks below the panel minimum', () => {
    const docked = layout({
      mode: 'docked',
      viewportWidth: SIDE_PANEL_DOCK_MIN_VIEWPORT,
      sidebarWidth: 480,
      width: 900,
    });

    expect(docked.maxWidth).toBe(SIDE_PANEL_WIDTH_MIN);
    expect(docked.width).toBe(SIDE_PANEL_WIDTH_MIN);
  });

  it('lets the drag preview override the persisted width within the responsive bound', () => {
    const preview = layout({ mode: 'docked', viewportWidth: 1400, width: 480, previewWidth: 900 });

    expect(preview.width).toBe(1400 - 272 - SIDE_PANEL_MIN_CHAT_WIDTH);
  });
});

describe('useSidePanelResize', () => {
  it('previews the drag locally and only commits on release', () => {
    setViewportWidth(1440);
    useUiStore.setState({ sidePanelMode: 'docked' });

    const { result } = renderHook(() => useSidePanelResize());

    expect(result.current.mode).toBe('docked');
    expect(result.current.layout.docked).toBe(true);

    act(() => result.current.onResize(560));
    expect(result.current.layout.width).toBe(560);
    expect(useUiStore.getState().sidePanelWidth).toBe(SIDE_PANEL_WIDTH_DEFAULT);

    act(() => result.current.onResizeEnd(560));
    expect(useUiStore.getState().sidePanelWidth).toBe(560);
    expect(result.current.layout.width).toBe(560);
  });

  it('clamps the committed width to the current viewport bound', () => {
    setViewportWidth(1200);
    useUiStore.setState({ sidePanelMode: 'docked', sidebarOpen: false });

    const { result } = renderHook(() => useSidePanelResize());

    act(() => result.current.onResizeEnd(900));

    // 1200 − 0 (sidebar fechada) − 480 (chat mínimo) = 720.
    expect(useUiStore.getState().sidePanelWidth).toBe(720);
  });

  it('follows the responsive fallback while the window shrinks', () => {
    setViewportWidth(1440);
    useUiStore.setState({ sidePanelMode: 'docked', sidebarOpen: true, sidePanelWidth: 648 });

    const { result } = renderHook(() => useSidePanelResize());
    expect(result.current.layout.docked).toBe(true);

    act(() => setViewportWidth(SIDE_PANEL_DOCK_MIN_VIEWPORT - 40));

    expect(result.current.layout.docked).toBe(false);
    expect(result.current.mode).toBe('docked');
  });

  it('resets to the design default and clears the preview', () => {
    setViewportWidth(1440);

    const { result } = renderHook(() => useSidePanelResize());

    act(() => result.current.onReset());

    expect(useUiStore.getState().sidePanelWidth).toBe(SIDE_PANEL_WIDTH_DEFAULT);
    expect(result.current.layout.width).toBe(SIDE_PANEL_WIDTH_DEFAULT);
  });
});
