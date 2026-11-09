/**
 * Schedules automatic update checks: hydrate the cached state as soon as the
 * app is ready, check a moment later (without competing with bootstrap), then
 * every hour while the window stays open. Coming back to the window resumes
 * the hourly cadence after a long-running session.
 */
import { useEffect } from 'react';
import { UPDATE_CHECK_INTERVAL_MS, useUpdateStore } from '@/lib/store';

const START_DELAY_MS = 2500;
const TICK_MS = UPDATE_CHECK_INTERVAL_MS;

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
