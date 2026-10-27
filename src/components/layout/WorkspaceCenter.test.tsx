// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/chat/ChatView', () => ({
  ChatView: ({ welcome }: { welcome?: unknown }) => (
    <div data-testid="chat-view">{welcome ? <div data-testid="custom-welcome" /> : null}</div>
  ),
}));

vi.mock('@/components/code', () => ({
  CodeSessionHeader: () => <div data-testid="code-session-header" />,
  CodeWelcomeScreen: () => <div data-testid="code-welcome" />,
}));

vi.mock('@/components/skills', () => ({
  SkillsView: ({ onBack, backLabel }: { onBack?: () => void; backLabel?: string }) => (
    <div data-testid="skills-view">
      <button type="button" onClick={onBack}>
        {backLabel}
      </button>
    </div>
  ),
}));

vi.mock('@/components/library', () => ({
  LibraryView: () => <div data-testid="library-view" />,
}));

import { useUiStore } from '@/lib/store';
import { WorkspaceCenter } from './WorkspaceCenter';

beforeEach(() => {
  useUiStore.setState({
    layoutMode: 'chat',
    codeView: 'session',
    activeView: 'chat',
  });
});

afterEach(() => {
  cleanup();
});

describe('WorkspaceCenter — modo Chat', () => {
  it('shows the conversation by default', () => {
    render(<WorkspaceCenter />);

    expect(screen.getByTestId('chat-view')).toBeTruthy();
    expect(screen.queryByTestId('code-session-header')).toBeNull();
    expect(screen.queryByTestId('skills-view')).toBeNull();
    expect(screen.queryByTestId('library-view')).toBeNull();
    // Chat uses the native chat welcome, not the Code one.
    expect(screen.queryByTestId('custom-welcome')).toBeNull();
  });

  it('replaces the conversation with Skills but keeps the chat mounted', () => {
    useUiStore.setState({ activeView: 'skills' });
    render(<WorkspaceCenter />);

    const chat = screen.getByTestId('chat-view');
    expect(chat.parentElement?.className).toContain('hidden');
    expect(screen.getByRole('button', { name: 'Voltar ao chat' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao chat' }));

    expect(useUiStore.getState().activeView).toBe('chat');
  });

  it('shows the Biblioteca only in the Chat layout', () => {
    useUiStore.setState({ activeView: 'library' });
    render(<WorkspaceCenter />);

    expect(screen.getByTestId('library-view')).toBeTruthy();
    expect(screen.getByTestId('chat-view').parentElement?.className).toContain('hidden');
  });
});

describe('WorkspaceCenter — modo Code', () => {
  it('shows the session header and the Code welcome above the shared chat', () => {
    useUiStore.setState({ layoutMode: 'code' });
    render(<WorkspaceCenter />);

    expect(screen.getByTestId('code-session-header')).toBeTruthy();
    expect(screen.getByTestId('chat-view')).toBeTruthy();
    expect(screen.getByTestId('custom-welcome')).toBeTruthy();
    expect(screen.queryByTestId('library-view')).toBeNull();
  });

  it('opens the existing Skills page with the Code back label', () => {
    useUiStore.setState({ layoutMode: 'code', codeView: 'skills' });
    render(<WorkspaceCenter />);

    // The session header stays mounted (hidden) so the open tabs survive.
    const header = screen.getByTestId('code-session-header');
    expect(header.parentElement?.className).toContain('hidden');
    expect(header.parentElement?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('chat-view').parentElement?.className).toContain('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Voltar à sessão' }));

    expect(useUiStore.getState().codeView).toBe('session');
  });

  it('never renders the Biblioteca, even with a stale activeView', () => {
    useUiStore.setState({ layoutMode: 'code', activeView: 'library' });
    render(<WorkspaceCenter />);

    expect(screen.queryByTestId('library-view')).toBeNull();
    expect(screen.getByTestId('chat-view')).toBeTruthy();
  });

  it('keeps the same chat instance when switching layouts', () => {
    render(<WorkspaceCenter />);
    const chat = screen.getByTestId('chat-view');
    expect(chat).toBeTruthy();

    act(() => useUiStore.getState().setLayoutMode('code'));

    expect(screen.getByTestId('chat-view')).toBe(chat);
    expect(screen.getByTestId('custom-welcome')).toBeTruthy();
  });
});
