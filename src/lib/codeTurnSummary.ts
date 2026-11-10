/**
 * View model do fecho de turno do layout Code (WORKBENCH §5.1): resume o que o
 * agente fez em **um turno** — os arquivos alterados, com `+N −M` por arquivo e
 * totais, como no card de fecho de execução.
 *
 * A fonte é o próprio turno persistido: `ChatMessage.toolCalls[].presentation`
 * com `kind: 'file_change'` (gravado pelo harness em `write_file`/`edit_file` no
 * journal e persistido no SQLite junto da mensagem). Derivar daí — em vez de
 * adicionar um payload novo de backend — mantém o card disponível ao reabrir a
 * sessão e não duplica estado entre Rust e React.
 *
 * Regras:
 * - só mensagens do assistente (um turno = uma mensagem final);
 * - chamadas que falharam não entram (o arquivo não mudou);
 * - uma linha por path: edições repetidas no mesmo turno somam `added`/`removed`
 *   e o último `kind` vence;
 * - lista ordenada por path (como o painel Alterações), determinística.
 */
import { compareText } from './i18n/format';
import type { ChatMessage, FileChangeKind } from './types';

/** Um arquivo alterado no turno (linha do resumo). */
export interface CodeTurnSummaryFile {
  /** Caminho relativo ao workspace, sempre com `/`. */
  path: string;
  kind: FileChangeKind;
  added: number;
  removed: number;
  /**
   * Último diff não vazio conhecido do arquivo no turno (o harness persiste o
   * `presentation.diff` truncado em 12k chars). Permite abrir a aba de diff
   * sem IPC; ausente quando nenhum payload antigo trouxe o patch.
   */
  diff?: string;
}

/** Resumo de um turno do layout Code. */
export interface CodeTurnSummaryModel {
  /** Arquivos alterados, ordenados por path (pt-BR). Nunca vazio. */
  files: CodeTurnSummaryFile[];
  /** Total de linhas adicionadas no turno. */
  added: number;
  /** Total de linhas removidas no turno. */
  removed: number;
}

const CHANGE_KINDS: readonly FileChangeKind[] = ['created', 'modified', 'deleted', 'renamed'];

/** Normaliza um `change` vindo de JSON persistido (defesa contra payload antigo). */
function normalizeKind(kind: unknown): FileChangeKind {
  return typeof kind === 'string' && (CHANGE_KINDS as readonly string[]).includes(kind)
    ? (kind as FileChangeKind)
    : 'modified';
}

/** Contagem de linhas segura (nunca negativa/NaN). */
function normalizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

/**
 * Resume as alterações de arquivo de um turno do Code.
 *
 * Retorna `null` quando a mensagem não é do assistente ou quando nenhuma tool
 * do turno alterou arquivos (o card não deve aparecer).
 */
export function buildCodeTurnSummary(
  message: Pick<ChatMessage, 'role' | 'toolCalls'>,
): CodeTurnSummaryModel | null {
  if (message.role !== 'assistant') return null;

  const byPath = new Map<string, CodeTurnSummaryFile>();

  for (const tool of message.toolCalls ?? []) {
    if (!tool || tool.status === 'error') continue;
    const presentation = tool.presentation;
    if (!presentation || presentation.kind !== 'file_change') continue;

    const path = typeof presentation.path === 'string' ? presentation.path.trim() : '';
    if (!path) continue;

    const added = normalizeCount(presentation.added);
    const removed = normalizeCount(presentation.removed);
    // Um diff vazio não substitui o patch real de uma edição anterior.
    const diff =
      typeof presentation.diff === 'string' && presentation.diff.trim().length > 0
        ? presentation.diff
        : null;
    const existing = byPath.get(path);
    if (existing) {
      existing.added += added;
      existing.removed += removed;
      existing.kind = normalizeKind(presentation.change);
      if (diff) existing.diff = diff;
    } else {
      byPath.set(path, {
        path,
        kind: normalizeKind(presentation.change),
        added,
        removed,
        ...(diff ? { diff } : {}),
      });
    }
  }

  if (byPath.size === 0) return null;

  const files = [...byPath.values()].sort((left, right) => compareText(left.path, right.path));

  return {
    files,
    added: files.reduce((total, file) => total + file.added, 0),
    removed: files.reduce((total, file) => total + file.removed, 0),
  };
}
