// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Settings } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  saveSettings: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    saveSettings: mocks.saveSettings,
  },
}));

// Imported after the mock above.
import { GeneralTab } from '@/components/settings/GeneralTab';
import { useAppStore, useUiStore } from '@/lib/store';

afterEach(() => cleanup());

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    theme: 'system',
    locale: 'pt-BR',
    defaultProvider: 'opencode-go',
    defaultModel: 'deepseek-v4.1-flash',
    reasoningDefault: 'max',
    systemPrompt: '',
    webSearchEnabled: true,
    fileCreationEnabled: true,
    maxSteps: 64,
    sendKey: 'enter',
    showTokenUsage: true,
    reduceMotion: false,
    thinkingCollapsedByDefault: false,
    fontScale: 1,
    temperature: null,
    includeAttachments: true,
    autoTitle: true,
    codeExecutionEnabled: false,
    codeTimeoutSecs: 120,
    codePythonPath: '',
    codeNodePath: '',
    skillsPanelEnabled: true,
    disabledSkills: [],
    ...overrides,
  };
}

function thinkingSwitch(): HTMLButtonElement {
  return screen.getByRole('switch', {
    name: 'Raciocínio recolhido por padrão',
  }) as HTMLButtonElement;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.saveSettings.mockImplementation(async (next: Settings) => ({
    settings: next,
    keys: [],
  }));
  useAppStore.setState({ settings: settings() });
  useUiStore.setState({ theme: 'light', settingsOpen: true });
});

describe('GeneralTab — raciocínio recolhido por padrão', () => {
  it('mostra o switch desmarcado por padrão na seção Comportamento', () => {
    render(<GeneralTab />);

    expect(screen.getByText('Comportamento')).toBeTruthy();
    expect(screen.getByText('Raciocínio recolhido por padrão')).toBeTruthy();
    expect(
      screen.getByText(/O bloco de raciocínio e passos do agente começa fechado/),
    ).toBeTruthy();
    expect(thinkingSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('salva thinkingCollapsedByDefault: true ao ligar o switch', async () => {
    render(<GeneralTab />);

    fireEvent.click(thinkingSwitch());

    await waitFor(() => {
      expect(mocks.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ thinkingCollapsedByDefault: true }),
      );
    });
    expect(useAppStore.getState().settings.thinkingCollapsedByDefault).toBe(true);
  });

  it('com o setting ativo aparece marcado e clicar salva false', async () => {
    useAppStore.setState({
      settings: settings({ thinkingCollapsedByDefault: true }),
    });

    render(<GeneralTab />);

    expect(thinkingSwitch().getAttribute('aria-checked')).toBe('true');

    fireEvent.click(thinkingSwitch());

    await waitFor(() => {
      expect(mocks.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ thinkingCollapsedByDefault: false }),
      );
    });
    expect(useAppStore.getState().settings.thinkingCollapsedByDefault).toBe(false);
  });
});
