import { describe, expect, it } from 'vitest';
import {
  isEditableTarget,
  resolveHotkey,
  type HotkeyEvent,
  type HotkeySnapshot,
} from '@/lib/hotkeys';

function snapshot(overrides: Partial<HotkeySnapshot> = {}): HotkeySnapshot {
  return {
    commandPaletteOpen: false,
    modelPickerOpen: false,
    settingsOpen: false,
    artifactPanelOpen: false,
    sourcesPanelOpen: false,
    skillsView: false,
    streaming: false,
    ...overrides,
  };
}

function event(overrides: Partial<HotkeyEvent> = {}): HotkeyEvent {
  return {
    key: 'k',
    metaKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    target: null,
    ...overrides,
  };
}

function element(target: unknown): EventTarget {
  return target as EventTarget;
}

describe('resolveHotkey', () => {
  it('toggles the command palette with Ctrl+K or Meta+K', () => {
    expect(resolveHotkey(event({ key: 'k', ctrlKey: true }), snapshot())).toBe(
      'toggle-command-palette',
    );
    expect(resolveHotkey(event({ key: 'K', metaKey: true }), snapshot())).toBe(
      'toggle-command-palette',
    );
  });

  it('ignores events another surface already handled', () => {
    expect(
      resolveHotkey(event({ key: 'k', ctrlKey: true, defaultPrevented: true }), snapshot()),
    ).toBeNull();
  });

  it('only lets Ctrl+K through while the palette is open', () => {
    const open = snapshot({ commandPaletteOpen: true });

    expect(resolveHotkey(event({ key: 'b', ctrlKey: true }), open)).toBeNull();
    expect(resolveHotkey(event({ key: 'n', ctrlKey: true }), open)).toBeNull();
    expect(resolveHotkey(event({ key: ',', ctrlKey: true }), open)).toBeNull();
    expect(resolveHotkey(event({ key: 'Escape' }), open)).toBeNull();
    expect(resolveHotkey(event({ key: 'j', ctrlKey: true }), open)).toBeNull();
    expect(resolveHotkey(event({ key: 'k', ctrlKey: true }), open)).toBe('toggle-command-palette');
  });

  it('maps the navigation and conversation shortcuts', () => {
    expect(resolveHotkey(event({ key: 'b', metaKey: true }), snapshot())).toBe('toggle-sidebar');
    expect(resolveHotkey(event({ key: 'n', ctrlKey: true }), snapshot())).toBe('new-conversation');
    expect(resolveHotkey(event({ key: ',', metaKey: true }), snapshot())).toBe('open-settings');
  });

  it('resolves Escape in priority order: overlays, skills, streaming', () => {
    expect(resolveHotkey(event({ key: 'Escape' }), snapshot({ settingsOpen: true }))).toBe(
      'close-overlays',
    );
    expect(resolveHotkey(event({ key: 'Escape' }), snapshot({ artifactPanelOpen: true }))).toBe(
      'close-overlays',
    );
    expect(resolveHotkey(event({ key: 'Escape' }), snapshot({ skillsView: true }))).toBe(
      'return-to-chat',
    );
    expect(
      resolveHotkey(event({ key: 'Escape' }), snapshot({ skillsView: true, streaming: true })),
    ).toBe('return-to-chat');
    expect(resolveHotkey(event({ key: 'Escape' }), snapshot({ streaming: true }))).toBe(
      'stop-streaming',
    );
    expect(resolveHotkey(event({ key: 'Escape' }), snapshot())).toBeNull();
  });

  it('focuses the composer with Ctrl/Cmd+J unless a text field is focused', () => {
    expect(resolveHotkey(event({ key: 'j', ctrlKey: true }), snapshot())).toBe('focus-composer');
    expect(
      resolveHotkey(
        event({ key: 'j', ctrlKey: true, target: element({ tagName: 'TEXTAREA' }) }),
        snapshot(),
      ),
    ).toBeNull();
    expect(
      resolveHotkey(
        event({ key: 'j', ctrlKey: true, target: element({ tagName: 'DIV', isContentEditable: true }) }),
        snapshot(),
      ),
    ).toBeNull();
  });
});

describe('isEditableTarget', () => {
  it('recognizes native inputs and contenteditable ancestors', () => {
    expect(isEditableTarget(element({ tagName: 'input' }))).toBe(true);
    expect(isEditableTarget(element({ tagName: 'select' }))).toBe(true);
    expect(isEditableTarget(element({ tagName: 'div', isContentEditable: true }))).toBe(true);
    expect(
      isEditableTarget(
        element({
          tagName: 'span',
          closest: (selector: string) => (selector.includes('contenteditable') ? {} : null),
        }),
      ),
    ).toBe(true);
  });

  it('returns false for non-elements and ordinary nodes', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(element({ tagName: 'DIV' }))).toBe(false);
    expect(isEditableTarget(element({}))).toBe(false);
  });
});
