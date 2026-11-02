//! Global turn concurrency governor.
//!
//! The renderer can start several agent threads at once, but the backend is the
//! final authority for cost/CPU protection. A turn acquires one global slot and
//! (for agent conversations) one per-agent slot before the harness runs. Waiting
//! turns are cancellable through the same `CancellationToken` used by the turn.

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

/// Effective limits for one acquisition (loaded from settings by the command).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TurnLimits {
    pub global: usize,
    pub per_agent: usize,
}

impl Default for TurnLimits {
    fn default() -> Self {
        Self {
            global: 3,
            per_agent: 1,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GovernorSnapshot {
    pub global_active: usize,
    pub per_agent: HashMap<String, usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcquireError {
    Cancelled,
}

#[derive(Default)]
struct GovernorState {
    global_active: usize,
    per_agent: HashMap<String, usize>,
}

/// RAII slot. Dropping the permit releases the global and per-agent counters.
pub struct TurnPermit {
    governor: Arc<ConcurrencyGovernor>,
    agent_key: Option<String>,
}

impl Drop for TurnPermit {
    fn drop(&mut self) {
        let mut state = self.governor.state.lock();
        state.global_active = state.global_active.saturating_sub(1);
        if let Some(key) = self.agent_key.as_ref() {
            if let Some(value) = state.per_agent.get_mut(key) {
                *value = value.saturating_sub(1);
                if *value == 0 {
                    state.per_agent.remove(key);
                }
            }
        }
        drop(state);
        self.governor.notify.notify_waiters();
    }
}

#[derive(Default)]
pub struct ConcurrencyGovernor {
    state: Mutex<GovernorState>,
    notify: Notify,
}

impl ConcurrencyGovernor {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn snapshot(&self) -> GovernorSnapshot {
        let state = self.state.lock();
        GovernorSnapshot {
            global_active: state.global_active,
            per_agent: state.per_agent.clone(),
        }
    }

    fn try_take(state: &mut GovernorState, agent_key: Option<&str>, limits: TurnLimits) -> bool {
        let agent_active = agent_key
            .map(|key| state.per_agent.get(key).copied().unwrap_or(0))
            .unwrap_or(0);
        if state.global_active >= limits.global.max(1)
            || (agent_key.is_some() && agent_active >= limits.per_agent.max(1))
        {
            return false;
        }
        state.global_active += 1;
        if let Some(key) = agent_key {
            *state.per_agent.entry(key.to_string()).or_insert(0) += 1;
        }
        true
    }

    /// Acquires a slot, waiting until one is free or the turn is cancelled.
    pub async fn acquire(
        self: &Arc<Self>,
        agent_key: Option<String>,
        limits: TurnLimits,
        cancel: &CancellationToken,
    ) -> Result<TurnPermit, AcquireError> {
        loop {
            let notified = self.notify.notified();
            {
                let mut state = self.state.lock();
                if Self::try_take(&mut state, agent_key.as_deref(), limits) {
                    return Ok(TurnPermit {
                        governor: self.clone(),
                        agent_key,
                    });
                }
            }
            tokio::select! {
                _ = notified => {}
                _ = cancel.cancelled() => return Err(AcquireError::Cancelled),
            }
            if cancel.is_cancelled() {
                return Err(AcquireError::Cancelled);
            }
        }
    }

    /// Non-blocking acquisition used by background schedulers (routines/tasks).
    pub fn try_acquire(
        self: &Arc<Self>,
        agent_key: Option<String>,
        limits: TurnLimits,
    ) -> Option<TurnPermit> {
        let mut state = self.state.lock();
        if Self::try_take(&mut state, agent_key.as_deref(), limits) {
            Some(TurnPermit {
                governor: self.clone(),
                agent_key,
            })
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn global_limit_waits_and_releases() {
        let governor = ConcurrencyGovernor::new();
        let first = governor
            .acquire(None, TurnLimits { global: 1, per_agent: 1 }, &CancellationToken::new())
            .await
            .expect("first");
        assert_eq!(governor.snapshot().global_active, 1);

        let second_governor = governor.clone();
        let second = tokio::spawn(async move {
            second_governor
                .acquire(
                    None,
                    TurnLimits { global: 1, per_agent: 1 },
                    &CancellationToken::new(),
                )
                .await
        });
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        assert!(!second.is_finished());
        drop(first);
        let permit = second.await.expect("join").expect("second");
        assert_eq!(governor.snapshot().global_active, 1);
        drop(permit);
        assert_eq!(governor.snapshot().global_active, 0);
    }

    #[tokio::test]
    async fn per_agent_limit_is_independent() {
        let governor = ConcurrencyGovernor::new();
        let limits = TurnLimits {
            global: 4,
            per_agent: 1,
        };
        let first = governor
            .acquire(Some("agent-1".into()), limits, &CancellationToken::new())
            .await
            .expect("first");
        assert!(governor
            .try_acquire(Some("agent-1".into()), limits)
            .is_none());
        let second = governor
            .try_acquire(Some("agent-2".into()), limits)
            .expect("other agent");
        assert_eq!(governor.snapshot().per_agent.get("agent-1"), Some(&1));
        assert_eq!(governor.snapshot().per_agent.get("agent-2"), Some(&1));
        drop(first);
        drop(second);
        assert!(governor.snapshot().per_agent.is_empty());
    }

    #[tokio::test]
    async fn waiting_acquisition_can_be_cancelled() {
        let governor = ConcurrencyGovernor::new();
        let held = governor
            .acquire(None, TurnLimits { global: 1, per_agent: 1 }, &CancellationToken::new())
            .await
            .expect("held");
        let cancel = CancellationToken::new();
        let waiter = {
            let governor = governor.clone();
            let cancel = cancel.clone();
            tokio::spawn(async move {
                governor
                    .acquire(None, TurnLimits { global: 1, per_agent: 1 }, &cancel)
                    .await
            })
        };
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        cancel.cancel();
        assert!(matches!(
            waiter.await.expect("join"),
            Err(AcquireError::Cancelled)
        ));
        drop(held);
    }
}
