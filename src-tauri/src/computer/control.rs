//! Per-conversation serialization of agent actions and human control changes.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

use parking_lot::Mutex;
use tokio::sync::{watch, Mutex as AsyncMutex};

/// All local desktop automation shares one physical Windows desktop.
pub const HOST_CONTROL: &str = "__lumina_host_desktop_control__";

pub fn request_host(db: &crate::db::Db, conversation_id: &str) -> Result<(), String> {
    let (paused, taken) = db
        .computer_control(HOST_CONTROL)
        .map_err(|error| error.to_string())?;
    let owner = db
        .computer_control_target(HOST_CONTROL)
        .map_err(|error| error.to_string())?;
    if (paused || taken) && owner != conversation_id {
        return Err("COMPUTER_CONTROL_HELD: outra conversa controla o computador local".into());
    }
    db.set_computer_control_target(HOST_CONTROL, conversation_id)
        .map_err(|error| error.to_string())?;
    db.set_computer_control(
        HOST_CONTROL,
        Some(true),
        Some(true),
        crate::domain::now_ms(),
    )
    .map_err(|error| error.to_string())?;
    gate(HOST_CONTROL).request_takeover();
    Ok(())
}

pub fn release_host(db: &crate::db::Db, conversation_id: &str) -> Result<(), String> {
    let owner = db
        .computer_control_target(HOST_CONTROL)
        .map_err(|error| error.to_string())?;
    if owner == conversation_id {
        db.set_computer_control(
            HOST_CONTROL,
            Some(false),
            Some(false),
            crate::domain::now_ms(),
        )
        .map_err(|error| error.to_string())?;
        db.set_computer_control_target(HOST_CONTROL, "")
            .map_err(|error| error.to_string())?;
        gate(HOST_CONTROL).request_takeover();
    }
    Ok(())
}

#[derive(Default)]
pub struct ControlGate {
    pub action: AsyncMutex<()>,
    pub transition: AsyncMutex<()>,
    pub startup: AsyncMutex<()>,
    pub interactive_stream: Arc<AsyncMutex<()>>,
    stream_cleanup_error: Mutex<Option<String>>,
    browser_generation: Mutex<Option<String>>,
    takeover: watch::Sender<u64>,
    active_stream: AtomicU64,
}

impl ControlGate {
    /// Call while holding `action`, together with the ownership transition.
    pub fn browser_generation(&self) -> Option<String> {
        self.browser_generation.lock().clone()
    }

    pub fn start_browser_generation(&self) -> String {
        let generation = uuid::Uuid::new_v4().to_string();
        *self.browser_generation.lock() = Some(generation.clone());
        generation
    }

    pub fn invalidate_browser_generation(&self) {
        *self.browser_generation.lock() = None;
    }

    pub fn require_browser_generation(&self, generation: &str) -> Result<(), String> {
        if self.browser_generation.lock().as_deref() == Some(generation) {
            Ok(())
        } else {
            Err("BROWSER_CONTROL_STALE: a tomada de controle mudou".into())
        }
    }
    pub fn request_takeover(&self) {
        self.takeover
            .send_modify(|generation| *generation = generation.wrapping_add(1));
    }

    pub fn subscribe(&self) -> watch::Receiver<u64> {
        self.takeover.subscribe()
    }

    pub fn claim_stream(&self) -> u64 {
        let generation = self
            .active_stream
            .fetch_add(1, Ordering::SeqCst)
            .wrapping_add(1);
        self.request_takeover();
        generation
    }

    pub fn owns_stream(&self, generation: u64) -> bool {
        self.active_stream.load(Ordering::SeqCst) == generation
    }

    pub fn invalidate_stream(&self) {
        self.claim_stream();
    }

    pub fn stream_cleanup_result(&self) -> Result<(), String> {
        match self.stream_cleanup_error.lock().as_ref() {
            Some(error) => Err(format!("COMPUTER_INPUT_CLEANUP_FAILED: {error}")),
            None => Ok(()),
        }
    }

    pub fn set_stream_cleanup_error(&self, error: String) {
        *self.stream_cleanup_error.lock() = Some(error);
    }

    pub fn clear_stream_cleanup_error(&self) {
        *self.stream_cleanup_error.lock() = None;
    }

    /// Revoke the current peer and keep replacements out until the handoff ends.
    pub async fn drain_interactive_stream(&self) -> Result<tokio::sync::OwnedMutexGuard<()>, String> {
        self.invalidate_stream();
        let guard = self.interactive_stream.clone().lock_owned().await;
        self.stream_cleanup_result()?;
        Ok(guard)
    }
}

