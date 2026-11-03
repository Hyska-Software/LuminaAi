import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import type { ComputerSession } from '@/lib/types';

/**
 * Polls the active computer-use sessions while a surface is mounted.
 *
 * The banner and the agent thread header share this hook so the stop control
 * shows the same backend state. Polling pauses while the window is hidden and
 * is always cleaned up on unmount.
 */
export function useActiveComputerSessions(pollMs = 2_500) {
  const [sessions, setSessions] = useState<ComputerSession[]>([]);
  const disposed = useRef(false);
  const revision = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const list = await api.listActiveComputerSessions();
      if (!disposed.current && request === revision.current) setSessions(list);
    } catch {
      if (!disposed.current && request === revision.current) setSessions([]);
    }
  }, []);

  const clear = useCallback(() => {
    revision.current += 1;
    setSessions([]);
  }, []);

  useEffect(() => {
    disposed.current = false;
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, pollMs);
    return () => {
      disposed.current = true;
      revision.current += 1;
      window.clearInterval(timer);
    };
  }, [pollMs, refresh]);

  return { sessions, refresh, clear };
}
