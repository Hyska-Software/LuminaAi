// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Markdown, type MarkdownProps } from './Markdown';
import { protectEscapedDollars, SENTINEL } from './markdown/mathDollars';

const external = vi.hoisted(() => ({ openExternalUrl: vi.fn(async () => true) }));

vi.mock('./external', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./external')>();
  return { ...actual, openExternalUrl: external.openExternalUrl };
});

vi.mock('@/components/genui', async () => {
  const { createElement } = await import('react');
  return {
    GenUIBlock: ({ source }: { source: string }) =>
      createElement('div', { 'data-testid': 'genui-block' }, source),
    MermaidBlock: ({ code }: { code: string }) =>
      createElement('div', { 'data-testid': 'mermaid-block' }, code),
    ChartBlock: ({ spec }: { spec: string }) =>
      createElement('div', { 'data-testid': 'chart-block' }, spec),
    HtmlPreview: ({ html, title }: { html: string; title?: string }) =>
      createElement('div', { 'data-testid': 'html-preview' }, `${title ?? ''}:${html}`),
  };
});

const clipboardWrite = vi.fn(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWrite },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderMarkdown(content: string, props: Partial<MarkdownProps> = {}) {
  const view = render(<Markdown content={content} {...props} />);
  return { ...view, prose: view.container.querySelector('.lumina-prose') as HTMLElement };
}

describe('Markdown — blocos GFM', () => {
  it('renders headings h1–h6', () => {
    const { container } = renderMarkdown(
      ['# Título 1', '## Título 2', '### Título 3', '#### Título 4', '##### Título 5', '###### Título 6'].join('\n\n'),
    );

    for (let level = 1; level <= 6; level += 1) {
      expect(container.querySelector(`h${level}`)?.textContent).toBe(`Título ${level}`);
    }
  });

  it('renders emphasis, strong and strikethrough', () => {
    const { container } = renderMarkdown('**forte** e *ênfase* e ~~riscado~~');

    expect(container.querySelector('strong')?.textContent).toBe('forte');
    expect(container.querySelector('em')?.textContent).toBe('ênfase');
    expect(container.querySelector('del')?.textContent).toBe('riscado');
  });

  it('renders inline code', () => {
    const { container } = renderMarkdown('Rode `pnpm test` no terminal.');

    const inlineCode = container.querySelector('p code');
    expect(inlineCode?.textContent).toBe('pnpm test');
    // react-markdown's `node` (hast) must never leak as a DOM attribute.
    expect(inlineCode?.getAttributeNames().sort()).toEqual([]);
  });

  it('renders nested lists and ordered list start', () => {
    const { container } = renderMarkdown(['- um', '  - um A', '- dois', '', '3. três', '4. quatro'].join('\n'));

    expect(container.querySelector('ul li ul li')?.textContent).toBe('um A');
    const ordered = container.querySelector('ol');
    expect(ordered?.getAttribute('start')).toBe('3');
    expect(ordered?.querySelectorAll('li')).toHaveLength(2);
  });

  it('renders GFM task lists with disabled, labelled checkboxes', () => {
    const { container } = renderMarkdown('- [ ] pendente\n- [x] feito');

    const list = container.querySelector('ul.contains-task-list');
    expect(list).toBeTruthy();
    expect(container.querySelectorAll('li.task-list-item')).toHaveLength(2);

    const [pending, done] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(pending.disabled).toBe(true);
    expect(pending.checked).toBe(false);
    expect(pending.getAttribute('aria-label')).toBe('Pendente');
    expect(done.disabled).toBe(true);
    expect(done.checked).toBe(true);
    expect(done.getAttribute('aria-label')).toBe('Concluído');
  });

  it('keeps checkboxes in loose GFM task lists (blank line between items)', () => {
    const { container } = renderMarkdown('- [x] feito\n\n- [ ] aberto');

    expect(container.querySelectorAll('li.task-list-item')).toHaveLength(2);
    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('li.task-list-item input[type="checkbox"]'),
    );
    expect(inputs).toHaveLength(2);
    // Loose lists wrap the checkbox in a paragraph: `li.task-list-item > p > input`.
    expect(container.querySelectorAll('li.task-list-item p > input[type="checkbox"]')).toHaveLength(2);

    expect(inputs[0].disabled).toBe(true);
    expect(inputs[0].checked).toBe(true);
    expect(inputs[0].getAttribute('aria-label')).toBe('Concluído');
    expect(inputs[1].disabled).toBe(true);
    expect(inputs[1].checked).toBe(false);
    expect(inputs[1].getAttribute('aria-label')).toBe('Pendente');
  });

  it('keeps the checkbox of a task list item with multiple paragraphs', () => {
    const { container } = renderMarkdown('- [x] feito\n\n  segundo parágrafo do item');

    const item = container.querySelector('li.task-list-item');
    expect(item).toBeTruthy();
    expect(container.textContent).toContain('segundo parágrafo do item');

    const input = item?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(input).toBeTruthy();
    expect(input?.disabled).toBe(true);
    expect(input?.checked).toBe(true);
    expect(input?.getAttribute('aria-label')).toBe('Concluído');
  });

  it('renders tables inside a scroll wrapper with GFM column alignment', () => {
    const { container } = renderMarkdown('| Nome | Idade |\n| :--- | ---: |\n| Ana | 30 |');

    const wrapper = container.querySelector('.lumina-table-wrap');
    expect(wrapper).toBeTruthy();
    expect(wrapper?.className).toContain('overflow-x-auto');

    const headers = Array.from(container.querySelectorAll<HTMLTableCellElement>('th'));
    expect(headers.map((header) => header.textContent)).toEqual(['Nome', 'Idade']);
    expect(headers[0].style.textAlign).toBe('left');
    expect(headers[1].style.textAlign).toBe('right');
    expect(container.querySelectorAll('tbody td')).toHaveLength(2);
  });

  it('renders raw HTML tables with caption and sanitized alignment', () => {
    const { container } = renderMarkdown(
      '<table><caption>Legenda da tabela</caption><thead><tr><th align="center">Chave</th></tr></thead>' +
        '<tbody><tr><td style="text-align:right">valor</td></tr></tbody></table>',
    );

    expect(container.querySelector('caption')?.textContent).toBe('Legenda da tabela');
    expect(container.querySelectorAll('th')[0].style.textAlign).toBe('center');
    expect(container.querySelectorAll('td')[0].style.textAlign).toBe('right');
  });

  it('renders nested blockquotes', () => {
    const { container } = renderMarkdown('> nível um\n>\n> > nível dois');

    expect(container.querySelector('blockquote')?.textContent).toContain('nível um');
    expect(container.querySelector('blockquote blockquote')?.textContent).toContain('nível dois');
  });

  it('renders horizontal rules', () => {
    const { container } = renderMarkdown('acima\n\n---\n\nabaixo');

    expect(container.querySelector('hr')).toBeTruthy();
  });
});

