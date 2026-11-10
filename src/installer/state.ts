import type {
  InstallOptions,
  InstallScope,
  InstallStep,
  InstallerContext,
  InstallerEvent,
  InstallerMode,
} from './types';

export type InstallerScreen =
  | 'welcome'
  | 'scope'
  | 'location'
  | 'options'
  | 'progress'
  | 'finish'
  | 'confirmUninstall'
  | 'error';

export interface InstallerDraft {
  scope: InstallScope;
  path: string;
  desktopShortcut: boolean;
  startMenuShortcut: boolean;
  launchAfterInstall: boolean;
  purgeData: boolean;
}

export interface InstallerOutcome {
  installPath: string;
  launched: boolean;
  logPath: string;
}

export interface InstallerUiState {
  mode: InstallerMode;
  screen: InstallerScreen;
  draft: InstallerDraft;
  steps: InstallStep[];
  progress: number;
  progressMessage: string;
  logLines: string[];
  error: string | null;
  outcome: InstallerOutcome | null;
  starting: boolean;
  cancelling: boolean;
}

export const INSTALL_STEPS: Array<Pick<InstallStep, 'id' | 'label'>> = [
  { id: 'prepare', label: 'Validar destino e permissões' },
  { id: 'closeApp', label: 'Fechar o Zylara em execução' },
  { id: 'copy', label: 'Copiar arquivos do aplicativo' },
  { id: 'shortcuts', label: 'Criar atalhos' },
  { id: 'register', label: 'Registrar desinstalação' },
  { id: 'launch', label: 'Iniciar o Zylara' },
];

export const UNINSTALL_STEPS: Array<Pick<InstallStep, 'id' | 'label'>> = [
  { id: 'prepare', label: 'Validar a instalação' },
  { id: 'closeApp', label: 'Fechar o Zylara em execução' },
  { id: 'removeFiles', label: 'Remover arquivos do aplicativo' },
  { id: 'removeRegistry', label: 'Remover registro e atalhos' },
  { id: 'removeData', label: 'Remover dados do usuário' },
  { id: 'cleanup', label: 'Finalizar' },
];

function stepsFor(mode: InstallerMode): InstallStep[] {
  const source = mode === 'uninstall' ? UNINSTALL_STEPS : INSTALL_STEPS;
  return source.map((step) => ({ ...step, status: 'pending' as const }));
}

/** Picks a sensible initial path, preserving the backend's default for the scope. */
export function defaultPathFor(context: InstallerContext, scope: InstallScope): string {
  if (scope === 'machine') return context.defaultPathMachine;
  return context.defaultPathUser;
}

export function createInitialState(context: InstallerContext): InstallerUiState {
  const pending = context.pendingOptions;
  const scope = pending?.scope ?? context.existing?.scope ?? 'user';
  const path = pending?.path ?? context.existing?.path ?? defaultPathFor(context, scope);
  const mode = context.mode;

  const missingInstall = mode === 'uninstall' && !context.existing;
  return {
    mode,
    screen: missingInstall
      ? 'error'
      : mode === 'uninstall'
        ? 'confirmUninstall'
        : pending
          ? 'options'
          : 'welcome',
    draft: {
      scope,
      path,
      desktopShortcut: pending?.desktopShortcut ?? true,
      startMenuShortcut: pending?.startMenuShortcut ?? true,
      launchAfterInstall: pending?.launchAfterInstall ?? true,
      purgeData: false,
    },
    steps: stepsFor(mode),
    progress: 0,
    progressMessage: '',
    logLines: [],
    error: missingInstall ? 'O Zylara não está instalado para este usuário.' : null,
    outcome: null,
    starting: false,
    cancelling: false,
  };
}

export type InstallerAction =
  | { type: 'screen'; screen: InstallerScreen }
  | { type: 'scope'; scope: InstallScope; defaultPath: string }
  | { type: 'path'; path: string }
  | { type: 'option'; key: 'desktopShortcut' | 'startMenuShortcut' | 'launchAfterInstall'; value: boolean }
  | { type: 'purge'; value: boolean }
  | { type: 'starting'; starting: boolean }
  | { type: 'cancelling'; cancelling: boolean }
  | { type: 'resetError' }
  | { type: 'event'; event: InstallerEvent };

