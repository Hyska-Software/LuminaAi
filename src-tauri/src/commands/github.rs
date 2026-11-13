//! GitHub commands: account/connection, PR and Issue lists, details and the
//! explicit management actions offered by the tabs.
//!
//! Contract: `docs/GITHUB.md`. Every command resolves the repository from the
//! workspace remote and the token from `secrets.json` → environment → `gh` CLI;
//! the renderer never sees a token.

use std::time::Duration;

use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, State};

use crate::config;
use crate::domain::{
    GitHubAccount, GitHubChecksSummary, GitHubComment, GitHubConnectionView, GitHubIssueDetail,
    GitHubIssueFilter, GitHubIssueList, GitHubIssueSummary, GitHubLabel, GitHubMergeResult,
    GitHubMilestone, GitHubPullRequestCommit, GitHubPullRequestDetail, GitHubPullRequestFiles,
    GitHubPullRequestFilter, GitHubPullRequestList, GitHubPullRequestSummary, GitHubRepoInfo,
    GitHubReview, GitHubUser,
};
use crate::github::filters::{self, ListRequest};
use crate::github::map;
use crate::github::wire::{
    WireBranch, WireCheckRuns, WireCombinedStatus, WireComment, WireCommitEntry, WireFile,
    WireIssue, WireLabel, WireMerge, WireMilestone, WirePullRequest, WireRepository, WireReview,
    WireSearchResult, WireUser,
};
use crate::github::{GitHubClient, GitHubError, GitHubRepoRef};
use crate::state::AppState;
use crate::workspace::git as workspace_git;

use super::workspace::workspace_path;

/// Bound of the review/comment collections fetched with a detail.
const COLLECTION_PER_PAGE: &str = "100";
/// Safety bound for collections without a UI pager (comments, reviews, refs).
const COLLECTION_PAGES_MAX: u32 = 10;
/// GitHub CLI token probe must never block a command for long.
const GH_CLI_TIMEOUT: Duration = Duration::from_secs(4);

fn to_error(error: GitHubError) -> String {
    error.message()
}

fn clean(value: Option<&String>) -> Option<String> {
    value
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// Characters that would change the meaning of a ref path segment.
const REF_SEGMENT: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'`')
    .add(b'{')
    .add(b'}');

/// Encodes a branch name for `/git/refs/heads/{ref}` keeping the `/` hierarchy.
fn encode_ref(branch: &str) -> String {
    branch
        .split('/')
        .map(|segment| utf8_percent_encode(segment, REF_SEGMENT).to_string())
        .collect::<Vec<_>>()
        .join("/")
}

/// Reviewers to add and remove so the request matches the picker selection.
fn reviewer_delta(current: &[String], desired: &[String]) -> (Vec<String>, Vec<String>) {
    let add = desired
        .iter()
        .filter(|reviewer| !current.contains(reviewer))
        .cloned()
        .collect();
    let remove = current
        .iter()
        .filter(|reviewer| !desired.contains(reviewer))
        .cloned()
        .collect();
    (add, remove)
}

/// Fetches every page of a collection up to the safety bound (1000 rows).
async fn get_all_pages<T: DeserializeOwned>(
    client: &GitHubClient,
    path: &str,
    query: &[(String, String)],
) -> Result<Vec<T>, GitHubError> {
    let mut items = Vec::new();
    for page in 1..=COLLECTION_PAGES_MAX {
        let mut page_query = query.to_vec();
        page_query.push(("page".to_string(), page.to_string()));
        let (mut chunk, has_next) = client.get_envelope::<Vec<T>>(path, &page_query).await?;
        items.append(&mut chunk);
        if !has_next {
            break;
        }
    }
    Ok(items)
}

