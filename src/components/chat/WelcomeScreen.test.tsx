// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WelcomeScreen } from './WelcomeScreen';

afterEach(() => cleanup());

describe('WelcomeScreen', () => {
  it('menciona OpenAI e o uso do plano ChatGPT na copy (não só OpenCode)', () => {
    render(<WelcomeScreen />);

    expect(screen.getByRole('heading', { name: 'Como posso ajudar?' })).toBeTruthy();
    const copy = screen.getByText(/modelos OpenCode e OpenAI/);
    expect(copy.textContent).toMatch(/plano ChatGPT/i);
    expect(screen.queryByText(/OpenCode Go e Zen/)).toBeNull();
  });

  it('mantém as sugestões e o rodapé de atalhos', () => {
    render(<WelcomeScreen />);

    expect(screen.getByRole('button', { name: /Pesquisar na web/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Analisar documento/ })).toBeTruthy();
    expect(screen.getByText('Comandos')).toBeTruthy();
    expect(screen.getByText('Enviar')).toBeTruthy();
  });
});
