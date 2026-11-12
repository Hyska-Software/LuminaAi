// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { WorkspaceChangedEvent } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  watchWorkspace: vi.fn(),
  unwatchWorkspace: vi.fn(),
}));

const listeners: Array<(event: { payload: WorkspaceChangedEvent }) => void> = [];

vi.mock('@/lib/api', () => ({ api: mocks }));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(
    async (_name: string, handler: (event: { payload: WorkspaceChangedEvent }) => void) => {
      listeners.push(handler);
      return () => {
        const index = listeners.indexOf(handler);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
  ),
}));

import { dirsAffectedBy, useWorkspaceWatch } from './useWorkspaceWatch';

function emit(event: WorkspaceChangedEvent): void {
  for (const handler of [...listeners]) handler({ payload: event });
}

/** jsdom exposes `visibilityState` as a prototype accessor; override locally. */
function setVisibility(state: DocumentVisibilityState): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  return () => {
    if (descriptor) Object.defineProperty(document, 'visibilityState', descriptor);
    else delete (document as unknown as Record<string, unknown>).visibilityState;
  };
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  listeners.length = 0;
  mocks.watchWorkspace.mockResolvedValue(undefined);
  mocks.unwatchWorkspace.mockResolvedValue(undefined);
});

describe('dirsAffectedBy', () => {
  it('returns every loaded dir for a full reload batch', () => {
    expect(dirsAffectedBy([], ['src', 'docs'])).toEqual(['src', 'docs']);
  });

  it('keeps only the loaded dirs touched by the changed paths', () => {
    expect(dirsAffectedBy(['src/lib/a.ts', 'README.md'], ['src', 'src/lib', 'docs'])).toEqual([
      'src',
      'src/lib',
    ]);
  });

  it('includes the dir itself and children of a removed dir', () => {
    expect(dirsAffectedBy(['src/lib'], ['src', 'src/lib'])).toEqual(['src', 'src/lib']);
    expect(dirsAffectedBy(['src/lib'], ['src/lib/components'])).toEqual(['src/lib/components']);
  });
});

describe('useWorkspaceWatch', () => {
  it('starts and stops the backend watcher only while enabled', async () => {
    const { rerender, unmount } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useWorkspaceWatch({ workspaceId: 'ws-1', enabled, onChanges: () => {} }),
      { initialProps: { enabled: false } },
    );
    await act(async () => {});
    expect(mocks.watchWorkspace).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(mocks.watchWorkspace).toHaveBeenCalledWith('ws-1'));
    await waitFor(() => expect(listeners.length).toBe(1));

    unmount();
    await waitFor(() => expect(mocks.unwatchWorkspace).toHaveBeenCalledWith('ws-1'));
  });

  it('delivers only batches of the watched workspace', async () => {
    const onChanges = vi.fn();
    renderHook(() =>
      useWorkspaceWatch({ workspaceId: 'ws-1', enabled: true, debounceMs: 10, onChanges }),
    );
    await waitFor(() => expect(listeners.length).toBe(1));

    act(() => {
      emit({ workspaceId: 'ws-2', paths: ['a.ts'], overflow: false });
      emit({ workspaceId: 'ws-1', paths: ['b.ts'], overflow: false });
    });

    await waitFor(() => expect(onChanges).toHaveBeenCalledTimes(1));
    expect(onChanges.mock.calls[0][0]).toMatchObject({ workspaceId: 'ws-1', paths: ['b.ts'] });
  });

  it('coalesces events inside the debounce window', async () => {
    const onChanges = vi.fn();
    renderHook(() =>
      useWorkspaceWatch({ workspaceId: 'ws-1', enabled: true, debounceMs: 20, onChanges }),
    );
    await waitFor(() => expect(listeners.length).toBe(1));

    act(() => {
      emit({ workspaceId: 'ws-1', paths: ['a.ts'], overflow: false });
      emit({ workspaceId: 'ws-1', paths: ['b.ts'], overflow: true });
    });

    await waitFor(() => expect(onChanges).toHaveBeenCalledTimes(1));
    expect(onChanges.mock.calls[0][0]).toMatchObject({
      paths: ['a.ts', 'b.ts'],
      overflow: true,
    });
  });

  it('defers while hidden and flushes on visibility change', async () => {
    const onChanges = vi.fn();
    renderHook(() =>
      useWorkspaceWatch({ workspaceId: 'ws-1', enabled: true, debounceMs: 10, onChanges }),
    );
    await waitFor(() => expect(listeners.length).toBe(1));

    const restore = setVisibility('hidden');
    act(() => {
      emit({ workspaceId: 'ws-1', paths: ['a.ts'], overflow: false });
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(onChanges).not.toHaveBeenCalled();

    restore();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(onChanges).toHaveBeenCalledTimes(1));
    expect(onChanges.mock.calls[0][0]).toMatchObject({ paths: ['a.ts'] });
  });
});
