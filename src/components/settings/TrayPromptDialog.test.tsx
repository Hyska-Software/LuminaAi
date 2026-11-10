// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Settings } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  saveSettings: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { saveSettings: mocks.saveSettings },
}));

import { TrayPromptDialog } from './TrayPromptDialog';
import { useAppStore } from '@/lib/store';

function currentSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...useAppStore.getState().settings,
    closeToTray: true,
    closeToTrayPrompted: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.saveSettings.mockImplementation(async (next: Settings) => ({
    settings: next,
    keys: [],
  }));
  useAppStore.setState({ ready: true, settings: currentSettings() });
});

afterEach(() => cleanup());

describe('TrayPromptDialog', () => {
  it('asks on first run and persists the background choice', async () => {
    render(<TrayPromptDialog />);

    expect(screen.getByText('Manter o Zylara rodando em segundo plano?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar em segundo plano' }));

    await waitFor(() => {
      expect(mocks.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ closeToTray: true, closeToTrayPrompted: true }),
      );
    });
    expect(useAppStore.getState().settings.closeToTrayPrompted).toBe(true);
  });

  it('persists the quit-on-close choice', async () => {
    render(<TrayPromptDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Encerrar ao fechar a janela' }));

    await waitFor(() => {
      expect(mocks.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ closeToTray: false, closeToTrayPrompted: true }),
      );
    });
    expect(useAppStore.getState().settings.closeToTray).toBe(false);
  });

  it('does not render after the choice was saved', () => {
    useAppStore.setState({
      settings: currentSettings({ closeToTrayPrompted: true }),
    });

    render(<TrayPromptDialog />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
