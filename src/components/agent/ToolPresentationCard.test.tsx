// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolPresentation } from '@/lib/types';
import {
  PresentationBoundary,
  ToolPresentationCard,
  normalizePlanPresentation,
} from './ToolPresentationCard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ToolPresentationCard — diff e respostas', () => {
  it('renderiza e expande o diff de uma alteração de arquivo', () => {
    const presentation: ToolPresentation = {
      kind: 'file_change',
      path: 'src/app.ts',
      change: 'modified',
      added: 2,
      removed: 1,
      diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,3 @@\n+export const b = 2;\n export const a = 1;\n',
    };
    render(<ToolPresentationCard presentation={presentation} />);
    expect(screen.getByText(/Alterou src\/app\.ts/)).toBeTruthy();
    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.getByText('−1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
  });

  it('usa "Removeu" para arquivo deletado', () => {
    render(
      <ToolPresentationCard
        presentation={{ kind: 'file_change', path: 'a.ts', change: 'deleted', added: 0, removed: 3 }}
      />,
    );
    expect(screen.getByText('Removeu a.ts')).toBeTruthy();
  });

  it('mostra respostas do usuário e o estado "pulada" (você)', () => {
    render(
      <ToolPresentationCard
        presentation={{
          kind: 'answers',
          answers: [{ questionId: 'db', selected: ['SQLite'], custom: null }],
          skipped: false,
        }}
      />,
    );
    expect(screen.getByText('Respostas do usuário')).toBeTruthy();
    expect(screen.getByText('SQLite')).toBeTruthy();

    cleanup();
    render(<ToolPresentationCard presentation={{ kind: 'answers', answers: [], skipped: true }} />);
    expect(screen.getByText(/Você preferiu não responder/)).toBeTruthy();
  });
});

describe('ToolPresentationCard — plano (contrato flat + legado)', () => {
  it('renderiza o payload real aprovado sem crash e só leitura', () => {
    // Payload exato emitido pelo backend (exec.rs) — sem `plan` aninhado.
    const presentation = {
      kind: 'plan',
      state: 'approved',
      markdown: '## Plano\n\n1. Fazer',
    } as ToolPresentation;

    render(<ToolPresentationCard presentation={presentation} />);
    expect(screen.getByText('Plano aprovado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aprovar e executar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ver plano' }));
    expect(screen.getByText('Fazer')).toBeTruthy();
  });

  it('renderiza plano negado antigo (sem markdown) com feedback e sem ações', () => {
    const legacy = {
      kind: 'plan',
      state: 'reviewing',
      feedback: 'Não inclua migrations',
    } as ToolPresentation;

    render(<ToolPresentationCard presentation={legacy} />);
    expect(screen.getByText('Plano devolvido para revisão')).toBeTruthy();
    expect(screen.getByText('Não inclua migrations')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aprovar e executar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continuar planejando' })).toBeNull();
  });

  it('degrada payload de plano inválido (estado desconhecido) sem derrubar', () => {
    const malformed = { kind: 'plan', state: 'aprovadissimo', markdown: 'x' } as unknown as ToolPresentation;
    render(<ToolPresentationCard presentation={malformed} />);
    expect(screen.getByText('Plano indisponível nesta versão.')).toBeTruthy();
  });

  it('normaliza formato legado aninhado ({plan}) sem crash', () => {
    expect(
      normalizePlanPresentation({
        kind: 'plan',
        plan: { state: 'reviewing', markdown: '# P', updatedAt: 42 },
      }),
    ).toEqual({ state: 'reviewing', markdown: '# P', feedback: null, updatedAt: 42 });
  });
});

describe('ToolPresentationCard — tarefas, job, changes e subagente', () => {
  it('renderiza a lista de tarefas válida', () => {
    render(
      <ToolPresentationCard
        presentation={{ kind: 'todos', items: [{ content: 'Rodar testes', status: 'pending' }] }}
      />,
    );
    expect(screen.getByRole('region', { name: 'Tarefas do agente' })).toBeTruthy();
    expect(screen.getByText('Rodar testes')).toBeTruthy();
  });

  it('degrada lista de tarefas malformada', () => {
    const malformed = { kind: 'todos', items: 'nope' } as unknown as ToolPresentation;
    render(<ToolPresentationCard presentation={malformed} />);
    expect(screen.getByText('Não foi possível mostrar esta apresentação.')).toBeTruthy();
  });

  it('degrada job malformado em vez de quebrar a timeline', () => {
    const malformed = { kind: 'job', job: { id: 'x' } } as unknown as ToolPresentation;
    render(<ToolPresentationCard presentation={malformed} />);
    expect(screen.getByText('Não foi possível mostrar esta apresentação.')).toBeTruthy();
  });

  it('resume changes com plural correto', () => {
    render(
      <ToolPresentationCard
        presentation={{ kind: 'changes', files: [], added: 3, removed: 1 }}
      />,
    );
    expect(screen.getByText('0 arquivos alterados')).toBeTruthy();
  });

  it('traduz o tipo do subagente', () => {
    render(
      <ToolPresentationCard
        presentation={{ kind: 'subagent', subagentType: 'review', description: 'Revisar o diff' }}
      />,
    );
    expect(screen.getByText('Subagente de revisão')).toBeTruthy();
  });

  it('não renderiza apresentações informativas desconhecidas', () => {
    const { container } = render(
      <ToolPresentationCard presentation={{ kind: 'output', lines: 10 }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('PresentationBoundary', () => {
  function Bomb(): never {
    throw new Error('render explodiu');
  }

  it('degrada a apresentação que lança em vez de derrubar a árvore', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <PresentationBoundary kind="plan">
        <Bomb />
      </PresentationBoundary>,
    );
    expect(screen.getByText('Plano indisponível nesta versão.')).toBeTruthy();
  });
});
