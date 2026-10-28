// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatMessage, ToolCallRecord } from '@/lib/types';

const openExternalUrl = vi.hoisted(() => vi.fn(async () => true));
vi.mock('./external', () => ({ openExternalUrl }));

// Imported after the mocks above.
import { useAppStore, useUiStore } from '@/lib/store';
import { AgentSteps } from './AgentSteps';

/** Toggles the new "raciocínio recolhido por padrão" setting. */
function setThinkingCollapsedByDefault(value: boolean): void {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, thinkingCollapsedByDefault: value },
  });
}

beforeEach(() => setThinkingCollapsedByDefault(false));

afterEach(() => {
  cleanup();
  setThinkingCollapsedByDefault(false);
  useUiStore.setState({ layoutMode: 'chat' });
});

function tool(overrides: Partial<ToolCallRecord> & Pick<ToolCallRecord, 'name'>): ToolCallRecord {
  return { id: `tool-${overrides.name}`, arguments: '{}', status: 'done', result: null, ...overrides };
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    role: 'assistant',
    content: 'Resposta final.',
    status: 'complete',
    toolCalls: [],
    citations: [],
    attachments: [],
    createdAt: 1,
    ...overrides,
  };
}

const SEARCH = tool({
  name: 'web_search',
  result: JSON.stringify({
    results: [
      { title: 'MIT — IA', url: 'https://www.mit.edu/ia' },
      { title: 'USP — IA', url: 'https://usp.br/ia' },
    ],
  }),
});

const FETCH = tool({
  name: 'fetch_url',
  arguments: '{"url":"https://mit.edu/ia"}',
  result: JSON.stringify({ url: 'https://mit.edu/ia', title: 'MIT — IA', content: '…' }),
});

