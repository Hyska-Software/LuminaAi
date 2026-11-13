//! Completion gate for top-level Code turns.
//!
//! The agent loop treats "assistant message without tool calls" as the end of
//! the turn. That is only safe when the work is actually finished: this module
//! inspects the persisted todo list, the turn's edit/check receipts and the
//! plan state, and either accepts the stop or asks the harness to inject a
//! continuation prompt. It is the Zylara equivalent of a Claude Code `Stop`
//! hook, with the loop cap enforced by the caller.
//!
//! Verification is tracked **per ecosystem**: a passing `cargo check` does not
//! cover a TypeScript edit, and a monorepo with a root `package.json` plus a
//! nested `Cargo.toml` must verify both. The gated turn only stops after every
//! changed ecosystem with a detected check has a passing receipt that is newer
//! than its last behavioral mutation.

use std::collections::{BTreeMap, BTreeSet};

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
/// Negation words that turn an "unfinished" marker into a completion statement
/// ("no pending items", "nenhum item pendente").
const NEGATIONS: &[&str] = &[
    "no", "none", "not", "never", "zero", "without", "sem", "não", "nao", "nenhum", "nenhuma",
    "nada", "sin",
];

/// Language/toolchain that a changed file and a check command belong to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Ecosystem {
    Node,
    Rust,
    Python,
    Go,
    Dotnet,
    Other,
}

