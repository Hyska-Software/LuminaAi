import { Children, cloneElement, isValidElement, type ReactNode } from 'react';

/** Flattens the text content of an already rendered React subtree. */
export function childrenToText(children: ReactNode): string {
  let text = '';
  for (const child of Children.toArray(children)) {
    if (typeof child === 'string' || typeof child === 'number') {
      text += String(child);
    } else if (isValidElement<{ children?: ReactNode }>(child)) {
      text += childrenToText(child.props.children);
    }
  }
  return text;
}

/** True for text nodes that only carry Markdown newlines/indentation. */
export function isIgnorableNode(node: ReactNode): boolean {
  return typeof node === 'string' && node.trim() === '';
}

/**
 * Removes `count` characters from the leading text of a rendered React tree,
 * keeping the surrounding inline elements intact. Used to strip GitHub alert
 * markers (`[!NOTE]`) from the first paragraph.
 */
export function stripLeadingText(children: ReactNode, count: number): ReactNode {
  let remaining = count;

  const walk = (nodes: ReactNode): ReactNode[] => {
    const result: ReactNode[] = [];

    for (const child of Children.toArray(nodes)) {
      if (remaining <= 0) {
        result.push(child);
        continue;
      }
      if (typeof child === 'string') {
        if (child.length <= remaining) {
          remaining -= child.length;
          continue;
        }
        const text = child.slice(remaining);
        remaining = 0;
        if (text) result.push(text);
        continue;
      }
      if (typeof child === 'number') {
        const text = String(child);
        if (text.length <= remaining) {
          remaining -= text.length;
          continue;
        }
        const rest = text.slice(remaining);
        remaining = 0;
        if (rest) result.push(rest);
        continue;
      }
      if (isValidElement<{ children?: ReactNode }>(child)) {
        const text = childrenToText(child.props.children);
        if (text.length <= remaining) {
          remaining -= text.length;
          continue;
        }
        result.push(cloneElement(child, {}, walk(child.props.children)));
        remaining = 0;
        continue;
      }
      result.push(child);
    }

    return result;
  };

  return walk(children);
}
