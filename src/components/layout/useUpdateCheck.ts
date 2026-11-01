/**
 * Schedules automatic update checks: hydrate the cached state as soon as the
 * app is ready, check a moment later (without competing with bootstrap), then
 * once per day while the window stays open. Coming back to the window is a
 * cheap way to resume the daily cadence after a long-running session.
 */
import { useEffect } from 'react';
import { useUpdateStore } from '@/lib/store';

const START_DELAY_MS = 2500;
const TICK_MS = 60 * 60 * 1000;

export function useUpdateCheck(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    void useUpdateStore.getState().init();
    const timer = window.setTimeout(() => {
      void useUpdateStore
        .getState()
        .init()
        .then(() => useUpdateStore.getState().checkIfDue());
    }, START_DELAY_MS);
    const interval = window.setInterval(() => {
      void useUpdateStore.getState().checkIfDue();
    }, TICK_MS);
    const onFocus = () => {
      void useUpdateStore.getState().checkIfDue();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [ready]);
}
