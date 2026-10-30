// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoalRound, GoalView } from '@/lib/types';
import { GoalCard } from './GoalCard';

function makeGoal(overrides: Partial<GoalView> = {}): GoalView {
  return {
    title: 'Refatorar o pipeline de build',
    objective:
      'Reduzir o tempo de build para menos de 2 minutos, mantendo os testes verdes e o comportamento atual.',
    status: 'active',
    autoContinue: true,
    rounds: 2,
    maxRounds: 25,
    revision: 4,
    origin: 'user',
    createdAt: Date.now() - 600_000,
    updatedAt: Date.now() - 30_000,
    ...overrides,
  };
}

function makeRounds(): GoalRound[] {
  const now = Date.now();
  return [
    {
      index: 1,
      turnId: 'turn-1',
      startedAt: now - 20_000,
      endedAt: now - 15_000,
      outcome: 'done',
      durationMs: 5_000,
      tokens: 600,
      cost: 0.001,
    },
    {
      index: 2,
      turnId: 'turn-2',
      startedAt: now - 10_000,
      endedAt: now - 4_000,
      outcome: 'done',
      durationMs: 6_000,
    },
  ];
}

afterEach(cleanup);

describe('GoalCard — estado ativo', () => {
  it('mostra título, objetivo, badge automático e progresso de rodadas', () => {
    render(<GoalCard goal={makeGoal()} />);

    expect(screen.getByRole('region', { name: 'Refatorar o pipeline de build' })).toBeTruthy();
    expect(screen.getByText('Automático')).toBeTruthy();
    expect(screen.getByText('Rodada 2 de 25')).toBeTruthy();
    expect(screen.getByText(/menos de 2 minutos/)).toBeTruthy();

    const progress = screen.getByRole('progressbar', { name: 'Progresso do objetivo' });
    expect(progress.getAttribute('aria-valuenow')).toBe('2');
    expect(progress.getAttribute('aria-valuemax')).toBe('25');
  });

  it('emite pausar, concluir e editar no modo automático', () => {
    const onAction = vi.fn();
    render(<GoalCard goal={makeGoal()} onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pausar objetivo' }));
    expect(onAction).toHaveBeenLastCalledWith('pause');

    fireEvent.click(screen.getByRole('button', { name: 'Concluir objetivo' }));
    expect(onAction).toHaveBeenLastCalledWith('complete');

    fireEvent.click(screen.getByRole('button', { name: 'Editar objetivo' }));
    expect(onAction).toHaveBeenLastCalledWith('edit');

    expect(screen.queryByRole('button', { name: 'Retomar objetivo' })).toBeNull();
  });

  it('no modo manual oferece ativar continuidade e nova rodada', () => {
    const onAction = vi.fn();
    render(<GoalCard goal={makeGoal({ autoContinue: false })} onAction={onAction} />);

    expect(screen.getByText('Manual')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ativar continuidade' }));
    expect(onAction).toHaveBeenLastCalledWith('arm');

    fireEvent.click(screen.getByRole('button', { name: 'Nova rodada agora' }));
    expect(onAction).toHaveBeenLastCalledWith('start_round');

    expect(screen.queryByRole('button', { name: 'Pausar objetivo' })).toBeNull();
  });

  it('"Abrir objetivo" delega a navegação para onOpen', () => {
    const onOpen = vi.fn();
    render(<GoalCard goal={makeGoal()} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir objetivo' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('GoalCard — pausado', () => {
  it('mostra o motivo e oferece retomar/editar/concluir quando pausado pelo usuário', () => {
    const onAction = vi.fn();
    render(
      <GoalCard
        goal={makeGoal({ status: 'paused', pauseReason: 'user' })}
        onAction={onAction}
      />,
    );

    expect(screen.getByText('Pausado')).toBeTruthy();
    expect(screen.getByText('Pausado por você')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retomar objetivo' }));
    expect(onAction).toHaveBeenLastCalledWith('resume');

    fireEvent.click(screen.getByRole('button', { name: 'Concluir objetivo' }));
    expect(onAction).toHaveBeenLastCalledWith('complete');

    fireEvent.click(screen.getByRole('button', { name: 'Editar objetivo' }));
    expect(onAction).toHaveBeenLastCalledWith('edit');

    expect(screen.queryByRole('button', { name: 'Estender limite de rodadas' })).toBeNull();
  });

  it('no limite de rodadas oferece estender o limite (via edição)', () => {
    const onAction = vi.fn();
    render(
      <GoalCard
        goal={makeGoal({ status: 'paused', pauseReason: 'max_rounds' })}
        onAction={onAction}
      />,
    );

    expect(screen.getByText('Limite de rodadas atingido')).toBeTruthy();
    expect(screen.getByText(/Estenda o limite para continuar/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Estender limite de rodadas' }));
    expect(onAction).toHaveBeenLastCalledWith('edit');

    expect(screen.queryByRole('button', { name: 'Concluir objetivo' })).toBeNull();
  });

  it('mostra o detalhe humano de pausa por erro', () => {
    render(
      <GoalCard
        goal={makeGoal({
          status: 'paused',
          pauseReason: 'error',
          pauseDetail: 'O provedor retornou 500 durante o turno.',
        })}
      />,
    );

    expect(screen.getByText('Pausado após um erro')).toBeTruthy();
    expect(screen.getByText('O provedor retornou 500 durante o turno.')).toBeTruthy();
  });

  it('rodada interrompida orienta a retomar', () => {
    render(
      <GoalCard goal={makeGoal({ status: 'paused', pauseReason: 'interrupted' })} />,
    );

    expect(screen.getByText('Rodada anterior interrompida')).toBeTruthy();
    expect(screen.getByText(/A última rodada foi interrompida/)).toBeTruthy();
  });
});

describe('GoalCard — concluído e bloqueado', () => {
  it('concluído oferece reabrir e não mostra ações de pausa', () => {
    const onAction = vi.fn();
    render(
      <GoalCard
        goal={makeGoal({
          status: 'completed',
          completedAt: Date.now() - 60_000,
          lastNote: 'Build caiu para 92s com os testes verdes.',
        })}
        onAction={onAction}
      />,
    );

    expect(screen.getByText('Concluído')).toBeTruthy();
    expect(screen.getByText(/Build caiu para 92s/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reabrir objetivo' }));
    expect(onAction).toHaveBeenLastCalledWith('reopen');

    expect(screen.queryByRole('button', { name: 'Pausar objetivo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retomar objetivo' })).toBeNull();
  });

  it('bloqueado mostra motivo/streak e oferece retomar/concluir', () => {
    const onAction = vi.fn();
    render(
      <GoalCard
        goal={makeGoal({
          status: 'blocked',
          blockerReason: 'Testes de integração sem rede.',
          blockerStreak: 2,
        })}
        onAction={onAction}
      />,
    );

    expect(screen.getByText('Bloqueado')).toBeTruthy();
    expect(screen.getByText(/Bloqueio registrado \(2 de 3\)/)).toBeTruthy();
    expect(screen.getByText('Testes de integração sem rede.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retomar objetivo' }));
    expect(onAction).toHaveBeenLastCalledWith('resume');

    fireEvent.click(screen.getByRole('button', { name: 'Concluir objetivo' }));
    expect(onAction).toHaveBeenLastCalledWith('complete');
  });
});

describe('GoalCard — somente leitura, ocupado e compacto', () => {
  it('readOnly não renderiza botão nenhum (nem morto)', () => {
    render(<GoalCard goal={makeGoal()} readOnly onAction={vi.fn()} onOpen={vi.fn()} />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('Somente leitura')).toBeTruthy();
    expect(screen.getByText(/menos de 2 minutos/)).toBeTruthy();
  });

  it('sem onAction não renderiza ações (nada de botão morto)', () => {
    render(<GoalCard goal={makeGoal()} />);
    expect(screen.queryByRole('button', { name: 'Pausar objetivo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Concluir objetivo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar objetivo' })).toBeNull();
  });

  it('busy marca aria-busy e desabilita as ações sem emitir nada', () => {
    const onAction = vi.fn();
    render(<GoalCard goal={makeGoal()} onAction={onAction} busy />);

    expect(
      screen.getByRole('region', { name: 'Refatorar o pipeline de build' }).getAttribute('aria-busy'),
    ).toBe('true');

    const pause = screen.getByRole('button', { name: 'Pausar objetivo' }) as HTMLButtonElement;
    expect(pause.disabled).toBe(true);
    fireEvent.click(pause);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('compact resume título, badge, rodada e última nota sem botões nem barra', () => {
    render(
      <GoalCard
        goal={makeGoal({ lastNote: 'Rodada 2: build em 95s.' })}
        compact
        readOnly
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByText('Refatorar o pipeline de build')).toBeTruthy();
    expect(screen.getByText('Automático')).toBeTruthy();
    expect(screen.getByText('Rodada 2 de 25')).toBeTruthy();
    expect(screen.getByText(/build em 95s/)).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('GoalCard — resumo e texto longo', () => {
  it('com rounds resume duração, tokens e custo', () => {
    render(
      <GoalCard
        goal={makeGoal({ tokens: 1_200, cost: 0.0042 })}
        rounds={makeRounds()}
      />,
    );

    expect(screen.getByText(/2 de 25 rodadas/)).toBeTruthy();
    expect(screen.getByText(/1\.2K tokens/)).toBeTruthy();
    expect(screen.getByText(/\$0\.0042/)).toBeTruthy();
    expect(screen.getByText(/11s/)).toBeTruthy();
  });

  it('objetivo enorme quebra palavras em vez de estourar o card', () => {
    const longObjective = Array.from({ length: 250 }, () => 'Objetivo enorme sem espaços').join(' ');
    render(<GoalCard goal={makeGoal({ objective: longObjective })} />);

    const objective = screen.getByText(longObjective);
    expect(objective.className).toContain('break-words');
    expect(objective.className).toContain('line-clamp-3');
  });

  it('título enorme trunca no modo compacto e quebra no completo', () => {
    const longTitle = `Título muito longo ${Array.from({ length: 60 }, () => 'sem fim').join(' ')}`;
    const { unmount } = render(<GoalCard goal={makeGoal({ title: longTitle })} compact />);

    const compactHeading = screen.getByRole('heading', { level: 3 });
    expect(compactHeading.className).toContain('truncate');
    expect(compactHeading.getAttribute('title')).toBe(longTitle);
    unmount();

    render(<GoalCard goal={makeGoal({ title: longTitle })} />);
    const fullHeading = screen.getByRole('heading', { level: 3 });
    expect(fullHeading.className).toContain('break-words');
  });
});
