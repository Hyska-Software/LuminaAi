// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  importAgentAvatarImage: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));
vi.mock('@/lib/api', () => ({ api: { importAgentAvatarImage: mocks.importAgentAvatarImage } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { AgentAvatarPicker } from './AgentAvatarPicker';
import { DEFAULT_AGENT_AVATAR } from '@/lib/agentAvatar';
import type { AgentAvatar } from '@/lib/types';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPicker(value: AgentAvatar = DEFAULT_AGENT_AVATAR) {
  const onChange = vi.fn();
  render(<AgentAvatarPicker value={value} onChange={onChange} />);
  return onChange;
}

describe('AgentAvatarPicker', () => {
  it('troca a cor para vermelho', () => {
    const onChange = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Cor Vermelho' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'mascot', color: 'red' }),
    );
  });

  it('troca o corpo para estrela', () => {
    const onChange = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Corpo Estrela' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ body: 'star' }));
  });

  it('troca a expressão para feliz', () => {
    const onChange = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Expressão Feliz' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ expression: 'happy' }));
  });

  it('troca o formato para quadrado', () => {
    const onChange = renderPicker();
    fireEvent.click(screen.getByRole('radio', { name: 'Quadrado' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ shape: 'square' }));
  });

  it('redefine para o mascote padrão', () => {
    const onChange = renderPicker({
      kind: 'emoji',
      value: '🛠️',
      shape: 'rounded',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Redefinir mascote' }));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_AGENT_AVATAR);
  });

  it('envia uma imagem e força o formato círculo a partir de mascote', async () => {
    mocks.open.mockResolvedValue('C:/avatar.png');
    mocks.importAgentAvatarImage.mockResolvedValue('data:image/png;base64,AAAA');
    const onChange = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /Enviar imagem/ }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        kind: 'image',
        dataUrl: 'data:image/png;base64,AAAA',
        shape: 'circle',
      }),
    );
    expect(mocks.importAgentAvatarImage).toHaveBeenCalledWith('C:/avatar.png');
  });
});
