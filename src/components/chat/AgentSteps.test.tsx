// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatMessage, ToolCallRecord } from '@/lib/types';

const openExternalUrl = vi.hoisted(() => vi.fn(async () => true));
vi.mock('./external', () => ({ openExternalUrl }));

// Imported after the mocks above.
import { useAppStore } from '@/lib/store';
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
