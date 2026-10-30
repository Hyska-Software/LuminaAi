// @vitest-environment jsdom
/**
 * Badge do modo Plano dentro do campo de mensagem do composer: pill accent com
 * o ícone `ListChecks` + o rótulo escrito "Plano" (pedido de produto atual; na
 * versão anterior era só o ícone). O clique desativa o modo.
 *
 * Cobre: ausência com o modo desligado/sem snapshot, rótulo visível, desativação
 * pelo `codeStore` (otimista com rollback) e o estado pendente do IPC do clique.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CodeSessionState } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  setPlanMode: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

// Imported after the mocks above.
import { toast } from 'sonner';
import { emptyCodeSession, useCodeStore } from '@/lib/store';
import { PlanModeChip } from './PlanModeChip';

const CONVERSATION_ID = 'c-1';
const BADGE_NAME = 'Desativar modo Plano';

function sessionState(overrides: Partial<CodeSessionState> = {}): CodeSessionState {
  return {
    conversationId: CONVERSATION_ID,
    permissionMode: 'edit',
    planMode: false,
    todos: [],
    jobs: [],
    approvals: [],
    ...overrides,
  };
}

function seedPlanMode(planMode: boolean): void {
  useCodeStore.setState({
    byConversation: {
      [CONVERSATION_ID]: { ...emptyCodeSession(CONVERSATION_ID), planMode },
    },
  });
}

const badge = (): HTMLElement => screen.getByRole('button', { name: BADGE_NAME });

beforeEach(() => {
  vi.clearAllMocks();
  useCodeStore.setState({ byConversation: {} });
  mocks.setPlanMode.mockResolvedValue(sessionState({ planMode: false }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PlanModeChip — visibilidade', () => {
  it('não renderiza nada quando o modo Plano está desativado', () => {
    seedPlanMode(false);
    const { container } = render(<PlanModeChip conversationId={CONVERSATION_ID} />);

    expect(screen.queryByRole('button', { name: BADGE_NAME })).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('não renderiza nada enquanto o snapshot da sessão não chegou no codeStore', () => {
    render(<PlanModeChip conversationId={CONVERSATION_ID} />);

    expect(screen.queryByRole('button', { name: BADGE_NAME })).toBeNull();
  });
});

describe('PlanModeChip — badge com ícone e rótulo', () => {
  it('mostra um botão acessível com o rótulo escrito "Plano"', () => {
    seedPlanMode(true);
    render(<PlanModeChip conversationId={CONVERSATION_ID} />);

    const chip = badge();
    expect(chip.textContent?.trim()).toBe('Plano');
    expect(within(chip).getByText('Plano')).toBeTruthy();
    expect(chip.getAttribute('type')).toBe('button');
    expect(chip.getAttribute('aria-label')).toBe(BADGE_NAME);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    // F-20: nada de `title` nativo duplicado com o Tooltip.
    expect(chip.getAttribute('title')).toBeNull();
  });

  it('clique desativa o modo Plano no store (IPC com false) e o badge some', async () => {
    seedPlanMode(true);
    render(<PlanModeChip conversationId={CONVERSATION_ID} />);

    fireEvent.click(badge());

    await waitFor(() => expect(mocks.setPlanMode).toHaveBeenCalledWith(CONVERSATION_ID, false));
    await waitFor(() => expect(screen.queryByRole('button', { name: BADGE_NAME })).toBeNull());
    expect(useCodeStore.getState().byConversation[CONVERSATION_ID]?.planMode).toBe(false);
  });

  it('volta a aparecer quando o backend falha (rollback e toast do store)', async () => {
    seedPlanMode(true);
    mocks.setPlanMode.mockRejectedValue(new Error('negado'));
    render(<PlanModeChip conversationId={CONVERSATION_ID} />);

    fireEvent.click(badge());

    await waitFor(() => expect(badge()).toBeTruthy());
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Não foi possível alterar o modo Plano',
        expect.objectContaining({ description: 'Error: negado' }),
      ),
    );
    expect(badge().getAttribute('aria-pressed')).toBe('true');
  });
});

describe('PlanModeChip — IPC pendente', () => {
  it('desabilita o badge enquanto a desativação está em andamento', async () => {
    seedPlanMode(true);
    // Simula o IPC em voo sem aplicar snapshot: o badge continua montado,
    // porém desabilitado, para não disparar um segundo clique.
    vi.spyOn(useCodeStore.getState(), 'setPlanMode').mockImplementation(
      () => new Promise<boolean>(() => {}),
    );
    render(<PlanModeChip conversationId={CONVERSATION_ID} />);

    fireEvent.click(badge());

    await waitFor(() => expect((badge() as HTMLButtonElement).disabled).toBe(true));
  });
});
