//! Mapping of the GitHub wire payloads to the renderer-facing domain types.
//!
//! All functions here are pure so the mapping can be covered by fixtures
//! (`testdata/github.json`) without any network access.

use crate::domain::{
    GitHubChecksSummary, GitHubComment, GitHubIssueDetail, GitHubIssueSummary,
    GitHubLabel, GitHubMergeResult, GitHubMilestone, GitHubPullRequestCommit,
    GitHubPullRequestDetail, GitHubPullRequestFile, GitHubPullRequestFiles,
    GitHubPullRequestSummary, GitHubRepoInfo, GitHubReview, GitHubUser,
};
use crate::github::remote::GitHubRepoRef;
use crate::github::wire::{
    WireCheckRuns, WireCombinedStatus, WireComment, WireCommitEntry, WireFile, WireIssue,
    WireLabel, WireMerge, WireMilestone, WirePullRequest, WireRepository, WireReview, WireUser,
};

/// Upper bound of files requested from `GET /pulls/{n}/files`.
pub const FILES_MAX: usize = 100;
/// Total patch budget of one PR detail render (bytes).
pub const PATCH_BUDGET: usize = 400_000;

pub fn user(wire: WireUser) -> GitHubUser {
    GitHubUser {
        login: wire.login,
        avatar_url: wire.avatar_url,
        html_url: wire.html_url,
    }
}

pub fn label(wire: WireLabel) -> GitHubLabel {
    GitHubLabel {
        name: wire.name,
        color: wire.color,
        description: wire.description,
    }
}

pub fn milestone(wire: WireMilestone) -> GitHubMilestone {
    GitHubMilestone {
        number: wire.number,
        title: wire.title,
        state: wire.state,
        open_issues: wire.open_issues,
        closed_issues: wire.closed_issues,
        due_on: wire.due_on,
    }
}

/// Row of the PR list. `repo` is the repository that was queried, used to flag
/// fork branches (`crossRepository`).
pub fn pr_summary(wire: WirePullRequest, repo: &GitHubRepoRef) -> GitHubPullRequestSummary {
    let head_repo = wire.head.repo.as_ref().map(|entry| entry.full_name.clone());
    let merged = wire.merged_at.is_some();
    GitHubPullRequestSummary {
        number: wire.number,
        title: wire.title,
        state: wire.state,
        draft: wire.draft,
        merged,
        author: user(wire.user),
        head_ref: wire.head.branch,
        head_sha: wire.head.sha,
        base_ref: wire.base.branch,
        created_at: wire.created_at,
        updated_at: wire.updated_at,
        comments: wire.comments,
        additions: wire.additions,
        deletions: wire.deletions,
        changed_files: wire.changed_files,
        labels: wire.labels.into_iter().map(label).collect(),
        html_url: wire.html_url,
        cross_repository: head_repo
            .map(|full| full != repo.full_name())
            .unwrap_or(false),
    }
}

/// Summary built from a `/search/issues` item (`is:pr`).
///
/// The search endpoint does not return head/base refs or diff stats, so those
/// fields stay empty and the list renders `—` for them.
pub fn pr_summary_from_search(wire: WireIssue) -> GitHubPullRequestSummary {
    let merged = wire
        .pull_request
        .as_ref()
        .and_then(|marker| marker.merged_at.clone())
        .is_some();
    GitHubPullRequestSummary {
        number: wire.number,
        title: wire.title,
        state: wire.state,
        draft: wire.draft,
        merged,
        author: user(wire.user),
        head_ref: String::new(),
        head_sha: String::new(),
        base_ref: String::new(),
        created_at: wire.created_at,
        updated_at: wire.updated_at,
        comments: wire.comments,
        additions: 0,
        deletions: 0,
        changed_files: 0,
        labels: wire.labels.into_iter().map(label).collect(),
        html_url: wire.html_url,
        cross_repository: false,
    }
}

