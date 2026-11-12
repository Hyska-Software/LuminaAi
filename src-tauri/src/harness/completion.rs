//! Completion gate for top-level Code turns.
//!
//! The agent loop treats "assistant message without tool calls" as the end of
//! the turn. That is only safe when the work is actually finished: this module
//! inspects the persisted todo list, the turn's edit/check receipts and the
//! plan state, and either accepts the stop or asks the harness to inject a
//! continuation prompt. It is the Zylara equivalent of a Claude Code `Stop`
//! hook, with the loop cap enforced by the caller.

use serde_json::Value;

use crate::domain::{TodoItem, TodoStatus};
use crate::tools::ToolOutcome;

/// Consecutive continuations the harness allows in a single turn before it
/// accepts the stop and marks the message as incomplete.
pub const MAX_STOP_CONTINUATIONS: u32 = 4;

/// Maximum number of open tasks listed in a continuation prompt.
const MAX_PROMPT_TODOS: usize = 12;
/// Longest `run_command` text kept in a receipt/prompt.
const MAX_COMMAND_CHARS: usize = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContinueReason {
    PlanNotSubmitted,
    PendingTodos,
    FailedCheck,
    MissingVerification,
    MissingTodoLedger,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckReceipt {
    /// `"run_checks"` or the raw `run_command` command (trimmed, <= 120 chars).
    pub command: String,
    pub exit_code: Option<i32>,
    /// `TurnProgress::mutations` at the moment the check finished.
    pub mutations_at: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AskReceipt {
    pub skipped: bool,
    pub mutations_at: u32,
}

/// State accumulated from the turn's finished tool calls.
#[derive(Debug, Clone, Default)]
pub struct TurnProgress {
    pub mutations: u32,
    /// Set by a successful `todo_write`; value = mutations when it ran.
    pub todos_written_at: Option<u32>,
    /// Set by a successful `submit_plan`; value = mutations when it ran.
    pub plan_submitted_at: Option<u32>,
    pub last_check: Option<CheckReceipt>,
    pub last_ask: Option<AskReceipt>,
}

pub struct StopEvidence<'a> {
    pub todos: &'a [TodoItem],
    pub progress: &'a TurnProgress,
    pub project_has_checks: bool,
    pub todo_tool_available: bool,
    pub plan_mode: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopDecision {
    Accept,
    Continue(ContinueReason),
}

impl TurnProgress {
    /// Inspect one finished tool call. `arguments` is the raw JSON string.
    ///
    /// Errored outcomes record nothing: a denied approval or a failed tool is
    /// not evidence of work or verification.
    pub fn observe(&mut self, name: &str, arguments: &str, outcome: &ToolOutcome) {
        if outcome.is_error {
            return;
        }
        // Any tool that reports a file change counts as a mutation (write_file,
        // edit_file and future mutating tools share this presentation kind).
        if presentation_str(outcome, "kind") == Some("file_change") {
            self.mutations = self.mutations.saturating_add(1);
        }
        match name {
            "todo_write" => self.todos_written_at = Some(self.mutations),
            "submit_plan" => self.plan_submitted_at = Some(self.mutations),
            "ask_user" => {
                let skipped = outcome
                    .presentation
                    .as_ref()
                    .and_then(|presentation| presentation.get("skipped"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                self.last_ask = Some(AskReceipt {
                    skipped,
                    mutations_at: self.mutations,
                });
            }
            "run_checks" => {
                if let Some(exit_code) = exit_code(outcome) {
                    self.last_check = Some(CheckReceipt {
                        command: "run_checks".to_string(),
                        exit_code: Some(exit_code),
                        mutations_at: self.mutations,
                    });
                }
            }
            "run_command" => {
                let command = command_of(arguments);
                if is_verification_command(&command) {
                    if let Some(exit_code) = exit_code(outcome) {
                        self.last_check = Some(CheckReceipt {
                            command: truncate_command(&command),
                            exit_code: Some(exit_code),
                            mutations_at: self.mutations,
                        });
                    }
                }
            }
            _ => {}
        }
    }

    /// A verification ran after the last file mutation.
    pub fn verified_after_last_mutation(&self) -> bool {
        self.last_check
            .as_ref()
            .is_some_and(|check| check.mutations_at == self.mutations)
    }

    /// The verification after the last mutation failed. Read-only turns (no
    /// mutations) never count a pre-existing failure against the agent.
    pub fn last_check_failed(&self) -> bool {
        self.mutations > 0
            && self
                .last_check
                .as_ref()
                .is_some_and(|check| {
                    check.mutations_at == self.mutations && check.exit_code != Some(0)
                })
    }
}

/// Decide whether a stop attempt may end the turn.
pub fn decide(evidence: StopEvidence<'_>) -> StopDecision {
    let progress = evidence.progress;

    // The user explicitly skipped the question and nothing changed since: the
    // agent is waiting for the user, not hiding unfinished work.
    if progress
        .last_ask
        .as_ref()
        .is_some_and(|ask| ask.skipped && ask.mutations_at == progress.mutations)
    {
        return StopDecision::Accept;
    }

    // The plan is the deliverable of a plan-mode turn, or the model edited
    // nothing after submitting it.
    if progress.plan_submitted_at == Some(progress.mutations) {
        return StopDecision::Accept;
    }

    if evidence.plan_mode {
        return StopDecision::Continue(ContinueReason::PlanNotSubmitted);
    }

    if evidence.todo_tool_available
        && evidence
            .todos
            .iter()
            .any(|todo| matches!(todo.status, TodoStatus::Pending | TodoStatus::InProgress))
    {
        return StopDecision::Continue(ContinueReason::PendingTodos);
    }

    if progress.last_check_failed() {
        return StopDecision::Continue(ContinueReason::FailedCheck);
    }

    if progress.mutations > 0
        && evidence.project_has_checks
        && !progress.verified_after_last_mutation()
    {
        return StopDecision::Continue(ContinueReason::MissingVerification);
    }

    if progress.mutations > 0
        && evidence.todo_tool_available
        && evidence.todos.is_empty()
        && progress.todos_written_at != Some(progress.mutations)
    {
        return StopDecision::Continue(ContinueReason::MissingTodoLedger);
    }

    StopDecision::Accept
}

/// User-role message injected after a rejected stop. Model-facing, English.
pub fn continuation_prompt(
    reason: ContinueReason,
    todos: &[TodoItem],
    progress: &TurnProgress,
    iteration: u32,
) -> String {
    let body = match reason {
        ContinueReason::PlanNotSubmitted => "Plan mode is active and this turn has not submitted \
             a plan. Finish the investigation and call `submit_plan` with an \
             implementation-ready plan; do not end the turn without it."
            .to_string(),
        ContinueReason::PendingTodos => {
            let mut out = String::from(
                "The task list still has open items. Continue with the work now, one \
                 `in_progress` task at a time, and mark each item completed only after you \
                 verify it. Open tasks:",
            );
            let open: Vec<&TodoItem> = todos
                .iter()
                .filter(|todo| {
                    matches!(todo.status, TodoStatus::Pending | TodoStatus::InProgress)
                })
                .collect();
            for todo in open.iter().take(MAX_PROMPT_TODOS) {
                let mark = if todo.status == TodoStatus::InProgress {
                    "[~]"
                } else {
                    "[ ]"
                };
                out.push_str(&format!("\n- {mark} {}", todo.content.trim()));
            }
            if open.len() > MAX_PROMPT_TODOS {
                out.push_str(&format!(
                    "\n…and {} more",
                    open.len().saturating_sub(MAX_PROMPT_TODOS)
                ));
            }
            out
        }
        ContinueReason::FailedCheck => {
            let (command, code) = progress
                .last_check
                .as_ref()
                .map(|check| {
                    (
                        check.command.as_str(),
                        check
                            .exit_code
                            .map(|code| code.to_string())
                            .unwrap_or_else(|| "?".to_string()),
                    )
                })
                .unwrap_or(("run_checks", "?".to_string()));
            format!(
                "The last verification (`{command}`) failed with exit code {code}. Fix the \
                 failure and run the check again; do not end the turn with a failing check you \
                 introduced."
            )
        }
        ContinueReason::MissingVerification => "You changed files in this turn but have not \
             verified them since the last change. Run the narrowest check that covers the change \
             (the project typecheck/lint or the related test file with `run_command`; \
             `run_checks` when the full suite is the right scope), read the exit code, and fix \
             what it reports before answering."
            .to_string(),
        ContinueReason::MissingTodoLedger => "You changed files without a `todo_write` list, so \
             the app cannot verify that the work is complete. Call `todo_write` with the \
             remaining steps (or `[]` only if everything is done and verified), then continue."
            .to_string(),
    };
    let mut text = format!("[completion-gate] {body}");
    text.push_str(&format!(
        "\n\n(completion-gate continuation {iteration}/{MAX_STOP_CONTINUATIONS})"
    ));
    text
}

/// One-time warning near the end of the step budget. Transient (never persisted).
pub fn budget_notice(step: u32, max_steps: u32) -> Option<String> {
    if max_steps < 5 {
        return None;
    }
    let notice_step = max_steps.saturating_mul(4) / 5;
    if step != notice_step {
        return None;
    }
    let remaining = max_steps.saturating_sub(step).saturating_add(1);
    Some(format!(
        "[budget] {remaining} model steps remain in this turn. Prioritize finishing the current \
         implementation and running the project checks; record anything still open with \
         `todo_write` instead of stopping to report progress."
    ))
}

/// Heuristic used only to turn `run_command` calls into verification receipts.
/// Not a security control: approval policy still decides what may run.
pub fn is_verification_command(command: &str) -> bool {
    command.split(['\n', ';', '&', '|']).any(|segment| {
        let mut tokens = segment.split_whitespace();
        let Some(raw) = tokens.next() else {
            return false;
        };
        let program = raw
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(raw)
            .trim_end_matches(".exe")
            .trim_end_matches(".cmd");
        match program {
            "cargo" => matches!(
                tokens.next(),
                Some("check" | "test" | "build" | "clippy" | "nextest")
            ),
            "pnpm" | "npm" | "yarn" | "bun" => {
                let next = tokens.next();
                let subcommand = if next == Some("run") {
                    tokens.next()
                } else {
                    next
                };
                matches!(
                    subcommand,
                    Some("test" | "tests" | "lint" | "build" | "typecheck" | "check")
                )
            }
            "pytest" | "tsc" | "eslint" | "mypy" | "phpunit" | "rspec" | "jest" | "vitest" => {
                true
            }
            "go" => matches!(tokens.next(), Some("test" | "build" | "vet")),
            "dotnet" => matches!(tokens.next(), Some("build" | "test")),
            "mvn" | "mvnw" => matches!(tokens.next(), Some("test" | "verify" | "package")),
            "gradle" | "gradlew" => matches!(tokens.next(), Some("test" | "build" | "check")),
            "swift" => matches!(tokens.next(), Some("build" | "test")),
            "zig" => matches!(tokens.next(), Some("build")),
            "python" | "python3" => {
                tokens.next() == Some("-m") && matches!(tokens.next(), Some("pytest" | "mypy"))
            }
            _ => false,
        }
    })
}

fn presentation_str<'a>(outcome: &'a ToolOutcome, key: &str) -> Option<&'a str> {
    outcome
        .presentation
        .as_ref()
        .and_then(|presentation| presentation.get(key))
        .and_then(Value::as_str)
}

fn exit_code(outcome: &ToolOutcome) -> Option<i32> {
    if presentation_str(outcome, "kind") != Some("output") {
        return None;
    }
    let code = outcome
        .presentation
        .as_ref()
        .and_then(|presentation| presentation.get("exitCode"))
        .and_then(Value::as_i64)?;
    Some(code.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32)
}

fn command_of(arguments: &str) -> String {
    serde_json::from_str::<Value>(arguments)
        .ok()
        .and_then(|value| {
            value
                .get("command")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|command| !command.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_default()
}

fn truncate_command(command: &str) -> String {
    if command.chars().count() <= MAX_COMMAND_CHARS {
        return command.to_string();
    }
    let truncated: String = command.chars().take(MAX_COMMAND_CHARS).collect();
    format!("{truncated}…")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::TodoStatus;
    use serde_json::json;

    fn todo(content: &str, status: TodoStatus) -> TodoItem {
        TodoItem {
            content: content.to_string(),
            status,
        }
    }

    fn evidence<'a>(
        todos: &'a [TodoItem],
        progress: &'a TurnProgress,
    ) -> StopEvidence<'a> {
        StopEvidence {
            todos,
            progress,
            project_has_checks: false,
            todo_tool_available: true,
            plan_mode: false,
        }
    }

    fn outcome(presentation: Value, is_error: bool) -> ToolOutcome {
        ToolOutcome {
            presentation: Some(presentation),
            is_error,
            ..Default::default()
        }
    }

    #[test]
    fn accepts_a_clean_finish() {
        let todos = [todo("Implementar", TodoStatus::Completed)];
        let progress = TurnProgress::default();
        assert_eq!(decide(evidence(&todos, &progress)), StopDecision::Accept);
    }

    #[test]
    fn continues_with_pending_todos() {
        let todos = [todo("Backend", TodoStatus::Pending)];
        let progress = TurnProgress::default();
        assert_eq!(
            decide(evidence(&todos, &progress)),
            StopDecision::Continue(ContinueReason::PendingTodos)
        );
    }

    #[test]
    fn continues_with_an_in_progress_todo() {
        let todos = [todo("Backend", TodoStatus::InProgress)];
        let progress = TurnProgress::default();
        assert_eq!(
            decide(evidence(&todos, &progress)),
            StopDecision::Continue(ContinueReason::PendingTodos)
        );
    }

    #[test]
    fn continues_after_a_failed_check_following_a_mutation() {
        let progress = TurnProgress {
            mutations: 1,
            last_check: Some(CheckReceipt {
                command: "cargo check".into(),
                exit_code: Some(1),
                mutations_at: 1,
            }),
            ..Default::default()
        };
        assert_eq!(
            decide(evidence(&[], &progress)),
            StopDecision::Continue(ContinueReason::FailedCheck)
        );
    }

    #[test]
    fn accepts_a_passing_check_following_a_mutation() {
        let progress = TurnProgress {
            mutations: 2,
            todos_written_at: Some(2),
            last_check: Some(CheckReceipt {
                command: "run_checks".into(),
                exit_code: Some(0),
                mutations_at: 2,
            }),
            ..Default::default()
        };
        assert_eq!(decide(evidence(&[], &progress)), StopDecision::Accept);
    }

    #[test]
    fn continues_when_a_later_edit_invalidated_the_check() {
        let progress = TurnProgress {
            mutations: 2,
            last_check: Some(CheckReceipt {
                command: "run_checks".into(),
                exit_code: Some(0),
                mutations_at: 1,
            }),
            ..Default::default()
        };
        let mut evidence = evidence(&[], &progress);
        evidence.project_has_checks = true;
        assert_eq!(
            decide(evidence),
            StopDecision::Continue(ContinueReason::MissingVerification)
        );
    }

    #[test]
    fn continues_when_project_checks_were_never_run() {
        let progress = TurnProgress {
            mutations: 1,
            ..Default::default()
        };
        let mut evidence = evidence(&[], &progress);
        evidence.project_has_checks = true;
        assert_eq!(
            decide(evidence),
            StopDecision::Continue(ContinueReason::MissingVerification)
        );
    }

    #[test]
    fn continues_when_mutations_have_no_task_ledger() {
        let progress = TurnProgress {
            mutations: 1,
            ..Default::default()
        };
        assert_eq!(
            decide(evidence(&[], &progress)),
            StopDecision::Continue(ContinueReason::MissingTodoLedger)
        );
    }

    #[test]
    fn accepts_after_an_explicit_todo_write_following_the_mutation() {
        let progress = TurnProgress {
            mutations: 1,
            todos_written_at: Some(1),
            ..Default::default()
        };
        assert_eq!(decide(evidence(&[], &progress)), StopDecision::Accept);
    }

    #[test]
    fn accepts_after_a_submitted_plan_without_edits() {
        let progress = TurnProgress {
            plan_submitted_at: Some(0),
            ..Default::default()
        };
        assert_eq!(decide(evidence(&[], &progress)), StopDecision::Accept);
    }

    #[test]
    fn continues_in_plan_mode_without_a_submitted_plan() {
        let progress = TurnProgress::default();
        let mut evidence = evidence(&[], &progress);
        evidence.plan_mode = true;
        assert_eq!(
            decide(evidence),
            StopDecision::Continue(ContinueReason::PlanNotSubmitted)
        );
    }

    #[test]
    fn accepts_after_a_skipped_question_without_new_work() {
        let todos = [todo("Backend", TodoStatus::Pending)];
        let progress = TurnProgress {
            last_ask: Some(AskReceipt {
                skipped: true,
                mutations_at: 0,
            }),
            ..Default::default()
        };
        assert_eq!(decide(evidence(&todos, &progress)), StopDecision::Accept);
    }

    #[test]
    fn skipped_question_does_not_bypass_work_done_after_it() {
        let todos = [todo("Backend", TodoStatus::Pending)];
        let progress = TurnProgress {
            mutations: 1,
            last_ask: Some(AskReceipt {
                skipped: true,
                mutations_at: 0,
            }),
            ..Default::default()
        };
        assert_eq!(
            decide(evidence(&todos, &progress)),
            StopDecision::Continue(ContinueReason::PendingTodos)
        );
    }

    #[test]
    fn accepts_when_the_todo_tool_is_absent() {
        let todos = [todo("Backend", TodoStatus::Pending)];
        let progress = TurnProgress {
            mutations: 1,
            ..Default::default()
        };
        let mut evidence = evidence(&todos, &progress);
        evidence.todo_tool_available = false;
        assert_eq!(decide(evidence), StopDecision::Accept);
    }

    #[test]
    fn observe_records_mutations_only_from_file_change_presentations() {
        let mut progress = TurnProgress::default();
        progress.observe(
            "write_file",
            "{}",
            &outcome(json!({ "kind": "file_change", "path": "a.ts" }), false),
        );
        progress.observe(
            "edit_file",
            "{}",
            &outcome(json!({ "kind": "file_change", "path": "b.ts" }), true),
        );
        progress.observe(
            "read_file",
            "{}",
            &outcome(json!({ "kind": "output" }), false),
        );
        assert_eq!(progress.mutations, 1);
    }

    #[test]
    fn observe_records_todo_and_plan_markers_at_the_current_mutation_count() {
        let mut progress = TurnProgress {
            mutations: 2,
            ..Default::default()
        };
        progress.observe("todo_write", "{}", &outcome(json!({ "kind": "todos" }), false));
        progress.observe("submit_plan", "{}", &outcome(json!({ "kind": "plan" }), false));
        assert_eq!(progress.todos_written_at, Some(2));
        assert_eq!(progress.plan_submitted_at, Some(2));
    }

    #[test]
    fn observe_records_verification_commands_only() {
        let mut progress = TurnProgress::default();
        progress.observe(
            "run_command",
            r#"{"command":"git status --short"}"#,
            &outcome(json!({ "kind": "output", "exitCode": 1 }), false),
        );
        assert!(progress.last_check.is_none());

        progress.observe(
            "run_command",
            r#"{"command":"cargo check --offline"}"#,
            &outcome(json!({ "kind": "output", "exitCode": 1 }), false),
        );
        let check = progress.last_check.expect("receipt");
        assert_eq!(check.command, "cargo check --offline");
        assert_eq!(check.exit_code, Some(1));
    }

    #[test]
    fn observe_ignores_errored_or_backgrounded_commands() {
        let mut progress = TurnProgress::default();
        progress.observe(
            "run_checks",
            "{}",
            &outcome(json!({ "kind": "output", "exitCode": 0 }), true),
        );
        assert!(progress.last_check.is_none());

        progress.observe(
            "run_checks",
            "{}",
            &outcome(json!({ "kind": "job", "job": {} }), false),
        );
        assert!(progress.last_check.is_none());
    }

    #[test]
    fn observe_records_a_skipped_question() {
        let mut progress = TurnProgress {
            mutations: 3,
            ..Default::default()
        };
        progress.observe(
            "ask_user",
            "{}",
            &outcome(json!({ "kind": "answers", "answers": [], "skipped": true }), false),
        );
        assert_eq!(
            progress.last_ask,
            Some(AskReceipt {
                skipped: true,
                mutations_at: 3
            })
        );
    }

    #[test]
    fn verification_command_table() {
        for command in [
            "cargo check --offline",
            "cd src-tauri && cargo test --lib",
            "pnpm typecheck",
            "npm run build",
            "go test ./...",
            "dotnet build",
            "python -m pytest",
            "./gradlew test",
        ] {
            assert!(is_verification_command(command), "{command} should verify");
        }
        for command in [
            "git status",
            "rg foo",
            "echo tsc",
            r#"pwsh -c "cargo check""#,
            "pnpm tauri dev",
        ] {
            assert!(
                !is_verification_command(command),
                "{command} should not verify"
            );
        }
    }

    #[test]
    fn budget_notice_fires_once_at_eighty_percent() {
        assert_eq!(budget_notice(3, 5), None);
        let notice = budget_notice(4, 5).expect("notice at step 4 of 5");
        assert!(notice.starts_with("[budget] 2 model steps remain"), "{notice}");
        assert!(budget_notice(4, 4).is_none(), "short budgets are skipped");
        assert!(budget_notice(96, 120).is_some());
        assert_eq!(budget_notice(95, 120), None);
    }

    #[test]
    fn missing_verification_prompt_asks_for_the_narrowest_check() {
        let prompt = continuation_prompt(
            ContinueReason::MissingVerification,
            &[],
            &TurnProgress::default(),
            1,
        );
        assert!(prompt.starts_with("[completion-gate] "), "{prompt}");
        assert!(prompt.contains("narrowest check"), "{prompt}");
        assert!(prompt.contains("`run_command`"), "{prompt}");
    }

    #[test]
    fn continuation_prompt_lists_open_tasks_and_iteration() {
        let todos = [
            todo("Backend", TodoStatus::InProgress),
            todo("Renderer", TodoStatus::Pending),
            todo("Docs", TodoStatus::Completed),
        ];
        let prompt = continuation_prompt(
            ContinueReason::PendingTodos,
            &todos,
            &TurnProgress::default(),
            2,
        );
        assert!(prompt.starts_with("[completion-gate] "), "{prompt}");
        assert!(prompt.contains("- [~] Backend"), "{prompt}");
        assert!(prompt.contains("- [ ] Renderer"), "{prompt}");
        assert!(!prompt.contains("Docs"), "{prompt}");
        assert!(prompt.contains("continuation 2/4"), "{prompt}");
    }
}
