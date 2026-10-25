// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('./TitleBar', () => ({ TitleBar: () => <div data-testid="title-bar" /> }));
vi.mock('./Sidebar', () => ({ Sidebar: () => <div data-testid="sidebar" /> }));
vi.mock('@/lib/api', () => ({ api: {} }));

import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_STEP,
  useAppStore,
  useUiStore,
} from '@/lib/store';
import { AppShell } from './AppShell';

const LABEL = 'Redimensionar barra lateral';
const originalMatchMedia = window.matchMedia;

/** jsdom setup returns `matches: false`; tests may force the compact layout. */
function matchMediaReturning(matches: boolean): typeof window.matchMedia {
  return vi.fn((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })) as unknown as typeof window.matchMedia;
}

const separator = (): HTMLElement | null => screen.queryByRole('separator', { name: LABEL });
const requiredSeparator = (): HTMLElement => screen.getByRole('separator', { name: LABEL });

/** The wrapper that receives the effective sidebar width (inside the motion box). */
function sidebarContainer(): HTMLElement {
  const wrapper = screen.getByTestId('sidebar').parentElement;
  if (!wrapper) throw new Error('mocked Sidebar is not wrapped by AppShell');
  return wrapper;
}

function renderShell() {
  render(
    <AppShell>
      <div data-testid="content" />
    </AppShell>,
  );
}

beforeEach(() => {
  window.matchMedia = matchMediaReturning(false);
  // Motion is covered by its own unit; keep the shell assertions synchronous.
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, reduceMotion: true } });
  useUiStore.setState({ sidebarOpen: true, sidebarWidth: SIDEBAR_WIDTH_DEFAULT });
});

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  document.body.style.cursor = '';
  document.body.style.removeProperty('user-select');
});

describe('AppShell — sidebar redimensionável', () => {
  it('applies the persisted width to the sidebar container and to the divider', () => {
    useUiStore.setState({ sidebarWidth: 320 });

    renderShell();

    expect(sidebarContainer().style.width).toBe('320px');

    const handle = requiredSeparator();
    expect(handle.getAttribute('aria-valuenow')).toBe('320');
    expect(handle.getAttribute('aria-valuetext')).toBe('320 px');
    // Absolutely positioned right after the sidebar edge: it adds no layout width.
    expect(handle.parentElement?.className).toContain('absolute');
    expect(handle.parentElement?.style.left).toBe('320px');
  });

  it('hides the divider when the sidebar is collapsed', () => {
    useUiStore.setState({ sidebarOpen: false, sidebarWidth: 320 });

    renderShell();

    expect(separator()).toBeNull();
  });

  it('does not render the divider in the compact drawer layout', () => {
    window.matchMedia = matchMediaReturning(true);
    useUiStore.setState({ sidebarOpen: true });

    renderShell();

    expect(separator()).toBeNull();
  });

  it('updates the persisted width from the keyboard', () => {
    renderShell();

    fireEvent.keyDown(requiredSeparator(), { key: 'ArrowRight' });

    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT + SIDEBAR_WIDTH_STEP);
    expect(sidebarContainer().style.width).toBe(`${SIDEBAR_WIDTH_DEFAULT + SIDEBAR_WIDTH_STEP}px`);
    expect(requiredSeparator().getAttribute('aria-valuenow')).toBe(
      String(SIDEBAR_WIDTH_DEFAULT + SIDEBAR_WIDTH_STEP),
    );

    fireEvent.keyDown(requiredSeparator(), { key: 'End' });

    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_MAX);
    expect(requiredSeparator().getAttribute('aria-valuenow')).toBe(String(SIDEBAR_WIDTH_MAX));
  });

  it('previews the width while dragging and only persists it when the drag ends', () => {
    renderShell();
    const handle = requiredSeparator();

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 400 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 450 });

    // The transient preview resizes the shell without touching the store…
    expect(sidebarContainer().style.width).toBe(`${SIDEBAR_WIDTH_DEFAULT + 50}px`);
    expect(requiredSeparator().getAttribute('aria-valuenow')).toBe(
      String(SIDEBAR_WIDTH_DEFAULT + 50),
    );
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT);

    // …and the release commits the final width.
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 450 });
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT + 50);
    expect(sidebarContainer().style.width).toBe(`${SIDEBAR_WIDTH_DEFAULT + 50}px`);
  });

  it('restores the default width on double click', () => {
    useUiStore.setState({ sidebarWidth: 400 });

    renderShell();

    fireEvent.doubleClick(requiredSeparator());

    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(sidebarContainer().style.width).toBe(`${SIDEBAR_WIDTH_DEFAULT}px`);
  });
});
