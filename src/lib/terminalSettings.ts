/**
 * Terminal typography shared by Settings › Terminal and the xterm manager.
 * The Rust side mirrors the same bounds in `config.rs`.
 */
export const TERMINAL_FONT_SIZE_MIN = 8;
export const TERMINAL_FONT_SIZE_MAX = 32;
export const TERMINAL_FONT_SIZE_DEFAULT = 12;

/** Longest accepted custom font-family string (mirrors the settings input). */
export const TERMINAL_FONT_FAMILY_MAX_LENGTH = 200;

/** Clamps a persisted or slider value to the accepted px range. */
export function normalizeTerminalFontSize(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return TERMINAL_FONT_SIZE_DEFAULT;
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(value)));
}
