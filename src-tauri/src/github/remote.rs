//! GitHub remote discovery.
//!
//! The PR/Issue surfaces always target the repository of the active workspace,
//! so the identity comes from the configured `git` remote instead of user input.
//! Supported forms:
//!
//! * `https://github.com/owner/repo.git` (with or without credentials)
//! * `ssh://git@github.com/owner/repo.git` (optional port)
//! * `git@github.com:owner/repo.git` (scp-like)
//!
//! Any other host is treated as GitHub Enterprise Server (`/api/v3`) except the
//! well-known public forges, which are rejected with a clear message.

/// Repository identity resolved from a remote URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubRepoRef {
    pub host: String,
    pub owner: String,
    pub name: String,
}

impl GitHubRepoRef {
    pub fn full_name(&self) -> String {
        format!("{}/{}", self.owner, self.name)
    }

    /// REST API root for this host.
    pub fn api_base(&self) -> String {
        if self.host == "github.com" {
            "https://api.github.com".to_string()
        } else {
            format!("https://{}/api/v3", self.host)
        }
    }

    /// Web root (links opened in the system browser).
    pub fn html_url(&self) -> String {
        format!("https://{}/{}", self.host, self.full_name())
    }

    /// GraphQL is only wired for github.com; GHES omits the actions that need it.
    pub fn graphql_available(&self) -> bool {
        self.host == "github.com"
    }
}

/// Public forges that are definitively not GitHub (GHES installs use private
/// hostnames, so any other host is accepted and validated by the API call).
const NON_GITHUB_HOSTS: &[&str] = &[
    "gitlab.com",
    "bitbucket.org",
    "codeberg.org",
    "gitea.com",
    "git.sr.ht",
    "dev.azure.com",
    "gitee.com",
];

fn normalize_host(raw: &str) -> Option<String> {
    let host = raw.trim().trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || host.contains('/') || host.contains(' ') {
        return None;
    }
    // Strip an optional `user@` (scp-like URLs and ssh:// with a user).
    let host = host.rsplit('@').next().unwrap_or(&host).to_string();
    Some(host)
}

fn clean_segment(raw: &str) -> Option<String> {
    let segment = raw.trim().trim_end_matches('/');
    if segment.is_empty() {
        return None;
    }
    Some(segment.trim_end_matches(".git").to_string())
}

/// Splits `owner/repo` while rejecting extra path segments.
fn split_path(path: &str) -> Option<(String, String)> {
    let path = path.trim().trim_start_matches('/').trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let mut parts = path.split('/');
    let owner = clean_segment(parts.next()?)?;
    let name = clean_segment(parts.next()?)?;
    if parts.next().is_some() {
        return None;
    }
    if owner.is_empty() || name.is_empty() {
        return None;
    }
    Some((owner, name))
}

