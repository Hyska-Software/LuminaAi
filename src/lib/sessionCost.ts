/**
 * Session cost derived from billed usage.
 *
 * The renderer is not the billing authority: it prices the usage the provider
 * reported with the official catalog prices (`data/catalog.json`, USD per
 * million tokens) so the context meter can show what the session would cost on
 * the API. Subscription routes (ChatGPT plan, OpenCode Go, ...) are not billed
 * per token, but the same API-equivalent value is shown for reference.
 *
 * Subagent usage is merged into the parent turn's `usage` by the harness
 * (`merge_usage`), so assistant-message totals already contain the children.
 * When a child reported a different model, its usage is removed from the parent
 * bucket and priced with the child's own model, so each model keeps its price.
 */
import { normalizeLegacyUsage } from './cache';
import { findModelIn, getModel } from './catalog';
import type { ChatMessage, CostInfo, ProviderInfo, UsageInfo } from './types';

/** Tokens of each billed bucket of one request or aggregate. */
export interface UsageBuckets {
  /** Prompt tokens neither read from nor written to the cache. */
  input: number;
  /** Prompt tokens served from the cache. */
  cacheRead: number;
  /** Prompt tokens written to the cache by this request. */
  cacheWrite: number;
  /** Completion tokens (the providers already include reasoning here). */
  output: number;
}

/** One priced bucket of the session total. */
export interface CostSegment {
  tokens: number;
  usd: number;
  /** A catalog price was found for these tokens (zero-price models count). */
  priced: boolean;
}

/** Everything the context meter needs to show the session spending. */
export interface SessionCostView {
  input: CostSegment;
  cacheRead: CostSegment;
  cacheWrite: CostSegment;
  output: CostSegment;
  totalUsd: number;
  totalTokens: number;
  /** Child requests priced with their own model. */
  subagents: number;
  /** At least one bucket had a catalog price. */
  priced: boolean;
  /** Some tokens had no catalog price (they are excluded from `totalUsd`). */
  unpriced: boolean;
}

/** Resolves the official price of a provider/model pair (USD per 1M tokens). */
export type CostLookup = (
  providerId?: string | null,
  modelId?: string | null,
) => CostInfo | null;

const TOKENS_PER_UNIT = 1_000_000;

type PriceKey = 'input' | 'output' | 'cache_read' | 'cache_write';

interface ChildUsage {
  usage: UsageInfo;
  providerId?: string | null;
  modelId?: string | null;
}

function count(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return 0;
  return Math.max(0, Math.round(value));
}

/**
 * Normalizes the provider usage into billed buckets.
 *
 * `uncachedInputTokens` is the normalized non-cached prompt (Anthropic reports
 * only the tail in `inputTokens`; OpenAI/Gateway input may be inclusive). Legacy
 * payloads without cache counters degrade to `inputTokens` as the whole prompt.
 */
export function usageBuckets(usage: UsageInfo | null | undefined): UsageBuckets {
  if (!usage) return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  const normalized = normalizeLegacyUsage(usage);
  const cacheRead = count(normalized.cacheReadTokens ?? normalized.cachedTokens);
  const cacheWrite = count(normalized.cacheWriteTokens);
  const inputTotal = count(normalized.inputTokens);
  const input =
    normalized.uncachedInputTokens != null
      ? count(normalized.uncachedInputTokens)
      : Math.max(0, inputTotal - cacheRead - cacheWrite);
  return { input, cacheRead, cacheWrite, output: count(normalized.outputTokens) };
}

