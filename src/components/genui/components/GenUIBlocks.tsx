import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ExternalLink,
  Info,
  Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { openExternal } from '@/lib/genui/open-external';
import {
  asStringArray,
  propArray,
  propBool,
  propNumber,
  propObjectArray,
  propString,
  type GenUIValue,
} from '@/lib/genui/schema';
import { Badge, ProgressBar } from '@/components/ui';
import { CodeBlock } from '../CodeBlock';
import type { GenUINodeProps } from './GenUILayout';

/* -------------------------------- stat -------------------------------- */

export function GenUIStat({ props }: GenUINodeProps) {
  const label = propString(props, 'label', 'Métrica');
  const value = propString(props, 'value', '—');
  const hint = propString(props, 'hint');
  const trend = propString(props, 'trend');
  const TrendIcon =
    trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : trend === 'flat' ? Minus : null;

  return (
    <div className="rounded-xl border border-border bg-surface-raised p-3.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">{label}</span>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tracking-tight tabular-nums text-foreground">{value}</span>
        {TrendIcon ? (
          <TrendIcon
            aria-hidden
            className={cn(
              'size-4 self-center',
              trend === 'up' ? 'text-success' : trend === 'down' ? 'text-danger' : 'text-foreground-subtle',
            )}
          />
        ) : null}
      </div>
      {hint ? <p className="mt-1 text-[11px] leading-relaxed text-foreground-muted">{hint}</p> : null}
    </div>
  );
}

/* ------------------------------ progress ------------------------------ */

export function GenUIProgress({ props }: GenUINodeProps) {
  const label = propString(props, 'label');
  const max = Math.abs(propNumber(props, 'max', 100) ?? 100) || 100;
  const rawValue = propNumber(props, 'value', 0) ?? 0;
  const suffix = propString(props, 'suffix');
  // A model may send either a percentage (0–100), a fraction (0–1) or `value/max`.
  const value = max === 1 ? Math.min(1, Math.max(0, rawValue)) * 100 : Math.min(max, Math.max(0, rawValue));
  const pct = Math.round((value / (max === 1 ? 100 : max)) * 100);
  const display = suffix
    ? `${value.toLocaleString('pt-BR')}${suffix}`
    : max === 100
      ? `${Math.round(value)}%`
      : `${value.toLocaleString('pt-BR')}/${max.toLocaleString('pt-BR')}`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] text-foreground-muted">{label || 'Progresso'}</span>
        <span className="text-xs tabular-nums text-foreground">{display}</span>
      </div>
      <ProgressBar value={pct} size="md" tone="accent" label={label || 'Progresso'} />
    </div>
  );
}

/* ------------------------------- timeline ----------------------------- */

const TIMELINE_DOT = {
  done: 'bg-success',
  active: 'bg-accent',
  pending: 'bg-border-strong',
  error: 'bg-danger',
} as const;

