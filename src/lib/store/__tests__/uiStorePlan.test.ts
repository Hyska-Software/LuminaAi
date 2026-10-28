import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../uiStore';

beforeEach(() => {
  useUiStore.setState({
    codeView: 'session',
    codePlanTab: null,
    codeDiffTab: null,
    codeFileTab: null,
    codeFileTabs: [],
  });
});

describe('uiStore — plano como aba central', () => {
  it('abre o plano aprovado na mesma faixa de abas centrais', () => {
    useUiStore.getState().openCodePlan({
      conversationId: 'c-1',
      markdown: '# Plano',
      title: 'Plano',
      updatedAt: 1,
    });

    const state = useUiStore.getState();
    expect(state.codeView).toBe('plan');
    expect(state.codePlanTab).toEqual({
      conversationId: 'c-1',
      markdown: '# Plano',
      title: 'Plano',
      updatedAt: 1,
    });
  });

  it('atualiza o Markdown ao abrir novamente (plano revisado)', () => {
    useUiStore.getState().openCodePlan({ conversationId: 'c-1', markdown: '# v1', updatedAt: 1 });
    useUiStore.getState().openCodePlan({ conversationId: 'c-1', markdown: '# v2', updatedAt: 2 });

    expect(useUiStore.getState().codePlanTab?.markdown).toBe('# v2');
    expect(useUiStore.getState().codeView).toBe('plan');
  });

  it('fechar a aba do plano volta para a sessão quando ela era a ativa', () => {
    useUiStore.getState().openCodePlan({ conversationId: 'c-1', markdown: '# Plano', updatedAt: 1 });

    useUiStore.getState().closeCodePlan();

    expect(useUiStore.getState().codePlanTab).toBeNull();
    expect(useUiStore.getState().codeView).toBe('session');
  });

  it('fechar o plano em segundo plano mantém a view ativa', () => {
    useUiStore.setState({
      codeView: 'file',
      codeFileTab: { workspaceId: 'ws-1', path: 'src/app.ts' },
      codePlanTab: { conversationId: 'c-1', markdown: '# Plano', updatedAt: 1 },
    });

    useUiStore.getState().closeCodePlan();

    expect(useUiStore.getState().codePlanTab).toBeNull();
    expect(useUiStore.getState().codeView).toBe('file');
  });
});
