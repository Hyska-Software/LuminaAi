/**
 * Raw mono SVGs from `@lobehub/icons-static-svg` (MIT — https://icons.lobehub.com).
 *
 * Imported with Vite's `?raw` so only the 16 marks we map are in the bundle
 * (no icon font, no CDN request, works offline inside Tauri). Each file is a
 * 24×24 `fill="currentColor"` glyph, so the avatar tints it via the design
 * tokens and it stays legible in both themes.
 *
 * Keep the keys in sync with `ModelIconKey` (`src/lib/modelIcons.ts`); the
 * unit tests assert both sides cover exactly the same keys.
 */
import type { ModelIconKey } from './modelIcons';

import claudeSvg from '@lobehub/icons-static-svg/icons/claude.svg?raw';
import deepseekSvg from '@lobehub/icons-static-svg/icons/deepseek.svg?raw';
import geminiSvg from '@lobehub/icons-static-svg/icons/gemini.svg?raw';
import grokSvg from '@lobehub/icons-static-svg/icons/grok.svg?raw';
import hunyuanSvg from '@lobehub/icons-static-svg/icons/hunyuan.svg?raw';
import kimiSvg from '@lobehub/icons-static-svg/icons/kimi.svg?raw';
import longcatSvg from '@lobehub/icons-static-svg/icons/longcat.svg?raw';
import metaSvg from '@lobehub/icons-static-svg/icons/meta.svg?raw';
import minimaxSvg from '@lobehub/icons-static-svg/icons/minimax.svg?raw';
import mistralSvg from '@lobehub/icons-static-svg/icons/mistral.svg?raw';
import nvidiaSvg from '@lobehub/icons-static-svg/icons/nvidia.svg?raw';
import openaiSvg from '@lobehub/icons-static-svg/icons/openai.svg?raw';
import qwenSvg from '@lobehub/icons-static-svg/icons/qwen.svg?raw';
import stepfunSvg from '@lobehub/icons-static-svg/icons/stepfun.svg?raw';
import xiaomimimoSvg from '@lobehub/icons-static-svg/icons/xiaomimimo.svg?raw';
import zaiSvg from '@lobehub/icons-static-svg/icons/zai.svg?raw';

/** SVG source per bundled mark. */
export const MODEL_ICON_SVG: Readonly<Record<ModelIconKey, string>> = {
  claude: claudeSvg,
  deepseek: deepseekSvg,
  gemini: geminiSvg,
  zai: zaiSvg,
  openai: openaiSvg,
  grok: grokSvg,
  hunyuan: hunyuanSvg,
  kimi: kimiSvg,
  longcat: longcatSvg,
  xiaomimimo: xiaomimimoSvg,
  minimax: minimaxSvg,
  mistral: mistralSvg,
  meta: metaSvg,
  nvidia: nvidiaSvg,
  qwen: qwenSvg,
  stepfun: stepfunSvg,
};
