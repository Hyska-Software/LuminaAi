/**
 * Owner of the interactive terminals of the Code layout.
 *
 * The PTY sessions must outlive React remounts: the right panel is unmounted
 * when the user switches to Arquivos/Alterações, collapses the panel, resizes
 * the window below the dock breakpoint or changes the Code session. Keeping
 * the xterm instances + IPC channels here (module store) means tab switches
 * and panel visibility changes never leak a PTY, while changing sessions still
 * keeps each conversation's terminals isolated.
 *
 * The `TerminalPanel` is only a view: it attaches/detaches the hosts and reads
 * snapshots through `useSyncExternalStore`.
 */
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm, type IDisposable, type ITheme } from '@xterm/xterm';

import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import type { TerminalEvent, TerminalInfo } from '@/lib/types';
import {
  buildTerminalTheme,
  prefersReducedMotion,
  terminalFontFamily,
} from './terminalTheme';

/** Mirrors `MAX_TERMINALS_PER_CONVERSATION` in the Rust terminal registry. */
export const TERMINAL_TAB_LIMIT = 4;

const TERMINAL_FONT_SIZE = 12;

export interface TerminalErrorState {
  code: string;
  /** Friendly message shown to the user (pt-BR). */
  message: string;
  /** Raw backend error, used as tooltip/diagnostic. */
  detail: string;
  canRetry: boolean;
}

export interface TerminalTabInfo {
  id: string;
  title: string;
  cwd: string;
  cols: number;
  rows: number;
  running: boolean;
  exitCode: number | null;
  killing: boolean;
}

export interface TerminalSnapshot {
  tabs: TerminalTabInfo[];
  activeId: string | null;
  loading: boolean;
  error: TerminalErrorState | null;
  limit: number;
}

interface TerminalInstance {
  id: string;
  conversationId: string;
  title: string;
  cwd: string;
  cols: number;
  rows: number;
  running: boolean;
  exitCode: number | null;
  killing: boolean;
  exitWritten: boolean;
  writeErrorWritten: boolean;
  disposed: boolean;
  term: XTerm;
  fit: FitAddon;
  host: HTMLDivElement;
  input: IDisposable | null;
  observer: ResizeObserver | null;
}

interface ConversationRuntime {
  conversationId: string;
  instances: Map<string, TerminalInstance>;
  order: string[];
  activeId: string | null;
  loading: boolean;
  error: TerminalErrorState | null;
  container: HTMLElement | null;
  nextIndex: number;
  snapshot: TerminalSnapshot;
  reconciled: boolean;
  reconcile: Promise<void> | null;
}

const EMPTY_SNAPSHOT: TerminalSnapshot = {
  tabs: [],
  activeId: null,
  loading: false,
  error: null,
  limit: TERMINAL_TAB_LIMIT,
};

/** Human copy for the stable `TERMINAL_*` error codes, resolved at call time. */
function terminalErrorMessage(code: string): string {
  switch (code) {
    case 'TERMINAL_LIMIT':
      return t('code:terminal.error.limit');
    case 'TERMINAL_NO_WORKSPACE':
      return t('code:terminal.error.noWorkspace');
    case 'TERMINAL_WORKSPACE_MISSING':
      return t('code:terminal.error.workspaceMissing');
    case 'TERMINAL_CONVERSATION_NOT_FOUND':
      return t('code:terminal.error.conversationNotFound');
    case 'TERMINAL_CONVERSATION':
      return t('code:terminal.error.conversation');
    case 'TERMINAL_SPAWN':
      return t('code:terminal.error.spawn');
    case 'TERMINAL_READ':
      return t('code:terminal.error.read');
    case 'TERMINAL_WRITE':
      return t('code:terminal.error.write');
    case 'TERMINAL_RESIZE':
      return t('code:terminal.error.resize');
    case 'TERMINAL_NOT_FOUND':
      return t('code:terminal.error.notFound');
    case 'TERMINAL_EXITED':
      return t('code:terminal.error.exited');
    case 'TERMINAL_CLOSE':
      return t('code:terminal.error.close');
    case 'TERMINAL_KILL':
      return t('code:terminal.error.kill');
    default:
      return t('code:terminal.error.fallback');
  }
}

const RETRYABLE_CODES = new Set([
  'TERMINAL_SPAWN',
  'TERMINAL_READ',
  'TERMINAL_WRITE',
  'TERMINAL_RESIZE',
  'TERMINAL_CLOSE',
  'TERMINAL_KILL',
  'TERMINAL_ERROR',
]);

function errorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const match = /^([A-Z][A-Z0-9_]+):/.exec(raw);
  return match?.[1] ?? 'TERMINAL_ERROR';
}

function toTerminalError(error: unknown): TerminalErrorState {
  const raw = error instanceof Error ? error.message : String(error);
  const code = errorCode(error);
  return {
    code,
    message: terminalErrorMessage(code),
    detail: raw,
    canRetry: RETRYABLE_CODES.has(code),
  };
}

function schedule(callback: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback);
  } else {
    setTimeout(callback, 0);
  }
}

function terminalHost(): HTMLDivElement {
  const host = document.createElement('div');
  host.className = 'absolute inset-0';
  host.dataset.terminalHost = 'true';
  host.style.opacity = '0';
  host.setAttribute('role', 'group');
  host.setAttribute('aria-label', t('code:terminal.hostLabel'));
  return host;
}

function createTerminal(): XTerm {
  return new XTerm({
    cursorBlink: !prefersReducedMotion(),
    fontFamily: terminalFontFamily(),
    fontSize: TERMINAL_FONT_SIZE,
    scrollback: 5_000,
    allowProposedApi: true,
    screenReaderMode: true,
    theme: buildTerminalTheme(),
  });
}

/** Waits for the web font before measuring cells (avoids stale rows/columns). */
async function loadTerminalFont(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  try {
    await document.fonts.load(`${TERMINAL_FONT_SIZE}px "JetBrains Mono Variable"`);
  } catch {
    // Fall back to the bundled stack; FitAddon will measure whatever loads.
  }
}

/** Imperative store used by the Code layout terminal panel. */
class TerminalManager {
  private runtimes = new Map<string, ConversationRuntime>();
  private listeners = new Set<() => void>();
  private staging: HTMLDivElement | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot(conversationId: string | null): TerminalSnapshot {
    if (!conversationId) return EMPTY_SNAPSHOT;
    return this.runtimes.get(conversationId)?.snapshot ?? EMPTY_SNAPSHOT;
  }

  /** Appends the conversation hosts to the visible panel container. */
  attach(
    conversationId: string,
    container: HTMLElement,
    options: { focus?: boolean } = {},
  ): void {
    const runtime = this.ensureRuntime(conversationId);
    if (runtime.container === container) return;
    if (runtime.container) this.detachHosts(runtime);
    runtime.container = container;
    // The container belongs exclusively to the terminal hosts; clearing it
    // protects against stale hosts from a previous implementation/HMR.
    container.replaceChildren();
    for (const id of runtime.order) {
      const instance = runtime.instances.get(id);
      if (instance) container.appendChild(instance.host);
    }
    this.applyTheme();
    this.syncVisibility(runtime);
    const focus = options.focus === true;
    schedule(() => {
      if (focus) this.focusActive(runtime);
      else this.fitActive(runtime);
    });
    void this.reconcile(conversationId);
  }

  /** Detaches the hosts without destroying the PTY or the xterm buffer. */
  detach(conversationId: string, container?: HTMLElement): void {
    const runtime = this.runtimes.get(conversationId);
    if (!runtime) return;
    if (container && runtime.container && runtime.container !== container) return;
    this.detachHosts(runtime);
    runtime.container = null;
  }

