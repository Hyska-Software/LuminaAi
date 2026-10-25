// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { sortArtifacts, useUiStore } from '@/lib/store/uiStore';
import type { Artifact } from '@/lib/types';

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'artifact-1',
    conversationId: 'conv-1',
    messageId: 'assistant-1',
    name: 'relatorio.md',
    mimeType: 'text/markdown',
    kind: 'markdown',
    language: 'markdown',
    size: 120,
    createdAt: 1,
    ...overrides,
  };
}

function resetUi(): void {
  useUiStore.setState({
    artifactPanelOpen: false,
    artifactPanelView: 'list',
    sourcesPanelOpen: false,
    activeArtifactId: null,
    artifacts: [],
  });
}

beforeEach(resetUi);

describe('sortArtifacts', () => {
  it('orders by createdAt and then id, without duplicating ids', () => {
    const sorted = sortArtifacts([
      artifact({ id: 'b', createdAt: 20 }),
      artifact({ id: 'old', createdAt: 1 }),
      artifact({ id: 'c', createdAt: 20 }),
      // A repeated id is replaced by the freshest payload but keeps one slot.
      artifact({ id: 'b', createdAt: 20, name: 'novo-nome.md' }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(['old', 'b', 'c']);
    expect(sorted[1]?.name).toBe('novo-nome.md');
  });
});

describe('useUiStore artifacts', () => {
  it('addArtifact inserts in canonical order instead of prepending', () => {
    useUiStore.getState().addArtifact(artifact({ id: 'late', createdAt: 30 }));
    useUiStore.getState().addArtifact(artifact({ id: 'early', createdAt: 10 }));

    expect(useUiStore.getState().artifacts.map((entry) => entry.id)).toEqual(['early', 'late']);
  });

  it('setArtifacts keeps a still-existing selection and falls back to the list when it is gone', () => {
    useUiStore.setState({
      artifacts: [artifact({ id: 'a', createdAt: 1 })],
      activeArtifactId: 'a',
      artifactPanelOpen: true,
      artifactPanelView: 'preview',
    });

    useUiStore.getState().setArtifacts([artifact({ id: 'a', createdAt: 1 }), artifact({ id: 'b', createdAt: 2 })]);
    expect(useUiStore.getState().activeArtifactId).toBe('a');
    expect(useUiStore.getState().artifactPanelView).toBe('preview');

    useUiStore.getState().setArtifacts([artifact({ id: 'b', createdAt: 2 })]);
    expect(useUiStore.getState().activeArtifactId).toBeNull();
    expect(useUiStore.getState().artifactPanelView).toBe('list');
  });

  it('openArtifactList opens the panel on the list', () => {
    useUiStore.setState({ artifacts: [artifact()], activeArtifactId: 'artifact-1' });

    useUiStore.getState().openArtifactList();

    expect(useUiStore.getState().artifactPanelOpen).toBe(true);
    expect(useUiStore.getState().artifactPanelView).toBe('list');
  });

  it('setActiveArtifact opens the preview; clearing the selection returns to the list', () => {
    useUiStore.getState().setActiveArtifact('artifact-1');
    expect(useUiStore.getState()).toMatchObject({
      artifactPanelOpen: true,
      artifactPanelView: 'preview',
      activeArtifactId: 'artifact-1',
    });

    useUiStore.getState().setActiveArtifact(null);
    expect(useUiStore.getState()).toMatchObject({
      artifactPanelOpen: true,
      artifactPanelView: 'list',
      activeArtifactId: null,
    });
  });

  it('openArtifactPanel previews the current artifact, or shows the list when there is none', () => {
    useUiStore.getState().openArtifactPanel();
    expect(useUiStore.getState().artifactPanelView).toBe('list');

    useUiStore.setState({ activeArtifactId: 'artifact-1' });
    useUiStore.getState().openArtifactPanel();
    expect(useUiStore.getState().artifactPanelView).toBe('preview');
    expect(useUiStore.getState().activeArtifactId).toBe('artifact-1');
  });

  it('setArtifactPanelView("preview") selects the most recent artifact when none is active', () => {
    useUiStore.setState({
      artifacts: [artifact({ id: 'old', createdAt: 1 }), artifact({ id: 'new', createdAt: 2 })],
      activeArtifactId: null,
      artifactPanelOpen: true,
    });

    useUiStore.getState().setArtifactPanelView('preview');
    expect(useUiStore.getState().activeArtifactId).toBe('new');

    useUiStore.getState().setArtifactPanelView('list');
    expect(useUiStore.getState().artifactPanelView).toBe('list');
  });
});

describe('useUiStore sources panel', () => {
  it('openSourcesPanel opens the fontes panel and closes the artifact panel', () => {
    useUiStore.setState({
      artifactPanelOpen: true,
      artifacts: [artifact()],
      activeArtifactId: 'artifact-1',
      artifactPanelView: 'preview',
    });

    useUiStore.getState().openSourcesPanel();

    expect(useUiStore.getState()).toMatchObject({
      sourcesPanelOpen: true,
      artifactPanelOpen: false,
    });

    useUiStore.getState().closeSourcesPanel();
    expect(useUiStore.getState().sourcesPanelOpen).toBe(false);
  });

  it('opening the artifact panel/list closes the sources panel', () => {
    useUiStore.setState({ sourcesPanelOpen: true, artifacts: [artifact()] });

    useUiStore.getState().openArtifactList();
    expect(useUiStore.getState().sourcesPanelOpen).toBe(false);

    useUiStore.setState({ sourcesPanelOpen: true });
    useUiStore.getState().openArtifactPanel();
    expect(useUiStore.getState().sourcesPanelOpen).toBe(false);

    useUiStore.setState({ sourcesPanelOpen: true });
    useUiStore.getState().setActiveArtifact('artifact-1');
    expect(useUiStore.getState().sourcesPanelOpen).toBe(false);
  });

  it('closeAllOverlays also closes the sources panel', () => {
    useUiStore.setState({ sourcesPanelOpen: true });
    useUiStore.getState().closeAllOverlays();
    expect(useUiStore.getState().sourcesPanelOpen).toBe(false);
  });
});