pub fn comment(wire: WireComment) -> GitHubComment {
    GitHubComment {
        id: wire.id,
        author: user(wire.user),
        body: wire.body,
        created_at: wire.created_at,
        updated_at: wire.updated_at,
        html_url: wire.html_url,
        author_association: wire.author_association,
    }
}

pub fn review(wire: WireReview) -> GitHubReview {
    GitHubReview {
        id: wire.id,
        author: user(wire.user),
        state: wire.state,
        body: wire.body.unwrap_or_default(),
        submitted_at: wire.submitted_at,
    }
}

fn clipped(text: String, max: usize) -> String {
    if text.chars().count() <= max {
        return text;
    }
    text.chars().take(max).collect()
}

pub fn pr_commit(wire: WireCommitEntry) -> GitHubPullRequestCommit {
    GitHubPullRequestCommit {
        sha: wire.sha,
        message: clipped(wire.commit.message.trim().to_string(), 2_000),
        author: wire.commit.author.name,
        author_login: wire.author.as_ref().map(|author| author.login.clone()),
        avatar_url: wire.author.as_ref().and_then(|author| author.avatar_url.clone()),
        date: wire.commit.author.date,
    }
}

/// Maps the changed files, clipping the payload to the patch budget.
pub fn pr_files(items: Vec<WireFile>, has_next: bool) -> GitHubPullRequestFiles {
    let mut budget = PATCH_BUDGET;
    let mut truncated = has_next;
    let files: Vec<GitHubPullRequestFile> = items
        .into_iter()
        .take(FILES_MAX)
        .map(|file| {
            let mut clipped_patch = false;
            let patch = file.patch.map(|patch| {
                let size = patch.len();
                if size > budget {
                    clipped_patch = true;
                    let visible: String = patch.chars().take(budget).collect();
                    budget = 0;
                    visible
                } else {
                    budget = budget.saturating_sub(size);
                    patch
                }
            });
            if patch.is_none() || clipped_patch {
                truncated = true;
            }
            GitHubPullRequestFile {
                path: file.filename,
                previous_path: file.previous_filename,
                status: file.status,
                additions: file.additions,
                deletions: file.deletions,
                changes: file.changes,
                truncated: patch.is_none() || clipped_patch,
                patch,
            }
        })
        .collect();
    GitHubPullRequestFiles { files, truncated }
}

pub fn checks_summary(runs: WireCheckRuns, combined: WireCombinedStatus) -> GitHubChecksSummary {
    let mut summary = GitHubChecksSummary {
        state: "none".to_string(),
        total: 0,
        passed: 0,
        failed: 0,
        pending: 0,
    };
    for run in runs.check_runs {
        summary.total += 1;
        match run.conclusion.as_deref() {
            Some("success") | Some("neutral") | Some("skipped") => summary.passed += 1,
            Some(_) => summary.failed += 1,
            None => summary.pending += 1,
        }
    }
    for status in combined.statuses {
        summary.total += 1;
        match status.state.as_str() {
            "success" => summary.passed += 1,
            "pending" => summary.pending += 1,
            _ => summary.failed += 1,
        }
    }
    summary.state = if summary.total == 0 {
        "none".to_string()
    } else if summary.failed > 0 {
        "failure".to_string()
    } else if summary.pending > 0 {
        "pending".to_string()
    } else {
        "success".to_string()
    };
    summary
}

pub fn pr_detail(
    wire: WirePullRequest,
    repo: &GitHubRepoRef,
    checks: GitHubChecksSummary,
    reviews: Vec<WireReview>,
    comments: Vec<WireComment>,
) -> GitHubPullRequestDetail {
    let summary = pr_summary(wire.clone(), repo);
    GitHubPullRequestDetail {
        body: wire.body.clone().unwrap_or_default(),
        mergeable: wire.mergeable,
        mergeable_state: wire.mergeable_state,
        merged_at: wire.merged_at.clone(),
        merged_by: wire.merged_by.map(user),
        requested_reviewers: wire.requested_reviewers.into_iter().map(user).collect(),
        assignees: wire.assignees.into_iter().map(user).collect(),
        milestone: wire.milestone.map(milestone),
        node_id: wire.node_id,
        checks,
        reviews: reviews.into_iter().map(review).collect(),
        comments: comments.into_iter().map(comment).collect(),
        summary,
    }
}

