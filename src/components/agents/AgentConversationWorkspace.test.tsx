// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ listWorkspaces: vi.fn(), setConversationWorkspace: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('./AgentWorkspacePicker', () => ({ AgentWorkspacePicker: () => null }));
import { AgentConversationWorkspace } from './AgentConversationWorkspace';
import type { Conversation } from '@/lib/types';

const conversation = { id: 'conv-1', workspaceId: null } as Conversation;
const workspace = { id: 'ws-1', name: 'Projeto', path: 'C:/Projeto', trusted: true, createdAt: 1, updatedAt: 1 };

describe('AgentConversationWorkspace', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listWorkspaces.mockResolvedValue([workspace]);
    mocks.setConversationWorkspace.mockResolvedValue({ ...conversation, workspaceId: workspace.id });
  });
  afterEach(cleanup);

  it('allows a trusted folder to be bound to this conversation', async () => {
    const onChanged = vi.fn();
    render(<AgentConversationWorkspace conversation={conversation} busy={false} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pasta da conversa' }));
    await screen.findByRole('option', { name: 'Projeto' });
    fireEvent.change(screen.getByLabelText('Pasta desta conversa'), { target: { value: workspace.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar pasta' }));
    await waitFor(() => expect(mocks.setConversationWorkspace).toHaveBeenCalledWith('conv-1', 'ws-1'));
    expect(onChanged).toHaveBeenCalledWith({ ...conversation, workspaceId: workspace.id });
  });

  it('disables changing the folder during a turn', () => {
    render(<AgentConversationWorkspace conversation={conversation} busy onChanged={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Pasta da conversa' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
