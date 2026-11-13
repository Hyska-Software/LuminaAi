import { create } from 'zustand';

import { api } from '../api';
import type {
  GitHubAccount,
  GitHubConnectionView,
  GitHubIssueDetail,
  GitHubIssueFilter,
  GitHubIssueList,
  GitHubLabel,
  GitHubMilestone,
  GitHubPullRequestCommit,
  GitHubPullRequestDetail,
  GitHubPullRequestFiles,
  GitHubPullRequestFilter,
  GitHubPullRequestList,
  GitHubUser,
} from '../types';

/**
 * Read cache of the GitHub tabs.
 *
 * The PR/Issue surfaces are read-mostly: lists, details and repository metadata
 * are cached per workspace (details per item) so switching tabs never refetches
 * the same page. Mutations live in the views: they call `api` and then one of
 * the `load*` actions with `refresh: true`, which is what keeps this cache and
 * the screen in sync.
 */
export interface AsyncData<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface GitHubMeta {
  labels: GitHubLabel[];
  users: GitHubUser[];
  milestones: GitHubMilestone[];
  branches: string[];
}

interface LoadOptions {
  /** Reload even when the cache already has data. */
  refresh?: boolean;
}

interface GitHubState {
  account: AsyncData<GitHubAccount>;
  connections: Record<string, AsyncData<GitHubConnectionView>>;
  pullRequests: Record<string, AsyncData<GitHubPullRequestList>>;
  pullRequestDetails: Record<string, AsyncData<GitHubPullRequestDetail>>;
  pullRequestFiles: Record<string, AsyncData<GitHubPullRequestFiles>>;
  pullRequestCommits: Record<string, AsyncData<GitHubPullRequestCommit[]>>;
  issues: Record<string, AsyncData<GitHubIssueList>>;
  issueDetails: Record<string, AsyncData<GitHubIssueDetail>>;
  metas: Record<string, AsyncData<GitHubMeta>>;
  /** Increments when the account changes and caches are dropped. */
  cacheEpoch: number;

  loadAccount: () => Promise<GitHubAccount | null>;
  connect: (token: string, workspaceId?: string | null) => Promise<GitHubAccount>;
  disconnect: () => Promise<void>;
  loadConnection: (workspaceId: string, options?: LoadOptions) => Promise<void>;
  loadPullRequests: (
    workspaceId: string,
    filter: GitHubPullRequestFilter,
    options?: LoadOptions,
  ) => Promise<void>;
  loadPullRequest: (workspaceId: string, number: number, options?: LoadOptions) => Promise<void>;
  loadPullRequestFiles: (
    workspaceId: string,
    number: number,
    options?: LoadOptions,
  ) => Promise<void>;
  loadPullRequestCommits: (
    workspaceId: string,
    number: number,
    options?: LoadOptions,
  ) => Promise<void>;
  loadIssues: (workspaceId: string, filter: GitHubIssueFilter, options?: LoadOptions) => Promise<void>;
  loadIssue: (workspaceId: string, number: number, options?: LoadOptions) => Promise<void>;
  loadMeta: (workspaceId: string, options?: LoadOptions) => Promise<void>;
  /** Drops the cached list pages of a workspace (mutations change their rows). */
  invalidateLists: (workspaceId: string) => void;
}

const empty = <T>(): AsyncData<T> => ({ data: null, loading: false, error: null });

/** Stable key of one list page/filter (`workspace + JSON da lista`). */
export function gitHubListKey(workspaceId: string, filter: unknown): string {
  return `${workspaceId}\u0000${JSON.stringify(filter)}`;
}

/** Stable key of one PR/issue detail (`workspace + número`). */
export function gitHubItemKey(workspaceId: string, number: number): string {
  return `${workspaceId}\u0000${number}`;
}

export function describeGitHubError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

/** Marks an entry as loading and clears the previous error. */
function start<T>(current: AsyncData<T> | undefined): AsyncData<T> {
  return { data: current?.data ?? null, loading: true, error: null };
}

function fail<T>(current: AsyncData<T> | undefined, error: unknown, fallback: string): AsyncData<T> {
  return {
    data: current?.data ?? null,
    loading: false,
    error: describeGitHubError(error, fallback),
  };
}

/** Empty cache blocks; the account is managed separately. */
function emptyCaches() {
  return {
    connections: {},
    pullRequests: {},
    pullRequestDetails: {},
    pullRequestFiles: {},
    pullRequestCommits: {},
    issues: {},
    issueDetails: {},
    metas: {},
  };
}

