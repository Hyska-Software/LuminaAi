// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  listActiveComputerSessions: vi.fn(),
  stopComputerSession: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AgentComputerControl } from './AgentComputerControl';

const session = {
  id: 'session-1',
  agentId: 'agent-1',
  conversationId: 'conv-1',
  backend: 'local',
  status: 'active',
  startedAt: 1,
  endedAt: null,
};

describe('AgentComputerControl', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listActiveComputerSessions.mockResolvedValue([session]);
    mocks.stopComputerSession.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it('shows the active computer session and stops only this conversation', async () => {
    render(<AgentComputerControl conversationId="conv-1" />);

    const status = await screen.findByRole('group', { name: 'Computer use ativo' });
    expect(status.textContent).toContain('Controlando');
    fireEvent.click(screen.getByRole('button', { name: 'Parar computer use' }));

    await waitFor(() => expect(mocks.stopComputerSession).toHaveBeenCalledWith('conv-1'));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Computer use ativo' })).toBeNull());
    expect(mocks.stopComputerSession).toHaveBeenCalledTimes(1);
  });

  it('does not show a session that belongs to another conversation', async () => {
    mocks.listActiveComputerSessions.mockResolvedValue([
      { ...session, id: 'session-2', conversationId: 'conv-2' },
    ]);

    render(<AgentComputerControl conversationId="conv-1" />);

    await waitFor(() => expect(mocks.listActiveComputerSessions).toHaveBeenCalled());
    expect(screen.queryByRole('group', { name: 'Computer use ativo' })).toBeNull();
    expect(mocks.stopComputerSession).not.toHaveBeenCalled();
  });
});
