//! Wire shapes of the GitHub REST payloads used by this module.
//!
//! Only the fields the app renders are modeled; everything optional is
//! `#[serde(default)]` so a payload change never breaks the whole response.

use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireUser {
    pub login: String,
    pub avatar_url: Option<String>,
    pub html_url: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireLabel {
    pub name: String,
    pub color: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireMilestone {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub open_issues: u32,
    pub closed_issues: u32,
    pub due_on: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireRepoMini {
    pub full_name: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireRef {
    #[serde(rename = "ref")]
    pub branch: String,
    pub sha: String,
    pub repo: Option<WireRepoMini>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WirePullRequest {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub draft: bool,
    pub merged_at: Option<String>,
    pub body: Option<String>,
    pub html_url: String,
    pub created_at: String,
    pub updated_at: String,
    pub user: WireUser,
    pub head: WireRef,
    pub base: WireRef,
    pub labels: Vec<WireLabel>,
    pub comments: u32,
    pub review_comments: u32,
    pub additions: u32,
    pub deletions: u32,
    pub changed_files: u32,
    pub mergeable: Option<bool>,
    pub mergeable_state: Option<String>,
    pub node_id: Option<String>,
    pub requested_reviewers: Vec<WireUser>,
    pub assignees: Vec<WireUser>,
    pub milestone: Option<WireMilestone>,
    pub merged_by: Option<WireUser>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WirePullRequestMarker {
    pub merged_at: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireIssue {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub state_reason: Option<String>,
    /// Present on `/search/issues` rows that are pull requests.
    pub draft: bool,
    pub body: Option<String>,
    pub html_url: String,
    pub created_at: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
    pub user: WireUser,
    pub labels: Vec<WireLabel>,
    pub assignees: Vec<WireUser>,
    pub milestone: Option<WireMilestone>,
    pub comments: u32,
    pub locked: bool,
    pub pull_request: Option<WirePullRequestMarker>,
}

/// `/search/issues` envelope (used for text search and `@me` filters).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireSearchResult<T> {
    pub total_count: u32,
    pub incomplete_results: bool,
    pub items: Vec<T>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireComment {
    pub id: u64,
    pub user: WireUser,
    pub body: String,
    pub created_at: String,
    pub updated_at: Option<String>,
    pub html_url: Option<String>,
    pub author_association: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireReview {
    pub id: u64,
    pub user: WireUser,
    pub state: String,
    pub body: Option<String>,
    pub submitted_at: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireFile {
    pub filename: String,
    pub previous_filename: Option<String>,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    pub changes: u32,
    pub patch: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireCommitAuthor {
    pub name: String,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireCommitInfo {
    pub message: String,
    pub author: WireCommitAuthor,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireCommitEntry {
    pub sha: String,
    pub commit: WireCommitInfo,
    pub author: Option<WireUser>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireCheckRun {
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub details_url: Option<String>,
    pub html_url: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireCheckRuns {
    pub total_count: u32,
    pub check_runs: Vec<WireCheckRun>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireStatus {
    pub state: String,
    pub context: String,
    pub target_url: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireCombinedStatus {
    pub state: String,
    pub statuses: Vec<WireStatus>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WirePermissions {
    pub admin: bool,
    pub maintain: bool,
    pub push: bool,
    pub triage: bool,
    pub pull: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireRepository {
    pub full_name: String,
    pub default_branch: String,
    pub html_url: String,
    pub permissions: Option<WirePermissions>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireBranch {
    pub name: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireMerge {
    pub merged: bool,
    pub message: String,
    pub sha: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WireNode {
    pub id: String,
}