/// Body of `PATCH /issues/{n}`; extracted so the clear-milestone rule is testable.
fn issue_update_body(
    title: Option<&String>,
    body: Option<&String>,
    state_value: Option<&String>,
    state_reason: Option<&String>,
    labels: Option<Vec<String>>,
    assignees: Option<Vec<String>>,
    milestone: Option<u64>,
    clear_milestone: bool,
) -> Result<Value, String> {
    let mut payload = Map::new();
    if let Some(title) = clean(title) {
        payload.insert("title".to_string(), json!(title));
    }
    if let Some(body) = body {
        payload.insert("body".to_string(), json!(body));
    }
    if let Some(state_value) = clean(state_value) {
        let state_value = if state_value == "closed" { "closed" } else { "open" };
        payload.insert("state".to_string(), json!(state_value));
        if state_value == "closed" {
            if let Some(reason) = clean(state_reason) {
                let reason = if reason == "not_planned" {
                    "not_planned"
                } else {
                    "completed"
                };
                payload.insert("state_reason".to_string(), json!(reason));
            }
        }
    }
    if let Some(labels) = labels {
        let labels: Vec<String> = labels
            .into_iter()
            .map(|label| label.trim().to_string())
            .filter(|label| !label.is_empty())
            .collect();
        payload.insert("labels".to_string(), json!(labels));
    }
    if let Some(assignees) = assignees {
        let assignees: Vec<String> = assignees
            .into_iter()
            .map(|assignee| assignee.trim().to_string())
            .filter(|assignee| !assignee.is_empty())
            .collect();
        payload.insert("assignees".to_string(), json!(assignees));
    }
    if clear_milestone {
        // `null` is what the API requires to remove the milestone.
        payload.insert("milestone".to_string(), Value::Null);
    } else if let Some(milestone) = milestone {
        payload.insert("milestone".to_string(), json!(milestone));
    }
    if payload.is_empty() {
        return Err(crate::i18n::t("github.errors.nothingToUpdate"));
    }
    Ok(Value::Object(payload))
}

/* ------------------------------------------------------------------ */
/* Credentials and repository                                          */
/* ------------------------------------------------------------------ */

/// `gh auth token` — the last credential fallback (same order as API keys).
async fn gh_cli_token() -> Option<String> {
    use tokio::process::Command;
    let output = tokio::time::timeout(
        GH_CLI_TIMEOUT,
        Command::new("gh").args(["auth", "token"]).output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!token.is_empty()).then_some(token)
}

/// Token plus its source (`settings`, `env`, `gh-cli`).
async fn resolve_token(app: &AppHandle) -> (Option<String>, &'static str) {
    let secrets = config::github_secrets(app);
    let env = config::github_token_from_env();
    let has_cheap_source = secrets
        .token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .is_some()
        || env.is_some();
    if has_cheap_source {
        return config::resolve_github_token(&secrets, env, || None);
    }
    let cli = gh_cli_token().await;
    config::resolve_github_token(&secrets, env, || cli)
}

fn account_view(login: Option<String>, source: &'static str, scopes: Vec<String>) -> GitHubAccount {
    GitHubAccount {
        authenticated: true,
        login,
        source: source.to_string(),
        scopes,
    }
}

/// Repository of the workspace, parsed from its git remote.
async fn resolve_repo(state: &AppState, workspace_id: &str) -> Result<GitHubRepoRef, String> {
    let root = workspace_path(state, workspace_id)?;
    let remote = workspace_git::remote_url(&root)
        .await
        .ok_or_else(|| crate::i18n::t("github.errors.noRemote"))?;
    crate::github::parse_remote_url(&remote).ok_or_else(|| {
        crate::i18n::t_args("github.errors.notGitHub", &[("remote", remote.as_str())])
    })
}

/// Authenticated client bound to the workspace repository.
async fn client_for(
    state: &AppState,
    app: &AppHandle,
    workspace_id: &str,
) -> Result<(GitHubClient, GitHubRepoRef), String> {
    let repo = resolve_repo(state, workspace_id).await?;
    let (token, _) = resolve_token(app).await;
    let token = token.ok_or_else(|| crate::i18n::t("github.errors.noToken"))?;
    Ok((
        GitHubClient::new(state.http.clone(), repo.api_base(), token),
        repo,
    ))
}

/// Client used to validate a pasted token before persisting it.
fn validation_client(
    state: &AppState,
    repo: Option<&GitHubRepoRef>,
    token: &str,
) -> GitHubClient {
    let base = repo
        .map(GitHubRepoRef::api_base)
        .unwrap_or_else(|| "https://api.github.com".to_string());
    GitHubClient::new(state.http.clone(), base, token)
}

