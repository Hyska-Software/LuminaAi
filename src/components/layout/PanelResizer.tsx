import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** Which edge of the resized surface the handle controls. */
export type PanelResizerSide = 'start' | 'end';

/** Translation key of the default tooltip (discoverability + double-click reset). */
export const PANEL_RESIZER_HINT = 'panelResizer.hint' as const;

export interface PanelResizerProps {
  /** Current width of the surface being resized, in px. */
  value: number;
  min: number;
  max: number;
  /** Width change per arrow key press (default 16). */
  step?: number;
  /**
   * `start` resizes the right edge of a surface anchored to the left (sidebar):
   * dragging right grows it and the 1px line sits at the handle start. `end`
   * resizes the left edge of a surface anchored to the right (side panels):
   * dragging left grows it and the line sits at the handle end.
   */
  side?: PanelResizerSide;
  /** Accessible name of the separator. */
  label: string;
  /** Tooltip; defaults to `PANEL_RESIZER_HINT`. */
  hint?: string;
  /** Transient callback fired while dragging and while stepping with keys. */
  onResize: (width: number) => void;
  /** Commit callback fired once the drag ends (or on each keyboard step). */
  onResizeEnd: (width: number) => void;
  /** Restores the default width (double click); omitted = no shortcut. */
  onReset?: () => void;
  className?: string;
}

/** Inline styles of `document.body` saved before a drag and restored afterwards. */
interface PageCursor {
  cursor: string;
  userSelect: string;
}

interface DragState {
  pointerId: number;
  /** Pointer X at pointerdown, so every move is computed from an absolute origin. */
  startX: number;
  startValue: number;
  /** Last width seen during this drag; committed on release. */
  lastValue: number;
  page: PageCursor;
}

/** Keeps a width inside the supported range, rounded to whole pixels. */
function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Locks the whole page chrome while the divider is being dragged. */
function lockPageCursor(): PageCursor {
  const body = document.body;
  const previous: PageCursor = {
    cursor: body.style.cursor,
    userSelect: body.style.getPropertyValue('user-select'),
  };
  body.style.cursor = 'col-resize';
  body.style.setProperty('user-select', 'none');
  return previous;
}

function unlockPageCursor(previous: PageCursor): void {
  const body = document.body;
  body.style.cursor = previous.cursor;
  if (previous.userSelect) body.style.setProperty('user-select', previous.userSelect);
  else body.style.removeProperty('user-select');
}

/**
 * Accessible, draggable divider used by resizable surfaces (DESIGN §5/§12):
 * the sidebar's right edge and the side panels' left edge.
 *
 * The caller positions the 8px strip (usually absolutely, right after/before
 * the surface edge) and owns the width state; this component only reports the
 * transient width (`onResize`) and the committed one (`onResizeEnd`). Pointer
 * capture keeps the drag alive outside the strip; keyboard users step with the
 * arrows and jump to the bounds with Home/End.
 */
export function PanelResizer({
  value,
  min,
  max,
  step = 16,
  side = 'start',
  label,
  hint,
  onResize,
  onResizeEnd,
  onReset,
  className,
}: PanelResizerProps) {
  const { t } = useTranslation('common');
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  /* Dragging left grows a surface anchored to the right; the opposite for the
     sidebar, whose right edge moves right as it grows. */
  const direction = side === 'end' ? -1 : 1;

  /* A drag can be interrupted by an unmount (layout switch, panel close):
     never leave the page stuck with the resizing cursor. */
  useEffect(() => {
    return () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      unlockPageCursor(drag.page);
    };
  }, []);

  const finishDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    unlockPageCursor(drag.page);
    setDragging(false);
    onResizeEnd(clampValue(drag.lastValue, min, max));
  }, [max, min, onResizeEnd]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Primary button only, and one gesture at a time (a second finger must not
    // hijack a drag in progress).
    if (event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    try {
      // Capture keeps the drag alive when the pointer leaves the 8px strip.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is unavailable: the drag still tracks on the handle */
    }

    const startValue = clampValue(value, min, max);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue,
      lastValue: startValue,
      page: lockPageCursor(),
    };
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clampValue(
      drag.startValue + direction * (event.clientX - drag.startX),
      min,
      max,
    );
    drag.lastValue = next;
    onResize(next);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    finishDrag();
  };

  const handleLostPointerCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    finishDrag();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = clampValue(value, min, max);
    let next: number;
    switch (event.key) {
      case 'ArrowLeft':
        next = clampValue(current - direction * step, min, max);
        break;
      case 'ArrowRight':
        next = clampValue(current + direction * step, min, max);
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      default:
        return;
    }
    event.preventDefault();
    onResize(next);
    onResizeEnd(next);
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!onReset) return;
    event.preventDefault();
    onReset();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`${value} px`}
      title={hint ?? t(PANEL_RESIZER_HINT)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handleLostPointerCapture}
      onKeyDown={handleKeyDown}
      onDoubleClick={handleDoubleClick}
      className={cn(
        'group flex h-full w-2 cursor-col-resize touch-none select-none items-stretch focus-visible:outline-none',
        side === 'end' ? 'justify-end' : 'justify-start',
        className,
      )}
    >
      <div
        aria-hidden
        className={cn(
          'h-full w-px transition-colors duration-150',
          'group-focus-visible:bg-accent',
          dragging ? 'bg-accent' : 'bg-transparent group-hover:bg-border-strong',
        )}
      />
    </div>
  );
}
