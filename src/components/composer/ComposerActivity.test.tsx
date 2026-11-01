// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposerActivity } from './ComposerActivity';

function activity(): HTMLElement {
  return screen.getByTestId('composer-activity');
}

function orbit(): SVGSVGElement {
  return screen.getByTestId('composer-orbit') as unknown as SVGSVGElement;
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 320,
    height: 120,
    top: 0,
    left: 0,
    right: 320,
    bottom: 120,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ComposerActivity', () => {
  it('fica invisível e parado fora de uma execução', async () => {
    render(<ComposerActivity active={false} reduceMotion={false} />);

    const ring = activity();
    await screen.findByTestId('composer-orbit');
    expect(ring.getAttribute('data-active')).toBe('false');
    expect(ring.className).toContain('opacity-0');
    expect(orbit().getAttribute('viewBox')).toBe('0 0 320 120');
    expect(orbit().querySelectorAll('rect')).toHaveLength(3);
    expect(orbit().getAttribute('class')).toContain('composer-orbit-animate');
    expect(orbit().getAttribute('class')).toContain('composer-orbit-paused');
  });

  it('cobre o perímetro inteiro e orbita durante a execução', async () => {
    render(<ComposerActivity active reduceMotion={false} />);

    const ring = activity();
    await screen.findByTestId('composer-orbit');
    expect(ring.getAttribute('data-active')).toBe('true');
    expect(ring.className).toContain('opacity-100');
    expect(orbit().getAttribute('class')).toContain('composer-orbit-animate');
    expect(orbit().getAttribute('class')).not.toContain('composer-orbit-paused');
  });

  it('mantém o traço estático quando a redução de movimento está ligada', async () => {
    render(<ComposerActivity active reduceMotion />);

    await screen.findByTestId('composer-orbit');
    expect(activity().getAttribute('data-motion')).toBe('reduced');
    expect(orbit().getAttribute('class')).not.toContain('composer-orbit-animate');
    expect(orbit().querySelectorAll('rect')).toHaveLength(3);
  });
});
