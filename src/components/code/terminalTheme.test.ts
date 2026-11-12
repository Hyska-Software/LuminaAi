// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildTerminalTheme, terminalFontFamily } from './terminalTheme';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('terminalTheme', () => {
  it('uses the sidebar surface so the terminal blends with the right panel', () => {
    const tokens: Record<string, string> = {
      '--surface': '#101012',
      // The terminal must not reuse the chat tone for its background.
      '--background': '#17171a',
      '--foreground': '#ececf1',
    };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) => tokens[name] ?? '#000000',
    } as unknown as CSSStyleDeclaration);

    const theme = buildTerminalTheme();

    expect(theme.background).toBe('#101012');
    expect(theme.cursorAccent).toBe('#101012');
  });

  it('lets the terminal font preference override the theme stack', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) =>
        name === '--font-mono' ? '"Theme Mono", monospace' : '',
    } as unknown as CSSStyleDeclaration);

    expect(terminalFontFamily('Fira Code')).toBe('Fira Code');
    expect(terminalFontFamily('  ')).toBe('"Theme Mono", monospace');
  });
});
