// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useUiStore } from '@/lib/store';
import { AgentPanelButton, AgentPanelOpener } from './AgentPanelToggle';

beforeEach(() => {
  useUiStore.setState({
    layoutMode: 'agent',
    agentPanelOpen: false,
    agentRightPanel: 'agent',
  });
});

afterEach(() => cleanup());

describe('AgentPanelToggle', () => {
  it('reopens the agent panel from a surface without a header', () => {
    render(<AgentPanelOpener />);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir painel do agente' }));

    expect(useUiStore.getState().agentPanelOpen).toBe(true);
    expect(useUiStore.getState().agentRightPanel).toBe('agent');
    expect(screen.queryByRole('button', { name: 'Abrir painel do agente' })).toBeNull();
  });

  it('switches the dock back to the agent panel when the workspace owned it', () => {
    useUiStore.setState({ agentPanelOpen: false, agentRightPanel: 'workspace' });
    render(<AgentPanelOpener />);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir painel do agente' }));

    expect(useUiStore.getState().agentPanelOpen).toBe(true);
    expect(useUiStore.getState().agentRightPanel).toBe('agent');
  });

  it('closes the panel from a header button', () => {
    useUiStore.setState({ agentPanelOpen: true });
    render(<AgentPanelButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Recolher painel do agente' }));

    expect(useUiStore.getState().agentPanelOpen).toBe(false);
  });
});
