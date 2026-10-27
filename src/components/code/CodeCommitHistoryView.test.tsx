// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkspaceCommitDetail, WorkspaceGitCommit } from '@/lib/types';

const mocks = vi.hoisted(() => ({ gitLog: vi.fn(), gitCommitDetail: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: mocks }));

import { CodeCommitHistoryView } from './CodeCommitHistoryView';

function commit(overrides: Partial<WorkspaceGitCommit> = {}): WorkspaceGitCommit {
  return {
    hash: 'abcdef1234567890abcdef1234567890abcdef12',
    subject: 'Corrige a listagem do workspace',
    author: 'Lumina Agent',
    date: '2026-10-27T17:00:00-03:00',
    ...overrides,
  };
}

function detail(overrides: Partial<WorkspaceCommitDetail> = {}): WorkspaceCommitDetail {
  return {
    hash: 'abcdef1234567890abcdef1234567890abcdef12',
    author: 'Lumina Agent',
    email: 'agent@lumina.local',
    date: '2026-10-27T17:00:00-03:00',
    subject: 'Corrige a listagem do workspace',
    body: 'Corpo do commit.',
    files: [
      {
        path: 'src/app.ts',
        status: 'M',
        added: 2,
        removed: 1,
        binary: false,
        diff: '@@ -1,2 +1,3 @@\n-const a = 1;\n+const a = 2;\n+export {};',
      },
      {
        path: 'novo.txt',
        status: 'A',
        added: 1,
        removed: 0,
        binary: false,
        diff: '@@ -0,0 +1 @@\n+ola',
      },
    ],
    truncated: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gitLog.mockResolvedValue([commit()]);
  mocks.gitCommitDetail.mockResolvedValue(detail());
});

afterEach(cleanup);

describe('CodeCommitHistoryView', () => {
  it('lista os commits e abre um commit ao clicar', async () => {
    const onSelect = vi.fn();
    render(<CodeCommitHistoryView target={{ workspaceId: 'ws-1', revision: null }} onSelect={onSelect} />);

    expect(await screen.findByText('Corrige a listagem do workspace')).toBeTruthy();
    expect(screen.getByText('abcdef1')).toBeTruthy();
    fireEvent.click(screen.getByText('Corrige a listagem do workspace'));

    expect(onSelect).toHaveBeenCalledWith('abcdef1234567890abcdef1234567890abcdef12');
  });

  it('mostra estado vazio quando não há commits', async () => {
    mocks.gitLog.mockResolvedValue([]);
    render(<CodeCommitHistoryView target={{ workspaceId: 'ws-1', revision: null }} onSelect={() => undefined} />);

    expect(await screen.findByText('Nenhum commit ainda')).toBeTruthy();
  });

  it('abre um commit com metadados, arquivos e diff completo', async () => {
    const onSelect = vi.fn();
    render(
      <CodeCommitHistoryView
        target={{ workspaceId: 'ws-1', revision: 'abcdef1234567890abcdef1234567890abcdef12' }}
        onSelect={onSelect}
      />,
    );

    expect(await screen.findByText('Corrige a listagem do workspace')).toBeTruthy();
    expect(mocks.gitCommitDetail).toHaveBeenCalledWith(
      'ws-1',
      'abcdef1234567890abcdef1234567890abcdef12',
    );
    expect(screen.getByText(/Lumina Agent · agent@lumina\.local/)).toBeTruthy();
    expect(screen.getByText('Corpo do commit.')).toBeTruthy();

    // Primeiro arquivo já vem aberto com o diff (syntax highlight preservado).
    expect(screen.getByRole('group', { name: 'Diff de src/app.ts' })).toBeTruthy();

    // O segundo arquivo abre ao clicar e mostra seu patch.
    fireEvent.click(screen.getByText('novo.txt'));
    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'Diff de novo.txt' })).toBeTruthy(),
    );

    // "Expandir diffs" abre todos; "Recolher diffs" fecha.
    fireEvent.click(screen.getByRole('button', { name: 'Recolher diffs' }));
    expect(screen.queryByRole('group', { name: 'Diff de src/app.ts' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expandir diffs' }));
    expect(screen.getByRole('group', { name: 'Diff de src/app.ts' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar aos commits' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('mostra erro honesto ao falhar o carregamento do commit', async () => {
    mocks.gitCommitDetail.mockRejectedValueOnce('revisão inválida');
    render(
      <CodeCommitHistoryView
        target={{ workspaceId: 'ws-1', revision: 'abcdef1234567890abcdef1234567890abcdef12' }}
        onSelect={() => undefined}
      />,
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/revisão inválida/)).toBeTruthy();
  });
});
