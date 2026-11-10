import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Code2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { useThemeRevision } from '@/lib/theme/useThemeRevision';
import { useIsDark } from './useIsDark';

const HEIGHT_MESSAGE = 'zylara:html-preview:height';

const TOKEN_NAMES = [
  '--background',
  '--surface',
  '--surface-raised',
  '--surface-hover',
  '--foreground',
  '--foreground-muted',
  '--foreground-subtle',
  '--border',
  '--border-strong',
  '--accent',
  '--accent-soft',
  '--success',
  '--danger',
  '--warning',
  '--font-sans',
  '--font-mono',
] as const;

function readTokens(): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return '';
  const style = window.getComputedStyle(document.documentElement);
  return TOKEN_NAMES.map((name) => `${name}:${style.getPropertyValue(name).trim()};`).join('');
}

const BRIDGE_SCRIPT = `<script>(function(){
  var last = -1;
  function send() {
    try {
      var root = document.documentElement;
      var body = document.body;
      var h = Math.max(root ? root.scrollHeight : 0, body ? body.scrollHeight : 0);
      if (!h || Math.abs(h - last) < 2) return;
      last = h;
      parent.postMessage({ type: '${HEIGHT_MESSAGE}', height: h }, '*');
    } catch (error) { /* ignore */ }
  }
  window.addEventListener('load', send);
  document.addEventListener('DOMContentLoaded', send);
  if (window.ResizeObserver) {
    try { new ResizeObserver(send).observe(document.documentElement); } catch (error) { /* ignore */ }
  }
  setTimeout(send, 40); setTimeout(send, 200); setTimeout(send, 600);
})();</script>`;

function buildSrcDoc(html: string, dark: boolean): string {
  const baseStyle = `<style>
    :root{${readTokens()}color-scheme:${dark ? 'dark' : 'light'};}
    html,body{margin:0;padding:0;}
    body{font-family:var(--font-sans);font-size:13px;line-height:1.65;color:var(--foreground);background:var(--background);-webkit-font-smoothing:antialiased;padding:0;}
    *,*::before,*::after{box-sizing:border-box;}
    img,video,canvas,svg{max-width:100%;height:auto;}
    a{color:var(--accent);}
    pre,code{font-family:var(--font-mono);}
    pre{overflow:auto;padding:12px;border-radius:10px;background:var(--surface);border:1px solid var(--border);}
    table{border-collapse:collapse;width:100%;}
    th,td{border:1px solid var(--border);padding:6px 8px;text-align:left;}
  </style>`;
  const payload = `${baseStyle}${BRIDGE_SCRIPT}`;

  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, `${payload}</body>`);
  if (/<\/html\s*>/i.test(html)) return html.replace(/<\/html\s*>/i, `${payload}</html>`);
  return `${html}${payload}`;
}

export interface HtmlPreviewProps {
  html: string;
  title?: string;
  className?: string;
  minHeight?: number;
  maxHeight?: number;
}

/**
 * HTML preview in a locked-down `<iframe sandbox="allow-scripts">` (no
 * `allow-same-origin`, so it cannot reach the app's IPC). The height is
 * reported by an injected bridge script and validated on the parent side.
 */
export function HtmlPreview({ html, title, className, minHeight = 240, maxHeight = 1200 }: HtmlPreviewProps) {
  const { t } = useTranslation('genui');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const dark = useIsDark();
  const revision = useThemeRevision();
  const [frameHeight, setFrameHeight] = useState(minHeight);
  const srcDoc = useMemo(() => buildSrcDoc(html, dark), [html, dark, revision]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data: unknown = event.data;
      if (typeof data !== 'object' || data === null) return;
      const record = data as { type?: unknown; height?: unknown };
      if (record.type !== HEIGHT_MESSAGE) return;
      if (typeof record.height !== 'number' || !Number.isFinite(record.height)) return;
      const clamped = Math.min(maxHeight, Math.max(minHeight, Math.ceil(record.height)));
      setFrameHeight(clamped);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [minHeight, maxHeight]);

  useEffect(() => {
    setFrameHeight(minHeight);
  }, [html, minHeight]);

  return (
    <div className={cn('my-3 overflow-hidden rounded-xl border border-border bg-surface-raised', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-foreground-muted">
          <Code2 aria-hidden className="size-3.5 text-foreground-subtle" />
          <span className="truncate">{title ?? t('html.title')}</span>
        </span>
        <Badge tone="muted" title={t('html.sandboxHint')}>
          sandbox
        </Badge>
      </div>
      <iframe
        ref={iframeRef}
        title={title ?? t('html.title')}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        style={{ height: frameHeight }}
        className="block w-full border-0 bg-background"
      />
    </div>
  );
}
