import { describe, expect, it } from 'vitest';
import {
  buildAgentTrace,
  countTraceTools,
  describeCodeTool,
  hasTraceReasoning,
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

  it('normalizes the subagent type (default explore and general in pt-BR)', () => {
    const explore = describeCodeTool(
      tool({
        name: 'task',
        arguments: JSON.stringify({ description: 'Mapear src', prompt: 'Liste os arquivos' }),
      }),
    );
    expect(explore.verb).toBe('Delegou exploração a um subagente');

    const general = describeCodeTool(
      tool({
        name: 'task',
        arguments: JSON.stringify({
          description: 'Investigar',
          prompt: 'Resuma',
          subagent_type: 'general',
        }),
      }),
    );
    expect(general.verb).toBe('Delegou geral a um subagente');

    const review = describeCodeTool(
      tool({
        name: 'task',
        arguments: JSON.stringify({
          description: 'Revisar',
          prompt: 'Aponte bugs',
          subagent_type: 'review',
        }),
      }),
    );
    expect(review.verb).toBe('Delegou revisão a um subagente');
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

  it('falls back to a single reasoning block when the message has no trace (legacy messages)', () => {
    const tools = [
      tool({ name: 'web_search', result: SEARCH_RESULTS }),
      tool({ name: 'fetch_url', arguments: '{"url":"https://mit.edu/ia"}' }),
    ];
    const reasoning = 'Primeiro pensamento.\n\nSegundo pensamento.';
    const entries = buildAgentTrace({ reasoning, toolCalls: tools });

    // Legacy messages have no step boundaries: the whole raw reasoning is one
    // Markdown block, followed by every tool group.
    expect(reasoningTexts(entries)).toEqual([reasoning]);
    expect(entries.map((entry) => entry.kind)).toEqual(['reasoning', 'tools', 'tools']);
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

  it('describes code execution rows with a short summary detail', () => {
    const running = buildAgentTrace({
      reasoning: null,
      toolCalls: [tool({ name: 'run_code', status: 'running' })],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(running)[0].label).toBe('Executando código…');

    const done = buildAgentTrace({
      reasoning: null,
      toolCalls: [tool({ name: 'run_code', summary: 'python · 2 arquivos · 1.2s' })],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(done)[0].label).toBe('Executou código · python · 2 arquivos');

    const withoutSummary = buildAgentTrace({
      reasoning: null,
      toolCalls: [tool({ name: 'run_code' })],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(withoutSummary)[0].label).toBe('Executou código');

    const failed = buildAgentTrace({
      reasoning: null,
      toolCalls: [
        tool({
          name: 'run_code',
          status: 'error',
          result: 'ERROR: interpretador python não encontrado',
        }),
      ],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    const failedGroup = toolGroups(failed)[0];
    expect(failedGroup.label).toBe('A execução de código falhou');
    expect(failedGroup.errors).toEqual(['interpretador python não encontrado']);
  });

  it('keeps adjacent code runs in a single row next to a skills listing', () => {
    const entries = buildAgentTrace({
      reasoning: null,
      toolCalls: [
        tool({ name: 'run_code', summary: 'python · 1 arquivo · 0.4s' }),
        tool({ name: 'run_code', summary: 'javascript · 2 arquivos · 0.2s' }),
        tool({ name: 'list_skills', result: '[]' }),
      ],
      trace: [{ reasoning: null, toolCalls: 3 }],
    });
    const groups = toolGroups(entries);

    expect(groups).toHaveLength(2);
    expect(groups[0].tools).toHaveLength(2);
    expect(groups[0].label).toBe('Executou código · javascript · 2 arquivos');
    expect(groups[1].label).toBe('Consultou as skills disponíveis');
  });

  it('describes skills listing and reading rows', () => {
    const listing = buildAgentTrace({
      reasoning: null,
      toolCalls: [tool({ name: 'list_skills', status: 'running' })],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(listing)[0].label).toBe('Consultando skills…');

    const reading = buildAgentTrace({
      reasoning: null,
      toolCalls: [
        tool({ name: 'read_skill', status: 'running', arguments: '{"name":"office-docx"}' }),
      ],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(reading)[0].label).toBe('Lendo skill office-docx…');

    const read = buildAgentTrace({
      reasoning: null,
      toolCalls: [tool({ name: 'read_skill', arguments: '{"name":"office-docx"}' })],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(read)[0].label).toBe('Leu a skill office-docx');
  });

  it('falls back to generic labels when a skill name is missing or invalid', () => {
    const cases: Array<{ arguments: string; status: ToolCallRecord['status']; label: string }> = [
      { arguments: '{}', status: 'done', label: 'Leu uma skill' },
      { arguments: '{oops', status: 'done', label: 'Leu uma skill' },
      { arguments: 'null', status: 'done', label: 'Leu uma skill' },
      { arguments: '"office-docx"', status: 'done', label: 'Leu uma skill' },
      { arguments: '{"name":42}', status: 'running', label: 'Lendo skill…' },
      { arguments: '{"name":"   "}', status: 'done', label: 'Leu uma skill' },
    ];

    for (const testCase of cases) {
      const entries = buildAgentTrace({
        reasoning: null,
        toolCalls: [
          tool({ name: 'read_skill', arguments: testCase.arguments, status: testCase.status }),
        ],
        trace: [{ reasoning: null, toolCalls: 1 }],
      });
      expect(toolGroups(entries)[0].label).toBe(testCase.label);
    }

    const failed = buildAgentTrace({
      reasoning: null,
      toolCalls: [
        tool({
          name: 'read_skill',
          arguments: '{"name":"pdf"}',
          status: 'error',
          result: 'ERROR: skill não encontrada',
        }),
      ],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(failed)[0].label).toBe('Não foi possível ler a skill');
    expect(toolGroups(failed)[0].errors).toEqual(['skill não encontrada']);
  });

  it('describes artifact library searches with and without results', () => {
    const running = buildAgentTrace({
      reasoning: null,
      toolCalls: [tool({ name: 'list_artifacts', status: 'running' })],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(running)[0].label).toBe('Pesquisando nos artefatos…');

    const found = buildAgentTrace({
      reasoning: null,
      toolCalls: [tool({ name: 'list_artifacts', summary: '3 artefatos' })],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(found)[0].label).toBe('Encontrou 3 artefatos');
    expect(toolGroups(found)[0].total).toBe(3);
    expect(toolGroups(found)[0].files).toEqual([]);

    // "3 de 10 artefatos": only the returned count belongs in the label.
    const partial = buildAgentTrace({
      reasoning: null,
      toolCalls: [tool({ name: 'list_artifacts', summary: '3 de 10 artefatos' })],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(partial)[0].label).toBe('Encontrou 3 artefatos');

    const empty = buildAgentTrace({
      reasoning: null,
      toolCalls: [
        tool({ name: 'list_artifacts', summary: 'nenhum artefato' }),
        tool({ name: 'list_artifacts', summary: '0 artefatos' }),
      ],
      trace: [{ reasoning: null, toolCalls: 2 }],
    });
    expect(toolGroups(empty)[0].label).toBe('Nenhum artefato encontrado');

    const withoutSummary = buildAgentTrace({
      reasoning: null,
      toolCalls: [tool({ name: 'list_artifacts', summary: 'ok' })],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(withoutSummary)[0].label).toBe('Consultou os artefatos');

    // Adjacent searches stay in one row and their counts add up.
    const multiple = buildAgentTrace({
      reasoning: null,
      toolCalls: [
        tool({ name: 'list_artifacts', summary: '2 artefatos' }),
        tool({ name: 'list_artifacts', summary: '1 artefato' }),
      ],
      trace: [{ reasoning: null, toolCalls: 2 }],
    });
    expect(toolGroups(multiple)[0].tools).toHaveLength(2);
    expect(toolGroups(multiple)[0].label).toBe('Encontrou 3 artefatos');

    const failed = buildAgentTrace({
      reasoning: null,
      toolCalls: [
        tool({
          name: 'list_artifacts',
          status: 'error',
          result: 'ERROR: falha ao consultar a biblioteca',
        }),
      ],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(failed)[0].label).toBe('A pesquisa nos artefatos falhou');
    expect(toolGroups(failed)[0].errors).toEqual(['falha ao consultar a biblioteca']);
  });

  it('describes artifact reads using the summary name and the arguments fallback', () => {
    const running = buildAgentTrace({
      reasoning: null,
      toolCalls: [
        tool({
          name: 'read_artifact',
          status: 'running',
          summary: 'relatorio.docx · 1.200 caracteres',
        }),
      ],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(running)[0].label).toBe('Lendo o artefato relatorio.docx…');
    expect(toolGroups(running)[0].files).toEqual(['relatorio.docx']);

    const anonymous = buildAgentTrace({
      reasoning: null,
      toolCalls: [tool({ name: 'read_artifact', status: 'running' })],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(anonymous)[0].label).toBe('Lendo um artefato…');

    const read = buildAgentTrace({
      reasoning: null,
      toolCalls: [tool({ name: 'read_artifact', summary: 'relatorio.docx · 1.200 caracteres' })],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(read)[0].label).toBe('Leu o artefato relatorio.docx');
    expect(toolGroups(read)[0].files).toEqual(['relatorio.docx']);

    // `read_artifact` may be called by id only: the name then comes from arguments.
    const byNameArg = buildAgentTrace({
      reasoning: null,
      toolCalls: [tool({ name: 'read_artifact', arguments: '{"name":"dados.csv"}' })],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(byNameArg)[0].label).toBe('Leu o artefato dados.csv');

    const multiple = buildAgentTrace({
      reasoning: null,
      toolCalls: [
        tool({ name: 'read_artifact', summary: 'relatorio.docx · 1.200 caracteres' }),
        tool({ name: 'read_artifact', arguments: '{"name":"dados.csv"}' }),
      ],
      trace: [{ reasoning: null, toolCalls: 2 }],
    });
    expect(toolGroups(multiple)[0].label).toBe('Leu 2 artefatos');
    expect(toolGroups(multiple)[0].files).toEqual(['relatorio.docx', 'dados.csv']);

    const repeated = buildAgentTrace({
      reasoning: null,
      toolCalls: [
        tool({ name: 'read_artifact', arguments: '{"name":"notas.md"}' }),
        tool({ name: 'read_artifact', arguments: '{"name":"notas.md"}' }),
      ],
      trace: [{ reasoning: null, toolCalls: 2 }],
    });
    expect(toolGroups(repeated)[0].label).toBe('Leu o artefato notas.md');
    expect(toolGroups(repeated)[0].files).toEqual(['notas.md']);

    const failed = buildAgentTrace({
      reasoning: null,
      toolCalls: [
        tool({ name: 'read_artifact', status: 'error', result: 'ERROR: arquivo não encontrado' }),
      ],
      trace: [{ reasoning: null, toolCalls: 1 }],
    });
    expect(toolGroups(failed)[0].label).toBe('Não foi possível ler o artefato');
    expect(toolGroups(failed)[0].errors).toEqual(['arquivo não encontrado']);
    expect(toolGroups(failed)[0].files).toEqual([]);
  });

  it('falls back to generic artifact-read copy when the name is missing or invalid', () => {
    const cases: Array<{ arguments: string; status: ToolCallRecord['status']; label: string }> = [
      { arguments: '{}', status: 'done', label: 'Leu um artefato' },
      { arguments: '{oops', status: 'done', label: 'Leu um artefato' },
      { arguments: 'null', status: 'done', label: 'Leu um artefato' },
      { arguments: '"relatorio.docx"', status: 'done', label: 'Leu um artefato' },
      { arguments: '{"name":42}', status: 'running', label: 'Lendo um artefato…' },
      { arguments: '{"name":"   "}', status: 'done', label: 'Leu um artefato' },
      { arguments: '{"name":"dados.csv"}', status: 'running', label: 'Lendo o artefato dados.csv…' },
    ];

    for (const testCase of cases) {
      const entries = buildAgentTrace({
        reasoning: null,
        toolCalls: [
          tool({ name: 'read_artifact', arguments: testCase.arguments, status: testCase.status }),
        ],
        trace: [{ reasoning: null, toolCalls: 1 }],
      });
      expect(toolGroups(entries)[0].label).toBe(testCase.label);
    }
  });
});

describe('buildAgentTrace — Markdown do raciocínio', () => {
  it('emits exactly one raw reasoning entry per trace step (never splits paragraphs)', () => {
    const text = [
      '### Plano',
      '',
      'Vou verificar os arquivos.',
      '',
      '- item um',
      '- item dois',
      '',
      '| coluna | valor |',
      '| --- | --- |',
      '| a | 1 |',
      '',
      'A fórmula $x^2$ explica.',
    ].join('\n');

    const entries = buildAgentTrace({
      reasoning: null,
      toolCalls: [],
      trace: [{ reasoning: text, toolCalls: 0 }],
    });

    // One entry per step, with the raw Markdown — blank lines included.
    expect(entries).toHaveLength(1);
    expect(reasoningTexts(entries)).toEqual([text]);
  });

  it('preserves list markers and indentation instead of flattening bullets', () => {
    const text = '- item um\n- item dois\n  - aninhado\n\n1. passo';

    const entries = buildAgentTrace({
      reasoning: null,
      toolCalls: [],
      trace: [{ reasoning: text, toolCalls: 0 }],
    });

    expect(reasoningTexts(entries)).toEqual([text]);
  });

  it('keeps a fenced block with an internal blank line in the same entry', () => {
    const fence = ['```ts', 'const a = 1;', '', 'const b = 2;', '```', '', 'Depois do bloco.'].join(
      '\n',
    );

    const entries = buildAgentTrace({
      reasoning: null,
      toolCalls: [],
      trace: [{ reasoning: fence, toolCalls: 0 }],
    });

    expect(reasoningTexts(entries)).toEqual([fence]);
  });

  it('keeps heading, list and table together in a single Markdown entry', () => {
    const text = [
      '## Diagnóstico',
      '',
      '- causa provável: cache',
      '- próxima ação: limpar',
      '',
      '| arquivo | status |',
      '| --- | --- |',
      '| cache.ts | revisar |',
    ].join('\n');

    const entries = buildAgentTrace({
      reasoning: null,
      toolCalls: [],
      trace: [{ reasoning: text, toolCalls: 0 }],
    });

    expect(reasoningTexts(entries)).toEqual([text]);
  });

  it('keeps math and GitHub alerts untouched', () => {
    const text = 'Cálculo: $\\sum_{i=1}^{n} i$.\n\n> [!NOTE]\n> Continua como alerta.';

    const entries = buildAgentTrace({
      reasoning: null,
      toolCalls: [],
      trace: [{ reasoning: text, toolCalls: 0 }],
    });

    expect(reasoningTexts(entries)).toEqual([text]);
  });

  it('keeps blank-line separated paragraphs in one entry (only the edges are trimmed)', () => {
    const text = 'Primeiro parágrafo.\n\nSegundo parágrafo.\n\n- lista final';

    const entries = buildAgentTrace({
      reasoning: null,
      toolCalls: [],
      trace: [{ reasoning: `  \n${text}\n  `, toolCalls: 0 }],
    });

    expect(reasoningTexts(entries)).toEqual([text]);
  });

  it('skips blank reasoning and emits one entry per non-empty step', () => {
    const first = '**Primeiro** passo.\n\n- um\n- dois';
    const second = '### Segundo\n\n```ts\nconst x = 1;\n```';
    const entries = buildAgentTrace({
      reasoning: null,
      toolCalls: [],
      trace: [
        { reasoning: null, toolCalls: 0 },
        { reasoning: '   \n\t ', toolCalls: 0 },
        { reasoning: first, toolCalls: 0 },
        { reasoning: second, toolCalls: 0 },
      ],
    });

    expect(reasoningTexts(entries)).toEqual([first, second]);
    expect(entries.map((entry) => entry.kind)).toEqual(['reasoning', 'reasoning']);
  });

  it('keeps each step reasoning stable between builds (Markdown is memoized)', () => {
    const first = '**Passo** um.\n\n- a\n- b';
    const second = '## Passo dois';
    const message = {
      reasoning: null,
      toolCalls: [] as ToolCallRecord[],
      trace: [
        { reasoning: first, toolCalls: 0 },
        { reasoning: second, toolCalls: 0 },
      ],
    };

    const one = reasoningTexts(buildAgentTrace(message));
    const two = reasoningTexts(buildAgentTrace(message));

    expect(one).toEqual([first, second]);
    expect(two).toEqual(one);
    expect(two[0]).toBe(first);
    expect(two[1]).toBe(second);
  });

  it('keeps the raw Markdown of the legacy reasoning fallback in one block', () => {
    const reasoning = '# Título\n\n- um\n- dois\n\n```ts\nconst a = 1;\n```';

    const entries = buildAgentTrace({
      reasoning: `  ${reasoning}  `,
      toolCalls: [tool({ name: 'web_search', result: SEARCH_RESULTS })],
    });

    expect(reasoningTexts(entries)).toEqual([reasoning]);
    expect(entries.map((entry) => entry.kind)).toEqual(['reasoning', 'tools']);
  });

  it('interleaves per-step Markdown with the tool groups of that step', () => {
    const first = 'Buscando **fontes**.';
    const second = '- leitura\n- análise';
    const entries = buildAgentTrace({
      reasoning: null,
      toolCalls: [
        tool({ name: 'web_search', result: SEARCH_RESULTS }),
        tool({ name: 'fetch_url', arguments: '{"url":"https://mit.edu/ia"}' }),
      ],
      trace: [
        { reasoning: first, toolCalls: 1 },
        { reasoning: second, toolCalls: 1 },
      ],
    });

    expect(entries.map((entry) => entry.kind)).toEqual(['reasoning', 'tools', 'reasoning', 'tools']);
    expect(reasoningTexts(entries)).toEqual([first, second]);
    expect(toolGroups(entries).map((group) => group.name)).toEqual(['web_search', 'fetch_url']);
  });
});

describe('buildAgentTrace — objetivo (Goal)', () => {
  const goal = (overrides: Record<string, unknown> = {}) => ({
    kind: 'goal' as const,
    title: 'Objetivo',
    objective: 'Concluir a refatoração.',
    status: 'active' as const,
    autoContinue: true,
    rounds: 2,
    maxRounds: 25,
    revision: 3,
    origin: 'user' as const,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  });

  it('agrupa chamadas da tool goal em uma linha com rótulo pt-BR', () => {
    const entries = buildAgentTrace({
      reasoning: null,
      toolCalls: [
        tool({ name: 'goal', presentation: goal({ status: 'completed' }) }),
      ],
    });
    const groups = toolGroups(entries);
    expect(groups.map((group) => group.name)).toEqual(['goal']);
    expect(groups[0].label).toBe('Objetivo concluído');
  });

  it('descreve progresso, bloqueio e falha da tool goal', () => {
    const progress = toolGroups(
      buildAgentTrace({
        reasoning: null,
        toolCalls: [tool({ name: 'goal', presentation: goal() })],
      }),
    )[0];
    expect(progress.label).toBe('Progrediu no objetivo');

    const blocked = toolGroups(
      buildAgentTrace({
        reasoning: null,
        toolCalls: [tool({ name: 'goal', presentation: goal({ status: 'blocked' }) })],
      }),
    )[0];
    expect(blocked.label).toBe('Objetivo bloqueado');

    const failed = toolGroups(
      buildAgentTrace({
        reasoning: null,
        toolCalls: [tool({ name: 'goal', status: 'error', result: 'falhou' })],
      }),
    )[0];
    expect(failed.label).toBe('Falha ao atualizar o objetivo');
  });
});