//! Query construction for the PR and Issue list endpoints.
//!
//! The REST list endpoints do not support author/label/assignee filters, so the
//! `@me` and search combinations go through `/search/issues` (documented in
//! `docs/GITHUB.md`). Both produce the same renderer shape.

use crate::domain::{GitHubIssueFilter, GitHubPullRequestFilter};
use crate::github::remote::GitHubRepoRef;

pub const PER_PAGE_DEFAULT: u32 = 30;
pub const PER_PAGE_MAX: u32 = 100;
const PAGE_MAX: u32 = 1_000;
const SEARCH_TERM_MAX: usize = 200;
const PARAM_MAX: usize = 255;

/// Built request: path, ordered query pairs and echo of the paging used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListRequest {
    pub path: String,
    pub query: Vec<(String, String)>,
    pub page: u32,
    pub per_page: u32,
    /// `true` when the request goes through `/search/issues`.
    pub search: bool,
}

fn clean(value: Option<&String>, max: usize) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    let flattened = value.replace(['\n', '\r'], " ");
    Some(flattened.chars().take(max).collect())
}

/// Strips quotes so a value can be embedded in a search qualifier.
fn qualifier_value(value: &str) -> String {
    value.replace('"', "").trim().to_string()
}

fn state(value: Option<&String>) -> &'static str {
    match clean(value, 16).map(|value| value.to_ascii_lowercase()) {
        Some(value) if value == "closed" => "closed",
        Some(value) if value == "all" => "all",
        _ => "open",
    }
}

fn direction(value: Option<&String>) -> &'static str {
    match clean(value, 8).map(|value| value.to_ascii_lowercase()) {
        Some(value) if value == "asc" => "asc",
        _ => "desc",
    }
}

fn pr_sort(value: Option<&String>, search: bool) -> &'static str {
    match clean(value, 16).map(|value| value.to_ascii_lowercase()).as_deref() {
        Some("updated") => "updated",
        Some("comments") | Some("popularity") => "comments",
        // `long-running` only exists on the REST list endpoint.
        Some("long-running") if !search => "long-running",
        _ => "created",
    }
}

fn issue_sort(value: Option<&String>) -> &'static str {
    match clean(value, 16).map(|value| value.to_ascii_lowercase()).as_deref() {
        Some("updated") => "updated",
        Some("comments") => "comments",
        _ => "created",
    }
}

fn paging(page: Option<u32>, per_page: Option<u32>) -> (u32, u32) {
    let page = page.unwrap_or(1).clamp(1, PAGE_MAX);
    let per_page = per_page
        .unwrap_or(PER_PAGE_DEFAULT)
        .clamp(1, PER_PAGE_MAX);
    (page, per_page)
}

fn push(query: &mut Vec<(String, String)>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        query.push((key.to_string(), value));
    }
}

/// `owner:branch` — the REST endpoint requires the fork owner prefix.
fn head_qualifier(repo: &GitHubRepoRef, head: &str) -> String {
    if head.contains(':') {
        head.to_string()
    } else {
        format!("{}:{head}", repo.owner)
    }
}

/// REST list of pull requests (`/repos/{owner}/{repo}/pulls`).
pub fn pull_requests(repo: &GitHubRepoRef, filter: &GitHubPullRequestFilter) -> ListRequest {
    let state = state(filter.state.as_ref());
    let search_term = clean(filter.search.as_ref(), SEARCH_TERM_MAX);
    let label = clean(filter.label.as_ref(), PARAM_MAX);
    let author = clean(filter.author.as_ref(), PARAM_MAX);
    let assignee = clean(filter.assignee.as_ref(), PARAM_MAX);
    let head = clean(filter.head.as_ref(), PARAM_MAX);
    let base = clean(filter.base.as_ref(), PARAM_MAX);
    let direction = direction(filter.direction.as_ref());
    let (page, per_page) = paging(filter.page, filter.per_page);

    let use_search = search_term.is_some()
        || label.is_some()
        || author.is_some()
        || assignee.is_some();

    if use_search {
        let mut terms = vec![
            format!("repo:{}", repo.full_name()),
            "is:pr".to_string(),
        ];
        if state != "all" {
            terms.push(format!("state:{state}"));
        }
        if let Some(label) = &label {
            terms.push(format!("label:\"{}\"", qualifier_value(label)));
        }
        if let Some(author) = &author {
            terms.push(format!("author:{}", qualifier_value(author)));
        }
        if let Some(assignee) = &assignee {
            terms.push(format!("assignee:{}", qualifier_value(assignee)));
        }
        if let Some(head) = &head {
            // Search takes the bare branch; `owner:branch` only works on REST.
            let branch = head.rsplit(':').next().unwrap_or(head);
            terms.push(format!("head:{}", qualifier_value(branch)));
        }
        if let Some(base) = &base {
            terms.push(format!("base:{}", qualifier_value(base)));
        }
        if let Some(text) = &search_term {
            terms.push(text.clone());
        }
        let mut query = Vec::new();
        query.push(("q".to_string(), terms.join(" ")));
        push(
            &mut query,
            "sort",
            Some(pr_sort(filter.sort.as_ref(), true).to_string()),
        );
        query.push(("order".to_string(), direction.to_string()));
        query.push(("per_page".to_string(), per_page.to_string()));
        query.push(("page".to_string(), page.to_string()));
        return ListRequest {
            path: "/search/issues".to_string(),
            query,
            page,
            per_page,
            search: true,
        };
    }

    let mut query = Vec::new();
    query.push(("state".to_string(), state.to_string()));
    push(&mut query, "head", head.map(|head| head_qualifier(repo, &head)));
    push(&mut query, "base", base);
    query.push((
        "sort".to_string(),
        pr_sort(filter.sort.as_ref(), false).to_string(),
    ));
    query.push(("direction".to_string(), direction.to_string()));
    query.push(("per_page".to_string(), per_page.to_string()));
    query.push(("page".to_string(), page.to_string()));
    ListRequest {
        path: format!("/repos/{}/pulls", repo.full_name()),
        query,
        page,
        per_page,
        search: false,
    }
}

