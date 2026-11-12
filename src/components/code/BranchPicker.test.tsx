// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  gitBranches: vi.fn(),
  gitSwitchBranch: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitFetch: vi.fn(),
}));
const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({ toast: toastMocks }));

import type { WorkspaceGitBranch, WorkspaceGitStatus } from '@/lib/types';
import { BranchPicker } from './BranchPicker';

const api = vi.mocked(mocks);

function branch(overrides: Partial<WorkspaceGitBranch> = {}): WorkspaceGitBranch {
  return {
    name: 'main',
    local: true,
    remote: null,
    current: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    gone: false,
    subject: 'init',
    author: 'Dev',
    committedAt: 1_700_000_000,
    ...overrides,
  };
}

const localMain = branch({ name: 'main', current: true, upstream: 'origin/main' });
const localFeature = branch({ name: 'feat/login', subject: 'feat: login' });
const remoteMain = branch({ name: 'origin/main', local: false, remote: 'origin' });
const remoteOnly = branch({
  name: 'origin/release/2.0',
  local: false,
  remote: 'origin',
  subject: 'release: 2.0',
});

function status(branchName: string): WorkspaceGitStatus {
  return {
    isRepo: true,
    branch: branchName,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
  };
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Branch atual|Selecionar branch/ }));
  return screen.findByRole('dialog', { name: 'Branches do git' });
}

/** Row of `name`: options are matched by the title of their name span. */
function option(dialog: HTMLElement, name: string): HTMLElement {
  const found = within(dialog)
    .getAllByRole('option')
    .find((node) => node.querySelector('[title]')?.getAttribute('title') === name);
  if (!found) throw new Error(`option ${name} not found`);
  return found;
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  api.gitBranches.mockResolvedValue({
    current: 'main',
    branches: ['main', 'feat/login'],
    all: [localMain, localFeature, remoteMain, remoteOnly],
  });
  api.gitSwitchBranch.mockResolvedValue(status('feat/login'));
  api.gitCreateBranch.mockResolvedValue(status('feat/nova'));
  api.gitFetch.mockResolvedValue(status('main'));
});

describe('BranchPicker — trigger', () => {
  it('shows the checked-out branch and its ahead/behind counters', () => {
    render(<BranchPicker workspaceId="ws-1" isRepo currentBranch="main" ahead={2} behind={1} />);

    const trigger = screen.getByRole('button', {
      name: 'Branch atual main. Trocar de branch',
    });
    expect(trigger.textContent).toContain('main');
    expect(trigger.textContent).toContain('↑2');
    expect(trigger.textContent).toContain('↓1');
  });

  it('falls back to the branch loaded from git when no name is provided', async () => {
    const user = userEvent.setup();
    render(<BranchPicker workspaceId="ws-1" isRepo />);

    const trigger = screen.getByRole('button', { name: 'Selecionar branch' });
    expect(trigger.textContent).toContain('Sem branch');

    const dialog = await openPicker(user);
    expect(within(dialog).getByText('Atual: main')).toBeTruthy();
  });

  it('stays disabled with a readable reason outside a repository', () => {
    render(<BranchPicker workspaceId="ws-1" isRepo={false} />);

    const trigger = screen.getByRole('button', { name: 'Selecionar branch' });
    expect(trigger.hasAttribute('disabled')).toBe(true);
    expect(trigger.getAttribute('title')).toBe('Não é um repositório Git');
  });

  it('stays disabled without a workspace', () => {
    render(<BranchPicker workspaceId={null} isRepo />);

    const trigger = screen.getByRole('button', { name: 'Selecionar branch' });
    expect(trigger.hasAttribute('disabled')).toBe(true);
    expect(trigger.getAttribute('title')).toBe('Abra um workspace para trocar de branch');
  });
});

