import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../uiStore';

beforeEach(() => {
  useUiStore.setState({ codeView: 'session', codeCommitsTab: null, codeDiffTab: null });
});

describe('uiStore — histórico de commits como aba central', () => {
  it('abre a lista de commits e marca a view', () => {
    useUiStore.getState().openCodeCommits('ws-1');

    const state = useUiStore.getState();
    expect(state.codeView).toBe('commits');
    expect(state.codeCommitsTab).toEqual({ workspaceId: 'ws-1', revision: null });
  });

  it('seleciona um commit e volta para a lista', () => {
    useUiStore.getState().openCodeCommits('ws-1');
    useUiStore.getState().selectCodeCommit('abc1234');
    expect(useUiStore.getState().codeCommitsTab?.revision).toBe('abc1234');
    expect(useUiStore.getState().codeView).toBe('commits');

    useUiStore.getState().selectCodeCommit(null);
    expect(useUiStore.getState().codeCommitsTab?.revision).toBeNull();
  });

  it('fecha a aba e volta para a sessão', () => {
    useUiStore.getState().openCodeCommits('ws-1');
    useUiStore.getState().closeCodeCommits();
    expect(useUiStore.getState().codeCommitsTab).toBeNull();
    expect(useUiStore.getState().codeView).toBe('session');
  });

  it('abrir o diff não fecha a aba de commits (e vice-versa)', () => {
    useUiStore.getState().openCodeCommits('ws-1');
    useUiStore.getState().openCodeDiff({ workspaceId: 'ws-1', path: 'a.ts', staged: false });
    expect(useUiStore.getState().codeView).toBe('diff');
    expect(useUiStore.getState().codeCommitsTab).not.toBeNull();
  });
});
