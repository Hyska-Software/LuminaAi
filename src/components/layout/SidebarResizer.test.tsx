// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_STEP,
} from '@/lib/store';
import { SidebarResizer } from './SidebarResizer';

const LABEL = 'Redimensionar barra lateral';
const HINT = 'Arraste para redimensionar · duplo clique para restaurar';

interface ResizerHarness {
  handle: HTMLElement;
  line: HTMLElement;
  onResize: ReturnType<typeof vi.fn>;
  onResizeEnd: ReturnType<typeof vi.fn>;
  onReset: ReturnType<typeof vi.fn>;
}

function lineOf(handle: HTMLElement): HTMLElement {
  const line = handle.firstElementChild;
  if (!(line instanceof HTMLElement)) throw new Error('SidebarResizer is missing its 1px visual line');
  return line;
}

function renderResizer(width = SIDEBAR_WIDTH_DEFAULT): ResizerHarness {
  const onResize = vi.fn();
  const onResizeEnd = vi.fn();
  const onReset = vi.fn();
  render(
    <SidebarResizer width={width} onResize={onResize} onResizeEnd={onResizeEnd} onReset={onReset} />,
  );
  const handle = screen.getByRole('separator', { name: LABEL });
  return { handle, line: lineOf(handle), onResize, onResizeEnd, onReset };
}

afterEach(() => {
  cleanup();
  document.body.style.cursor = '';
  document.body.style.removeProperty('user-select');
});

describe('SidebarResizer — acessibilidade', () => {
  it('exposes the full separator semantics and the current width', () => {
    const { handle } = renderResizer(320);

    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-label')).toBe(LABEL);
    expect(handle.getAttribute('aria-valuenow')).toBe('320');
    expect(handle.getAttribute('aria-valuemin')).toBe(String(SIDEBAR_WIDTH_MIN));
    expect(handle.getAttribute('aria-valuemax')).toBe(String(SIDEBAR_WIDTH_MAX));
    expect(handle.getAttribute('aria-valuetext')).toBe('320 px');
    expect(handle.tabIndex).toBe(0);
    expect(handle.title).toBe(HINT);
  });

  it('renders a thin col-resize grip with a hidden 1px line', () => {
    const { handle, line } = renderResizer();

    expect(handle.className).toContain('w-2');
    expect(handle.className).toContain('cursor-col-resize');
    expect(handle.className).toContain('touch-none');
    expect(handle.className).toContain('h-full');

    expect(line.className).toContain('w-px');
    expect(line.className).toContain('bg-transparent');
    expect(line.className).toContain('group-hover:bg-border-strong');
    expect(line.className).toContain('group-focus-visible:bg-accent');
  });
});

describe('SidebarResizer — teclado', () => {
  it('moves by SIDEBAR_WIDTH_STEP with the arrows and commits each step', () => {
    const { handle, onResize, onResizeEnd } = renderResizer(272);

    expect(fireEvent.keyDown(handle, { key: 'ArrowRight' })).toBe(false);
    expect(onResize).toHaveBeenLastCalledWith(272 + SIDEBAR_WIDTH_STEP);
    expect(onResizeEnd).toHaveBeenLastCalledWith(272 + SIDEBAR_WIDTH_STEP);

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onResize).toHaveBeenLastCalledWith(272 - SIDEBAR_WIDTH_STEP);
    expect(onResizeEnd).toHaveBeenLastCalledWith(272 - SIDEBAR_WIDTH_STEP);
  });

  it('jumps straight to the bounds with Home and End', () => {
    const { handle, onResize, onResizeEnd } = renderResizer(300);

    expect(fireEvent.keyDown(handle, { key: 'Home' })).toBe(false);
    expect(onResize).toHaveBeenLastCalledWith(SIDEBAR_WIDTH_MIN);
    expect(onResizeEnd).toHaveBeenLastCalledWith(SIDEBAR_WIDTH_MIN);

    expect(fireEvent.keyDown(handle, { key: 'End' })).toBe(false);
    expect(onResize).toHaveBeenLastCalledWith(SIDEBAR_WIDTH_MAX);
    expect(onResizeEnd).toHaveBeenLastCalledWith(SIDEBAR_WIDTH_MAX);
  });

  it('clamps a step below the minimum', () => {
    const { handle, onResize } = renderResizer(SIDEBAR_WIDTH_MIN + 4);

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });

    expect(onResize).toHaveBeenLastCalledWith(SIDEBAR_WIDTH_MIN);
  });

  it('clamps a step above the maximum', () => {
    const { handle, onResize } = renderResizer(SIDEBAR_WIDTH_MAX - 4);

    fireEvent.keyDown(handle, { key: 'ArrowRight' });

    expect(onResize).toHaveBeenLastCalledWith(SIDEBAR_WIDTH_MAX);
  });

  it('ignores unrelated keys', () => {
    const { handle, onResize, onResizeEnd } = renderResizer();

    fireEvent.keyDown(handle, { key: 'Enter' });
    fireEvent.keyDown(handle, { key: 'Escape' });

    expect(onResize).not.toHaveBeenCalled();
    expect(onResizeEnd).not.toHaveBeenCalled();
  });
});

