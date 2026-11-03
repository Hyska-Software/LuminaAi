//! Private per-conversation working directories for agents.

use std::path::{Path, PathBuf};
use anyhow::{bail, Context};
use sha2::{Digest, Sha256};

/// Resolve an app-owned directory without accepting paths supplied by a model.
pub(crate) fn prepare(data_dir: &Path, conversation_id: &str) -> anyhow::Result<PathBuf> {
    prepare_key(data_dir, conversation_id)
}

/// Task-scoped internal workspace. The key survives handoffs because it is
/// derived from the durable task id, not from the current owner thread.
pub(crate) fn prepare_for_task(data_dir: &Path, task_id: &str) -> anyhow::Result<PathBuf> {
    prepare_key(data_dir, &format!("task:{task_id}"))
}

fn prepare_key(data_dir: &Path, key: &str) -> anyhow::Result<PathBuf> {
    std::fs::create_dir_all(data_dir).context("create application data directory")?;
    let root = data_dir.canonicalize().context("resolve application data directory")?;
    let parent = root.join("agent-workspaces");
    create_child(&root, &parent)?;
    let target = path(&root, key);
    create_child(&parent, &target)
}

/// Path of the internal workspace without creating it. Used by cleanup paths.
pub(crate) fn path(data_dir: &Path, key: &str) -> PathBuf {
    let name: String = Sha256::digest(key.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    data_dir.join("agent-workspaces").join(name)
}

fn create_child(parent: &Path, child: &Path) -> anyhow::Result<PathBuf> {
    match std::fs::create_dir(child) {
        Ok(()) => {},
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {},
        Err(error) => return Err(error).context("create agent workspace"),
    }
    let metadata = std::fs::symlink_metadata(child).context("inspect agent workspace")?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        bail!("AGENT_WORKSPACE_UNSAFE: workspace directory is not a regular directory");
    }
    let canonical = child.canonicalize().context("resolve agent workspace")?;
    if canonical.parent() != Some(parent) {
        bail!("AGENT_WORKSPACE_UNSAFE: workspace directory escapes its parent");
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_workspaces_are_stable_isolated_and_do_not_escape_the_app_directory() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let first = prepare(temp.path(), "conversation-1").expect("first workspace");
        let again = prepare(temp.path(), "conversation-1").expect("same workspace");
        let second = prepare(temp.path(), "../conversation-1").expect("other workspace");
        assert_eq!(first, again);
        assert_ne!(first, second);
        assert!(first.is_dir());
        assert!(second.is_dir());
        assert!(first.starts_with(temp.path().canonicalize().expect("app directory")));
        assert!(second.starts_with(temp.path().canonicalize().expect("app directory")));
    }

    #[test]
    fn agent_turns_use_the_tool_runtime_without_an_explicit_workspace() {
        use crate::domain::TurnProfile;
        assert_eq!(super::super::agent_turn_profile(true, TurnProfile::Chat), TurnProfile::Code);
        assert_eq!(super::super::agent_turn_profile(true, TurnProfile::Code), TurnProfile::Code);
        assert_eq!(super::super::agent_turn_profile(false, TurnProfile::Chat), TurnProfile::Chat);
    }

    #[test]
    fn implicit_workspace_does_not_enable_process_or_subagent_tools() {
        let mut tools = vec!["run_command", "run_checks", "task", "browser_snapshot", "computer_screenshot"]
            .into_iter().map(str::to_string).collect();
        super::super::restrict_implicit_agent_workspace(&mut tools);
        assert_eq!(tools, vec!["browser_snapshot", "computer_screenshot"]);
    }

    #[test]
    fn task_workspaces_are_shared_by_task_id_not_thread() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let first = prepare_for_task(temp.path(), "task-1").expect("first");
        let second = prepare_for_task(temp.path(), "task-1").expect("second");
        let other = prepare_for_task(temp.path(), "task-2").expect("other");
        assert_eq!(first, second);
        assert_ne!(first, other);
        assert!(first.starts_with(temp.path().canonicalize().expect("root")));
    }

    #[test]
    fn rejects_an_existing_file_where_the_workspace_root_should_be() {
        let temp = tempfile::tempdir().expect("temporary directory");
        std::fs::write(temp.path().join("agent-workspaces"), b"not a directory").expect("file");
        assert!(prepare(temp.path(), "conversation").is_err());
    }

    #[test]
    fn computer_and_browser_capabilities_do_not_grant_each_other() {
        let allowed = super::super::agent_computer_tool_allowed;
        assert!(!allowed("computer_screenshot", false, false, true, "auto"));
        assert!(allowed("browser_snapshot", false, false, true, "auto"));
        assert!(allowed("computer_screenshot", false, true, false, "auto"));
        assert!(!allowed("computer_click", false, true, false, "auto"));
        assert!(!allowed("computer_screenshot", true, true, true, "browser"));
        assert!(!allowed("browser_snapshot", true, true, true, "off"));
    }
}
