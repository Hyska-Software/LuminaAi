import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  githubSetToken: vi.fn(),
  githubClearToken: vi.fn(),
  githubConnection: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));

import type { GitHubAccount, GitHubConnectionView } from '../../types';
import { useGitHubStore } from '../githubStore';

const account: GitHubAccount = {
  authenticated: true,
  login: 'octocat',
  source: 'settings',
  scopes: ['repo'],
};

const connection: GitHubConnectionView = {
  account,
  repo: {
    host: 'github.com',
    owner: 'o',
    name: 'r',
    fullName: 'o/r',
    htmlUrl: 'https://github.com/o/r',
    defaultBranch: 'main',
    canPush: true,
    graphql: true,
  },
  message: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useGitHubStore.setState({
    account: { data: null, loading: false, error: null },
    connections: {},
    pullRequests: {},
    pullRequestDetails: {},
    pullRequestFiles: {},
    pullRequestCommits: {},
    issues: {},
    issueDetails: {},
    metas: {},
    cacheEpoch: 0,
  });
});

describe('githubStore', () => {
  it('invalida apenas as listas do workspace alterado', () => {
    useGitHubStore.setState({
      pullRequests: {
        'ws-1\u0000{"page":1}': { data: null, loading: false, error: null },
        'ws-2\u0000{"page":1}': { data: null, loading: false, error: null },
      },
      issues: {
        'ws-1\u0000{"page":1}': { data: null, loading: false, error: null },
        'ws-2\u0000{"page":1}': { data: null, loading: false, error: null },
      },
    });

    useGitHubStore.getState().invalidateLists('ws-1');

    expect(Object.keys(useGitHubStore.getState().pullRequests)).toEqual(['ws-2\u0000{"page":1}']);
    expect(Object.keys(useGitHubStore.getState().issues)).toEqual(['ws-2\u0000{"page":1}']);
  });

  it('conectar outra conta descarta caches e recarrega as conexões abertas', async () => {
    mocks.githubSetToken.mockResolvedValue(account);
    mocks.githubConnection.mockResolvedValue(connection);
    useGitHubStore.setState({
      connections: {
        'ws-1': { data: connection, loading: false, error: null },
        'ws-2': { data: connection, loading: false, error: null },
      },
      pullRequests: { 'ws-1\u0000{}': { data: null, loading: false, error: null } },
      issueDetails: { 'ws-1\u00000': { data: null, loading: false, error: null } },
      metas: { 'ws-1': { data: null, loading: false, error: null } },
    });

    await useGitHubStore.getState().connect('ghp_token', 'ws-1');

    const state = useGitHubStore.getState();
    expect(mocks.githubSetToken).toHaveBeenCalledWith('ghp_token', 'ws-1');
    expect(state.account.data).toEqual(account);
    expect(state.pullRequests).toEqual({});
    expect(state.issueDetails).toEqual({});
    expect(state.metas).toEqual({});
    expect(mocks.githubConnection).toHaveBeenCalledTimes(2);
    expect(state.connections['ws-1'].data).toEqual(connection);
    expect(state.connections['ws-2'].data).toEqual(connection);
  });
});
