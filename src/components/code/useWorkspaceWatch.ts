/**
 * Live refresh of the Code panel: starts/stops the backend workspace watcher
 * and coalesces `zylara:workspace-changed` events into `onChanges` calls.
 *
 * Performance rules: one refresh in flight at a time, a short debounce to merge
 * deliveries, and no IPC while the window is hidden (the pending batch flushes
 * on the next focus/visibility change).
 */
import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from '@/lib/api';
import type { WorkspaceChangedEvent } from '@/lib/types';

export const WORKSPACE_CHANGED_EVENT = 'zylara:workspace-changed';
export const DEFAULT_WATCH_DEBOUNCE_MS = 200;
/** Same cap as the backend payload (`MAX_BATCH_PATHS`). */
const MAX_PENDING_PATHS = 200;

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Serializes start/stop IPC across hook instances: StrictMode remounts and
 * workspace switches enqueue `unwatch` before the next `watch`, so a late stop
 * can never kill the freshly started watcher.
 */
let watchQueue: Promise<void> = Promise.resolve();

function enqueueWatchCall(call: () => Promise<void>): void {
  watchQueue = watchQueue.then(call).catch(() => undefined);
}

/**
 * Loaded lazy directories touched by a batch of changed paths.
 * Empty `paths` (backend asked for a full reload) returns every loaded dir.
 */
export function dirsAffectedBy(paths: string[], loadedDirs: string[]): string[] {
  if (paths.length === 0) return [...loadedDirs];
  const affected = new Set<string>();
  for (const dir of loadedDirs) {
    const prefix = `${dir}/`;
    for (const raw of paths) {
      const path = raw.replace(/\/+$/, '');
      if (!path) continue;
      // The dir itself changed, a child changed, or the dir was removed/renamed.
      if (path === dir || path.startsWith(prefix) || dir.startsWith(`${path}/`)) {
        affected.add(dir);
        break;
      }
    }
  }
  return [...affected];
}

function mergeEvents(
  current: WorkspaceChangedEvent | null,
  next: WorkspaceChangedEvent,
): WorkspaceChangedEvent {
  if (!current) return next;
  return {
    workspaceId: current.workspaceId,
    paths: [...current.paths, ...next.paths].slice(0, MAX_PENDING_PATHS),
    overflow: current.overflow || next.overflow,
  };
}

export interface UseWorkspaceWatchOptions {
  workspaceId: string | null;
  /** `false` stops the backend watcher and the listener (panel closed/undocked). */
  enabled: boolean;
  /** May be async; new batches wait for the previous refresh to finish. */
  onChanges: (event: WorkspaceChangedEvent) => void | Promise<void>;
  debounceMs?: number;
}

export function useWorkspaceWatch({
  workspaceId,
  enabled,
  onChanges,
  debounceMs = DEFAULT_WATCH_DEBOUNCE_MS,
}: UseWorkspaceWatchOptions): void {
  const callback = useRef(onChanges);
  callback.current = onChanges;

  useEffect(() => {
    if (!workspaceId || !enabled) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    let pending: WorkspaceChangedEvent | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;

    function armTimer(delay: number): void {
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        void flush();
      }, delay);
    }

    async function flush(): Promise<void> {
      timer = undefined;
      if (disposed || inFlight || !pending) return;
      // Hidden window: keep the batch pending until focus/visibility flushes it.
      if (isHidden()) return;
      inFlight = true;
      const batch = pending;
      pending = null;
      try {
        await callback.current(batch);
      } finally {
        inFlight = false;
        if (!disposed && pending) armTimer(debounceMs);
      }
    }

    function schedule(event: WorkspaceChangedEvent): void {
      pending = mergeEvents(pending, event);
      // Hidden windows keep accumulating; focus/visibility flushes the batch.
      if (isHidden()) return;
      armTimer(debounceMs);
    }

    function flushNow(): void {
      if (isHidden() || !pending) return;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      void flush();
    }

    document.addEventListener('visibilitychange', flushNow);
    window.addEventListener('focus', flushNow);

    enqueueWatchCall(() => api.watchWorkspace(workspaceId));
    void Promise.resolve()
      .then(() =>
        listen<WorkspaceChangedEvent>(WORKSPACE_CHANGED_EVENT, ({ payload }) => {
          if (!disposed && payload?.workspaceId === workspaceId) schedule(payload);
        }),
      )
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', flushNow);
      window.removeEventListener('focus', flushNow);
      unlisten?.();
      enqueueWatchCall(() => api.unwatchWorkspace(workspaceId));
    };
  }, [workspaceId, enabled, debounceMs]);
}

export default useWorkspaceWatch;
