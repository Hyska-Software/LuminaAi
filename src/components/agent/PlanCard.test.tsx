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

const approveRun = (): HTMLElement => screen.getByRole('button', { name: 'Aprovar e executar' });
const approveReview = (): HTMLElement =>
  screen.getByRole('button', { name: 'Aprovar e revisar cada edição' });

afterEach(cleanup);

describe('PlanCard — gate interativo', () => {
  it('é um alertdialog com título, markdown e as quatro saídas', () => {
    render(<PlanCard plan={makePlan()} onAction={vi.fn()} />);

    const dialog = screen.getByRole('alertdialog', { name: 'Plano proposto' });
    expect(dialog.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByText('Objetivo')).toBeTruthy();
    expect(screen.getByText('Criar o módulo')).toBeTruthy();
    expect(approveRun()).toBeTruthy();
    expect(approveReview()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continuar planejando' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Executar como Objetivo/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Editar plano antes de aprovar/ })).toBeNull();
  });

  it('foca o botão primário ao montar o gate', () => {
    render(<PlanCard plan={makePlan()} onAction={vi.fn()} />);
    expect(document.activeElement).toBe(approveRun());
  });

  it('devolve as ações de aprovação', () => {
    const onAction = vi.fn();
    render(<PlanCard plan={makePlan()} onAction={onAction} />);

    fireEvent.click(approveRun());
    expect(onAction).toHaveBeenLastCalledWith('approve_run');

    fireEvent.click(approveReview());
    expect(onAction).toHaveBeenLastCalledWith('approve_review');

    fireEvent.click(screen.getByRole('button', { name: /Executar como Objetivo/ }));
    expect(onAction).toHaveBeenLastCalledWith('approve_goal');
  });

  it('"continuar planejando" envia feedback livre (ou vazio)', () => {
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

  it('Esc devolve o plano para o agente continuar planejando', () => {
    const onAction = vi.fn();
    render(<PlanCard plan={makePlan()} onAction={onAction} />);

    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onAction).toHaveBeenCalledWith('keep_planning');
  });

  it('Esc fecha o feedback aberto sem decidir', () => {
    const onAction = vi.fn();
    render(<PlanCard plan={makePlan()} onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continuar planejando' }));
    expect(screen.getByLabelText('O que ajustar no plano? (opcional)')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });

    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('O que ajustar no plano? (opcional)')).toBeNull();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
});

describe('PlanCard — executar como objetivo', () => {
  it('desabilita o CTA e explica quando já existe objetivo na sessão', () => {
    const reason =
      'Esta sessão já tem um objetivo ativo. Conclua ou encerre o objetivo atual antes de executar o plano como objetivo.';
    render(<PlanCard plan={makePlan()} onAction={vi.fn()} goalBlockedReason={reason} />);

    const button = screen.getByRole('button', {
      name: /Executar como Objetivo/,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText(reason)).toBeTruthy();
  });
});

describe('PlanCard — busy e somente leitura', () => {
  it('busy desabilita as ações, marca aria-busy e não emite ação', () => {
    const onAction = vi.fn();
    render(<PlanCard plan={makePlan()} onAction={onAction} busy />);

    expect(screen.getByRole('alertdialog').getAttribute('aria-busy')).toBe('true');
    for (const button of [
      approveRun(),
      approveReview(),
      screen.getByRole('button', { name: 'Continuar planejando' }),
      screen.getByRole('button', { name: /Executar como Objetivo/ }),
    ]) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.click(approveRun());
    expect(onAction).not.toHaveBeenCalled();
  });

  it('readOnly não mostra botões de ação e exibe feedback persistido', () => {
    render(
      <PlanCard
        plan={makePlan({ state: 'reviewing', feedback: 'Inclua testes de erro' })}
        readOnly
      />,
    );

    expect(screen.queryByRole('button', { name: 'Aprovar e executar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continuar planejando' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Executar como Objetivo/ })).toBeNull();
    expect(screen.getByText('Somente leitura')).toBeTruthy();
    expect(screen.getByText('Plano devolvido para revisão')).toBeTruthy();
    expect(screen.getByText('Feedback anterior')).toBeTruthy();
    expect(screen.getByText('Inclua testes de erro')).toBeTruthy();
  });

  it('readOnly recolhe plano longo atrás de "Ver plano completo"', () => {
    const long = `## Plano\n\n${'Linha de plano. '.repeat(200)}`;
    render(<PlanCard plan={makePlan({ markdown: long })} readOnly />);

    const toggle = screen.getByRole('button', { name: 'Ver plano completo' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Recolher plano' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });
});

describe('PlanCard — estados sem ação', () => {
  it('estado approved fica compacto e "Ver plano" expande o Markdown', () => {
    render(<PlanCard plan={makePlan({ state: 'approved' })} readOnly />);

    expect(screen.getByText('Plano aprovado')).toBeTruthy();
    expect(screen.queryByText('Objetivo')).toBeNull();

    const toggle = screen.getByRole('button', { name: 'Ver plano' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Objetivo')).toBeTruthy();
  });

  it('com onViewPlan, "Ver plano" delega para a aba central em vez de expandir', () => {
    const onViewPlan = vi.fn();
    render(
      <PlanCard plan={makePlan({ state: 'approved' })} readOnly onViewPlan={onViewPlan} />,
    );

    const button = screen.getByRole('button', { name: 'Ver plano' });
    // A ação abre outra superfície: não é um toggle inline.
    expect(button.getAttribute('aria-expanded')).toBeNull();
    fireEvent.click(button);

    expect(onViewPlan).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'approved', markdown: expect.stringContaining('Objetivo') }),
    );
    expect(screen.queryByText('Objetivo')).toBeNull();
  });

  it('estado planning mostra progresso, feedback persistido e nenhuma ação', () => {
    render(
      <PlanCard
        plan={makePlan({ state: 'planning', markdown: null, feedback: 'Sem mexer em migrations' })}
        readOnly
      />,
    );

    expect(screen.getByText('Plano em preparação')).toBeTruthy();
    expect(screen.getByLabelText('Planejando')).toBeTruthy();
    expect(screen.getByText('Sem mexer em migrations')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aprovar e executar' })).toBeNull();
  });

  it('plano nulo degrada para uma linha em vez de quebrar', () => {
    render(<PlanCard plan={null} />);
    expect(screen.getByRole('status').textContent).toContain('Plano indisponível nesta versão.');
  });

  it('não renderiza nada quando o plano está inativo e vazio', () => {
    const { container } = render(<PlanCard plan={{ state: 'inactive', markdown: null, updatedAt: 1 }} />);
    expect(container.firstChild).toBeNull();
  });
});