fn scopes_from_headers(headers: &reqwest::header::HeaderMap) -> Vec<String> {
    headers
        .get("x-oauth-scopes")
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|scope| !scope.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn github_account(app: AppHandle) -> Result<GitHubAccount, String> {
    let secrets = config::github_secrets(&app);
    let (token, source) = resolve_token(&app).await;
    let scopes = if source == "settings" {
        secrets.scopes.clone()
    } else {
        Vec::new()
    };
    Ok(GitHubAccount {
        authenticated: token.is_some(),
        login: secrets.login.clone(),
        source: source.to_string(),
        scopes,
    })
}

/// Validates and stores a personal access token. Nothing is persisted when the
/// token is rejected.
#[tauri::command]
pub async fn github_set_token(
    app: AppHandle,
    state: State<'_, AppState>,
    token: String,
    workspace_id: Option<String>,
) -> Result<GitHubAccount, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err(crate::i18n::t("github.errors.emptyToken"));
    }
    let repo = match workspace_id.as_deref() {
        Some(workspace_id) => resolve_repo(&state, workspace_id).await.ok(),
        None => None,
    };
    let client = validation_client(&state, repo.as_ref(), token);
    let (user, headers) = client
        .get_with_headers::<WireUser>("/user")
        .await
        .map_err(to_error)?;
    let scopes = scopes_from_headers(&headers);
    let login = user.login.trim().to_string();
    config::set_github_credentials(&app, Some(token), Some(&login), &scopes)
        .map_err(|error| format!("{error:#}"))?;
    Ok(account_view(Some(login), "settings", scopes))
}

#[tauri::command]
pub async fn github_clear_token(app: AppHandle) -> Result<GitHubAccount, String> {
    config::set_github_credentials(&app, None, None, &[])
        .map_err(|error| format!("{error:#}"))?;
    let (token, source) = resolve_token(&app).await;
    Ok(GitHubAccount {
        authenticated: token.is_some(),
        login: None,
        source: source.to_string(),
        scopes: Vec::new(),
    })
}

/// Status of the repository of a workspace: account, resolved repo and why it
/// cannot be used (no remote, invalid token, 404…).
#[tauri::command]
pub async fn github_connection(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<GitHubConnectionView, String> {
    let secrets = config::github_secrets(&app);
    let (token, source) = resolve_token(&app).await;
    let account = GitHubAccount {
        authenticated: token.is_some(),
        login: secrets.login.clone(),
        source: source.to_string(),
        scopes: if source == "settings" {
            secrets.scopes.clone()
        } else {
            Vec::new()
        },
    };

    let repo = match resolve_repo(&state, &workspace_id).await {
        Ok(repo) => repo,
        Err(message) => {
            return Ok(GitHubConnectionView {
                account,
                repo: None,
                message: Some(message),
            })
        }
    };

    let mut view = GitHubConnectionView {
        account,
        repo: Some(GitHubRepoInfo {
            host: repo.host.clone(),
            owner: repo.owner.clone(),
            name: repo.name.clone(),
            full_name: repo.full_name(),
            html_url: repo.html_url(),
            default_branch: None,
            can_push: false,
            graphql: repo.graphql_available(),
        }),
        message: None,
    };
    let Some(token) = token else {
        view.message = Some(crate::i18n::t("github.errors.noToken"));
        return Ok(view);
    };
    let client = GitHubClient::new(state.http.clone(), repo.api_base(), token);
    match client
        .get::<WireRepository>(&format!("/repos/{}", repo.full_name()), &[])
        .await
    {
        Ok(repository) => {
            view.repo = Some(map::repo_info(repository, &repo));
            if view.account.login.is_none() {
                if let Ok((user, headers)) = client.get_with_headers::<WireUser>("/user").await {
                    view.account.login = Some(user.login);
                    if view.account.scopes.is_empty() {
                        view.account.scopes = scopes_from_headers(&headers);
                    }
                }
            }
        }
        Err(error) => view.message = Some(error.message()),
    }
    Ok(view)
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

async fn fetch_pull_request_page(
    client: &GitHubClient,
    repo: &GitHubRepoRef,
    request: &ListRequest,
) -> Result<(Vec<GitHubPullRequestSummary>, bool), String> {
    if request.search {
        let (envelope, has_next) = client
            .get_envelope::<WireSearchResult<WireIssue>>(&request.path, &request.query)
            .await
            .map_err(to_error)?;
        let items = envelope
            .items
            .into_iter()
            .filter(|item| item.pull_request.is_some())
            .map(map::pr_summary_from_search)
            .collect();
        return Ok((items, has_next));
    }
    let (items, has_next) = client
        .get_envelope::<Vec<WirePullRequest>>(&request.path, &request.query)
        .await
        .map_err(to_error)?;
    Ok((
        items
            .into_iter()
            .map(|entry| map::pr_summary(entry, repo))
            .collect(),
        has_next,
    ))
}

#[tauri::command]
pub async fn github_list_pull_requests(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    filter: Option<GitHubPullRequestFilter>,
) -> Result<GitHubPullRequestList, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let filter = filter.unwrap_or_default();
    let request = filters::pull_requests(&repo, &filter);
    let (items, has_next) = fetch_pull_request_page(&client, &repo, &request).await?;
    Ok(GitHubPullRequestList {
        items,
        page: request.page,
        per_page: request.per_page,
        has_next,
    })
}

async fn fetch_issue_page(
    client: &GitHubClient,
    request: &ListRequest,
) -> Result<(Vec<GitHubIssueSummary>, bool), String> {
    if request.search {
        let (envelope, has_next) = client
            .get_envelope::<WireSearchResult<WireIssue>>(&request.path, &request.query)
            .await
            .map_err(to_error)?;
        let items = envelope
            .items
            .into_iter()
            .filter(|item| item.pull_request.is_none())
            .map(map::issue_summary)
            .collect();
        return Ok((items, has_next));
    }
    let (items, has_next) = client
        .get_envelope::<Vec<WireIssue>>(&request.path, &request.query)
        .await
        .map_err(to_error)?;
    Ok((items.into_iter().map(map::issue_summary).collect(), has_next))
}

#[tauri::command]
pub async fn github_list_issues(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    filter: Option<GitHubIssueFilter>,
) -> Result<GitHubIssueList, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let filter = filter.unwrap_or_default();
    let request = filters::issues(&repo, &filter);
    let (items, has_next) = fetch_issue_page(&client, &request).await?;
    Ok(GitHubIssueList {
        items,
        page: request.page,
        per_page: request.per_page,
        has_next,
    })
}