  async open(conversationId: string): Promise<void> {
    const runtime = this.ensureRuntime(conversationId);
    if (runtime.loading) return;
    if (runtime.instances.size >= TERMINAL_TAB_LIMIT) {
      runtime.error = toTerminalError(`TERMINAL_LIMIT: máximo de ${TERMINAL_TAB_LIMIT}`);
      this.notify(runtime);
      return;
    }
    await this.reconcile(conversationId);
    if (runtime.loading) return;
    if (runtime.instances.size >= TERMINAL_TAB_LIMIT) {
      runtime.error = toTerminalError(`TERMINAL_LIMIT: máximo de ${TERMINAL_TAB_LIMIT}`);
      this.notify(runtime);
      return;
    }

    runtime.loading = true;
    runtime.error = null;
    this.notify(runtime);

    await loadTerminalFont();

    const term = createTerminal();
    const fit = new FitAddon();
    term.loadAddon(fit);
    const host = terminalHost();
    const instance: TerminalInstance = {
      id: '',
      conversationId,
      title: '',
      cwd: '',
      cols: term.cols || 80,
      rows: term.rows || 24,
      running: true,
      exitCode: null,
      killing: false,
      exitWritten: false,
      writeErrorWritten: false,
      disposed: false,
      term,
      fit,
      host,
      input: null,
      observer: null,
    };

    try {
      const parent = this.hostParent(runtime);
      parent.appendChild(host);
      term.open(host);
      try {
        fit.fit();
      } catch {
        // No dimensions on the first paint; the ResizeObserver retries.
      }
      instance.cols = term.cols || 80;
      instance.rows = term.rows || 24;

      const info = await api.openTerminal(
        conversationId,
        instance.cols,
        instance.rows,
        (event) => this.handleEvent(instance, event),
      );

      if (instance.disposed) {
        void api.closeTerminal(info.id).catch(() => undefined);
        return;
      }

      instance.id = info.id;
      instance.cwd = info.cwd;
      // The process may have exited before this promise resolved: never
      // resurrect an exit event handled while the invoke was in flight.
      instance.running = instance.running && info.running;
      if (instance.exitCode === null) instance.exitCode = info.exitCode ?? null;
      if (!instance.running) {
        instance.term.options.disableStdin = true;
        instance.term.options.cursorBlink = false;
      }
      instance.cols = info.cols || instance.cols;
      instance.rows = info.rows || instance.rows;
      instance.title = t('code:terminal.title', { index: runtime.nextIndex });
      instance.host.dataset.terminalId = instance.id;
      runtime.nextIndex += 1;

      runtime.instances.set(instance.id, instance);
      runtime.order.push(instance.id);
      runtime.activeId = instance.id;

      if (runtime.container) {
        runtime.container.appendChild(instance.host);
      } else {
        instance.host.remove();
      }

      instance.input = term.onData((data) => {
        if (instance.disposed || !instance.running) return;
        void api.writeTerminal(instance.id, data).catch((writeError: unknown) => {
          if (instance.disposed || instance.writeErrorWritten) return;
          const code = errorCode(writeError);
          if (code === 'TERMINAL_EXITED' || code === 'TERMINAL_NOT_FOUND') return;
          instance.writeErrorWritten = true;
          instance.term.write(
            `\r\n\x1b[31m${terminalErrorMessage('TERMINAL_WRITE')}\x1b[0m\r\n`,
          );
        });
      });

      instance.observer = new ResizeObserver(() => {
        if (!instance.disposed) this.fitInstance(runtime, instance);
      });
      instance.observer.observe(instance.host);

      this.syncVisibility(runtime);
      this.notify(runtime);
      schedule(() => {
        this.fitInstance(runtime, instance);
        if (runtime.activeId === instance.id) instance.term.focus();
      });
    } catch (openError) {
      instance.disposed = true;
      instance.observer?.disconnect();
      instance.input?.dispose();
      instance.host.remove();
      term.dispose();
      const parsed = toTerminalError(openError);
      runtime.error = parsed;
      if (parsed.code === 'TERMINAL_LIMIT' && runtime.instances.size < TERMINAL_TAB_LIMIT) {
        // The backend may still hold orphans from a previous webview: allow
        // the next attempt to reconcile instead of leaving the panel stuck.
        runtime.reconciled = false;
      }
    } finally {
      runtime.loading = false;
      this.notify(runtime);
    }
  }

  activate(
    conversationId: string,
    id: string,
    options: { focusTerminal?: boolean } = {},
  ): void {
    const runtime = this.runtimes.get(conversationId);
    const instance = runtime?.instances.get(id);
    if (!runtime || !instance) return;
    runtime.activeId = id;
    this.syncVisibility(runtime);
    this.notify(runtime);
    schedule(() => {
      this.fitInstance(runtime, instance);
      if (options.focusTerminal !== false) instance.term.focus();
    });
  }

  async close(conversationId: string, id: string): Promise<void> {
    const runtime = this.runtimes.get(conversationId);
    const instance = runtime?.instances.get(id);
    if (!runtime || !instance) return;
    const index = runtime.order.indexOf(id);
    this.removeInstance(runtime, instance);
    if (runtime.activeId === id) {
      runtime.activeId = runtime.order[index] ?? runtime.order[index - 1] ?? null;
    }
    if (runtime.order.length === 0) runtime.nextIndex = 1;
    this.syncVisibility(runtime);
    this.notify(runtime);
    schedule(() => this.focusActive(runtime));

    try {
      await api.closeTerminal(id);
      runtime.error = null;
      this.notify(runtime);
    } catch (closeError) {
      runtime.error = {
        ...toTerminalError(closeError),
        code: 'TERMINAL_CLOSE',
        message: terminalErrorMessage('TERMINAL_CLOSE'),
        canRetry: false,
      };
      this.notify(runtime);
    }
  }

