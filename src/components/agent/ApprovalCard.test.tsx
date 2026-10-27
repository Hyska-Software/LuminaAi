// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApprovalRequest } from '@/lib/types';
import { ApprovalCard } from './ApprovalCard';

function makeApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'apr-1',
    toolCallId: 'call-1',
    tool: 'run_command',
    title: 'Executar comando?',
    detail: { kind: 'command', command: 'npm test -- --run', workdir: 'lumina-core' },
    risk: 'shell',
    preview: null,
    options: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ApprovalCard', () => {
  it('renderiza o comando com cwd, badge de risco e nome acessível', () => {
    render(<ApprovalCard approval={makeApproval()} onDecide={vi.fn()} />);

    const dialog = screen.getByRole('alertdialog', { name: 'Executar comando?' });
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText(/^cwd:/)).toBeTruthy();
    expect(within(dialog).getByText('lumina-core')).toBeTruthy();
    expect(within(dialog).getByLabelText(/Comando a executar/).textContent).toBe(
      'npm test -- --run',
    );
    expect(within(dialog).getByText('Comando')).toBeTruthy();
    expect(within(dialog).getByText('run_command')).toBeTruthy();
  });

  it('anuncia o pedido em região aria-live assertiva', () => {
    const { container } = render(
      <ApprovalCard approval={makeApproval()} onDecide={vi.fn()} />,
    );
    const live = container.querySelector('[aria-live="assertive"]');
    expect(live?.textContent).toContain('Aprovação necessária');
    expect(live?.textContent).toContain('Comando');
  });

  it('foca o botão primário no mount e permite aprovar', () => {
    const onDecide = vi.fn();
    render(<ApprovalCard approval={makeApproval()} onDecide={onDecide} />);

    const primary = screen.getByRole('button', { name: 'Permitir' });
    expect(document.activeElement).toBe(primary);

    fireEvent.click(primary);
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide.mock.calls[0][0]).toBe('approved');
    // Estado resolvido otimista: some com as ações.
    expect(screen.queryByRole('button', { name: 'Permitir' })).toBeNull();
    expect(screen.getByText('Permitido')).toBeTruthy();
  });

  it('Esc nega o pedido sem motivo', () => {
    const onDecide = vi.fn();
    render(<ApprovalCard approval={makeApproval()} onDecide={onDecide} />);

    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onDecide).toHaveBeenCalledWith('denied', undefined);
    expect(screen.getByText('Negado')).toBeTruthy();
  });

  it('negar abre o motivo opcional e devolve o texto', () => {
    const onDecide = vi.fn();
    render(<ApprovalCard approval={makeApproval()} onDecide={onDecide} />);

    fireEvent.click(screen.getByRole('button', { name: 'Negar' }));
    const reason = screen.getByLabelText('Motivo da negação (opcional)');
    fireEvent.change(reason, { target: { value: 'use pnpm em vez de npm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Negar' }));

    expect(onDecide).toHaveBeenCalledWith('denied', { feedback: 'use pnpm em vez de npm' });
    expect(screen.getByText('Negado: “use pnpm em vez de npm”')).toBeTruthy();
  });

  it('Esc com o campo de motivo aberto apenas cancela a negação', () => {
    const onDecide = vi.fn();
    render(<ApprovalCard approval={makeApproval()} onDecide={onDecide} />);

    fireEvent.click(screen.getByRole('button', { name: 'Negar' }));
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });

    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Permitir' })).toBeTruthy();
  });

  it('"sempre permitir" oferece os três escopos e devolve o escopo escolhido', async () => {
    const onDecide = vi.fn();
    render(
      <ApprovalCard
        approval={makeApproval({
          options: [
            { id: 'allow', label: 'Permitir' },
            { id: 'allow-session', label: 'Nesta sessão', scope: 'session' },
            { id: 'allow-workspace', label: 'Neste workspace', scope: 'workspace' },
            { id: 'allow-global', label: 'Sempre', scope: 'global' },
          ],
        })}
        onDecide={onDecide}
        savedScope="workspace"
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Sempre permitir/ }));

    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Regra salva: neste workspace')).toBeTruthy();
    await user.click(within(menu).getByRole('menuitem', { name: 'Nesta sessão' }));

    expect(onDecide).toHaveBeenCalledWith('approved', {
      scope: 'session',
      optionId: 'allow-session',
    });
  });

  it('mostra paths com diff resumido e limite de arquivos listados', () => {
    const paths = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts'];
    render(
      <ApprovalCard
        approval={makeApproval({
          tool: 'write_file',
          title: 'Gravar alteração?',
          risk: 'write',
          detail: { kind: 'paths', paths, change: 'Modificar 6 arquivos' },
          preview: '--- a/src/a.ts\n+++ b/src/a.ts\n-um\n+dois',
        })}
        onDecide={vi.fn()}
      />,
    );

    expect(screen.getByText('src/a.ts')).toBeTruthy();
    expect(screen.queryByText('src/f.ts')).toBeNull();
    expect(screen.getByText('+1 outro(s) arquivo(s)')).toBeTruthy();
    expect(screen.getByLabelText('Prévia das alterações').textContent).toContain('-um');
    expect(screen.getByText('Escrita')).toBeTruthy();
  });

  it('renderiza variantes de segredo e path externo', () => {
    const { rerender } = render(
      <ApprovalCard
        approval={makeApproval({
          title: 'Ler arquivo de segredo?',
          risk: 'secret',
          detail: { kind: 'secret', path: '.env.local' },
        })}
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByText('.env.local')).toBeTruthy();
    expect(screen.getByText('O conteúdo deste arquivo não é mostrado ao agente.')).toBeTruthy();

    rerender(
      <ApprovalCard
        approval={makeApproval({
          title: 'Ler arquivo fora do projeto?',
          risk: 'outside',
          detail: { kind: 'outside', path: 'C:\\Users\\dev\\notes.txt' },
        })}
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByText('C:\\Users\\dev\\notes.txt')).toBeTruthy();
    expect(screen.getByText('O caminho fica fora do workspace. Permitir acesso?')).toBeTruthy();
    expect(screen.getByText('Fora do projeto')).toBeTruthy();
  });

  it('desabilita as ações enquanto o host aguarda o backend', () => {
    render(<ApprovalCard approval={makeApproval()} onDecide={vi.fn()} responding />);

    expect(screen.getByRole('alertdialog').getAttribute('aria-busy')).toBe('true');
    const primary = screen.getByRole('button', { name: 'Permitir' });
    expect((primary as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Negar' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: /Sempre permitir/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('renderiza a linha compacta quando o host já resolveu o pedido', () => {
    const { rerender } = render(
      <ApprovalCard
        approval={makeApproval()}
        onDecide={vi.fn()}
        resolution={{ decision: 'approved', scope: 'workspace' }}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Permitido · neste workspace');
    expect(screen.queryByRole('alertdialog')).toBeNull();

    rerender(
      <ApprovalCard
        approval={makeApproval()}
        onDecide={vi.fn()}
        resolution={{ decision: 'expired' }}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Expirado');
  });
});
