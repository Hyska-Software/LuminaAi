//! Environment and shell hygiene for the user's PTY terminal.
//!
//! The shell must behave like one launched from the desktop: it should load
//! the system runtime and start the user's real shell. A terminal opened from
//! the app must not inherit the launcher's `LD_*`/`DYLD_*` overrides or
//! AppImage bundle paths — see [`crate::process_env`].

use std::ffi::OsStr;
#[cfg(any(unix, test))]
use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// Environment variable names that look like credentials or app internals.
const SECRET_MARKERS: &[&str] = &["API_KEY", "TOKEN", "SECRET", "PASSWORD"];

/// Whether this variable must not reach the user's shell.
pub(super) fn is_secret_or_internal(key: &OsStr) -> bool {
    let upper = key.to_string_lossy().to_ascii_uppercase();
    upper.starts_with("LUMINA_") || SECRET_MARKERS.iter().any(|marker| upper.contains(marker))
}

/// Builds the exact environment handed to the PTY shell.
///
/// Secrets and internal markers are dropped (existing behaviour), loader and
/// AppImage variables are removed by [`crate::process_env::clean_value`], and
/// a missing/empty `PATH` falls back to the system path so the shell can run
/// basic commands.
///
/// Windows keeps the original `CommandBuilder` base environment (the loader
/// variables do not exist there), so in production this is Unix-only.
#[cfg(any(unix, test))]
pub(super) fn sanitized_env<I>(vars: I, appdir: Option<&Path>) -> Vec<(OsString, OsString)>
where
    I: IntoIterator<Item = (OsString, OsString)>,
{
    let mut out = Vec::new();
    let mut has_path = false;

    for (key, value) in vars {
        if is_secret_or_internal(&key) {
            continue;
        }
        let is_path = key.to_string_lossy().eq_ignore_ascii_case("PATH");
        let cleaned = crate::process_env::clean_value(&key, value, appdir);
        if is_path && cleaned.is_some() {
            has_path = true;
        }
        if let Some(value) = cleaned {
            out.push((key, value));
        }
    }

    if !has_path {
        out.push((OsString::from("PATH"), crate::process_env::default_path()));
    }
    out
}

/// Resolves the shell used by the terminal.
///
/// Order: `$SHELL` (when absolute and executable), the passwd database entry,
/// then platform defaults. This keeps a stale `SHELL` (deleted shell, path
/// from another container, wrapper script) from making the terminal unusable.
pub(super) fn shell_program() -> PathBuf {
    #[cfg(unix)]
    let candidates = {
        let mut candidates = Vec::new();
        if let Some(shell) = std::env::var_os("SHELL") {
            let shell = PathBuf::from(shell);
            // A bundled shell would need the bundle runtime that we just
            // removed from the child environment; prefer the passwd shell.
            let in_bundle =
                crate::process_env::appdir().is_some_and(|appdir| shell.starts_with(&appdir));
            if !in_bundle {
                candidates.push(shell);
            }
        }
        candidates.push(login_shell());

        #[cfg(target_os = "macos")]
        candidates.extend(
            ["/bin/zsh", "/bin/bash", "/bin/sh"]
                .into_iter()
                .map(PathBuf::from),
        );
        #[cfg(all(unix, not(target_os = "macos")))]
        candidates.extend(
            ["/bin/bash", "/usr/bin/bash", "/bin/sh", "/usr/bin/sh"]
                .into_iter()
                .map(PathBuf::from),
        );
        candidates
    };

    #[cfg(windows)]
    let candidates = {
        let mut candidates = Vec::new();
        if let Some(path) = crate::workspace::exec::find_executable("pwsh") {
            candidates.push(path);
        }
        if let Some(path) = crate::workspace::exec::find_executable("powershell") {
            candidates.push(path);
        }
        if let Some(path) = std::env::var_os("ComSpec") {
            candidates.push(PathBuf::from(path));
        }
        if let Some(path) = crate::workspace::exec::find_executable("cmd") {
            candidates.push(path);
        }
        candidates
    };

    pick_shell(candidates, is_executable)
}

#[cfg(unix)]
fn login_shell() -> PathBuf {
    // `portable-pty` reads the passwd entry (not the inherited `$SHELL`) and
    // validates execute permission. It falls back to `/bin/sh` itself.
    PathBuf::from(portable_pty::CommandBuilder::new("sh").get_shell())
}

/// macOS terminals start login shells so `/etc/zprofile`/`path_helper` run and
/// GUI-launched apps see the user's PATH. Only known-compatible shells get the
/// flag; unknown shells are spawned as before.
#[cfg(target_os = "macos")]
pub(super) fn login_args(shell: &Path) -> &'static [&'static str] {
    let name = shell
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or_default();
    if ["zsh", "bash", "sh", "dash", "ksh", "tcsh", "csh", "fish"].contains(&name) {
        &["-l"]
    } else {
        &[]
    }
}