/* ------------------------------------------------------------------ */
/* Pull request detail                                                 */
/* ------------------------------------------------------------------ */

async fn checks_for(
    client: &GitHubClient,
    repo: &GitHubRepoRef,
    sha: &str,
) -> GitHubChecksSummary {
    if sha.trim().is_empty() {
        return GitHubChecksSummary {
            state: "none".to_string(),
            ..GitHubChecksSummary::default()
        };
    }
    let runs = client
        .get::<WireCheckRuns>(
            &format!("/repos/{}/commits/{sha}/check-runs", repo.full_name()),
            &[("per_page".to_string(), COLLECTION_PER_PAGE.to_string())],
        )
        .await
        .unwrap_or_default();
    let combined = client
        .get::<WireCombinedStatus>(
            &format!("/repos/{}/commits/{sha}/status", repo.full_name()),
            &[],
        )
        .await
        .unwrap_or_default();
    map::checks_summary(runs, combined)
}

async fn reviews_for(
    client: &GitHubClient,
    repo: &GitHubRepoRef,
    number: u64,
) -> Vec<WireReview> {
    get_all_pages::<WireReview>(
        client,
        &format!("/repos/{}/pulls/{number}/reviews", repo.full_name()),
        &[("per_page".to_string(), COLLECTION_PER_PAGE.to_string())],
    )
    .await
    .unwrap_or_default()
}

async fn comments_for(client: &GitHubClient, repo: &GitHubRepoRef, number: u64) -> Vec<WireComment> {
    get_all_pages::<WireComment>(
        client,
        &format!("/repos/{}/issues/{number}/comments", repo.full_name()),
        &[("per_page".to_string(), COLLECTION_PER_PAGE.to_string())],
    )
    .await
    .unwrap_or_default()
}

async fn pull_request_wire(
    client: &GitHubClient,
    repo: &GitHubRepoRef,
    number: u64,
) -> Result<WirePullRequest, String> {
    client
        .get::<WirePullRequest>(
            &format!("/repos/{}/pulls/{number}", repo.full_name()),
            &[],
        )
        .await
        .map_err(to_error)
}

#[tauri::command]
pub async fn github_pull_request(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    number: u64,
) -> Result<GitHubPullRequestDetail, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let wire = pull_request_wire(&client, &repo, number).await?;
    let checks = checks_for(&client, &repo, &wire.head.sha).await;
    let reviews = reviews_for(&client, &repo, number).await;
    let comments = comments_for(&client, &repo, number).await;
    Ok(map::pr_detail(wire, &repo, checks, reviews, comments))
}

