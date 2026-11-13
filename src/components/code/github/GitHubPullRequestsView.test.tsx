// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  githubAccount: vi.fn(),
  githubConnection: vi.fn(),
  githubListPullRequests: vi.fn(),
  githubLabels: vi.fn(),
  githubAssignableUsers: vi.fn(),
  githubMilestones: vi.fn(),
  githubBranches: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));

import { useGitHubStore } from '@/lib/store';
import { useUiStore } from '@/lib/store';
import type { GitHubPullRequestSummary } from '@/lib/types';
import { GitHubPullRequestsView } from './GitHubPullRequestsView';

function pullRequest(overrides: Partial<GitHubPullRequestSummary> = {}): GitHubPullRequestSummary {
  return {
    number: 42,
    title: 'Add GitHub tabs',
    state: 'open',
    draft: false,
    merged: false,
    author: { login: 'octocat' },
    headRef: 'feat/github',
    headSha: 'abc',
    baseRef: 'main',
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-02T10:00:00Z',
    comments: 1,
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    labels: [{ name: 'enhancement', color: 'a2eeef' }],
    htmlUrl: 'https://github.com/o/r/pull/42',
    crossRepository: false,
    ...overrides,
  };
}

const connection = {
  account: { authenticated: true, login: 'octocat', source: 'settings', scopes: ['repo'] },
  repo: {
    host: 'github.com',
    owner: 'Hyska-Software',
    name: 'ZylaraAi',
    fullName: 'Hyska-Software/ZylaraAi',
    htmlUrl: 'https://github.com/Hyska-Software/ZylaraAi',
    defaultBranch: 'main',
    canPush: true,
    graphql: true,
  },
  message: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.githubAccount.mockResolvedValue(connection.account);
  mocks.githubConnection.mockResolvedValue(connection);
  mocks.githubListPullRequests.mockResolvedValue({
    items: [pullRequest(), pullRequest({ number: 7, title: 'Old PR', state: 'closed' })],
    page: 1,
    perPage: 30,
    hasNext: true,
  });
  mocks.githubLabels.mockResolvedValue([]);
  mocks.githubAssignableUsers.mockResolvedValue([]);
  mocks.githubMilestones.mockResolvedValue([]);
  mocks.githubBranches.mockResolvedValue(['main']);

  useUiStore.setState({
    codeView: 'session',
    codePullRequestsTab: null,
    codePullRequestTabs: [],
    codePullRequestTab: null,
  });
  useGitHubStore.setState({
    account: { data: connection.account, loading: false, error: null },
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

afterEach(cleanup);

describe('GitHubPullRequestsView', () => {
  it('lista os pull requests com o filtro padrão e abre a aba do item', async () => {
    const user = userEvent.setup();
    render(<GitHubPullRequestsView tab={{ workspaceId: 'ws-1' }} />);

    await screen.findByText('Add GitHub tabs');
    expect(screen.getByText('Old PR')).toBeTruthy();
    expect(screen.getByText('Hyska-Software/ZylaraAi · octocat')).toBeTruthy();

    expect(mocks.githubListPullRequests).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({ state: 'open', page: 1, perPage: 30 }),
    );

    await user.click(screen.getByText('Add GitHub tabs'));

    await waitFor(() =>
      expect(useUiStore.getState().codePullRequestTab).toEqual({
        workspaceId: 'ws-1',
        number: 42,
        title: 'Add GitHub tabs',
      }),
    );
    expect(useUiStore.getState().codeView).toBe('pr');
  });

  it('troca o estado do filtro e reinicia a página', async () => {
    const user = userEvent.setup();
    render(<GitHubPullRequestsView tab={{ workspaceId: 'ws-1' }} />);

    await screen.findByText('Add GitHub tabs');
    await user.click(screen.getByRole('radio', { name: 'Fechados' }));

    await waitFor(() =>
      expect(mocks.githubListPullRequests).toHaveBeenLastCalledWith(
        'ws-1',
        expect.objectContaining({ state: 'closed', page: 1 }),
      ),
    );
  });

  it('mostra o CTA de conexão quando não há token', async () => {
    mocks.githubConnection.mockResolvedValue({
      ...connection,
      account: { authenticated: false, login: null, source: 'none', scopes: [] },
      message: 'não é possível falar com o GitHub',
    });
    useGitHubStore.setState({
      account: { data: { authenticated: false, login: null, source: 'none', scopes: [] }, loading: false, error: null },
    });

    render(<GitHubPullRequestsView tab={{ workspaceId: 'ws-1' }} />);

    await screen.findByText('não é possível falar com o GitHub');
    expect(mocks.githubListPullRequests).not.toHaveBeenCalled();
  });
});
