import { describe, expect, it } from 'vitest';
import {
  buildAgentTrace,
  countTraceTools,
  hasTraceReasoning,
  splitReasoning,
  type AgentTraceEntry,
  type ToolGroup,
} from '@/lib/agentTrace';
import type { ToolCallRecord, TraceStep } from '@/lib/types';

function tool(overrides: Partial<ToolCallRecord> & Pick<ToolCallRecord, 'name'>): ToolCallRecord {
  return {
    id: `tool-${Math.random().toString(36).slice(2, 8)}`,
    arguments: '{}',
    status: 'done',
    result: null,
    ...overrides,
  };
}

function reasoningTexts(entries: AgentTraceEntry[]): string[] {
  return entries
    .filter((entry): entry is { kind: 'reasoning'; text: string } => entry.kind === 'reasoning')
    .map((entry) => entry.text);
}

function toolGroups(entries: AgentTraceEntry[]): ToolGroup[] {
  return entries
    .filter((entry): entry is { kind: 'tools'; group: ToolGroup } => entry.kind === 'tools')
    .map((entry) => entry.group);
}

const SEARCH_RESULTS = JSON.stringify({
  query: 'universidades ia',
  results: [
    { title: 'MIT', url: 'https://www.mit.edu/ia' },
    { title: 'USP', url: 'https://usp.br/ia' },
    { title: 'MIT admissions', url: 'https://www.mit.edu/ia' },
  ],
});

