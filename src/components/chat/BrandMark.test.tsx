// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { BrandMark } from './BrandMark';

afterEach(() => cleanup());

function mark(): HTMLImageElement {
  const img = document.querySelector('img');
  expect(img).not.toBeNull();
  return img as HTMLImageElement;
}

describe('BrandMark', () => {
  it('usa o símbolo sem fundo por padrão, preservando a proporção da arte', () => {
    render(<BrandMark size={24} />);
    const img = mark();

    expect(img.getAttribute('src')).toBe('/brand/lumina-mark.svg');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('aria-hidden')).toBe('true');
    expect(img.getAttribute('draggable')).toBe('false');
    expect(img.style.height).toBe('24px');
    // Largura automática: o SVG carrega a proporção da arte (1164×1058).
    expect(img.style.width).toBe('auto');
  });

  it('usa o ícone oficial completo quando a variante é tile', () => {
    render(<BrandMark variant="tile" size={40} />);
    const img = mark();

    expect(img.getAttribute('src')).toBe('/brand/lumina-tile.svg');
    expect(img.style.width).toBe('40px');
    expect(img.style.height).toBe('40px');
  });

  it('anima apenas quando animated está ligado', () => {
    const { rerender } = render(<BrandMark />);
    expect(mark().className).not.toContain('animate-pulse-soft');

    rerender(<BrandMark animated />);
    expect(mark().className).toContain('animate-pulse-soft');
  });

  it('mantém a altura pedida em qualquer variante', () => {
    render(
      <>
        <BrandMark size={22} />
        <BrandMark variant="tile" size={72} />
      </>,
    );
    const [symbol, tile] = Array.from(document.querySelectorAll('img'));
    expect(symbol.style.height).toBe('22px');
    expect(tile.style.height).toBe('72px');
  });
});
