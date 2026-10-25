/**
 * Syntax highlighting shared by the chat and the artifact previews.
 *
 * - `prism` — single Prism instance with the extra grammars registered.
 * - `normalizeLanguage` / `languageLabel` — language ids and pt-BR badge labels.
 * - `SYNTAX_THEME` — Lumina token-based Prism theme.
 */
export { prism, Prism } from './prism';
export { normalizeLanguage, languageLabel } from './languages';
export { SYNTAX_THEME } from './theme';
