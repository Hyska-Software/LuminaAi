// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  githubAccount: vi.fn(),
  gitFetch: vi.fn(),
  gitPull: vi.fn(),
  gitPush: vi.fn(),
}));
const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({ toast: toastMocks }));

import { useGitHubStore } from '@/lib/store';
import { GitActionsMenu } from './GitActionsMenu';

const status = {
  isRepo: true,
  branch: 'main',
  ahead: 0,
  behind: 0,
  staged: [],
  unstaged: [],
  untracked: [],
  conflicted: [],
};

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.githubAccount.mockResolvedValue({
    authenticated: false,
    login: null,
    source: 'none',
    scopes: [],
  });
  mocks.gitFetch.mockResolvedValue(status);
  mocks.gitPull.mockResolvedValue(status);
  mocks.gitPush.mockResolvedValue(status);
  useGitHubStore.setState({
    account: { data: null, loading: false, error: null },
    accountLoadedAt: null,
  });
});

describe('GitActionsMenu', () => {
  it('runs fetch, pull and push through the api and refreshes the panel', async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    render(
      <GitActionsMenu workspaceId="ws-1" isRepo ahead={2} behind={1} onRefresh={onRefresh} />,
    );

    const openMenu = async () => {
      await user.click(screen.getByRole('button', { name: 'Ações do git' }));
      return screen.findByRole('menu');
    };

    let menu = await openMenu();
    expect(within(menu).getByText('↓1')).toBeTruthy();
    expect(within(menu).getByText('↑2')).toBeTruthy();
    await user.click(within(menu).getByRole('menuitem', { name: /Buscar \(fetch\)/ }));
    await waitFor(() => expect(mocks.gitFetch).toHaveBeenCalledWith('ws-1'));

    menu = await openMenu();
    await user.click(within(menu).getByRole('menuitem', { name: /Puxar \(pull\)/ }));
    await waitFor(() => expect(mocks.gitPull).toHaveBeenCalledWith('ws-1'));

    menu = await openMenu();
    await user.click(within(menu).getByRole('menuitem', { name: /Enviar \(push\)/ }));
    await waitFor(() => expect(mocks.gitPush).toHaveBeenCalledWith('ws-1'));

    expect(onRefresh).toHaveBeenCalledTimes(3);
    expect(toastMocks.success).toHaveBeenCalledWith('Atualizações buscadas');
    expect(toastMocks.success).toHaveBeenCalledWith('Push concluído');
  });

  it('surfaces the backend error in the toast', async () => {
    mocks.gitPush.mockRejectedValueOnce(new Error('nenhum upstream configurado'));
    const user = userEvent.setup();
    render(<GitActionsMenu workspaceId="ws-1" isRepo />);

    await user.click(screen.getByRole('button', { name: 'Ações do git' }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /Enviar \(push\)/ }));

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith('Não foi possível fazer push', {
        description: 'nenhum upstream configurado',
      }),
    );
  });

  it('stays disabled outside a git repository', () => {
    render(<GitActionsMenu workspaceId="ws-1" isRepo={false} />);

    const trigger = screen.getByRole('button', { name: 'Ações do git' });
    expect(trigger.hasAttribute('disabled')).toBe(true);
    expect(trigger.getAttribute('title')).toBe('Não é um repositório Git');
  });

  it('refreshes the status from the menu without touching the remote', async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    render(<GitActionsMenu workspaceId="ws-1" isRepo onRefresh={onRefresh} />);

    await user.click(screen.getByRole('button', { name: 'Ações do git' }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: 'Atualizar status' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.gitFetch).not.toHaveBeenCalled();
  });

  it('sonda a conta uma única vez para aberturas consecutivas', async () => {
    const user = userEvent.setup();
    render(<GitActionsMenu workspaceId="ws-1" isRepo />);

    for (let open = 0; open < 2; open += 1) {
      await user.click(screen.getByRole('button', { name: 'Ações do git' }));
      await screen.findByRole('menu');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    }

    // A sondagem da conta pode resolver o token pelo CLI `gh` (processo novo a
    // cada chamada): o menu reaberto não pode repetir o IPC.
    expect(mocks.githubAccount).toHaveBeenCalledTimes(1);
  });

  it('não fecha quando a janela perde o foco', async () => {
    const user = userEvent.setup();
    render(<GitActionsMenu workspaceId="ws-1" isRepo />);

    await user.click(screen.getByRole('button', { name: 'Ações do git' }));
    await screen.findByRole('menu');

    // Foco indo para fora do app (janela nativa, CLI, outro aplicativo): a
    // camada do Radix não pode dispensar o menu por causa disso.
    window.dispatchEvent(new Event('blur'));
    const outside = document.createElement('button');
    outside.textContent = 'outside';
    document.body.appendChild(outside);
    fireEvent.focusIn(outside);
    window.dispatchEvent(new Event('focus'));

    expect(screen.getByRole('menu')).toBeTruthy();
    outside.remove();
  });
});