export const useGitHubStore = create<GitHubState>()((set, get) => ({
  account: empty(),
  connections: {},
  pullRequests: {},
  pullRequestDetails: {},
  pullRequestFiles: {},
  pullRequestCommits: {},
  issues: {},
  issueDetails: {},
  metas: {},
  cacheEpoch: 0,

  loadAccount: async () => {
    set((state) => ({ account: start(state.account) }));
    try {
      const account = await api.githubAccount();
      set({ account: { data: account, loading: false, error: null } });
      return account;
    } catch (error) {
      set((state) => ({ account: fail(state.account, error, 'github:account') }));
      return null;
    }
  },

  connect: async (token, workspaceId) => {
    const account = await api.githubSetToken(token, workspaceId ?? null);
    // A different account sees different repositories and permissions; nothing
    // cached for the previous token can be trusted.
    const workspaces = Object.keys(get().connections);
    set({
      account: { data: account, loading: false, error: null },
      ...emptyCaches(),
      cacheEpoch: get().cacheEpoch + 1,
      connections: Object.fromEntries(
        workspaces.map((id) => [id, { data: null, loading: true, error: null }]),
      ),
    });
    await Promise.all(workspaces.map((id) => get().loadConnection(id, { refresh: true })));
    return account;
  },

  disconnect: async () => {
    const account = await api.githubClearToken();
    const workspaces = Object.keys(get().connections);
    set({
      account: { data: account, loading: false, error: null },
      ...emptyCaches(),
      cacheEpoch: get().cacheEpoch + 1,
      connections: Object.fromEntries(
        workspaces.map((id) => [id, { data: null, loading: true, error: null }]),
      ),
    });
    await Promise.all(workspaces.map((id) => get().loadConnection(id, { refresh: true })));
  },

  loadConnection: async (workspaceId, options = {}) => {
    const current = get().connections[workspaceId];
    if (!options.refresh && current?.data) return;
    const loading = start(current);
    set((state) => ({
      connections: { ...state.connections, [workspaceId]: loading },
    }));
    try {
      const connection = await api.githubConnection(workspaceId);
      // A token change can start a newer load while this one is in flight.
      if (get().connections[workspaceId] !== loading) return;
      set((state) => ({
        connections: {
          ...state.connections,
          [workspaceId]: { data: connection, loading: false, error: null },
        },
        account: connection.account.authenticated
          ? { data: connection.account, loading: false, error: null }
          : state.account,
      }));
    } catch (error) {
      if (get().connections[workspaceId] !== loading) return;
      set((state) => ({
        connections: {
          ...state.connections,
          [workspaceId]: fail(current, error, 'github:connection'),
        },
      }));
    }
  },

  loadPullRequests: async (workspaceId, filter, options = {}) => {
    const key = gitHubListKey(workspaceId, filter);
    const current = get().pullRequests[key];
    if (!options.refresh && current?.data) return;
    set((state) => ({ pullRequests: { ...state.pullRequests, [key]: start(current) } }));
    try {
      const list = await api.githubListPullRequests(workspaceId, filter);
      set((state) => ({
        pullRequests: {
          ...state.pullRequests,
          [key]: { data: list, loading: false, error: null },
        },
      }));
    } catch (error) {
      set((state) => ({
        pullRequests: {
          ...state.pullRequests,
          [key]: fail(current, error, 'github:pullRequests'),
        },
      }));
    }
  },

  loadPullRequest: async (workspaceId, number, options = {}) => {
    const key = gitHubItemKey(workspaceId, number);
    const current = get().pullRequestDetails[key];
    if (!options.refresh && current?.data) return;
    set((state) => ({
      pullRequestDetails: { ...state.pullRequestDetails, [key]: start(current) },
    }));
    try {
      const detail = await api.githubPullRequest(workspaceId, number);
      set((state) => ({
        pullRequestDetails: {
          ...state.pullRequestDetails,
          [key]: { data: detail, loading: false, error: null },
        },
      }));
    } catch (error) {
      set((state) => ({
        pullRequestDetails: {
          ...state.pullRequestDetails,
          [key]: fail(current, error, 'github:pullRequest'),
        },
      }));
    }
  },

  loadPullRequestFiles: async (workspaceId, number, options = {}) => {
    const key = gitHubItemKey(workspaceId, number);
    const current = get().pullRequestFiles[key];
    if (!options.refresh && current?.data) return;
    set((state) => ({
      pullRequestFiles: { ...state.pullRequestFiles, [key]: start(current) },
    }));
    try {
      const files = await api.githubPullRequestFiles(workspaceId, number);
      set((state) => ({
        pullRequestFiles: {
          ...state.pullRequestFiles,
          [key]: { data: files, loading: false, error: null },
        },
      }));
    } catch (error) {
      set((state) => ({
        pullRequestFiles: {
          ...state.pullRequestFiles,
          [key]: fail(current, error, 'github:files'),
        },
      }));
    }
  },

  loadPullRequestCommits: async (workspaceId, number, options = {}) => {
    const key = gitHubItemKey(workspaceId, number);
    const current = get().pullRequestCommits[key];
    if (!options.refresh && current?.data) return;
    set((state) => ({
      pullRequestCommits: { ...state.pullRequestCommits, [key]: start(current) },
    }));
    try {
      const commits = await api.githubPullRequestCommits(workspaceId, number);
      set((state) => ({
        pullRequestCommits: {
          ...state.pullRequestCommits,
          [key]: { data: commits, loading: false, error: null },
        },
      }));
    } catch (error) {
      set((state) => ({
        pullRequestCommits: {
          ...state.pullRequestCommits,
          [key]: fail(current, error, 'github:commits'),
        },
      }));
    }
  },

  loadIssues: async (workspaceId, filter, options = {}) => {
    const key = gitHubListKey(workspaceId, filter);
    const current = get().issues[key];
    if (!options.refresh && current?.data) return;
    set((state) => ({ issues: { ...state.issues, [key]: start(current) } }));
    try {
      const list = await api.githubListIssues(workspaceId, filter);
      set((state) => ({
        issues: { ...state.issues, [key]: { data: list, loading: false, error: null } },
      }));
    } catch (error) {
      set((state) => ({
        issues: { ...state.issues, [key]: fail(current, error, 'github:issues') },
      }));
    }
  },

  loadIssue: async (workspaceId, number, options = {}) => {
    const key = gitHubItemKey(workspaceId, number);
    const current = get().issueDetails[key];
    if (!options.refresh && current?.data) return;
    set((state) => ({ issueDetails: { ...state.issueDetails, [key]: start(current) } }));
    try {
      const detail = await api.githubIssue(workspaceId, number);
      set((state) => ({
        issueDetails: {
          ...state.issueDetails,
          [key]: { data: detail, loading: false, error: null },
        },
      }));
    } catch (error) {
      set((state) => ({
        issueDetails: {
          ...state.issueDetails,
          [key]: fail(current, error, 'github:issue'),
        },
      }));
    }
  },

  loadMeta: async (workspaceId, options = {}) => {
    const current = get().metas[workspaceId];
    if (!options.refresh && current?.data) return;
    set((state) => ({ metas: { ...state.metas, [workspaceId]: start(current) } }));
    const [labels, users, milestones, branches] = await Promise.allSettled([
      api.githubLabels(workspaceId),
      api.githubAssignableUsers(workspaceId),
      api.githubMilestones(workspaceId),
      api.githubBranches(workspaceId),
    ]);
    // One failing picker source must not hide the other three (a token can
    // read refs while lacking the issues scope, for example).
    const failure = [labels, users, milestones, branches].find(
      (result) => result.status === 'rejected',
    );
    set((state) => ({
      metas: {
        ...state.metas,
        [workspaceId]: {
          data: {
            labels: labels.status === 'fulfilled' ? labels.value : [],
            users: users.status === 'fulfilled' ? users.value : [],
            milestones: milestones.status === 'fulfilled' ? milestones.value : [],
            branches: branches.status === 'fulfilled' ? branches.value : [],
          },
          loading: false,
          error:
            failure?.status === 'rejected'
              ? describeGitHubError(failure.reason, 'github:meta')
              : null,
        },
      },
    }));
  },

  invalidateLists: (workspaceId) => {
    const prefix = `${workspaceId}\u0000`;
    set((state) => ({
      pullRequests: Object.fromEntries(
        Object.entries(state.pullRequests).filter(([key]) => !key.startsWith(prefix)),
      ),
      issues: Object.fromEntries(
        Object.entries(state.issues).filter(([key]) => !key.startsWith(prefix)),
      ),
    }));
  },
}));