export function applyAction(state: InstallerUiState, action: InstallerAction): InstallerUiState {
  switch (action.type) {
    case 'screen':
      return { ...state, screen: action.screen, error: null };
    case 'scope':
      return {
        ...state,
        draft: {
          ...state.draft,
          scope: action.scope,
          path: action.defaultPath,
        },
      };
    case 'path':
      return { ...state, draft: { ...state.draft, path: action.path } };
    case 'option':
      return { ...state, draft: { ...state.draft, [action.key]: action.value } };
    case 'purge':
      return { ...state, draft: { ...state.draft, purgeData: action.value } };
    case 'starting':
      return { ...state, starting: action.starting };
    case 'cancelling':
      return { ...state, cancelling: action.cancelling };
    case 'resetError':
      return { ...state, error: null };
    case 'event':
      return applyEvent(state, action.event);
    default:
      return state;
  }
}

export function applyEvent(state: InstallerUiState, event: InstallerEvent): InstallerUiState {
  switch (event.kind) {
    case 'step': {
      const exists = state.steps.some((step) => step.id === event.step.id);
      const steps = exists
        ? state.steps.map((step) => (step.id === event.step.id ? { ...step, ...event.step } : step))
        : [...state.steps, event.step];
      return { ...state, steps };
    }
    case 'progress':
      return {
        ...state,
        progress: Math.max(state.progress, Math.min(100, Math.max(0, event.percent))),
        progressMessage: event.message,
      };
    case 'log':
      return {
        ...state,
        logLines: [...state.logLines, event.line].slice(-400),
      };
    case 'done':
      return {
        ...state,
        screen: 'finish',
        progress: 100,
        starting: false,
        cancelling: false,
        outcome: {
          installPath: event.installPath,
          launched: event.launched,
          logPath: event.logPath,
        },
      };
    case 'error':
      return {
        ...state,
        screen: 'error',
        starting: false,
        cancelling: false,
        error: event.message,
      };
    default:
      return state;
  }
}

export function isAbsoluteWindowsPath(path: string): boolean {
  const value = path.trim();
  if (!value) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  // UNC paths are intentionally rejected: the app keeps its SQLite database
  // and checkpoints local, and network shares break atomic replace semantics.
  return false;
}

export function pathError(path: string): string | null {
  const value = path.trim();
  if (!value) return 'Escolha uma pasta de instalação.';
  if (!isAbsoluteWindowsPath(value)) {
    return 'Use um caminho absoluto em uma unidade local, como C:\\Program Files\\Zylara.';
  }
  if (value.split(/[\\/]/).some((part) => part === '..')) {
    return 'O caminho não pode conter "..".';
  }
  if (/^[A-Za-z]:[\\/]?$/.test(value)) {
    return 'Escolha uma pasta dentro da unidade, não a raiz.';
  }
  return null;
}

export function screenOrder(context: InstallerContext): InstallerScreen[] {
  if (context.mode === 'uninstall') return ['confirmUninstall', 'progress', 'finish'];
  if (context.existing) return ['welcome', 'options', 'progress', 'finish'];
  return ['welcome', 'scope', 'location', 'options', 'progress', 'finish'];
}

export function nextScreen(
  context: InstallerContext,
  screen: InstallerScreen,
): InstallerScreen | null {
  const order = screenOrder(context);
  const index = order.indexOf(screen);
  if (index < 0 || index >= order.length - 1) return null;
  return order[index + 1] ?? null;
}

export function previousScreen(
  context: InstallerContext,
  screen: InstallerScreen,
): InstallerScreen | null {
  const order = screenOrder(context);
  const index = order.indexOf(screen);
  if (index <= 0) return null;
  return order[index - 1] ?? null;
}

export function canAdvance(
  state: InstallerUiState,
  context: InstallerContext,
): boolean {
  if (state.starting) return false;
  if (state.screen === 'location') return pathError(state.draft.path) == null;
  if (state.screen === 'scope') {
    if (context.conflicting) return false;
    return true;
  }
  if (state.screen === 'confirmUninstall') return context.existing != null;
  if (state.screen === 'progress') return false;
  if (state.screen === 'finish') return false;
  if (state.screen === 'error') return false;
  return true;
}

export function beginRun(state: InstallerUiState): InstallerUiState {
  return {
    ...state,
    screen: 'progress',
    steps: stepsFor(state.mode),
    progress: 0,
    progressMessage: '',
    logLines: [],
    error: null,
    starting: true,
    cancelling: false,
  };
}

export function installOptions(state: InstallerUiState): InstallOptions {
  return {
    scope: state.draft.scope,
    path: state.draft.path.trim(),
    desktopShortcut: state.draft.desktopShortcut,
    startMenuShortcut: state.draft.startMenuShortcut,
    launchAfterInstall: state.draft.launchAfterInstall,
  };
}

export function scopeLabel(scope: InstallScope): string {
  return scope === 'machine' ? 'Todos os usuários' : 'Apenas para mim';
}
