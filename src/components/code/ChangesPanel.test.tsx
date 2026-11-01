// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FileChange, WorkspaceGitStatus } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  getFileDiff: vi.fn(),
  gitStage: vi.fn(),
  gitStageAll: vi.fn(),
  gitUnstage: vi.fn(),
  gitUnstageAll: vi.fn(),
  gitDiscard: vi.fn(),
  revertFile: vi.fn(),
  gitLog: vi.fn(),
  gitCommit: vi.fn(),
  suggestCommitMessage: vi.fn(),
}));
const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({ toast: toastMocks }));

import { buildChangeRows, ChangesPanel } from './ChangesPanel';

function status(overrides: Partial<WorkspaceGitStatus> = {}): WorkspaceGitStatus {
  return {
    isRepo: true,
    root: 'H:/projeto',
    branch: 'main',
    staged: [{ path: 'src/a.ts', status: 'M' }],
    unstaged: [{ path: 'src/b.ts', status: 'M' }],
    untracked: ['novo.ts'],
    conflicted: [],
    ...overrides,
  };
}

const sessionChanges: FileChange[] = [
  {
    path: 'src/b.ts',
    kind: 'modified',
    added: 4,
    removed: 1,
    diff: '@@ -1 +1 @@\n-a\n+b',
  },
];

const rowButton = (path: string) => screen.getByTitle(path);

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFileDiff.mockResolvedValue('@@ -1 +1 @@\n-a\n+b');
  mocks.gitStage.mockResolvedValue(status());
  mocks.gitStageAll.mockResolvedValue(status());
  mocks.gitUnstage.mockResolvedValue(status());
  mocks.gitUnstageAll.mockResolvedValue(status());
  mocks.gitDiscard.mockResolvedValue(status());
  mocks.revertFile.mockResolvedValue(true);
  mocks.gitLog.mockResolvedValue([]);
  mocks.gitCommit.mockResolvedValue(status());
  mocks.suggestCommitMessage.mockResolvedValue('Mensagem sugerida');
});

describe('buildChangeRows', () => {
  it('merges git + session changes and marks the origin', () => {
    const rows = buildChangeRows(status(), sessionChanges);
    expect(rows.length).toBe(3);
    const b = rows.find((row) => row.path === 'src/b.ts');
    expect(b?.origin).toBe('both');
    expect(b?.added).toBe(4);
    expect(b?.removed).toBe(1);
    expect(b?.knownDiff).toContain('+b');
    const a = rows.find((row) => row.path === 'src/a.ts');
    expect(a?.origin).toBe('git');
    expect(a?.group).toBe('staged');
  });

  it('keeps session-only files in their own group', () => {
    const rows = buildChangeRows(status(), [
      { path: 'src/novo.ts', kind: 'created', added: 10, removed: 0 },
    ]);
    const created = rows.find((row) => row.path === 'src/novo.ts');
    expect(created?.status).toBe('A');
    expect(created?.group).toBe('session');
    expect(created?.origin).toBe('session');
    expect(created?.status).toBe('A');
  });

  it('uses git-origin summary entries for counters without marking them as agent edits', () => {
    const rows = buildChangeRows(status(), [
      {
        path: 'src/a.ts',
        kind: 'modified',
        added: 7,
        removed: 2,
        origin: 'git',
        staged: true,
      },
      { path: 'novo.ts', kind: 'created', added: 3, removed: 0, origin: 'git' },
    ]);
    const a = rows.find((row) => row.path === 'src/a.ts');
    expect(a?.origin).toBe('git');
    expect(a?.group).toBe('staged');
    expect(a?.added).toBe(7);
    expect(a?.removed).toBe(2);
    const novo = rows.find((row) => row.path === 'novo.ts');
    expect(novo?.origin).toBe('git');
    expect(novo?.group).toBe('untracked');
    expect(novo?.added).toBe(3);
  });
});

