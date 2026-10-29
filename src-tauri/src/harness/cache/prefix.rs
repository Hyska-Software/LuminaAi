//! Prefix math and break classification for prompt-cache telemetry (F0a).
//!
//! Pure functions only: the [`CacheTracker`](super::CacheTracker) owns the
//! state and this module owns the arithmetic/classification so both can be
//! tested without a provider or a database.
//!
//! The token estimates (`P`/`Δ`/ceiling) are the documented heuristic from the
//! plan (`chars / 4`); the hit percent shown to the user is always the value
//! reported by the provider.

use crate::domain::{CacheBreakReason, CacheState, PrefixDigest, SegmentKind, UsageInfo};

/// Heuristic from PLAN §2.1: one estimated token per four characters.
pub const CHARS_PER_TOKEN: u32 = 4;
/// Minimum provider-reported hit percent for [`CacheState::Stable`].
pub const STABLE_HIT_PERCENT: f32 = 95.0;

/// Estimated `P` (prefix) and `Δ` (new tokens) of one request.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PrefixEstimate {
    /// Segments shared with the previous request of the epoch.
    pub common_segments: u32,
    /// `P`: estimated tokens already sent before (the cacheable prefix).
    pub prefix_tokens: u32,
    /// `Δ`: estimated new tokens of this request.
    pub delta_tokens: u32,
}

/// Normalized cache counters of one request.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CacheCounters {
    /// Prompt tokens of the request: `cache_read + cache_write + uncached`.
    pub input_total: u32,
    pub cache_read: u32,
    pub cache_write: u32,
    pub uncached: u32,
}

impl CacheCounters {
    /// Accumulates another request into the lifecycle total (`cache_state`).
    pub fn add(&mut self, other: &CacheCounters) {
        self.input_total = self.input_total.saturating_add(other.input_total);
        self.cache_read = self.cache_read.saturating_add(other.cache_read);
        self.cache_write = self.cache_write.saturating_add(other.cache_write);
        self.uncached = self.uncached.saturating_add(other.uncached);
    }
}

/// Persistent prefix break detected between two requests of the same epoch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrefixBreak {
    pub reason: CacheBreakReason,
    /// Segment index where the first divergence happened.
    pub index: u32,
    /// Human-readable detail for the diagnostics panel.
    pub detail: String,
}

/// Total characters covered by the digest (falls back to summing the segments
/// when the provider did not fill `total_chars`).
pub fn total_chars(digest: &PrefixDigest) -> u32 {
    if digest.total_chars > 0 {
        return digest.total_chars;
    }
    digest
        .segments
        .iter()
        .map(|segment| segment.chars)
        .fold(0u32, u32::saturating_add)
}

/// Number of persistent segments: everything before a trailing
/// [`SegmentKind::TransientTail`] (a request-only tail such as the forced
/// wrap-up). Transient segments never count as a cache break.
pub fn persistent_len(digest: &PrefixDigest) -> usize {
    digest
        .segments
        .iter()
        .rposition(|segment| segment.kind != SegmentKind::TransientTail)
        .map_or(0, |index| index + 1)
}

/// Estimates `P`/`Δ` for `digest` against the previous request (`None` for the
/// first request of an epoch, which has no reusable prefix).
pub fn estimate(digest: &PrefixDigest, previous: Option<&PrefixDigest>) -> PrefixEstimate {
    let common = previous.map_or(0, |previous| digest.common_prefix_segments(previous));
    let common_chars = digest.chars_up_to(common);
    let delta_chars = total_chars(digest).saturating_sub(common_chars);
    PrefixEstimate {
        common_segments: u32::try_from(common).unwrap_or(u32::MAX),
        prefix_tokens: common_chars / CHARS_PER_TOKEN,
        delta_tokens: delta_chars / CHARS_PER_TOKEN,
    }
}