describe('AgentSteps', () => {
  it('shows the total thinking duration and expands into the interleaved timeline', async () => {
    const user = userEvent.setup();
    render(
      <AgentSteps
        streaming={false}
        phase={null}
        message={message({
          reasoning: 'Vou pesquisar.\n\nJá tenho a resposta.',
          toolCalls: [SEARCH, FETCH],
          usage: { durationMs: 10_000 },
          trace: [
            { reasoning: 'Vou pesquisar.', toolCalls: 1 },
            { reasoning: 'Já tenho a resposta.', toolCalls: 1 },
          ],
        })}
      />,
    );

    const header = screen.getByRole('button', { name: /Pensou por 10s/ });
    // Collapsed when the answer is ready.
    expect(screen.queryByText('Vou pesquisar.')).toBeNull();

    await user.click(header);
    expect(screen.getByText('Vou pesquisar.')).toBeTruthy();
    expect(screen.getByText('Encontrou 2 páginas web')).toBeTruthy();
    expect(screen.getByText('Leu 1 página')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Fontes: mit\.edu, usp\.br/ })).toBeTruthy();
  });

  it('opens read pages in the browser from the timeline', async () => {
    const user = userEvent.setup();
    openExternalUrl.mockClear();
    render(
      <AgentSteps
        streaming={false}
        phase={null}
        message={message({
          reasoning: 'Vou ler a página.',
          toolCalls: [FETCH],
          trace: [{ reasoning: 'Vou ler a página.', toolCalls: 1 }],
        })}
      />,
    );

    await user.click(screen.getByRole('button', { expanded: false }));
    await user.click(screen.getByRole('button', { name: 'Abrir MIT — IA no navegador' }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://mit.edu/ia');
  });

  it('streams auto-expanded with a live header and collapses when the answer arrives', () => {
    const { rerender } = render(
      <AgentSteps
        streaming
        phase="tool"
        startedAt={Date.now() - 2_000}
        message={message({
          status: 'streaming',
          reasoning: 'Buscando fontes.',
          toolCalls: [tool({ name: 'web_search', status: 'running' })],
          trace: [{ reasoning: 'Buscando fontes.', toolCalls: 1 }],
        })}
      />,
    );

    expect(screen.getByRole('button', { name: /Executando ferramentas/ })).toBeTruthy();
    expect(screen.getByText('Buscando fontes.')).toBeTruthy();

    rerender(
      <AgentSteps
        streaming={false}
        phase={null}
        message={message({
          reasoning: 'Buscando fontes.',
          toolCalls: [SEARCH],
          usage: { durationMs: 4_000 },
          trace: [{ reasoning: 'Buscando fontes.', toolCalls: 1 }],
        })}
      />,
    );

    expect(screen.getByRole('button', { name: /Pensou por 4s/ })).toBeTruthy();
    expect(screen.queryByText('Buscando fontes.')).toBeNull();
  });

  it('describes tool-only turns as a number of steps', async () => {
    const user = userEvent.setup();
    render(
      <AgentSteps
        streaming={false}
        phase={null}
        message={message({
          reasoning: null,
          toolCalls: [FETCH, { ...FETCH, id: 'tool-2', result: JSON.stringify({ url: 'https://usp.br/ia', title: 'USP — IA' }) }],
          trace: [{ reasoning: null, toolCalls: 2 }],
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /2 passos/ }));
    expect(screen.getByText('Leu 2 páginas')).toBeTruthy();
  });

  it('renders nothing for answers without reasoning or tool calls', () => {
    const { container } = render(
      <AgentSteps streaming={false} phase={null} message={message({ reasoning: null })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows running, error and file rows with readable copy', async () => {
    const user = userEvent.setup();
    render(
      <AgentSteps
        streaming={false}
        phase={null}
        message={message({
          reasoning: null,
          toolCalls: [
            tool({ name: 'create_file', summary: 'relatorio.md · 1200 bytes' }),
            tool({ name: 'fetch_url', status: 'error', result: 'ERROR: HTTP 404' }),
          ],
          trace: [
            { reasoning: null, toolCalls: 1 },
            { reasoning: null, toolCalls: 1 },
          ],
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /2 passos/ }));
    expect(screen.getByText('Criou 1 arquivo')).toBeTruthy();
    expect(screen.getByText('relatorio.md')).toBeTruthy();
    expect(screen.getByText('Não foi possível ler a página')).toBeTruthy();
    expect(screen.getByText('HTTP 404')).toBeTruthy();
  });

  it('renders code and skill rows with their tool icons', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AgentSteps
        streaming={false}
        phase={null}
        message={message({
          reasoning: null,
          toolCalls: [
            tool({ name: 'run_code', summary: 'python · 2 arquivos · 1.2s' }),
            tool({ name: 'list_skills', result: '[]' }),
            tool({ name: 'read_skill', arguments: '{"name":"office-docx"}' }),
          ],
          trace: [{ reasoning: null, toolCalls: 3 }],
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /3 passos/ }));
    expect(screen.getByText('Executou código · python · 2 arquivos')).toBeTruthy();
    expect(screen.getByText('Consultou as skills disponíveis')).toBeTruthy();
    expect(screen.getByText('Leu a skill office-docx')).toBeTruthy();
    // run_code → SquareTerminal; list_skills/read_skill → BookOpen.
    expect(container.querySelectorAll('.lucide-square-terminal')).toHaveLength(1);
    expect(container.querySelectorAll('.lucide-book-open')).toHaveLength(2);
  });

  it('renders artifact library rows with their tool icons and file chips', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AgentSteps
        streaming={false}
        phase={null}
        message={message({
          reasoning: null,
          toolCalls: [
            tool({ name: 'list_artifacts', summary: '3 de 10 artefatos' }),
            tool({
              name: 'read_artifact',
              summary: 'relatorio-trimestral.docx · 1.200 caracteres',
            }),
          ],
          trace: [
            { reasoning: null, toolCalls: 1 },
            { reasoning: null, toolCalls: 1 },
          ],
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /2 passos/ }));
    expect(screen.getByText('Encontrou 3 artefatos')).toBeTruthy();
    expect(screen.getByText('Leu o artefato relatorio-trimestral.docx')).toBeTruthy();
    // The read artifact name also appears as a file chip.
    expect(screen.getByText('relatorio-trimestral.docx')).toBeTruthy();
    // list_artifacts → Library; read_artifact → FileSearch.
    expect(container.querySelectorAll('.lucide-library')).toHaveLength(1);
    expect(container.querySelectorAll('.lucide-file-search')).toHaveLength(1);
  });
});

describe('AgentSteps — raciocínio recolhido por padrão', () => {
  const reasoning = 'Analisando a pergunta.';

  function stepMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
    return message({
      reasoning,
      toolCalls: [],
      trace: [{ reasoning, toolCalls: 0 }],
      ...overrides,
    });
  }

  it('starts closed even while streaming and does not toggle by itself', async () => {
    const user = userEvent.setup();
    setThinkingCollapsedByDefault(true);

    const { rerender } = render(
      <AgentSteps
        streaming
        phase="reasoning"
        startedAt={Date.now() - 1_000}
        message={stepMessage({ status: 'streaming' })}
      />,
    );

    // Live header is visible, but the timeline starts collapsed.
    expect(screen.getByRole('button', { name: /Pensando/ })).toBeTruthy();
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy();
    expect(screen.queryByText(reasoning)).toBeNull();

    // The end of the stream must not open (nor close) the block.
    rerender(<AgentSteps streaming={false} phase={null} message={stepMessage()} />);
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy();
    expect(screen.queryByText(reasoning)).toBeNull();

    // A manual expansion still works.
    await user.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
    expect(screen.getByText(reasoning)).toBeTruthy();
  });

  it('keeps a manual expansion after the streaming ends', async () => {
    const user = userEvent.setup();
    setThinkingCollapsedByDefault(true);

    const { rerender } = render(
      <AgentSteps
        streaming
        phase="reasoning"
        startedAt={Date.now() - 1_000}
        message={stepMessage({ status: 'streaming' })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Pensando/ }));
    expect(screen.getByText(reasoning)).toBeTruthy();

    rerender(
      <AgentSteps
        streaming={false}
        phase={null}
        message={stepMessage({ usage: { durationMs: 4_000 } })}
      />,
    );

    expect(screen.getByRole('button', { name: /Pensou por 4s/, expanded: true })).toBeTruthy();
    expect(screen.getByText(reasoning)).toBeTruthy();
  });

  it('keeps the auto-open/auto-collapse behavior when the setting is off (default)', () => {
    const { rerender } = render(
      <AgentSteps
        streaming
        phase="reasoning"
        startedAt={Date.now() - 1_000}
        message={stepMessage({ status: 'streaming' })}
      />,
    );

    expect(screen.getByText(reasoning)).toBeTruthy();

    rerender(
      <AgentSteps
        streaming={false}
        phase={null}
        message={stepMessage({ usage: { durationMs: 4_000 } })}
      />,
    );

    expect(screen.queryByText(reasoning)).toBeNull();
  });
});

