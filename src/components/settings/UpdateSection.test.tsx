import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UpdateInfo, UpdateStatus } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  updateStatus: vi.fn(),
  checkForUpdate: vi.fn(),
  getUpdateNotes: vi.fn(),
  downloadUpdate: vi.fn(),
  cancelUpdateDownload: vi.fn(),
  installUpdate: vi.fn(),
  revealUpdate: vi.fn(),
  setUpdatePreferences: vi.fn(),
  skipUpdateVersion: vi.fn(),
  markUpdateNotified: vi.fn(),
  acknowledgeUpdateResult: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

// Imported after the mocks above.
import { initialUpdateState, useAppStore, useUpdateStore } from '@/lib/store';
import { UpdateSection } from './UpdateSection';

function releaseInfo(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    currentVersion: '0.1.0',
    latestVersion: '0.2.0',
    available: true,
    releaseName: 'Zylara v0.2.0',
    releasedAt: '2026-11-01T12:00:00Z',
    htmlUrl: 'https://github.com/Hyska-Software/ZylaraAi/releases/tag/v0.2.0',
    asset: {
      name: 'Zylara-Setup-0.2.0-windows-x64.exe',
      size: 100,
      sha256: 'a'.repeat(64),
      downloadUrl:
        'https://github.com/Hyska-Software/ZylaraAi/releases/download/v0.2.0/Zylara-Setup-0.2.0-windows-x64.exe',
      platformLabel: 'Windows x64',
      kind: 'setup',
    },
    checkedAt: 1,
    stale: false,
    ...overrides,
  };
}

function status(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    currentVersion: '0.1.0',
    preferences: {
      autoCheck: true,
      lastCheckAt: Date.now() - 120_000,
      skippedVersion: null,
      notifiedVersion: null,
    },
    info: null,
    download: null,
    managed: { mode: 'manual', supported: false, reason: null },
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAppStore.setState({
    appInfo: {
      name: 'Zylara',
      version: '0.1.0',
      tauriVersion: '2.12.4',
      platform: 'windows',
      startedAt: 1,
      dataDir: 'C:\\data',
    },
  });
  useUpdateStore.setState({
    ...initialUpdateState(),
    hydrated: true,
    info: releaseInfo(),
    phase: 'available',
  });
});

describe('UpdateSection', () => {
  it('shows the current version and the available release', () => {
    render(<UpdateSection />);
    expect(screen.getByText('v0.1.0')).toBeTruthy();
    expect(screen.getByText('Atualização disponível')).toBeTruthy();
    expect(screen.getByText('v0.2.0')).toBeTruthy();
  });

  it('marks a managed installation', () => {
    useUpdateStore.setState({ managed: { mode: 'managed', supported: true } });
    render(<UpdateSection />);
    expect(screen.getByText('Instalação gerenciada')).toBeTruthy();
  });

  it('shows the managed closing status while installing', () => {
    useUpdateStore.setState({
      info: releaseInfo({
        asset: {
          name: 'Zylara-0.2.0-linux-x64.AppImage',
          size: 100,
          sha256: 'a'.repeat(64),
          downloadUrl:
            'https://github.com/Hyska-Software/ZylaraAi/releases/download/v0.2.0/Zylara-0.2.0-linux-x64.AppImage',
          platformLabel: 'Linux x64 · AppImage',
          kind: 'appimage',
        },
      }),
      managed: { mode: 'managed', supported: true },
      phase: 'installing',
    });
    render(<UpdateSection />);
    expect(screen.getAllByText('Fechando para atualizar…').length).toBeGreaterThan(0);
  });

  it('checks manually and keeps the panel in sync', async () => {
    mocks.checkForUpdate.mockResolvedValue(status({ info: releaseInfo() }));
    render(<UpdateSection />);
    await userEvent.click(screen.getByRole('button', { name: /Verificar agora/ }));
    expect(mocks.checkForUpdate).toHaveBeenCalledWith(true);
  });

  it('persists the automatic-check preference', async () => {
    mocks.setUpdatePreferences.mockResolvedValue(
      status({ preferences: { ...status().preferences, autoCheck: false } }),
    );
    render(<UpdateSection />);
    await userEvent.click(
      screen.getByRole('switch', { name: 'Verificar atualizações automaticamente' }),
    );
    expect(mocks.setUpdatePreferences).toHaveBeenCalledWith(false);
  });

  it('offers to show an ignored version again', async () => {
    useUpdateStore.setState({
      info: null,
      phase: 'idle',
      preferences: { ...status().preferences, skippedVersion: '0.2.0' },
    });
    mocks.skipUpdateVersion.mockResolvedValue(status());
    mocks.checkForUpdate.mockResolvedValue(status());
    render(<UpdateSection />);
    expect(screen.getByText('A versão v0.2.0 está ignorada.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar novamente' }));
    expect(mocks.skipUpdateVersion).toHaveBeenCalledWith(null);
  });
});