#[tauri::command]
pub async fn github_pull_request_files(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    number: u64,
) -> Result<GitHubPullRequestFiles, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let (files, has_next) = client
        .get_envelope::<Vec<WireFile>>(
            &format!("/repos/{}/pulls/{number}/files", repo.full_name()),
            &[("per_page".to_string(), COLLECTION_PER_PAGE.to_string())],
        )
        .await
        .map_err(to_error)?;
    Ok(map::pr_files(files, has_next))
}

#[tauri::command]
pub async fn github_pull_request_commits(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    number: u64,
) -> Result<Vec<GitHubPullRequestCommit>, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let commits = get_all_pages::<WireCommitEntry>(
        &client,
        &format!("/repos/{}/pulls/{number}/commits", repo.full_name()),
        &[("per_page".to_string(), COLLECTION_PER_PAGE.to_string())],
    )
    .await
    .map_err(to_error)?;
    Ok(commits.into_iter().map(map::pr_commit).collect())
}

/* ------------------------------------------------------------------ */
/* Issue detail                                                        */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn github_issue(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    number: u64,
) -> Result<GitHubIssueDetail, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let wire = client
        .get::<WireIssue>(
            &format!("/repos/{}/issues/{number}", repo.full_name()),
            &[],
        )
        .await
        .map_err(to_error)?;
    let comments = comments_for(&client, &repo, number).await;
    Ok(map::issue_detail(wire, comments))
}

/* ------------------------------------------------------------------ */
/* Repository metadata                                                 */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn github_labels(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<GitHubLabel>, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let labels = get_all_pages::<WireLabel>(
        &client,
        &format!("/repos/{}/labels", repo.full_name()),
        &[("per_page".to_string(), COLLECTION_PER_PAGE.to_string())],
    )
    .await
    .map_err(to_error)?;
    Ok(labels.into_iter().map(map::label).collect())
}

#[tauri::command]
pub async fn github_assignable_users(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<GitHubUser>, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let users = get_all_pages::<WireUser>(
        &client,
        &format!("/repos/{}/assignees", repo.full_name()),
        &[("per_page".to_string(), COLLECTION_PER_PAGE.to_string())],
    )
    .await
    .map_err(to_error)?;
    Ok(users.into_iter().map(map::user).collect())
}

#[tauri::command]
pub async fn github_milestones(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<GitHubMilestone>, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let milestones = get_all_pages::<WireMilestone>(
        &client,
        &format!("/repos/{}/milestones", repo.full_name()),
        &[
            ("state".to_string(), "open".to_string()),
            ("per_page".to_string(), COLLECTION_PER_PAGE.to_string()),
        ],
    )
    .await
    .map_err(to_error)?;
    Ok(milestones.into_iter().map(map::milestone).collect())
}

#[tauri::command]
pub async fn github_branches(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<String>, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let branches = get_all_pages::<WireBranch>(
        &client,
        &format!("/repos/{}/branches", repo.full_name()),
        &[("per_page".to_string(), COLLECTION_PER_PAGE.to_string())],
    )
    .await
    .map_err(to_error)?;
    Ok(branches.into_iter().map(|branch| branch.name).collect())
}

/* ------------------------------------------------------------------ */
/* Pull request mutations                                              */
/* ------------------------------------------------------------------ */

#[derive(Debug, Serialize)]
struct CreatePullRequestBody {
    title: String,
    head: String,
    base: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    draft: Option<bool>,
}

#[tauri::command]
pub async fn github_create_pull_request(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    title: String,
    head: String,
    base: String,
    body: Option<String>,
    draft: Option<bool>,
) -> Result<GitHubPullRequestSummary, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let title = title.trim();
    if title.is_empty() {
        return Err(crate::i18n::t("github.errors.emptyTitle"));
    }
    let request = CreatePullRequestBody {
        title: title.to_string(),
        head: head.trim().to_string(),
        base: base.trim().to_string(),
        body: clean(body.as_ref()),
        draft,
    };
    if request.head.is_empty() || request.base.is_empty() {
        return Err(crate::i18n::t("github.errors.missingBranches"));
    }
    let wire = client
        .post::<_, WirePullRequest>(&format!("/repos/{}/pulls", repo.full_name()), &request)
        .await
        .map_err(to_error)?;
    Ok(map::pr_summary(wire, &repo))
}

