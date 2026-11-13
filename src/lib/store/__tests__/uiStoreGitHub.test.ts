import { beforeEach, describe, expect, it } from 'vitest';

import { useUiStore } from '../uiStore';

function reset(): void {
  useUiStore.setState({
    codeView: 'session',
    codePullRequestsTab: null,
    codePullRequestTabs: [],
    codePullRequestTab: null,
    codeIssuesTab: null,
    codeIssueTabs: [],
    codeIssueTab: null,
  });
}

beforeEach(reset);

describe('uiStore — pull requests e issues como abas centrais', () => {
  it('abre a lista de pull requests no centro', () => {
    useUiStore.getState().openCodePullRequests('ws-1');

    const state = useUiStore.getState();
    expect(state.codeView).toBe('prs');
    expect(state.codePullRequestsTab).toEqual({ workspaceId: 'ws-1' });
    expect(state.codePullRequestTabs).toEqual([]);
  });

  it('acumula uma aba por pull request e deduplica o mesmo número', () => {
    useUiStore.getState().openCodePullRequest({ workspaceId: 'ws-1', number: 42, title: 'A' });
    useUiStore.getState().openCodePullRequest({ workspaceId: 'ws-1', number: 7, title: 'B' });
    useUiStore.getState().openCodePullRequest({ workspaceId: 'ws-1', number: 42, title: 'A2' });

    const state = useUiStore.getState();
    expect(state.codeView).toBe('pr');
    expect(state.codePullRequestTabs).toEqual([
      { workspaceId: 'ws-1', number: 42, title: 'A2' },
      { workspaceId: 'ws-1', number: 7, title: 'B' },
    ]);
    expect(state.codePullRequestTab).toEqual({ workspaceId: 'ws-1', number: 42, title: 'A2' });
  });

  it('fechar a aba ativa ativa a vizinha e fechar a última volta para a sessão', () => {
    useUiStore.getState().openCodePullRequest({ workspaceId: 'ws-1', number: 1, title: 'A' });
    useUiStore.getState().openCodePullRequest({ workspaceId: 'ws-1', number: 2, title: 'B' });

    useUiStore.getState().closeCodePullRequest();
    expect(useUiStore.getState().codePullRequestTab).toEqual({
      workspaceId: 'ws-1',
      number: 1,
      title: 'A',
    });
    expect(useUiStore.getState().codeView).toBe('pr');

    useUiStore.getState().closeCodePullRequest();
    expect(useUiStore.getState().codePullRequestTabs).toEqual([]);
    expect(useUiStore.getState().codePullRequestTab).toBeNull();
    expect(useUiStore.getState().codeView).toBe('session');
  });

  it('fechar uma aba em segundo plano mantém a view atual', () => {
    useUiStore.getState().openCodePullRequest({ workspaceId: 'ws-1', number: 1, title: 'A' });
    useUiStore.getState().openCodePullRequest({ workspaceId: 'ws-1', number: 2, title: 'B' });
    useUiStore.getState().openCodePullRequests('ws-1');

    useUiStore.getState().closeCodePullRequest({ workspaceId: 'ws-1', number: 1, title: 'A' });

    expect(useUiStore.getState().codeView).toBe('prs');
    expect(useUiStore.getState().codePullRequestTab).toEqual({
      workspaceId: 'ws-1',
      number: 2,
      title: 'B',
    });
  });

  it('fechar a lista de pull requests volta para a sessão', () => {
    useUiStore.getState().openCodePullRequests('ws-1');
    useUiStore.getState().closeCodePullRequests();

    expect(useUiStore.getState().codePullRequestsTab).toBeNull();
    expect(useUiStore.getState().codeView).toBe('session');
  });

  it('repetir a issue aberta não cria uma segunda aba', () => {
    useUiStore.getState().openCodeIssue({ workspaceId: 'ws-1', number: 9, title: 'Crash' });
    useUiStore.getState().openCodeIssue({ workspaceId: 'ws-2', number: 9, title: 'Crash' });
    useUiStore.getState().openCodeIssue({ workspaceId: 'ws-1', number: 9, title: 'Crash fix' });

    const state = useUiStore.getState();
    expect(state.codeView).toBe('issue');
    expect(state.codeIssueTabs).toEqual([
      { workspaceId: 'ws-1', number: 9, title: 'Crash fix' },
      { workspaceId: 'ws-2', number: 9, title: 'Crash' },
    ]);
    expect(state.codeIssueTab).toEqual({ workspaceId: 'ws-1', number: 9, title: 'Crash fix' });
  });

  it('setCodeView aceita as views novas e ignora valores desconhecidos', () => {
    useUiStore.getState().setCodeView('issues');
    expect(useUiStore.getState().codeView).toBe('issues');

    useUiStore.getState().setCodeView('nope' as unknown as 'issues');
    expect(useUiStore.getState().codeView).toBe('session');
  });
});
