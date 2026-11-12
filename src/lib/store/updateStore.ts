/**
 * In-app update state: automatic/manual GitHub checks, download progress and
 * install steps. The backend owns the network and file verification; this store
 * only orchestrates the UI phases and keeps the title-bar chip and the Settings
 * section in sync.
 */
import { create } from 'zustand';
import { toast } from 'sonner';
import { api } from '../api';
import { t } from '../i18n';
import type {
  DownloadedUpdate,
  ManagedUpdateStatus,
  UpdateAssetKind,
  UpdateInfo,
  UpdateNotes,
  UpdatePreferences,
  UpdateStatus,
} from '../types';

/** One hour, in milliseconds. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * A timer tick can fire a few seconds before `lastCheckAt` completes the full
 * interval because the timestamp is recorded after the request. Allow one
 * minute so the hourly tick is not skipped until the next hour.
 */
const DUE_TOLERANCE_MS = 60_000;

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'installing'
  | 'error'
  | 'up-to-date';

export type UpdateErrorScope = 'check' | 'download' | 'install';

export interface UpdateProgress {
  received: number;
  total: number;
  percent: number;
  bytesPerSec: number;
}

export interface UpdateUiState {
  hydrated: boolean;
  hydrating: boolean;
  phase: UpdatePhase;
  info: UpdateInfo | null;
  downloaded: DownloadedUpdate | null;
  managed: ManagedUpdateStatus;
  preferences: UpdatePreferences;
  progress: UpdateProgress | null;
  error: string | null;
  errorScope: UpdateErrorScope | null;
  /** Popover open state; kept in the store so a toast can open the panel. */
  open: boolean;
  notes: Record<string, UpdateNotes>;
  notesLoading: string | null;
  /** True while a user-initiated check is running (keeps the chip visible). */
  manualCheck: boolean;
  /** First automatic check of this process always runs (startup check). */
  sessionChecked: boolean;
}

export interface UpdateStore extends UpdateUiState {
  init: () => Promise<void>;
  check: (options?: { silent?: boolean; force?: boolean }) => Promise<void>;
  /** Automatic check when the one-hour window has elapsed. */
  checkIfDue: () => Promise<void>;
  download: () => Promise<void>;
  cancel: () => Promise<void>;
  install: () => Promise<void>;
  reveal: () => Promise<void>;
  dismiss: () => void;
  setOpen: (open: boolean) => void;
  openPanel: () => void;
  loadNotes: () => Promise<void>;
  skip: () => Promise<void>;
  unskip: () => Promise<void>;
  setAutoCheck: (value: boolean) => Promise<void>;
  clearError: () => void;
}

