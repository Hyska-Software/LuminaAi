// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { TodoItem } from '@/lib/types';
import { TodoCard } from './TodoCard';

const TODOS: TodoItem[] = [
  { content: 'Ler o código existente', status: 'completed' },
  { content: 'Criar o módulo de tools', status: 'in_progress' },
  { content: 'Rodar os testes', status: 'pending' },
];

afterEach(cleanup);

describe('TodoCard', () => {
  it('renderiza a lista com contadores e rótulos de status acessíveis', () => {
    render(<TodoCard todos={TODOS} />);

    expect(screen.getByRole('region', { name: 'Tarefas do agente' })).toBeTruthy();
    expect(screen.getByText('Tarefas')).toBeTruthy();
    expect(screen.getByText(/1 de 3 concluídas/)).toBeTruthy();
    expect(screen.getByText(/1 em andamento/)).toBeTruthy();

    const list = screen.getByRole('list', { name: 'Lista de tarefas' });
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(list.textContent).toContain('Ler o código existente');
    expect(list.textContent).toContain('Concluída');
    expect(list.textContent).toContain('Em andamento');
    expect(list.textContent).toContain('Pendente');
  });

  it('expõe o progresso na barra acessível', () => {
    render(<TodoCard todos={TODOS} />);
    const progress = screen.getByRole('progressbar');
    expect(progress.getAttribute('aria-valuenow')).toBe('33');
    expect(progress.getAttribute('aria-label')).toBe('Progresso das tarefas: 33%');
  });

  it('não renderiza nada sem tarefas', () => {
    const { container } = render(<TodoCard todos={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('mostra 1 de 1 com o singular correto', () => {
    render(<TodoCard todos={[{ content: 'Único passo', status: 'completed' }]} />);
    expect(screen.getByText(/1 de 1 concluída/)).toBeTruthy();
  });
});