#[tauri::command]
pub async fn github_update_pull_request(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    number: u64,
    title: Option<String>,
    body: Option<String>,
    state_value: Option<String>,
    base: Option<String>,
) -> Result<GitHubPullRequestSummary, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let mut payload = Map::new();
    if let Some(title) = clean(title.as_ref()) {
        payload.insert("title".to_string(), json!(title));
    }
    if let Some(body) = body {
        payload.insert("body".to_string(), json!(body));
    }
    if let Some(state_value) = clean(state_value.as_ref()) {
        let state_value = if state_value == "closed" { "closed" } else { "open" };
        payload.insert("state".to_string(), json!(state_value));
    }
    if let Some(base) = clean(base.as_ref()) {
        payload.insert("base".to_string(), json!(base));
    }
    if payload.is_empty() {
        return Err(crate::i18n::t("github.errors.nothingToUpdate"));
    }
    let wire = client
        .patch::<_, WirePullRequest>(
            &format!("/repos/{}/pulls/{number}", repo.full_name()),
            &Value::Object(payload),
        )
        .await
        .map_err(to_error)?;
    Ok(map::pr_summary(wire, &repo))
}

fn merge_method(value: Option<&String>) -> &'static str {
    match value.map(|value| value.trim().to_ascii_lowercase()).as_deref() {
        Some("squash") => "squash",
        Some("rebase") => "rebase",
        _ => "merge",
    }
}

#[tauri::command]
pub async fn github_merge_pull_request(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    number: u64,
    method: Option<String>,
    commit_title: Option<String>,
    commit_message: Option<String>,
    sha: Option<String>,
    delete_branch: Option<bool>,
) -> Result<GitHubMergeResult, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let mut payload = Map::new();
    payload.insert("merge_method".to_string(), json!(merge_method(method.as_ref())));
    if let Some(title) = clean(commit_title.as_ref()) {
        payload.insert("commit_title".to_string(), json!(title));
    }
    if let Some(message) = clean(commit_message.as_ref()) {
        payload.insert("commit_message".to_string(), json!(message));
    }
    if let Some(sha) = clean(sha.as_ref()) {
        // Refuse to merge if the head moved after the detail was loaded.
        payload.insert("sha".to_string(), json!(sha));
    }
    let wire = client
        .put::<_, WireMerge>(
            &format!("/repos/{}/pulls/{number}/merge", repo.full_name()),
            &Value::Object(payload),
        )
        .await
        .map_err(to_error)?;
    let result = map::merge_result(wire);
    if result.merged && delete_branch.unwrap_or(false) {
        // The head branch is only deleted when it lives in this repository
        // (fork branches belong to the contributor).
        if let Ok(pr) = pull_request_wire(&client, &repo, number).await {
            let same_repo = pr
                .head
                .repo
                .as_ref()
                .map(|head| head.full_name == repo.full_name())
                .unwrap_or(false);
            if same_repo && !pr.head.branch.is_empty() {
                let _ = client
                    .delete(&format!(
                        "/repos/{}/git/refs/heads/{}",
                        repo.full_name(),
                        encode_ref(&pr.head.branch)
                    ))
                    .await;
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn github_request_reviewers(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    number: u64,
    reviewers: Vec<String>,
) -> Result<(), String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let mut desired: Vec<String> = Vec::new();
    for reviewer in reviewers {
        let reviewer = reviewer.trim().to_string();
        if !reviewer.is_empty() && !desired.contains(&reviewer) {
            desired.push(reviewer);
        }
    }
    let current = pull_request_wire(&client, &repo, number).await?;
    let current: Vec<String> = current
        .requested_reviewers
        .into_iter()
        .map(|reviewer| reviewer.login)
        .filter(|login| !login.is_empty())
        .collect();
    let (add, remove) = reviewer_delta(&current, &desired);
    if !add.is_empty() {
        client
            .post::<_, WirePullRequest>(
                &format!(
                    "/repos/{}/pulls/{number}/requested_reviewers",
                    repo.full_name()
                ),
                &json!({ "reviewers": add }),
            )
            .await
            .map_err(to_error)?;
    }
    if !remove.is_empty() {
        client
            .delete_with_body(
                &format!(
                    "/repos/{}/pulls/{number}/requested_reviewers",
                    repo.full_name()
                ),
                &json!({ "reviewers": remove }),
            )
            .await
            .map_err(to_error)?;
    }
    Ok(())
}

/// Turns a draft pull request into a review-ready one (GraphQL, github.com).
#[tauri::command]
pub async fn github_mark_pull_request_ready(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    node_id: String,
) -> Result<(), String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    if !repo.graphql_available() {
        return Err(crate::i18n::t("github.errors.graphqlUnavailable"));
    }
    let node_id = node_id.trim();
    if node_id.is_empty() {
        return Err(crate::i18n::t("github.errors.missingNodeId"));
    }
    const MUTATION: &str = "mutation MarkReady($id: ID!) { \
        markPullRequestReadyForReview(input: { pullRequestId: $id }) { \
        pullRequest { isDraft } } }";
    client
        .graphql::<Value>(MUTATION, json!({ "id": node_id }))
        .await
        .map_err(to_error)?;
    Ok(())
}

#[tauri::command]
pub async fn github_submit_review(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    number: u64,
    event: String,
    body: Option<String>,
) -> Result<GitHubReview, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let event = match event.trim().to_ascii_uppercase().as_str() {
        "APPROVE" => "APPROVE",
        "REQUEST_CHANGES" => "REQUEST_CHANGES",
        _ => "COMMENT",
    };
    let body = clean(body.as_ref());
    if event != "APPROVE" && body.is_none() {
        return Err(crate::i18n::t("github.errors.emptyReview"));
    }
    let mut payload = Map::new();
    payload.insert("event".to_string(), json!(event));
    if let Some(body) = body {
        payload.insert("body".to_string(), json!(body));
    }
    let wire = client
        .post::<_, WireReview>(
            &format!("/repos/{}/pulls/{number}/reviews", repo.full_name()),
            &Value::Object(payload),
        )
        .await
        .map_err(to_error)?;
    Ok(map::review(wire))
}

