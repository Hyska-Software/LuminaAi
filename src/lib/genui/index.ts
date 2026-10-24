/**
 * Superfície pública do sistema de UI generativa (contrato v2).
 *
 * Renderer: importe `parseGenUI`/`runGenUIAction` daqui. O contrato
 * (`GENUI_CONTRACT`) e os limites/ícones são a fonte única compartilhada com o
 * backend Rust — não duplique listas em outros módulos.
 */
export {
  GENUI_ACTION_KINDS,
  GENUI_BLOCKS,
  GENUI_COMPONENT_MAP,
  GENUI_COMPONENTS,
  GENUI_CONTRACT,
  GENUI_DIAGNOSTICS_PER_CODE,
  GENUI_ICONS,
  GENUI_LIMITS,
  GENUI_RULE_MAP,
  GENUI_TYPES,
} from './contract';
export type {
  GenUIActionKindSpec,
  GenUIArraySpec,
  GenUIComponentCategory,
  GenUIComponentKind,
  GenUIComponentSpec,
  GenUIContract,
  GenUIDesignRule,
  GenUIDesignRuleCategory,
  GenUIItemSpec,
  GenUIPropSpec,
  GenUIPropType,
} from './contract';
export { capDiagnostics, createDiagnosticSink } from './diagnostics';
export type { DiagnosticSink } from './diagnostics';
export { lintGenUI } from './lint';
export { normalizeGenUI } from './normalize';
export type { GenUINormalizeResult } from './normalize';
export {
  CHART_TYPES,
  asStringArray,
  chartFromProps,
  parseChartSpec,
  parseGenUI,
  propArray,
  propBool,
  propNumber,
  propObjectArray,
  propString,
} from './schema';
export type { ChartDatum, ChartKind, ChartSpec } from './schema';
export type {
  GenUIComponent,
  GenUIDiagnostic,
  GenUIDiagnosticSeverity,
  GenUIParseResult,
  GenUISpec,
  GenUIValue,
} from './types';
export { runGenUIAction } from './actions';
export type { GenUIActionItem, GenUIActionOutcome } from './actions';
export { isSvgMarkup, sanitizeSvg } from './sanitize';
export { isExternalUrl, openExternal } from './open-external';
