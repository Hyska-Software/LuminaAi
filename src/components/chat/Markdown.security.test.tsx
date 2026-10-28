// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Markdown, type MarkdownProps } from './Markdown';

vi.mock('@/components/genui', async () => {
  const { createElement } = await import('react');
  return {
    GenUIBlock: ({ source }: { source: string }) => createElement('div', { 'data-testid': 'genui-block' }, source),
    MermaidBlock: ({ code }: { code: string }) => createElement('div', { 'data-testid': 'mermaid-block' }, code),
    ChartBlock: ({ spec }: { spec: string }) => createElement('div', { 'data-testid': 'chart-block' }, spec),
    HtmlPreview: ({ html }: { html: string }) => createElement('div', { 'data-testid': 'html-preview' }, html),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type MarkdownVariant = NonNullable<MarkdownProps['variant']>;

/**
 * A variante `thinking` usa o **mesmo** pipeline remark/rehype e a **mesma**
 * sanitização da resposta; por isso todo vetor de segurança roda duas vezes,
 * uma por variante (sem dialeto nem allowlist reduzidos).
 */
const VARIANTS: ReadonlyArray<MarkdownVariant> = ['default', 'thinking'];

function renderMarkdown(content: string, variant: MarkdownVariant = 'default') {
  const { container } = render(<Markdown content={content} variant={variant} />);
  return container;
}

function expectNoElement(container: HTMLElement, tags: string[]) {
  for (const tag of tags) {
    expect(container.querySelector(tag), `tag <${tag}> should not be rendered`).toBeNull();
  }
}

function expectNoEventHandlerAttributes(container: HTMLElement) {
  for (const element of Array.from(container.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      expect(attribute.name.toLowerCase().startsWith('on'), `${element.tagName}[${attribute.name}]`).toBe(false);
    }
  }
}

describe.each(VARIANTS)('Markdown security — tags perigosas (variante %s)', (variant) => {
  it('removes <script> and its content', () => {
    const container = renderMarkdown('<script>alert("xss")</script>', variant);

    expectNoElement(container, ['script']);
    expect(container.textContent).not.toContain('alert');
    expect(container.textContent).not.toContain('xss');
  });

  it('removes <style> and its content', () => {
    const container = renderMarkdown('<style>body { color: red }</style>', variant);

    expectNoElement(container, ['style']);
    expect(container.textContent).not.toContain('color: red');
  });

  it.each([
    ['iframe', '<iframe src="https://evil.test"></iframe>'],
    ['object', '<object data="https://evil.test"></object>'],
    ['embed', '<embed src="https://evil.test">'],
    ['video', '<video src="https://evil.test/x.mp4"></video>'],
    ['audio', '<audio src="https://evil.test/x.mp3"></audio>'],
    ['canvas', '<canvas>tela</canvas>'],
    ['dialog', '<dialog>diálogo</dialog>'],
    ['marquee', '<marquee>rolagem</marquee>'],
  ])('removes the whole <%s> subtree', (tag, html) => {
    const container = renderMarkdown(html, variant);

    expectNoElement(container, [tag]);
    expect(container.querySelector('iframe, object, embed, video, audio, canvas, dialog, marquee')).toBeNull();
  });

  it('removes inline SVG with event handlers', () => {
    const container = renderMarkdown('<svg onload="alert(1)"><circle r="10" /></svg>', variant);

    expectNoElement(container, ['svg', 'circle']);
    expectNoEventHandlerAttributes(container);
  });

  it('removes raw MathML (KaTeX output is generated later, not user supplied)', () => {
    const container = renderMarkdown('<math><mi>x</mi><script>alert(1)</script></math>', variant);

    expectNoElement(container, ['math', 'mi', 'script']);
  });

  it('removes <template> without rendering its hidden content', () => {
    const container = renderMarkdown('<template><img src="x" onerror="alert(1)"></template>', variant);

    expectNoElement(container, ['template', 'img']);
    expectNoEventHandlerAttributes(container);
  });

  it('removes form controls and the form subtree', () => {
    const container = renderMarkdown(
      '<form action="https://evil.test"><input type="text" name="senha"><button>Enviar</button></form>',
      variant,
    );

    expectNoElement(container, ['form', 'input', 'button']);
    expect(container.textContent).not.toContain('Enviar');
  });

  it('removes non-task-list checkboxes and arbitrary inputs', () => {
    const container = renderMarkdown('<input type="checkbox" checked> <input type="text" value="x">', variant);

    expectNoElement(container, ['input']);
  });

  it('keeps a raw task-list checkbox but forces it disabled and handler-free', () => {
    const container = renderMarkdown(
      '<ul class="contains-task-list"><li class="task-list-item"><p>' +
        '<input type="checkbox" checked onchange="alert(1)"> feito</p></li></ul>',
      variant,
    );

    const input = container.querySelector<HTMLInputElement>('li.task-list-item input[type="checkbox"]');
    expect(input).toBeTruthy();
    expect(input?.disabled).toBe(true);
    expect(input?.checked).toBe(true);
    expect(input?.getAttributeNames().sort()).toEqual(['aria-label', 'checked', 'class', 'disabled', 'type']);
    expect(input?.getAttribute('onchange')).toBeNull();
  });

  it('removes <meta>, <base> and <link>', () => {
    const container = renderMarkdown(
      '<meta http-equiv="refresh" content="0"><base href="https://evil.test"><link rel="stylesheet" href="https://evil.test/x.css">',
      variant,
    );

    expectNoElement(container, ['meta', 'base', 'link']);
  });

  it('removes HTML comments', () => {
    const container = renderMarkdown('antes <!-- <script>alert(1)</script> --> depois', variant);

    expectNoElement(container, ['script']);
    expect(container.innerHTML).not.toContain('<!--');
    expect(container.textContent).toContain('antes');
    expect(container.textContent).toContain('depois');
  });
});

describe.each(VARIANTS)('Markdown security — atributos e eventos (variante %s)', (variant) => {
  it('strips every event handler attribute', () => {
    const container = renderMarkdown(
      '<div onclick="alert(1)" onmouseover="alert(2)" onfocus="alert(3)">texto</div>',
      variant,
    );

    expect(container.querySelector('div')?.textContent).toBe('texto');
    expectNoEventHandlerAttributes(container);
  });

  it('strips on* attributes from media and links while keeping the element', () => {
    const container = renderMarkdown(
      '<img src="https://lumina.dev/ok.png" onload="alert(1)" onerror="alert(2)">' +
        '<a href="https://lumina.dev" onclick="alert(3)">ok</a>',
      variant,
    );

    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://lumina.dev/ok.png');
    expect(image?.getAttribute('onload')).toBeNull();
    expect(image?.getAttribute('onerror')).toBeNull();

    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://lumina.dev');
    expect(link?.getAttribute('onclick')).toBeNull();
    expectNoEventHandlerAttributes(container);
  });

  it('strips inline style, arbitrary data-*, target and srcset', () => {
    const container = renderMarkdown(
      '<div style="position:fixed;top:0" data-evil="1" class="evil" id="evil id" target="_blank">oi</div>' +
        '<img src="https://lumina.dev/a.png" srcset="https://evil.test/b.png 2x" target="_blank">',
      variant,
    );

    const div = container.querySelector('.lumina-prose > div');
    expect(div?.textContent).toBe('oi');
    expect(div?.getAttribute('style')).toBeNull();
    expect(div?.getAttribute('data-evil')).toBeNull();
    expect(div?.getAttribute('class')).toBeNull();
    expect(div?.getAttribute('id')).toBeNull();
    expect(div?.getAttribute('target')).toBeNull();

    const image = container.querySelector('img');
    expect(image?.getAttribute('srcset')).toBeNull();
    expect(image?.getAttribute('target')).toBeNull();
  });

  it('keeps text-align only on table cells', () => {
    const container = renderMarkdown(
      '<table><tbody><tr>' +
        '<td style="text-align:center;position:fixed">centro</td>' +
        '<td style="color:red">sem estilo</td>' +
        '<td align="right">direita</td>' +
        '</tr></tbody></table><p style="text-align:center">fora</p>',
      variant,
    );

    const cells = Array.from(container.querySelectorAll<HTMLTableCellElement>('td'));
    expect(cells[0].style.textAlign).toBe('center');
    expect(cells[0].getAttribute('style')).toBe('text-align: center;');
    expect(cells[1].getAttribute('style')).toBeNull();
    expect(cells[2].style.textAlign).toBe('right');
    expect(container.querySelector('p')?.getAttribute('style')).toBeNull();
  });

  it('keeps the safe attributes generated by remark-gfm (ids, footnote data, checked, open, start)', () => {
    const container = renderMarkdown(
      '- [x] feito\n\nNota[^1]\n\n[^1]: texto\n\n<details open><summary>S</summary>c</details>\n\n' +
        '<ol start="4"><li>quatro</li></ol>',
      variant,
    );

    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox?.checked).toBe(true);
    expect(checkbox?.disabled).toBe(true);

    expect(container.querySelector('section')?.hasAttribute('data-footnotes')).toBe(true);
    expect(container.querySelector('a[data-footnote-ref]')?.getAttribute('href')).toBe('#user-content-fn-1');
    expect(container.querySelector('a[data-footnote-backref]')?.getAttribute('href')).toBe('#user-content-fnref-1');

    expect(container.querySelector('details')?.hasAttribute('open')).toBe(true);
    expect(container.querySelector('ol')?.getAttribute('start')).toBe('4');
  });

  it('preserves allowed classes only', () => {
    const container = renderMarkdown('<span class="sr-only">oculto</span><span class="evil katex">ruim</span>', variant);

    const [hidden, evil] = Array.from(container.querySelectorAll('span'));
    expect(hidden.className).toBe('sr-only');
    expect(evil.getAttribute('class')).toBeNull();
  });
});

describe.each(VARIANTS)('Markdown security — URLs (variante %s)', (variant) => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    'file:///C:/Windows/system32/calc.exe',
    '//evil.test/phishing',
  ])('does not render %s as a clickable link', (url) => {
    const container = renderMarkdown(`[texto seguro](${url})`, variant);

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('texto seguro');
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('does not render javascript: URLs from raw HTML as links', () => {
    const container = renderMarkdown('<a href="javascript:alert(1)">clique</a>', variant);

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('clique');
  });

  it('rejects URLs hiding control characters', () => {
    const container = renderMarkdown(
      '<a href="java&#9;script:alert(1)">clique</a><a href=" java\nscript:alert(1)">x</a>',
      variant,
    );

    expect(container.querySelector('a')).toBeNull();
  });

  it('drops unsafe image sources and shows the fallback', () => {
    const container = renderMarkdown('![perigosa](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)', variant);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('Imagem indisponível');
  });

  it('keeps safe http(s), mailto and anchor links', () => {
    const container = renderMarkdown(
      '[https](https://lumina.dev) [mail](mailto:a@lumina.dev) [âncora](#secao)',
      variant,
    );

    const hrefs = Array.from(container.querySelectorAll('a')).map((anchor) => anchor.getAttribute('href'));
    expect(hrefs).toEqual(['https://lumina.dev', 'mailto:a@lumina.dev', '#secao']);
  });

  it('still renders user math (KaTeX) after sanitization', () => {
    const container = renderMarkdown('$x^2 + y^2$', variant);

    expect(container.querySelector('.katex')).toBeTruthy();
    expect(container.querySelector('annotation')?.textContent).toContain('x^2');
  });
});

describe.each(VARIANTS)('Markdown security — entidades e escaping (variante %s)', (variant) => {
  it('renders escaped HTML as text, never as elements', () => {
    const container = renderMarkdown('&lt;script&gt;alert(1)&lt;/script&gt;', variant);

    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toBe('<script>alert(1)</script>');
  });

  it('decodes entities inside text content', () => {
    const container = renderMarkdown('AT&amp;T &copy; 2026', variant);

    expect(container.textContent).toContain('AT&T © 2026');
  });

  it('unwraps unknown tags keeping their text', () => {
    const container = renderMarkdown('<custom-tag data-x="1">texto preservado</custom-tag>', variant);

    expect(container.querySelector('custom-tag')).toBeNull();
    expect(container.textContent).toContain('texto preservado');
  });

  it('keeps HTML inside code fences as literal text', () => {
    const container = renderMarkdown('```html\n<script>alert(1)</script>\n```', variant);

    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });
});

describe('Markdown security — paridade entre variantes', () => {
  it('sanitiza de forma idêntica nas duas variantes (mesmo dialeto, mesma allowlist)', () => {
    const content = [
      '# Título',
      'Texto com **forte**, `código` e $x^2$.',
      '- [x] feito',
      '| A | B |\n| :--- | ---: |\n| 1 | 2 |',
      '> [!TIP]\n> Dica',
      '```ts\nconst x = 1;\n```',
      '<kbd>Ctrl</kbd> <mark>marca</mark>',
      'Nota[^1].',
      '[^1]: Texto.',
      '<script>alert(1)</script>',
      '<iframe src="https://evil.test"></iframe>',
      '<svg onload="alert(1)"></svg>',
      '<img src="https://lumina.dev/x.png" onerror="alert(1)">',
      '<a href="javascript:alert(1)">perigo</a>',
      '<form action="https://evil.test"><input name="senha"></form>',
      '<meta http-equiv="refresh" content="0">',
      'antes <!-- comentário --> depois',
      '<div style="position:fixed" class="evil" id="x">oi</div>',
    ].join('\n\n');

    const resposta = render(<Markdown content={content} />);
    const raciocinio = render(<Markdown content={content} variant="thinking" />);

    const respostaHtml = resposta.container.querySelector('.lumina-prose')?.innerHTML;
    const raciocinioHtml = raciocinio.container.querySelector('.lumina-prose')?.innerHTML;

    expect(raciocinioHtml).toBe(respostaHtml);
    expect(raciocinioHtml).not.toContain('javascript:');
    expect(raciocinioHtml).not.toContain('<script');
    expect(raciocinioHtml).not.toContain('<iframe');
    expect(raciocinioHtml).not.toContain('onload');
    expect(raciocinioHtml).not.toContain('onerror');
    expect(raciocinioHtml).not.toContain('<!--');
  });
});
