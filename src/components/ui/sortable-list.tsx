import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { cn } from '@/lib/utils';

type DropPosition = 'before' | 'after';

interface DropTarget {
  id: string;
  position: DropPosition;
}

interface ItemRect {
  id: string;
  top: number;
  bottom: number;
}

export interface SortableItemProps {
  ref: (element: HTMLElement | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
  'aria-keyshortcuts': string;
  'aria-describedby': string;
}

export interface SortableDropProps {
  'data-drop'?: DropPosition;
  'data-dragging'?: 'true';
}

export interface SortableListApi {
  disabled: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  itemProps: (id: string) => SortableItemProps;
  dropProps: (id: string) => SortableDropProps;
}

export interface SortableListProps {
  ids: string[];
  label: string;
  itemLabel?: (id: string) => string;
  disabled?: boolean;
  /** Items at the start that cannot be dragged or crossed. */
  lockedCount?: number;
  onReorder: (ids: string[]) => void;
  children: (api: SortableListApi) => ReactNode;
}

const DRAG_THRESHOLD = 5;
const EDGE = 24;
const SCROLL_STEP = 8;

/** Drop line + dimmed source row, applied to each row wrapper. */
export const sortableDropClass = cn(
  'relative',
  'data-[dragging=true]:opacity-40',
  'data-[drop=before]:before:pointer-events-none data-[drop=before]:before:absolute data-[drop=before]:before:inset-x-1 data-[drop=before]:before:-top-px data-[drop=before]:before:h-0.5 data-[drop=before]:before:rounded-full data-[drop=before]:before:bg-accent',
  'data-[drop=after]:after:pointer-events-none data-[drop=after]:after:absolute data-[drop=after]:after:inset-x-1 data-[drop=after]:after:-bottom-px data-[drop=after]:after:h-0.5 data-[drop=after]:after:rounded-full data-[drop=after]:after:bg-accent',
);

function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null;
  while (current) {
    const style = window.getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Pointer-based sortable list (HTML5 drag is blocked by Tauri's
 * `dragDropEnabled` on Windows). It reorders only inside its own list: callers
 * render one instance per sidebar section.
 */
export function SortableList({
  ids,
  label,
  itemLabel,
  disabled = false,
  lockedCount = 0,
  onReorder,
  children,
}: SortableListProps): ReactElement {
  const instructionsId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const elementsRef = useRef(new Map<string, HTMLElement>());
  const idsRef = useRef(ids);
  const lockedRef = useRef(lockedCount);
  const disabledRef = useRef(disabled);
  const onReorderRef = useRef(onReorder);
  const itemLabelRef = useRef(itemLabel);
  const labelRef = useRef(label);
  const dropRef = useRef<DropTarget | null>(null);
  const suppressClickRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  idsRef.current = ids;
  lockedRef.current = lockedCount;
  disabledRef.current = disabled;
  onReorderRef.current = onReorder;
  itemLabelRef.current = itemLabel;
  labelRef.current = label;

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => () => cleanupRef.current?.(), []);

  const register = useCallback((id: string, element: HTMLElement | null) => {
    if (element) elementsRef.current.set(id, element);
    else elementsRef.current.delete(id);
  }, []);

  const measure = useCallback((): ItemRect[] => {
    const rects: ItemRect[] = [];
    for (const id of idsRef.current) {
      const element = elementsRef.current.get(id);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      rects.push({ id, top: rect.top, bottom: rect.bottom });
    }
    return rects;
  }, []);

  const beginDrag = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (disabledRef.current || event.button !== 0) return;
    const currentIds = idsRef.current;
    const index = currentIds.indexOf(id);
    if (index < 0 || index < lockedRef.current || currentIds.length < 2) return;

    suppressClickRef.current = false;
    const element = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let pointerX = startX;
    let pointerY = startY;
    let started = false;
    let frame = 0;
    let rects: ItemRect[] = [];
    let scroller: HTMLElement | null = null;

    try {
      element.setPointerCapture?.(pointerId);
    } catch {
      /* jsdom / detached element */
    }

    const setDropState = (next: DropTarget | null) => {
      const previous = dropRef.current;
      if (previous?.id === next?.id && previous?.position === next?.position) return;
      dropRef.current = next;
      setDrop(next);
    };

    const updateDrop = () => {
      const container = containerRef.current;
      if (!container || rects.length === 0) {
        setDropState(null);
        return;
      }
      const bounds = container.getBoundingClientRect();
      const viewport = scroller?.getBoundingClientRect() ?? bounds;
      const top = Math.max(bounds.top, viewport.top);
      const bottom = Math.min(bounds.bottom, viewport.bottom);
      if (
        pointerX < bounds.left - EDGE ||
        pointerX > bounds.right + EDGE ||
        pointerY < top - EDGE ||
        pointerY > bottom + EDGE
      ) {
        setDropState(null);
        return;
      }
      const candidates = rects.filter((rect) => {
        const idIndex = idsRef.current.indexOf(rect.id);
        return rect.id !== id && idIndex >= lockedRef.current;
      });
      if (candidates.length === 0) {
        setDropState(null);
        return;
      }
      const next = candidates.find(
        (rect) => pointerY < rect.top + (rect.bottom - rect.top) / 2,
      );
      setDropState(
        next
          ? { id: next.id, position: 'before' }
          : { id: candidates[candidates.length - 1].id, position: 'after' },
      );
    };

    const tick = () => {
      if (!started) return;
      if (scroller) {
        const bounds = scroller.getBoundingClientRect();
        let delta = 0;
        if (pointerY < bounds.top + EDGE) delta = -SCROLL_STEP;
        else if (pointerY > bounds.bottom - EDGE) delta = SCROLL_STEP;
        if (delta !== 0) {
          const before = scroller.scrollTop;
          scroller.scrollTop += delta;
          if (scroller.scrollTop !== before) {
            rects = measure();
            updateDrop();
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };

    const commit = () => {
      const target = dropRef.current;
      if (!target) return;
      const current = idsRef.current;
      const from = current.indexOf(id);
      if (from < 0) return;
      const remaining = current.filter((item) => item !== id);
      const targetIndex = remaining.indexOf(target.id);
      if (targetIndex < 0) return;
      let insertAt = targetIndex + (target.position === 'after' ? 1 : 0);
      insertAt = Math.max(lockedRef.current, Math.min(insertAt, remaining.length));
      const next = [...remaining.slice(0, insertAt), id, ...remaining.slice(insertAt)];
      if (next.every((item, itemIndex) => item === current[itemIndex])) return;
      onReorderRef.current(next);
      setAnnouncement(
        `${labelRef.current}: ${itemLabelRef.current?.(id) ?? id} movido para a posição ${
          next.indexOf(id) + 1
        } de ${next.length}`,
      );
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onWindowKeyDown, true);
      window.removeEventListener('blur', onCancel);
      cancelAnimationFrame(frame);
      document.body.classList.remove('lumina-sortable-dragging');
      try {
        if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
      } catch {
        /* detached element */
      }
      cleanupRef.current = null;
    };

    const onMove = (moveEvent: PointerEvent) => {
      pointerX = moveEvent.clientX;
      pointerY = moveEvent.clientY;
      if (!started) {
        if (Math.hypot(pointerX - startX, pointerY - startY) < DRAG_THRESHOLD) return;
        started = true;
        rects = measure();
        scroller = findScrollParent(containerRef.current);
        document.body.classList.add('lumina-sortable-dragging');
        setDraggingId(id);
        frame = requestAnimationFrame(tick);
      }
      moveEvent.preventDefault();
      updateDrop();
    };

    const onUp = (upEvent: PointerEvent) => {
      pointerX = upEvent.clientX;
      pointerY = upEvent.clientY;
      const wasStarted = started;
      if (wasStarted) {
        updateDrop();
        suppressClickRef.current = true;
      }
      cleanup();
      if (wasStarted) commit();
      setDraggingId(null);
      setDropState(null);
    };

    const onCancel = () => {
      if (started) suppressClickRef.current = true;
      cleanup();
      setDraggingId(null);
      setDropState(null);
    };

    const onWindowKeyDown = (keyEvent: globalThis.KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      onCancel();
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onWindowKeyDown, true);
    window.addEventListener('blur', onCancel);
    cleanupRef.current = cleanup;
  };

  const handleItemKeyDown = (event: KeyboardEvent<HTMLElement>, id: string) => {
    if (disabledRef.current) return;
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const current = idsRef.current;
    const index = current.indexOf(id);
    if (index < 0 || index < lockedRef.current) return;
    const target = event.key === 'ArrowUp' ? index - 1 : index + 1;
    if (target < lockedRef.current || target >= current.length) return;
    event.preventDefault();
    event.stopPropagation();
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    onReorderRef.current(next);
    setAnnouncement(
      `${labelRef.current}: ${itemLabelRef.current?.(id) ?? id} movido para a posição ${
        target + 1
      } de ${current.length}`,
    );
  };

  const itemProps = (id: string): SortableItemProps => ({
    ref: (element) => register(id, element),
    onPointerDown: (event) => beginDrag(event, id),
    onKeyDown: (event) => handleItemKeyDown(event, id),
    onClickCapture: (event) => {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown',
    'aria-describedby': instructionsId,
  });

  const dropProps = (id: string): SortableDropProps => ({
    'data-drop': drop?.id === id ? drop.position : undefined,
    'data-dragging': draggingId === id ? 'true' : undefined,
  });

  return (
    <>
      {children({ disabled, containerRef, itemProps, dropProps })}
      <span id={instructionsId} className="sr-only">
        Use Alt+Seta para cima ou Alt+Seta para baixo para reordenar.
      </span>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
