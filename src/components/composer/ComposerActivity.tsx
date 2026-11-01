import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface ComposerActivityProps {
  /** A turn is running: the ring is visible and the comet orbits. */
  active: boolean;
  /** Removes the orbit (static comet) without hiding the execution state. */
  reduceMotion: boolean;
}

interface Box {
  width: number;
  height: number;
  /** Outer border radius of the composer, in CSS pixels. */
  radius: number;
}

/** `rounded-3xl` at the default 16px root size. */
const DEFAULT_RADIUS = 32;

/**
 * Full-perimeter execution indicator for the composer.
 *
 * The old indicator was a half-width bar pinned to the top edge, so it only
 * ever lit one side of the input. This version draws a rounded SVG track in the
 * border annulus of the composer and runs a bright comet along it. Three
 * overlapping dash layers (tail, body, head) make the tail taper without a
 * gradient, and `pathLength=100` keeps the motion uniform around the whole
 * perimeter instead of following the aspect ratio of the composer.
 */
export function ComposerActivity({ active, reduceMotion }: ComposerActivityProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const measure = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      // The font-scale setting changes the rem-based `rounded-3xl`; read the
      // used radius instead of assuming 2rem so the ring follows the corners.
      const parent = host.parentElement;
      const computed = parent ? window.getComputedStyle(parent) : null;
      const measuredRadius = computed
        ? Number.parseFloat(computed.borderTopLeftRadius)
        : Number.NaN;
      const radius =
        Number.isFinite(measuredRadius) && measuredRadius > 0
          ? measuredRadius
          : DEFAULT_RADIUS;
      setBox((previous) =>
        previous &&
        previous.width === rect.width &&
        previous.height === rect.height &&
        previous.radius === radius
          ? previous
          : { width: rect.width, height: rect.height, radius },
      );
    };

    measure();
    // jsdom (unit tests) does not implement ResizeObserver; the initial measure
    // is enough for the component to render there.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
    // Re-measure when a turn starts so a font-scale change is picked up even if
    // the composer box happened to keep the same size.
  }, [active]);

  const orbitRadius = box ? Math.max(0, box.radius - 0.75) : 0;

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      data-testid="composer-activity"
      data-active={active ? 'true' : 'false'}
      data-motion={reduceMotion ? 'reduced' : 'orbit'}
      className={cn(
        'pointer-events-none absolute -inset-px z-0 transition-opacity duration-300 ease-[var(--ease-out-soft)]',
        active ? 'opacity-100' : 'opacity-0',
      )}
    >
      {box ? (
        <svg
          data-testid="composer-orbit"
          className={cn(
            'absolute inset-0 size-full',
            !reduceMotion && 'composer-orbit-animate',
            !active && 'composer-orbit-paused',
          )}
          viewBox={`0 0 ${box.width} ${box.height}`}
        >
          {/*
           * The rects sit on the 1px border centerline. `pathLength=100`
           * normalizes dash units, so every composer size gets the same comet
           * proportions; the three offsets align tail → body → head.
           */}
          <rect
            className="composer-orbit-tail"
            x={0.75}
            y={0.75}
            width={Math.max(0, box.width - 1.5)}
            height={Math.max(0, box.height - 1.5)}
            rx={orbitRadius}
            ry={orbitRadius}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="9 91"
            strokeDashoffset={0}
            opacity={0.22}
          />
          <rect
            className="composer-orbit-body"
            x={0.75}
            y={0.75}
            width={Math.max(0, box.width - 1.5)}
            height={Math.max(0, box.height - 1.5)}
            rx={orbitRadius}
            ry={orbitRadius}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.25}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="4.2 95.8"
            strokeDashoffset={-4.2}
            opacity={0.55}
          />
          <rect
            className="composer-orbit-head"
            x={0.75}
            y={0.75}
            width={Math.max(0, box.width - 1.5)}
            height={Math.max(0, box.height - 1.5)}
            rx={orbitRadius}
            ry={orbitRadius}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.5}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="1.6 98.4"
            strokeDashoffset={-8.4}
            opacity={1}
          />
        </svg>
      ) : null}
    </div>
  );
}
