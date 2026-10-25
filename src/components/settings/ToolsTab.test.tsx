// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CodeEnvironmentStatus, Settings } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  saveSettings: vi.fn(),
  getCodeEnvironment: vi.fn(),
  openSkillsDir: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    saveSettings: mocks.saveSettings,
    getCodeEnvironment: mocks.getCodeEnvironment,
    openSkillsDir: mocks.openSkillsDir,
  },
}));

// Imported after the mock above.
import { ToolsTab } from '@/components/settings/ToolsTab';
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

function codeEnvironment(overrides: Partial<CodeEnvironmentStatus> = {}): CodeEnvironmentStatus {
  return {
    enabled: true,
    python: { path: 'C:\\Python312\\python.exe', version: '3.12.4', source: 'path' },
    node: {
      path: 'C:\\Program Files\\nodejs\\node.exe',
      version: 'v24.20.0',
      source: 'settings',
    },
    packages: [
      { name: 'python-docx', available: true },
      { name: 'openpyxl', available: false },
    ],
    installHint: 'pip install python-docx openpyxl',
    skills: [
      {
        name: 'office-docx',
        description: 'Criar documentos Word (.docx) com script Python stdlib.',
        source: 'bundled',
        enabled: true,
        deletable: false,
      },
      {
        name: 'relatorios',
        description: 'Padrão da empresa para relatórios internos.',
        source: 'user',
        enabled: false,
        deletable: true,
      },
      {
        name: 'git-helper',
        description: 'Fluxo de revisão de código do repositório compartilhado.',
        source: 'agents',
        enabled: true,
        deletable: false,
      },
    ],
    ...overrides,
  };
}

function maxStepsSlider(): HTMLInputElement {
  return screen.getByLabelText('Máximo de passos do agente') as HTMLInputElement;
}

function timeoutSlider(): HTMLInputElement {
  return screen.getByLabelText('Tempo limite de execução') as HTMLInputElement;
}

function codeSwitch(): HTMLButtonElement {
  return screen.getByRole('switch', { name: 'Ativar execução de código' }) as HTMLButtonElement;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.saveSettings.mockImplementation(async (next: Settings) => ({
    settings: next,
    keys: [],
  }));
  // Keep the environment pending by default: tab tests that do not care about
  // it must not get asynchronous state updates.
  mocks.getCodeEnvironment.mockReturnValue(new Promise(() => undefined));
  mocks.openSkillsDir.mockResolvedValue(undefined);
  useAppStore.setState({ settings: settings() });
  useUiStore.setState({ activeView: 'chat', settingsOpen: false });
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

describe('ToolsTab — execução de código', () => {
  it('mostra o aviso de risco e liga a execução de código', async () => {
    render(<ToolsTab />);

    expect(screen.getByText(/não é um sandbox de sistema/)).toBeTruthy();
    expect(codeSwitch().getAttribute('aria-checked')).toBe('false');

    fireEvent.click(codeSwitch());

    await waitFor(() => {
      expect(mocks.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ codeExecutionEnabled: true }),
      );
    });
    expect(useAppStore.getState().settings.codeExecutionEnabled).toBe(true);
  });

  it('salva o tempo limite de execução ao soltar o slider', async () => {
    render(<ToolsTab />);

    const slider = timeoutSlider();
    expect(slider.value).toBe('120');
    expect(slider.min).toBe('10');
    expect(slider.max).toBe('600');
    expect(slider.step).toBe('10');
    expect(screen.getByText(/após 120 segundos/)).toBeTruthy();

    fireEvent.change(slider, { target: { value: '300' } });
    fireEvent.pointerUp(slider);

    await waitFor(() => {
      expect(mocks.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ codeTimeoutSecs: 300 }),
      );
    });
    expect(useAppStore.getState().settings.codeTimeoutSecs).toBe(300);
    expect(screen.getByText(/após 300 segundos/)).toBeTruthy();
  });
});