export function initialUpdateState(): UpdateUiState {
  return {
    hydrated: false,
    hydrating: false,
    phase: 'idle',
    info: null,
    downloaded: null,
    managed: { mode: 'manual', supported: false, reason: 'not-checked' },
    preferences: {
      autoCheck: true,
      lastCheckAt: null,
      skippedVersion: null,
      notifiedVersion: null,
    },
    progress: null,
    error: null,
    errorScope: null,
    open: false,
    notes: {},
    notesLoading: null,
    manualCheck: false,
    sessionChecked: false,
  };
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

function fromStatus(status: UpdateStatus): Pick<
  UpdateUiState,
  'info' | 'downloaded' | 'preferences' | 'phase' | 'managed'
> {
  const info = status.info ?? null;
  const downloaded = status.download ?? null;
  const phase: UpdatePhase = downloaded ? 'ready' : info ? 'available' : 'idle';
  return { info, downloaded, managed: status.managed, preferences: status.preferences, phase };
}

/** True only when the running installation can replace itself in place. */
export function canSelfInstall(
  managed: ManagedUpdateStatus | null | undefined,
  kind: UpdateAssetKind | null | undefined,
): boolean {
  return Boolean(
    managed?.mode === 'managed' &&
      managed.supported &&
      (kind === 'appimage' || kind === 'dmg'),
  );
}

function isBusy(phase: UpdatePhase): boolean {
  return (
    phase === 'checking' ||
    phase === 'downloading' ||
    phase === 'verifying' ||
    phase === 'installing'
  );
}

/**
 * Shared hydration promise so a check that starts right after mount never
 * races the initial `update_status` response (which could overwrite a fresher
 * check result with the cached one).
 */
let hydration: Promise<void> | null = null;

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  ...initialUpdateState(),

  init: async () => {
    if (get().hydrated) return;
    if (!hydration) {
      hydration = (async () => {
        set({ hydrating: true });
        try {
          const status = await api.updateStatus();
          set({ ...fromStatus(status), hydrated: true, hydrating: false });
          if (status.lastInstall) {
            const result = status.lastInstall;
            if (result.status === 'installed') {
              toast.success(t('common:shell.update.toasts.managedInstalledTitle'), {
                description: t('common:shell.update.toasts.managedInstalledDescription', {
                  version: result.version,
                }),
              });
            } else {
              toast.error(t('common:shell.update.toasts.managedFailedTitle'), {
                description: result.message
                  ? t('common:shell.update.toasts.managedFailedDescription', {
                      message: result.message,
                    })
                  : t('common:shell.update.toasts.managedFailedNoMessage'),
              });
            }
            void api.acknowledgeUpdateResult().catch(() => undefined);
          }
        } catch (error) {
          // A failed hydration must not block the app; a later manual check can
          // still recover. Keep the message for the Settings section.
          set({
            hydrated: true,
            hydrating: false,
            error: errorMessage(error),
            errorScope: 'check',
          });
        } finally {
          hydration = null;
        }
      })();
    }
    await hydration;
  },

  check: async (options = {}) => {
    if (!get().hydrated) await get().init();
    const phase = get().phase;
    if (isBusy(phase)) return;
    const silent = options.silent ?? false;
    const force = options.force ?? !silent;
    set({
      phase: 'checking',
      error: null,
      errorScope: null,
      manualCheck: !silent,
      sessionChecked: true,
    });
    try {
      const status = await api.checkForUpdate(force);
      const next = fromStatus(status);
      const nextPhase: UpdatePhase =
        next.downloaded ? 'ready' : next.info ? 'available' : silent ? 'idle' : 'up-to-date';
      set({ ...next, phase: nextPhase, manualCheck: false });
      const available = next.info;
      if (available) {
        if (silent && status.preferences.notifiedVersion !== available.latestVersion) {
          toast.info(t('common:shell.update.toasts.availableTitle', { version: available.latestVersion }), {
            description: t('common:shell.update.toasts.availableDescription'),
            action: {
              label: t('common:shell.update.toasts.availableAction'),
              onClick: () => useUpdateStore.getState().openPanel(),
            },
          });
          set({
            preferences: {
              ...status.preferences,
              notifiedVersion: available.latestVersion,
            },
          });
          void api.markUpdateNotified(available.latestVersion).catch(() => undefined);
        }
      } else if (!silent) {
        toast.success(t('common:shell.update.toasts.latestTitle'), {
          description: `Zylara v${status.currentVersion}`,
        });
      }
    } catch (error) {
      const message = errorMessage(error);
      set((state) => ({
        // A failed refresh keeps the last known release visible (marked stale)
        // instead of making the user think they are up to date.
        phase: state.downloaded ? 'ready' : state.info ? 'available' : 'idle',
        info: state.info ? { ...state.info, stale: true } : null,
        error: message,
        errorScope: 'check',
        manualCheck: false,
      }));
      if (!silent) {
        toast.error(t('common:shell.update.toasts.checkFailed'), { description: message });
      }
    }
  },

  checkIfDue: async () => {
    if (!get().hydrated) await get().init();
    const { preferences, phase, sessionChecked } = get();
    if (!preferences.autoCheck || isBusy(phase)) return;
    if (sessionChecked) {
      const last = preferences.lastCheckAt ?? 0;
      if (last > 0 && Date.now() - last < UPDATE_CHECK_INTERVAL_MS - DUE_TOLERANCE_MS) return;
    }
    set({ sessionChecked: true });
    await get().check({ silent: true, force: false });
  },

  download: async () => {
    const { info, phase } = get();
    if (!info?.available || !info.asset) return;
    if (phase === 'downloading' || phase === 'verifying' || phase === 'installing') return;
    const total = info.asset.size;
    set({
      phase: 'downloading',
      error: null,
      errorScope: null,
      progress: { received: 0, total, percent: 0, bytesPerSec: 0 },
    });
    try {
      const result = await api.downloadUpdate(info.latestVersion, (event) => {
        switch (event.kind) {
          case 'started':
            set({
              phase: 'downloading',
              progress: { received: 0, total: event.total, percent: 0, bytesPerSec: 0 },
            });
            break;
          case 'progress':
            set({
              phase: 'downloading',
              progress: {
                received: event.received,
                total: event.total,
                percent: event.percent,
                bytesPerSec: event.bytesPerSec,
              },
            });
            break;
          case 'verifying':
            set({ phase: 'verifying' });
            break;
          case 'cancelled':
            set({ phase: 'available', progress: null });
            break;
          case 'done':
            break;
        }
      });
      if (result.cancelled || !result.download) {
        set({ phase: 'available', progress: null });
        toast.info(t('common:shell.update.toasts.cancelled'));
        return;
      }
      set({
        phase: 'ready',
        downloaded: result.download,
        progress: null,
        error: null,
        errorScope: null,
      });
      toast.success(t('common:shell.update.toasts.downloadedTitle'), {
        description: t('common:shell.update.toasts.downloadedDescription'),
      });
    } catch (error) {
      const message = errorMessage(error);
      set({ phase: 'error', error: message, errorScope: 'download', progress: null });
      toast.error(t('common:shell.update.toasts.downloadFailed'), { description: message });
    }
  },

  cancel: async () => {
    try {
      await api.cancelUpdateDownload();
    } catch {
      /* the in-flight command will surface the real error */
    }
  },

  install: async () => {
    const { info, downloaded, managed } = get();
    if (!info || !downloaded) return;
    const selfInstall = canSelfInstall(managed, info.asset?.kind);
    set({ phase: 'installing', error: null, errorScope: null });
    try {
      await api.installUpdate(info.latestVersion);
      if (selfInstall) {
        // The backend spawned the local helper and is closing the app. Keep the
        // installing phase; the next launch reports the helper result.
        return;
      }
      const manual = info.asset && info.asset.kind !== 'setup';
      toast.success(t('common:shell.update.toasts.installerOpenTitle'), {
        description: manual
          ? t('common:shell.update.toasts.installerOpenManual')
          : t('common:shell.update.toasts.installerOpenSetup'),
      });
      set({ phase: 'ready' });
    } catch (error) {
      const message = errorMessage(error);
      set({ phase: 'ready', error: message, errorScope: 'install' });
      toast.error(t('common:shell.update.toasts.installerOpenFailed'), { description: message });
    }
  },

  reveal: async () => {
    const version = get().info?.latestVersion;
    if (!version) return;
    try {
      await api.revealUpdate(version);
    } catch (error) {
      toast.error(t('common:shell.update.toasts.revealFailed'), {
        description: errorMessage(error),
      });
    }
  },

  dismiss: () => set({ open: false }),

  setOpen: (open) => {
    set({ open });
    if (open) void get().loadNotes();
  },

  openPanel: () => {
    set({ open: true });
    void get().loadNotes();
  },

  loadNotes: async () => {
    const { info, notes, notesLoading } = get();
    if (!info || notes[info.latestVersion] || notesLoading) return;
    const version = info.latestVersion;
    set({ notesLoading: version });
    try {
      const result = await api.getUpdateNotes(version);
      set((state) => ({
        notes: { ...state.notes, [version]: result },
        notesLoading: state.notesLoading === version ? null : state.notesLoading,
      }));
    } catch {
      // Notes are best-effort; the panel always offers the GitHub link.
      set((state) => ({
        notesLoading: state.notesLoading === version ? null : state.notesLoading,
      }));
    }
  },

  skip: async () => {
    const version = get().info?.latestVersion;
    if (!version) return;
    try {
      const status = await api.skipUpdateVersion(version);
      set({
        ...fromStatus(status),
        info: null,
        downloaded: null,
        phase: 'idle',
        open: false,
        progress: null,
        error: null,
        errorScope: null,
      });
      toast.info(t('common:shell.update.toasts.skippedTitle'), {
        description: t('common:shell.update.toasts.skippedDescription', { version }),
      });
    } catch (error) {
      toast.error(t('common:shell.update.toasts.skipFailed'), {
        description: errorMessage(error),
      });
    }
  },

  unskip: async () => {
    try {
      const status = await api.skipUpdateVersion(null);
      set({ ...fromStatus(status) });
      await get().check({ force: true });
    } catch (error) {
      toast.error(t('common:shell.update.toasts.unskipFailed'), {
        description: errorMessage(error),
      });
    }
  },

  setAutoCheck: async (value) => {
    const previous = get().preferences;
    set({ preferences: { ...previous, autoCheck: value } });
    try {
      const status = await api.setUpdatePreferences(value);
      set({ preferences: status.preferences });
    } catch (error) {
      set({ preferences: previous });
      toast.error(t('common:shell.update.toasts.preferenceFailed'), {
        description: errorMessage(error),
      });
    }
  },

  clearError: () => {
    set((state) => ({
      error: null,
      errorScope: null,
      phase:
        state.phase === 'error'
          ? state.downloaded
            ? 'ready'
            : 'available'
          : state.phase,
    }));
  },
}));