pub fn issue_summary(wire: WireIssue) -> GitHubIssueSummary {
    GitHubIssueSummary {
        number: wire.number,
        title: wire.title,
        state: wire.state,
        state_reason: wire.state_reason,
        author: user(wire.user),
        created_at: wire.created_at,
        updated_at: wire.updated_at,
        comments: wire.comments,
        labels: wire.labels.into_iter().map(label).collect(),
        assignees: wire.assignees.into_iter().map(user).collect(),
        milestone: wire.milestone.map(|entry| entry.title),
        html_url: wire.html_url,
    }
}

pub fn issue_detail(wire: WireIssue, comments: Vec<WireComment>) -> GitHubIssueDetail {
    GitHubIssueDetail {
        body: wire.body.clone().unwrap_or_default(),
        locked: wire.locked,
        closed_at: wire.closed_at.clone(),
        milestone: wire.milestone.clone().map(milestone),
        comments: comments.into_iter().map(comment).collect(),
        summary: issue_summary(wire),
    }
}

pub fn repo_info(wire: WireRepository, resolved: &GitHubRepoRef) -> GitHubRepoInfo {
    let can_push = wire
        .permissions
        .as_ref()
        .map(|permissions| permissions.push || permissions.admin || permissions.maintain)
        .unwrap_or(false);
    GitHubRepoInfo {
        host: resolved.host.clone(),
        owner: resolved.owner.clone(),
        name: resolved.name.clone(),
        full_name: if wire.full_name.is_empty() {
            resolved.full_name()
        } else {
            wire.full_name
        },
        html_url: if wire.html_url.is_empty() {
            resolved.html_url()
        } else {
            wire.html_url
        },
        default_branch: Some(wire.default_branch).filter(|branch| !branch.is_empty()),
        can_push,
        graphql: resolved.graphql_available(),
    }
}

