// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoalView } from '@/lib/types';
import { GoalAttentionCard } from './GoalAttentionCard';

function makeGoal(overrides: Partial<GoalView> = {}): GoalView {
  return {
    title: 'Refatorar o pipeline de build',
    objective: 'Reduzir o tempo de build para menos de 2 minutos.',
    status: 'paused',
    autoContinue: true,
    rounds: 2,
    maxRounds: 25,
    revision: 7,
    origin: 'user',
    createdAt: Date.now() - 600_000,
    updatedAt: Date.now() - 30_000,
    lastRoundAt: Date.now() - 40_000,
    tokens: 3_400,
    cost: 0.012,
    ...overrides,
  };
}

afterEach(cleanup);

describe('GoalAttentionCard — pausado', () => {
  it('renderiza como status com motivo, detalhe, resumo e ações', () => {
    const onResume = vi.fn();
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(
      <GoalAttentionCard
        goal={makeGoal({
          pauseReason: 'error',
          pauseDetail: 'O provedor retornou 500 durante o turno.',
        })}
        onResume={onResume}
        onOpen={onOpen}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByRole('status', { name: 'Objetivo pausado' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Pausado após um erro')).toBeTruthy();
    expect(screen.getByText('O provedor retornou 500 durante o turno.')).toBeTruthy();
    expect(screen.getByText(/2 de 25 rodadas/)).toBeTruthy();
    expect(screen.getByText(/3\.4K tokens/)).toBeTruthy();
    expect(screen.getByText(/\$0\.01/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retomar objetivo' }));
    expect(onResume).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir objetivo' }));
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Dispensar' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('no limite de rodadas oferece estender o limite', () => {
    const onExtend = vi.fn();
    render(
      <GoalAttentionCard
        goal={makeGoal({ pauseReason: 'max_rounds' })}
        onResume={vi.fn()}
        onExtend={onExtend}
      />,
    );

    expect(screen.getByText('Limite de rodadas atingido')).toBeTruthy();
    expect(screen.getByText(/Estenda o limite para continuar/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Estender limite' }));
    expect(onExtend).toHaveBeenCalledTimes(1);
  });

  it('estol e rodada interrompida têm microcopy própria', () => {
    const { unmount } = render(
      <GoalAttentionCard goal={makeGoal({ pauseReason: 'stalled' })} onResume={vi.fn()} />,
    );
    expect(screen.getByText(/Sem progresso em 3 rodadas/)).toBeTruthy();
    unmount();

    render(<GoalAttentionCard goal={makeGoal({ pauseReason: 'interrupted' })} onResume={vi.fn()} />);
    expect(screen.getByText(/A última rodada foi interrompida/)).toBeTruthy();
  });

  it('pausado por você não vira card de atenção', () => {
    const { container } = render(
      <GoalAttentionCard goal={makeGoal({ pauseReason: 'user' })} onResume={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('pausado por erro não oferece concluir (só retomar/estender/abrir)', () => {
    render(
      <GoalAttentionCard
        goal={makeGoal({ pauseReason: 'error' })}
        onResume={vi.fn()}
        onComplete={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Concluir objetivo' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retomar objetivo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir objetivo' })).toBeTruthy();
  });
});

describe('GoalAttentionCard — bloqueado', () => {
  it('usa role alert, mostra motivo/streak e oferece retomar/concluir', () => {
    const onResume = vi.fn();
    const onComplete = vi.fn();
    const onOpen = vi.fn();
    render(
      <GoalAttentionCard
        goal={makeGoal({
          status: 'blocked',
          pauseReason: 'user',
          blockerReason: 'Faltam credenciais de produção para validar o fluxo.',
          blockerStreak: 2,
        })}
        onResume={onResume}
        onComplete={onComplete}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByRole('alert', { name: 'Objetivo bloqueado' })).toBeTruthy();
    expect(screen.getByText('Faltam credenciais de produção para validar o fluxo.')).toBeTruthy();
    expect(screen.getByText(/Bloqueio registrado \(2 de 3\)/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retomar objetivo' }));
    expect(onResume).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Concluir objetivo' }));
    expect(onComplete).toHaveBeenCalledTimes(1);

    expect(screen.queryByRole('button', { name: 'Estender limite' })).toBeNull();
  });
});

describe('GoalAttentionCard — concluído', () => {
  it('mostra resumo e as ações de reabrir/abrir/dispensar', () => {
    const onOpen = vi.fn();
    const onReopen = vi.fn();
    const onDismiss = vi.fn();
    render(
      <GoalAttentionCard
        goal={makeGoal({
          status: 'completed',
          pauseReason: null,
          completedAt: Date.now() - 60_000,
          rounds: 4,
        })}
        onResume={vi.fn()}
        onComplete={vi.fn()}
        onReopen={onReopen}
        onOpen={onOpen}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByRole('status', { name: 'Objetivo concluído' })).toBeTruthy();
    expect(screen.getByText('Concluído')).toBeTruthy();
    expect(screen.getByText(/4 de 25 rodadas/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retomar objetivo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Concluir objetivo' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reabrir objetivo' }));
    expect(onReopen).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir objetivo' }));
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Dispensar' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('não mostra "Reabrir objetivo" sem handler (sem botão morto)', () => {
    render(<GoalAttentionCard goal={makeGoal({ status: 'completed' })} onOpen={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Reabrir objetivo' })).toBeNull();
  });
});

describe('GoalAttentionCard — robustez', () => {
  it('não renderiza para objetivo ativo', () => {
    const { container } = render(
      <GoalAttentionCard goal={makeGoal({ status: 'active' })} onResume={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('busy marca aria-busy e desabilita as ações sem emitir nada', () => {
    const onResume = vi.fn();
    const onDismiss = vi.fn();
    render(
      <GoalAttentionCard
        goal={makeGoal({ pauseReason: 'error' })}
        onResume={onResume}
        onDismiss={onDismiss}
        busy
      />,
    );

    expect(
      screen.getByRole('status', { name: 'Objetivo pausado' }).getAttribute('aria-busy'),
    ).toBe('true');

    const resume = screen.getByRole('button', { name: 'Retomar objetivo' }) as HTMLButtonElement;
    expect(resume.disabled).toBe(true);
    fireEvent.click(resume);
    expect(onResume).not.toHaveBeenCalled();

    const dismiss = screen.getByRole('button', { name: 'Dispensar' }) as HTMLButtonElement;
    expect(dismiss.disabled).toBe(true);
    fireEvent.click(dismiss);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('sem handlers não mostra botões mortos', () => {
    render(<GoalAttentionCard goal={makeGoal({ pauseReason: 'error' })} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('detalhe longo quebra palavras em vez de estourar o card', () => {
    const longDetail = Array.from({ length: 300 }, () => 'Detalhe sem espaços').join(' ');
    render(
      <GoalAttentionCard
        goal={makeGoal({ pauseReason: 'error', pauseDetail: longDetail })}
        onResume={vi.fn()}
      />,
    );

    expect(screen.getByText(longDetail).className).toContain('break-words');
  });
});