describe('AgentSteps — apresentações e tools do harness de código', () => {
  it('não renderiza cards de apresentação no transcript (decisão de UX)', () => {
    render(
      <AgentSteps
        streaming={false}
        phase={null}
        message={message({
          toolCalls: [
            tool({
              name: 'write_file',
              presentation: {
                kind: 'file_change',
                path: 'index.html',
                change: 'created',
                added: 245,
                removed: 0,
              },
            }),
            tool({
              name: 'todo_write',
              presentation: {
                kind: 'todos',
                items: [{ content: 'Rodar os testes', status: 'in_progress' }],
              },
            }),
            tool({
              name: 'submit_plan',
              presentation: { kind: 'plan', state: 'approved', markdown: '## Plano' },
            }),
            tool({
              name: 'job_output',
              presentation: {
                kind: 'job',
                job: { id: 'job-1', command: 'pnpm dev', status: 'running', startedAt: 1 },
              },
            }),
          ],
        })}
      />,
    );

    // Os cards de tool saíram do chat: o "Thinking" resume a atividade e o
    // popover do composer concentra plano/tarefas/jobs.
    expect(screen.queryByText(/Criou index\.html/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tarefas do agente' })).toBeNull();
    expect(screen.queryByText('Plano aprovado')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Trabalhos em segundo plano' })).toBeNull();

    // O resumo do bloco de raciocínio continua visível.
    expect(screen.getByRole('button', { name: /4 passos/ })).toBeTruthy();
  });

  it('rotula as tools do harness em pt-BR (sem nomes snake_case)', async () => {
    const user = userEvent.setup();
    render(
      <AgentSteps
        streaming={false}
        phase={null}
        message={message({
          toolCalls: [
            tool({ name: 'read_file', arguments: '{"path":"src/app.ts"}' }),
            tool({ name: 'write_file', arguments: '{"path":"src/app.ts","content":"x"}' }),
            tool({ name: 'run_command', arguments: '{"command":"pnpm test"}' }),
            tool({ name: 'submit_plan', arguments: '{"plan":"## Plano"}' }),
          ],
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /4 passos/ }));

    expect(screen.getByRole('listitem', { name: 'Leu src/app.ts' })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: 'Alterou src/app.ts' })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: 'Executou pnpm test' })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: 'Plano proposto' })).toBeTruthy();
    expect(screen.queryByText(/Executou read file/)).toBeNull();
    expect(screen.queryByText(/Executou submit plan/)).toBeNull();
  });

  it('mostra diff e saída de comando sob demanda, com exit code claro', async () => {
    const user = userEvent.setup();
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1 +1 @@',
      '-const a = 1;',
      '+const a = 2;',
    ].join('\n');
    render(
      <AgentSteps
        streaming={false}
        phase={null}
        message={message({
          toolCalls: [
            tool({
              name: 'edit_file',
              arguments: '{"path":"src/app.ts","old_string":"1","new_string":"2"}',
              presentation: {
                kind: 'file_change',
                path: 'src/app.ts',
                change: 'modified',
                added: 1,
                removed: 1,
                diff,
              },
            }),
            tool({
              name: 'run_command',
              arguments: '{"command":"pnpm test"}',
              status: 'error',
              result: '[exit code: 1]\nfalhou um teste\n(duração: 42 ms)',
            }),
          ],
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /2 passos/ }));

    // Falha de comando abre a saída por padrão e mostra o exit code.
    const commandRow = screen.getByRole('listitem', { name: 'Executou pnpm test' });
    expect(within(commandRow).getByText('exit 1')).toBeTruthy();
    expect(within(commandRow).getByText('falhou um teste')).toBeTruthy();
    expect(within(commandRow).getByText('42ms')).toBeTruthy();

    // Edit começa recolhido; expandir revela o diff com syntax highlight.
    const editRow = screen.getByRole('listitem', { name: 'Alterou src/app.ts' });
    const toggle = within(editRow).getByRole('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(within(editRow).getByText('@@ -1 +1 @@')).toBeTruthy();
  });

  it('usa ícones específicos e rótulos de erro acessíveis para tools de código', async () => {
    const user = userEvent.setup();
    render(
      <AgentSteps
        streaming={false}
        phase={null}
        message={message({
          toolCalls: [
            tool({ name: 'run_checks', status: 'error', result: 'saiu com código 1' }),
            tool({ name: 'todo_write', arguments: '{"todos":[]}' }),
          ],
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /2 passos/ }));

    expect(screen.getByText('As verificações falharam')).toBeTruthy();
    expect(screen.getByText('Atualizou as tarefas')).toBeTruthy();
  });
});

