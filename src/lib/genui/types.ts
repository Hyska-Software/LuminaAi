/**
 * Tipos neutros da UI generativa (contrato v2).
 *
 * `GenUIValue` cobre apenas JSON válido: nada de funções, classes, datas ou
 * referências — a árvore inteira vem do modelo como texto JSON e é
 * normalizada/validada contra `data/genui-contract.json`.
 */

export type GenUIValue = string | number | boolean | null | GenUIValue[] | { [key: string]: GenUIValue };

/** Um nó da árvore declarativa. `type` é validado contra o contrato. */
export interface GenUIComponent {
  type: string;
  props?: Record<string, GenUIValue>;
  children?: GenUIComponent[];
}

/** Árvore pronta para render: somente componentes normalizados e válidos. */
export interface GenUISpec {
  components: GenUIComponent[];
}

export type GenUIDiagnosticSeverity = 'error' | 'warning';

/**
 * Diagnóstico de validação/normalização/lint. `path` aponta para o nó exato
 * (ex.: `components[0].children[1].props.items[2]`), o que permite ao agente
 * corrigir o JSON sem adivinhar onde está o problema.
 */
export interface GenUIDiagnostic {
  code: string;
  severity: GenUIDiagnosticSeverity;
  path: string;
  message: string;
  hint?: string;
}

/** Resultado de `parseGenUI`: `spec` só existe quando não há nenhum erro. */
export interface GenUIParseResult {
  spec: GenUISpec | null;
  /** Erros + avisos (lint de design incluso). */
  diagnostics: GenUIDiagnostic[];
  /** Primeira mensagem de erro, para exibição compacta. */
  error: string | null;
  /** Apenas avisos (design), na ordem de descoberta. */
  warnings: GenUIDiagnostic[];
}
