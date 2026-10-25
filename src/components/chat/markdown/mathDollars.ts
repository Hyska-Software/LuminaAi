import type { ElementContent } from 'hast';
import type { Root, RootContent } from 'mdast';

/**
 * `\$` handling for Markdown math.
 *
 * `micromark-extension-math` (remark-math) does not treat `\$` as an escape:
 * the dollar right after the backslash closes the math span, so expressions
 * such as `$\Gamma = \{a, b, c, S, A, \$\}$` render as a KaTeX error and the
 * following text is parsed as math (cascade).
 *
 * The fix is a round trip:
 *
 * 1. `protectEscapedDollars` replaces every `\$` with a private-use sentinel
 *    **before** parsing, so the dollar can never close a math span;
 * 2. `remarkRestoreMathDollars` restores the sentinel per mdast node type
 *    after parsing: math content gets `\$` back (KaTeX understands it),
 *    prose gets a literal `$`, and code/HTML keep the `\$` literal.
 */

/** Private-use character used only while parsing; never reaches the DOM. */
export const SENTINEL = '\uE000';

/** Markdown escape for a dollar sign (backslash + dollar). */
export const ESCAPED_DOLLAR = '\\$';

/** Replaces `\$` by the sentinel so `$` cannot close a math span while parsing. */
export function protectEscapedDollars(content: string): string {
  return content.split(ESCAPED_DOLLAR).join(SENTINEL);
}

function restore(text: string, replacement: string): string {
  return text.split(SENTINEL).join(replacement);
}

/** Restores the sentinel inside the hast children cached on math nodes. */
function restoreCachedHast(children: ElementContent[] | undefined, replacement: string): void {
  for (const child of children ?? []) {
    if (child.type === 'text') {
      child.value = restore(child.value, replacement);
    } else if (child.type === 'element') {
      restoreCachedHast(child.children, replacement);
    }
  }
}

function restoreNode(node: RootContent): void {
  switch (node.type) {
    case 'text':
      node.value = restore(node.value, '$');
      break;
    case 'math':
    case 'inlineMath':
      node.value = restore(node.value, ESCAPED_DOLLAR);
      // `mdast-util-math` caches the hast children at parse time and
      // `remark-rehype` renders from that cache, so restore it as well.
      restoreCachedHast(node.data?.hChildren, ESCAPED_DOLLAR);
      break;
    case 'code':
    case 'inlineCode':
    case 'html':
      node.value = restore(node.value, ESCAPED_DOLLAR);
      break;
    case 'link':
    case 'image':
    case 'definition':
      node.url = restore(node.url, '$');
      if (node.title) node.title = restore(node.title, '$');
      if (node.type === 'image' && node.alt) node.alt = restore(node.alt, '$');
      break;
    default:
      break;
  }

  if ('children' in node) {
    for (const child of node.children) restoreNode(child);
  }
}

/**
 * remark plugin that walks the parsed tree and restores every protected `\$`
 * with the semantics of the node that contains it. Must run after the
 * remark plugins that create mdast nodes and before `remark-rehype`.
 */
export function remarkRestoreMathDollars() {
  return (tree: Root): undefined => {
    for (const child of tree.children) restoreNode(child);
  };
}