describe('SidebarResizer — arrasto', () => {
  it('follows the pointer, locks the page cursor and commits once on pointer up', () => {
    const { handle, onResize, onResizeEnd } = renderResizer(272);

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 300 });

    expect(document.activeElement).toBe(handle);
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.getPropertyValue('user-select')).toBe('none');

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 340 });
    expect(onResize).toHaveBeenLastCalledWith(312);

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 330 });
    expect(onResize).toHaveBeenLastCalledWith(302);

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    expect(onResizeEnd).toHaveBeenLastCalledWith(302);
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.getPropertyValue('user-select')).toBe('');

    // Stray events after the drag ended must not commit again.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 });
    fireEvent.lostPointerCapture(handle, { pointerId: 1 });
    expect(onResize).toHaveBeenCalledTimes(2);
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
  });

  it('clamps the dragged width at both bounds and commits the clamped value', () => {
    const { handle, onResize, onResizeEnd } = renderResizer(272);

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -400 });
    expect(onResize).toHaveBeenLastCalledWith(SIDEBAR_WIDTH_MIN);

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 5000 });
    expect(onResize).toHaveBeenLastCalledWith(SIDEBAR_WIDTH_MAX);

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onResizeEnd).toHaveBeenLastCalledWith(SIDEBAR_WIDTH_MAX);
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
  });

  it('commits the last width on pointercancel', () => {
    const { handle, onResizeEnd } = renderResizer();

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 320 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });

    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    expect(onResizeEnd).toHaveBeenLastCalledWith(292);
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.getPropertyValue('user-select')).toBe('');
  });

  it('commits the last width when the pointer capture is lost', () => {
    const { handle, onResizeEnd } = renderResizer();

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 320 });
    fireEvent.lostPointerCapture(handle, { pointerId: 1 });

    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    expect(onResizeEnd).toHaveBeenLastCalledWith(292);
  });

  it('does not start a drag on a non-primary button', () => {
    const { handle, onResize, onResizeEnd } = renderResizer();

    fireEvent.pointerDown(handle, { button: 2, pointerId: 1, clientX: 300 });

    expect(document.activeElement).not.toBe(handle);
    expect(document.body.style.cursor).toBe('');

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onResize).not.toHaveBeenCalled();
    expect(onResizeEnd).not.toHaveBeenCalled();
  });

  it('ignores movements from a different pointer', () => {
    const { handle, onResize, onResizeEnd } = renderResizer();

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 500 });
    expect(onResize).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, { pointerId: 2 });
    expect(onResizeEnd).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('col-resize');

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
  });

  it('does not restart the gesture when another pointer goes down mid-drag', () => {
    const { handle, onResizeEnd } = renderResizer();

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 300 });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientX: 500 });

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    expect(document.body.style.cursor).toBe('');
  });
});

describe('SidebarResizer — atalhos e feedback visual', () => {
  it('restores the default width on double click', () => {
    const { handle, onReset } = renderResizer(400);

    fireEvent.doubleClick(handle);

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('reveals the accent line only while the handle is being dragged', () => {
    const { handle } = renderResizer();

    expect(lineOf(handle).className).toContain('bg-transparent');

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 300 });
    expect(lineOf(handle).className).toContain('bg-accent');

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(lineOf(handle).className).toContain('bg-transparent');
  });
});
