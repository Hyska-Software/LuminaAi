import type { PrismTheme } from 'prism-react-renderer';

/**
 * Single syntax theme for every code surface (chat fences, generative UI,
 * artifacts, JSON preview). Colors are Zylara CSS variables, so the same theme
 * follows light/dark without a second palette — the previous chat/genui local
 * themes are unified here.
 */
export const SYNTAX_THEME: PrismTheme = {
  plain: {
    color: 'var(--foreground)',
    backgroundColor: 'transparent',
  },
  styles: [
    {
      types: ['comment', 'prolog', 'doctype', 'cdata'],
      style: { color: 'var(--foreground-subtle)', fontStyle: 'italic' },
    },
    { types: ['punctuation'], style: { color: 'var(--foreground-muted)' } },
    // Keys/attributes/tags are the structural layer: accent, never danger.
    {
      types: ['property', 'tag', 'constant', 'symbol', 'namespace', 'attr-name'],
      style: { color: 'var(--accent)' },
    },
    { types: ['deleted'], style: { color: 'var(--danger)' } },
    { types: ['boolean', 'number'], style: { color: 'var(--warning)' } },
    {
      types: ['selector', 'string', 'char', 'builtin', 'inserted', 'attr-value'],
      style: { color: 'var(--success)' },
    },
    { types: ['operator', 'entity', 'url'], style: { color: 'var(--foreground-muted)' } },
    { types: ['atrule', 'keyword', 'important'], style: { color: 'var(--accent)' } },
    { types: ['function', 'class-name'], style: { color: 'var(--accent-hover)' } },
    { types: ['regex', 'variable'], style: { color: 'var(--warning)' } },
  ],
};