describe('Markdown — GitHub alerts', () => {
  it.each([
    ['NOTE', 'Nota'],
    ['TIP', 'Dica'],
    ['IMPORTANT', 'Importante'],
    ['WARNING', 'Atenção'],
    ['CAUTION', 'Cuidado'],
  ])('renders a [!%s] blockquote as the "%s" alert', (marker, label) => {
    const { container } = renderMarkdown(`> [!${marker}]\n> Conteúdo do alerta`);

    const alert = screen.getByRole('note', { name: label });
    expect(alert.getAttribute('data-alert')).toBe(marker.toLowerCase());
    expect(alert.textContent).toContain('Conteúdo do alerta');
    expect(alert.textContent).not.toContain(`[!${marker}]`);
    expect(container.querySelector('blockquote')).toBeNull();
  });

  it('keeps inline formatting inside alerts', () => {
    renderMarkdown('> [!TIP]\n> Use **negrito** e `código` aqui');

    const alert = screen.getByRole('note', { name: 'Dica' });
    expect(within(alert).getByText('negrito').tagName).toBe('STRONG');
    expect(within(alert).getByText('código').tagName).toBe('CODE');
  });

  it('keeps unknown markers as a regular blockquote', () => {
    const { container } = renderMarkdown('> [!FOO]\n> texto qualquer');

    expect(screen.queryByRole('note')).toBeNull();
    expect(container.querySelector('blockquote')?.textContent).toContain('[!FOO]');
    expect(container.textContent).toContain('texto qualquer');
  });
});

