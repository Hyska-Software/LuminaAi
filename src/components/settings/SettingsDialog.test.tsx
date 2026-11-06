// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api', () => ({
  api: {
    openDataDir: vi.fn(),
    resetAppData: vi.fn(),
    getCodeEnvironment: vi.fn().mockResolvedValue(null),
  },
}));

import { SettingsDialog } from './SettingsDialog';
import { useUiStore } from '@/lib/store';

function tab(name: string): HTMLElement {
  return screen.getByRole('tab', { name });
}

beforeEach(() => {
  useUiStore.setState({ settingsOpen: true, settingsTab: 'data' });
});

afterEach(() => {
  cleanup();
});

describe('SettingsDialog — aba controlada pelo uiStore (deep-link da paleta)', () => {
  it('opens on the tab requested by the store', () => {
    render(<SettingsDialog />);

    expect(tab('Dados').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Pasta de dados')).not.toBeNull();
  });

  it('follows external tab changes (paleta abrindo em Configurações › Ferramentas)', () => {
    render(<SettingsDialog />);

    act(() => {
      useUiStore.getState().setSettingsTab('tools');
    });

    expect(tab('Ferramentas').getAttribute('aria-selected')).toBe('true');
  });

  it('writes the selected tab back to the store', async () => {
    const user = userEvent.setup();
    render(<SettingsDialog />);

    await user.click(tab('Sobre'));

    expect(useUiStore.getState().settingsTab).toBe('about');
  });

  it('opens the Agentes tab with the agent settings sections', async () => {
    const user = userEvent.setup();
    render(<SettingsDialog />);

    await user.click(tab('Agentes'));

    expect(useUiStore.getState().settingsTab).toBe('agents');
    expect(await screen.findByText('Desktop privado (computer use)')).not.toBeNull();
  });
});
