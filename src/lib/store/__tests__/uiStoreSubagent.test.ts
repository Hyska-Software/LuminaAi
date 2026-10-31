import { beforeEach, describe, expect, it } from 'vitest';

import { useUiStore, type CodeSubagentTab } from '../uiStore';

function tab(conversationId: string, taskCallId = `task-${conversationId}`): CodeSubagentTab {
  return {
    conversationId,
    taskCallId,
    subagentType: 'explore',
    description: `Tarefa ${conversationId}`,
    providerId: 'opencode-go',
    modelId: 'deepseek-v4.1-flash',
  };
}

describe('uiStore — subagent chat tabs', () => {
  beforeEach(() => {
    useUiStore.setState({
      codeView: 'session',
      codeSubagentTabs: [],
      codeSubagentTab: null,
    });
  });

  it('opens multiple subagent tabs and deduplicates by conversation', () => {
    expect(useUiStore.getState().openCodeSubagent(tab('child-1'))).toBe('opened');
    expect(useUiStore.getState().openCodeSubagent(tab('child-2'))).toBe('opened');

    let state = useUiStore.getState();
    expect(state.codeSubagentTabs).toHaveLength(2);
    expect(state.codeSubagentTab?.conversationId).toBe('child-2');
    expect(state.codeView).toBe('subagent');

    expect(useUiStore.getState().openCodeSubagent(tab('child-1'))).toBe('exists');
    state = useUiStore.getState();
    expect(state.codeSubagentTabs).toHaveLength(2);
    expect(state.codeSubagentTab?.conversationId).toBe('child-1');
  });

  it('closes the active tab to a neighbor and the last tab back to the session', () => {
    useUiStore.getState().openCodeSubagent(tab('child-1'));
    useUiStore.getState().openCodeSubagent(tab('child-2'));
    useUiStore.getState().openCodeSubagent(tab('child-3'));

    useUiStore.getState().closeCodeSubagent(tab('child-2'));
    let state = useUiStore.getState();
    expect(state.codeSubagentTabs).toHaveLength(2);
    expect(state.codeSubagentTab?.conversationId).toBe('child-3');
    expect(state.codeView).toBe('subagent');

    useUiStore.getState().closeCodeSubagent(tab('child-3'));
    useUiStore.getState().closeCodeSubagent(tab('child-1'));
    state = useUiStore.getState();
    expect(state.codeSubagentTabs).toHaveLength(0);
    expect(state.codeSubagentTab).toBeNull();
    expect(state.codeView).toBe('session');
  });

  it('keeps the active tab when closing a background tab', () => {
    useUiStore.getState().openCodeSubagent(tab('child-1'));
    useUiStore.getState().openCodeSubagent(tab('child-2'));

    useUiStore.getState().closeCodeSubagent(tab('child-1'));
    const state = useUiStore.getState();
    expect(state.codeSubagentTabs.map((entry) => entry.conversationId)).toEqual(['child-2']);
    expect(state.codeSubagentTab?.conversationId).toBe('child-2');
    expect(state.codeView).toBe('subagent');
  });
});
