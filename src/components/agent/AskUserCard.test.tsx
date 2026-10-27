// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AskUserQuestion } from './AskUserCard';
import { AskUserCard } from './AskUserCard';

const SINGLE: AskUserQuestion[] = [
  {
    id: 'q1',
    question: 'Qual gerenciador de pacotes usar?',
    options: [
      { label: 'pnpm', description: 'Lockfile único no workspace', recommended: true },
      { label: 'npm' },
    ],
  },
];

afterEach(cleanup);

describe('AskUserCard', () => {
  it('renderiza pergunta, opções (com a recomendada) e desabilita o envio vazio', () => {
    render(<AskUserCard questions={SINGLE} onSubmit={vi.fn()} onSkip={vi.fn()} />);

    expect(screen.getByText('Qual gerenciador de pacotes usar?')).toBeTruthy();
    expect(screen.getByText('Recomendada')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /pnpm/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'npm' })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Enviar resposta' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('devolve a resposta single com a opção marcada', () => {
    const onSubmit = vi.fn();
    render(<AskUserCard questions={SINGLE} onSubmit={onSubmit} onSkip={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: /pnpm/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const answers = onSubmit.mock.calls[0][0] as Array<{
      questionId: string;
      selected: string[];
      freeText?: string;
    }>;
    expect(answers).toHaveLength(1);
    expect(answers[0].questionId).toBe('q1');
    expect(answers[0].selected).toEqual(['pnpm']);
    expect(answers[0].freeText).toBeUndefined();
  });

  it('aceita múltiplas opções e texto livre quando multi', () => {
    const onSubmit = vi.fn();
    render(
      <AskUserCard
        questions={[
          {
            id: 'q2',
            question: 'Quais arquivos incluir?',
            multi: true,
            options: [{ label: 'src/a.ts' }, { label: 'src/b.ts' }],
          },
        ]}
        onSubmit={onSubmit}
        onSkip={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'src/a.ts' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'src/b.ts' }));
    fireEvent.change(screen.getByLabelText('Outra resposta (opcional)'), {
      target: { value: 'e o AGENTS.md' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }));

    expect(onSubmit.mock.calls[0][0]).toEqual([
      { questionId: 'q2', selected: ['src/a.ts', 'src/b.ts'], freeText: 'e o AGENTS.md' },
    ]);
  });

  it('permite responder só com texto livre e esconde o campo quando desabilitado', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <AskUserCard questions={SINGLE} onSubmit={onSubmit} onSkip={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText('Outra resposta (opcional)'), {
      target: { value: 'bun' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }));
    expect(onSubmit).toHaveBeenCalledWith([
      { questionId: 'q1', selected: [], freeText: 'bun' },
    ]);

    rerender(
      <AskUserCard
        questions={[{ ...SINGLE[0], allowFreeText: false }]}
        onSubmit={onSubmit}
        onSkip={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Outra resposta (opcional)')).toBeNull();
  });

  it('ignorar e continuar chama onSkip sem enviar resposta', () => {
    const onSubmit = vi.fn();
    const onSkip = vi.fn();
    render(<AskUserCard questions={SINGLE} onSubmit={onSubmit} onSkip={onSkip} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ignorar e continuar' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('não renderiza nada sem perguntas', () => {
    const { container } = render(
      <AskUserCard questions={[]} onSubmit={vi.fn()} onSkip={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
