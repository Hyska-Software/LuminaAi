import { describe, expect, it } from 'vitest';
import type { FileChangeKind, ChatMessage, ToolCallRecord, ToolPresentation } from '../types';
import { buildCodeTurnSummary } from '../codeTurnSummary';

interface FileChangeInput {
  path?: string;
  change?: FileChangeKind;
  added?: number;
  removed?: number;
  diff?: string | null;
}

function fileChange(overrides: FileChangeInput = {}): ToolPresentation {
  return {
    kind: 'file_change',
    path: overrides.path ?? 'src/app.ts',
    change: overrides.change ?? 'modified',
    added: overrides.added ?? 1,
    removed: overrides.removed ?? 0,
    ...(overrides.diff !== undefined ? { diff: overrides.diff } : {}),
  };
}

function tool(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    id: 'call-1',
    name: 'edit_file',
    arguments: '{}',
    status: 'done',
    presentation: null,
    ...overrides,
  };
}

function assistant(toolCalls: ToolCallRecord[]): Pick<ChatMessage, 'role' | 'toolCalls'> {
  return { role: 'assistant', toolCalls };
}

describe('buildCodeTurnSummary', () => {
  it('retorna null para mensagens que não são do assistente', () => {
    expect(
      buildCodeTurnSummary({
        role: 'user',
        toolCalls: [tool({ presentation: fileChange() })],
      }),
    ).toBeNull();
  });

  it('retorna null sem alterações de arquivo', () => {
    expect(buildCodeTurnSummary(assistant([]))).toBeNull();
    expect(
      buildCodeTurnSummary(
        assistant([
          tool({ name: 'read_file' }),
          tool({ presentation: { kind: 'todos', items: [] } }),
        ]),
      ),
    ).toBeNull();
  });

  it('agrega as chamadas de escrita por path e calcula os totais', () => {
    const summary = buildCodeTurnSummary(
      assistant([
        tool({ id: 'a', presentation: fileChange({ path: 'src/app.ts', added: 12, removed: 3 }) }),
        tool({
          id: 'b',
          presentation: fileChange({ path: 'docs/DESIGN.md', change: 'created', added: 44, removed: 0 }),
        }),
        tool({ id: 'c', name: 'read_file' }),
      ]),
    );

    expect(summary).not.toBeNull();
    expect(summary?.files.map((file) => file.path)).toEqual(['docs/DESIGN.md', 'src/app.ts']);
    expect(summary?.files[0]).toEqual({
      path: 'docs/DESIGN.md',
      kind: 'created',
      added: 44,
      removed: 0,
    });
    expect(summary?.files[1]).toEqual({ path: 'src/app.ts', kind: 'modified', added: 12, removed: 3 });
    expect(summary?.added).toBe(56);
    expect(summary?.removed).toBe(3);
  });

  it('soma edições repetidas no mesmo arquivo e mantém o último kind', () => {
    const summary = buildCodeTurnSummary(
      assistant([
        tool({ id: 'a', presentation: fileChange({ path: 'src/a.ts', change: 'created', added: 5 }) }),
        tool({ id: 'b', presentation: fileChange({ path: 'src/a.ts', added: 2, removed: 1 }) }),
      ]),
    );

    expect(summary?.files).toHaveLength(1);
    expect(summary?.files[0]).toEqual({
      path: 'src/a.ts',
      kind: 'modified',
      added: 7,
      removed: 1,
    });
    expect(summary?.added).toBe(7);
    expect(summary?.removed).toBe(1);
  });

  it('ignora chamadas que falharam', () => {
    const summary = buildCodeTurnSummary(
      assistant([
        tool({ id: 'ok', presentation: fileChange({ path: 'src/ok.ts', added: 2 }) }),
        tool({
          id: 'failed',
          status: 'error',
          presentation: fileChange({ path: 'src/failed.ts', added: 9 }),
        }),
      ]),
    );

    expect(summary?.files.map((file) => file.path)).toEqual(['src/ok.ts']);
    expect(summary?.added).toBe(2);
  });

  it('guarda o último diff não vazio de cada arquivo para abrir a aba', () => {
    const summary = buildCodeTurnSummary(
      assistant([
        tool({
          id: 'a',
          presentation: fileChange({ path: 'src/a.ts', diff: '@@ -1 +1 @@\n-antes\n+depois' }),
        }),
        // Edição sem mudança efetiva: não sobrescreve o patch anterior.
        tool({ id: 'b', presentation: fileChange({ path: 'src/a.ts', diff: '  ' }) }),
        tool({
          id: 'c',
          presentation: fileChange({ path: 'src/b.ts', diff: '@@ -0,0 +1 @@\n+novo' }),
        }),
      ]),
    );

    expect(summary?.files[0]?.diff).toBe('@@ -1 +1 @@\n-antes\n+depois');
    expect(summary?.files[1]?.diff).toBe('@@ -0,0 +1 @@\n+novo');
  });

  it('tolera payload persistido incompleto sem quebrar', () => {
    const summary = buildCodeTurnSummary(
      assistant([
        tool({
          id: 'legacy',
          presentation: { kind: 'file_change', path: '   ' } as unknown as ToolPresentation,
        }),
        tool({
          id: 'partial',
          presentation: { kind: 'file_change', path: 'src/partial.ts' } as unknown as ToolPresentation,
        }),
      ]),
    );

    expect(summary?.files).toEqual([
      { path: 'src/partial.ts', kind: 'modified', added: 0, removed: 0 },
    ]);
  });

  it('mostra arquivos removidos só com linhas removidas', () => {
    const summary = buildCodeTurnSummary(
      assistant([
        tool({
          presentation: fileChange({ path: 'src/old.ts', change: 'deleted', added: 0, removed: 17 }),
        }),
      ]),
    );

    expect(summary?.files[0]).toEqual({
      path: 'src/old.ts',
      kind: 'deleted',
      added: 0,
      removed: 17,
    });
    expect(summary?.added).toBe(0);
    expect(summary?.removed).toBe(17);
  });
});