impl Ecosystem {
    /// Stable id used by `workspace::project::ProjectProfile`.
    pub fn id(self) -> &'static str {
        match self {
            Self::Node => "node",
            Self::Rust => "rust",
            Self::Python => "python",
            Self::Go => "go",
            Self::Dotnet => "dotnet",
            Self::Other => "other",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "node" => Some(Self::Node),
            "rust" => Some(Self::Rust),
            "python" => Some(Self::Python),
            "go" => Some(Self::Go),
            "dotnet" => Some(Self::Dotnet),
            "other" => Some(Self::Other),
            _ => None,
        }
    }

    /// Maps a detected check id (`npm:test`, `cargo:build`, …) to its
    /// ecosystem.
    fn from_check_id(id: &str) -> Option<Self> {
        match id.split(':').next().unwrap_or_default() {
            "npm" | "pnpm" | "yarn" | "bun" => Some(Self::Node),
            "cargo" => Some(Self::Rust),
            "python" | "pytest" => Some(Self::Python),
            "go" => Some(Self::Go),
            "dotnet" => Some(Self::Dotnet),
            _ => None,
        }
    }

    /// Classifies a changed path. Manifests are matched by name; everything
    /// else falls back to the extension. Unknown languages stay `Other` and do
    /// not require a detected check (there may be none).
    fn from_path(path: &str) -> Self {
        let normalized = path.replace('\\', "/").to_ascii_lowercase();
        let name = normalized.rsplit('/').next().unwrap_or(normalized.as_str());
        match name {
            "cargo.toml" | "cargo.lock" => Self::Rust,
            "package.json" | "package-lock.json" | "pnpm-lock.yaml" | "yarn.lock"
            | "bun.lock" | "bun.lockb" | "tsconfig.json" => Self::Node,
            "go.mod" | "go.sum" => Self::Go,
            "pyproject.toml" | "setup.py" | "setup.cfg" | "requirements.txt" | "pipfile" => {
                Self::Python
            }
            _ => match name.rsplit_once('.').map(|(_, extension)| extension) {
                Some("rs") => Self::Rust,
                Some("ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "vue" | "svelte" | "astro") => {
                    Self::Node
                }
                Some("py" | "pyi") => Self::Python,
                Some("go") => Self::Go,
                Some("cs" | "fs" | "vb" | "csproj" | "fsproj" | "vbproj") => Self::Dotnet,
                _ => Self::Other,
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContinueReason {
    PlanNotSubmitted,
    PendingTodos,
    FailedCheck,
    MissingVerification(Vec<Ecosystem>),
    MissingTodoLedger,
    UnfinishedReport,
}

impl ContinueReason {
    /// Stable code persisted in `code_events::turn/ended`.
    pub fn code(&self) -> &'static str {
        match self {
            Self::PlanNotSubmitted => "plan_not_submitted",
            Self::PendingTodos => "pending_todos",
            Self::FailedCheck => "failed_check",
            Self::MissingVerification(_) => "missing_verification",
            Self::MissingTodoLedger => "missing_todo_ledger",
            Self::UnfinishedReport => "unfinished_report",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckReceipt {
    /// `"run_checks"` or the raw `run_command` command (trimmed, <= 120 chars).
    pub command: String,
    pub exit_code: Option<i32>,
    /// `TurnProgress::mutations` at the moment the check finished.
    pub mutations_at: u32,
    /// `TurnProgress::behavioral_mutations` at the moment the check finished.
    pub behavioral_at: u32,
}

/// Per-ecosystem receipt: the counters are scoped to that ecosystem so a later
/// edit in another language cannot invalidate (or validate) this check.
#[derive(Debug, Clone, PartialEq, Eq)]
struct EcosystemCheck {
    command: String,
    exit_code: Option<i32>,
    mutations_at: u32,
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
    /// Mutations that can invalidate a check (code/test/config). Documentation
    /// edits increment `mutations` but not this counter.
    pub behavioral_mutations: u32,
    /// `task` calls that ran a writable worker (its edits bypass the journal).
    pub worker_mutations: u32,
    /// Set by a successful `todo_write`; value = mutations when it ran.
    pub todos_written_at: Option<u32>,
    /// Set by a successful `submit_plan`; value = mutations when it ran.
    pub plan_submitted_at: Option<u32>,
    pub last_check: Option<CheckReceipt>,
    pub last_ask: Option<AskReceipt>,
    mutations_by_ecosystem: BTreeMap<Ecosystem, u32>,
    checks_by_ecosystem: BTreeMap<Ecosystem, EcosystemCheck>,
}

pub struct StopEvidence<'a> {
    pub todos: &'a [TodoItem],
    pub progress: &'a TurnProgress,
    /// Ecosystems with at least one detected check (root + nested manifests).
    pub checked_ecosystems: &'a [Ecosystem],
    pub todo_tool_available: bool,
    pub plan_mode: bool,
    /// Text of the final answer that is trying to end the turn.
    pub final_text: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
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
            let path = presentation_str(outcome, "path").unwrap_or_default();
            if is_behavioral_change(path) {
                self.behavioral_mutations = self.behavioral_mutations.saturating_add(1);
                let ecosystem = Ecosystem::from_path(path);
                let count = self.mutations_by_ecosystem.entry(ecosystem).or_default();
                *count = count.saturating_add(1);
            }
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
                    let coverage = check_coverage(outcome, arguments);
                    let command = check_command(outcome).unwrap_or_else(|| "run_checks".into());
                    self.record_check(coverage, command, exit_code);
                }
            }
            "run_command" => {
                let command = command_of(arguments);
                let coverage = verification_ecosystems(&command);
                if !coverage.is_empty() {
                    if let Some(exit_code) = exit_code(outcome) {
                        self.record_check(coverage, truncate_command(&command), exit_code);
                    }
                }
            }
            "task" => {
                // A worker can edit files and run commands (which bypass the
                // journal), so the parent must verify after it. Read-only
                // children count nothing.
                if presentation_str(outcome, "subagentType") == Some("worker") {
                    self.mutations = self.mutations.saturating_add(1);
                    self.behavioral_mutations = self.behavioral_mutations.saturating_add(1);
                    self.worker_mutations = self.worker_mutations.saturating_add(1);
                }
            }
            _ => {}
        }
    }

    fn record_check(
        &mut self,
        ecosystems: BTreeSet<Ecosystem>,
        command: String,
        exit_code: i32,
    ) {
        let receipt = CheckReceipt {
            command: command.clone(),
            exit_code: Some(exit_code),
            mutations_at: self.mutations,
            behavioral_at: self.behavioral_mutations,
        };
        self.last_check = Some(receipt);
        for ecosystem in ecosystems {
            let mutations_at = self
                .mutations_by_ecosystem
                .get(&ecosystem)
                .copied()
                .unwrap_or(0);
            self.checks_by_ecosystem.insert(
                ecosystem,
                EcosystemCheck {
                    command: command.clone(),
                    exit_code: Some(exit_code),
                    mutations_at,
                },
            );
        }
    }

    /// A verification ran after the last behavioral mutation.
    pub fn verified_after_last_behavioral_change(&self) -> bool {
        self.last_check
            .as_ref()
            .is_some_and(|check| check.behavioral_at == self.behavioral_mutations)
    }

    /// The verification after the last behavioral mutation failed. Read-only
    /// turns (no mutations) never count a pre-existing failure against the
    /// agent.
    pub fn last_check_failed(&self) -> bool {
        self.failing_check().is_some()
    }

    fn failing_check(&self) -> Option<(&str, Option<i32>)> {
        if self.behavioral_mutations == 0 {
            return None;
        }
        if let Some(check) = self.last_check.as_ref() {
            if check.behavioral_at == self.behavioral_mutations && check.exit_code != Some(0) {
                return Some((check.command.as_str(), check.exit_code));
            }
        }
        for (ecosystem, check) in &self.checks_by_ecosystem {
            let current = self
                .mutations_by_ecosystem
                .get(ecosystem)
                .copied()
                .unwrap_or(0);
            if check.mutations_at == current && check.exit_code != Some(0) {
                return Some((check.command.as_str(), check.exit_code));
            }
        }
        None
    }

    /// The ecosystem had at least one behavioral mutation and its latest
    /// receipt is a passing check after that mutation.
    fn ecosystem_verified(&self, ecosystem: Ecosystem) -> bool {
        let mutations = self
            .mutations_by_ecosystem
            .get(&ecosystem)
            .copied()
            .unwrap_or(0);
        if mutations == 0 {
            return true;
        }
        self.checks_by_ecosystem.get(&ecosystem).is_some_and(|check| {
            check.mutations_at == mutations && check.exit_code == Some(0)
        })
    }

    fn missing_verification(&self, checked: &BTreeSet<Ecosystem>) -> Vec<Ecosystem> {
        checked
            .iter()
            .copied()
            .filter(|ecosystem| {
                self.mutations_by_ecosystem
                    .get(ecosystem)
                    .copied()
                    .unwrap_or(0)
                    > 0
            })
            .filter(|ecosystem| !self.ecosystem_verified(*ecosystem))
            .collect()
    }
}

