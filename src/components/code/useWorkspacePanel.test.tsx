// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { WorkspaceGitStatus } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  listWorkspaceFiles: vi.fn(),
  gitStatus: vi.fn(),
  gitLog: vi.fn(),
  getFileDiff: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));

import { useWorkspacePanel } from './useWorkspacePanel';

function status(overrides: Partial<WorkspaceGitStatus> = {}): WorkspaceGitStatus {
  return {
    isRepo: true,
    root: 'H:/projeto',
    branch: 'main',
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    ...overrides,
  };
}

const files = [
  { path: 'src', name: 'src', isDir: true, depth: 0 },
  { path: 'README.md', name: 'README.md', isDir: false, depth: 0 },
];

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listWorkspaceFiles.mockResolvedValue(files);
  mocks.gitStatus.mockResolvedValue(status());
  mocks.gitLog.mockResolvedValue([
    { hash: 'a1b2c3d4e5', subject: 'Ajusta cálculo', author: 'Ana', date: '2026-01-02T10:00:00Z' },
  ]);
  mocks.getFileDiff.mockResolvedValue('@@ -1 +1 @@\n-a\n+b');
});

describe('useWorkspacePanel', () => {
  it('does not touch the API without a workspace', async () => {
    const { result } = renderHook(() => useWorkspacePanel(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.listWorkspaceFiles).not.toHaveBeenCalled();
    expect(mocks.gitStatus).not.toHaveBeenCalled();
    expect(mocks.gitLog).not.toHaveBeenCalled();
    expect(result.current.files).toEqual([]);
    expect(result.current.isRepo).toBe(false);
  });

  it('loads files, git status and the commit log', async () => {
    const { result } = renderHook(() => useWorkspacePanel('ws-1'));
    await waitFor(() => expect(result.current.files.length).toBe(2));

    expect(mocks.listWorkspaceFiles).toHaveBeenCalledWith('ws-1', '.', 2);
    expect(mocks.gitStatus).toHaveBeenCalledWith('ws-1');
    expect(mocks.gitLog).toHaveBeenCalledWith('ws-1', 20);
    expect(result.current.isRepo).toBe(true);
    expect(result.current.gitStatus?.branch).toBe('main');
    expect(result.current.commits.length).toBe(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.filesError).toBeNull();
  });

  it('skips the commit log when the workspace is not a git repository', async () => {
    mocks.gitStatus.mockResolvedValue(status({ isRepo: false }));
    const { result } = renderHook(() => useWorkspacePanel('ws-1'));
    await waitFor(() => expect(result.current.isRepo).toBe(false));
    expect(mocks.gitLog).not.toHaveBeenCalled();
    expect(result.current.commits).toEqual([]);
  });

  it('surfaces read errors and recovers on refresh', async () => {
    mocks.listWorkspaceFiles.mockRejectedValueOnce(new Error('sem permissão'));
    mocks.gitStatus.mockRejectedValueOnce(new Error('git ausente'));
    const { result } = renderHook(() => useWorkspacePanel('ws-1'));

    await waitFor(() => expect(result.current.filesError).toBe('sem permissão'));
    expect(result.current.gitError).toBe('git ausente');
    expect(result.current.files).toEqual([]);

    await act(async () => {
      await result.current.refresh();
    });
    expect(mocks.listWorkspaceFiles).toHaveBeenCalledTimes(2);
    expect(result.current.filesError).toBeNull();
    expect(result.current.files.length).toBe(2);
  });

  it('opens a per-file diff and closes it', async () => {
    const { result } = renderHook(() => useWorkspacePanel('ws-1'));
    await waitFor(() => expect(result.current.isRepo).toBe(true));

    await act(async () => {
      await result.current.openDiff('src/app.ts', { staged: true });
    });
    expect(mocks.getFileDiff).toHaveBeenCalledWith('ws-1', 'src/app.ts', true);
    expect(result.current.diff.path).toBe('src/app.ts');
    expect(result.current.diff.text).toContain('+b');
    expect(result.current.diff.loading).toBe(false);

    act(() => result.current.closeDiff());
    expect(result.current.diff.path).toBeNull();
  });

  it('reuses a known diff without calling the API', async () => {
    const { result } = renderHook(() => useWorkspacePanel('ws-1'));
    await act(async () => {
      await result.current.openDiff('src/app.ts', { knownDiff: '@@ -1 +1 @@\n-x\n+y' });
    });
    expect(mocks.getFileDiff).not.toHaveBeenCalled();
    expect(result.current.diff.text).toContain('+y');
  });

  it('reports diff load errors', async () => {
    mocks.getFileDiff.mockRejectedValueOnce(new Error('arquivo binário'));
    const { result } = renderHook(() => useWorkspacePanel('ws-1'));
    await act(async () => {
      await result.current.openDiff('img.png');
    });
    expect(result.current.diff.error).toBe('arquivo binário');
  });

  it('reloads everything when the workspace changes', async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useWorkspacePanel(id),
      { initialProps: { id: 'ws-1' } },
    );
    await waitFor(() => expect(result.current.files.length).toBe(2));

    rerender({ id: 'ws-2' });
    await waitFor(() => expect(mocks.listWorkspaceFiles).toHaveBeenCalledWith('ws-2', '.', 2));
    expect(result.current.workspaceId).toBe('ws-2');
  });
});
