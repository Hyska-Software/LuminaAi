/**
 * Global keyboard shortcuts (App.tsx) resolved by a pure function.
 *
 * Extracting the decision from the effect keeps the precedence rules — which
 * are easy to break — unit-testable: the command palette owns the keyboard
 * while open (only ⌘K toggles it), Escape is handled hierarchically, and ⌘J
 * never steals a keystroke from an editable field.
 */

import type { LayoutMode } from '@/lib/store';

export interface HotkeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  target: EventTarget | null;
}

/** Minimal UI snapshot the resolver needs; built from the zustand stores. */
export interface HotkeySnapshot {
  layoutMode: LayoutMode;
  commandPaletteOpen: boolean;
  modelPickerOpen: boolean;
  settingsOpen: boolean;
  artifactPanelOpen: boolean;
  sourcesPanelOpen: boolean;
  skillsView: boolean;
  /** A página Biblioteca também substitui o chat (Esc volta ao chat). */
  libraryView?: boolean;
  /** Skills aberto no centro do layout Code (Esc volta à sessão). */
  codeSkillsView?: boolean;
  streaming: boolean;
}

export type HotkeyCommand =
  | 'toggle-command-palette'
  | 'toggle-sidebar'
  | 'new-conversation'
  | 'new-code-session'
  | 'open-center-terminal'
  | 'open-settings'
  | 'close-overlays'
  | 'return-to-chat'
  | 'stop-streaming'
  | 'focus-composer';

/** Whether the event target would consume plain text input (composer, forms). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
    closest?: unknown;
  };
  if (typeof element.tagName !== 'string') return false;
  const tag = element.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (element.isContentEditable === true) return true;
  if (typeof element.closest === 'function') {
    try {
      return (element.closest as (selector: string) => unknown)('[contenteditable="true"]') !== null;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Resolves the shortcut for a keydown event. Returns `null` when the app
 * should ignore it (no matching shortcut, or the event was already handled).
 *
 * Precedence:
 * 1. `defaultPrevented` → ignore (another surface consumed the key).
 * 2. ⌘/Ctrl+K → toggle the command palette (works open and closed).
 * 3. Palette open → nothing else (the palette owns Esc/arrows/Enter; Esc in
 *    particular is handled by its dialog and must not cascade to panels or
 *    stop streaming).
 * 4. Global shortcuts ⌘B, ⌘N, ⌘,.
 * 5. Escape: close overlays → leave Skills → stop streaming.
 * 6. ⌘J focuses the composer unless a text field is focused.
 */
export function resolveHotkey(event: HotkeyEvent, snapshot: HotkeySnapshot): HotkeyCommand | null {
  if (event.defaultPrevented) return null;
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  if (mod && key === 'k') return 'toggle-command-palette';
  if (snapshot.commandPaletteOpen) return null;

  if (snapshot.layoutMode === 'code' && mod && event.shiftKey && key === 'a') {
    return 'new-code-session';
  }
  if (snapshot.layoutMode === 'code' && mod && event.shiftKey && key === 't') {
    return 'open-center-terminal';
  }

  if (mod && key === 'b') return 'toggle-sidebar';
  if (mod && key === 'n') return 'new-conversation';
  if (mod && event.key === ',') return 'open-settings';

  if (event.key === 'Escape') {
    if (
      snapshot.modelPickerOpen ||
      snapshot.settingsOpen ||
      snapshot.artifactPanelOpen ||
      snapshot.sourcesPanelOpen
    ) {
      return 'close-overlays';
    }
    if (snapshot.skillsView || snapshot.libraryView || snapshot.codeSkillsView) {
      return 'return-to-chat';
    }
    if (snapshot.streaming) return 'stop-streaming';
    return null;
  }

  if (mod && key === 'j' && !isEditableTarget(event.target)) return 'focus-composer';

  return null;
}