/// Checks out the pull request head into the local `pr-<number>` branch.
#[tauri::command]
pub async fn github_checkout_pull_request(
    state: State<'_, AppState>,
    workspace_id: String,
    number: u64,
) -> Result<String, String> {
    let root = workspace_path(&state, &workspace_id)?;
    let remote = workspace_git::default_remote(&root).await;
    workspace_git::fetch_pull_request(&root, &remote, number as u32)
        .await
        .map_err(|error| error.message)
}

/* ------------------------------------------------------------------ */
/* Issue mutations                                                     */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn github_create_issue(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    title: String,
    body: Option<String>,
    labels: Option<Vec<String>>,
    assignees: Option<Vec<String>>,
) -> Result<GitHubIssueSummary, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let title = title.trim();
    if title.is_empty() {
        return Err(crate::i18n::t("github.errors.emptyTitle"));
    }
    let mut payload = Map::new();
    payload.insert("title".to_string(), json!(title));
    if let Some(body) = clean(body.as_ref()) {
        payload.insert("body".to_string(), json!(body));
    }
    if let Some(labels) = labels.filter(|labels| !labels.is_empty()) {
        payload.insert("labels".to_string(), json!(labels));
    }
    if let Some(assignees) = assignees.filter(|assignees| !assignees.is_empty()) {
        payload.insert("assignees".to_string(), json!(assignees));
    }
    let wire = client
        .post::<_, WireIssue>(
            &format!("/repos/{}/issues", repo.full_name()),
            &Value::Object(payload),
        )
        .await
        .map_err(to_error)?;
    Ok(map::issue_summary(wire))
}

#[tauri::command]
pub async fn github_update_issue(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    number: u64,
    title: Option<String>,
    body: Option<String>,
    state_value: Option<String>,
    state_reason: Option<String>,
    labels: Option<Vec<String>>,
    assignees: Option<Vec<String>>,
    milestone: Option<u64>,
    clear_milestone: Option<bool>,
) -> Result<GitHubIssueSummary, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let payload = issue_update_body(
        title.as_ref(),
        body.as_ref(),
        state_value.as_ref(),
        state_reason.as_ref(),
        labels,
        assignees,
        milestone,
        clear_milestone.unwrap_or(false),
    )?;
    let wire = client
        .patch::<_, WireIssue>(
            &format!("/repos/{}/issues/{number}", repo.full_name()),
            &payload,
        )
        .await
        .map_err(to_error)?;
    Ok(map::issue_summary(wire))
}

/* ------------------------------------------------------------------ */
/* Shared mutations                                                    */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn github_add_comment(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    number: u64,
    body: String,
) -> Result<GitHubComment, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let body = body.trim();
    if body.is_empty() {
        return Err(crate::i18n::t("github.errors.emptyComment"));
    }
    let wire = client
        .post::<_, WireComment>(
            &format!("/repos/{}/issues/{number}/comments", repo.full_name()),
            &json!({ "body": body }),
        )
        .await
        .map_err(to_error)?;
    Ok(map::comment(wire))
}

