/**
 * Menções `@arquivo` do composer do modo Code. Nesta fase os arquivos não
 * entram como anexos (o `TurnPayload` não muda): o texto enviado carrega o
 * marcador estruturado que o harness resolve no turno.
 */
export interface MentionedFile {
  /** Caminho relativo ao workspace, sempre com `/`. */
  path: string;
}

/** Marcador enviado no `content` (docs/goals/code-harness/WORKBENCH.md §6). */
export function formatMention(file: MentionedFile): string {
  return `[arquivo: ${file.path}]`;
}

/** Remove uma menção já adicionada (comparação por caminho). */
export function withoutMention(files: MentionedFile[], path: string): MentionedFile[] {
  return files.filter((file) => file.path !== path);
}

/** Acrescenta sem duplicar (o mesmo arquivo pode ser mencionado uma vez). */
export function addMention(files: MentionedFile[], path: string): MentionedFile[] {
  return files.some((file) => file.path === path) ? files : [...files, { path }];
}

/**
 * Monta o texto do turno: mensagem digitada + marcadores das menções. Os
 * marcadores ficam em linhas próprias para o harness separar contexto de pedido.
 */
export function composeMessage(value: string, mentions: MentionedFile[]): string {
  const text = value.trim();
  const tokens = mentions.map(formatMention);
  return [text, ...tokens].filter((part) => part.length > 0).join('\n\n');
}