describe('AgentSteps — raciocínio em Markdown', () => {
  /** Renders one completed message whose only step is `content` as reasoning. */
  function renderTimeline(content: string) {
    return render(
      <AgentSteps
        streaming={false}
        phase={null}
        message={message({
          reasoning: content,
          toolCalls: [],
          trace: [{ reasoning: content, toolCalls: 0 }],
        })}
      />,
    );
  }

  async function expandTimeline(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { expanded: false }));
  }

  it('renderiza blocos, inline, tabela, código e math dentro do Thinking', async () => {
    const user = userEvent.setup();
    const markdown = [
      '### Plano',
      '',
      'Vou usar **negrito** e `código`.',
      '',
      '- item um',
      '- item dois',
      '',
      '| coluna | valor |',
      '| --- | --- |',
      '| a | 1 |',
      '',
      '```ts',
      'const valor = 1;',
      '```',
      '',
      'A fórmula $x^2$ é simples.',
    ].join('\n');
    const { container } = renderTimeline(markdown);

    await expandTimeline(user);

    // Markdown vira DOM: nada do dialeto aparece literalmente.
    expect(screen.getByRole('heading', { level: 3, name: 'Plano' })).toBeTruthy();
    expect(container.querySelector('strong')?.textContent).toBe('negrito');
    expect(container.querySelector('ul li')?.textContent).toBe('item um');
    expect(container.querySelector('table th')?.textContent).toBe('coluna');
    expect(container.querySelector('.lumina-table-wrap')).toBeTruthy();
    // Código cercado vira card com header da linguagem + ação de copiar.
    expect(screen.getByText('ts')).toBeTruthy();
    expect(container.textContent).toContain('const valor = 1;');
    expect(screen.getByRole('button', { name: 'Copiar código' })).toBeTruthy();
    // Math inline renderiza pelo KaTeX.
    expect(container.querySelector('.katex')).toBeTruthy();
    // Nenhum marcador Markdown vaza como texto.
    expect(container.textContent).not.toContain('**negrito**');
    expect(container.textContent).not.toContain('### Plano');
    expect(container.textContent).not.toContain('```');
  });

  it('renderiza alerta GitHub e task list com rótulos pt-BR no raciocínio', async () => {
    const user = userEvent.setup();
    renderTimeline(
      [
        '## Verificação',
        '',
        '> [!TIP]',
        '> Use **cache** quando possível.',
        '',
        '- [ ] pendente',
        '- [x] feito',
      ].join('\n'),
    );

    await expandTimeline(user);

    const alert = screen.getByRole('note', { name: 'Dica' });
    expect(alert.textContent).toContain('cache');
    expect(alert.textContent).not.toContain('[!TIP]');

    const pending = screen.getByRole('checkbox', { name: 'Pendente' }) as HTMLInputElement;
    const done = screen.getByRole('checkbox', { name: 'Concluído' }) as HTMLInputElement;
    expect(pending.disabled).toBe(true);
    expect(pending.checked).toBe(false);
    expect(done.checked).toBe(true);
  });

  it('aplica a variante thinking ao prosa do raciocínio', async () => {
    const user = userEvent.setup();
    const { container } = renderTimeline('Raciocínio **em Markdown**.');

    await expandTimeline(user);

    const prose = container.querySelector('.lumina-prose');
    expect(prose).toBeTruthy();
    expect(prose?.classList.contains('lumina-prose--thinking')).toBe(true);
    expect(prose?.classList.contains('text-[15px]')).toBe(false);
  });

  it('abre links externos do raciocínio pelo navegador do sistema', async () => {
    const user = userEvent.setup();
    openExternalUrl.mockClear();
    renderTimeline('Veja o [site do Lumina](https://lumina.dev/docs).');

    await expandTimeline(user);

    const link = screen.getByRole('link', { name: 'site do Lumina' });
    expect(link.getAttribute('href')).toBe('https://lumina.dev/docs');
    expect(link.getAttribute('target')).toBeNull();
    await user.click(link);
    expect(openExternalUrl).toHaveBeenCalledWith('https://lumina.dev/docs');
  });

  it('mantém raciocínio em texto puro visível com o rótulo "Pensou"', async () => {
    const user = userEvent.setup();
    const { container } = renderTimeline('Analisando a pergunta com calma.');

    // Colapsado depois que a resposta chegou.
    expect(screen.queryByText('Analisando a pergunta com calma.')).toBeNull();

    await expandTimeline(user);

    expect(screen.getByText('Pensou')).toBeTruthy();
    const paragraph = screen.getByText('Analisando a pergunta com calma.');
    expect(paragraph.tagName).toBe('P');
    expect(container.querySelector('strong')).toBeNull();
  });

  it('mostra o caret de streaming só no último bloco de raciocínio', () => {
    const first = '**Primeiro** raciocínio.';
    const second = '### Segundo\n\n- um\n- dois';
    const { container } = render(
      <AgentSteps
        streaming
        phase="reasoning"
        startedAt={Date.now() - 1_000}
        message={message({
          status: 'streaming',
          reasoning: `${first}\n\n${second}`,
          toolCalls: [],
          trace: [
            { reasoning: first, toolCalls: 0 },
            { reasoning: second, toolCalls: 0 },
          ],
        })}
      />,
    );

    const blocks = Array.from(container.querySelectorAll<HTMLElement>('.lumina-prose'));
    expect(blocks).toHaveLength(2);
    expect(blocks[0].classList.contains('lumina-prose--streaming')).toBe(false);
    expect(blocks[1].classList.contains('lumina-prose--streaming')).toBe(true);
  });

  it('não mostra caret quando a fase não é raciocínio', () => {
    const { container } = render(
      <AgentSteps
        streaming
        phase="tool"
        startedAt={Date.now() - 1_000}
        message={message({
          status: 'streaming',
          reasoning: 'Chamando as ferramentas.',
          toolCalls: [tool({ name: 'web_search', status: 'running' })],
          trace: [{ reasoning: 'Chamando as ferramentas.', toolCalls: 1 }],
        })}
      />,
    );

    expect(container.querySelector('.lumina-prose--streaming')).toBeNull();
    expect(container.querySelector('.lumina-prose')).toBeTruthy();
  });

  it('preserva os resumos agrupados do layout Chat com raciocínio em Markdown', async () => {
    useUiStore.setState({ layoutMode: 'chat' });
    const user = userEvent.setup();
    const reasoning = 'Vou **pesquisar** e ler as páginas.';
    render(
      <AgentSteps
        streaming={false}
        phase={null}
        message={message({
          reasoning,
          toolCalls: [SEARCH, FETCH],
          trace: [{ reasoning, toolCalls: 2 }],
        })}
      />,
    );

    await user.click(screen.getByRole('button', { expanded: false }));

    expect(screen.getByText('Encontrou 2 páginas web')).toBeTruthy();
    expect(screen.getByText('Leu 1 página')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Fontes: mit\.edu, usp\.br/ })).toBeTruthy();
    expect(screen.getByText('pesquisar').tagName).toBe('STRONG');
  });

  it('preserva as linhas por chamada do layout Code com raciocínio em Markdown', async () => {
    useUiStore.setState({ layoutMode: 'code' });
    const user = userEvent.setup();
    const reasoning = 'Vou **ler** os arquivos e rodar os testes.';
    render(
      <AgentSteps
        streaming={false}
        phase={null}
        message={message({
          reasoning,
          toolCalls: [
            tool({ name: 'read_file', arguments: '{"path":"src/app.ts"}' }),
            tool({ name: 'run_command', arguments: '{"command":"pnpm test"}' }),
          ],
          trace: [{ reasoning, toolCalls: 2 }],
        })}
      />,
    );

    await user.click(screen.getByRole('button', { expanded: false }));

    expect(screen.getByRole('listitem', { name: 'Leu src/app.ts' })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: 'Executou pnpm test' })).toBeTruthy();
    expect(screen.queryByText(/páginas web/)).toBeNull();
    expect(screen.getByText('ler').tagName).toBe('STRONG');
  });

  it('neutraliza HTML e URLs perigosas no raciocínio', async () => {
    const user = userEvent.setup();
    const { container } = renderTimeline(
      '<script>alert(1)</script>\n\n[perigo](javascript:alert(1))',
    );

    await expandTimeline(user);

    expect(container.querySelector('script')).toBeNull();
    expect(screen.queryByRole('link', { name: 'perigo' })).toBeNull();
    expect(container.textContent).toContain('perigo');
    expect(container.textContent).not.toContain('<script>');
  });
});