describe('Markdown — links', () => {
  it('opens external http(s) links through the OS opener', async () => {
    const user = userEvent.setup();
    renderMarkdown('[site do Lumina](https://lumina.dev/docs?x=1)');

    const link = screen.getByRole('link', { name: 'site do Lumina' });
    expect(link.getAttribute('href')).toBe('https://lumina.dev/docs?x=1');
    expect(link.getAttribute('target')).toBeNull();

    await user.click(link);
    expect(external.openExternalUrl).toHaveBeenCalledTimes(1);
    expect(external.openExternalUrl).toHaveBeenCalledWith('https://lumina.dev/docs?x=1');
  });

  it('opens mailto links without a target=_blank', async () => {
    const user = userEvent.setup();
    renderMarkdown('[fale conosco](mailto:contato@lumina.dev)');

    const link = screen.getByRole('link', { name: 'fale conosco' });
    expect(link.getAttribute('target')).toBeNull();

    await user.click(link);
    expect(external.openExternalUrl).toHaveBeenCalledWith('mailto:contato@lumina.dev');
  });

  it('scrolls to internal anchors instead of opening the browser', async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { container } = renderMarkdown('[ir para a seção](#secao)\n\n<h2 id="secao">Seção</h2>');

    const target = container.querySelector('#secao') as HTMLElement;
    expect(target).toBeTruthy();

    await user.click(screen.getByRole('link', { name: 'ir para a seção' }));
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(external.openExternalUrl).not.toHaveBeenCalled();
  });

  it('does not render unsafe URLs as clickable links', () => {
    const { container } = renderMarkdown('[perigo](javascript:alert(1))');

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('perigo');
  });

  it('renders GFM autolinks for URLs, www and e-mail', () => {
    const { container } = renderMarkdown('veja https://lumina.dev, www.lumina.dev e contato@lumina.dev');

    const hrefs = Array.from(container.querySelectorAll('a')).map((anchor) => anchor.getAttribute('href'));
    expect(hrefs).toContain('https://lumina.dev');
    expect(hrefs).toContain('http://www.lumina.dev');
    expect(hrefs).toContain('mailto:contato@lumina.dev');
  });

  it('keeps hard line breaks', () => {
    const { container } = renderMarkdown('linha um  \nlinha dois');

    expect(container.querySelector('br')).toBeTruthy();
    expect(container.querySelector('p')?.textContent).toContain('linha um');
    expect(container.querySelector('p')?.textContent).toContain('linha dois');
  });
});

describe('Markdown — imagens', () => {
  it('renders a lazy image with alt and title', () => {
    const { container } = renderMarkdown('![Logo do Lumina](https://lumina.dev/logo.png "Logo")');

    const image = container.querySelector('img');
    expect(image).toBeTruthy();
    expect(image?.getAttribute('src')).toBe('https://lumina.dev/logo.png');
    expect(image?.getAttribute('alt')).toBe('Logo do Lumina');
    expect(image?.getAttribute('title')).toBe('Logo');
    expect(image?.getAttribute('loading')).toBe('lazy');
  });

  it('shows an accessible fallback when an image fails to load', () => {
    const { container } = renderMarkdown('![Ícone quebrado](https://lumina.dev/quebrada.png)');

    fireEvent.error(container.querySelector('img') as HTMLImageElement);

    const fallback = screen.getByRole('img', { name: 'Imagem indisponível: Ícone quebrado' });
    expect(fallback.textContent).toContain('Imagem indisponível');
    expect(fallback.textContent).toContain('Ícone quebrado');
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows the fallback for images without a usable source', () => {
    renderMarkdown('![Sem fonte]()');

    expect(screen.getByRole('img', { name: 'Imagem indisponível: Sem fonte' })).toBeTruthy();
  });
});