  async kill(conversationId: string, id: string): Promise<void> {
    const runtime = this.runtimes.get(conversationId);
    const instance = runtime?.instances.get(id);
    if (!runtime || !instance || !instance.running || instance.killing) return;
    instance.killing = true;
    runtime.error = null;
    this.notify(runtime);
    try {
      await api.killTerminal(id);
    } catch (killError) {
      instance.killing = false;
      runtime.error = {
        ...toTerminalError(killError),
        code: 'TERMINAL_KILL',
        message: terminalErrorMessage('TERMINAL_KILL'),
        canRetry: false,
      };
      this.notify(runtime);
    }
  }

  clear(conversationId: string, id: string): void {
    const instance = this.runtimes.get(conversationId)?.instances.get(id);
    if (!instance) return;
    instance.term.clear();
    instance.term.focus();
  }

  async restart(conversationId: string, id: string): Promise<void> {
    const runtime = this.runtimes.get(conversationId);
    if (!runtime?.instances.has(id)) return;
    const wasActive = runtime.activeId === id;
    await this.close(conversationId, id);
    await this.open(conversationId);
    // Restart is only offered for the active terminal; the new terminal is
    // already active. No extra focus dance is needed.
    if (!wasActive) schedule(() => this.focusActive(runtime));
  }

  /** Closes every terminal of a conversation (session deletion/shutdown). */
  async closeConversation(conversationId: string): Promise<void> {
    const runtime = this.runtimes.get(conversationId);
    if (!runtime) return;
    const ids = [...runtime.order];
    await Promise.all(ids.map((id) => this.close(conversationId, id)));
    runtime.error = null;
    this.notify(runtime);
  }

  /** Re-applies the app theme to every live xterm. */
  applyTheme(): void {
    const theme: ITheme = buildTerminalTheme();
    for (const runtime of this.runtimes.values()) {
      for (const instance of runtime.instances.values()) {
        if (!instance.disposed) instance.term.options.theme = theme;
      }
    }
  }

  /** Refits after the web font finishes loading (or the panel changes size). */
  refitAll(): void {
    for (const runtime of this.runtimes.values()) {
      for (const instance of runtime.instances.values()) {
        if (!instance.disposed) this.fitInstance(runtime, instance);
      }
    }
  }

  /** Test-only reset; never used in production. */
  resetForTests(): void {
    for (const runtime of this.runtimes.values()) {
      for (const instance of runtime.instances.values()) {
        instance.disposed = true;
        instance.observer?.disconnect();
        instance.input?.dispose();
        instance.host.remove();
        instance.term.dispose();
      }
      runtime.instances.clear();
      runtime.order = [];
    }
    this.runtimes.clear();
    this.listeners.clear();
    this.staging?.remove();
    this.staging = null;
  }

  private ensureRuntime(conversationId: string): ConversationRuntime {
    const existing = this.runtimes.get(conversationId);
    if (existing) return existing;
    const runtime: ConversationRuntime = {
      conversationId,
      instances: new Map(),
      order: [],
      activeId: null,
      loading: false,
      error: null,
      container: null,
      nextIndex: 1,
      snapshot: EMPTY_SNAPSHOT,
      reconciled: false,
      reconcile: null,
    };
    runtime.snapshot = this.buildSnapshot(runtime);
    this.runtimes.set(conversationId, runtime);
    return runtime;
  }

  private buildSnapshot(runtime: ConversationRuntime): TerminalSnapshot {
    const tabs: TerminalTabInfo[] = [];
    for (const id of runtime.order) {
      const instance = runtime.instances.get(id);
      if (!instance) continue;
      tabs.push({
        id: instance.id,
        title: instance.title,
        cwd: instance.cwd,
        cols: instance.cols,
        rows: instance.rows,
        running: instance.running,
        exitCode: instance.exitCode,
        killing: instance.killing,
      });
    }
    return {
      tabs,
      activeId: runtime.activeId,
      loading: runtime.loading,
      error: runtime.error,
      limit: TERMINAL_TAB_LIMIT,
    };
  }

  private notify(runtime: ConversationRuntime): void {
    runtime.snapshot = this.buildSnapshot(runtime);
    for (const listener of this.listeners) listener();
  }

  private removeInstance(runtime: ConversationRuntime, instance: TerminalInstance): void {
    instance.disposed = true;
    runtime.instances.delete(instance.id);
    const index = runtime.order.indexOf(instance.id);
    if (index >= 0) runtime.order.splice(index, 1);
    instance.observer?.disconnect();
    instance.input?.dispose();
    instance.host.remove();
    instance.term.dispose();
  }

