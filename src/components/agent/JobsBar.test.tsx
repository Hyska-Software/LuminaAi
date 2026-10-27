// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { JobView } from '@/lib/types';
import { JobsBar } from './JobsBar';

function makeJob(overrides: Partial<JobView> = {}): JobView {
  return {
    id: 'job-1',
    command: 'npm run dev',
    status: 'running',
    startedAt: Date.now() - 65_000,
    durationMs: 65_000,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('JobsBar', () => {
  it('lista jobs com status, comando, tempo e contador de rodando', () => {
    render(
      <JobsBar
        jobs={[
          makeJob(),
          makeJob({ id: 'job-2', command: 'cargo watch', status: 'done', exitCode: 0, durationMs: 12_000 }),
        ]}
        onKill={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByRole('region', { name: 'Trabalhos em segundo plano' })).toBeTruthy();
    expect(screen.getByText('npm run dev')).toBeTruthy();
    expect(screen.getByText('cargo watch')).toBeTruthy();
    expect(screen.getByText('1 rodando')).toBeTruthy();
    expect(screen.getByText('exit 0')).toBeTruthy();
    expect(screen.getByText('1m 5s')).toBeTruthy();
  });

  it('para um job em execução e ignora jobs finalizados', () => {
    const onKill = vi.fn();
    render(
      <JobsBar
        jobs={[makeJob(), makeJob({ id: 'job-2', command: 'npm run lint', status: 'done' })]}
        onKill={onKill}
        onOpen={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Parar job: npm run dev' }));
    expect(onKill).toHaveBeenCalledWith('job-1');
    expect(screen.queryByRole('button', { name: 'Parar job: npm run lint' })).toBeNull();
  });

  it('abre um job via "ver"', () => {
    const onOpen = vi.fn();
    const job = makeJob({ status: 'failed', exitCode: 1 });
    render(<JobsBar jobs={[job]} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ver job: npm run dev' }));
    expect(onOpen).toHaveBeenCalledWith(job);
  });

  it('recolhe e expande a lista', () => {
    render(<JobsBar jobs={[makeJob()]} onKill={vi.fn()} />);

    const toggle = screen.getByRole('button', { name: /Trabalhos em segundo plano/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('list', { name: 'Jobs em segundo plano' })).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: 'Jobs em segundo plano' })).toBeNull();
  });

  it('não renderiza nada sem jobs', () => {
    const { container } = render(<JobsBar jobs={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('mostra todos os jobs e ações apenas quando os handlers existem', () => {
    render(<JobsBar jobs={[makeJob()]} />);
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Parar job/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Ver job/ })).toBeNull();
  });
});
