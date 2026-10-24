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
import { ToolsTab } from '@/components/settings/ToolsTab';
import { useAppStore } from '@/lib/store';

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
    fontScale: 1,
    temperature: null,
    includeAttachments: true,
    autoTitle: true,
    ...overrides,
  };
}

function maxStepsSlider(): HTMLInputElement {
  return screen.getByLabelText('Máximo de passos do agente') as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveSettings.mockImplementation(async (next: Settings) => ({
    settings: next,
    keys: [],
  }));
  useAppStore.setState({ settings: settings() });
});

describe('ToolsTab — máximo de passos', () => {
  it('começa em 64 passos', () => {
    render(<ToolsTab />);

    expect(maxStepsSlider().value).toBe('64');
    expect(screen.getByText(/até 64 passos/)).toBeTruthy();
  });

  it('permite escolher até 1000 passos', () => {
    render(<ToolsTab />);

    expect(maxStepsSlider().min).toBe('1');
    expect(maxStepsSlider().max).toBe('1000');
  });

  it('salva 1000 passos ao levar o slider ao máximo', async () => {
    render(<ToolsTab />);

    const slider = maxStepsSlider();
    fireEvent.change(slider, { target: { value: '1000' } });
    fireEvent.pointerUp(slider);

    await waitFor(() => {
      expect(mocks.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ maxSteps: 1000 }),
      );
    });
    expect(useAppStore.getState().settings.maxSteps).toBe(1000);
    expect(screen.getByText(/até 1000 passos/)).toBeTruthy();
  });
});
