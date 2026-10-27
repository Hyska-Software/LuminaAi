// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Workspace } from '@/lib/types';
import { WorkspaceTrustDialog } from './WorkspaceTrustDialog';

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-1',
    name: 'lumina-core',
    path: 'C:/dev/lumina',
    createdAt: 1,
    updatedAt: 2,
    trusted: false,
    git: { root: 'C:/dev/lumina', branch: 'feat/code-harness', dirty: true },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('WorkspaceTrustDialog — confiança na pasta', () => {
  it('explica o que a confiança libera e oferece as três escolhas', () => {
    render(
      <WorkspaceTrustDialog
        open
        workspace={workspace()}
        onConfirm={vi.fn()}
        onReadOnly={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Confiar nesta pasta?' });
    expect(dialog).toBeTruthy();
    expect(screen.getByText('C:/dev/lumina')).toBeTruthy();
    expect(screen.getByText(/AGENTS\.md/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confiar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir em Leitura' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
  });

  it('coloca o foco inicial no botão Confiar (ação recomendada)', async () => {
    render(
      <WorkspaceTrustDialog
        open
        workspace={workspace()}
        onConfirm={vi.fn()}
        onReadOnly={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const confirm = screen.getByRole('button', { name: 'Confiar' });
    await waitFor(() => expect(document.activeElement).toBe(confirm));
  });

  it('dispara a escolha do usuário', () => {
    const onConfirm = vi.fn();
    const onReadOnly = vi.fn();
    const onCancel = vi.fn();
    render(
      <WorkspaceTrustDialog
        open
        workspace={workspace()}
        onConfirm={onConfirm}
        onReadOnly={onReadOnly}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir em Leitura' }));
    expect(onReadOnly).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Confiar' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Esc equivale a Cancelar (remove o workspace recém-criado)', async () => {
    const onCancel = vi.fn();
    render(
      <WorkspaceTrustDialog
        open
        workspace={workspace()}
        onConfirm={vi.fn()}
        onReadOnly={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
  });

  it('com a requisição em andamento desabilita as ações e ignora Esc', async () => {
    const onCancel = vi.fn();
    render(
      <WorkspaceTrustDialog
        open
        busy
        workspace={workspace()}
        onConfirm={vi.fn()}
        onReadOnly={vi.fn()}
        onCancel={onCancel}
      />,
    );

    expect((screen.getByRole('button', { name: 'Confiar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Abrir em Leitura' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('sem workspace não renderiza nada', () => {
    render(
      <WorkspaceTrustDialog
        open
        workspace={null}
        onConfirm={vi.fn()}
        onReadOnly={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