function priceOf(cost: CostInfo | null, key: PriceKey): number | null {
  const value = cost?.[key];
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function emptyBuckets(): UsageBuckets {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
}

function subtractBuckets(parent: UsageBuckets, child: UsageBuckets): UsageBuckets {
  return {
    input: Math.max(0, parent.input - child.input),
    cacheRead: Math.max(0, parent.cacheRead - child.cacheRead),
    cacheWrite: Math.max(0, parent.cacheWrite - child.cacheWrite),
    output: Math.max(0, parent.output - child.output),
  };
}

interface CostAccumulator {
  input: CostSegment;
  cacheRead: CostSegment;
  cacheWrite: CostSegment;
  output: CostSegment;
}

function emptyCost(): CostAccumulator {
  return {
    input: { tokens: 0, usd: 0, priced: false },
    cacheRead: { tokens: 0, usd: 0, priced: false },
    cacheWrite: { tokens: 0, usd: 0, priced: false },
    output: { tokens: 0, usd: 0, priced: false },
  };
}

function addSegment(target: CostSegment, tokens: number, price: number | null): void {
  if (tokens <= 0) return;
  target.tokens += tokens;
  if (price == null) return;
  target.usd += (tokens / TOKENS_PER_UNIT) * price;
  target.priced = true;
}

function addBuckets(target: CostAccumulator, buckets: UsageBuckets, cost: CostInfo | null): void {
  const input = priceOf(cost, 'input');
  // Providers without a cache-specific price are priced as regular input, so the
  // total never claims a discount the catalog does not document.
  const cacheRead = priceOf(cost, 'cache_read') ?? input;
  const cacheWrite = priceOf(cost, 'cache_write') ?? input;
  addSegment(target.input, buckets.input, input);
  addSegment(target.cacheRead, buckets.cacheRead, cacheRead);
  addSegment(target.cacheWrite, buckets.cacheWrite, cacheWrite);
  addSegment(target.output, buckets.output, priceOf(cost, 'output'));
}

/** Child requests persisted on the parent turn's `task` tool calls. */
function childUsages(message: ChatMessage): ChildUsage[] {
  const children: ChildUsage[] = [];
  for (const call of message.toolCalls ?? []) {
    const presentation = call.presentation;
    if (presentation?.kind !== 'subagent' || !presentation.usage) continue;
    children.push({
      usage: presentation.usage,
      providerId: presentation.providerId,
      modelId: presentation.modelId,
    });
  }
  return children;
}

/**
 * Official catalog price for a provider/model pair, preferring the live merged
 * catalog (`appStore.providers`) and falling back to the bundled snapshot.
 */
export function catalogCost(
  providers: readonly ProviderInfo[] | null | undefined,
  providerId?: string | null,
  modelId?: string | null,
): CostInfo | null {
  if (!providerId || !modelId) return null;
  const live =
    providers && providers.length > 0
      ? findModelIn(providers, providerId, modelId)
      : undefined;
  const model = live ?? getModel(providerId, modelId);
  return model?.cost ?? null;
}

/**
 * Sums the conversation's assistant usage and returns the priced session.
 * `null` means "nothing billed yet" (the meter hides the cost segment).
 */
export function sessionCostFromMessages(
  messages: readonly ChatMessage[] | null | undefined,
  lookup: CostLookup,
): SessionCostView | null {
  if (!messages || messages.length === 0) return null;
  const cost = emptyCost();
  let billed = 0;
  let subagents = 0;

  for (const message of messages) {
    if (message.role !== 'assistant' || !message.usage) continue;
    billed += 1;
    const parent = usageBuckets(message.usage);
    const children = childUsages(message);
    let own = parent;
    if (children.length > 0) {
      const childTotals = emptyBuckets();
      for (const child of children) {
        const buckets = usageBuckets(child.usage);
        childTotals.input += buckets.input;
        childTotals.cacheRead += buckets.cacheRead;
        childTotals.cacheWrite += buckets.cacheWrite;
        childTotals.output += buckets.output;
      }
      own = subtractBuckets(parent, childTotals);
    }
    addBuckets(cost, own, lookup(message.providerId, message.modelId));
    for (const child of children) {
      addBuckets(
        cost,
        usageBuckets(child.usage),
        lookup(child.providerId ?? message.providerId, child.modelId ?? message.modelId),
      );
    }
    subagents += children.length;
  }

  if (billed === 0) return null;
  const totalTokens =
    cost.input.tokens + cost.cacheRead.tokens + cost.cacheWrite.tokens + cost.output.tokens;
  if (totalTokens <= 0) return null;
  return {
    ...cost,
    totalUsd: cost.input.usd + cost.cacheRead.usd + cost.cacheWrite.usd + cost.output.usd,
    totalTokens,
    subagents,
    priced: cost.input.priced || cost.cacheRead.priced || cost.cacheWrite.priced || cost.output.priced,
    unpriced:
      (cost.input.tokens > 0 && !cost.input.priced) ||
      (cost.cacheRead.tokens > 0 && !cost.cacheRead.priced) ||
      (cost.cacheWrite.tokens > 0 && !cost.cacheWrite.priced) ||
      (cost.output.tokens > 0 && !cost.output.priced),
  };
}