describe('Markdown — código', () => {
  it('renders fenced code with language header and copy action', async () => {
    const { container } = renderMarkdown('```ts\nconst valor = 1;\n```');

    expect(container.textContent).toContain('ts');
    expect(container.textContent).toContain('const valor = 1;');

    const copyButton = screen.getByRole('button', { name: 'Copiar código' });
    fireEvent.click(copyButton);
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith('const valor = 1;'));
  });

  it('renders indented code blocks as copyable cards', () => {
    const { container } = renderMarkdown('    codigo indentado');

    expect(container.textContent).toContain('codigo indentado');
    expect(screen.getByRole('button', { name: 'Copiar código' })).toBeTruthy();
  });

  it('renders fenced blocks without an info string', () => {
    const { container } = renderMarkdown('```\ntexto puro\n```');

    expect(container.textContent).toContain('texto puro');
    expect(screen.getByRole('button', { name: 'Copiar código' })).toBeTruthy();
  });

  it('delegates special fences to the genui blocks', () => {
    const { container } = renderMarkdown(
      [
        '```ui',
        '{"type":"card"}',
        '```',
        '',
        '```mermaid',
        'graph TD; A-->B;',
        '```',
        '',
        '```chart',
        '{"type":"bar","data":[]}',
        '```',
        '',
        '```html',
        '<h1>Oi</h1>',
        '```',
        '',
        '```svg',
        '<svg></svg>',
        '```',
      ].join('\n'),
    );

    expect(screen.getByTestId('genui-block').textContent).toBe('{"type":"card"}');
    expect(screen.getByTestId('mermaid-block').textContent).toBe('graph TD; A-->B;');
    expect(screen.getByTestId('chart-block').textContent).toBe('{"type":"bar","data":[]}');
    const previews = screen.getAllByTestId('html-preview');
    expect(previews).toHaveLength(2);
    expect(previews[0].textContent).toBe('HTML:<h1>Oi</h1>');
    expect(previews[1].textContent).toBe('SVG:<svg></svg>');
    expect(container.textContent).not.toContain('Copiar');
  });

  it('preserves literal <pre> HTML from Markdown', () => {
    const { container } = renderMarkdown('<pre>texto cru <b>negrito</b></pre>');

    const pre = container.querySelector('pre');
    expect(pre?.textContent).toBe('texto cru negrito');
    expect(pre?.querySelector('b')?.textContent).toBe('negrito');
    expect(screen.queryByRole('button', { name: 'Copiar código' })).toBeNull();
  });

  it('renders nothing for an empty <pre> wrapper', () => {
    const { container } = renderMarkdown('<pre>   </pre>');

    expect(container.querySelector('pre')).toBeNull();
  });
});

describe('Markdown — math', () => {
  it('renders inline math with KaTeX', () => {
    const { container } = renderMarkdown('A fórmula $x^2$ é simples.');

    expect(container.querySelector('.katex')).toBeTruthy();
    expect(container.querySelector('annotation')?.textContent).toBe('x^2');
    expect(container.querySelector('p')?.textContent).toContain('A fórmula');
  });

  it('renders display math without wrapping it in a <pre>', () => {
    const { container } = renderMarkdown('$$\na + b = c\n$$');

    expect(container.querySelector('.katex-display')).toBeTruthy();
    expect(container.querySelector('pre')).toBeNull();
    expect(container.querySelector('annotation')?.textContent).toContain('a + b = c');
  });
});

