// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('@/components/layout/hooks', () => ({
  useReduceMotion: () => motion.reduced,
}));

import { AgentActivityDots } from './AgentActivityDots';

afterEach(() => {
  cleanup();
  motion.reduced = false;
});

describe('AgentActivityDots', () => {
  it('renderiza três pontos com status acessível', () => {
    const { container } = render(<AgentActivityDots />);
    const status = screen.getByRole('status', { name: 'Respondendo' });
    expect(status.getAttribute('data-motion')).toBe('animated');
    expect(container.querySelectorAll('.agent-activity-dot')).toHaveLength(3);
  });

  it('aceita um rótulo próprio', () => {
    render(<AgentActivityDots label="Executando" />);
    expect(screen.getByRole('status', { name: 'Executando' })).toBeTruthy();
  });

  it('fica estático com reduceMotion', () => {
    motion.reduced = true;
    const { container } = render(<AgentActivityDots />);
    const status = screen.getByRole('status', { name: 'Respondendo' });
    expect(status.getAttribute('data-motion')).toBe('reduced');
    const dots = Array.from(container.querySelectorAll<HTMLElement>('.agent-activity-dot'));
    expect(dots).toHaveLength(3);
    expect(dots.every((dot) => !dot.style.animationDelay)).toBe(true);
  });
});
