import { describe, expect, it } from 'vitest';
import {
  applyAction,
  beginRun,
  canAdvance,
  createInitialState,
  installOptions,
  isAbsoluteWindowsPath,
  nextScreen,
  pathError,
  previousScreen,
} from './state';
import type { InstallerContext } from './types';

function context(overrides: Partial<InstallerContext> = {}): InstallerContext {
  return {
    mode: 'install',
    version: '0.1.0',
    arch: 'x86_64',
    isAdmin: false,
    defaultPathUser: 'C:\\Users\\ana\\AppData\\Local\\Programs\\Lumina',
    defaultPathMachine: 'C:\\Program Files\\Lumina',
    existing: null,
    conflicting: null,
    appRunning: false,
    webview2Installed: true,
    freeBytes: 1_000_000_000,
    requiredBytes: 25_000_000,
    logPath: 'C:\\Temp\\lumina-setup.log',
    dataPaths: ['C:\\Users\\ana\\AppData\\Roaming\\app.lumina.chat'],
    canElevate: true,
    pendingOptions: null,
    ...overrides,
  };
}

describe('installer state', () => {
  it('starts a fresh install at welcome with per-user defaults', () => {
    const state = createInitialState(context());
    expect(state.screen).toBe('welcome');
    expect(state.draft.scope).toBe('user');
    expect(state.draft.path).toContain('AppData');
    expect(state.steps.every((step) => step.status === 'pending')).toBe(true);
  });

  it('resumes at the confirmation screen after a UAC relaunch', () => {
    const state = createInitialState(
      context({
        isAdmin: true,
        pendingOptions: {
          scope: 'machine',
          path: 'C:\\Program Files\\Lumina',
          desktopShortcut: false,
          startMenuShortcut: true,
          launchAfterInstall: true,
        },
      }),
    );
    expect(state.screen).toBe('options');
    expect(state.draft.scope).toBe('machine');
    expect(state.draft.desktopShortcut).toBe(false);
  });

  it('shows an error when there is nothing to uninstall', () => {
    const state = createInitialState(context({ mode: 'uninstall' }));
    expect(state.screen).toBe('error');
    expect(state.error).toContain('não está instalado');
  });

  it('starts an uninstall at the confirmation screen', () => {
    const state = createInitialState(
      context({
        mode: 'uninstall',
        existing: {
          scope: 'machine',
          path: 'C:\\Program Files\\Lumina',
          version: '0.0.9',
        },
      }),
    );
    expect(state.screen).toBe('confirmUninstall');
    expect(state.draft.scope).toBe('machine');
    expect(state.draft.purgeData).toBe(false);
  });

  it('skips scope and location when updating an existing install', () => {
    const current = context({
      existing: {
        scope: 'user',
        path: 'D:\\Apps\\Lumina',
        version: '0.0.9',
      },
    });
    expect(nextScreen(current, 'welcome')).toBe('options');
    expect(previousScreen(current, 'options')).toBe('welcome');
  });

  it('walks the fresh-install flow', () => {
    const current = context();
    expect(nextScreen(current, 'welcome')).toBe('scope');
    expect(nextScreen(current, 'scope')).toBe('location');
    expect(nextScreen(current, 'location')).toBe('options');
    expect(nextScreen(current, 'options')).toBe('progress');
    expect(previousScreen(current, 'location')).toBe('scope');
  });

  it('switches the default path with the selected scope', () => {
    const state = createInitialState(context());
    const next = applyAction(state, {
      type: 'scope',
      scope: 'machine',
      defaultPath: 'C:\\Program Files\\Lumina',
    });
    expect(next.draft.scope).toBe('machine');
    expect(next.draft.path).toBe('C:\\Program Files\\Lumina');
  });

  it('validates local absolute Windows paths', () => {
    expect(isAbsoluteWindowsPath('C:\\Program Files\\Lumina')).toBe(true);
    expect(isAbsoluteWindowsPath('D:/Apps/Lumina')).toBe(true);
    expect(isAbsoluteWindowsPath('relative\\Lumina')).toBe(false);
    expect(isAbsoluteWindowsPath('\\\\server\\share\\Lumina')).toBe(false);
    expect(pathError('C:\\Program Files\\Lumina')).toBeNull();
    expect(pathError('C:\\')).not.toBeNull();
    expect(pathError('C:\\a\\..\\b')).not.toBeNull();
  });

  it('blocks advancing with an invalid destination', () => {
    const state = createInitialState(context());
    const location = { ...state, screen: 'location' as const, draft: { ...state.draft, path: 'x' } };
    expect(canAdvance(location, context())).toBe(false);
    expect(canAdvance({ ...location, draft: { ...location.draft, path: 'D:\\Apps\\Lumina' } }, context())).toBe(true);
  });

  it('blocks a conflicting scope installation', () => {
    const current = context({
      conflicting: { scope: 'machine', path: 'C:\\Program Files\\Lumina', version: '0.1.0' },
    });
    const state = { ...createInitialState(current), screen: 'scope' as const };
    expect(canAdvance(state, current)).toBe(false);
  });

  it('applies step, progress, log and done events', () => {
    let state = beginRun(createInitialState(context()));
    expect(state.screen).toBe('progress');
    state = applyAction(state, {
      type: 'event',
      event: { kind: 'step', step: { id: 'copy', label: 'Copiar', status: 'running' } },
    });
    state = applyAction(state, {
      type: 'event',
      event: { kind: 'step', step: { id: 'copy', label: 'Copiar', status: 'done' } },
    });
    state = applyAction(state, {
      type: 'event',
      event: { kind: 'progress', percent: 55, message: 'Copiando' },
    });
    state = applyAction(state, {
      type: 'event',
      event: { kind: 'log', line: 'copiado' },
    });
    expect(state.steps.find((step) => step.id === 'copy')?.status).toBe('done');
    expect(state.progress).toBe(55);
    expect(state.logLines).toEqual(['copiado']);

    state = applyAction(state, {
      type: 'event',
      event: {
        kind: 'done',
        installPath: 'C:\\Lumina',
        launched: true,
        logPath: 'C:\\Temp\\log.txt',
      },
    });
    expect(state.screen).toBe('finish');
    expect(state.outcome?.launched).toBe(true);
  });

  it('turns an error event into the error screen', () => {
    const state = applyAction(beginRun(createInitialState(context())), {
      type: 'event',
      event: { kind: 'error', message: 'falhou', logPath: 'C:\\Temp\\log.txt' },
    });
    expect(state.screen).toBe('error');
    expect(state.error).toBe('falhou');
  });

  it('builds the install options from the draft', () => {
    const state = createInitialState(context());
    expect(installOptions(state)).toEqual({
      scope: 'user',
      path: state.draft.path,
      desktopShortcut: true,
      startMenuShortcut: true,
      launchAfterInstall: true,
    });
  });
});
