import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { WorkspaceFileEntry, WorkspaceGitCommit, WorkspaceGitStatus } from '@/lib/types';

export interface WorkspacePanelDiff {
  /** Lane showing the diff (`null` = nothing open). */
  path: string | null;
  staged: boolean;
  text: string;
  loading: boolean;
  error: string | null;
}

export interface UseWorkspacePanelOptions {
  /** Directory depth requested from `list_workspace_files` (backend default 2). */
  depth?: number;
  /** Commit log size (default 20). */
  commitLimit?: number;
}

export interface UseWorkspacePanelResult {
  workspaceId: string | null;
  files: WorkspaceFileEntry[];
  gitStatus: WorkspaceGitStatus | null;
  commits: WorkspaceGitCommit[];
  /** True while files or git status are being (re)loaded. */
  loading: boolean;
  filesLoading: boolean;
  gitLoading: boolean;
  commitsLoading: boolean;
  filesError: string | null;
  gitError: string | null;
  commitsError: string | null;
  /** `gitStatus.isRepo` when known, `false` otherwise. */
  isRepo: boolean;
  diff: WorkspacePanelDiff;
  /** Reloads files, git status and the commit log. */
  refresh: () => Promise<void>;
  /** Loads the unified diff of one file (uses the container's known diff when given). */
  openDiff: (path: string, options?: { staged?: boolean; knownDiff?: string | null }) => Promise<void>;
  closeDiff: () => void;
}

const EMPTY_DIFF: WorkspacePanelDiff = {
  path: null,
  staged: false,
  text: '',
  loading: false,
  error: null,
};

function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

/**
 * Data hook of the Code right panel (WORKBENCH §7): loads the workspace file
 * tree, git status and commit log through `@/lib/api`, exposes per-file diff
 * loading and a `refresh()` used after stage/unstage/revert/commit.
 *
 * The container owns the workspace choice; passing `null` resets every piece
 * of state without touching the API (honest empty state).
 */
export function useWorkspacePanel(
  workspaceId: string | null | undefined,
  options: UseWorkspacePanelOptions = {},
): UseWorkspacePanelResult {
  const { depth = 2, commitLimit = 20 } = options;
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [gitStatus, setGitStatus] = useState<WorkspaceGitStatus | null>(null);
  const [commits, setCommits] = useState<WorkspaceGitCommit[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [gitLoading, setGitLoading] = useState(false);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [commitsError, setCommitsError] = useState<string | null>(null);
  const [diff, setDiff] = useState<WorkspacePanelDiff>(EMPTY_DIFF);

  const loadRun = useRef(0);
  const diffRun = useRef(0);

  const load = useCallback(async () => {
    const run = loadRun.current + 1;
    loadRun.current = run;

    if (!workspaceId) {
      setFiles([]);
      setGitStatus(null);
      setCommits([]);
      setFilesLoading(false);
      setGitLoading(false);
      setCommitsLoading(false);
      setFilesError(null);
      setGitError(null);
      setCommitsError(null);
      return;
    }

    setFilesLoading(true);
    setGitLoading(true);
    setFilesError(null);
    setGitError(null);

    const [filesResult, statusResult] = await Promise.allSettled([
      api.listWorkspaceFiles(workspaceId, '.', depth),
      api.gitStatus(workspaceId),
    ]);
    if (run !== loadRun.current) return;

    if (filesResult.status === 'fulfilled') setFiles(filesResult.value ?? []);
    else {
      setFiles([]);
      setFilesError(describeError(filesResult.reason, 'Não foi possível ler a árvore de arquivos.'));
    }
    setFilesLoading(false);

    let isRepo = false;
    if (statusResult.status === 'fulfilled') {
      setGitStatus(statusResult.value);
      setGitError(null);
      isRepo = Boolean(statusResult.value?.isRepo);
    } else {
      setGitStatus(null);
      setGitError(describeError(statusResult.reason, 'Não foi possível ler o estado do Git.'));
    }
    setGitLoading(false);

    if (!isRepo) {
      setCommits([]);
      setCommitsError(null);
      setCommitsLoading(false);
      return;
    }

    setCommitsLoading(true);
    try {
      const log = await api.gitLog(workspaceId, commitLimit);
      if (run !== loadRun.current) return;
      setCommits(log ?? []);
      setCommitsError(null);
    } catch (error) {
      if (run !== loadRun.current) return;
      setCommits([]);
      setCommitsError(describeError(error, 'Não foi possível ler os commits recentes.'));
    } finally {
      if (run === loadRun.current) setCommitsLoading(false);
    }
  }, [workspaceId, depth, commitLimit]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    /* A workspace switch closes any open diff and invalidates in-flight loads. */
    diffRun.current += 1;
    setDiff(EMPTY_DIFF);
  }, [workspaceId]);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  const openDiff = useCallback(
    async (
      path: string,
      options: { staged?: boolean; knownDiff?: string | null } = {},
    ): Promise<void> => {
      const staged = options.staged ?? false;
      const run = diffRun.current + 1;
      diffRun.current = run;

      if (options.knownDiff != null) {
        setDiff({ path, staged, text: options.knownDiff, loading: false, error: null });
        return;
      }
      if (!workspaceId) {
        setDiff({
          path,
          staged,
          text: '',
          loading: false,
          error: 'Abra um workspace para ver o diff.',
        });
        return;
      }

      setDiff({ path, staged, text: '', loading: true, error: null });
      try {
        const text = await api.getFileDiff(workspaceId, path, staged);
        if (run !== diffRun.current) return;
        setDiff({ path, staged, text: text ?? '', loading: false, error: null });
      } catch (error) {
        if (run !== diffRun.current) return;
        setDiff({
          path,
          staged,
          text: '',
          loading: false,
          error: describeError(error, 'Não foi possível carregar o diff.'),
        });
      }
    },
    [workspaceId],
  );

  const closeDiff = useCallback(() => {
    diffRun.current += 1;
    setDiff(EMPTY_DIFF);
  }, []);

  return {
    workspaceId: workspaceId ?? null,
    files,
    gitStatus,
    commits,
    loading: filesLoading || gitLoading,
    filesLoading,
    gitLoading,
    commitsLoading,
    filesError,
    gitError,
    commitsError,
    isRepo: gitStatus?.isRepo ?? false,
    diff,
    refresh,
    openDiff,
    closeDiff,
  };
}

export default useWorkspacePanel;