describe('buildAgentTrace', () => {
  it('interleaves reasoning and tool groups following the persisted trace', () => {
    const trace: TraceStep[] = [
      { reasoning: 'Vou pesquisar faculdades.', toolCalls: 1 },
      { reasoning: 'Agora vou ler as páginas mais relevantes.', toolCalls: 2 },
      { reasoning: 'Tenho o suficiente para responder.', toolCalls: 0 },
    ];
    const tools = [
      tool({ name: 'web_search', result: SEARCH_RESULTS }),
      tool({
        name: 'fetch_url',
        arguments: '{"url":"https://mit.edu/ia"}',
        result: JSON.stringify({ url: 'https://mit.edu/ia', title: 'MIT — IA', content: '…' }),
      }),
      tool({
        name: 'fetch_url',
        arguments: '{"url":"https://usp.br/ia"}',
        result: JSON.stringify({ url: 'https://usp.br/ia', title: 'USP — IA', content: '…' }),
      }),
    ];

    const entries = buildAgentTrace({ reasoning: 'ignorado quando há trace', toolCalls: tools, trace });

    expect(entries.map((entry) => entry.kind)).toEqual([
      'reasoning',
      'tools',
      'reasoning',
      'tools',
      'reasoning',
    ]);
    expect(reasoningTexts(entries)).toEqual([
      'Vou pesquisar faculdades.',
      'Agora vou ler as páginas mais relevantes.',
      'Tenho o suficiente para responder.',
    ]);
    const groups = toolGroups(entries);
    expect(groups[0].name).toBe('web_search');
    expect(groups[0].label).toBe('Encontrou 2 páginas web');
    expect(groups[0].domains).toEqual(['mit.edu', 'usp.br']);
    expect(groups[1].name).toBe('fetch_url');
    expect(groups[1].label).toBe('Leu 2 páginas');
    expect(groups[1].pages.map((page) => page.title)).toEqual(['MIT — IA', 'USP — IA']);
  });

  it('keeps adjacent calls of the same tool in one row and separates different tools', () => {
    const trace: TraceStep[] = [{ reasoning: null, toolCalls: 3 }];
    const tools = [
      tool({ name: 'web_search', summary: '2 resultado(s)', result: null }),
      tool({ name: 'web_search', summary: '3 resultado(s)', result: null }),
      tool({ name: 'fetch_url', arguments: '{"url":"https://a.dev/x"}' }),
    ];

    const entries = buildAgentTrace({ reasoning: null, toolCalls: tools, trace });
    const groups = toolGroups(entries);

    expect(groups).toHaveLength(2);
    // Summary fallback keeps the count even when the result JSON is absent.
    expect(groups[0].label).toBe('Encontrou 5 páginas web');
    expect(groups[0].tools).toHaveLength(2);
    expect(groups[1].label).toBe('Leu 1 página');
    expect(groups[1].pages[0].title).toBe('a.dev');
    expect(countTraceTools(entries)).toBe(3);
    expect(hasTraceReasoning(entries)).toBe(false);
  });

  it('falls back to a heuristic when the message has no trace (legacy messages)', () => {
    const tools = [
      tool({ name: 'web_search', result: SEARCH_RESULTS }),
      tool({ name: 'fetch_url', arguments: '{"url":"https://mit.edu/ia"}' }),
    ];
    const entries = buildAgentTrace({
      reasoning: 'Primeiro pensamento.\n\nSegundo pensamento.',
      toolCalls: tools,
    });

    expect(reasoningTexts(entries)).toEqual(['Primeiro pensamento.', 'Segundo pensamento.']);
    expect(toolGroups(entries).map((group) => group.name)).toEqual(['web_search', 'fetch_url']);
  });

  it('renders tool calls the trace did not account for instead of hiding them', () => {
    const tools = [tool({ name: 'web_search', result: SEARCH_RESULTS }), tool({ name: 'create_file' })];
    const entries = buildAgentTrace({
      reasoning: null,
      toolCalls: tools,
      trace: [{ reasoning: null, toolCalls: 1 }],
    });

    const groups = toolGroups(entries);
    expect(groups.map((group) => group.name)).toEqual(['web_search', 'create_file']);
  });

  it('describes web searches with and without results', () => {
    const running = buildAgentTrace({
      reasoning: null,
      toolCalls: [tool({ name: 'web_search', status: 'running' })],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(running)[0].label).toBe('Buscando na web…');

    const empty = buildAgentTrace({
      reasoning: null,
      toolCalls: [tool({ name: 'web_search', result: '{"results":[]}', summary: '0 resultados' })],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(empty)[0].label).toBe('Nenhum resultado encontrado');

    const failed = buildAgentTrace({
      reasoning: null,
      toolCalls: [
        tool({ name: 'web_search', status: 'error', result: 'ERROR: a busca web está desativada' }),
      ],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(failed)[0].label).toBe('A busca web falhou');
    expect(toolGroups(failed)[0].errors).toEqual(['a busca web está desativada']);
  });

  it('describes file creation and UI validation rows', () => {
    const entries = buildAgentTrace({
      reasoning: null,
      toolCalls: [
        tool({ name: 'create_file', summary: 'relatorio.md · 1200 bytes' }),
        tool({ name: 'create_file', summary: 'dados.csv · 340 bytes' }),
        tool({ name: 'validate_ui', result: '{"ok":true}' }),
        tool({ name: 'validate_ui', result: '{"ok":true}' }),
      ],
      trace: [{ reasoning: null, toolCalls: 4 }],
    });
    const groups = toolGroups(entries);

    expect(groups[0].label).toBe('Criou 2 arquivos');
    expect(groups[0].files).toEqual(['relatorio.md', 'dados.csv']);
    expect(groups[1].label).toBe('Validou a interface 2 vezes');
  });

  it('uses failure copy for fetch and create-file groups that produced nothing', () => {
    const entries = buildAgentTrace({
      reasoning: null,
      toolCalls: [
        tool({ name: 'fetch_url', status: 'error', result: 'ERROR: HTTP 404', arguments: '{"url":"https://x.dev"}' }),
        tool({ name: 'create_file', status: 'error', result: 'ERROR: sem permissão' }),
      ],
      trace: [
        { reasoning: null, toolCalls: 1 },
        { reasoning: null, toolCalls: 1 },
      ],
    });
    const groups = toolGroups(entries);
    expect(groups[0].label).toBe('Não foi possível ler a página');
    expect(groups[0].errors).toEqual(['HTTP 404']);
    expect(groups[1].label).toBe('Falha ao criar arquivo');
    expect(groups[1].errors).toEqual(['sem permissão']);
  });

  it('groups unknown tools by name', () => {
    const entries = buildAgentTrace({
      reasoning: null,
      toolCalls: [tool({ name: 'minha_ferramenta' })],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(entries)[0].label).toBe('Executou minha ferramenta');
  });
});

describe('splitReasoning', () => {
  it('splits blank-line blocks and preserves single line breaks', () => {
    expect(splitReasoning('  Primeiro bloco.  \n\nSegunda linha.\nContinuação.\n')).toEqual([
      'Primeiro bloco.',
      'Segunda linha.\nContinuação.',
    ]);
  });

  it('strips markdown list markers so the bullet is not duplicated', () => {
    expect(splitReasoning('- item um\n- item dois\n\n1. passo')).toEqual(['item um\nitem dois', 'passo']);
  });

  it('returns an empty list for blank reasoning', () => {
    expect(splitReasoning('   \n\n ')).toEqual([]);
  });
});