#[tauri::command]
pub async fn github_update_comment(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    comment_id: u64,
    body: String,
) -> Result<GitHubComment, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let body = body.trim();
    if body.is_empty() {
        return Err(crate::i18n::t("github.errors.emptyComment"));
    }
    let wire = client
        .patch::<_, WireComment>(
            &format!("/repos/{}/issues/comments/{comment_id}", repo.full_name()),
            &json!({ "body": body }),
        )
        .await
        .map_err(to_error)?;
    Ok(map::comment(wire))
}

#[tauri::command]
pub async fn github_delete_comment(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    comment_id: u64,
) -> Result<(), String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    client
        .delete(&format!(
            "/repos/{}/issues/comments/{comment_id}",
            repo.full_name()
        ))
        .await
        .map_err(to_error)
}

#[tauri::command]
pub async fn github_set_labels(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    number: u64,
    labels: Vec<String>,
) -> Result<Vec<GitHubLabel>, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let labels: Vec<String> = labels
        .into_iter()
        .map(|label| label.trim().to_string())
        .filter(|label| !label.is_empty())
        .collect();
    let wire = client
        .put::<_, Vec<WireLabel>>(
            &format!("/repos/{}/issues/{number}/labels", repo.full_name()),
            &json!({ "labels": labels }),
        )
        .await
        .map_err(to_error)?;
    Ok(wire.into_iter().map(map::label).collect())
}

#[tauri::command]
pub async fn github_set_assignees(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    number: u64,
    assignees: Vec<String>,
) -> Result<GitHubIssueSummary, String> {
    let (client, repo) = client_for(&state, &app, &workspace_id).await?;
    let assignees: Vec<String> = assignees
        .into_iter()
        .map(|assignee| assignee.trim().to_string())
        .filter(|assignee| !assignee.is_empty())
        .collect();
    let wire = client
        .patch::<_, WireIssue>(
            &format!("/repos/{}/issues/{number}", repo.full_name()),
            &json!({ "assignees": assignees }),
        )
        .await
        .map_err(to_error)?;
    Ok(map::issue_summary(wire))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issue_update_body_clears_the_milestone_with_null() {
        let body = issue_update_body(None, None, None, None, None, None, None, true)
            .expect("payload");
        assert_eq!(body.get("milestone"), Some(&Value::Null));
    }

    #[test]
    fn issue_update_body_sets_milestone_and_close_reason_only_when_closed() {
        let body = issue_update_body(
            Some(&" Title ".to_string()),
            Some(&String::new()),
            Some(&"closed".to_string()),
            Some(&"not_planned".to_string()),
            Some(vec![" bug ".to_string(), "  ".to_string()]),
            None,
            Some(7),
            false,
        )
        .expect("payload");
        assert_eq!(body["title"], "Title");
        assert_eq!(body["body"], "");
        assert_eq!(body["state"], "closed");
        assert_eq!(body["state_reason"], "not_planned");
        assert_eq!(body["labels"], json!(["bug"]));
        assert_eq!(body["milestone"], 7);

        let reopened = issue_update_body(
            None,
            None,
            Some(&"open".to_string()),
            Some(&"not_planned".to_string()),
            None,
            None,
            None,
            false,
        )
        .expect("payload");
        assert_eq!(reopened["state"], "open");
        assert!(reopened.get("state_reason").is_none());
    }

    #[test]
    fn issue_update_body_rejects_an_empty_patch() {
        assert!(issue_update_body(None, None, None, None, None, None, None, false).is_err());
    }

    #[test]
    fn reviewer_delta_adds_new_and_removes_unselected_reviewers() {
        let current = vec!["ana".to_string(), "bia".to_string()];
        let desired = vec!["bia".to_string(), "caio".to_string()];
        assert_eq!(
            reviewer_delta(&current, &desired),
            (vec!["caio".to_string()], vec!["ana".to_string()])
        );
        assert_eq!(
            reviewer_delta(&current, &current),
            (Vec::new(), Vec::new())
        );
    }

    #[test]
    fn encode_ref_keeps_the_branch_hierarchy_and_escapes_reserved_chars() {
        assert_eq!(encode_ref("feat/github-tabs"), "feat/github-tabs");
        assert_eq!(encode_ref("fix/a#b%c?d"), "fix/a%23b%25c%3Fd");
    }
}
