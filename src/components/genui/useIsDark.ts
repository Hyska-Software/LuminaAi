import { useEffect, useState } from 'react';

/**
 * Tracks the app theme (`dark` class on `<html>`) so media-like widgets
 * (Mermaid, HTML preview) can re-render when the user switches theme.
 */
export function useIsDark(): boolean {
  const [dark, setDark] = useState<boolean>(() =>
    typeof document === 'undefined' ? false : document.documentElement.classList.contains('dark'),
  );

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setDark(root.classList.contains('dark')));
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return dark;
}
