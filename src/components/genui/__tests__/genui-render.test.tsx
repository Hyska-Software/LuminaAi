// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { GENUI_ICONS, GENUI_TYPES, parseGenUI, type GenUISpec } from '@/lib/genui';
import { GenUIBlock } from '../GenUIBlock';
import { GenUIRenderer } from '../GenUIRenderer';
import { GENUI_ICON_MAP, genUIIcon } from '../icons';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => cleanup());

/** Monta um bloco ```ui a partir de componentes já em JSON. */
function renderBlock(components: unknown[]) {
  const source = JSON.stringify({ version: 2, components });
  return { source, ...render(<GenUIBlock source={source} />) };
}

/* ------------------------------------------------------------------ */
/* Primitivas base                                                     */
/* ------------------------------------------------------------------ */

describe('renderização das primitivas', () => {
  it('renderiza card com grid de stats, chart e tabela', () => {
    renderBlock([
      {
        type: 'card',
        props: { title: 'Receita do trimestre', subtitle: 'Consolidado por canal' },
        children: [
          {
            type: 'grid',
            props: { columns: 2 },
            children: [
              { type: 'stat', props: { label: 'Receita total', value: 'R$ 12,4 mi', trend: 'up' } },
              { type: 'stat', props: { label: 'Churn', value: '3,1%', trend: 'down' } },
            ],
          },
          {
            type: 'chart',
            props: {
              type: 'bar',
              title: 'Receita mensal',
              data: [
                { label: 'Jul', value: 3.8 },
                { label: 'Ago', value: 4.1 },
              ],
            },
          },
          {
            type: 'table',
            props: {
              columns: ['Canal', 'Valor'],
              rows: [['Direto', 'R$ 6,2 mi']],
            },
          },
        ],
      },
    ]);

    expect(screen.getByText('Receita do trimestre')).toBeTruthy();
    expect(screen.getByText('Consolidado por canal')).toBeTruthy();
    expect(screen.getByText('Receita total')).toBeTruthy();
    expect(screen.getByText('R$ 12,4 mi')).toBeTruthy();
    expect(screen.getByText('Churn')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Receita mensal' })).toBeTruthy();
    expect(screen.getByText('Canal')).toBeTruthy();
    expect(screen.getByText('Direto')).toBeTruthy();
  });

  it('mantém fallback discreto quando table/chart não têm dados suficientes', () => {
    // O parser rejeita tabela sem `columns`/`rows` como erro estrutural; o
    // fallback do renderer é a última defesa para specs antigos/manipulados.
    const spec: GenUISpec = {
      components: [
        { type: 'table', props: { columns: [], rows: [] } },
        { type: 'chart', props: { type: 'bar', title: 'Vazio', data: [] } },
      ],
    };

    render(<GenUIRenderer spec={spec} />);

    expect(screen.getByText('Tabela sem dados.')).toBeTruthy();
    expect(document.body.textContent).toMatch(/nenhum valor|gráfico inválido/i);
  });
});

/* ------------------------------------------------------------------ */
/* actions                                                             */
/* ------------------------------------------------------------------ */

describe('actions', () => {
  it('prompt dispara lumina:suggest com o texto exato e NÃO envia mensagem', async () => {
    const received: string[] = [];
    const dispatched: string[] = [];
    const onSuggest = (event: Event) => received.push((event as CustomEvent<string>).detail);
    const onAny = (event: Event) => dispatched.push(event.type);
    window.addEventListener('lumina:suggest', onSuggest);
    window.addEventListener('lumina:suggest', onAny);
    window.addEventListener('lumina:scroll-bottom', onAny);
    window.addEventListener('lumina:focus-composer', onAny);

    try {
      renderBlock([
        {
          type: 'actions',
          props: {
            items: [
              {
                label: 'Comparar cenários',
                prompt: 'Compare os cenários A e B, canal por canal.',
                tone: 'primary',
                icon: 'arrow-right',
              },
            ],
          },
        },
      ]);

      expect(screen.getByRole('group', { name: 'Ações sugeridas' })).toBeTruthy();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Comparar cenários' }));
      });

      await waitFor(() => expect(received).toEqual(['Compare os cenários A e B, canal por canal.']));
      // Prompt só preenche o composer: nada de envio (scroll-bottom) ou toast.
      expect(dispatched).toEqual(['lumina:suggest']);
      expect(toast.success).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('lumina:suggest', onSuggest);
      window.removeEventListener('lumina:suggest', onAny);
      window.removeEventListener('lumina:scroll-bottom', onAny);
      window.removeEventListener('lumina:focus-composer', onAny);
    }
  });

  it('copy copia via clipboard e confirma com toast', async () => {
    renderBlock([
      {
        type: 'actions',
        props: { items: [{ label: 'Copiar resumo', copy: 'Resumo do trimestre: alta de 12%.' }] },
      },
    ]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copiar resumo' }));
    });

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Resumo do trimestre: alta de 12%.'));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Copiado para a área de transferência'),
    );
  });

  it('mais de uma primary ou tone inválido não quebra e normaliza para secondary', () => {
    const spec: GenUISpec = {
      components: [
        {
          type: 'actions',
          props: {
            items: [
              { label: 'Ação um', prompt: 'Primeira', tone: 'primary' },
              { label: 'Ação dois', prompt: 'Segunda', tone: 'primary' },
              { label: 'Ação três', prompt: 'Terceira', tone: 'tone-invalido' },
            ],
          },
        },
      ],
    };

    render(<GenUIRenderer spec={spec} />);

    const first = screen.getByRole('button', { name: 'Ação um' });
    const second = screen.getByRole('button', { name: 'Ação dois' });
    const third = screen.getByRole('button', { name: 'Ação três' });
    expect(first.className).toContain('bg-foreground');
    expect(first.className).not.toContain('border-border');
    expect(second.className).toContain('border-border');
    expect(third.className).toContain('border-border');
  });
});

