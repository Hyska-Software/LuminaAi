import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { compareText } from '@/lib/i18n/format';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Default rendered-node cap; the preview warns when the document is larger. */
export const JSON_TREE_MAX_NODES = 2000;
/** Initial expansion depth (root and its children expanded). */
export const JSON_TREE_INITIAL_DEPTH = 2;
/** Hard depth cap: protects the recursive renderer from pathological documents. */
const JSON_TREE_MAX_DEPTH = 100;
/** Longest string rendered inline (the rest is summarized). */
const MAX_STRING_LENGTH = 500;

type JsonPrimitive = string | number | boolean | null;
type LabelKind = 'key' | 'index' | null;

interface PrimitiveEntry {
  kind: 'primitive';
  id: string;
  label: string | null;
  labelKind: LabelKind;
  value: JsonPrimitive;
}

interface ContainerEntry {
  kind: 'object' | 'array';
  id: string;
  label: string | null;
  labelKind: LabelKind;
  count: number;
  children: JsonEntry[];
}

type JsonEntry = PrimitiveEntry | ContainerEntry;

interface BuildState {
  remaining: number;
  truncated: boolean;
  nextId: number;
}

function displayLabel(label: string | null, labelKind: LabelKind): string {
  if (label === null) return 'JSON';
  return labelKind === 'index' ? `[${label}]` : label;
}

function buildEntry(
  value: unknown,
  label: string | null,
  labelKind: LabelKind,
  depth: number,
  state: BuildState,
): JsonEntry {
  const id = `json-node-${state.nextId}`;
  state.nextId += 1;

  if (Array.isArray(value)) {
    const entry: ContainerEntry = {
      kind: 'array',
      id,
      label,
      labelKind,
      count: value.length,
      children: [],
    };
    state.remaining -= 1;
    if (depth >= JSON_TREE_MAX_DEPTH) {
      if (value.length > 0) state.truncated = true;
      return entry;
    }
    for (let index = 0; index < value.length; index += 1) {
      if (state.remaining <= 0) {
        state.truncated = true;
        break;
      }
      entry.children.push(buildEntry(value[index], String(index), 'index', depth + 1, state));
    }
    return entry;
  }

  if (value !== null && typeof value === 'object') {
    // Object keys are sorted so the tree is stable regardless of insertion order.
    const keys = Object.keys(value as Record<string, unknown>).sort(compareText);
    const entry: ContainerEntry = {
      kind: 'object',
      id,
      label,
      labelKind,
      count: keys.length,
      children: [],
    };
    state.remaining -= 1;
    if (depth >= JSON_TREE_MAX_DEPTH) {
      if (keys.length > 0) state.truncated = true;
      return entry;
    }
    for (const key of keys) {
      if (state.remaining <= 0) {
        state.truncated = true;
        break;
      }
      entry.children.push(
        buildEntry((value as Record<string, unknown>)[key], key, 'key', depth + 1, state),
      );
    }
    return entry;
  }

  state.remaining -= 1;
  return { kind: 'primitive', id, label, labelKind, value: value as JsonPrimitive };
}

function primitiveText(value: JsonPrimitive): string {
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) {
      return `${JSON.stringify(value.slice(0, MAX_STRING_LENGTH))}… ${t(
        'artifacts:json.characters',
        { count: value.length },
      )}`;
    }
    return JSON.stringify(value);
  }
  if (value === null) return 'null';
  return String(value);
}

function primitiveClass(value: JsonPrimitive): string {
  if (value === null) return 'text-foreground-subtle';
  if (typeof value === 'string') return 'text-success';
  // number | boolean
  return 'text-warning';
}

function countLabel(entry: ContainerEntry): string {
  if (entry.kind === 'array') return t('artifacts:json.items', { count: entry.count });
  return t('artifacts:json.keys', { count: entry.count });
}

const ROW_CLASS =
  'flex w-full items-start gap-1 rounded px-1 py-0.5 text-left text-[12.5px] leading-6';
const FOCUS_CLASS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

interface EntryProps {
  entry: JsonEntry;
  depth: number;
  initialDepth: number;
  expandedById: Record<string, boolean>;
  onToggle: (id: string, expanded: boolean) => void;
}

function JsonKey({ label, labelKind }: { label: string | null; labelKind: LabelKind }) {
  if (label === null) return null;
  return (
    <span
      className={cn('shrink-0', labelKind === 'index' ? 'text-foreground-subtle' : 'text-accent')}
    >
      {labelKind === 'index' ? label : JSON.stringify(label)}
      <span className="text-foreground-subtle">:&nbsp;</span>
    </span>
  );
}