fn pick_shell(
    candidates: impl IntoIterator<Item = PathBuf>,
    is_executable: impl Fn(&Path) -> bool,
) -> PathBuf {
    for candidate in candidates {
        if candidate.is_absolute() && is_executable(&candidate) {
            return candidate;
        }
    }

    #[cfg(unix)]
    {
        PathBuf::from("/bin/sh")
    }
    #[cfg(windows)]
    {
        PathBuf::from("cmd.exe")
    }
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    std::fs::metadata(path)
        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn os(value: &str) -> OsString {
        OsString::from(value)
    }

    fn test_appdir() -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(r"C:\tmp\app")
        } else {
            PathBuf::from("/tmp/app")
        }
    }

    fn keys(env: &[(OsString, OsString)]) -> Vec<String> {
        env.iter()
            .map(|(key, _)| key.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn keeps_the_user_environment_but_drops_secrets_and_loader_overrides() {
        let env = vec![
            (os("PATH"), os("/usr/bin:/bin")),
            (os("HOME"), os("/home/user")),
            (os("OPENAI_API_KEY"), os("sk-1")),
            (os("GH_TOKEN"), os("ghp")),
            (os("DB_PASSWORD"), os("pw")),
            (os("LUMINA_INTERNAL"), os("x")),
            (os("LD_LIBRARY_PATH"), os("/opt/conda/lib")),
            (os("DYLD_INSERT_LIBRARIES"), os("/tmp/inject.dylib")),
            (os("SHELLOPTS"), os("errexit:nounset")),
            (os("BASH_ENV"), os("/tmp/launcher.sh")),
            (os("TERM"), os("dumb")),
        ];

        let clean = sanitized_env(env, None);
        let keys = keys(&clean);
        assert!(keys.contains(&"PATH".to_string()));
        assert!(keys.contains(&"HOME".to_string()));
        assert!(keys.contains(&"TERM".to_string()));
        assert!(!keys.iter().any(|key| key == "OPENAI_API_KEY"));
        assert!(!keys.iter().any(|key| key == "GH_TOKEN"));
        assert!(!keys.iter().any(|key| key == "DB_PASSWORD"));
        assert!(!keys.iter().any(|key| key == "LUMINA_INTERNAL"));
        assert!(!keys.iter().any(|key| key == "LD_LIBRARY_PATH"));
        assert!(!keys.iter().any(|key| key == "DYLD_INSERT_LIBRARIES"));
        assert!(!keys.iter().any(|key| key == "SHELLOPTS"));
        assert!(!keys.iter().any(|key| key == "BASH_ENV"));
    }

    #[test]
    fn adds_a_default_path_when_the_parent_has_none() {
        let clean = sanitized_env(vec![(os("HOME"), os("/home/user"))], None);
        let path = clean
            .iter()
            .find(|(key, _)| key.to_string_lossy() == "PATH")
            .map(|(_, value)| value.clone())
            .expect("PATH");
        assert_eq!(path, crate::process_env::default_path());
    }

    #[test]
    fn drops_appimage_paths_from_the_terminal_environment() {
        let appdir = test_appdir();
        let path = std::env::join_paths([appdir.join("usr/bin"), PathBuf::from("/usr/bin")])
            .expect("valid path list");
        let env = vec![
            (os("APPDIR"), appdir.as_os_str().to_owned()),
            (os("PATH"), path),
            (
                os("LD_LIBRARY_PATH"),
                appdir.join("usr/lib").into_os_string(),
            ),
        ];

        let clean = sanitized_env(env, Some(&appdir));
        let keys = keys(&clean);
        assert!(!keys.iter().any(|key| key == "APPDIR"));
        assert!(!keys.iter().any(|key| key == "LD_LIBRARY_PATH"));

        let path = clean
            .iter()
            .find(|(key, _)| key.to_string_lossy() == "PATH")
            .map(|(_, value)| value)
            .expect("PATH");
        let entries: Vec<PathBuf> = std::env::split_paths(path).collect();
        assert_eq!(entries, vec![PathBuf::from("/usr/bin")]);
    }

    #[test]
    fn picks_the_first_executable_absolute_shell() {
        let relative = PathBuf::from("bash");
        let missing = PathBuf::from(if cfg!(windows) {
            r"C:\nope\pwsh.exe"
        } else {
            "/nope/zsh"
        });
        let valid = PathBuf::from(if cfg!(windows) {
            r"C:\Windows\System32\cmd.exe"
        } else {
            "/bin/zsh"
        });

        let chosen = pick_shell(vec![relative, missing, valid.clone()], |path| path == valid);
        assert_eq!(chosen, valid);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_known_shells_start_as_login_shells() {
        for shell in ["/bin/zsh", "/bin/bash", "/bin/sh", "/opt/homebrew/bin/fish"] {
            assert_eq!(login_args(Path::new(shell)), &["-l"], "{shell}");
        }
        assert!(login_args(Path::new("/opt/custom/myshell")).is_empty());
    }

    #[test]
    fn falls_back_when_no_shell_candidate_is_executable() {
        let fallback = pick_shell(vec![PathBuf::from("/definitely/not/a/shell")], |_| false);
        #[cfg(unix)]
        assert_eq!(fallback, PathBuf::from("/bin/sh"));
        #[cfg(windows)]
        assert_eq!(fallback, PathBuf::from("cmd.exe"));
    }
}
