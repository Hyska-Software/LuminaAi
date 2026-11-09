// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useAppStore, useUiStore } from '@/lib/store';
import { LayoutModeSwitch } from './LayoutModeSwitch';

beforeEach(() => {
  useUiStore.setState({
    layoutMode: 'chat',
    enabledLayouts: { chat: true, code: true, agent: true },
  });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, reduceMotion: true },
  });
});

afterEach(() => {
  cleanup();
});

function switchGroup(): HTMLElement {
  return screen.getByRole('group', { name: 'Modo do aplicativo' });
}

describe('LayoutModeSwitch', () => {
  it('renders the group and the three modes, marking the active one', () => {
    render(<LayoutModeSwitch />);

    expect(switchGroup()).toBeTruthy();

    const chat = screen.getByRole('button', { name: 'Chat' });
    const code = screen.getByRole('button', { name: 'Code' });
    const agents = screen.getByRole('button', { name: 'Agentes' });
    expect(chat.getAttribute('aria-pressed')).toBe('true');
    expect(code.getAttribute('aria-pressed')).toBe('false');
    expect(agents.getAttribute('aria-pressed')).toBe('false');
  });

  it('uses icons instead of visible labels, keeping accessible names and hints', () => {
    render(<LayoutModeSwitch />);

    const chat = screen.getByRole('button', { name: 'Chat' });
    const code = screen.getByRole('button', { name: 'Code' });

    expect(chat.textContent).toBe('');
    expect(code.textContent).toBe('');
    expect(chat.getAttribute('title')).toBe('Layout de conversa');
    expect(code.getAttribute('title')).toBe('Layout de código');

    for (const button of [chat, code]) {
      const icon = button.querySelector('svg');
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      expect(icon?.getAttribute('class')).toContain('size-4');
    }
  });

  it('switches the layout mode and persists the choice', () => {
    render(<LayoutModeSwitch />);

    fireEvent.click(screen.getByRole('button', { name: 'Code' }));

    expect(useUiStore.getState().layoutMode).toBe('code');
    expect(screen.getByRole('button', { name: 'Code' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Chat' }).getAttribute('aria-pressed')).toBe('false');

    const raw = window.localStorage.getItem('lumina.ui');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string) as { state?: { layoutMode?: string } };
    expect(persisted.state?.layoutMode).toBe('code');
  });

  it('returns to the Chat layout', () => {
    useUiStore.setState({ layoutMode: 'code' });
    render(<LayoutModeSwitch />);

    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));

    expect(useUiStore.getState().layoutMode).toBe('chat');
  });

  it('switches to Agentes and back without losing the choice', () => {
    render(<LayoutModeSwitch />);

    fireEvent.click(screen.getByRole('button', { name: 'Agentes' }));
    expect(useUiStore.getState().layoutMode).toBe('agent');

    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(useUiStore.getState().layoutMode).toBe('chat');
  });

  it('hides the whole control when only one layout is enabled', () => {
    useUiStore.setState({ enabledLayouts: { chat: true, code: false, agent: false } });

    render(<LayoutModeSwitch />);

    expect(screen.queryByRole('group', { name: 'Modo do aplicativo' })).toBeNull();
  });

  it('renders only the enabled layouts', () => {
    useUiStore.setState({ enabledLayouts: { chat: true, code: false, agent: true } });

    render(<LayoutModeSwitch />);

    expect(screen.getByRole('button', { name: 'Chat' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agentes' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Code' })).toBeNull();
  });

  it('opens a right-click menu with every layout and its current state', async () => {
    useUiStore.setState({ enabledLayouts: { chat: true, code: false, agent: true } });
    render(<LayoutModeSwitch />);

    fireEvent.contextMenu(switchGroup());

    expect(await screen.findByRole('menu', { name: 'Layouts' })).toBeTruthy();
    const expected: [string, string][] = [
      ['Chat', 'true'],
      ['Code', 'false'],
      ['Agentes', 'true'],
    ];
    for (const [name, checked] of expected) {
      const item = screen.getByRole('menuitemcheckbox', { name });
      expect(item.getAttribute('aria-checked')).toBe(checked);
    }
  });

  it('disables a layout from the context menu', async () => {
    render(<LayoutModeSwitch />);

    fireEvent.contextMenu(switchGroup());
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Agentes' }));

    expect(useUiStore.getState().enabledLayouts.agent).toBe(false);
    expect(screen.queryByRole('button', { name: 'Agentes' })).toBeNull();
  });

  it('disappears and falls back to an enabled layout when the last-but-one is hidden', async () => {
    useUiStore.setState({
      layoutMode: 'code',
      enabledLayouts: { chat: true, code: true, agent: false },
    });
    render(<LayoutModeSwitch />);

    fireEvent.contextMenu(switchGroup());
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Code' }));

    expect(useUiStore.getState().enabledLayouts).toEqual({ chat: true, code: false, agent: false });
    expect(useUiStore.getState().layoutMode).toBe('chat');
    expect(screen.queryByRole('group', { name: 'Modo do aplicativo' })).toBeNull();
  });
});
