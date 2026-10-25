// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clampSidebarWidth,
  clampSidePanelWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  SIDE_PANEL_WIDTH_DEFAULT,
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_WIDTH_MIN,
  sortArtifacts,
  useUiStore,
} from '@/lib/store/uiStore';
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

describe('useUiStore sidebar width', () => {
  beforeEach(() => {
    useUiStore.setState({ sidebarWidth: SIDEBAR_WIDTH_DEFAULT });
  });

  it('starts at the design default (272px)', () => {
    expect(SIDEBAR_WIDTH_DEFAULT).toBe(272);
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT);
  });

  it('clamps widths into the supported range and rounds them', () => {
    useUiStore.getState().setSidebarWidth(10);
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_MIN);

    useUiStore.getState().setSidebarWidth(9999);
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_MAX);

    useUiStore.getState().setSidebarWidth(331.6);
    expect(useUiStore.getState().sidebarWidth).toBe(332);
  });

  it('falls back to the default for invalid input', () => {
    useUiStore.getState().setSidebarWidth(300);
    useUiStore.getState().setSidebarWidth(Number.NaN);
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT);

    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(clampSidebarWidth(Number.NEGATIVE_INFINITY)).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(clampSidebarWidth(250)).toBe(250);
  });

  it('persists the width in the UI storage', () => {
    useUiStore.getState().setSidebarWidth(340);

    const raw = window.localStorage.getItem('lumina.ui');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string) as { state?: { sidebarWidth?: number } };
    expect(persisted.state?.sidebarWidth).toBe(340);
  });

  it('clamps a corrupted persisted width while rehydrating', async () => {
    window.localStorage.setItem(
      'lumina.ui',
      JSON.stringify({ version: 0, state: { sidebarWidth: 9000 } }),
    );

    await useUiStore.persist.rehydrate();

    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_MAX);
  });
});

describe('useUiStore side panel width', () => {
  beforeEach(() => {
    useUiStore.setState({ sidePanelWidth: SIDE_PANEL_WIDTH_DEFAULT });
  });

  it('starts at the design default (480px)', () => {
    expect(SIDE_PANEL_WIDTH_DEFAULT).toBe(480);
    expect(useUiStore.getState().sidePanelWidth).toBe(SIDE_PANEL_WIDTH_DEFAULT);
  });

  it('clamps widths into the supported range and rounds them', () => {
    useUiStore.getState().setSidePanelWidth(10);
    expect(useUiStore.getState().sidePanelWidth).toBe(SIDE_PANEL_WIDTH_MIN);

    useUiStore.getState().setSidePanelWidth(9999);
    expect(useUiStore.getState().sidePanelWidth).toBe(SIDE_PANEL_WIDTH_MAX);

    useUiStore.getState().setSidePanelWidth(451.4);
    expect(useUiStore.getState().sidePanelWidth).toBe(451);
  });

  it('falls back to the default for invalid input', () => {
    useUiStore.getState().setSidePanelWidth(420);
    useUiStore.getState().setSidePanelWidth(Number.NaN);
    expect(useUiStore.getState().sidePanelWidth).toBe(SIDE_PANEL_WIDTH_DEFAULT);

    expect(clampSidePanelWidth(Number.POSITIVE_INFINITY)).toBe(SIDE_PANEL_WIDTH_DEFAULT);
    expect(clampSidePanelWidth(Number.NEGATIVE_INFINITY)).toBe(SIDE_PANEL_WIDTH_DEFAULT);
    expect(clampSidePanelWidth(500)).toBe(500);
  });

  it('persists the width in the UI storage', () => {
    useUiStore.getState().setSidePanelWidth(520);

    const raw = window.localStorage.getItem('lumina.ui');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string) as { state?: { sidePanelWidth?: number } };
    expect(persisted.state?.sidePanelWidth).toBe(520);
  });

  it('clamps a corrupted persisted width while rehydrating', async () => {
    window.localStorage.setItem(
      'lumina.ui',
      JSON.stringify({ version: 0, state: { sidePanelWidth: 9000 } }),
    );

    await useUiStore.persist.rehydrate();

    expect(useUiStore.getState().sidePanelWidth).toBe(SIDE_PANEL_WIDTH_MAX);
  });
});

describe('useUiStore side panel mode', () => {
  beforeEach(() => {
    useUiStore.setState({ sidePanelMode: 'overlay' });
  });

  it('starts in the overlay (drawer) layout — the classic behaviour', () => {
    expect(useUiStore.getState().sidePanelMode).toBe('overlay');
  });

  it('toggles and persists the docked preference', () => {
    useUiStore.getState().setSidePanelMode('docked');
    expect(useUiStore.getState().sidePanelMode).toBe('docked');

    const raw = window.localStorage.getItem('lumina.ui');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string) as { state?: { sidePanelMode?: string } };
    expect(persisted.state?.sidePanelMode).toBe('docked');

    useUiStore.getState().setSidePanelMode('overlay');
    expect(useUiStore.getState().sidePanelMode).toBe('overlay');
  });

  it('keeps a valid docked preference and normalizes an invalid one while rehydrating', async () => {
    window.localStorage.setItem(
      'lumina.ui',
      JSON.stringify({ version: 0, state: { sidePanelMode: 'docked' } }),
    );
    await useUiStore.persist.rehydrate();
    expect(useUiStore.getState().sidePanelMode).toBe('docked');

    window.localStorage.setItem(
      'lumina.ui',
      JSON.stringify({ version: 0, state: { sidePanelMode: 'floating' } }),
    );
    await useUiStore.persist.rehydrate();
    expect(useUiStore.getState().sidePanelMode).toBe('overlay');
  });
});

describe('useUiStore — painéis laterais mutuamente exclusivos', () => {
  beforeEach(() => {
    useUiStore.setState({ artifactPanelOpen: false, sourcesPanelOpen: false });
  });

  it('keeps only the panel opened last when the state is mutated directly (regression: duas barras abertas)', () => {
    useUiStore.setState({ artifactPanelOpen: true, sourcesPanelOpen: false });

    // A corruption path (stale HMR store, devtools, future action) that would
    // render both surfaces side by side must be repaired by the invariant.
    useUiStore.setState({ sourcesPanelOpen: true });

    expect(useUiStore.getState().sourcesPanelOpen).toBe(true);
    expect(useUiStore.getState().artifactPanelOpen).toBe(false);
  });

  it('closes the sources panel when only the artifact flags remain open', () => {
    useUiStore.setState({ artifactPanelOpen: false, sourcesPanelOpen: true });

    useUiStore.setState({ artifactPanelOpen: true });

    expect(useUiStore.getState().artifactPanelOpen).toBe(true);
    expect(useUiStore.getState().sourcesPanelOpen).toBe(false);
  });

  it('repairs a state where both panels are already open', () => {
    useUiStore.setState({ artifactPanelOpen: false, sourcesPanelOpen: false });
    // Bypass the exclusive actions on purpose, simulating a corrupted snapshot.
    useUiStore.setState({ artifactPanelOpen: true });
    useUiStore.setState({ sourcesPanelOpen: true });
    useUiStore.setState({ artifactPanelOpen: true });

    expect(
      useUiStore.getState().artifactPanelOpen && useUiStore.getState().sourcesPanelOpen,
    ).toBe(false);
  });
});
