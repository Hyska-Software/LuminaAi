import { useCallback, useSyncExternalStore } from 'react';
import { useAppStore } from '@/lib/store';

/** Breakpoint below which the sidebar becomes an overlay drawer (DESIGN §13). */
export const COMPACT_SIDEBAR_QUERY = '(max-width: 1023px)';

/** Subscribes to a CSS media query without tearing during concurrent renders. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (typeof window === 'undefined') return () => {};
      const media = window.matchMedia(query);
      media.addEventListener('change', onStoreChange);
      return () => media.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  }, [query]);

  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** `true` when the window is narrower than the desktop layout (sidebar as drawer). */
export function useIsCompact(): boolean {
  return useMediaQuery(COMPACT_SIDEBAR_QUERY);
}

/**
 * Motion should be reduced when the user asks so either through app settings
 * (DESIGN §11) or through the OS level `prefers-reduced-motion` media query.
 */
export function useReduceMotion(): boolean {
  const setting = useAppStore((state) => state.settings.reduceMotion);
  const prefersReduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  return setting || prefersReduced;
}
