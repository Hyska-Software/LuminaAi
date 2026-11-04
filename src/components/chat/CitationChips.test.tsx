// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Citation } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(async () => true),
}));

vi.mock('./external', () => ({ openExternalUrl: mocks.openExternalUrl }));

// Imported after the mock above.
import { useUiStore } from '@/lib/store';
import { CitationChips } from './CitationChips';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  useUiStore.setState({ sourcesPanelOpen: false, artifactPanelOpen: false });
});

function citation(index: number, overrides: Partial<Citation> = {}): Citation {
  return {
    id: `cit-${index}`,
    title: `Resultado ${index}`,
    url: `https://site${index}.com/noticia-${index}`,
    siteName: `site${index}.com`,
    ...overrides,
  };
}

function citations(count: number): Citation[] {
  return Array.from({ length: count }, (_, index) => citation(index + 1));
}

describe('CitationChips', () => {
  it('mostra até dois chips e nenhum botão de painel quando as fontes cabem', () => {
    render(<CitationChips citations={citations(2)} />);

    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('site1.com')).toBeTruthy();
    expect(screen.getByText('site2.com')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /painel lateral/ })).toBeNull();
  });

  it('limita os chips a dois e move o excedente para o painel lateral', () => {
    render(<CitationChips citations={citations(11)} />);

    // 2 chips + o botão do painel.
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByText('site2.com')).toBeTruthy();
    expect(screen.queryByText('site3.com')).toBeNull();
    expect(screen.queryByText('site11.com')).toBeNull();

    const panelButton = screen.getByRole('button', { name: 'Abrir 9 fontes no painel lateral' });
    expect(panelButton.textContent).toContain('9 fontes');

    fireEvent.click(panelButton);
    expect(useUiStore.getState().sourcesPanelOpen).toBe(true);
    expect(useUiStore.getState().artifactPanelOpen).toBe(false);
  });

  it('usa o singular no rótulo quando sobra uma fonte', () => {
    render(<CitationChips citations={citations(3)} />);

    const panelButton = screen.getByRole('button', { name: 'Abrir 1 fonte no painel lateral' });
    expect(panelButton.textContent).toContain('1 fonte');
  });

  it('deduplica fontes pela URL antes de cortar os chips', () => {
    const duplicated = [
      ...citations(3),
      citation(4, { url: 'https://site1.com/noticia-1' }),
      citation(5, { url: 'https://site2.com/noticia-2' }),
    ];

    render(<CitationChips citations={duplicated} />);

    // 3 únicas após o dedupe: os 2 primeiros chips visíveis + botão com a que sobrou.
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByText('site2.com')).toBeTruthy();
    expect(screen.queryByText('site3.com')).toBeNull();
    expect(screen.queryByText('site4.com')).toBeNull();
    expect(screen.getByRole('button', { name: 'Abrir 1 fonte no painel lateral' })).toBeTruthy();
  });

  it('abre a fonte no navegador ao clicar num chip', () => {
    render(<CitationChips citations={[citation(1), citation(2)]} />);

    const chip = screen.getByRole('button', { name: /site1\.com/ });
    expect(chip.getAttribute('title')).toBe('Resultado 1');

    fireEvent.click(chip);
    expect(mocks.openExternalUrl).toHaveBeenCalledWith('https://site1.com/noticia-1');
  });

  it('não renderiza nada sem fontes', () => {
    const { container } = render(<CitationChips citations={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
