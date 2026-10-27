// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/lib/api', () => ({ api: {} }));

import { CodeWelcomeScreen } from './CodeWelcomeScreen';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CodeWelcomeScreen — estado vazio do Code', () => {
  it('apresenta o título e o convite para começar uma sessão do agente', () => {
    render(<CodeWelcomeScreen />);

    expect(screen.getByRole('heading', { level: 1, name: 'Comece uma sessão do agente' })).toBeTruthy();
    expect(screen.getByText(/Descreva uma tarefa de código/)).toBeTruthy();
  });

  it('oferece três sugestões de tarefas de código', () => {
    render(<CodeWelcomeScreen />);

    const suggestions = ['Explique o código', 'Encontre um bug', 'Escreva testes'];
    for (const name of suggestions) {
      const button = screen.getByRole('button', { name: new RegExp(name) });
      expect(button).toBeTruthy();
      // Ícone decorativo dentro de cada card.
      expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('preenche o composer pelo evento lumina:suggest sem enviar nada', () => {
    const suggestions: string[] = [];
    const listener = (event: Event) => {
      suggestions.push((event as CustomEvent<string>).detail);
    };
    window.addEventListener('lumina:suggest', listener);
    render(<CodeWelcomeScreen />);

    fireEvent.click(screen.getByRole('button', { name: /Escreva testes/ }));

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toContain('testes');
    expect(suggestions[0]).toContain('casos de borda');
    window.removeEventListener('lumina:suggest', listener);
  });
});