/// REST list of issues (`/repos/{owner}/{repo}/issues`).
pub fn issues(repo: &GitHubRepoRef, filter: &GitHubIssueFilter) -> ListRequest {
    let state = state(filter.state.as_ref());
    let search_term = clean(filter.search.as_ref(), SEARCH_TERM_MAX);
    let label = clean(filter.label.as_ref(), PARAM_MAX);
    let author = clean(filter.author.as_ref(), PARAM_MAX);
    let assignee = clean(filter.assignee.as_ref(), PARAM_MAX);
    let milestone = clean(filter.milestone.as_ref(), PARAM_MAX);
    let milestone_title = clean(filter.milestone_title.as_ref(), PARAM_MAX);
    let direction = direction(filter.direction.as_ref());
    let (page, per_page) = paging(filter.page, filter.per_page);

    if search_term.is_some() || author.is_some() {
        let mut terms = vec![
            format!("repo:{}", repo.full_name()),
            "is:issue".to_string(),
        ];
        if state != "all" {
            terms.push(format!("state:{state}"));
        }
        if let Some(label) = &label {
            terms.push(format!("label:\"{}\"", qualifier_value(label)));
        }
        if let Some(author) = &author {
            terms.push(format!("author:{}", qualifier_value(author)));
        }
        if let Some(assignee) = &assignee {
            terms.push(format!("assignee:{}", qualifier_value(assignee)));
        }
        if let Some(milestone) = milestone_title.as_ref().or(milestone.as_ref()) {
            terms.push(format!("milestone:\"{}\"", qualifier_value(milestone)));
        }
        if let Some(text) = &search_term {
            terms.push(text.clone());
        }
        let mut query = Vec::new();
        query.push(("q".to_string(), terms.join(" ")));
        push(
            &mut query,
            "sort",
            Some(issue_sort(filter.sort.as_ref()).to_string()),
        );
        query.push(("order".to_string(), direction.to_string()));
        query.push(("per_page".to_string(), per_page.to_string()));
        query.push(("page".to_string(), page.to_string()));
        return ListRequest {
            path: "/search/issues".to_string(),
            query,
            page,
            per_page,
            search: true,
        };
    }

    let mut query = Vec::new();
    query.push(("state".to_string(), state.to_string()));
    push(&mut query, "labels", label);
    push(&mut query, "assignee", assignee);
    push(&mut query, "creator", author);
    push(&mut query, "milestone", milestone);
    query.push((
        "sort".to_string(),
        issue_sort(filter.sort.as_ref()).to_string(),
    ));
    query.push(("direction".to_string(), direction.to_string()));
    query.push(("per_page".to_string(), per_page.to_string()));
    query.push(("page".to_string(), page.to_string()));
    ListRequest {
        path: format!("/repos/{}/issues", repo.full_name()),
        query,
        page,
        per_page,
        search: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> GitHubRepoRef {
        GitHubRepoRef {
            host: "github.com".to_string(),
            owner: "Hyska-Software".to_string(),
            name: "ZylaraAi".to_string(),
        }
    }

    fn value<'a>(request: &'a ListRequest, key: &str) -> Option<&'a str> {
        request
            .query
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.as_str())
    }

    #[test]
    fn pull_request_defaults_use_the_rest_list() {
        let request = pull_requests(&repo(), &GitHubPullRequestFilter::default());
        assert_eq!(request.path, "/repos/Hyska-Software/ZylaraAi/pulls");
        assert!(!request.search);
        assert_eq!(value(&request, "state"), Some("open"));
        assert_eq!(value(&request, "page"), Some("1"));
        assert_eq!(value(&request, "per_page"), Some("30"));
        assert_eq!(value(&request, "sort"), Some("created"));
        assert_eq!(value(&request, "direction"), Some("desc"));
        assert_eq!(value(&request, "head"), None);
    }

    #[test]
    fn head_qualifier_gets_the_owner_prefix() {
        let request = pull_requests(
            &repo(),
            &GitHubPullRequestFilter {
                state: Some("all".to_string()),
                head: Some("feat/github-tabs".to_string()),
                per_page: Some(500),
                page: Some(0),
                ..GitHubPullRequestFilter::default()
            },
        );
        assert_eq!(
            value(&request, "head"),
            Some("Hyska-Software:feat/github-tabs")
        );
        assert_eq!(value(&request, "state"), Some("all"));
        assert_eq!(value(&request, "per_page"), Some("100"));
        assert_eq!(value(&request, "page"), Some("1"));

        let explicit = pull_requests(
            &repo(),
            &GitHubPullRequestFilter {
                head: Some("someone:main".to_string()),
                ..GitHubPullRequestFilter::default()
            },
        );
        assert_eq!(value(&explicit, "head"), Some("someone:main"));
    }

    #[test]
    fn label_and_author_switch_the_pull_requests_to_search() {
        let request = pull_requests(
            &repo(),
            &GitHubPullRequestFilter {
                state: Some("closed".to_string()),
                label: Some("bug".to_string()),
                author: Some("@me".to_string()),
                sort: Some("updated".to_string()),
                ..GitHubPullRequestFilter::default()
            },
        );
        assert_eq!(request.path, "/search/issues");
        assert!(request.search);
        let q = value(&request, "q").expect("q");
        assert!(q.contains("repo:Hyska-Software/ZylaraAi"), "{q}");
        assert!(q.contains("is:pr"), "{q}");
        assert!(q.contains("state:closed"), "{q}");
        assert!(q.contains("label:\"bug\""), "{q}");
        assert!(q.contains("author:@me"), "{q}");
        assert!(!q.contains("state:all"));
        assert_eq!(value(&request, "sort"), Some("updated"));
        assert_eq!(value(&request, "order"), Some("desc"));
    }

    #[test]
    fn head_combines_with_search_filters() {
        let request = pull_requests(
            &repo(),
            &GitHubPullRequestFilter {
                head: Some("Hyska-Software:feat/github-tabs".to_string()),
                label: Some("bug".to_string()),
                ..GitHubPullRequestFilter::default()
            },
        );
        assert_eq!(request.path, "/search/issues");
        let q = value(&request, "q").expect("q");
        assert!(q.contains("head:feat/github-tabs"), "{q}");
        assert!(!q.contains("Hyska-Software:feat"), "{q}");
        assert!(q.contains("label:\"bug\""), "{q}");
    }

    #[test]
    fn search_text_is_flattened_and_capped() {
        let long = format!("{}\nsecond line", "x".repeat(300));
        let request = pull_requests(
            &repo(),
            &GitHubPullRequestFilter {
                search: Some(long),
                ..GitHubPullRequestFilter::default()
            },
        );
        let q = value(&request, "q").expect("q");
        assert!(!q.contains('\n'));
        assert_eq!(q.chars().filter(|c| *c == 'x').count(), SEARCH_TERM_MAX);
    }

    #[test]
    fn issue_filters_use_search_only_when_needed() {
        let rest = issues(
            &repo(),
            &GitHubIssueFilter {
                state: Some("closed".to_string()),
                label: Some("bug".to_string()),
                assignee: Some("octocat".to_string()),
                milestone: Some("7".to_string()),
                ..GitHubIssueFilter::default()
            },
        );
        assert_eq!(rest.path, "/repos/Hyska-Software/ZylaraAi/issues");
        assert!(!rest.search);
        assert_eq!(value(&rest, "state"), Some("closed"));
        assert_eq!(value(&rest, "labels"), Some("bug"));
        assert_eq!(value(&rest, "assignee"), Some("octocat"));
        assert_eq!(value(&rest, "milestone"), Some("7"));

        let search = issues(
            &repo(),
            &GitHubIssueFilter {
                search: Some("crash on start".to_string()),
                milestone: Some("v1.0".to_string()),
                author: Some("@me".to_string()),
                ..GitHubIssueFilter::default()
            },
        );
        assert_eq!(search.path, "/search/issues");
        let q = value(&search, "q").expect("q");
        assert!(q.contains("is:issue"), "{q}");
        assert!(q.contains("state:open"), "{q}");
        assert!(q.contains("author:@me"), "{q}");
        assert!(q.contains("milestone:\"v1.0\""), "{q}");
        assert!(q.contains("crash on start"), "{q}");
    }

    #[test]
    fn search_uses_the_milestone_title_not_the_number() {
        let search = issues(
            &repo(),
            &GitHubIssueFilter {
                author: Some("@me".to_string()),
                milestone: Some("7".to_string()),
                milestone_title: Some("v1.0".to_string()),
                ..GitHubIssueFilter::default()
            },
        );
        let q = value(&search, "q").expect("q");
        assert!(q.contains("milestone:\"v1.0\""), "{q}");
        assert!(!q.contains("milestone:\"7\""), "{q}");
    }

    #[test]
    fn unknown_state_falls_back_to_open() {
        let request = pull_requests(
            &repo(),
            &GitHubPullRequestFilter {
                state: Some("merged".to_string()),
                ..GitHubPullRequestFilter::default()
            },
        );
        assert_eq!(value(&request, "state"), Some("open"));
    }
}