/// Documentation-only edits do not invalidate a passing check. Everything
/// else (code, tests, configs, manifests, assets) is behavioral by default.
fn is_behavioral_change(path: &str) -> bool {
    let normalized = path.replace('\\', "/").to_ascii_lowercase();
    let name = normalized.rsplit('/').next().unwrap_or(normalized.as_str());
    if matches!(
        name,
        "agents.md" | "claude.md" | "license" | "license.md" | "changelog.md"
    ) {
        return false;
    }
    let extension = name
        .rsplit_once('.')
        .map(|(_, extension)| extension)
        .unwrap_or("");
    !matches!(extension, "md" | "mdx" | "txt" | "rst" | "adoc" | "log")
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

    let checked: BTreeSet<Ecosystem> = evidence.checked_ecosystems.iter().copied().collect();
    let missing = progress.missing_verification(&checked);
    if !missing.is_empty() {
        return StopDecision::Continue(ContinueReason::MissingVerification(missing));
    }

    // A worker may have touched any ecosystem; require a check after it (the
    // parent cannot know which files it changed).
    if progress.worker_mutations > 0
        && !checked.is_empty()
        && !progress.verified_after_last_behavioral_change()
    {
        return StopDecision::Continue(ContinueReason::MissingVerification(
            checked.into_iter().collect(),
        ));
    }

    if progress.mutations > 0
        && evidence.todo_tool_available
        && evidence.todos.is_empty()
        && progress.todos_written_at != Some(progress.mutations)
    {
        return StopDecision::Continue(ContinueReason::MissingTodoLedger);
    }

    // The model can mark every todo complete and still end with a report that
    // says the work is partial or unverified (the failure mode this gate
    // exists to stop). Only audit turns that actually changed behavior:
    // question-only Code turns may legitimately describe an unimplemented
    // feature.
    if progress.behavioral_mutations > 0 && declares_unfinished(evidence.final_text) {
        return StopDecision::Continue(ContinueReason::UnfinishedReport);
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
                .failing_check()
                .map(|(command, code)| {
                    (
                        command.to_string(),
                        code.map(|code| code.to_string())
                            .unwrap_or_else(|| "?".to_string()),
                    )
                })
                .unwrap_or(("run_checks".to_string(), "?".to_string()));
            format!(
                "A verification that covers this turn's changes (`{command}`) failed with exit \
                 code {code}. Fix the failure and run the check again; do not end the turn with \
                 a failing check you introduced."
            )
        }
        ContinueReason::MissingVerification(ecosystems) => {
            let list = if ecosystems.is_empty() {
                "the changed files".to_string()
            } else {
                ecosystems
                    .iter()
                    .map(|ecosystem| format!("`{}`", ecosystem.id()))
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            format!(
                "You changed files in this turn but have not verified every affected ecosystem \
                 since the last edit. Missing a passing check after the last change: {list}. Run \
                 the narrowest check that covers each one (the project typecheck/lint or the \
                 related test file with `run_command`; `run_checks` when the full suite is the \
                 right scope), read the exit code, and fix what it reports. A check for one \
                 language does not cover another. Documentation-only edits do not invalidate a \
                 passing check; rerun only after a behavioral edit."
            )
        }
        ContinueReason::MissingTodoLedger => "You changed files without a `todo_write` list, so \
             the app cannot verify that the work is complete. Call `todo_write` with the \
             remaining steps (or `[]` only if everything is done and verified), then continue."
            .to_string(),
        ContinueReason::UnfinishedReport => "Your final answer reports unfinished or unverified \
             work. If the user's request still has executable work, continue now: implement it \
             and run the missing checks. If a decision only the user can make blocks you, ask \
             with `ask_user`; if a hard failure blocks you, state the exact blocker and the \
             evidence. Do not end with a partial status report."
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
    !verification_ecosystems(command).is_empty()
}

/// Ecosystems covered by a shell command. Commands joined with `&&`/`;`/`|`
/// contribute independently; `cd`/environment prefixes are ignored.
pub fn verification_ecosystems(command: &str) -> BTreeSet<Ecosystem> {
    let mut found = BTreeSet::new();
    for segment in command.split(['\n', ';', '&', '|']) {
        let tokens: Vec<&str> = segment.split_whitespace().collect();
        if tokens.is_empty() {
            continue;
        }
        let mut start = 0usize;
        while start < tokens.len() {
            let token = tokens[start];
            let is_assignment = token.contains('=') && !token.starts_with('-');
            if !is_assignment {
                break;
            }
            start += 1;
        }
        let Some(program) = tokens.get(start) else {
            continue;
        };
        let program = basename(program);
        let raw_rest: Vec<&str> = tokens[start + 1..].to_vec();
        let rest: Vec<&str> = raw_rest
            .iter()
            .copied()
            .filter(|token| !token.starts_with('-'))
            .collect();
        match program {
            "cargo" => {
                if rest
                    .iter()
                    .any(|token| matches!(*token, "check" | "test" | "build" | "clippy" | "nextest"))
                {
                    found.insert(Ecosystem::Rust);
                }
            }
            "npm" | "pnpm" | "yarn" | "bun" => {
                let known = rest.iter().any(|token| {
                    matches!(
                        *token,
                        "test"
                            | "tests"
                            | "lint"
                            | "build"
                            | "typecheck"
                            | "check"
                            | "tsc"
                            | "eslint"
                            | "vitest"
                            | "jest"
                    )
                });
                let script = rest
                    .iter()
                    .position(|token| *token == "run")
                    .and_then(|index| rest.get(index + 1))
                    .copied()
                    .or_else(|| rest.first().copied());
                let script_check = script.is_some_and(|token| {
                    token.contains("test") || token.contains("lint") || token.contains("check")
                });
                if known || script_check {
                    found.insert(Ecosystem::Node);
                }
            }
            "npx" | "pnpx" => {
                if rest
                    .first()
                    .is_some_and(|token| matches!(*token, "tsc" | "eslint" | "vitest" | "jest" | "vite"))
                {
                    found.insert(Ecosystem::Node);
                }
            }
            "tsc" | "eslint" | "vitest" | "jest" | "mocha" => {
                found.insert(Ecosystem::Node);
            }
            "node" => {
                if raw_rest.first() == Some(&"--test") {
                    found.insert(Ecosystem::Node);
                }
            }
            "pytest" | "mypy" | "ruff" => {
                found.insert(Ecosystem::Python);
            }
            "python" | "python3" => {
                if raw_rest.first() == Some(&"-m")
                    && raw_rest
                        .get(1)
                        .is_some_and(|token| matches!(*token, "pytest" | "mypy" | "ruff"))
                {
                    found.insert(Ecosystem::Python);
                }
            }
            "go" => {
                if rest
                    .first()
                    .is_some_and(|token| matches!(*token, "test" | "build" | "vet"))
                {
                    found.insert(Ecosystem::Go);
                }
            }
            "dotnet" => {
                if rest.first().is_some_and(|token| matches!(*token, "test" | "build")) {
                    found.insert(Ecosystem::Dotnet);
                }
            }
            "mvn" | "mvnw" | "gradle" | "gradlew" | "phpunit" | "rspec" | "swift" | "zig"
            | "make" => {
                found.insert(Ecosystem::Other);
            }
            _ => {}
        }
    }
    found
}

/// Final-answer audit: markers that claim unfinished, unverified or partial
/// work. Negatable markers are ignored when preceded by a negation ("no pending
/// items", "nenhum item pendente"). Fenced code blocks are ignored so a pasted
/// snippet containing "not implemented" does not reject a finished turn.
fn declares_unfinished(text: &str) -> bool {
    let text = strip_fenced_code(text);
    const MARKERS: &[(&str, bool)] = &[
        ("not implemented", false),
        ("not yet implemented", false),
        ("not fully implemented", false),
        ("unimplemented", false),
        ("não implementado", false),
        ("não implementada", false),
        ("nao implementado", false),
        ("nao implementada", false),
        ("não foi implementado", false),
        ("não foi implementada", false),
        ("não está implementado", false),
        ("não esta implementado", false),
        ("sin implementar", false),
        ("no implementado", false),
        ("no implementada", false),
        ("sin verificar", false),
        ("no verificado", false),
        ("no verificada", false),
        ("not verified", false),
        ("unverified", false),
        ("not tested", false),
        ("untested", false),
        ("não verificado", false),
        ("não verificada", false),
        ("nao verificado", false),
        ("nao verificada", false),
        ("não foi verificado", false),
        ("não foi verificada", false),
        ("não reexecutado", false),
        ("não reexecutada", false),
        ("nao reexecutado", false),
        ("sem reexecução", false),
        ("sem re-execucao", false),
        ("sem reexecucao", false),
        ("not re-run", false),
        ("not rerun", false),
        ("nada disso foi verificado", false),
        ("nothing was verified", false),
        ("not finished", false),
        ("not complete", false),
        ("not done", false),
        ("incomplete", false),
        ("unfinished", false),
        ("incompleto", false),
        ("incompleta", false),
        ("não finalizado", false),
        ("não finalizada", false),
        ("nao finalizado", false),
        ("não feito", false),
        ("nao feito", false),
        ("não consegui", false),
        ("nao consegui", false),
        ("não foi possível", false),
        ("nao foi possivel", false),
        ("sem sucesso", false),
        ("couldn't", false),
        ("could not", false),
        ("não terminei", false),
        ("nao terminei", false),
        ("não completei", false),
        ("nao completei", false),
        ("não concluí", false),
        ("nao conclui", false),
        ("não consegui terminar", false),
        ("não consegui implementar", false),
        ("nao consegui terminar", false),
        ("couldn't finish", false),
        ("could not finish", false),
        ("unable to finish", false),
        ("didn't finish", false),
        ("did not finish", false),
        ("haven't finished", false),
        ("have not finished", false),
        ("didn't implement", false),
        ("did not implement", false),
        ("haven't implemented", false),
        ("have not implemented", false),
        ("pendente", true),
        ("pendentes", true),
        ("pendiente", true),
        ("pendientes", true),
        ("queda pendiente", true),
        ("trabajo pendiente", true),
        ("pendência", true),
        ("pendências", true),
        ("pendencia", true),
        ("pendencias", true),
        ("still pending", true),
        ("remains pending", true),
        ("left pending", true),
        ("pending work", true),
        ("pending tasks", true),
        ("pending items", true),
        ("pending implementation", true),
        ("pending verification", true),
        ("pending tests", true),
        ("is pending", true),
        ("are pending", true),
        ("remaining work", true),
        ("work remains", true),
        ("remains to be", true),
        ("remaining tasks", true),
        ("remaining items", true),
        ("trabalho restante", true),
        ("resta implementar", true),
        ("resta fazer", true),
        ("resta verificar", true),
        ("falta implementar", true),
        ("falta fazer", true),
        ("falta verificar", true),
        ("falta terminar", true),
        ("ficou faltando", true),
        ("faltou", true),
        ("partial implementation", true),
        ("partially implemented", true),
        ("parcialmente implementado", true),
        ("implementação parcial", true),
        ("implementacao parcial", true),
        ("trabalho parcial", true),
        ("parcial", true),
    ];
    let lower = text.to_lowercase();
    for (marker, negatable) in MARKERS {
        let mut from = 0usize;
        while let Some(offset) = lower[from..].find(marker) {
            let index = from + offset;
            if !negatable || !negated_before(&lower, index) {
                return true;
            }
            from = index + marker.len();
        }
    }
    false
}

fn strip_fenced_code(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_fence = false;
    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            out.push('\n');
            continue;
        }
        if !in_fence {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

fn negated_before(text: &str, index: usize) -> bool {
    let start = text[..index]
        .rfind(|character: char| matches!(character, '.' | ';' | ':' | ',' | '!' | '?' | '\n'))
        .map(|offset| offset + 1)
        .unwrap_or(0);
    let window = &text[start..index];
    window
        .split(|character: char| !character.is_alphanumeric())
        .any(|token| NEGATIONS.contains(&token))
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

fn check_command(outcome: &ToolOutcome) -> Option<String> {
    presentation_str(outcome, "command")
        .or_else(|| presentation_str(outcome, "check"))
        .map(str::to_string)
}

fn check_coverage(outcome: &ToolOutcome, arguments: &str) -> BTreeSet<Ecosystem> {
    let mut coverage = BTreeSet::new();
    if let Some(ecosystem) =
        presentation_str(outcome, "ecosystem").and_then(Ecosystem::from_id)
    {
        coverage.insert(ecosystem);
        return coverage;
    }
    let check_id = presentation_str(outcome, "check")
        .map(str::to_string)
        .or_else(|| {
            serde_json::from_str::<Value>(arguments)
                .ok()
                .and_then(|value| {
                    value
                        .get("check")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
        });
    if let Some(ecosystem) = check_id.as_deref().and_then(Ecosystem::from_check_id) {
        coverage.insert(ecosystem);
    }
    coverage
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

fn basename(program: &str) -> &str {
    program
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(program)
        .trim_end_matches(".exe")
        .trim_end_matches(".cmd")
        .trim_end_matches(".bat")
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

    fn stop_evidence<'a>(todos: &'a [TodoItem], progress: &'a TurnProgress) -> StopEvidence<'a> {
        StopEvidence {
            todos,
            progress,
            checked_ecosystems: &[],
            todo_tool_available: true,
            plan_mode: false,
            final_text: "",
        }
    }

    fn outcome(presentation: Value, is_error: bool) -> ToolOutcome {
        ToolOutcome {
            presentation: Some(presentation),
            is_error,
            ..Default::default()
        }
    }

    fn mutate(progress: &mut TurnProgress, path: &str) {
        progress.observe(
            "write_file",
            "{}",
            &outcome(json!({ "kind": "file_change", "path": path }), false),
        );
    }

    fn check(progress: &mut TurnProgress, command: &str, exit_code: i32) {
        progress.observe(
            "run_command",
            &json!({ "command": command }).to_string(),
            &outcome(
                json!({ "kind": "output", "exitCode": exit_code }),
                false,
            ),
        );
    }

    fn ledger(progress: &mut TurnProgress) {
        progress.observe(
            "todo_write",
            "{}",
            &outcome(json!({ "kind": "todos" }), false),
        );
    }

    #[test]
    fn accepts_a_clean_finish() {
        let todos = [todo("Implementar", TodoStatus::Completed)];
        let progress = TurnProgress::default();
        assert_eq!(decide(stop_evidence(&todos, &progress)), StopDecision::Accept);
    }

    #[test]
    fn continues_with_pending_todos() {
        let todos = [todo("Backend", TodoStatus::Pending)];
        let progress = TurnProgress::default();
        assert_eq!(
            decide(stop_evidence(&todos, &progress)),
            StopDecision::Continue(ContinueReason::PendingTodos)
        );
    }

    #[test]
    fn continues_with_an_in_progress_todo() {
        let todos = [todo("Backend", TodoStatus::InProgress)];
        let progress = TurnProgress::default();
        assert_eq!(
            decide(stop_evidence(&todos, &progress)),
            StopDecision::Continue(ContinueReason::PendingTodos)
        );
    }

    #[test]
    fn continues_after_a_failed_check_following_a_mutation() {
        let mut progress = TurnProgress::default();
        mutate(&mut progress, "src/a.ts");
        check(&mut progress, "pnpm test", 1);
        let checked = [Ecosystem::Node];
        let mut evidence = stop_evidence(&[], &progress);
        evidence.checked_ecosystems = &checked;
        assert_eq!(
            decide(evidence),
            StopDecision::Continue(ContinueReason::FailedCheck)
        );
    }

    #[test]
    fn accepts_a_passing_check_following_a_mutation() {
        let mut progress = TurnProgress::default();
        mutate(&mut progress, "src/a.ts");
        ledger(&mut progress);
        check(&mut progress, "pnpm test", 0);
        let checked = [Ecosystem::Node];
        let mut evidence = stop_evidence(&[], &progress);
        evidence.checked_ecosystems = &checked;
        assert_eq!(decide(evidence), StopDecision::Accept);
    }

    #[test]
    fn continues_when_a_later_edit_invalidated_the_check() {
        let mut progress = TurnProgress::default();
        mutate(&mut progress, "src/a.ts");
        check(&mut progress, "pnpm test", 0);
        mutate(&mut progress, "src/b.ts");
        let checked = [Ecosystem::Node];
        let mut evidence = stop_evidence(&[], &progress);
        evidence.checked_ecosystems = &checked;
        assert_eq!(
            decide(evidence),
            StopDecision::Continue(ContinueReason::MissingVerification(vec![
                Ecosystem::Node
            ]))
        );
    }

    #[test]
    fn doc_only_change_after_a_passing_check_is_accepted() {
        let mut progress = TurnProgress::default();
        mutate(&mut progress, "src/a.ts");
        check(&mut progress, "pnpm test", 0);
        mutate(&mut progress, "README.md");
        ledger(&mut progress);
        let checked = [Ecosystem::Node];
        let mut evidence = stop_evidence(&[], &progress);
        evidence.checked_ecosystems = &checked;
        assert_eq!(decide(evidence), StopDecision::Accept);
    }

    #[test]
    fn source_change_after_a_passing_check_requires_another_check() {
        let mut progress = TurnProgress::default();
        mutate(&mut progress, "src/a.ts");
        check(&mut progress, "pnpm test", 0);
        mutate(&mut progress, "src/b.ts");
        let checked = [Ecosystem::Node];
        let mut evidence = stop_evidence(&[], &progress);
        evidence.checked_ecosystems = &checked;
        assert_eq!(
            decide(evidence),
            StopDecision::Continue(ContinueReason::MissingVerification(vec![
                Ecosystem::Node
            ]))
        );
    }

    #[test]
    fn failed_check_after_a_behavioral_change_still_continues() {
        let mut progress = TurnProgress::default();
        mutate(&mut progress, "src/a.rs");
        check(&mut progress, "cargo test", 1);
        assert_eq!(
            decide(stop_evidence(&[], &progress)),
            StopDecision::Continue(ContinueReason::FailedCheck)
        );
    }

    #[test]
    fn continues_when_project_checks_were_never_run() {
        let mut progress = TurnProgress::default();
        mutate(&mut progress, "src/a.ts");
        let checked = [Ecosystem::Node];
        let mut evidence = stop_evidence(&[], &progress);
        evidence.checked_ecosystems = &checked;
        assert_eq!(
            decide(evidence),
            StopDecision::Continue(ContinueReason::MissingVerification(vec![
                Ecosystem::Node
            ]))
        );
    }

    #[test]
    fn requires_a_check_for_each_changed_ecosystem() {
        let mut progress = TurnProgress::default();
        mutate(&mut progress, "src/app.ts");
        check(&mut progress, "pnpm typecheck", 0);
        mutate(&mut progress, "src-tauri/src/lib.rs");
        let checked = [Ecosystem::Node, Ecosystem::Rust];
        let mut evidence = stop_evidence(&[], &progress);
        evidence.checked_ecosystems = &checked;
        assert_eq!(
            decide(evidence),
            StopDecision::Continue(ContinueReason::MissingVerification(vec![
                Ecosystem::Rust
            ]))
        );

        check(&mut progress, "cargo check", 0);
        ledger(&mut progress);
        let mut evidence = stop_evidence(&[], &progress);
        evidence.checked_ecosystems = &checked;
        assert_eq!(decide(evidence), StopDecision::Accept);
    }

    #[test]
    fn a_passing_node_check_does_not_cover_rust() {
        let mut progress = TurnProgress::default();
        mutate(&mut progress, "src-tauri/src/lib.rs");
        check(&mut progress, "pnpm test", 0);
        let checked = [Ecosystem::Node, Ecosystem::Rust];
        let mut evidence = stop_evidence(&[], &progress);
        evidence.checked_ecosystems = &checked;
        assert_eq!(
            decide(evidence),
            StopDecision::Continue(ContinueReason::MissingVerification(vec![
                Ecosystem::Rust
            ]))
        );
    }

    #[test]
    fn a_failed_rust_check_is_not_hidden_by_a_later_node_check() {
        let mut progress = TurnProgress::default();
        mutate(&mut progress, "src-tauri/src/lib.rs");
        check(&mut progress, "cargo test", 1);
        mutate(&mut progress, "src/app.ts");
        check(&mut progress, "pnpm test", 0);
        let checked = [Ecosystem::Node, Ecosystem::Rust];
        let mut evidence = stop_evidence(&[], &progress);
        evidence.checked_ecosystems = &checked;
        assert_eq!(
            decide(evidence),
            StopDecision::Continue(ContinueReason::FailedCheck)
        );
    }

    #[test]
    fn continues_when_mutations_have_no_task_ledger() {
        let mut progress = TurnProgress::default();
        mutate(&mut progress, "src/a.ts");
        assert_eq!(
            decide(stop_evidence(&[], &progress)),
            StopDecision::Continue(ContinueReason::MissingTodoLedger)
        );
    }

    #[test]
    fn accepts_after_an_explicit_todo_write_following_the_mutation() {
        let mut progress = TurnProgress::default();
        mutate(&mut progress, "src/a.ts");
        ledger(&mut progress);
        assert_eq!(decide(stop_evidence(&[], &progress)), StopDecision::Accept);
    }

    #[test]
    fn accepts_after_a_submitted_plan_without_edits() {
        let mut progress = TurnProgress::default();
        progress.plan_submitted_at = Some(0);
        assert_eq!(decide(stop_evidence(&[], &progress)), StopDecision::Accept);
    }

    #[test]
    fn continues_in_plan_mode_without_a_submitted_plan() {
        let progress = TurnProgress::default();
        let mut evidence = stop_evidence(&[], &progress);
        evidence.plan_mode = true;
        assert_eq!(
            decide(evidence),
            StopDecision::Continue(ContinueReason::PlanNotSubmitted)
        );
    }

    #[test]
    fn accepts_after_a_skipped_question_without_new_work() {
        let todos = [todo("Backend", TodoStatus::Pending)];
        let mut progress = TurnProgress::default();
        progress.observe(
            "ask_user",
            "{}",
            &outcome(
                json!({ "kind": "answers", "answers": [], "skipped": true }),
                false,
            ),
        );
        assert_eq!(decide(stop_evidence(&todos, &progress)), StopDecision::Accept);
    }

    #[test]
    fn skipped_question_does_not_bypass_work_done_after_it() {
        let todos = [todo("Backend", TodoStatus::Pending)];
        let mut progress = TurnProgress::default();
        progress.observe(
            "ask_user",
            "{}",
            &outcome(
                json!({ "kind": "answers", "answers": [], "skipped": true }),
                false,
            ),
        );
        mutate(&mut progress, "src/a.ts");
        assert_eq!(
            decide(stop_evidence(&todos, &progress)),
            StopDecision::Continue(ContinueReason::PendingTodos)
        );
    }

    #[test]
    fn accepts_when_the_todo_tool_is_absent() {
        let todos = [todo("Backend", TodoStatus::Pending)];
        let mut progress = TurnProgress::default();
        mutate(&mut progress, "src/a.ts");
        let mut evidence = stop_evidence(&todos, &progress);
        evidence.todo_tool_available = false;
        assert_eq!(decide(evidence), StopDecision::Accept);
    }

    #[test]
    fn worker_task_counts_as_a_mutation() {
        let mut worker = TurnProgress::default();
        worker.observe(
            "task",
            "{}",
            &outcome(json!({ "kind": "subagent", "subagentType": "worker" }), false),
        );
        assert_eq!(worker.mutations, 1);
        assert_eq!(worker.behavioral_mutations, 1);
        assert_eq!(worker.worker_mutations, 1);

        let mut explorer = TurnProgress::default();
        explorer.observe(
            "task",
            "{}",
            &outcome(json!({ "kind": "subagent", "subagentType": "explore" }), false),
        );
        assert_eq!(explorer.mutations, 0);
        assert_eq!(explorer.behavioral_mutations, 0);
        assert_eq!(explorer.worker_mutations, 0);
    }

    #[test]
    fn worker_forces_verification_when_the_project_has_checks() {
        let mut progress = TurnProgress::default();
        progress.observe(
            "task",
            "{}",
            &outcome(json!({ "kind": "subagent", "subagentType": "worker" }), false),
        );
        let checked = [Ecosystem::Node];
        let mut evidence = stop_evidence(&[], &progress);
        evidence.checked_ecosystems = &checked;
        assert_eq!(
            decide(evidence),
            StopDecision::Continue(ContinueReason::MissingVerification(vec![
                Ecosystem::Node
            ]))
        );
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
        assert_eq!(progress.behavioral_mutations, 1);
        assert_eq!(
            progress.mutations_by_ecosystem.get(&Ecosystem::Node),
            Some(&1)
        );
    }

    #[test]
    fn observe_classifies_documentation_paths_as_non_behavioral() {
        let mut progress = TurnProgress::default();
        progress.observe(
            "write_file",
            "{}",
            &outcome(json!({ "kind": "file_change", "path": "README.md" }), false),
        );
        progress.observe(
            "write_file",
            "{}",
            &outcome(json!({ "kind": "file_change", "path": "src/a.ts" }), false),
        );
        assert_eq!(progress.mutations, 2);
        assert_eq!(progress.behavioral_mutations, 1);
        assert_eq!(
            progress.mutations_by_ecosystem.get(&Ecosystem::Node),
            Some(&1)
        );
        assert!(!progress.mutations_by_ecosystem.contains_key(&Ecosystem::Other));
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
        assert!(progress.checks_by_ecosystem.contains_key(&Ecosystem::Rust));
    }

    #[test]
    fn observe_records_run_checks_ecosystem_and_command() {
        let mut progress = TurnProgress::default();
        progress.observe(
            "run_checks",
            "{}",
            &outcome(
                json!({
                    "kind": "output",
                    "exitCode": 0,
                    "check": "cargo:test",
                    "command": "cargo test",
                    "ecosystem": "rust"
                }),
                false,
            ),
        );
        let check = progress.last_check.expect("receipt");
        assert_eq!(check.command, "cargo test");
        assert!(progress.checks_by_ecosystem.contains_key(&Ecosystem::Rust));
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
            "pnpm i18n:check",
            "pnpm test:scripts",
            "npm run build",
            "go test ./...",
            "dotnet build",
            "python -m pytest",
            "node --test scripts/check.mjs",
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
    fn verification_commands_map_to_ecosystems() {
        assert_eq!(
            verification_ecosystems("cd src-tauri && cargo test --lib"),
            BTreeSet::from([Ecosystem::Rust])
        );
        assert_eq!(
            verification_ecosystems("pnpm --filter app typecheck && cargo check"),
            BTreeSet::from([Ecosystem::Node, Ecosystem::Rust])
        );
        assert_eq!(
            verification_ecosystems("python -m pytest -q"),
            BTreeSet::from([Ecosystem::Python])
        );
    }

    #[test]
    fn unfinished_report_markers_trigger_and_negation_is_respected() {
        assert!(declares_unfinished(
            "O backend está implementado, mas o renderer ficou pendente."
        ));
        assert!(declares_unfinished("Nada disso foi verificado por checks finais."));
        assert!(declares_unfinished("Parcial (escrito, não verificado)"));
        assert!(declares_unfinished("Tests are still pending."));
        assert!(declares_unfinished(
            "Não implementei o renderer. O backend está pendente."
        ));
        assert!(!declares_unfinished("Tudo concluído; nenhum item pendente."));
        assert!(!declares_unfinished("Não há trabalho pendente."));
        assert!(!declares_unfinished(
            "```ts\n// not implemented yet\n```\nTudo pronto."
        ));
        assert!(!declares_unfinished(
            "Everything is complete and all checks passed."
        ));
    }

    #[test]
    fn unfinished_report_forces_a_continuation() {
        let mut progress = TurnProgress::default();
        mutate(&mut progress, "src/app.ts");
        check(&mut progress, "pnpm test", 0);
        ledger(&mut progress);
        let checked = [Ecosystem::Node];
        let mut evidence = stop_evidence(&[], &progress);
        evidence.checked_ecosystems = &checked;
        evidence.final_text = "O backend está implementado, mas o renderer ficou pendente.";
        assert_eq!(
            decide(evidence),
            StopDecision::Continue(ContinueReason::UnfinishedReport)
        );
    }

    #[test]
    fn unfinished_report_audit_skips_question_only_turns() {
        let progress = TurnProgress::default();
        let mut evidence = stop_evidence(&[], &progress);
        evidence.final_text = "This feature is not implemented in the current code.";
        assert_eq!(decide(evidence), StopDecision::Accept);
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
            ContinueReason::MissingVerification(vec![Ecosystem::Rust]),
            &[],
            &TurnProgress::default(),
            1,
        );
        assert!(prompt.starts_with("[completion-gate] "), "{prompt}");
        assert!(prompt.contains("`rust`"), "{prompt}");
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

    #[test]
    fn failed_check_prompt_names_the_failing_ecosystem() {
        let mut progress = TurnProgress::default();
        mutate(&mut progress, "src-tauri/src/lib.rs");
        check(&mut progress, "cargo test", 1);
        mutate(&mut progress, "src/app.ts");
        check(&mut progress, "pnpm test", 0);
        let prompt = continuation_prompt(ContinueReason::FailedCheck, &[], &progress, 1);
        assert!(prompt.contains("cargo test"), "{prompt}");
        assert!(prompt.contains("exit code 1"), "{prompt}");
    }

    #[test]
    fn unfinished_report_prompt_forbids_a_partial_status_report() {
        let prompt =
            continuation_prompt(ContinueReason::UnfinishedReport, &[], &TurnProgress::default(), 1);
        assert!(prompt.contains("unfinished or unverified work"), "{prompt}");
        assert!(prompt.contains("`ask_user`"), "{prompt}");
        assert!(prompt.contains("partial status report"), "{prompt}");
    }
}
