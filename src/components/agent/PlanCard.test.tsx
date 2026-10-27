// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PlanView } from '@/lib/types';
import { PlanCard } from './PlanCard';

function makePlan(overrides: Partial<PlanView> = {}): PlanView {
  return {
    state: 'reviewing',
    markdown: '## Objetivo\n\n1. Criar o módulo\n2. Rodar os testes',
    updatedAt: Date.now(),
    ...overrides,
  };
}

afterEach(cleanup);

describe('PlanCard', () => {
  it('renderiza o Markdown e as três ações do gate de aprovação', () => {
    render(<PlanCard plan={makePlan()} onAction={vi.fn()} />);

    expect(screen.getByText('Plano proposto')).toBeTruthy();
    expect(screen.getByText('Aguardando aprovação')).toBeTruthy();
    expect(screen.getByText('Objetivo')).toBeTruthy();
    expect(screen.getByText('Criar o módulo')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aprovar e executar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aprovar e revisar cada edição' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continuar planejando' })).toBeTruthy();
  });

  it('devolve as ações de aprovação', () => {
    const onAction = vi.fn();
    render(<PlanCard plan={makePlan()} onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar e executar' }));
    expect(onAction).toHaveBeenLastCalledWith('approve_run');

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar e revisar cada edição' }));
    expect(onAction).toHaveBeenLastCalledWith('approve_review');
  });

  it('"continuar planejando" abre feedback livre e envia o texto', () => {
    const onAction = vi.fn();
    render(<PlanCard plan={makePlan()} onAction={onAction} />);

    const keepPlanning = screen.getByRole('button', { name: 'Continuar planejando' });
    expect(keepPlanning.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(keepPlanning);
    expect(keepPlanning.getAttribute('aria-expanded')).toBe('true');

    const feedback = screen.getByLabelText('O que ajustar no plano? (opcional)');
    fireEvent.change(feedback, { target: { value: 'Inclua testes de erro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar feedback' }));

    expect(onAction).toHaveBeenCalledWith('keep_planning', 'Inclua testes de erro');
  });

  it('envia keep_planning sem feedback quando o campo está vazio', () => {
    const onAction = vi.fn();
    render(<PlanCard plan={makePlan()} onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continuar planejando' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar feedback' }));

    expect(onAction).toHaveBeenCalledWith('keep_planning', undefined);
  });

  it('estado aprovado fica compacto e "ver plano" expande o Markdown', () => {
    render(<PlanCard plan={makePlan({ state: 'approved' })} onAction={vi.fn()} />);

    expect(screen.getByText('Plano aprovado')).toBeTruthy();
    expect(screen.queryByText('Objetivo')).toBeNull();

    const toggle = screen.getByRole('button', { name: 'Ver plano' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Objetivo')).toBeTruthy();
  });

  it('estado planning mostra progresso e nenhuma ação', () => {
    render(<PlanCard plan={makePlan({ state: 'planning' })} onAction={vi.fn()} />);

    expect(screen.getByText('Plano em preparação')).toBeTruthy();
    expect(screen.getByLabelText('Planejando')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aprovar e executar' })).toBeNull();
  });

  it('não renderiza nada quando o plano está inativo e vazio', () => {
    const { container } = render(
      <PlanCard plan={{ state: 'inactive', markdown: null, updatedAt: Date.now() }} onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
