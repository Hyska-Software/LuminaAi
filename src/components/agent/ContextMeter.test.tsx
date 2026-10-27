// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ContextStats } from '@/lib/types';
import { ContextMeter } from './ContextMeter';

function makeStats(overrides: Partial<ContextStats> = {}): ContextStats {
  return {
    used: 62_400,
    window: 80_000,
    outputCap: 8_000,
    percent: 78,
    messages: 42,
    ...overrides,
  };
}

afterEach(cleanup);

describe('ContextMeter', () => {
  it('expõe percentual, tokens e rótulo da faixa', () => {
    render(<ContextMeter stats={makeStats()} />);

    const bar = screen.getByRole('progressbar', { name: 'Contexto usado' });
    expect(bar.getAttribute('aria-valuenow')).toBe('78');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuetext')).toBe('78% do contexto usado — atenção');
    expect(screen.getByText(/^78%/).textContent).toContain('atenção');
    expect(bar.getAttribute('title')).toBe('Limite de saída: 8.0K tokens');
  });

  it('marca a faixa ok abaixo de 70%', () => {
    render(<ContextMeter stats={makeStats({ percent: 42, used: 33_600 })} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuetext')).toBe('42% do contexto usado — ok');
  });

  it('marca compactando acima de 90%', () => {
    render(<ContextMeter stats={makeStats({ percent: 94 })} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuetext')).toBe('94% do contexto usado — compactando');
  });

  it('mostra o aviso de compactação com o número de mensagens', () => {
    render(<ContextMeter stats={makeStats({ percent: 96, compacted: 42 })} />);
    expect(screen.getByRole('status').textContent).toBe(
      'Contexto compactado · 42 mensagens resumidas',
    );
  });

  it('usa o prop compacted quando o host o informa', () => {
    render(<ContextMeter stats={makeStats({ percent: 96, compacted: undefined })} compacted={7} />);
    expect(screen.getByRole('status').textContent).toContain('7 mensagens');
  });

  it('não mostra aviso de compactação sem compactação', () => {
    render(<ContextMeter stats={makeStats({ compacted: 0 })} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('clampa percentuais fora da faixa', () => {
    const { rerender } = render(<ContextMeter stats={makeStats({ percent: 140 })} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');

    rerender(<ContextMeter stats={makeStats({ percent: -10 })} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });
});