describe('BranchPicker — list', () => {
  it('groups local and remote branches and marks the current one', async () => {
    const user = userEvent.setup();
    render(<BranchPicker workspaceId="ws-1" isRepo currentBranch="main" />);

    const dialog = await openPicker(user);
    expect(within(dialog).getByRole('group', { name: 'Locais' })).toBeTruthy();
    expect(within(dialog).getByRole('group', { name: 'Remotas · origin' })).toBeTruthy();
    expect(option(dialog, 'main').getAttribute('aria-selected')).toBe('true');
    expect(option(dialog, 'feat/login').getAttribute('aria-selected')).toBe('false');
    expect(api.gitBranches).toHaveBeenCalledWith('ws-1');
  });

  it('filters as the user types and reports the match count', async () => {
    const user = userEvent.setup();
    render(<BranchPicker workspaceId="ws-1" isRepo currentBranch="main" />);

    const dialog = await openPicker(user);
    await user.type(within(dialog).getByRole('combobox', { name: 'Pesquisar branches' }), 'login');

    await waitFor(() => expect(within(dialog).queryByText('main')).toBeNull());
    expect(within(dialog).getByText('1 branch')).toBeTruthy();
    expect(within(dialog).getAllByText(/feat\/login/).length).toBeGreaterThan(0);
  });

  it('ignores accents and case in the search', async () => {
    api.gitBranches.mockResolvedValue({
      current: 'main',
      branches: ['feat/Árvore'],
      all: [localMain, branch({ name: 'feat/Árvore' })],
    });
    const user = userEvent.setup();
    render(<BranchPicker workspaceId="ws-1" isRepo currentBranch="main" />);

    const dialog = await openPicker(user);
    await user.type(within(dialog).getByRole('combobox', { name: 'Pesquisar branches' }), 'arvore');

    expect(within(dialog).getByText('feat/Árvore')).toBeTruthy();
  });

  it('offers creation when the query matches no branch', async () => {
    const user = userEvent.setup();
    render(<BranchPicker workspaceId="ws-1" isRepo currentBranch="main" />);

    const dialog = await openPicker(user);
    await user.type(within(dialog).getByRole('combobox', { name: 'Pesquisar branches' }), 'nova');

    expect(within(dialog).getByText('Nenhuma branch encontrada')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Criar branch “nova”' })).toBeTruthy();
  });

  it('surfaces a load error with a retry action', async () => {
    api.gitBranches.mockRejectedValueOnce(new Error('git indisponível'));
    api.gitBranches.mockResolvedValueOnce({
      current: 'main',
      branches: ['main'],
      all: [localMain],
    });
    const user = userEvent.setup();
    render(<BranchPicker workspaceId="ws-1" isRepo currentBranch="main" />);

    const dialog = await openPicker(user);
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).getByText('git indisponível')).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(api.gitBranches).toHaveBeenCalledTimes(2));
    expect(option(dialog, 'main')).toBeTruthy();
  });
});

describe('BranchPicker — switching branches', () => {
  it('switches to a local branch and notifies the container', async () => {
    const onChanged = vi.fn();
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    render(
      <BranchPicker
        workspaceId="ws-1"
        isRepo
        currentBranch="main"
        onChanged={onChanged}
        onRefresh={onRefresh}
      />,
    );

    const dialog = await openPicker(user);
    await user.click(option(dialog, 'feat/login'));

    await waitFor(() => expect(api.gitSwitchBranch).toHaveBeenCalledWith('ws-1', 'feat/login'));
    expect(onChanged).toHaveBeenCalledWith(status('feat/login'));
    expect(onRefresh).toHaveBeenCalled();
    expect(toastMocks.success).toHaveBeenCalledWith('Agora na branch feat/login');
  });

  it('checks out a remote branch by its full remote ref', async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<BranchPicker workspaceId="ws-1" isRepo currentBranch="main" onChanged={onChanged} />);

    const dialog = await openPicker(user);
    await user.click(option(dialog, 'origin/release/2.0'));

    await waitFor(() =>
      expect(api.gitSwitchBranch).toHaveBeenCalledWith('ws-1', 'origin/release/2.0'),
    );
  });

  it('does not re-checkout the branch that is already active', async () => {
    const user = userEvent.setup();
    render(<BranchPicker workspaceId="ws-1" isRepo currentBranch="main" />);

    const dialog = await openPicker(user);
    await user.click(option(dialog, 'main'));

    expect(api.gitSwitchBranch).not.toHaveBeenCalled();
  });

  it('reports a failed checkout without leaving the list', async () => {
    api.gitSwitchBranch.mockRejectedValueOnce(new Error('alterações locais impedem a troca'));
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<BranchPicker workspaceId="ws-1" isRepo currentBranch="main" onChanged={onChanged} />);

    const dialog = await openPicker(user);
    await user.click(option(dialog, 'feat/login'));

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith('Não foi possível trocar de branch', {
        description: 'alterações locais impedem a troca',
      }),
    );
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Branches do git' })).toBeTruthy();
  });

  it('moves the highlight with the arrow keys and checks out with Enter', async () => {
    const user = userEvent.setup();
    render(<BranchPicker workspaceId="ws-1" isRepo currentBranch="main" />);

    const dialog = await openPicker(user);
    const search = within(dialog).getByRole('combobox', { name: 'Pesquisar branches' });
    await waitFor(() => expect(search.getAttribute('aria-activedescendant')).toBeTruthy());
    // The first row (the current branch) starts highlighted.
    expect(option(dialog, 'main').hasAttribute('data-active')).toBe(true);

    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(option(dialog, 'feat/login').hasAttribute('data-active')).toBe(true));

    await user.keyboard('{Enter}');
    await waitFor(() => expect(api.gitSwitchBranch).toHaveBeenCalledWith('ws-1', 'feat/login'));
  });
});

