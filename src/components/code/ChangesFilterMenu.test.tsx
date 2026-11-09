// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkspaceGitCommit } from '@/lib/types';

vi.mock('@/lib/api', () => ({ api: {} }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { ChangesFilterMenu, filterLabel, filterKey, type ChangesFilter } from './ChangesFilterMenu';

const commits: WorkspaceGitCommit[] = [
  {
    hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    subject: 'Add Attachments To Agent Channels',
    author: 'Ana',
    date: '2026-11-09',
  },
];

function renderMenu(overrides: Partial<Parameters<typeof ChangesFilterMenu>[0]> = {}) {
  const onChange = vi.fn();
  const onOpenBranches = vi.fn();
  const props = {
    value: { kind: 'uncommitted' } as ChangesFilter,
    onChange,
    commits: [] as WorkspaceGitCommit[],
    branches: null,
    currentBranch: null,
    branchesLoading: false,
    branchesError: null,
    onOpenBranches,
    ...overrides,
  };
  const view = render(<ChangesFilterMenu {...props} />);
  return { ...view, onChange, onOpenBranches, props };
}

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Filtrar alterações' }));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('ChangesFilterMenu', () => {
  it('labels and keys each filter', () => {
    expect(filterLabel({ kind: 'last-turn' })).toBe('Último turno');
    expect(filterLabel({ kind: 'uncommitted' })).toBe('Sem commit');
    expect(filterLabel({ kind: 'unstaged' })).toBe('Não marcadas para commit');
    expect(filterLabel({ kind: 'staged' })).toBe('Marcadas para commit');
    expect(filterLabel({ kind: 'commit', hash: commits[0].hash, subject: commits[0].subject })).toBe(
      'Commit a1b2c3d',
    );
    expect(filterLabel({ kind: 'branch', base: 'main' })).toBe('Branch main');
    expect(filterKey({ kind: 'last-turn' })).toBe('last-turn');
    expect(filterKey({ kind: 'commit', hash: 'abc1234', subject: 'x' })).toBe('commit:abc1234');
    expect(filterKey({ kind: 'branch', base: 'main' })).toBe('branch:main');
  });

  it('selects the flat filters', async () => {
    const { onChange } = renderMenu();
    const user = await openMenu();

    await user.click(screen.getByRole('menuitem', { name: 'Último turno' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'last-turn' });

    await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Não marcadas para commit' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'unstaged' });

    await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Marcadas para commit' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'staged' });
  });

  it('lists commits in a submenu and selects one', async () => {
    const { onChange } = renderMenu({ commits });
    const user = await openMenu();

    const trigger = screen.getByRole('menuitem', { name: 'Commit' });
    await user.click(trigger);

    const item = await screen.findByRole('menuitem', { name: /a1b2c3d · Add Attachments/ });
    fireEvent.click(item);
    expect(onChange).toHaveBeenCalledWith({
      kind: 'commit',
      hash: commits[0].hash,
      subject: commits[0].subject,
    });
  });

  it('loads branches when the submenu opens and omits the current branch', async () => {
    const first = renderMenu({ commits, branches: null });
    const user = await openMenu();

    const branchTrigger = screen.getByRole('menuitem', { name: 'Branch' });
    await user.click(branchTrigger);
    expect(first.onOpenBranches).toHaveBeenCalledTimes(1);

    cleanup();
    const second = renderMenu({
      commits,
      branches: ['main', 'feature'],
      currentBranch: 'main',
    });
    const user2 = await openMenu();
    await user2.click(screen.getByRole('menuitem', { name: 'Branch' }));
    expect(screen.queryByRole('menuitem', { name: 'main' })).toBeNull();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'feature' }));
    expect(second.onChange).toHaveBeenCalledWith({ kind: 'branch', base: 'feature' });
  });

  it('shows the empty commit/branch states', async () => {
    renderMenu({ commits: [], branches: [] });
    const user = await openMenu();

    expect(screen.getByRole('menuitem', { name: 'Commit' }).hasAttribute('data-disabled')).toBe(
      true,
    );
    await user.click(screen.getByRole('menuitem', { name: 'Branch' }));
    expect(await screen.findByText('Nenhuma outra branch')).toBeTruthy();
  });

  it('shows the branch error inside the submenu', async () => {
    renderMenu({
      branches: null,
      branchesError: 'git indisponível',
    });
    const user = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Branch' }));
    expect(await screen.findByText('git indisponível')).toBeTruthy();
  });
});