function JsonEntryView({ entry, depth, initialDepth, expandedById, onToggle }: EntryProps) {
  if (entry.kind === 'primitive') {
    return (
      <div className={cn(ROW_CLASS, 'pl-1')}>
        <JsonKey label={entry.label} labelKind={entry.labelKind} />
        <span className={cn('min-w-0 break-words', primitiveClass(entry.value))}>
          {primitiveText(entry.value)}
        </span>
      </div>
    );
  }

  const isExpanded = expandedById[entry.id] ?? depth < initialDepth;
  const hasChildren = entry.children.length > 0;
  const labelText = displayLabel(entry.label, entry.labelKind);
  const open = entry.kind === 'object' ? '{' : '[';
  const close = entry.kind === 'object' ? '}' : ']';

  if (!hasChildren) {
    return (
      <div className={cn(ROW_CLASS, 'pl-1')} data-json-empty={entry.kind}>
        <JsonKey label={entry.label} labelKind={entry.labelKind} />
        <span className="text-foreground-subtle">
          {open}
          {close}
        </span>
        <span className="text-[11px] text-foreground-subtle/80">{countLabel(entry)}</span>
      </div>
    );
  }

  return (
    <div data-json-container={entry.kind}>
      <button
        type="button"
        onClick={() => onToggle(entry.id, !isExpanded)}
        aria-expanded={isExpanded}
        aria-label={
          isExpanded
            ? t('artifacts:json.collapse', { label: labelText })
            : t('artifacts:json.expand', { label: labelText })
        }
        className={cn(
          ROW_CLASS,
          'items-center hover:bg-surface-hover motion-reduce:transition-none',
          FOCUS_CLASS,
        )}
      >
        {isExpanded ? (
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-foreground-subtle" />
        ) : (
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-foreground-subtle" />
        )}
        <JsonKey label={entry.label} labelKind={entry.labelKind} />
        <span className="text-foreground-subtle">{isExpanded ? open : `${open} … ${close}`}</span>
        <span className="text-[11px] text-foreground-subtle/80">{countLabel(entry)}</span>
      </button>
      {isExpanded ? (
        <>
          <ul className="pl-4">
            {entry.children.map((child) => (
              <li key={child.id}>
                <JsonEntryView
                  entry={child}
                  depth={depth + 1}
                  initialDepth={initialDepth}
                  expandedById={expandedById}
                  onToggle={onToggle}
                />
              </li>
            ))}
          </ul>
          <div className={cn(ROW_CLASS, 'pl-1 text-foreground-subtle')} aria-hidden>
            {close}
          </div>
        </>
      ) : null}
    </div>
  );
}

export interface JsonTreeProps {
  /** Parsed JSON value (anything `JSON.parse` returns). */
  value: unknown;
  /** How many levels start expanded. Defaults to 2. */
  initialDepth?: number;
  /** Rendered-node cap; the tree warns when the document is longer. */
  maxNodes?: number;
  className?: string;
  /** Accessible name of the tree region; defaults to the generic label. */
  ariaLabel?: string;
}

/**
 * Recursive, collapsible JSON tree with a node budget.
 *
 * Only the entries that fit in `maxNodes` are materialized, so huge documents
 * stay responsive; when the budget is hit the tree shows a truncation warning
 * instead of silently dropping data.
 */
export function JsonTree({
  value,
  initialDepth = JSON_TREE_INITIAL_DEPTH,
  maxNodes = JSON_TREE_MAX_NODES,
  className,
  ariaLabel,
}: JsonTreeProps) {
  const { t: translate, i18n } = useTranslation('artifacts');
  const { root, truncated } = useMemo(() => {
    const state: BuildState = { remaining: maxNodes, truncated: false, nextId: 0 };
    return { root: buildEntry(value, null, null, 0, state), truncated: state.truncated };
  }, [value, maxNodes, i18n.language]);

  // Stores only the explicit overrides; the default comes from node depth.
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  // Expanding/collapsing is document-scoped: a new JSON value starts fresh even
  // when the panel reuses the component between artifacts.
  useEffect(() => {
    setExpandedById({});
  }, [value]);
  const handleToggle = (id: string, expanded: boolean) =>
    setExpandedById((previous) => ({ ...previous, [id]: expanded }));

  return (
    <div
      role="group"
      aria-label={ariaLabel ?? translate('artifacts:json.treeLabel')}
      className={cn('min-w-0', className)}
    >
      <JsonEntryView
        entry={root}
        depth={0}
        initialDepth={initialDepth}
        expandedById={expandedById}
        onToggle={handleToggle}
      />
      {truncated ? (
        <p className="mt-2 text-[11px] text-foreground-subtle">
          {translate('artifacts:json.truncated')}
        </p>
      ) : null}
    </div>
  );
}