describe('Markdown — cifrão escapado em math (\\$)', () => {
  it('renders math whose content is a single escaped dollar', () => {
    const { container } = renderMarkdown('$\\$$');

    expect(container.querySelectorAll('.katex-error')).toHaveLength(0);
    expect(container.querySelector('.katex')).toBeTruthy();
    expect(container.querySelector('annotation')?.textContent).toContain('\\$');
  });

  it('renders the stack-alphabet definition with \\$ (real user case)', () => {
    const { container } = renderMarkdown('$\\Gamma = \\{a, b, c, S, A, \\$\\}$');

    expect(container.querySelectorAll('.katex-error')).toHaveLength(0);
    const annotation = container.querySelector('annotation')?.textContent ?? '';
    expect(annotation).toContain('\\$');
    expect(annotation).toContain('\\Gamma');
  });

  it('renders the delta transition with several escaped dollars', () => {
    const { container } = renderMarkdown('$\\delta(q, \\$, \\$) = (q_f, \\$)$');

    expect(container.querySelectorAll('.katex-error')).toHaveLength(0);
    expect(container.querySelector('annotation')?.textContent).toContain('\\$');
  });

  it('renders a table cell with the APD configuration containing \\$', () => {
    const { container } = renderMarkdown(
      '| Topo | Transição |\n|:---|:---|\n| $\\$$ | $(q,\\ accb\\$,\\ a\\,S\\,b\\,\\$)$ |',
    );

    expect(container.querySelectorAll('.katex-error')).toHaveLength(0);
    const annotations = Array.from(container.querySelectorAll('annotation')).map((node) => node.textContent ?? '');
    expect(annotations.some((annotation) => annotation.includes('accb') && annotation.includes('\\$'))).toBe(true);
    expect(container.textContent).not.toContain(SENTINEL);
  });

  it('does not cascade into the following paragraph (FOLLOW real case)', () => {
    const { container } = renderMarkdown(
      'Repare no passo 8: o $A$ só pôde virar $\\varepsilon$ porque $\\$ \\in \\text{FOLLOW}(A)$ e o lookahead era $b$. ' +
        '**É aqui que o FOLLOW entra em cena.** Sem ele, o autômato não saberia que a cadeia de $c$ terminou.',
    );

    expect(container.querySelectorAll('.katex-error')).toHaveLength(0);
    const strong = container.querySelector('strong');
    expect(strong?.textContent).toBe('É aqui que o FOLLOW entra em cena.');
    expect(container.textContent).toContain('Sem ele, o autômato não saberia que a cadeia de');
    expect(container.textContent).toContain('terminou.');
    expect(container.textContent).not.toContain(SENTINEL);
  });

  it('restores \\$ as a literal dollar in prose', () => {
    const { container } = renderMarkdown('custa \\$5 e mais \\$10 no total');

    expect(container.querySelector('.katex')).toBeNull();
    expect(container.textContent).toBe('custa $5 e mais $10 no total');
    expect(container.textContent).not.toContain('\\$');
  });

  it('keeps \\$ literal inside inline code and fenced code', () => {
    const { container } = renderMarkdown('texto `\\$` e fenced\n\n```ts\nconst preco = "\\$";\n```');

    expect(container.querySelector('p code')?.textContent).toBe('\\$');
    expect(container.textContent).toContain('const preco = "\\$";');
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.textContent).not.toContain(SENTINEL);
  });

  it('never leaks the protection sentinel into the DOM', () => {
    const { container } = renderMarkdown('$\\$ \\in \\text{FOLLOW}(A)$ e prosa \\$ aqui');

    expect(container.textContent).not.toContain(SENTINEL);
    expect(container.querySelectorAll('.katex-error')).toHaveLength(0);
  });

  it('protects only the escaped dollar pairs before parsing', () => {
    expect(protectEscapedDollars('$\\$$')).toBe(`$${SENTINEL}$`);
    expect(protectEscapedDollars('custa \\$5 e mais \\$10')).toBe(`custa ${SENTINEL}5 e mais ${SENTINEL}10`);
    expect(protectEscapedDollars('$x^2$ sem escape')).toBe('$x^2$ sem escape');
  });
});

describe('Markdown — notas de rodapé', () => {
  it('renders the localized footnote section, refs and backrefs', async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { container } = renderMarkdown('Uma nota[^1] no texto.\n\n[^1]: Conteúdo da nota.');

    const section = container.querySelector('section.lumina-footnotes');
    expect(section).toBeTruthy();
    expect(section?.hasAttribute('data-footnotes')).toBe(true);

    const title = container.querySelector('#footnote-label');
    expect(title?.tagName).toBe('H2');
    expect(title?.textContent).toBe('Notas');
    expect(title?.className).toContain('sr-only');

    const ref = container.querySelector('a[data-footnote-ref]') as HTMLAnchorElement;
    expect(ref.getAttribute('href')).toBe('#user-content-fn-1');
    expect(ref.getAttribute('target')).toBeNull();
    expect(ref.getAttribute('data-footnote-ref')).toBe('');
    expect(ref.getAttribute('id')).toBe('user-content-fnref-1');
    expect(ref.getAttribute('aria-describedby')).toBe('footnote-label');
    expect(ref.getAttributeNames()).not.toContain('node');

    const backref = container.querySelector('a[data-footnote-backref]') as HTMLAnchorElement;
    expect(backref.getAttribute('href')).toBe('#user-content-fnref-1');
    expect(backref.getAttribute('aria-label')).toBe('Voltar para a referência 1');
    expect(backref.getAttribute('target')).toBeNull();
    expect(backref.getAttribute('data-footnote-backref')).toBe('');
    expect(backref.getAttributeNames()).not.toContain('node');

    await user.click(ref);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(external.openExternalUrl).not.toHaveBeenCalled();

    await user.click(backref);
    expect(scrollSpy).toHaveBeenCalledTimes(2);
    expect(external.openExternalUrl).not.toHaveBeenCalled();
  });

  it('localizes every backref label when a footnote is referenced twice', () => {
    const { container } = renderMarkdown('Uma nota[^1] e outra[^1].\n\n[^1]: Conteúdo da nota.');

    const labels = Array.from(container.querySelectorAll('a[data-footnote-backref]')).map((anchor) =>
      anchor.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['Voltar para a referência 1', 'Voltar para a referência 1-2']);
  });
});