/// Theoretical ceiling `P/(P+Δ)` of the request. `None` when there is no
/// reusable prefix (`P = 0`) or nothing new (`Δ = 0`), where the ratio would be
/// meaningless.
pub fn ceiling_percent(prefix_tokens: u32, delta_tokens: u32) -> Option<f32> {
    if prefix_tokens == 0 || delta_tokens == 0 {
        return None;
    }
    let total = u64::from(prefix_tokens) + u64::from(delta_tokens);
    Some((f64::from(prefix_tokens) / total as f64 * 100.0) as f32)
}

/// True when the provider reported cache counters for this request. A
/// provider that reports nothing must stay `None`/unsupported — never 100%.
pub fn reported(usage: &UsageInfo) -> bool {
    usage.cache_reported
        || usage.cache_read_tokens.is_some()
        || usage.cached_tokens.is_some()
        || usage.cache_write_tokens.is_some()
        || usage.uncached_input_tokens.is_some()
}

fn is_anthropic(protocol: &str) -> bool {
    protocol.eq_ignore_ascii_case("anthropic")
}

/// Normalizes the provider counters into `input_total/read/write/uncached`.
///
/// Semantics per protocol (PLAN §2.1):
/// - Anthropic: `input_tokens` excludes cached tokens, so
///   `input_total = input + read + write`;
/// - OpenAI Chat/Responses and Google: `input_tokens` is inclusive of cache
///   reads, so `input_total = input` and `uncached = input - read`;
/// - an explicit `uncached_input_tokens` (normalized by `providers::cache`)
///   always wins: `input_total = read + write + uncached`.
pub fn counters(protocol: &str, usage: &UsageInfo) -> CacheCounters {
    let read = usage.cache_read_tokens.or(usage.cached_tokens).unwrap_or(0);
    let write = usage.cache_write_tokens.unwrap_or(0);
    let raw_input = usage.input_tokens.unwrap_or(0);
    let (input_total, uncached) = match usage.uncached_input_tokens {
        // The provider layer normalized all three counters: the total is the
        // sum of the components (`input_tokens` may be raw/inclusive and must
        // not override it).
        Some(uncached) => (
            read.saturating_add(write).saturating_add(uncached),
            uncached,
        ),
        None if is_anthropic(protocol) => (
            raw_input.saturating_add(read).saturating_add(write),
            raw_input,
        ),
        None => {
            let total = raw_input.max(read.saturating_add(write));
            (total, total.saturating_sub(read))
        }
    };
    CacheCounters {
        input_total,
        cache_read: read,
        cache_write: write,
        uncached,
    }
}

/// Provider-reported cache hit percent: `read / (read + write + uncached)`.
///
/// `None` when the provider did not report cache (honest "não reportado") or
/// when there is no denominator information at all.
pub fn hit_percent(protocol: &str, usage: &UsageInfo) -> Option<f32> {
    if !reported(usage) {
        return None;
    }
    // A cache counter without any input information cannot be normalized: do
    // not turn `read-only` payloads into a fake 100%.
    if usage.input_tokens.is_none() && usage.uncached_input_tokens.is_none() {
        return None;
    }
    let counters = counters(protocol, usage);
    if counters.input_total == 0 {
        return None;
    }
    Some((counters.cache_read as f32 / counters.input_total as f32) * 100.0)
}

/// State machine of one sample (PLAN §4.7/§7).
///
/// Precedence: first request of an epoch is `Cold`; a provider that does not
/// report cache is `Unsupported` (a break without measurement must not be shown
/// as "cache caiu"); a persistent break is `Degraded`; otherwise the reported
/// hit decides between `Stable` (≥ 95%) and `Warming`.
pub fn state(
    hit_percent: Option<f32>,
    reported: bool,
    first_request: bool,
    broke: bool,
) -> CacheState {
    if first_request {
        return CacheState::Cold;
    }
    if !reported {
        return CacheState::Unsupported;
    }
    if broke {
        return CacheState::Degraded;
    }
    match hit_percent {
        Some(hit) if hit >= STABLE_HIT_PERCENT => CacheState::Stable,
        _ => CacheState::Warming,
    }
}