/// Parses a remote URL into a repository reference (`None` when it is not a
/// GitHub-shaped remote or points at a known non-GitHub forge).
pub fn parse_remote_url(raw: &str) -> Option<GitHubRepoRef> {
    let value = raw.trim();
    if value.is_empty() {
        return None;
    }

    let (host, path) = if let Some((scheme, rest)) = [
        ("https", value.strip_prefix("https://")),
        ("http", value.strip_prefix("http://")),
        ("ssh", value.strip_prefix("ssh://")),
        ("git", value.strip_prefix("git://")),
    ]
    .into_iter()
    .find_map(|(scheme, rest)| rest.map(|rest| (scheme, rest)))
    {
        // Drop `user[:pass]@`.
        let rest = rest.rsplit('@').next().unwrap_or(rest);
        let (host_part, path_part) = rest.split_once('/')?;
        let host = match scheme {
            // The HTTPS port belongs to the API/web host (GHES on `:8443`).
            "https" => host_part.strip_suffix(":443").unwrap_or(host_part),
            "http" => host_part.strip_suffix(":80").unwrap_or(host_part),
            // SSH ports are transport-only; the API stays on `host`.
            _ => host_part.split(':').next().unwrap_or(host_part),
        };
        (normalize_host(host)?, path_part.to_string())
    } else if let Some((host_part, path_part)) = value.split_once(':') {
        // scp-like: `git@github.com:owner/repo.git`. Requiring a dotted host
        // (or `localhost`) keeps `file:///…` and Windows drive paths out.
        if host_part.contains('/') {
            return None;
        }
        let host = normalize_host(host_part)?;
        if host != "localhost" && !host.contains('.') {
            return None;
        }
        (host, path_part.to_string())
    } else {
        return None;
    };

    if NON_GITHUB_HOSTS.contains(&host.as_str()) {
        return None;
    }
    let (owner, name) = split_path(&path)?;
    Some(GitHubRepoRef { host, owner, name })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(host: &str, owner: &str, name: &str) -> GitHubRepoRef {
        GitHubRepoRef {
            host: host.to_string(),
            owner: owner.to_string(),
            name: name.to_string(),
        }
    }

    #[test]
    fn parses_https_and_ssh_remotes() {
        for raw in [
            "https://github.com/Hyska-Software/ZylaraAi.git",
            "https://github.com/Hyska-Software/ZylaraAi",
            "https://github.com/Hyska-Software/ZylaraAi/",
            "http://github.com/Hyska-Software/ZylaraAi.git",
            "https://token@github.com/Hyska-Software/ZylaraAi.git",
            "ssh://git@github.com/Hyska-Software/ZylaraAi.git",
            "ssh://git@github.com:22/Hyska-Software/ZylaraAi.git",
            "git@github.com:Hyska-Software/ZylaraAi.git",
            "git@github.com:Hyska-Software/ZylaraAi",
            "github.com:Hyska-Software/ZylaraAi",
        ] {
            assert_eq!(
                parse_remote_url(raw),
                Some(repo("github.com", "Hyska-Software", "ZylaraAi")),
                "{raw}"
            );
        }
    }

    #[test]
    fn parses_enterprise_hosts() {
        let parsed = parse_remote_url("git@git.acme.dev:platform/zylara.git").expect("GHES");
        assert_eq!(parsed.host, "git.acme.dev");
        assert_eq!(parsed.owner, "platform");
        assert_eq!(parsed.name, "zylara");
        assert_eq!(parsed.full_name(), "platform/zylara");
        assert_eq!(parsed.api_base(), "https://git.acme.dev/api/v3");
        assert!(!parsed.graphql_available());

        // GHES on a custom HTTPS port keeps the port in the API/web URLs.
        let port = parse_remote_url("https://ghe.acme.dev:8443/platform/zylara.git")
            .expect("GHES with port");
        assert_eq!(port.host, "ghe.acme.dev:8443");
        assert_eq!(port.api_base(), "https://ghe.acme.dev:8443/api/v3");
        assert_eq!(port.html_url(), "https://ghe.acme.dev:8443/platform/zylara");

        // SSH ports are transport-only and must not leak into the API URL.
        let ssh = parse_remote_url("ssh://git@ghe.acme.dev:2222/platform/zylara.git")
            .expect("GHES ssh");
        assert_eq!(ssh.host, "ghe.acme.dev");
        assert_eq!(
            parse_remote_url("https://github.com:443/o/r").expect("default port").host,
            "github.com"
        );

        assert_eq!(
            repo("github.com", "o", "r").api_base(),
            "https://api.github.com"
        );
        assert!(repo("github.com", "o", "r").graphql_available());
        assert_eq!(
            repo("github.com", "o", "r").html_url(),
            "https://github.com/o/r"
        );
    }

    #[test]
    fn rejects_other_forges_and_malformed_urls() {
        for raw in [
            "",
            "https://gitlab.com/o/r.git",
            "git@bitbucket.org:o/r.git",
            "https://github.com/owner",
            "https://github.com/owner/repo/tree/main",
            "file:///tmp/repo",
            "/home/user/repo",
            "https://github.com//repo",
            "owner/repo",
        ] {
            assert_eq!(parse_remote_url(raw), None, "{raw}");
        }
    }
}