describe('ToolsTab — ambiente de código', () => {
  it('mostra o carregamento enquanto verifica o ambiente', () => {
    render(<ToolsTab />);

    expect(screen.getByText('Verificando ambiente…')).toBeTruthy();
  });

  it('lista interpretadores, pacotes, instalação e skills', async () => {
    mocks.getCodeEnvironment.mockResolvedValue(codeEnvironment());

    render(<ToolsTab />);

    expect(await screen.findByText('3.12.4 · detectado no PATH')).toBeTruthy();
    expect(screen.getByText('C:\\Python312\\python.exe')).toBeTruthy();
    expect(screen.getByText('v24.20.0 · caminho configurado')).toBeTruthy();
    expect(screen.getByText('python-docx')).toBeTruthy();
    expect(screen.getByText('openpyxl')).toBeTruthy();
    expect(screen.getByText('pip install python-docx openpyxl')).toBeTruthy();
    // Skills: contagem total e por origem (incluindo externas) + rótulos.
    expect(screen.getByText('3 skills')).toBeTruthy();
    expect(screen.getByText('1 do Lumina')).toBeTruthy();
    expect(screen.getByText('1 externa')).toBeTruthy();
    expect(screen.getByText('1 embutida')).toBeTruthy();
    expect(screen.getByText('office-docx')).toBeTruthy();
    expect(screen.getByText(/Criar documentos Word/)).toBeTruthy();
    expect(screen.getByText('relatorios')).toBeTruthy();
    expect(screen.getByText(/Padrão da empresa/)).toBeTruthy();
    expect(screen.getByText('git-helper')).toBeTruthy();
    expect(screen.getByText(/Fluxo de revisão/)).toBeTruthy();
    expect(screen.getByText('Agentes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir pasta de skills' })).toBeTruthy();
  });

  it('recarrega o ambiente ao clicar em verificar novamente', async () => {
    mocks.getCodeEnvironment.mockResolvedValue(codeEnvironment());

    render(<ToolsTab />);
    expect(await screen.findByText('3.12.4 · detectado no PATH')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Verificar novamente' }));

    await waitFor(() => expect(mocks.getCodeEnvironment).toHaveBeenCalledTimes(2));
  });

  it('mostra o erro e permite verificar novamente', async () => {
    mocks.getCodeEnvironment
      .mockRejectedValueOnce(new Error('comando indisponível'))
      .mockResolvedValueOnce(codeEnvironment());

    render(<ToolsTab />);

    expect(await screen.findByText('Não foi possível verificar o ambiente')).toBeTruthy();
    expect(screen.getByText('comando indisponível')).toBeTruthy();
    expect(screen.getByText(/Não foi possível carregar as skills/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Verificar novamente' }));

    expect(await screen.findByText('3.12.4 · detectado no PATH')).toBeTruthy();
    expect(mocks.getCodeEnvironment).toHaveBeenCalledTimes(2);
  });

  it('mostra estados vazios quando nada é detectado', async () => {
    mocks.getCodeEnvironment.mockResolvedValue(
      codeEnvironment({ python: null, node: null, packages: [], installHint: '', skills: [] }),
    );

    render(<ToolsTab />);

    expect(await screen.findByText('Nenhuma skill encontrada.')).toBeTruthy();
    expect(screen.getByText('0 skills')).toBeTruthy();
    expect(screen.queryByText(/externa/)).toBeNull();
    expect(screen.getByText('Nenhum pacote opcional verificado.')).toBeTruthy();
    expect(screen.getAllByText('Não encontrado')).toHaveLength(2);
  });

  it('abre a pasta de skills', async () => {
    mocks.getCodeEnvironment.mockResolvedValue(codeEnvironment());

    render(<ToolsTab />);
    await screen.findByText('3.12.4 · detectado no PATH');

    fireEvent.click(screen.getByRole('button', { name: 'Abrir pasta de skills' }));

    await waitFor(() => expect(mocks.openSkillsDir).toHaveBeenCalledTimes(1));
  });
});

describe('ToolsTab — painel de skills', () => {
  it('salva a preferência do painel de skills na barra lateral', async () => {
    render(<ToolsTab />);

    const toggle = screen.getByRole('switch', {
      name: 'Mostrar painel de skills na barra lateral',
    });
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ skillsPanelEnabled: false }),
      );
    });
    expect(useAppStore.getState().settings.skillsPanelEnabled).toBe(false);
  });

  it('leva ao gerenciamento de skills como view principal e fecha as configurações', async () => {
    mocks.getCodeEnvironment.mockResolvedValue(codeEnvironment());
    useUiStore.setState({ activeView: 'chat', settingsOpen: true });

    render(<ToolsTab />);
    await screen.findByText('3.12.4 · detectado no PATH');

    fireEvent.click(screen.getByRole('button', { name: 'Gerenciar skills' }));

    expect(useUiStore.getState().activeView).toBe('skills');
    expect(useUiStore.getState().settingsOpen).toBe(false);
  });

  it('marca as skills desativadas na lista', async () => {
    mocks.getCodeEnvironment.mockResolvedValue(codeEnvironment());

    render(<ToolsTab />);

    expect(await screen.findByText('Desativada')).toBeTruthy();
    expect(screen.getAllByText('Desativada')).toHaveLength(1);
  });
});
