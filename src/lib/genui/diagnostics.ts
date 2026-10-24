/**
 * Utilidades de diagnóstico compartilhadas pelo normalizador e pelo lint.
 *
 * O pipeline nunca lança exceção: problemas viram `GenUIDiagnostic` com código
 * estável, caminho no JSON e mensagem em pt-BR. O agente recebe esses mesmos
 * diagnósticos pela ferramenta `validate_ui`, então os códigos são contrato.
 */
import type { GenUIDiagnostic } from './types';

/** Fábrica usada pelo pipeline para acumular diagnósticos sem duplicação. */
export interface DiagnosticSink {
  add(diagnostic: GenUIDiagnostic): void;
  list(): GenUIDiagnostic[];
}

export function createDiagnosticSink(): DiagnosticSink {
  const diagnostics: GenUIDiagnostic[] = [];
  return {
    add(diagnostic) {
      diagnostics.push(diagnostic);
    },
    list() {
      return diagnostics;
    },
  };
}

/**
 * Limita repetições do mesmo código (ex.: 300 nós inválidos não podem virar 300
 * linhas de feedback). Mantém a primeira ocorrência de cada código, que é a
 * mais próxima do início da árvore e costuma ser a causa raiz.
 */
export function capDiagnostics(diagnostics: GenUIDiagnostic[], perCode: number): GenUIDiagnostic[] {
  const seen = new Map<string, number>();
  const capped: GenUIDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const count = seen.get(diagnostic.code) ?? 0;
    if (count >= perCode) continue;
    seen.set(diagnostic.code, count + 1);
    capped.push(diagnostic);
  }
  return capped;
}
