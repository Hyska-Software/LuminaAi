/** Shared contract for the Windows setup mode (Rust ↔ React). */

export type InstallerMode = 'install' | 'uninstall';
export type InstallScope = 'user' | 'machine';

export interface ExistingInstall {
  scope: InstallScope;
  path: string;
  version: string;
}

export interface InstallerContext {
  mode: InstallerMode;
  version: string;
  arch: string;
  isAdmin: boolean;
  defaultPathUser: string;
  defaultPathMachine: string;
  existing: ExistingInstall | null;
  /** The other scope has an installation too; installing another one is blocked. */
  conflicting: ExistingInstall | null;
  appRunning: boolean;
  webview2Installed: boolean;
  /** Free bytes on the destination volume, when the backend can resolve it. */
  freeBytes: number | null;
  /** Estimated installed size in bytes. */
  requiredBytes: number;
  logPath: string;
  dataPaths: string[];
  canElevate: boolean;
  /** Present after a UAC relaunch: resume at the confirmation screen. */
  pendingOptions: InstallOptions | null;
}

export interface InstallOptions {
  scope: InstallScope;
  path: string;
  desktopShortcut: boolean;
  startMenuShortcut: boolean;
  launchAfterInstall: boolean;
}

export type InstallStepId =
  | 'prepare'
  | 'closeApp'
  | 'copy'
  | 'shortcuts'
  | 'register'
  | 'launch'
  | 'removeFiles'
  | 'removeRegistry'
  | 'removeData'
  | 'cleanup';

export type InstallStepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface InstallStep {
  id: InstallStepId;
  label: string;
  status: InstallStepStatus;
  detail?: string;
}

export type InstallerEvent =
  | { kind: 'step'; step: InstallStep }
  | { kind: 'progress'; percent: number; message: string }
  | { kind: 'log'; line: string }
  | {
      kind: 'done';
      installPath: string;
      launched: boolean;
      logPath: string;
    }
  | { kind: 'error'; message: string; logPath: string };

export interface InstallerApi {
  context(): Promise<InstallerContext>;
  start(options: InstallOptions, onEvent: (event: InstallerEvent) => void): Promise<void>;
  uninstall(purgeData: boolean, onEvent: (event: InstallerEvent) => void): Promise<void>;
  cancel(): Promise<void>;
  closeApp(): Promise<void>;
  relaunchElevated(options: InstallOptions): Promise<void>;
  finish(launch: boolean): Promise<void>;
  openFolder(): Promise<void>;
  openLog(): Promise<void>;
}
