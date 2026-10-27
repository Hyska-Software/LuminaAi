// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TurnFooter } from './TurnFooter';

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TurnFooter', () => {
  it('resume duração, tokens, arquivos e contadores de linhas', () => {
    render(<TurnFooter durationMs={269_000} tokens={38_200} files={2} added={42} removed={7} />);

    expect(
      screen.getByText('Trabalhou por 4m 29s · 38K tokens · 2 arquivos · +42 −7'),
    ).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Fim do turno' })).toBeTruthy();
  });

  it('usa singular para 1 arquivo e esconde tokens ausentes', () => {
    render(<TurnFooter durationMs={1200} files={1} added={1} removed={0} />);
    expect(screen.getByText('Trabalhou por 1.2s · 1 arquivo · +1 −0')).toBeTruthy();
  });

  it('mostra as ações opcionais e as dispara', () => {
    const onOpenChanges = vi.fn();
    const onRevert = vi.fn();
    render(
      <TurnFooter
        durationMs={1000}
        onOpenChanges={onOpenChanges}
        onRevert={onRevert}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ver alterações' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reverter turno' }));
    expect(onOpenChanges).toHaveBeenCalledTimes(1);
    expect(onRevert).toHaveBeenCalledTimes(1);
  });

  it('esconde as ações quando o host não passa handlers', () => {
    render(<TurnFooter durationMs={1000} />);
    expect(screen.queryByRole('button', { name: 'Ver alterações' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reverter turno' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copiar resumo' })).toBeTruthy();
  });

  it('copia o resumo e anuncia o sucesso', async () => {
    render(<TurnFooter durationMs={269_000} tokens={38_200} files={2} added={42} removed={7} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copiar resumo' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'Trabalhou por 4m 29s · 38K tokens · 2 arquivos · +42 −7',
      ),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resumo copiado' })).toBeTruthy());
    expect(screen.getByText('Resumo do turno copiado')).toBeTruthy();
  });

  it('não quebra quando a área de transferência falha', async () => {
    writeText.mockRejectedValue(new Error('sem permissão'));
    render(<TurnFooter durationMs={1000} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copiar resumo' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Copiar resumo' })).toBeTruthy();
  });
});
