// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ContextStats } from '@/lib/types';
import { ContextMeter } from './ContextMeter';

function makeStats(overrides: Partial<ContextStats> = {}): ContextStats {
  return {
    used: 441_000,
    window: 1_000_000,
    outputCap: 32_000,
    percent: 44,
    messages: 120,
    breakdown: { systemPrompt: 100_000, toolDefinitions: 41_000, messages: 300_000 },
    ...overrides,
  };
}

function trigger(percent = 44): HTMLElement {
  return screen.getByRole('button', { name: `Contexto usado: ${percent}%` });
}

async function openPopover(percent = 44): Promise<HTMLElement> {
  fireEvent.click(trigger(percent));
  return screen.findByRole('dialog', { name: 'Detalhes do contexto' });
}

function legendItems(dialog: HTMLElement): HTMLElement[] {
  const list = within(dialog).getByRole('list', { name: 'Composição do contexto' });
  return Array.from(list.querySelectorAll('li'));
}

afterEach(cleanup);

describe('ContextMeter — chip compacto', () => {
  it('mostra anel de progresso + percentual e expõe aria-label descritivo', () => {
    const { container } = render(<ContextMeter stats={makeStats()} />);

    const button = trigger();
    expect(button.getAttribute('aria-label')).toBe('Contexto usado: 44%');
    expect(button.textContent).toContain('44%');
    expect(button.className).toContain('focus-visible:ring-2');
    // Anel: trilho + arco, ambos decorativos.
    expect(container.querySelectorAll('circle')).toHaveLength(2);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    // Sem layout shift: altura fixa e valores tabulares.
    expect(button.className).toContain('h-8');
    expect(button.querySelector('.tabular-nums')).toBeTruthy();
  });

  it('abre o popover ao clicar (e o popover é um dialog rotulado)', async () => {
    render(<ContextMeter stats={makeStats()} />);

    const dialog = await openPopover();

    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Detalhes do contexto');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });
});

describe('ContextMeter — popover (breakdown)', () => {
  it('mostra o header "X% do contexto usado" e os valores estimados', async () => {
    render(<ContextMeter stats={makeStats()} />);
    const dialog = await openPopover();

    expect(within(dialog).getByText('44% do contexto usado')).toBeTruthy();
    expect(within(dialog).getByText('~441K / 1M')).toBeTruthy();
    expect(within(dialog).getByText('Limite de saída: ~32K')).toBeTruthy();
  });

  it('barra segmentada com aria de progressbar, título e proporção da janela', async () => {
    render(<ContextMeter stats={makeStats()} />);
    const dialog = await openPopover();

    const bar = within(dialog).getByRole('progressbar', { name: 'Contexto usado' });
    expect(bar.getAttribute('aria-valuenow')).toBe('44');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuetext')).toBe('44% do contexto usado — ok');
    expect(bar.getAttribute('title')).toBe('Limite de saída: ~32K tokens');

    const segments = Array.from(bar.children) as HTMLElement[];
    expect(segments).toHaveLength(3);
    expect(segments[0].className).toContain('bg-context-system');
    expect(segments[1].className).toContain('bg-context-tools');
    expect(segments[2].className).toContain('bg-context-messages');
    // 100K/1M = 10%, 41K/1M = 4.1%, 300K/1M = 30%.
    expect(segments[0].style.width).toBe('10%');
    expect(segments[1].style.width).toBe('4.1%');
    expect(segments[2].style.width).toBe('30%');
    // Animação respeita reduced motion.
    expect(segments[0].className).toContain('transition-[width]');
    expect(segments[0].className).toContain('motion-reduce:transition-none');
  });

  it('legenda lista as três partes na ordem sistema → ferramentas → mensagens', async () => {
    render(<ContextMeter stats={makeStats()} />);
    const dialog = await openPopover();

    const items = legendItems(dialog);
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('Prompt de sistema');
    expect(items[0].textContent).toContain('~100K');
    expect(items[1].textContent).toContain('Definições de ferramentas');
    expect(items[1].textContent).toContain('~41K');
    expect(items[2].textContent).toContain('Mensagens');
    expect(items[2].textContent).toContain('~300K');
  });

  it('clampa percentual > 100 no chip, na barra e no rótulo', async () => {
    render(<ContextMeter stats={makeStats({ percent: 140 })} />);

    expect(trigger(100)).toBeTruthy();
    const dialog = await openPopover(100);
    const bar = within(dialog).getByRole('progressbar', { name: 'Contexto usado' });
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(within(dialog).getByText('100% do contexto usado')).toBeTruthy();
  });

  it('clampa percentual negativo para 0', async () => {
    render(<ContextMeter stats={makeStats({ percent: -10 })} />);
    expect(trigger(0)).toBeTruthy();
    const dialog = await openPopover(0);
    expect(
      within(dialog).getByRole('progressbar').getAttribute('aria-valuenow'),
    ).toBe('0');
  });
});

describe('ContextMeter — faixas e compactação', () => {
  it('faixa de atenção usa o rótulo textual (>=70)', async () => {
    render(<ContextMeter stats={makeStats({ percent: 78 })} />);
    const dialog = await openPopover(78);
    expect(
      within(dialog).getByRole('progressbar').getAttribute('aria-valuetext'),
    ).toBe('78% do contexto usado — atenção');
  });

  it('faixa compactando (>=90) aplica anel danger e borda de alerta', async () => {
    const { container } = render(<ContextMeter stats={makeStats({ percent: 94 })} />);
    const button = trigger(94);
    expect(button.className).toContain('border-danger/40');

    const arc = container.querySelectorAll('circle')[1];
    expect(arc?.getAttribute('class') ?? '').toContain('text-danger');

    const dialog = await openPopover(94);
    expect(
      within(dialog).getByRole('progressbar').getAttribute('aria-valuetext'),
    ).toBe('94% do contexto usado — compactando');
  });

  it('mostra a nota de compactação (stats) com role=status', async () => {
    render(<ContextMeter stats={makeStats({ compacted: 42 })} />);
    const dialog = await openPopover();
    expect(within(dialog).getByRole('status').textContent).toBe(
      'Contexto compactado · 42 mensagens resumidas',
    );
  });

  it('usa o prop compacted quando o host o informa', async () => {
    render(<ContextMeter stats={makeStats({ compacted: undefined })} compacted={7} />);
    const dialog = await openPopover();
    expect(within(dialog).getByRole('status').textContent).toContain('7 mensagens');
  });

  it('não mostra nota de compactação sem compactação', async () => {
    render(<ContextMeter stats={makeStats({ compacted: 0 })} />);
    const dialog = await openPopover();
    expect(within(dialog).queryByRole('status')).toBeNull();
  });
});

describe('ContextMeter — fallback e tempo real', () => {
  it('degrada para barra única + linha Mensagens quando falta breakdown', async () => {
    render(<ContextMeter stats={makeStats({ breakdown: undefined })} />);
    const dialog = await openPopover();

    const bar = within(dialog).getByRole('progressbar', { name: 'Contexto usado' });
    const segments = Array.from(bar.children) as HTMLElement[];
    expect(segments).toHaveLength(1);
    expect(segments[0].className).toContain('bg-accent');
    expect(segments[0].style.width).toBe('44%');

    const items = legendItems(dialog);
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('Mensagens');
    expect(items[0].textContent).toContain('~441K');
    expect(within(dialog).getByText('~441K / 1M')).toBeTruthy();
  });

  it('rerenderiza com novos stats sem fechar/remontar o popover', async () => {
    const { rerender } = render(<ContextMeter stats={makeStats()} />);
    const dialog = await openPopover();

    rerender(
      <ContextMeter
        stats={makeStats({
          used: 550_000,
          percent: 55,
          breakdown: { systemPrompt: 120_000, toolDefinitions: 50_000, messages: 380_000 },
        })}
      />,
    );

    expect(trigger(55)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(within(dialog).getByText('55% do contexto usado')).toBeTruthy();
    expect(within(dialog).getByText('~550K / 1M')).toBeTruthy();

    const bar = within(dialog).getByRole('progressbar', { name: 'Contexto usado' });
    expect(bar.getAttribute('aria-valuenow')).toBe('55');
    const segments = Array.from(bar.children) as HTMLElement[];
    expect(segments[0].style.width).toBe('12%');
    expect(segments[1].style.width).toBe('5%');
    expect(segments[2].style.width).toBe('38%');
    const items = legendItems(dialog);
    expect(items[0].textContent).toContain('~120K');
    expect(items[2].textContent).toContain('~380K');
  });

  it('a11y: trigger focável, lista textual (não só cor) e anel decorativo', async () => {
    render(<ContextMeter stats={makeStats()} />);

    const button = trigger();
    button.focus();
    expect(document.activeElement).toBe(button);

    const dialog = await openPopover();
    const list = within(dialog).getByRole('list', { name: 'Composição do contexto' });
    expect(list.querySelectorAll('li')).toHaveLength(3);
    for (const item of Array.from(list.querySelectorAll('li'))) {
      // Rótulo textual sempre visível ao lado do quadrado de cor.
      expect(item.textContent?.trim().length).toBeGreaterThan(0);
      expect(item.querySelector('[aria-hidden="true"]')).toBeTruthy();
    }
    expect(dialog.querySelector('svg')).toBeNull();
  });
});
