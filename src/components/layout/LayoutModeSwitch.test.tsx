// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useAppStore, useUiStore } from '@/lib/store';
import { LayoutModeSwitch } from './LayoutModeSwitch';

beforeEach(() => {
  useUiStore.setState({ layoutMode: 'chat' });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, reduceMotion: true },
  });
});

afterEach(() => {
  cleanup();
});

describe('LayoutModeSwitch', () => {
  it('renders the group and both modes, marking the active one', () => {
    render(<LayoutModeSwitch />);

    expect(screen.getByRole('group', { name: 'Modo do aplicativo' })).toBeTruthy();

    const chat = screen.getByRole('button', { name: 'Chat' });
    const code = screen.getByRole('button', { name: 'Code' });
    expect(chat.getAttribute('aria-pressed')).toBe('true');
    expect(code.getAttribute('aria-pressed')).toBe('false');
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
});
