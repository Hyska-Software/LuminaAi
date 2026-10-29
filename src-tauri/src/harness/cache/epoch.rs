//! In-memory epoch bookkeeping for prompt-cache telemetry (F0a).
//!
//! The epoch is the generation of the cacheable prefix. It starts at `1` for
//! the first request observed by a [`EpochTracker`] and increments whenever the
//! provider, the model or the wire protocol changes (caches of different
//! routes never communicate). F0a is in-memory only; F1 persists it in
//! `cache_state`.

use crate::domain::CacheBreakReason;

/// Identity of a cacheable route: same provider + model + protocol means the
/// same cache domain.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EpochKey {
    pub provider_id: String,
    pub model_id: String,
    pub protocol: String,
}

/// Result of observing one request identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EpochChange {
    /// First request of the tracker: starts epoch 1.
    First,
    /// Same route as the previous request: the epoch continues.
    Continue,
    /// Route changed: a new epoch started, with the break cause.
    Changed(CacheBreakReason),
}

/// Tracks the current epoch and the 1-based request index inside it.
#[derive(Debug, Clone, Default)]
pub struct EpochTracker {
    epoch: u32,
    key: Option<EpochKey>,
    /// 1-based index of the last observed request inside the epoch.
    request_index: u32,
    /// Total requests observed since the tracker was created.
    samples: u32,
}

impl EpochTracker {
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Current epoch (`0` before the first request, `1` for the first epoch).
    pub fn epoch(&self) -> u32 {
        self.epoch
    }

    /// 1-based index of the last observed request inside the current epoch.
    #[allow(dead_code)]
    pub fn request_index(&self) -> u32 {
        self.request_index
    }

    /// Total requests observed by this tracker.
    #[allow(dead_code)]
    pub fn samples(&self) -> u32 {
        self.samples
    }

    /// Seeds the tracker with the persisted epoch/route (`cache_state`, F1.1).
    /// The next observation continues this epoch when the route matches, or
    /// starts `epoch + 1` when it changed.
    pub(crate) fn seed(&mut self, epoch: u32, key: Option<EpochKey>) {
        self.epoch = epoch;
        self.key = key;
        self.request_index = 0;
    }

    /// Increments the epoch without changing the route (compaction/regenerate
    /// explicitly invalidate the prefix, F3b). The caller marks the next sample
    /// as the first of the new epoch.
    pub(crate) fn bump_epoch(&mut self) {
        self.epoch = self.epoch.saturating_add(1).max(1);
        self.request_index = 0;
    }

    /// Observes one request identity, starting a new epoch when the route
    /// (provider/model/protocol) changed.
    pub fn observe(&mut self, provider_id: &str, model_id: &str, protocol: &str) -> EpochChange {
        let key = EpochKey {
            provider_id: provider_id.to_string(),
            model_id: model_id.to_string(),
            protocol: protocol.to_string(),
        };
        self.samples = self.samples.saturating_add(1);
        let change = match self.key.as_ref() {
            None => {
                self.epoch = 1;
                self.request_index = 0;
                EpochChange::First
            }
            Some(previous) if *previous == key => EpochChange::Continue,
            Some(previous) => {
                self.epoch = self.epoch.saturating_add(1);
                self.request_index = 0;
                // A provider/model change is the stronger cause: a protocol
                // fallback on the same route is `ProtocolFallback`.
                EpochChange::Changed(
                    if previous.provider_id != key.provider_id || previous.model_id != key.model_id
                    {
                        CacheBreakReason::ModelSwitch
                    } else {
                        CacheBreakReason::ProtocolFallback
                    },
                )
            }
        };
        self.key = Some(key);
        self.request_index = self.request_index.saturating_add(1);
        change
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_request_starts_epoch_one() {
        let mut tracker = EpochTracker::new();
        assert_eq!(tracker.epoch(), 0);
        assert_eq!(
            tracker.observe("opencode-go", "deepseek", "openai-chat"),
            EpochChange::First
        );
        assert_eq!(tracker.epoch(), 1);
        assert_eq!(tracker.request_index(), 1);
        assert_eq!(tracker.samples(), 1);
    }

    #[test]
    fn same_route_continues_the_epoch() {
        let mut tracker = EpochTracker::new();
        tracker.observe("opencode-go", "deepseek", "openai-chat");
        assert_eq!(
            tracker.observe("opencode-go", "deepseek", "openai-chat"),
            EpochChange::Continue
        );
        assert_eq!(tracker.epoch(), 1);
        assert_eq!(tracker.request_index(), 2);
        assert_eq!(tracker.samples(), 2);
    }

    #[test]
    fn model_change_starts_a_model_switch_epoch() {
        let mut tracker = EpochTracker::new();
        tracker.observe("opencode-go", "deepseek", "openai-chat");
        assert_eq!(
            tracker.observe("opencode-go", "glm", "openai-chat"),
            EpochChange::Changed(CacheBreakReason::ModelSwitch)
        );
        assert_eq!(tracker.epoch(), 2);
        assert_eq!(tracker.request_index(), 1);
    }

    #[test]
    fn protocol_change_starts_a_protocol_fallback_epoch() {
        let mut tracker = EpochTracker::new();
        tracker.observe("opencode-go", "deepseek", "openai-chat");
        assert_eq!(
            tracker.observe("opencode-go", "deepseek", "openai-responses"),
            EpochChange::Changed(CacheBreakReason::ProtocolFallback)
        );
        assert_eq!(tracker.epoch(), 2);
    }

    #[test]
    fn model_change_wins_over_protocol_change() {
        let mut tracker = EpochTracker::new();
        tracker.observe("opencode-go", "deepseek", "openai-chat");
        assert_eq!(
            tracker.observe("openai", "gpt-5.6", "openai-responses"),
            EpochChange::Changed(CacheBreakReason::ModelSwitch)
        );
        assert_eq!(tracker.epoch(), 2);
    }

    #[test]
    fn seeded_epoch_continues_on_the_same_route() {
        let mut tracker = EpochTracker::new();
        tracker.seed(
            7,
            Some(EpochKey {
                provider_id: "p".to_string(),
                model_id: "m".to_string(),
                protocol: "openai-chat".to_string(),
            }),
        );
        assert_eq!(
            tracker.observe("p", "m", "openai-chat"),
            EpochChange::Continue
        );
        assert_eq!(tracker.epoch(), 7);
        assert_eq!(tracker.request_index(), 1);
    }

    #[test]
    fn seeded_epoch_increments_on_a_new_route() {
        let mut tracker = EpochTracker::new();
        tracker.seed(
            7,
            Some(EpochKey {
                provider_id: "p".to_string(),
                model_id: "m".to_string(),
                protocol: "openai-chat".to_string(),
            }),
        );
        assert_eq!(
            tracker.observe("p", "m2", "openai-chat"),
            EpochChange::Changed(CacheBreakReason::ModelSwitch)
        );
        assert_eq!(tracker.epoch(), 8);
    }
}