pub fn merge_result(wire: WireMerge) -> GitHubMergeResult {
    GitHubMergeResult {
        merged: wire.merged,
        message: wire.message,
        sha: wire.sha,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> serde_json::Value {
        serde_json::from_str(include_str!("testdata/github.json")).expect("fixture json")
    }

    fn repo() -> GitHubRepoRef {
        GitHubRepoRef {
            host: "github.com".to_string(),
            owner: "Hyska-Software".to_string(),
            name: "ZylaraAi".to_string(),
        }
    }

    fn parse<T: serde::de::DeserializeOwned>(value: &serde_json::Value, key: &str) -> T {
        serde_json::from_value(value.get(key).cloned().expect("fixture key")).expect("parse")
    }

    #[test]
    fn maps_a_pull_request_row() {
        let pr: WirePullRequest = parse(&fixture(), "pull_request");
        let summary = pr_summary(pr, &repo());
        assert_eq!(summary.number, 42);
        assert_eq!(summary.title, "Add GitHub PR and issue tabs");
        assert_eq!(summary.author.login, "octocat");
        assert_eq!(summary.head_ref, "feat/github-tabs");
        assert_eq!(summary.base_ref, "main");
        assert_eq!(summary.additions, 120);
        assert_eq!(summary.deletions, 8);
        assert_eq!(summary.changed_files, 3);
        assert_eq!(summary.labels.len(), 2);
        assert_eq!(summary.labels[0].name, "enhancement");
        assert!(!summary.merged);
        assert!(!summary.draft);
        assert!(!summary.cross_repository);
    }

    #[test]
    fn detects_fork_branches_and_merged_state() {
        let mut pr: WirePullRequest = parse(&fixture(), "pull_request");
        pr.head.repo = Some(crate::github::wire::WireRepoMini {
            full_name: "someone/ZylaraAi".to_string(),
        });
        pr.merged_at = Some("2026-01-01T00:00:00Z".to_string());
        let summary = pr_summary(pr, &repo());
        assert!(summary.cross_repository);
        assert!(summary.merged);
    }

    #[test]
    fn maps_search_rows_without_diff_stats() {
        let issue: WireIssue = parse(&fixture(), "search_pull_request");
        let summary = pr_summary_from_search(issue);
        assert_eq!(summary.number, 7);
        assert!(summary.head_ref.is_empty());
        assert_eq!(summary.additions, 0);
        assert!(summary.merged);
        assert!(summary.draft);
    }

    #[test]
    fn maps_detail_with_reviews_and_comments() {
        let pr: WirePullRequest = parse(&fixture(), "pull_request");
        let reviews: Vec<WireReview> = parse(&fixture(), "reviews");
        let comments: Vec<WireComment> = parse(&fixture(), "comments");
        let runs: WireCheckRuns = parse(&fixture(), "check_runs");
        let combined: WireCombinedStatus = parse(&fixture(), "combined_status");
        let checks = checks_summary(runs, combined);
        assert_eq!(checks.state, "failure");
        assert_eq!(checks.total, 4);
        assert_eq!(checks.failed, 1);
        assert_eq!(checks.pending, 1);
        assert_eq!(checks.passed, 2);

        let detail = pr_detail(pr, &repo(), checks, reviews, comments);
        assert_eq!(detail.body, "Pull request body in **Markdown**.");
        assert_eq!(detail.mergeable, Some(true));
        assert_eq!(detail.mergeable_state.as_deref(), Some("clean"));
        assert_eq!(detail.reviews.len(), 2);
        assert_eq!(detail.comments.len(), 1);
        assert_eq!(detail.comments[0].author.login, "reviewer");
        assert_eq!(detail.requested_reviewers.len(), 1);
        assert_eq!(detail.summary.number, 42);
        assert_eq!(detail.node_id.as_deref(), Some("PR_kwDOA"));
    }

    #[test]
    fn maps_files_and_clips_the_patch_budget() {
        let files: Vec<WireFile> = parse(&fixture(), "files");
        let mapped = pr_files(files, true);
        assert!(mapped.truncated, "a next page means more than 100 files");
        assert_eq!(mapped.files.len(), 2);
        assert_eq!(mapped.files[0].path, "src/app.ts");
        assert!(mapped.files[0].patch.as_deref().unwrap_or("").contains("@@"));
        assert!(mapped.files[1].truncated, "binary files have no patch");
    }

    #[test]
    fn maps_commits_issues_and_repo() {
        let commits: Vec<WireCommitEntry> = parse(&fixture(), "commits");
        let mapped = pr_commit(commits.into_iter().next().expect("commit"));
        assert_eq!(mapped.author, "Octo Cat");
        assert_eq!(mapped.author_login.as_deref(), Some("octocat"));

        let issue: WireIssue = parse(&fixture(), "issue");
        let comments: Vec<WireComment> = parse(&fixture(), "comments");
        let detail = issue_detail(issue, comments);
        assert_eq!(detail.summary.number, 9);
        assert_eq!(detail.summary.state_reason.as_deref(), Some("completed"));
        assert_eq!(detail.summary.labels[0].name, "bug");
        assert_eq!(detail.summary.assignees[0].login, "octocat");
        assert_eq!(detail.summary.milestone.as_deref(), Some("v1.0"));
        assert!(!detail.locked);
        assert_eq!(detail.comments.len(), 1);

        let repository: WireRepository = parse(&fixture(), "repo");
        let info = repo_info(repository, &repo());
        assert_eq!(info.full_name, "Hyska-Software/ZylaraAi");
        assert_eq!(info.default_branch.as_deref(), Some("main"));
        assert!(info.can_push);
        assert!(info.graphql);
    }

    #[test]
    fn maps_merge_result() {
        let merge: WireMerge = parse(&fixture(), "merge");
        let mapped = merge_result(merge);
        assert!(mapped.merged);
        assert_eq!(mapped.sha.as_deref(), Some("abc123"));
    }
}
