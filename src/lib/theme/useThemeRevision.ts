/**
 * Re-renders token-reading widgets (e.g. the sandboxed HTML preview) whenever a
 * theme is applied, including switches that do not change the light/dark class.
 */
import { useEffect, useState } from 'react';

import { THEME_APPLIED_EVENT } from './apply';

export function useThemeRevision(): number {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setRevision((value) => value + 1);
    window.addEventListener(THEME_APPLIED_EVENT, handler);
    return () => window.removeEventListener(THEME_APPLIED_EVENT, handler);
  }, []);

  return revision;
}
