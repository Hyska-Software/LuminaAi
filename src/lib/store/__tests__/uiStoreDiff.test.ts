import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../uiStore';

function reset(): void {
  useUiStore.setState({ codeView: 'session', codeDiffTab: null });
}

beforeEach(reset);

describe('uiStore — diff como aba central', () => {
  it('abre o diff no centro e marca a view', () => {
    useUiStore.getState().openCodeDiff({
      workspaceId: 'ws-1',
      path: 'src/app.ts',
      staged: false,
      knownDiff: '@@ -1 +1 @@\n-a\n+b',
    });

    const state = useUiStore.getState();
    expect(state.codeView).toBe('diff');
    expect(state.codeDiffTab).toEqual({
      workspaceId: 'ws-1',
      path: 'src/app.ts',
      staged: false,
      knownDiff: '@@ -1 +1 @@\n-a\n+b',
    });
  });

  it('fecha a aba e volta para a sessão', () => {
    useUiStore.getState().openCodeDiff({ workspaceId: 'ws-1', path: 'a.ts', staged: true });
    expect(useUiStore.getState().codeDiffTab?.staged).toBe(true);

    useUiStore.getState().closeCodeDiff();

    expect(useUiStore.getState().codeView).toBe('session');
    expect(useUiStore.getState().codeDiffTab).toBeNull();
  });

  it('setCodeView aceita diff/skills e cai em session para o resto', () => {
    useUiStore.getState().setCodeView('diff');
    expect(useUiStore.getState().codeView).toBe('diff');
    useUiStore.getState().setCodeView('skills');
    expect(useUiStore.getState().codeView).toBe('skills');
    useUiStore.getState().setCodeView('session');
    expect(useUiStore.getState().codeView).toBe('session');
  });
});
