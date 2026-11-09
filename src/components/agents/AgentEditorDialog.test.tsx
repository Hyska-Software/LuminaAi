// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getSkills: vi.fn(),
  listWorkspaces: vi.fn(),
  mcpStatus: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { AUTONOMOUS_MODE_WARNING } from '@/lib/permissionModes';
import { useAppStore, useUiStore } from '@/lib/store';
import { AgentEditorDialog } from './AgentEditorDialog';

const BASIC_ACTIONS = [
  'Busca web',
  'Acesso a arquivos',
  'Executar código',
  'Delegar tarefas',
  'Automações',
  'Memória compartilhada',
  'Escrever skills',
  'Criar agentes',
  'Computer use',
  'Captura de tela',
  'Browser controlado',
  'Override de Docker',
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSkills.mockResolvedValue([]);
  mocks.listWorkspaces.mockResolvedValue([]);
  mocks.mcpStatus.mockResolvedValue({ servers: [] });
  useUiStore.setState({ agentEditor: { mode: 'create' } });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, dockerImage: 'python:3.12' },
  });
});

afterEach(() => {
  cleanup();
  useUiStore.setState({ agentEditor: null });
});

describe('AgentEditorDialog — criação', () => {
  it('abre com todas as ações básicas e os padrões de workspace/permissão', () => {
    render(<AgentEditorDialog />);
    // Radix Tabs activates on pointer/mouse down, not on a bare click.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Capacidades' }));

    for (const label of BASIC_ACTIONS) {
      expect(screen.getByRole('switch', { name: label }).getAttribute('aria-checked')).toBe(
        'true',
      );
    }

    expect((screen.getByLabelText('Pasta de trabalho') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Permissões') as HTMLSelectElement).value).toBe('autonomous');
    expect((screen.getByLabelText('Ambiente de computador') as HTMLSelectElement).value).toBe(
      'auto',
    );

    // The global image is shown as the effective default, without becoming an override.
    const image = screen.getByLabelText('Imagem Docker do agente (opcional)') as HTMLInputElement;
    expect(image.value).toBe('');
    expect(image.placeholder).toBe('python:3.12');
    expect(screen.getByText(/Sem imagem, usa a configuração global \(python:3\.12\)/)).toBeTruthy();
  });

  it('avisa que o modo Autônomo não pede confirmação e esconde o aviso fora dele', () => {
    render(<AgentEditorDialog />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Capacidades' }));

    expect(screen.getByText(AUTONOMOUS_MODE_WARNING)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Permissões'), { target: { value: 'edit' } });

    expect(screen.queryByText(AUTONOMOUS_MODE_WARNING)).toBeNull();
  });
});