export function GenUITimeline({ props }: GenUINodeProps) {
  const items = propObjectArray(props, 'items');
  if (!items.length) return null;

  return (
    <ol className="relative flex flex-col gap-3 pl-4">
      <span aria-hidden className="absolute inset-y-1 left-[5px] w-px bg-border" />
      {items.map((item, index) => {
        const statusRaw = propString(item, 'status', 'pending');
        const status = statusRaw in TIMELINE_DOT ? (statusRaw as keyof typeof TIMELINE_DOT) : 'pending';
        const title = propString(item, 'title', `Etapa ${index + 1}`);
        const description = propString(item, 'description');
        const time = propString(item, 'time');
        return (
          <li key={index} className="relative">
            <span
              aria-hidden
              className={cn(
                'absolute -left-4 top-1 size-2.5 rounded-full ring-4 ring-surface-raised',
                TIMELINE_DOT[status],
              )}
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-[12.5px] font-medium text-foreground">{title}</span>
              {time ? <span className="text-[11px] tabular-nums text-foreground-subtle">{time}</span> : null}
            </div>
            {description ? (
              <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">{description}</p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------- steps ------------------------------- */

export function GenUISteps({ props }: GenUINodeProps) {
  const rawItems = propArray(props, 'items') ?? [];
  const current = propNumber(props, 'current', 0) ?? 0;
  const items = rawItems
    .map((entry) => {
      if (typeof entry === 'string' || typeof entry === 'number') {
        return { title: String(entry), description: '' };
      }
      if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
        return {
          title: propString(entry, 'title', ''),
          description: propString(entry, 'description'),
        };
      }
      return null;
    })
    .filter((entry): entry is { title: string; description: string } => entry !== null && entry.title !== '');
  if (!items.length) return null;

  return (
    <ol className="flex flex-col gap-2.5">
      {items.map((item, index) => {
        const state = index < current ? 'done' : index === current ? 'active' : 'todo';
        return (
          <li key={index} className="flex gap-2.5">
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
                state === 'done' && 'border-success/30 bg-success-soft text-success',
                state === 'active' && 'border-accent/40 bg-accent-soft text-accent',
                state === 'todo' && 'border-border bg-surface text-foreground-subtle',
              )}
            >
              {state === 'done' ? <CheckCircle2 className="size-3" /> : index + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cn('text-[12.5px] font-medium', state === 'todo' ? 'text-foreground-muted' : 'text-foreground')}>
                {item.title}
              </p>
              {item.description ? (
                <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">{item.description}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------- callout ------------------------------ */

const CALLOUTS = {
  info: { wrap: 'border-accent/25 bg-accent-soft/60', icon: Info, iconClass: 'text-accent' },
  warning: { wrap: 'border-warning/30 bg-warning-soft', icon: AlertTriangle, iconClass: 'text-warning' },
  success: { wrap: 'border-success/30 bg-success-soft', icon: CheckCircle2, iconClass: 'text-success' },
  danger: { wrap: 'border-danger/30 bg-danger-soft', icon: AlertCircle, iconClass: 'text-danger' },
} as const;

export function GenUICallout({ props, children }: GenUINodeProps) {
  const variantRaw = propString(props, 'variant', 'info');
  const variant = variantRaw in CALLOUTS ? (variantRaw as keyof typeof CALLOUTS) : 'info';
  const { wrap, icon: Icon, iconClass } = CALLOUTS[variant];
  const title = propString(props, 'title');
  const text = propString(props, 'text');

  return (
    <div className={cn('flex gap-2.5 rounded-xl border p-3.5', wrap)}>
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', iconClass)} />
      <div className="min-w-0 flex-1">
        {title ? <p className="text-[12.5px] font-semibold text-foreground">{title}</p> : null}
        {text ? <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">{text}</p> : null}
        {children ? <div className="mt-1.5 flex flex-col gap-2 text-xs text-foreground-muted">{children}</div> : null}
      </div>
    </div>
  );
}

/* -------------------------------- quote ------------------------------- */

export function GenUIQuote({ props, children }: GenUINodeProps) {
  const text = propString(props, 'text');
  const cite = propString(props, 'cite');
  return (
    <blockquote className="border-l-2 border-border-strong pl-3.5">
      <p className="text-[13px] italic leading-relaxed text-foreground-muted">{text || children}</p>
      {cite ? <cite className="mt-1 block text-[11px] not-italic text-foreground-subtle">— {cite}</cite> : null}
    </blockquote>
  );
}

/* --------------------------------- code ------------------------------- */

export function GenUICode({ props }: GenUINodeProps) {
  const code = propString(props, 'code');
  const language = propString(props, 'language', 'text');
  const title = propString(props, 'title');
  if (!code) return null;
  return <CodeBlock code={code} language={language} title={title} maxHeight={320} />;
}

/* --------------------------------- list ------------------------------- */

export function GenUIList({ props }: GenUINodeProps) {
  const rawItems = propArray(props, 'items') ?? [];
  const ordered = propBool(props, 'ordered');
  const items = rawItems
    .map((entry) => {
      if (typeof entry === 'string' || typeof entry === 'number') {
        return { text: String(entry), description: '' };
      }
      if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
        return {
          text: propString(entry, 'text', propString(entry, 'title', '')),
          description: propString(entry, 'description'),
        };
      }
      return null;
    })
    .filter((entry): entry is { text: string; description: string } => entry !== null && entry.text !== '');
  if (!items.length) return null;

  const ListTag = ordered ? 'ol' : 'ul';
  return (
    <ListTag className={cn('flex flex-col gap-1.5 pl-5', ordered ? 'list-decimal' : 'list-disc')}>
      {items.map((item, index) => (
        <li key={index} className="text-[12.5px] leading-relaxed text-foreground-muted marker:text-foreground-subtle">
          <span className="text-foreground">{item.text}</span>
          {item.description ? <span className="text-foreground-muted"> — {item.description}</span> : null}
        </li>
      ))}
    </ListTag>
  );
}

/* -------------------------------- image ------------------------------- */

function isSafeImageSrc(src: string): boolean {
  return /^https?:\/\//i.test(src) || /^data:image\//i.test(src);
}

export function GenUIImage({ props }: GenUINodeProps) {
  const [broken, setBroken] = useState(false);
  const src = propString(props, 'src');
  const alt = propString(props, 'alt', 'Imagem');
  const caption = propString(props, 'caption');

  if (!src || !isSafeImageSrc(src) || broken) {
    return (
      <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-border bg-surface text-xs text-foreground-subtle">
        {broken ? 'Não foi possível carregar a imagem.' : 'Imagem indisponível.'}
      </div>
    );
  }

  return (
    <figure className="flex flex-col gap-1.5">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => setBroken(true)}
        className="max-h-[360px] w-full rounded-xl border border-border object-contain bg-surface"
      />
      {caption ? <figcaption className="text-[11px] text-foreground-subtle">{caption}</figcaption> : null}
    </figure>
  );
}

/* -------------------------------- badge ------------------------------- */

const BADGE_TONES = {
  neutral: 'neutral',
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  outline: 'outline',
} as const;

export function GenUIBadge({ props }: GenUINodeProps) {
  const label = propString(props, 'label', propString(props, 'text'));
  const toneRaw = propString(props, 'tone', propString(props, 'variant', 'accent'));
  const tone = (toneRaw in BADGE_TONES ? toneRaw : 'neutral') as keyof typeof BADGE_TONES;
  if (!label) return null;
  return (
    <div>
      <Badge tone={tone} size="md">
        {label}
      </Badge>
    </div>
  );
}

/* ------------------------------- divider ------------------------------ */

export function GenUIDivider({ props }: GenUINodeProps) {
  const label = propString(props, 'label');
  if (!label) return <hr className="border-0 border-t border-border" />;
  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-foreground-subtle">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/* --------------------------------- link ------------------------------- */

export function GenUILink({ props }: GenUINodeProps) {
  const href = propString(props, 'href');
  const label = propString(props, 'label', href);
  if (!href || !/^https?:\/\//i.test(href)) {
    return <span className="text-[12.5px] text-foreground-muted">{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => void openExternal(href)}
      className="inline-flex max-w-full items-center gap-1 self-start truncate text-[12.5px] font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <span className="truncate">{label}</span>
      <ExternalLink aria-hidden className="size-3 shrink-0" />
    </button>
  );
}

/* ------------------------------- keyvalue ----------------------------- */

export function GenUIKeyValue({ props }: GenUINodeProps) {
  const rawItems = props?.items;
  const pairs: { label: string; value: string }[] = [];

  if (Array.isArray(rawItems)) {
    for (const entry of rawItems) {
      if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
        const label = propString(entry, 'label', propString(entry, 'key', ''));
        const value = propString(entry, 'value', '');
        if (label) pairs.push({ label, value });
      }
    }
  } else if (typeof rawItems === 'object' && rawItems !== null) {
    for (const [label, value] of Object.entries(rawItems as Record<string, GenUIValue>)) {
      const text = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
      if (text) pairs.push({ label, value: text });
    }
  }

  const labels = asStringArray(propArray(props, 'labels'));
  const values = asStringArray(propArray(props, 'values'));
  if (!pairs.length && labels.length && values.length) {
    labels.forEach((label, index) => pairs.push({ label, value: values[index] ?? '' }));
  }
  if (!pairs.length) return null;

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {pairs.map((pair, index) => (
        <div key={index} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border pb-1.5 last:border-b-0 sm:border-b-0">
          <dt className="text-[11.5px] text-foreground-subtle">{pair.label}</dt>
          <dd className="min-w-0 truncate text-right text-[12.5px] font-medium tabular-nums text-foreground">{pair.value}</dd>
        </div>
      ))}
    </dl>
  );
}