fn kind_label(kind: SegmentKind) -> &'static str {
    match kind {
        SegmentKind::System => "system",
        SegmentKind::Tools => "tools",
        SegmentKind::Message => "message",
        SegmentKind::TransientTail => "transient_tail",
    }
}

/// Compares `current` with the previous request of the same epoch and, when a
/// **persistent** segment diverged, attributes a [`CacheBreakReason`].
///
/// Heuristic from the plan: a diverging `System` segment is a `system_prompt`
/// break, `Tools` is `tool_definitions` and anything else (a message rewritten
/// or removed) is `history_rewrite`. A changed/added trailing
/// [`SegmentKind::TransientTail`] is not a break.
pub fn classify_break(current: &PrefixDigest, previous: &PrefixDigest) -> Option<PrefixBreak> {
    let common = current.common_prefix_segments(previous);
    let persistent = persistent_len(previous);
    if common >= persistent {
        return None;
    }
    let current_kind = current.segments.get(common).map(|segment| segment.kind);
    let previous_kind = previous.segments.get(common).map(|segment| segment.kind);
    let reason = match current_kind {
        Some(SegmentKind::System) => CacheBreakReason::SystemPrompt,
        Some(SegmentKind::Tools) => CacheBreakReason::ToolDefinitions,
        Some(SegmentKind::Message) => CacheBreakReason::HistoryRewrite,
        // The current request ended where the previous one still had a
        // persistent segment: history was shortened/rewritten.
        Some(SegmentKind::TransientTail) | None => match previous_kind {
            Some(SegmentKind::System) => CacheBreakReason::SystemPrompt,
            Some(SegmentKind::Tools) => CacheBreakReason::ToolDefinitions,
            _ => CacheBreakReason::HistoryRewrite,
        },
    };
    let detail = match (previous_kind, current_kind) {
        (Some(previous_kind), Some(current_kind)) => format!(
            "prefixo persistente mudou no segmento {common} ({} → {})",
            kind_label(previous_kind),
            kind_label(current_kind)
        ),
        (Some(previous_kind), None) => format!(
            "histórico encurtou no segmento {common} (esperado {})",
            kind_label(previous_kind)
        ),
        _ => format!("prefixo persistente mudou no segmento {common}"),
    };
    Some(PrefixBreak {
        reason,
        index: u32::try_from(common).unwrap_or(u32::MAX),
        detail,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::SegmentDigest;

    fn digest(entries: &[(SegmentKind, u8, u32)]) -> PrefixDigest {
        let segments: Vec<SegmentDigest> = entries
            .iter()
            .enumerate()
            .map(|(index, (kind, hash, chars))| {
                let mut sha = [0u8; 32];
                sha[0] = *hash;
                SegmentDigest {
                    kind: *kind,
                    index: index as u32,
                    sha256: sha,
                    chars: *chars,
                }
            })
            .collect();
        let total = segments
            .iter()
            .map(|segment| segment.chars)
            .fold(0u32, u32::saturating_add);
        PrefixDigest {
            protocol: "openai-chat".to_string(),
            segments,
            total_chars: total,
            estimated_tokens: total / CHARS_PER_TOKEN,
        }
    }

    fn system(hash: u8, chars: u32) -> (SegmentKind, u8, u32) {
        (SegmentKind::System, hash, chars)
    }

    fn tools(hash: u8, chars: u32) -> (SegmentKind, u8, u32) {
        (SegmentKind::Tools, hash, chars)
    }

    fn message(hash: u8, chars: u32) -> (SegmentKind, u8, u32) {
        (SegmentKind::Message, hash, chars)
    }

    fn tail(hash: u8, chars: u32) -> (SegmentKind, u8, u32) {
        (SegmentKind::TransientTail, hash, chars)
    }

    fn anthropic_usage(input: u32, read: u32, write: u32) -> UsageInfo {
        UsageInfo {
            input_tokens: Some(input),
            cache_read_tokens: Some(read),
            cache_write_tokens: Some(write),
            cache_reported: true,
            ..Default::default()
        }
    }

    #[test]
    fn estimates_appended_segments_as_prefix() {
        let previous = digest(&[system(1, 100), tools(2, 40), message(3, 60)]);
        let current = digest(&[system(1, 100), tools(2, 40), message(3, 60), message(4, 40)]);
        let estimate = estimate(&current, Some(&previous));
        assert_eq!(estimate.common_segments, 3);
        assert_eq!(estimate.prefix_tokens, 200 / 4);
        assert_eq!(estimate.delta_tokens, 40 / 4);
        let ceiling = ceiling_percent(estimate.prefix_tokens, estimate.delta_tokens).unwrap();
        assert!((ceiling - 83.333_336).abs() < 0.001, "ceiling = {ceiling}");
    }

    #[test]
    fn first_request_has_no_reusable_prefix() {
        let current = digest(&[system(1, 100), tools(2, 40), message(3, 60)]);
        let estimate = estimate(&current, None);
        assert_eq!(estimate.common_segments, 0);
        assert_eq!(estimate.prefix_tokens, 0);
        assert_eq!(estimate.delta_tokens, 50);
        assert_eq!(
            ceiling_percent(estimate.prefix_tokens, estimate.delta_tokens),
            None
        );
    }

    #[test]
    fn ceiling_needs_prefix_and_delta() {
        assert_eq!(ceiling_percent(0, 100), None);
        assert_eq!(ceiling_percent(100, 0), None);
        assert_eq!(ceiling_percent(900, 100), Some(90.0));
        assert_eq!(ceiling_percent(9_900, 100), Some(99.0));
    }

    #[test]
    fn total_chars_falls_back_to_the_segments() {
        let mut current = digest(&[system(1, 100), message(2, 60)]);
        assert_eq!(total_chars(&current), 160);
        current.total_chars = 0;
        assert_eq!(total_chars(&current), 160);
        current.total_chars = 999;
        assert_eq!(total_chars(&current), 999);
    }

    #[test]
    fn system_rewrite_is_a_system_prompt_break() {
        let previous = digest(&[system(1, 100), tools(2, 40), message(3, 60)]);
        let current = digest(&[system(9, 100), tools(2, 40), message(3, 60)]);
        let broken = classify_break(&current, &previous).expect("break");
        assert_eq!(broken.reason, CacheBreakReason::SystemPrompt);
        assert_eq!(broken.index, 0);
        assert!(
            broken.detail.contains("system"),
            "detail = {}",
            broken.detail
        );
    }

    #[test]
    fn tools_rewrite_is_a_tool_definitions_break() {
        let previous = digest(&[system(1, 100), tools(2, 40), message(3, 60)]);
        let current = digest(&[system(1, 100), tools(9, 40), message(3, 60)]);
        let broken = classify_break(&current, &previous).expect("break");
        assert_eq!(broken.reason, CacheBreakReason::ToolDefinitions);
        assert_eq!(broken.index, 1);
    }

    #[test]
    fn message_rewrite_is_a_history_rewrite_break() {
        let previous = digest(&[system(1, 100), tools(2, 40), message(3, 60)]);
        let current = digest(&[system(1, 100), tools(2, 40), message(9, 60)]);
        let broken = classify_break(&current, &previous).expect("break");
        assert_eq!(broken.reason, CacheBreakReason::HistoryRewrite);
        assert_eq!(broken.index, 2);
    }

    #[test]
    fn removed_history_is_a_history_rewrite_break() {
        let previous = digest(&[system(1, 100), tools(2, 40), message(3, 60), message(4, 60)]);
        let current = digest(&[system(1, 100), tools(2, 40)]);
        let broken = classify_break(&current, &previous).expect("break");
        assert_eq!(broken.reason, CacheBreakReason::HistoryRewrite);
        assert_eq!(broken.index, 2);
        assert!(
            broken.detail.contains("encurtou"),
            "detail = {}",
            broken.detail
        );
    }

    #[test]
    fn transient_tail_changes_are_not_breaks() {
        let previous = digest(&[system(1, 100), tools(2, 40), message(3, 60), tail(4, 30)]);
        // Changed wrap-up tail.
        let changed = digest(&[system(1, 100), tools(2, 40), message(3, 60), tail(9, 30)]);
        assert_eq!(classify_break(&changed, &previous), None);
        // Tail removed (the persistent prefix is unchanged).
        let without_tail = digest(&[system(1, 100), tools(2, 40), message(3, 60)]);
        assert_eq!(classify_break(&without_tail, &previous), None);
        // New message appended after the previous tail (persistent growth).
        let appended = digest(&[
            system(1, 100),
            tools(2, 40),
            message(3, 60),
            message(5, 60),
            tail(4, 30),
        ]);
        assert_eq!(classify_break(&appended, &previous), None);
    }

    #[test]
    fn appended_messages_are_not_breaks() {
        let previous = digest(&[system(1, 100), tools(2, 40), message(3, 60)]);
        let current = digest(&[system(1, 100), tools(2, 40), message(3, 60), message(4, 60)]);
        assert_eq!(classify_break(&current, &previous), None);
        assert_eq!(persistent_len(&previous), 3);
    }

    #[test]
    fn normalizes_anthropic_input_excluding_cache() {
        // Anthropic: input_tokens excludes cache read/write.
        let usage = anthropic_usage(100, 900, 0);
        let counters = counters("anthropic", &usage);
        assert_eq!(counters.input_total, 1_000);
        assert_eq!(counters.cache_read, 900);
        assert_eq!(counters.uncached, 100);
        assert_eq!(hit_percent("anthropic", &usage), Some(90.0));
    }

    #[test]
    fn normalizes_openai_inclusive_input() {
        let usage = UsageInfo {
            input_tokens: Some(1_000),
            cached_tokens: Some(900),
            cache_reported: true,
            ..Default::default()
        };
        let counters = counters("openai-chat", &usage);
        assert_eq!(counters.input_total, 1_000);
        assert_eq!(counters.cache_read, 900);
        assert_eq!(counters.uncached, 100);
        assert_eq!(hit_percent("openai-chat", &usage), Some(90.0));
    }

    #[test]
    fn explicit_uncached_wins() {
        let usage = UsageInfo {
            input_tokens: Some(999_999),
            cache_read_tokens: Some(900),
            cache_write_tokens: Some(50),
            uncached_input_tokens: Some(50),
            cache_reported: true,
            ..Default::default()
        };
        let counters = counters("openai-responses", &usage);
        assert_eq!(counters.input_total, 1_000);
        assert_eq!(counters.uncached, 50);
        assert_eq!(hit_percent("openai-responses", &usage), Some(90.0));
    }

    #[test]
    fn unreported_cache_has_no_hit_percent() {
        let usage = UsageInfo {
            input_tokens: Some(1_000),
            ..Default::default()
        };
        assert!(!reported(&usage));
        assert_eq!(hit_percent("google", &usage), None);
        assert_eq!(
            state(
                hit_percent("google", &usage),
                reported(&usage),
                false,
                false
            ),
            CacheState::Unsupported
        );
    }

    #[test]
    fn reported_zero_read_is_zero_percent_not_none() {
        let usage = anthropic_usage(1_000, 0, 0);
        assert_eq!(hit_percent("anthropic", &usage), Some(0.0));
    }

    #[test]
    fn hit_percent_without_denominator_is_none() {
        let usage = UsageInfo {
            cache_read_tokens: Some(900),
            cache_reported: true,
            ..Default::default()
        };
        assert_eq!(hit_percent("openai-chat", &usage), None);
    }

    #[test]
    fn state_machine_precedence() {
        assert_eq!(state(Some(99.0), true, true, false), CacheState::Cold);
        assert_eq!(state(None, false, false, false), CacheState::Unsupported);
        assert_eq!(state(Some(99.0), true, false, true), CacheState::Degraded);
        assert_eq!(state(Some(95.0), true, false, false), CacheState::Stable);
        assert_eq!(state(Some(94.9), true, false, false), CacheState::Warming);
        assert_eq!(state(Some(0.0), true, false, false), CacheState::Warming);
    }
}
