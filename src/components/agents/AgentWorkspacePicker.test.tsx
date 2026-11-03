// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  pickWorkspaceFolder: vi.fn(),
  addWorkspace: vi.fn(),
  setWorkspaceTrusted: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));

import { AgentWorkspacePicker } from './AgentWorkspacePicker';

const workspace = {
  id: 'workspace-1', name: 'Projeto', path: 'C:/Projeto',
  createdAt: 1, updatedAt: 1, trusted: false,
};

describe('AgentWorkspacePicker', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.pickWorkspaceFolder.mockResolvedValue(workspace.path);
    mocks.addWorkspace.mockResolvedValue(workspace);
    mocks.setWorkspaceTrusted.mockResolvedValue({ ...workspace, trusted: true });
  });
  afterEach(cleanup);

  it('requires explicit trust before selecting a new folder', async () => {
    const selected = vi.fn();
    render(<AgentWorkspacePicker onSelected={selected} />);
    fireEvent.click(screen.getByRole('button', { name: 'Escolher pasta' }));
    expect(await screen.findByText('Confiar nesta pasta?')).toBeTruthy();
    expect(mocks.addWorkspace).toHaveBeenCalledWith(workspace.path, false);
    expect(selected).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confiar e selecionar' }));
    await waitFor(() => expect(selected).toHaveBeenCalledWith({ ...workspace, trusted: true }));
    expect(mocks.setWorkspaceTrusted).toHaveBeenCalledWith(workspace.id, true);
  });

  it('does not select or trust a folder when cancelled', async () => {
    const selected = vi.fn();
    render(<AgentWorkspacePicker onSelected={selected} />);
    fireEvent.click(screen.getByRole('button', { name: 'Escolher pasta' }));
    await screen.findByText('Confiar nesta pasta?');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(selected).not.toHaveBeenCalled();
    expect(mocks.setWorkspaceTrusted).not.toHaveBeenCalled();
  });

  it('selects an already trusted folder without changing trust', async () => {
    const trusted = { ...workspace, trusted: true };
    mocks.addWorkspace.mockResolvedValue(trusted);
    const selected = vi.fn();
    render(<AgentWorkspacePicker onSelected={selected} />);
    fireEvent.click(screen.getByRole('button', { name: 'Escolher pasta' }));
    await waitFor(() => expect(selected).toHaveBeenCalledWith(trusted));
    expect(mocks.setWorkspaceTrusted).not.toHaveBeenCalled();
  });

  it('does nothing when the native folder picker is cancelled', async () => {
    mocks.pickWorkspaceFolder.mockResolvedValue(null);
    const selected = vi.fn();
    render(<AgentWorkspacePicker onSelected={selected} />);
    fireEvent.click(screen.getByRole('button', { name: 'Escolher pasta' }));
    await waitFor(() => expect(mocks.pickWorkspaceFolder).toHaveBeenCalled());
    expect(mocks.addWorkspace).not.toHaveBeenCalled();
    expect(selected).not.toHaveBeenCalled();
  });

  it('keeps the confirmation open when trusting fails', async () => {
    mocks.setWorkspaceTrusted.mockRejectedValue(new Error('indisponível'));
    const selected = vi.fn();
    render(<AgentWorkspacePicker onSelected={selected} />);
    fireEvent.click(screen.getByRole('button', { name: 'Escolher pasta' }));
    await screen.findByText('Confiar nesta pasta?');
    fireEvent.click(screen.getByRole('button', { name: 'Confiar e selecionar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('indisponível');
    expect(screen.getByText('Confiar nesta pasta?')).toBeTruthy();
    expect(selected).not.toHaveBeenCalled();
  });
});
