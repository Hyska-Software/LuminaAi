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
  CodeCommitHistoryView: ({ target }: { target: { revision: string | null } }) => (
    <div data-testid="code-commits-view">{target.revision ?? 'lista'}</div>
  ),
  CodeDiffView: ({ target }: { target: { path: string } }) => (
    <div data-testid="code-diff-view">{target.path}</div>
  ),
  CodeFileView: ({ target, className }: { target: { path: string }; className?: string }) => (
    <div data-testid="code-file-view" className={className}>
      {target.path}
    </div>
  ),
  CodePlanView: ({ tab }: { tab: { markdown: string } }) => (
    <div data-testid="code-plan-view">{tab.markdown}</div>
  ),
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
    codeDiffTab: null,
    codeCommitsTab: null,
    codeFileTab: null,
    codePlanTab: null,
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

  it('mostra o diff como aba central, mantém header e chat montados', () => {
    useUiStore.setState({
      layoutMode: 'code',
      codeView: 'diff',
      codeDiffTab: {
        workspaceId: 'ws-1',
        path: 'src/app.ts',
        staged: false,
        knownDiff: '@@ -1 +1 @@\n-a\n+b',
      },
    });

    render(<WorkspaceCenter />);

    expect(screen.getByTestId('code-diff-view').textContent).toContain('src/app.ts');
    expect(screen.getByTestId('code-session-header')).toBeTruthy();
    // O chat compartilhado continua montado (estado preservado), só oculto.
    expect(screen.getByTestId('chat-view').parentElement?.className).toContain('hidden');
    expect(screen.getByTestId('code-session-header').parentElement?.className).not.toContain(
      'hidden',
    );
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

describe('WorkspaceCenter — histórico de commits', () => {
  it('mostra a aba de commits no centro mantendo header e chat montados', () => {
    useUiStore.setState({
      layoutMode: 'code',
      codeView: 'commits',
      codeCommitsTab: { workspaceId: 'ws-1', revision: null },
    });

    render(<WorkspaceCenter />);

    expect(screen.getByTestId('code-commits-view').textContent).toContain('lista');
    expect(screen.getByTestId('code-session-header')).toBeTruthy();
    expect(screen.getByTestId('chat-view').parentElement?.className).toContain('hidden');
  });
});

describe('WorkspaceCenter — aba central de plano', () => {
  it('mostra o plano aprovado no centro mantendo header e chat montados', () => {
    useUiStore.setState({
      layoutMode: 'code',
      codeView: 'plan',
      codePlanTab: {
        conversationId: 'c-1',
        markdown: '# Plano aprovado',
        title: 'Plano',
        updatedAt: 1,
      },
    });

    render(<WorkspaceCenter />);

    const panel = screen.getByRole('region', { name: 'Plano aprovado da sessão' });
    expect(panel.id).toBe('code-plan-panel');
    expect(screen.getByTestId('code-plan-view').textContent).toContain('# Plano aprovado');
    expect(screen.getByTestId('code-session-header')).toBeTruthy();
    expect(screen.getByTestId('chat-view').parentElement?.className).toContain('hidden');
  });
});

describe('WorkspaceCenter — aba central de arquivo', () => {
  it('mostra o arquivo no centro com header visível e chat montado/oculto', () => {
    useUiStore.setState({
      layoutMode: 'code',
      codeView: 'file',
      codeFileTab: { workspaceId: 'ws-1', path: 'src/app.ts' },
    });

    render(<WorkspaceCenter />);

    const panel = screen.getByRole('region', { name: 'Arquivo src/app.ts' });
    expect(panel.id).toBe('code-file-panel');
    expect(panel.className).toContain('flex');
    expect(panel.className).toContain('min-h-0');
    expect(panel.className).toContain('flex-1');

    const fileView = screen.getByTestId('code-file-view');
    expect(fileView.textContent).toContain('src/app.ts');
    expect(fileView.className).toContain('flex');
    expect(fileView.className).toContain('min-h-0');
    expect(fileView.className).toContain('flex-1');

    // O header das sessões continua montado/visível para trocar de aba.
    const header = screen.getByTestId('code-session-header');
    expect(header.parentElement?.className).not.toContain('hidden');
    expect(header.parentElement?.getAttribute('aria-hidden')).toBeNull();

    // O chat compartilhado segue montado (estado preservado), só oculto.
    expect(screen.getByTestId('chat-view').parentElement?.className).toContain('hidden');
    expect(screen.queryByTestId('library-view')).toBeNull();
  });

  it('volta ao chat quando codeView é file sem alvo aberto', () => {
    useUiStore.setState({ layoutMode: 'code', codeView: 'file' });

    render(<WorkspaceCenter />);

    expect(screen.queryByTestId('code-file-view')).toBeNull();
    expect(screen.getByTestId('chat-view').parentElement?.className).not.toContain('hidden');
  });
});