describe('BranchPicker — creating branches', () => {
  it('creates a branch pre-filled from the search query', async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<BranchPicker workspaceId="ws-1" isRepo currentBranch="main" onChanged={onChanged} />);

    const dialog = await openPicker(user);
    await user.type(
      within(dialog).getByRole('combobox', { name: 'Pesquisar branches' }),
      'feat/nova',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Criar branch “feat/nova”' }));

    const nameField = within(dialog).getByRole('textbox', { name: 'Nome da nova branch' });
    expect((nameField as HTMLInputElement).value).toBe('feat/nova');

    await user.click(within(dialog).getByRole('button', { name: 'Criar e trocar' }));

    await waitFor(() =>
      expect(api.gitCreateBranch).toHaveBeenCalledWith('ws-1', 'feat/nova', null),
    );
    expect(onChanged).toHaveBeenCalledWith(status('feat/nova'));
    expect(toastMocks.success).toHaveBeenCalledWith('Branch feat/nova criada');
  });

  it('creates from the current HEAD and reports the hint', async () => {
    const user = userEvent.setup();
    render(<BranchPicker workspaceId="ws-1" isRepo currentBranch="main" />);

    const dialog = await openPicker(user);
    await user.click(within(dialog).getByRole('button', { name: 'Nova branch' }));
    expect(within(dialog).getByText('Começa no HEAD atual')).toBeTruthy();

    await user.type(
      within(dialog).getByRole('textbox', { name: 'Nome da nova branch' }),
      'feat/from-head',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Criar e trocar' }));

    await waitFor(() =>
      expect(api.gitCreateBranch).toHaveBeenCalledWith('ws-1', 'feat/from-head', null),
    );
  });

  it('keeps the dialog open and shows the backend error', async () => {
    api.gitCreateBranch.mockRejectedValueOnce(new Error('já existe uma branch `feat/login`'));
    const user = userEvent.setup();
    render(<BranchPicker workspaceId="ws-1" isRepo currentBranch="main" />);

    const dialog = await openPicker(user);
    await user.click(within(dialog).getByRole('button', { name: 'Nova branch' }));
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Nome da nova branch' }),
      'feat/login',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Criar e trocar' }));

    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).getByText('já existe uma branch `feat/login`')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Branches do git' })).toBeTruthy();
  });

  it('creates with Enter inside the name field', async () => {
    const user = userEvent.setup();
    render(<BranchPicker workspaceId="ws-1" isRepo currentBranch="main" />);

    const dialog = await openPicker(user);
    await user.click(within(dialog).getByRole('button', { name: 'Nova branch' }));
    const nameField = within(dialog).getByRole('textbox', { name: 'Nome da nova branch' });
    await user.type(nameField, 'feat/enter{Enter}');

    await waitFor(() =>
      expect(api.gitCreateBranch).toHaveBeenCalledWith('ws-1', 'feat/enter', null),
    );
  });
});

describe('BranchPicker — remote refresh', () => {
  it('fetches and reloads the branch list', async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    render(<BranchPicker workspaceId="ws-1" isRepo currentBranch="main" onRefresh={onRefresh} />);

    const dialog = await openPicker(user);
    expect(api.gitBranches).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole('button', { name: 'Buscar branches' }));

    await waitFor(() => expect(api.gitFetch).toHaveBeenCalledWith('ws-1'));
    await waitFor(() => expect(api.gitBranches).toHaveBeenCalledTimes(2));
    expect(onRefresh).toHaveBeenCalled();
    expect(toastMocks.success).toHaveBeenCalledWith('Atualizações buscadas');
  });

  it('reports a failed fetch', async () => {
    api.gitFetch.mockRejectedValueOnce(new Error('sem remoto configurado'));
    const user = userEvent.setup();
    render(<BranchPicker workspaceId="ws-1" isRepo currentBranch="main" />);

    const dialog = await openPicker(user);
    await user.click(within(dialog).getByRole('button', { name: 'Buscar branches' }));

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith('Não foi possível buscar atualizações', {
        description: 'sem remoto configurado',
      }),
    );
  });
});