describe('ChangesPanel', () => {
  it('groups by stage state and shows origin badges and counters', () => {
    render(<ChangesPanel workspaceId="ws-1" gitStatus={status()} sessionChanges={sessionChanges} />);
    expect(screen.getByRole('heading', { name: /Preparados/ })).toBeTruthy();
    // Sticky group headers blend with the panel surface (same chrome as the sidebar).
    const header = screen.getByRole('heading', { name: /Preparados/ });
    expect(header.className).toContain('bg-surface');
    expect(header.className).not.toContain('bg-surface-raised');
    expect(screen.getByRole('heading', { name: /Não preparados/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Novos/ })).toBeTruthy();

    const b = rowButton('src/b.ts');
    expect(b.textContent).toContain('agente + git');
    expect(b.textContent).toContain('+4');
    expect(b.textContent).toContain('−1');
    expect(rowButton('src/a.ts').textContent).not.toContain('agente');
  });

  it('shows git-only counters without the agent badge', () => {
    render(
      <ChangesPanel
        workspaceId="ws-1"
        gitStatus={status()}
        sessionChanges={[
          { path: 'src/a.ts', kind: 'modified', added: 7, removed: 2, origin: 'git', staged: true },
          { path: 'novo.ts', kind: 'created', added: 5, removed: 0, origin: 'git' },
        ]}
      />,
    );
    const a = rowButton('src/a.ts');
    expect(a.textContent).not.toContain('agente');
    expect(a.textContent).toContain('+7');
    expect(a.textContent).toContain('−2');
    const novo = rowButton('novo.ts');
    expect(novo.textContent).not.toContain('agente');
    expect(novo.textContent).toContain('+5');
  });

  it('marks each file row with the real file-type icon', () => {
    render(
      <ChangesPanel
        workspaceId="ws-1"
        gitStatus={status({
          staged: [],
          unstaged: [
            { path: 'src/main.rs', status: 'M' },
            { path: 'docs/manual.pdf', status: 'M' },
          ],
          untracked: ['novo.ts'],
        })}
        sessionChanges={[]}
      />,
    );

    const iconKey = (path: string) =>
      rowButton(path).querySelector('[data-file-icon]')?.getAttribute('data-file-icon');
    expect(iconKey('src/main.rs')).toBe('rust');
    expect(iconKey('docs/manual.pdf')).toBe('pdf');
    expect(iconKey('novo.ts')).toBe('typescript');
    // Status letter and path remain part of the row.
    expect(rowButton('src/main.rs').textContent).toContain('M');
    expect(rowButton('src/main.rs').textContent).toContain('src/main.rs');
  });

  it('opens the known session diff in place and goes back', async () => {
    render(<ChangesPanel workspaceId="ws-1" gitStatus={status()} sessionChanges={sessionChanges} />);
    fireEvent.click(rowButton('src/b.ts'));

    expect(screen.getByRole('group', { name: 'Diff de src/b.ts' })).toBeTruthy();
    expect(mocks.getFileDiff).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para alterações' }));
    expect(screen.queryByRole('group', { name: /Diff de/ })).toBeNull();
    expect(rowButton('src/b.ts')).toBeTruthy();
  });

  it('loads the diff through the api when the session has none', async () => {
    render(<ChangesPanel workspaceId="ws-1" gitStatus={status()} sessionChanges={[]} />);
    fireEvent.click(rowButton('novo.ts'));
    await waitFor(() => expect(mocks.getFileDiff).toHaveBeenCalledWith('ws-1', 'novo.ts', false));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Diff de novo.ts' })).toBeTruthy());
  });

  it('delega o diff para a aba central quando onOpenDiffTab é fornecido', async () => {
    const onOpenDiffTab = vi.fn();
    render(
      <ChangesPanel
        workspaceId="ws-1"
        gitStatus={status()}
        sessionChanges={sessionChanges}
        onOpenDiffTab={onOpenDiffTab}
      />,
    );

    fireEvent.click(rowButton('src/b.ts'));

    expect(onOpenDiffTab).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'src/b.ts', staged: false, knownDiff: expect.any(String) }),
    );
    // No modo aba o painel não abre o detalhe inline nem chama a API.
    expect(screen.queryByRole('group', { name: /Diff de/ })).toBeNull();
    expect(mocks.getFileDiff).not.toHaveBeenCalled();
  });

  it('stages and unstages files through the api', async () => {
    const onRefresh = vi.fn();
    render(
      <ChangesPanel
        workspaceId="ws-1"
        gitStatus={status()}
        sessionChanges={sessionChanges}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preparar novo.ts' }));
    await waitFor(() => expect(mocks.gitStage).toHaveBeenCalledWith('ws-1', ['novo.ts']));
    expect(onRefresh).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remover src/a.ts do stage' }));
    await waitFor(() => expect(mocks.gitUnstage).toHaveBeenCalledWith('ws-1', ['src/a.ts']));
  });

  it('prepares everything at once and reports the count', async () => {
    const onRefresh = vi.fn();
    render(
      <ChangesPanel
        workspaceId="ws-1"
        gitStatus={status()}
        sessionChanges={sessionChanges}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preparar tudo' }));

    await waitFor(() => expect(mocks.gitStageAll).toHaveBeenCalledWith('ws-1'));
    expect(onRefresh).toHaveBeenCalled();
    // Um arquivo já preparado + dois pendentes = 2 arquivos preparados.
    expect(toastMocks.success).toHaveBeenCalledWith('2 arquivos preparados');
  });

  it('removes every prepared file from the index at once', async () => {
    render(
      <ChangesPanel
        workspaceId="ws-1"
        gitStatus={status({ staged: [{ path: 'src/a.ts', status: 'M' }] })}
        sessionChanges={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Desmarcar tudo' }));

    await waitFor(() => expect(mocks.gitUnstageAll).toHaveBeenCalledWith('ws-1'));
    expect(toastMocks.success).toHaveBeenCalledWith('1 arquivo removido do stage');
  });

  it('does not offer "preparar tudo" while merge conflicts are pending', () => {
    render(
      <ChangesPanel
        workspaceId="ws-1"
        gitStatus={status({
          conflicted: ['src/c.ts'],
          staged: [],
          unstaged: [],
          untracked: [],
        })}
        sessionChanges={[]}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Preparar tudo' })).toBeNull();
    expect(screen.getByText('Conflitos de merge — resolva antes de commitar.')).toBeTruthy();
  });

  it('reverts a git file through the confirmation dialog', async () => {
    render(<ChangesPanel workspaceId="ws-1" gitStatus={status()} sessionChanges={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reverter src/a.ts' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Reverter arquivo?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reverter' }));

    await waitFor(() => expect(mocks.gitDiscard).toHaveBeenCalledWith('ws-1', ['src/a.ts']));
    expect(toastMocks.success).toHaveBeenCalledWith('Arquivo revertido');
  });

  it('reverts a session change through revertFile', async () => {
    render(
      <ChangesPanel
        workspaceId="ws-1"
        conversationId="conv-1"
        gitStatus={status()}
        sessionChanges={sessionChanges}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reverter src/b.ts' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reverter' }));

    await waitFor(() => expect(mocks.revertFile).toHaveBeenCalledWith('conv-1', 'src/b.ts'));
  });

  it('shows the no-git notice and keeps session changes visible', () => {
    render(
      <ChangesPanel
        workspaceId="ws-1"
        gitStatus={status({ isRepo: false, staged: [], unstaged: [], untracked: [] })}
        sessionChanges={[{ path: 'src/x.ts', kind: 'created', added: 2, removed: 0 }]}
      />,
    );
    expect(screen.getByText('Não é um repositório Git.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Da sessão/ })).toBeTruthy();
    expect(rowButton('src/x.ts')).toBeTruthy();
  });

  it('shows the honest empty state', () => {
    render(
      <ChangesPanel
        workspaceId="ws-1"
        gitStatus={status({ staged: [], unstaged: [], untracked: [] })}
        sessionChanges={[]}
      />,
    );
    expect(screen.getByText('Nenhuma alteração pendente')).toBeTruthy();
    expect(screen.getByText('As edições do agente e as mudanças do git aparecem aqui.')).toBeTruthy();
  });

  it('warns about merge conflicts and blocks the commit', () => {
    render(
      <ChangesPanel
        workspaceId="ws-1"
        gitStatus={status({ conflicted: ['src/c.ts'] })}
        sessionChanges={sessionChanges}
      />,
    );
    expect(screen.getByText('Conflitos de merge — resolva antes de commitar.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Commit' }).getAttribute('title')).toBe(
      'Resolva os conflitos de merge antes de commitar',
    );
  });

  it('surfaces git and session read errors', () => {
    render(
      <ChangesPanel
        workspaceId="ws-1"
        gitStatus={status()}
        gitError="git indisponível"
        sessionChanges={[]}
        sessionError="journal indisponível"
      />,
    );
    expect(screen.getByText('git indisponível')).toBeTruthy();
    expect(screen.getByText('journal indisponível')).toBeTruthy();
  });
});

  it('arquivo novo aparece como A e mostra o diff sem staging', async () => {
    const untrackedStatus = status({
      staged: [],
      unstaged: [],
      untracked: ['novo.ts'],
      conflicted: [],
    });
    mocks.getFileDiff.mockResolvedValue(
      'diff --git a/novo.ts b/novo.ts\nnew file mode 100644\n--- /dev/null\n+++ b/novo.ts\n@@ -0,0 +1 @@\n+ola',
    );
    render(<ChangesPanel workspaceId="ws-1" gitStatus={untrackedStatus} sessionChanges={[]} />);

    const row = rowButton('novo.ts');
    expect(row.textContent).toContain('A');
    expect(row.textContent).not.toContain('?');

    fireEvent.click(row);
    await waitFor(() => expect(mocks.getFileDiff).toHaveBeenCalledWith('ws-1', 'novo.ts', false));
    expect(await screen.findByRole('group', { name: 'Diff de novo.ts' })).toBeTruthy();
  });