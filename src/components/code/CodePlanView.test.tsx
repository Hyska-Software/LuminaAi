// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CodePlanTab } from '@/lib/store';
import { CodePlanView } from './CodePlanView';

function planTab(overrides: Partial<CodePlanTab> = {}): CodePlanTab {
  return {
    conversationId: 'c-1',
    markdown: '# Plano de correção\n\n- Ajustar o cálculo de juros\n- Rodar os testes',
    title: 'Plano',
    updatedAt: 1,
    ...overrides,
  };
}

afterEach(cleanup);

describe('CodePlanView — plano aprovado como aba central', () => {
  it('renderiza o Markdown como documento (mesma prévia de um .md da filetree)', () => {
    render(<CodePlanView tab={planTab()} />);

    expect(screen.getByRole('heading', { name: 'Plano de correção' })).toBeTruthy();
    expect(screen.getByText('Ajustar o cálculo de juros')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Código' })).toBeTruthy();
  });

  it('alterna para o código-fonte do plano', () => {
    render(<CodePlanView tab={planTab()} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Código' }));

    expect(screen.queryByRole('heading', { name: 'Plano de correção' })).toBeNull();
    expect(screen.getByText('Ajustar o cálculo de juros')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Documento' }));
    expect(screen.getByRole('heading', { name: 'Plano de correção' })).toBeTruthy();
  });
});
