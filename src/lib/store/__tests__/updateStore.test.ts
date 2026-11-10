import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadedUpdate, UpdateInfo, UpdateStatus } from '../../types';

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
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

// Imported after the mocks above.
import { toast } from 'sonner';
import { initialUpdateState, UPDATE_CHECK_INTERVAL_MS, useUpdateStore } from '../updateStore';

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
      lastCheckAt: null,
      skippedVersion: null,
      notifiedVersion: null,
    },
    info: null,
    download: null,
    ...overrides,
  };
}

const downloaded: DownloadedUpdate = {
  version: '0.2.0',
  path: 'C:\\Users\\ana\\AppData\\Roaming\\app.zylara.chat\\updates\\0.2.0\\setup.exe',
  size: 100,
  sha256: 'a'.repeat(64),
};

function reset(): void {
  useUpdateStore.setState({ ...initialUpdateState() });
}

beforeEach(() => {
  vi.clearAllMocks();
  reset();
  mocks.updateStatus.mockResolvedValue(status());
  mocks.checkForUpdate.mockResolvedValue(status());
});

describe('updateStore', () => {
  it('hydrates the cached release as an available update', async () => {
    mocks.updateStatus.mockResolvedValue(
      status({ info: releaseInfo(), preferences: { ...status().preferences, lastCheckAt: 10 } }),
    );
    await useUpdateStore.getState().init();
    const state = useUpdateStore.getState();
    expect(state.phase).toBe('available');
    expect(state.info?.latestVersion).toBe('0.2.0');
    expect(state.preferences.lastCheckAt).toBe(10);
  });

  it('keeps a downloaded file in the ready phase after hydration', async () => {
    mocks.updateStatus.mockResolvedValue(status({ info: releaseInfo(), download: downloaded }));
    await useUpdateStore.getState().init();
    expect(useUpdateStore.getState().phase).toBe('ready');
    expect(useUpdateStore.getState().downloaded?.version).toBe('0.2.0');
  });

  it('does not auto check when the preference is off', async () => {
    useUpdateStore.setState({
      hydrated: true,
      preferences: { autoCheck: false, lastCheckAt: null, skippedVersion: null, notifiedVersion: null },
    });
    await useUpdateStore.getState().checkIfDue();
    expect(mocks.checkForUpdate).not.toHaveBeenCalled();
  });

  it('checks automatically when due and notifies once per version', async () => {
    useUpdateStore.setState({
      hydrated: true,
      preferences: { autoCheck: true, lastCheckAt: null, skippedVersion: null, notifiedVersion: null },
    });
    mocks.checkForUpdate.mockResolvedValue(
      status({ info: releaseInfo(), preferences: { ...status().preferences, lastCheckAt: 99 } }),
    );
    await useUpdateStore.getState().checkIfDue();

    expect(mocks.checkForUpdate).toHaveBeenCalledWith(false);
    expect(mocks.markUpdateNotified).toHaveBeenCalledWith('0.2.0');
    expect(toast.info).toHaveBeenCalledWith(
      'Zylara v0.2.0 disponível',
      expect.objectContaining({ action: expect.anything() }),
    );
    expect(useUpdateStore.getState().preferences.notifiedVersion).toBe('0.2.0');
  });

  it('does not repeat the toast for an already notified version', async () => {
    useUpdateStore.setState({
      hydrated: true,
      preferences: {
        autoCheck: true,
        lastCheckAt: null,
        skippedVersion: null,
        notifiedVersion: '0.2.0',
      },
    });
    mocks.checkForUpdate.mockResolvedValue(
      status({
        info: releaseInfo(),
        preferences: { ...status().preferences, notifiedVersion: '0.2.0', lastCheckAt: 99 },
      }),
    );
    await useUpdateStore.getState().checkIfDue();
    expect(toast.info).not.toHaveBeenCalled();
    expect(mocks.markUpdateNotified).not.toHaveBeenCalled();
  });

  it('defaults automatic checks on for a fresh install', () => {
    expect(initialUpdateState().preferences.autoCheck).toBe(true);
  });

  it('runs the first automatic check on launch even inside the one-hour window', async () => {
    useUpdateStore.setState({
      hydrated: true,
      sessionChecked: false,
      preferences: {
        autoCheck: true,
        lastCheckAt: Date.now() - 60_000,
        skippedVersion: null,
        notifiedVersion: null,
      },
    });

    await useUpdateStore.getState().checkIfDue();

    expect(mocks.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.checkForUpdate).toHaveBeenCalledWith(false);
    expect(useUpdateStore.getState().sessionChecked).toBe(true);
  });

  it('checks again after the one-hour window', async () => {
    useUpdateStore.setState({
      hydrated: true,
      sessionChecked: true,
      preferences: {
        autoCheck: true,
        lastCheckAt: Date.now() - UPDATE_CHECK_INTERVAL_MS - 1,
        skippedVersion: null,
        notifiedVersion: null,
      },
    });

    await useUpdateStore.getState().checkIfDue();

    expect(mocks.checkForUpdate).toHaveBeenCalledWith(false);
  });

  it('checks on the hourly tick even when the last check is a few seconds short of the window', async () => {
    useUpdateStore.setState({
      hydrated: true,
      sessionChecked: true,
      preferences: {
        autoCheck: true,
        lastCheckAt: Date.now() - (UPDATE_CHECK_INTERVAL_MS - 30_000),
        skippedVersion: null,
        notifiedVersion: null,
      },
    });

    await useUpdateStore.getState().checkIfDue();

    expect(mocks.checkForUpdate).toHaveBeenCalledWith(false);
  });

  it('skips the automatic check inside the one-hour window', async () => {
    useUpdateStore.setState({
      hydrated: true,
      sessionChecked: true,
      preferences: {
        autoCheck: true,
        lastCheckAt: Date.now() - 60_000,
        skippedVersion: null,
        notifiedVersion: null,
      },
    });
    await useUpdateStore.getState().checkIfDue();
    expect(mocks.checkForUpdate).not.toHaveBeenCalled();
  });

  it('marks a cached release as stale when a check fails', async () => {
    useUpdateStore.setState({
      hydrated: true,
      info: releaseInfo(),
      phase: 'available',
      preferences: { ...status().preferences, lastCheckAt: Date.now() },
    });
    mocks.checkForUpdate.mockRejectedValue('sem rede');
    await useUpdateStore.getState().check({ force: true });

    const state = useUpdateStore.getState();
    expect(state.phase).toBe('available');
    expect(state.info?.stale).toBe(true);
    expect(state.error).toBe('sem rede');
    expect(toast.error).toHaveBeenCalled();
  });

  it('shows a success toast when a manual check finds no update', async () => {
    await useUpdateStore.getState().check({ force: true });
    expect(toast.success).toHaveBeenCalledWith(
      'Você está na versão mais recente',
      expect.objectContaining({ description: 'Zylara v0.1.0' }),
    );
    expect(useUpdateStore.getState().phase).toBe('up-to-date');
  });

  it('streams download progress and finishes in the ready phase', async () => {
    useUpdateStore.setState({ info: releaseInfo(), phase: 'available' });
    mocks.downloadUpdate.mockImplementation(async (_version, onEvent) => {
      onEvent({ kind: 'started', name: 'setup.exe', total: 100 });
      onEvent({ kind: 'progress', received: 40, total: 100, percent: 40, bytesPerSec: 20 });
      onEvent({ kind: 'verifying' });
      onEvent({ kind: 'done', download: downloaded });
      return { cancelled: false, download: downloaded };
    });

    await useUpdateStore.getState().download();

    const state = useUpdateStore.getState();
    expect(mocks.downloadUpdate).toHaveBeenCalledWith('0.2.0', expect.any(Function));
    expect(state.phase).toBe('ready');
    expect(state.downloaded).toEqual(downloaded);
    expect(state.progress).toBeNull();
    expect(toast.success).toHaveBeenCalledWith(
      'Atualização baixada',
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it('returns to available when the download is cancelled', async () => {
    useUpdateStore.setState({ info: releaseInfo(), phase: 'available' });
    mocks.downloadUpdate.mockResolvedValue({ cancelled: true, download: null });
    await useUpdateStore.getState().download();
    expect(useUpdateStore.getState().phase).toBe('available');
    expect(toast.info).toHaveBeenCalledWith('Download cancelado');
  });

  it('surfaces download failures with a retryable error', async () => {
    useUpdateStore.setState({ info: releaseInfo(), phase: 'available' });
    mocks.downloadUpdate.mockRejectedValue('SHA-256 inválido');
    await useUpdateStore.getState().download();

    const state = useUpdateStore.getState();
    expect(state.phase).toBe('error');
    expect(state.errorScope).toBe('download');
    expect(state.error).toBe('SHA-256 inválido');
    expect(toast.error).toHaveBeenCalled();
  });

  it('installs only after a verified download is ready', async () => {
    useUpdateStore.setState({ info: releaseInfo(), downloaded, phase: 'ready' });
    mocks.installUpdate.mockResolvedValue(undefined);
    await useUpdateStore.getState().install();
    expect(mocks.installUpdate).toHaveBeenCalledWith('0.2.0');
    expect(useUpdateStore.getState().phase).toBe('ready');
    expect(toast.success).toHaveBeenCalledWith('Instalador aberto', expect.anything());
  });

  it('does not install without a downloaded file', async () => {
    useUpdateStore.setState({ info: releaseInfo(), phase: 'available' });
    await useUpdateStore.getState().install();
    expect(mocks.installUpdate).not.toHaveBeenCalled();
  });

  it('persists the ignored version and hides the update', async () => {
    useUpdateStore.setState({ info: releaseInfo(), phase: 'available', open: true });
    mocks.skipUpdateVersion.mockResolvedValue(
      status({
        preferences: { ...status().preferences, skippedVersion: '0.2.0' },
      }),
    );
    await useUpdateStore.getState().skip();

    expect(mocks.skipUpdateVersion).toHaveBeenCalledWith('0.2.0');
    const state = useUpdateStore.getState();
    expect(state.info).toBeNull();
    expect(state.phase).toBe('idle');
    expect(state.open).toBe(false);
    expect(state.preferences.skippedVersion).toBe('0.2.0');
  });

  it('reverts an optimistic auto-check preference when saving fails', async () => {
    mocks.setUpdatePreferences.mockRejectedValue('falha');
    await useUpdateStore.getState().setAutoCheck(false);
    expect(useUpdateStore.getState().preferences.autoCheck).toBe(true);
    expect(toast.error).toHaveBeenCalled();
  });

  it('loads release notes on demand and caches them', async () => {
    useUpdateStore.setState({ info: releaseInfo(), hydrated: true });
    mocks.getUpdateNotes.mockResolvedValue({
      notes: '## Novidades\n- Correções',
      releasedAt: '2026-11-01T12:00:00Z',
      htmlUrl: 'https://github.com/Hyska-Software/ZylaraAi/releases/tag/v0.2.0',
    });

    await useUpdateStore.getState().loadNotes();
    expect(useUpdateStore.getState().notes['0.2.0']?.notes).toContain('Novidades');
    await useUpdateStore.getState().loadNotes();
    expect(mocks.getUpdateNotes).toHaveBeenCalledTimes(1);
  });

  it('opens the panel and closes it without hiding the chip', () => {
    useUpdateStore.setState({ info: releaseInfo(), phase: 'available' });
    useUpdateStore.getState().openPanel();
    expect(useUpdateStore.getState().open).toBe(true);
    useUpdateStore.getState().dismiss();
    expect(useUpdateStore.getState().open).toBe(false);
    expect(useUpdateStore.getState().info).not.toBeNull();
  });
});