  private detachHosts(runtime: ConversationRuntime): void {
    const container = runtime.container;
    if (!container) return;
    container.replaceChildren();
  }

  private syncVisibility(runtime: ConversationRuntime): void {
    for (const [id, instance] of runtime.instances) {
      const active = id === runtime.activeId;
      instance.host.hidden = !active;
      instance.host.style.opacity = active ? '' : '0';
      if (active) instance.host.removeAttribute('aria-hidden');
      else instance.host.setAttribute('aria-hidden', 'true');
    }
  }

  private fitInstance(runtime: ConversationRuntime, instance: TerminalInstance): void {
    if (instance.disposed) return;
    if (!runtime.container || !instance.host.isConnected) return;
    if (runtime.activeId !== instance.id) return;
    try {
      instance.fit.fit();
    } catch {
      return;
    }
    const cols = instance.term.cols;
    const rows = instance.term.rows;
    if (!cols || !rows) return;
    if (cols === instance.cols && rows === instance.rows) return;
    instance.cols = cols;
    instance.rows = rows;
    void api.resizeTerminal(instance.id, cols, rows).catch(() => undefined);
    this.notify(runtime);
  }

  private focusActive(runtime: ConversationRuntime): void {
    if (!runtime.container) return;
    const instance = runtime.activeId ? runtime.instances.get(runtime.activeId) : null;
    if (!instance || instance.disposed) return;
    this.fitInstance(runtime, instance);
    instance.term.focus();
  }

  private fitActive(runtime: ConversationRuntime): void {
    if (!runtime.container || !runtime.activeId) return;
    const instance = runtime.instances.get(runtime.activeId);
    if (!instance || instance.disposed) return;
    this.fitInstance(runtime, instance);
  }

  /**
   * Opens the xterm even if the panel was closed while the IPC call was in
   * flight. The staging container is off-screen and only used for measuring;
   * the host is moved to the real container as soon as it is attached again.
   */
  private hostParent(runtime: ConversationRuntime): HTMLElement {
    if (runtime.container) return runtime.container;
    if (!this.staging) {
      const staging = document.createElement('div');
      staging.style.position = 'fixed';
      staging.style.left = '-10000px';
      staging.style.top = '-10000px';
      staging.style.width = '480px';
      staging.style.height = '320px';
      staging.style.visibility = 'hidden';
      staging.setAttribute('aria-hidden', 'true');
      document.body.appendChild(staging);
      this.staging = staging;
    }
    return this.staging;
  }

  private handleEvent(instance: TerminalInstance, event: TerminalEvent): void {
    if (instance.disposed) return;
    if (event.type === 'data') {
      instance.term.write(event.data);
      return;
    }
    instance.running = false;
    instance.killing = false;
    instance.exitCode = event.code ?? null;
    instance.term.options.disableStdin = true;
    instance.term.options.cursorBlink = false;
    if (!instance.exitWritten) {
      instance.exitWritten = true;
      const detail =
        instance.exitCode !== null && instance.exitCode !== undefined
          ? t('code:terminal.exitCode', { code: instance.exitCode })
          : '';
      instance.term.write(
        `\r\n\x1b[90m${t('code:terminal.exitNotice', { detail })}\x1b[0m\r\n`,
      );
    }
    const runtime = this.runtimes.get(instance.conversationId);
    if (runtime) this.notify(runtime);
  }

  /**
   * Closes sessions that exist in the backend but not in this renderer. This
   * happens after a webview reload/HMR: the old channels are gone, so the
   * PTYs cannot be reattached and must be cleaned up instead of silently
   * consuming the per-session limit.
   */
  private reconcile(conversationId: string): Promise<void> {
    const runtime = this.ensureRuntime(conversationId);
    if (runtime.reconciled) return Promise.resolve();
    if (runtime.reconcile) return runtime.reconcile;
    runtime.reconcile = (async () => {
      try {
        const sessions: TerminalInfo[] = await api.listTerminals(conversationId);
        for (const session of sessions) {
          if (runtime.instances.has(session.id)) continue;
          await api.closeTerminal(session.id).catch(() => undefined);
        }
      } catch {
        // Older backend or IPC hiccup: opening still works and the panel can
        // surface the real error from `open`.
      } finally {
        runtime.reconciled = true;
        runtime.reconcile = null;
      }
    })();
    return runtime.reconcile;
  }
}

export const terminalManager = new TerminalManager();

/** Test-only helper; keeps the singleton from leaking between Vitest cases. */
export function __resetTerminalManagerForTests(): void {
  terminalManager.resetForTests();
}