/// Retain gates so a failed stream cleanup remains fail-closed until Stop.
pub fn gate(conversation_id: &str) -> Arc<ControlGate> {
    static GATES: OnceLock<Mutex<HashMap<String, Arc<ControlGate>>>> = OnceLock::new();
    let mut gates = GATES.get_or_init(Default::default).lock();
    gates.entry(conversation_id.to_string()).or_default().clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn browser_input_queued_before_release_is_rejected_after_retake() {
        let gate = Arc::new(ControlGate::default());
        let handoff = gate.action.lock().await;
        let first = gate.start_browser_generation();
        let other = gate.clone();
        let old = first.clone();
        let queued = tokio::spawn(async move {
            let _action = other.action.lock().await;
            other.require_browser_generation(&old)
        });
        tokio::task::yield_now().await;
        gate.invalidate_browser_generation();
        let second = gate.start_browser_generation();
        assert_ne!(first, second);
        drop(handoff);
        assert!(queued.await.expect("task").is_err());
        assert!(gate.require_browser_generation(&second).is_ok());
        gate.invalidate_browser_generation();
        assert!(gate.require_browser_generation(&second).is_err());
    }

    #[tokio::test]
    async fn release_waits_for_stream_cleanup_and_blocks_replacement() {
        let gate = Arc::new(ControlGate::default());
        let generation = gate.claim_stream();
        let stream = gate.interactive_stream.clone().lock_owned().await;
        let other = gate.clone();
        let release = tokio::spawn(async move { other.drain_interactive_stream().await });
        tokio::task::yield_now().await;
        assert!(!gate.owns_stream(generation));
        assert!(!release.is_finished());
        drop(stream);
        let handoff = release.await.expect("task").expect("cleanup succeeded");
        assert!(gate.interactive_stream.try_lock().is_err());
        drop(handoff);
        assert!(gate.interactive_stream.try_lock().is_ok());
    }

    #[tokio::test]
    async fn release_rejects_failed_cleanup_after_stream_finishes() {
        let gate = Arc::new(ControlGate::default());
        let stream = gate.interactive_stream.clone().lock_owned().await;
        let other = gate.clone();
        let release = tokio::spawn(async move { other.drain_interactive_stream().await });
        tokio::task::yield_now().await;
        gate.set_stream_cleanup_error("X11 unavailable".into());
        drop(stream);
        let error = release.await.expect("task").expect_err("must fail closed");
        assert!(error.contains("COMPUTER_INPUT_CLEANUP_FAILED"));
        assert!(gate.stream_cleanup_result().is_err());
    }

    #[tokio::test]
    async fn takeover_notifies_actions_and_waits_for_their_guard() {
        let gate = gate("control-test");
        let mut pending = gate.subscribe();
        let action = gate.action.lock().await;
        gate.request_takeover();
        pending.changed().await.expect("takeover notification");
        assert!(gate.action.try_lock().is_err());
        drop(action);
        assert!(gate.action.try_lock().is_ok());
        assert!(Arc::ptr_eq(&gate, &super::gate("control-test")));
        assert!(!Arc::ptr_eq(&gate, &super::gate("another-conversation")));
    }

    #[test]
    fn control_and_observation_state_survive_restart_without_resuming_the_agent() {
        let dir = tempfile::tempdir().expect("temporary directory");
        let path = dir.path().join("control.db");
        let db = crate::db::Db::open(&path).expect("database");
        db.set_computer_control("conversation", Some(true), Some(true), 1)
            .expect("takeover");
        db.set_computer_needs_observation("conversation", true)
            .expect("require observation");
        drop(db);
        let db = crate::db::Db::open(&path).expect("reopen database");
        db.reset_all_computer_controls()
            .expect("reconcile ownership");
        assert_eq!(
            db.computer_control("conversation").expect("state"),
            (true, false)
        );
        assert!(db
            .computer_needs_observation("conversation")
            .expect("observation"));
        db.set_computer_needs_observation("conversation", false)
            .expect("observed");
        assert!(!db
            .computer_needs_observation("conversation")
            .expect("observation"));
    }

    #[test]
    fn host_ownership_is_exclusive_and_survives_restart() {
        let dir = tempfile::tempdir().expect("temporary directory");
        let db = crate::db::Db::open(&dir.path().join("host.db")).expect("database");
        request_host(&db, "first").expect("first owner");
        assert!(request_host(&db, "second").is_err());
        db.reset_all_computer_controls().expect("reconcile");
        assert!(request_host(&db, "second").is_err());
        assert_eq!(
            db.computer_control_target(HOST_CONTROL).expect("owner"),
            "first"
        );
        release_host(&db, "first").expect("release");
        request_host(&db, "second").expect("second owner");
    }

    #[tokio::test]
    async fn host_takeover_notifies_other_conversations_and_waits_for_actions() {
        let dir = tempfile::tempdir().expect("temporary directory");
        let db = crate::db::Db::open(&dir.path().join("host-gate.db")).expect("database");
        let host = gate(HOST_CONTROL);
        let mut notifications = host.subscribe();
        let action = host.action.lock().await;
        request_host(&db, "first").expect("request");
        notifications.changed().await.expect("notification");
        assert!(host.action.try_lock().is_err());
        assert_eq!(
            db.computer_control(HOST_CONTROL).expect("state"),
            (true, true)
        );
        drop(action);
        assert!(host.action.try_lock().is_ok());
        release_host(&db, "first").expect("release");
    }
}
