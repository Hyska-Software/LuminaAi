/**
 * Defense-in-depth sanitizer for inline SVG markup (Mermaid output and `svg`
 * artifacts). Mermaid already runs with `securityLevel: 'strict'`, but we strip
 * scripts, event handlers and `javascript:` URLs before injecting the markup
 * into the document.
 */

const BANNED_TAGS = /<\s*(script|iframe|object|embed|link|meta|base|form)\b[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi;
const SELF_CLOSING_SCRIPT = /<\s*script\b[^>]*\/?>/gi;
const EVENT_HANDLER = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL = /((?:xlink:)?href|src)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*'|\s*javascript:[^\s>]*)/gi;
const SRCDOC = /\ssrcdoc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

export function sanitizeSvg(svg: string): string {
  if (!svg) return '';
  let output = svg;
  output = output.replace(BANNED_TAGS, '');
  output = output.replace(SELF_CLOSING_SCRIPT, '');
  output = output.replace(EVENT_HANDLER, '');
  output = output.replace(JS_URL, '$1="#"');
  output = output.replace(SRCDOC, '');
  // Remove any leftover `javascript:` occurrences in style attributes.
  output = output.replace(/style\s*=\s*("[^"]*")/gi, (match) =>
    match.replace(/javascript\s*:/gi, ''),
  );
  return output;
}

/** True when the SVG markup looks like an actual `<svg>` document. */
export function isSvgMarkup(source: string): boolean {
  return /<svg[\s>]/i.test(source);
}
