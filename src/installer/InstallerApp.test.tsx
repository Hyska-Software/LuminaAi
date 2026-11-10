import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ close: vi.fn() }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => null),
}));

import { InstallerApp } from './InstallerApp';
import type { InstallerApi, InstallerContext } from './types';

function context(overrides: Partial<InstallerContext> = {}): InstallerContext {
  return {
    mode: 'install',
    version: '0.1.0',
    arch: 'x86_64',
    isAdmin: false,
    defaultPathUser: 'C:\\Users\\ana\\AppData\\Local\\Programs\\Zylara',
    defaultPathMachine: 'C:\\Program Files\\Zylara',
    existing: null,
    conflicting: null,
    appRunning: false,
    webview2Installed: true,
    freeBytes: 1_000_000_000,
    requiredBytes: 25_000_000,
    logPath: 'C:\\Temp\\zylara-setup.log',
    dataPaths: ['C:\\Users\\ana\\AppData\\Roaming\\app.zylara.chat'],
    canElevate: true,
    pendingOptions: null,
    ...overrides,
  };
}

function api(value: InstallerContext): InstallerApi {
  return {
    context: vi.fn(async () => value),
    start: vi.fn(async () => undefined),
    uninstall: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    closeApp: vi.fn(async () => undefined),
    relaunchElevated: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
    openFolder: vi.fn(async () => undefined),
    openLog: vi.fn(async () => undefined),
  };
}

describe('InstallerApp', () => {
  it('walks from welcome to the confirmation screen', async () => {
    const user = userEvent.setup();
    render(<InstallerApp api={api(context())} />);

    expect(await screen.findByText('Instale o Zylara')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /continuar/i }));

    expect(await screen.findByText('Para quem vamos instalar?')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: /todos os usuários/i }));
    await user.click(screen.getByRole('button', { name: /continuar/i }));

    expect(await screen.findByText('Onde instalar?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /continuar/i }));

    expect(await screen.findByText('Ajuste os detalhes')).toBeTruthy();
    expect(screen.getByText(/Program Files/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /instalar zylara/i })).toBeTruthy();
  });

  it('renders the uninstall confirmation with data preserved by default', async () => {
    const uninstall = context({
      mode: 'uninstall',
      existing: {
        scope: 'user',
        path: 'C:\\Users\\ana\\AppData\\Local\\Programs\\Zylara',
        version: '0.0.9',
      },
    });
    render(<InstallerApp api={api(uninstall)} />);

    expect(await screen.findByText('Remover o Zylara?')).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: /remover também meus dados/i }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.getByRole('button', { name: /remover zylara/i })).toBeTruthy();
  });
});