describe('Markdown — HTML seguro e detalhes', () => {
  it('renders the safe raw HTML subset', () => {
    const { container } = renderMarkdown(
      '<kbd>Ctrl</kbd> <mark>marca</mark> <sup>2</sup><sub>n</sub> <br> ' +
        '<abbr title="Application Programming Interface">API</abbr> ' +
        '<details open><summary>Mais detalhes</summary>conteúdo interno</details>',
    );

    expect(container.querySelector('kbd')?.textContent).toBe('Ctrl');
    expect(container.querySelector('mark')?.textContent).toBe('marca');
    expect(container.querySelector('sup')?.textContent).toBe('2');
    expect(container.querySelector('sub')?.textContent).toBe('n');
    expect(container.querySelector('abbr')?.getAttribute('title')).toBe('Application Programming Interface');
    expect(container.querySelector('br')).toBeTruthy();

    const details = container.querySelector('details');
    expect(details?.hasAttribute('open')).toBe(true);
    expect(details?.querySelector('summary')?.textContent).toBe('Mais detalhes');
    expect(details?.textContent).toContain('conteúdo interno');
  });

  it('adds the streaming caret class only while streaming', () => {
    const streaming = renderMarkdown('Resposta parcial', { streaming: true });
    expect(streaming.container.querySelector('.lumina-prose')?.className).toContain('lumina-prose--streaming');
    cleanup();

    const idle = renderMarkdown('Resposta completa');
    expect(idle.container.querySelector('.lumina-prose')?.className).not.toContain('lumina-prose--streaming');
  });
});

describe('Markdown — bordas uniformes (regra de produto)', () => {
  const css = readFileSync('src/styles/globals.css', 'utf8');

  function ruleBlock(selector: string): string {
    const start = css.indexOf(selector);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = css.indexOf('}', start);
    return css.slice(start, end + 1);
  }

  it('citações não usam borda unilateral', () => {
    const block = ruleBlock('.lumina-prose blockquote {');
    expect(block).not.toMatch(/border-inline-start|border-left|border-right/);
  });

  it('alertas GitHub não são caixas com borda/fundo', () => {
    const block = ruleBlock('.lumina-prose .lumina-alert {');
    // Pode declarar `border: 0` (reset), nunca uma borda desenhada.
    expect(block).not.toMatch(/border-(inline|left|right|top|bottom)/);
    const borderValue = /border:\s*([^;]+);/.exec(block)?.[1]?.trim();
    expect(borderValue === undefined || borderValue === '0').toBe(true);
    // Fundo é permitido apenas transparente (sem caixa colorida).
    const backgroundValue = /background:\s*([^;]+);/.exec(block)?.[1]?.trim();
    expect(backgroundValue === undefined || backgroundValue === 'transparent').toBe(true);
  });

  it('alertas continuam acessíveis (role note + rótulo pt-BR)', () => {
    renderMarkdown('> [!TIP]\n> Conteúdo');
    const alert = screen.getByRole('note', { name: 'Dica' });
    expect(alert.getAttribute('data-alert')).toBe('tip');
    expect(alert.className).not.toMatch(/border|bg-/);
  });

  it('o prose do Markdown fica em @layer components e o GenUI tem resets próprios', () => {
    // Regressão: sem o layer, os seletores de elemento do Markdown (p, ol, li,
    // details) vazam para dentro da UI generativa e desalinham os blocos.
    expect(css).toMatch(/@layer components\s*\{[\s\S]*?\.lumina-prose\s*\{/);
    for (const selector of [
      '.lumina-prose .lumina-genui p',
      '.lumina-prose .lumina-genui ol',
      '.lumina-prose .lumina-genui li',
      '.lumina-prose .lumina-genui details',
      '.lumina-prose .lumina-genui details > :not(summary)',
    ]) {
      expect(css).toContain(selector);
    }
  });
});
