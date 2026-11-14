/**
 * Raw mono SVGs from `@lobehub/icons-static-svg` (MIT — https://icons.lobehub.com).
 *
 * Imported with Vite's `?raw` so only the provider marks the settings screen
 * needs are bundled (no icon font, no CDN request, works offline inside Tauri).
 * Each file is a 24×24 `fill="currentColor"` glyph, so the list paints it with
 * the design tokens and it stays legible in both themes.
 *
 * Keep the keys in sync with `ProviderIconKey` (`src/lib/providerIcons.ts`);
 * the unit tests assert both sides cover exactly the same keys.
 */
import type { ProviderIconKey } from './providerIcons';

import anthropicSvg from '@lobehub/icons-static-svg/icons/anthropic.svg?raw';
import geminiSvg from '@lobehub/icons-static-svg/icons/gemini.svg?raw';
import openaiSvg from '@lobehub/icons-static-svg/icons/openai.svg?raw';
import opencodeSvg from '@lobehub/icons-static-svg/icons/opencode.svg?raw';

/** SVG source per bundled provider mark. */
export const PROVIDER_ICON_SVG: Readonly<Record<ProviderIconKey, string>> = {
  opencode: opencodeSvg,
  openai: openaiSvg,
  anthropic: anthropicSvg,
  gemini: geminiSvg,
};
