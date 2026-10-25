// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PanelResizer, PANEL_RESIZER_HINT, type PanelResizerSide } from './PanelResizer';

const LABEL = 'Redimensionar painel de teste';
const VALUE = 480;
const MIN = 360;
const MAX = 560;
const STEP = 16;

interface Harness {
  handle: HTMLElement;
  line: HTMLElement;
  onResize: ReturnType<typeof vi.fn>;
  onResizeEnd: ReturnType<typeof vi.fn>;
  onReset: ReturnType<typeof vi.fn>;
}

interface RenderOptions {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  side?: PanelResizerSide;
  hint?: string;
  /** `false` renders the optional reset action out. */
  reset?: boolean;
}

function lineOf(handle: HTMLElement): HTMLElement {
  const line = handle.lastElementChild;
  if (!(line instanceof HTMLElement)) throw new Error('PanelResizer is missing its 1px visual line');
  return line;
}

function renderResizer(options: RenderOptions = {}): Harness {
  const onResize = vi.fn();
  const onResizeEnd = vi.fn();
  const onReset = vi.fn();
  const { reset = true, ...rest } = options;
  render(
    <PanelResizer
      value={VALUE}
      min={MIN}
      max={MAX}
      step={STEP}
      side="end"
      label={LABEL}
      onResize={onResize}
      onResizeEnd={onResizeEnd}
      {...rest}
      {...(reset ? { onReset } : {})}
    />,
  );
  const handle = screen.getByRole('separator', { name: LABEL });
  return { handle, line: lineOf(handle), onResize, onResizeEnd, onReset };
}

afterEach(() => {
  cleanup();
  document.body.style.cursor = '';
  document.body.style.removeProperty('user-select');
});

describe('PanelResizer — acessibilidade e visual', () => {
  it('exposes the separator semantics with the given bounds', () => {
    const { handle } = renderResizer({ value: 520 });

    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-label')).toBe(LABEL);
    expect(handle.getAttribute('aria-valuenow')).toBe('520');
    expect(handle.getAttribute('aria-valuemin')).toBe(String(MIN));
    expect(handle.getAttribute('aria-valuemax')).toBe(String(MAX));
    expect(handle.getAttribute('aria-valuetext')).toBe('520 px');
    expect(handle.tabIndex).toBe(0);
    expect(handle.title).toBe(PANEL_RESIZER_HINT);
  });

  it('accepts a custom tooltip hint', () => {
    const { handle } = renderResizer({ hint: 'Dica personalizada' });

    expect(handle.title).toBe('Dica personalizada');
  });

  it('places the 1px line at the end for side="end"', () => {
    const { handle, line } = renderResizer();

    expect(handle.className).toContain('justify-end');
    expect(handle.className).toContain('cursor-col-resize');
    expect(handle.className).toContain('w-2');
    expect(line.className).toContain('w-px');
    expect(line.className).toContain('bg-transparent');
    expect(line.className).toContain('group-hover:bg-border-strong');
    expect(line.className).toContain('group-focus-visible:bg-accent');
  });

  it('defaults to side="start"', () => {
    const { handle } = renderResizer({ side: undefined });

    expect(handle.className).toContain('justify-start');
  });

  it('places the 1px line at the start for side="start"', () => {
    const { handle } = renderResizer({ side: 'start' });

    expect(handle.className).toContain('justify-start');
  });
});

