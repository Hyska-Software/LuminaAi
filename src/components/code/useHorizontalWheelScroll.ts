import { useEffect, type RefObject } from 'react';

/**
 * Maps the vertical mouse wheel to horizontal scrolling on an overflowing
 * strip. Trackpad gestures with a horizontal delta keep working; the scroll
 * clamps at both ends instead of overscrolling.
 *
 * A native non-passive listener is required: React's wheel handler is passive,
 * so `preventDefault` there cannot stop the parent from scrolling.
 */
export function useHorizontalWheelScroll<T extends HTMLElement>(ref: RefObject<T | null>): void {
  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;

    const onWheel = (event: WheelEvent) => {
      if (strip.scrollWidth <= strip.clientWidth) return;
      // Trackpad gestures already carry deltaX; a mouse wheel only has deltaY.
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (delta === 0) return;
      const maxScroll = strip.scrollWidth - strip.clientWidth;
      const next = Math.min(maxScroll, Math.max(0, strip.scrollLeft + delta));
      if (next === strip.scrollLeft) return;
      event.preventDefault();
      strip.scrollLeft = next;
    };

    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  }, [ref]);
}
