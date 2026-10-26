// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(async () => true),
}));

vi.mock('./external', () => ({ openExternalUrl: mocks.openExternalUrl }));

// Imported after the mock above.
import { TurnErrorBanner } from './TurnErrorBanner';
import {
  AUTH_REQUIRED_TITLE,
  CHATGPT_USAGE_URL,
  PLAN_LIMIT_TITLE,
  PLAN_NOT_ELIGIBLE_BODY,
  PLAN_NOT_ELIGIBLE_TITLE,
} from './turnError';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TurnErrorBanner', () => {
  it('mostra o limite atingido com "Gerenciar uso" abrindo o dashboard externo', () => {
    const onOpenProviders = vi.fn();
    render(
      <TurnErrorBanner
        code="subscription_sharing_usage_limit_exceeded"
        onOpenProviders={onOpenProviders}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(PLAN_LIMIT_TITLE)).toBeTruthy();
    expect(within(alert).getByText(/pode ser do plano ou deste app/i)).toBeTruthy();

    fireEvent.click(within(alert).getByRole('button', { name: 'Gerenciar uso' }));

    expect(mocks.openExternalUrl).toHaveBeenCalledWith(CHATGPT_USAGE_URL);
    expect(onOpenProviders).not.toHaveBeenCalled();
    // Sem retry: repetir o request não é o caminho quando a cota foi atingida.
    expect(within(alert).queryByRole('button', { name: /tentar novamente/i })).toBeNull();
    // Nunca inventa medidor/percentual (a API não expõe cota restante).
    expect(within(alert).queryByText(/%/)).toBeNull();
  });

  it('não duplica o título quando o hint do backend já começa com ele', () => {
    render(
      <TurnErrorBanner
        code="subscription_sharing_usage_limit_exceeded"
        hint='Limite de uso atingido — pode ser do plano ou deste app. Use "Gerenciar uso".'
        onOpenProviders={vi.fn()}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(within(alert).getAllByText(/limite de uso atingido/i)).toHaveLength(1);
    expect(within(alert).getByText(/pode ser do plano ou deste app/i)).toBeTruthy();
  });

  it('trata rate_limited como limite só quando o provedor ativo usa o plano', () => {
    const { rerender } = render(
      <TurnErrorBanner code="rate_limited" onOpenProviders={vi.fn()} />,
    );
    expect(screen.queryByRole('alert')).toBeNull();

    rerender(<TurnErrorBanner code="rate_limited" planProvider onOpenProviders={vi.fn()} />);
    expect(screen.getByText(PLAN_LIMIT_TITLE)).toBeTruthy();
  });

  it('mostra credencial necessária com CTA para Provedores (auth_required)', () => {
    const onOpenProviders = vi.fn();
    render(
      <TurnErrorBanner
        code="auth_required"
        hint="Entre novamente com o ChatGPT para renovar sua sessão."
        onOpenProviders={onOpenProviders}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(AUTH_REQUIRED_TITLE)).toBeTruthy();
    expect(
      within(alert).getByText('Entre novamente com o ChatGPT para renovar sua sessão.'),
    ).toBeTruthy();

    fireEvent.click(within(alert).getByRole('button', { name: 'Abrir Provedores' }));
    expect(onOpenProviders).toHaveBeenCalledTimes(1);
    expect(within(alert).queryByRole('button', { name: /gerenciar uso/i })).toBeNull();
  });

  it('mostra inelegível sem botão de retry', () => {
    render(
      <TurnErrorBanner
        code="subscription_sharing_user_not_eligible"
        onOpenProviders={vi.fn()}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(PLAN_NOT_ELIGIBLE_TITLE)).toBeTruthy();
    expect(within(alert).getByText(PLAN_NOT_ELIGIBLE_BODY)).toBeTruthy();
    expect(within(alert).queryByRole('button', { name: /tentar novamente/i })).toBeNull();
    expect(within(alert).queryByRole('button', { name: /gerenciar uso/i })).toBeNull();
  });

  it('não renderiza nada para erros fora do escopo (capability, rota)', () => {
    const { container } = render(
      <TurnErrorBanner code="unsupported_capability" onOpenProviders={vi.fn()} />,
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('pode ser dispensado e reaparece para um novo erro', () => {
    const { rerender } = render(
      <TurnErrorBanner code="auth_required" onOpenProviders={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dispensar aviso' }));
    expect(screen.queryByRole('alert')).toBeNull();

    // Outro código ⇒ outra assinatura ⇒ o banner volta.
    rerender(
      <TurnErrorBanner
        code="subscription_sharing_usage_limit_exceeded"
        onOpenProviders={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('respeita um usageUrl customizado (ex.: consoleUrl do catálogo)', () => {
    render(
      <TurnErrorBanner
        code="subscription_sharing_usage_limit_exceeded"
        usageUrl="https://example.com/usage"
        onOpenProviders={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Gerenciar uso' }));
    expect(mocks.openExternalUrl).toHaveBeenCalledWith('https://example.com/usage');
  });
});