describe('PanelResizer — teclado (side="end", arrastar para a esquerda aumenta)', () => {
  it('increases with ArrowLeft and decreases with ArrowRight', () => {
    const { handle, onResize, onResizeEnd } = renderResizer();

    expect(fireEvent.keyDown(handle, { key: 'ArrowLeft' })).toBe(false);
    expect(onResize).toHaveBeenLastCalledWith(VALUE + STEP);
    expect(onResizeEnd).toHaveBeenLastCalledWith(VALUE + STEP);

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onResize).toHaveBeenLastCalledWith(VALUE - STEP);
    expect(onResizeEnd).toHaveBeenLastCalledWith(VALUE - STEP);
  });

  it('jumps straight to the bounds with Home and End', () => {
    const { handle, onResize, onResizeEnd } = renderResizer({ value: 500 });

    expect(fireEvent.keyDown(handle, { key: 'Home' })).toBe(false);
    expect(onResize).toHaveBeenLastCalledWith(MIN);
    expect(onResizeEnd).toHaveBeenLastCalledWith(MIN);

    expect(fireEvent.keyDown(handle, { key: 'End' })).toBe(false);
    expect(onResize).toHaveBeenLastCalledWith(MAX);
    expect(onResizeEnd).toHaveBeenLastCalledWith(MAX);
  });

  it('clamps an increasing step at the maximum', () => {
    const { handle, onResize } = renderResizer({ value: MAX - 4 });

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });

    expect(onResize).toHaveBeenLastCalledWith(MAX);
  });

  it('clamps a decreasing step at the minimum', () => {
    const { handle, onResize } = renderResizer({ value: MIN + 4 });

    fireEvent.keyDown(handle, { key: 'ArrowRight' });

    expect(onResize).toHaveBeenLastCalledWith(MIN);
  });

  it('respects a custom step', () => {
    const { handle, onResize } = renderResizer({ step: 8 });

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });

    expect(onResize).toHaveBeenLastCalledWith(VALUE + 8);
  });

  it('ignores unrelated keys', () => {
    const { handle, onResize, onResizeEnd } = renderResizer();

    fireEvent.keyDown(handle, { key: 'Enter' });
    fireEvent.keyDown(handle, { key: 'Escape' });

    expect(onResize).not.toHaveBeenCalled();
    expect(onResizeEnd).not.toHaveBeenCalled();
  });
});

describe('PanelResizer — teclado (side="start", arrastar para a direita aumenta)', () => {
  it('keeps the sidebar direction: ArrowRight increases and ArrowLeft decreases', () => {
    const { handle, onResize } = renderResizer({ side: 'start' });

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onResize).toHaveBeenLastCalledWith(VALUE + STEP);

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onResize).toHaveBeenLastCalledWith(VALUE - STEP);
  });
});

describe('PanelResizer — arrasto (side="end")', () => {
  it('grows when the pointer moves left, locks the page cursor and commits once', () => {
    const { handle, onResize, onResizeEnd } = renderResizer();

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 800 });

    expect(document.activeElement).toBe(handle);
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.getPropertyValue('user-select')).toBe('none');

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 750 });
    expect(onResize).toHaveBeenLastCalledWith(VALUE + 50);

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 830 });
    expect(onResize).toHaveBeenLastCalledWith(VALUE - 30);

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    expect(onResizeEnd).toHaveBeenLastCalledWith(VALUE - 30);
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.getPropertyValue('user-select')).toBe('');

    // Stray events after the drag ended must not commit again.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 900 });
    fireEvent.lostPointerCapture(handle, { pointerId: 1 });
    expect(onResize).toHaveBeenCalledTimes(2);
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
  });

  it('clamps the dragged value at both bounds and commits the clamped value', () => {
    const { handle, onResize, onResizeEnd } = renderResizer();

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 800 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -400 });
    expect(onResize).toHaveBeenLastCalledWith(MAX);

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 5000 });
    expect(onResize).toHaveBeenLastCalledWith(MIN);

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onResizeEnd).toHaveBeenLastCalledWith(MIN);
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
  });

  it('commits the last value on pointercancel', () => {
    const { handle, onResizeEnd } = renderResizer();

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 800 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 780 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });

    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    expect(onResizeEnd).toHaveBeenLastCalledWith(VALUE + 20);
    expect(document.body.style.cursor).toBe('');
  });

  it('does not start a drag on a non-primary button', () => {
    const { handle, onResize, onResizeEnd } = renderResizer();

    fireEvent.pointerDown(handle, { button: 2, pointerId: 1, clientX: 800 });

    expect(document.activeElement).not.toBe(handle);
    expect(document.body.style.cursor).toBe('');

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onResize).not.toHaveBeenCalled();
    expect(onResizeEnd).not.toHaveBeenCalled();
  });
});

describe('PanelResizer — atalhos', () => {
  it('restores the default width on double click', () => {
    const { handle, onReset } = renderResizer();

    fireEvent.doubleClick(handle);

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('does not throw on double click when reset is not provided', () => {
    const { handle } = renderResizer({ reset: false });

    expect(() => fireEvent.doubleClick(handle)).not.toThrow();
  });

  it('reveals the accent line only while dragging', () => {
    const { handle } = renderResizer();

    expect(lineOf(handle).className).toContain('bg-transparent');

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 800 });
    expect(lineOf(handle).className).toContain('bg-accent');

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(lineOf(handle).className).toContain('bg-transparent');
  });
});
