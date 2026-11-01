import { Channel, invoke } from '@tauri-apps/api/core';
import type {
  InstallOptions,
  InstallerApi,
  InstallerContext,
  InstallerEvent,
} from './types';

/**
 * Tauri adapter for the installer commands. The setup window is deliberately
 * isolated from the app stores: it only talks to `installer_*` commands.
 */
export const tauriInstallerApi: InstallerApi = {
  context: () => invoke<InstallerContext>('installer_context'),

  start: async (options, onEvent) => {
    const channel = new Channel<InstallerEvent>();
    channel.onmessage = onEvent;
    await invoke('installer_start', { options, onEvent: channel });
  },

  uninstall: async (purgeData, onEvent) => {
    const channel = new Channel<InstallerEvent>();
    channel.onmessage = onEvent;
    await invoke('installer_uninstall', { purgeData, onEvent: channel });
  },

  cancel: () => invoke('installer_cancel'),

  closeApp: () => invoke('installer_close_app'),

  relaunchElevated: (options) => invoke('installer_relaunch_elevated', { options }),

  finish: (launch) => invoke('installer_finish', { launch }),

  openFolder: () => invoke('installer_open_folder'),

  openLog: () => invoke('installer_open_log'),
};