/* ------------------------------------------------------------------ */
/* reveal                                                              */
/* ------------------------------------------------------------------ */

describe('reveal', () => {
  const revealChildren = [{ type: 'badge', props: { label: 'Conteúdo interno' } }];

  it('começa fechado e abre ao clicar no summary', () => {
    const { container } = renderBlock([
      { type: 'reveal', props: { title: 'Detalhes da conta' }, children: revealChildren },
    ]);

    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);
    expect(screen.getByText('Detalhes da conta')).toBeTruthy();
    expect(screen.getByText('Conteúdo interno')).toBeTruthy();

    fireEvent.click(screen.getByText('Detalhes da conta'));
    expect(details.open).toBe(true);
  });

  it('respeita open: true', () => {
    const { container } = renderBlock([
      { type: 'reveal', props: { title: 'Detalhes da conta', open: true }, children: revealChildren },
    ]);

    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* diagnósticos                                                        */
/* ------------------------------------------------------------------ */

describe('GenUIBlock — diagnósticos', () => {
  it('JSON inválido degrada para CodeBlock com diagnósticos discretos', () => {
    const source = '{"components": [';
    render(<GenUIBlock source={source} />);

    // O fallback mantém o bloco copiável e mostra o diagnóstico.
    expect(screen.getByText('UI generativa')).toBeTruthy();
    expect(document.body.textContent).toContain('components');
    const diagnostics = screen.getByRole('list', { name: 'Diagnósticos da UI generativa' });
    expect(within(diagnostics).getAllByRole('listitem').length).toBeGreaterThan(0);
    expect(diagnostics.textContent).toMatch(/json|inválid|interpret/i);
  });

  it('tipo fora da whitelist degrada com diagnóstico', () => {
    render(<GenUIBlock source={'{"components":[{"type":"iframe","props":{}}]}'} />);

    expect(screen.getByText('UI generativa')).toBeTruthy();
    const diagnostics = screen.getByRole('list', { name: 'Diagnósticos da UI generativa' });
    expect(within(diagnostics).getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('bloco com warning renderiza normalizado e mostra a faixa de DEV', () => {
    // `card` de topo sem `title`: lint warning do contrato (`ui.card-title`);
    // a UI continua renderizável, só que normalizada.
    const source = JSON.stringify({
      version: 2,
      components: [
        {
          type: 'card',
          children: [{ type: 'stat', props: { label: 'Receita', value: 'R$ 10' } }],
        },
      ],
    });
    const parsed = parseGenUI(source);
    expect(parsed.spec, parsed.error ?? '').not.toBeNull();
    expect(parsed.warnings.length).toBeGreaterThan(0);

    render(<GenUIBlock source={source} />);

    expect(screen.getByText(/UI normalizada · \d+ aviso/)).toBeTruthy();
    expect(screen.getByText('Receita')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* correções de a11y/UX (auditoria independente)                       */
/* ------------------------------------------------------------------ */

describe('a11y/UX das primitivas', () => {
  it('steps: current é 1-based e marca o item atual com aria-current="step"', () => {
    renderBlock([
      {
        type: 'steps',
        props: {
          current: 2,
          items: [
            { title: 'Primeiro passo' },
            { title: 'Segundo passo' },
            { title: 'Terceiro passo' },
          ],
        },
      },
    ]);

    expect(screen.getByText('Segundo passo').getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('Primeiro passo').getAttribute('aria-current')).toBeNull();
    expect(screen.getByText('Terceiro passo').getAttribute('aria-current')).toBeNull();
  });

  it('steps: current=0 (default) não marca nenhum passo como atual', () => {
    renderBlock([{ type: 'steps', props: { items: [{ title: 'Alfa' }, { title: 'Beta' }] } }]);
    expect(document.querySelectorAll('[aria-current="step"]').length).toBe(0);
  });

  it('badge sem tone usa o default neutral do contrato', () => {
    renderBlock([{ type: 'badge', props: { label: 'Etiqueta sem tom' } }]);

    const tone = screen.getByText('Etiqueta sem tom').closest('[data-tone]')?.getAttribute('data-tone');
    expect(tone).toBe('neutral');
  });

  it('progress com max=1 exibe percentual em vez de "50/1"', () => {
    renderBlock([{ type: 'progress', props: { label: 'Concluído', value: 0.5, max: 1 } }]);

    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.queryByText('50/1')).toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Concluído' }).getAttribute('aria-valuenow')).toBe('50');
  });

  it('progress mantém percentual e display coerentes em max=100, max=1 e max=1000', () => {
    renderBlock([
      { type: 'progress', props: { label: 'Percentual', value: 50, max: 100 } },
      { type: 'progress', props: { label: 'Fração', value: 0.5, max: 1 } },
      { type: 'progress', props: { label: 'Escala', value: 250, max: 1000 } },
    ]);

    expect(screen.getAllByText('50%')).toHaveLength(2);
    expect(screen.getByText(/250\/1[.,]?000/)).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Percentual' }).getAttribute('aria-valuenow')).toBe('50');
    expect(screen.getByRole('progressbar', { name: 'Fração' }).getAttribute('aria-valuenow')).toBe('50');
    expect(screen.getByRole('progressbar', { name: 'Escala' }).getAttribute('aria-valuenow')).toBe('25');
  });

  it('timeline comunica status com texto, não apenas com a cor do dot', () => {
    const { container } = renderBlock([
      {
        type: 'timeline',
        props: {
          items: [
            { title: 'Enviado', status: 'done' },
            { title: 'Em revisão', status: 'active' },
            { title: 'Falhou', status: 'error' },
            { title: 'Aguardando', status: 'pending' },
          ],
        },
      },
    ]);

    expect(screen.getByText('Concluído')).toBeTruthy();
    expect(screen.getByText('Em andamento')).toBeTruthy();
    expect(screen.getByText('Erro')).toBeTruthy();
    expect(screen.getByText('Pendente').className).toContain('sr-only');

    const rows = container.querySelectorAll('li[data-status]');
    expect(rows).toHaveLength(4);
    expect(rows[0].getAttribute('data-status')).toBe('done');
    // O dot colorido (aria-hidden) continua lá; o texto é o que dá o significado.
    expect(rows[0].querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('tabs usa alvos de 32px e content com anel de foco visível', () => {
    renderBlock([
      {
        type: 'tabs',
        children: [
          {
            type: 'stack',
            props: { label: 'Visão geral' },
            children: [{ type: 'badge', props: { label: 'Painel A' } }],
          },
          {
            type: 'stack',
            props: { label: 'Detalhes' },
            children: [{ type: 'badge', props: { label: 'Painel B' } }],
          },
        ],
      },
    ]);

    expect(screen.getByRole('tab', { name: 'Visão geral' }).className).toContain('h-8');
    expect(screen.getByRole('tabpanel').className).toContain('focus-visible:ring-2');
    expect(screen.getByRole('tabpanel').className).toContain('ring-accent/40');
  });

  it('CodeBlock mantém alvo de 32px e aria-label pt-BR no botão copiar', () => {
    renderBlock([
      { type: 'code', props: { code: 'const valor = 42;', language: 'ts', title: 'exemplo.ts' } },
    ]);

    const copy = screen.getByRole('button', { name: 'Copiar código' });
    expect(copy.className).toContain('size-8');
  });
});

/* ------------------------------------------------------------------ */
/* mapa de ícones                                                      */
/* ------------------------------------------------------------------ */

describe('mapa de ícones do contrato', () => {
  it('cobre todos os GENUI_ICONS e não inventa nomes fora da whitelist', () => {
    for (const name of GENUI_ICONS) {
      expect(genUIIcon(name), `ícone "${name}" sem mapeamento lucide`).toBeTruthy();
    }
    expect(Object.keys(GENUI_ICON_MAP).sort()).toEqual([...GENUI_ICONS].sort());
    expect(genUIIcon('nao-existe')).toBeNull();
    expect(genUIIcon(undefined)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* todos os 21 tipos têm caminho de render                             */
/* ------------------------------------------------------------------ */

interface TypeFixture {
  component: Record<string, unknown>;
  assert: () => void;
}

const TYPE_FIXTURES: Record<string, TypeFixture> = {
  card: {
    component: {
      type: 'card',
      props: { title: 'Cartão de teste' },
      children: [{ type: 'badge', props: { label: 'Conteúdo do cartão' } }],
    },
    assert: () => {
      expect(screen.getByText('Cartão de teste')).toBeTruthy();
      expect(screen.getByText('Conteúdo do cartão')).toBeTruthy();
    },
  },
  stack: {
    component: {
      type: 'stack',
      props: { direction: 'row', gap: 'sm' },
      children: [{ type: 'badge', props: { label: 'Etiqueta na pilha' } }],
    },
    assert: () => expect(screen.getByText('Etiqueta na pilha')).toBeTruthy(),
  },
  grid: {
    component: {
      type: 'grid',
      props: { columns: 2 },
      children: [
        { type: 'badge', props: { label: 'Grade um' } },
        { type: 'badge', props: { label: 'Grade dois' } },
      ],
    },
    assert: () => {
      expect(screen.getByText('Grade um')).toBeTruthy();
      expect(screen.getByText('Grade dois')).toBeTruthy();
    },
  },
  tabs: {
    component: {
      type: 'tabs',
      children: [
        {
          type: 'stack',
          props: { label: 'Visão geral' },
          children: [{ type: 'badge', props: { label: 'Painel da aba' } }],
        },
      ],
    },
    assert: () => {
      expect(screen.getByRole('tab', { name: 'Visão geral' })).toBeTruthy();
      expect(screen.getByText('Painel da aba')).toBeTruthy();
    },
  },
  reveal: {
    component: {
      type: 'reveal',
      props: { title: 'Detalhes recolhidos' },
      children: [{ type: 'badge', props: { label: 'Interior recolhido' } }],
    },
    assert: () => {
      expect(screen.getByText('Detalhes recolhidos')).toBeTruthy();
      expect(screen.getByText('Interior recolhido')).toBeTruthy();
    },
  },
  divider: {
    component: { type: 'divider', props: { label: 'Separador' } },
    assert: () => expect(screen.getByText('Separador')).toBeTruthy(),
  },
  table: {
    component: {
      type: 'table',
      props: { columns: ['Coluna A', 'Coluna B'], rows: [['Célula A', 'Célula B']] },
    },
    assert: () => {
      expect(screen.getByText('Coluna A')).toBeTruthy();
      expect(screen.getByText('Célula A')).toBeTruthy();
    },
  },
  chart: {
    component: {
      type: 'chart',
      props: {
        type: 'line',
        title: 'Gráfico de teste',
        data: [
          { label: 'Jan', value: 1 },
          { label: 'Fev', value: 2 },
        ],
      },
    },
    assert: () => expect(screen.getByRole('img', { name: 'Gráfico de teste' })).toBeTruthy(),
  },
  stat: {
    component: { type: 'stat', props: { label: 'Métrica de teste', value: '42' } },
    assert: () => {
      expect(screen.getByText('Métrica de teste')).toBeTruthy();
      expect(screen.getByText('42')).toBeTruthy();
    },
  },
  progress: {
    component: { type: 'progress', props: { label: 'Progresso de teste', value: 50, max: 100 } },
    assert: () => {
      expect(screen.getByText('Progresso de teste')).toBeTruthy();
      expect(screen.getByText('50%')).toBeTruthy();
    },
  },
  timeline: {
    component: {
      type: 'timeline',
      props: { items: [{ title: 'Evento inicial' }, { title: 'Evento final' }] },
    },
    assert: () => {
      expect(screen.getByText('Evento inicial')).toBeTruthy();
      expect(screen.getByText('Evento final')).toBeTruthy();
    },
  },
  steps: {
    component: {
      type: 'steps',
      props: { items: [{ title: 'Primeiro passo' }, { title: 'Segundo passo' }], current: 1 },
    },
    assert: () => {
      expect(screen.getByText('Primeiro passo')).toBeTruthy();
      expect(screen.getByText('Segundo passo')).toBeTruthy();
    },
  },
  keyvalue: {
    component: {
      type: 'keyvalue',
      props: { items: [{ label: 'Chave de teste', value: 'Valor de teste' }] },
    },
    assert: () => {
      expect(screen.getByText('Chave de teste')).toBeTruthy();
      expect(screen.getByText('Valor de teste')).toBeTruthy();
    },
  },
  list: {
    component: { type: 'list', props: { items: ['Item de teste'] } },
    assert: () => expect(screen.getByText('Item de teste')).toBeTruthy(),
  },
  code: {
    component: {
      type: 'code',
      props: { code: 'const valor = 42;', language: 'ts', title: 'exemplo.ts' },
    },
    assert: () => expect(screen.getByText('exemplo.ts')).toBeTruthy(),
  },
  quote: {
    component: { type: 'quote', props: { text: 'Citação de teste', cite: 'Autora' } },
    assert: () => {
      expect(screen.getByText('Citação de teste')).toBeTruthy();
      expect(screen.getByText('— Autora')).toBeTruthy();
    },
  },
  callout: {
    component: { type: 'callout', props: { title: 'Aviso de teste', text: 'Mensagem do aviso' } },
    assert: () => {
      expect(screen.getByText('Aviso de teste')).toBeTruthy();
      expect(screen.getByText('Mensagem do aviso')).toBeTruthy();
    },
  },
  badge: {
    component: { type: 'badge', props: { label: 'Etiqueta de teste' } },
    assert: () => expect(screen.getByText('Etiqueta de teste')).toBeTruthy(),
  },
  image: {
    component: {
      type: 'image',
      props: { src: 'https://example.com/imagem.png', alt: 'Imagem de teste', caption: 'Legenda' },
    },
    assert: () => {
      expect(screen.getByRole('img', { name: 'Imagem de teste' })).toBeTruthy();
      expect(screen.getByText('Legenda')).toBeTruthy();
    },
  },
  link: {
    component: { type: 'link', props: { href: 'https://example.com', label: 'Link de teste' } },
    assert: () => expect(screen.getByText('Link de teste')).toBeTruthy(),
  },
  actions: {
    component: {
      type: 'actions',
      props: { items: [{ label: 'Ação primitiva', prompt: 'Próximo passo' }] },
    },
    assert: () => expect(screen.getByRole('button', { name: 'Ação primitiva' })).toBeTruthy(),
  },
};

describe('dispatch de tipos do contrato', () => {
  it('todo tipo de GENUI_TYPES tem fixture e teste de render', () => {
    expect(Object.keys(TYPE_FIXTURES).sort()).toEqual([...GENUI_TYPES].sort());
  });

  for (const type of GENUI_TYPES) {
    it(`renderiza "${type}" por um caminho próprio (sem cair no fallback)`, () => {
      const fixture = TYPE_FIXTURES[type];
      expect(fixture, `sem fixture de render para "${type}"`).toBeTruthy();
      if (!fixture) return;

      const source = JSON.stringify({ version: 2, components: [fixture.component] });
      const parsed = parseGenUI(source);
      expect(parsed.spec, parsed.error ?? '').not.toBeNull();

      render(<GenUIBlock source={source} />);

      expect(screen.queryByText(/não suportado/i)).toBeNull();
      fixture.assert();
    });
  }
});
