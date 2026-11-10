import { cloneElement, Children, isValidElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Info, Lightbulb, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import { childrenToText, isIgnorableNode, stripLeadingText } from './reactText';

/** GitHub alert kinds supported by the chat renderer (`docs/MARKDOWN.md` §3.3). */
export type GitHubAlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

interface AlertMeta {
  /** Stable translation key; resolved at render time. */
  labelKey: string;
  Icon: LucideIcon;
}

const ALERT_META: Record<GitHubAlertKind, AlertMeta> = {
  note: { labelKey: 'alerts.note', Icon: Info },
  tip: { labelKey: 'alerts.tip', Icon: Lightbulb },
  important: { labelKey: 'alerts.important', Icon: CircleAlert },
  warning: { labelKey: 'alerts.warning', Icon: TriangleAlert },
  caution: { labelKey: 'alerts.caution', Icon: OctagonAlert },
};

/** `> [!NOTE]` on the first line of a blockquote. */
const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]*\r?\n)?[ \t]*/i;

export interface ParsedGitHubAlert {
  kind: GitHubAlertKind;
  content: ReactNode[];
}

/**
 * Detects a GitHub alert: the first paragraph of the blockquote must start with
 * a `[!TYPE]` marker. The marker is removed from the paragraph while the inline
 * formatting after it is preserved. Unknown markers (`[!FOO]`) stay untouched.
 */
export function parseGitHubAlert(children: ReactNode): ParsedGitHubAlert | null {
  const nodes = Children.toArray(children);
  const index = nodes.findIndex((node) => !isIgnorableNode(node));
  if (index === -1) return null;

  const paragraph = nodes[index];
  if (!isValidElement<{ children?: ReactNode }>(paragraph) || paragraph.type !== 'p') return null;

  const match = ALERT_MARKER.exec(childrenToText(paragraph.props.children));
  if (!match) return null;

  const kind = match[1].toLowerCase() as GitHubAlertKind;
  const remainder = stripLeadingText(paragraph.props.children, match[0].length);
  const content: ReactNode[] = [];

  nodes.forEach((node, nodeIndex) => {
    if (nodeIndex !== index) {
      content.push(node);
      return;
    }
    // A marker on its own line produces an empty first paragraph; drop it.
    if (childrenToText(remainder).trim()) {
      content.push(cloneElement(paragraph, {}, remainder));
    }
  });

  return { kind, content };
}

export interface GitHubAlertProps {
  kind: GitHubAlertKind;
  children?: ReactNode;
}

/**
 * Bloco de alerta do Markdown (GitHub alerts): rótulo + ícone neutros, **sem
 * caixa, fundo colorido ou borda** — o produto não usa blocos com moldura
 * assimétrica (ver docs/DESIGN.md §15).
 */
export function GitHubAlert({ kind, children }: GitHubAlertProps) {
  const { t } = useTranslation('chat');
  const { labelKey, Icon } = ALERT_META[kind];
  const label = t(labelKey);
  return (
    <div role="note" aria-label={label} data-alert={kind} className="zylara-alert">
      <div className="zylara-alert-header flex items-center gap-1.5">
        <Icon aria-hidden className="size-4 shrink-0 text-foreground-subtle" />
        <span className="font-semibold">{label}</span>
      </div>
      <div className="zylara-alert-body">{children}</div>
    </div>
  );
}
