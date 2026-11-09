//! Environment hygiene for child processes spawned by the app.
//!
//! A GUI app inherits the environment of whatever launched it. Launchers such
//! as conda/mamba, Nix dev shells, Steam Runtime and AppImage's `AppRun` inject
//! dynamic-loader overrides (`LD_*` / `DYLD_*`) and bundle paths. Those belong
//! to the app process only: a shell, tool or interpreter started from the app
//! must load the system runtime. Passing them through is how bash ends up
//! loading an older `libreadline` and dying before the first prompt with
//! `undefined symbol: rl_trim_arg_from_keyseq` (exit 127). Shell startup hooks
//! (`SHELLOPTS`, `BASH_ENV`, ...) and repository-location overrides
//! (`GIT_DIR`, ...) are dropped for the same reason.
//!
//! The policy functions are intentionally pure: callers pass their own
//! environment so they are testable without mutating the process environment.
//! [`appdir`] is the only convenience helper that reads it.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

/// Variables that redirect or instrument the dynamic loader.
const LOADER_VARS: &[&str] = &[
    // glibc / ld.so
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "LD_AUDIT",
    "LD_DEBUG",
    "LD_DEBUG_OUTPUT",
    "LD_PROFILE",
    "LD_PROFILE_OUTPUT",
    "LD_TRACE_LOADED_OBJECTS",
    "LD_ORIGIN_PATH",
    "LD_DYNAMIC_WEAK",
    "LD_USE_LOAD_BIAS",
    // macOS dyld
    "DYLD_LIBRARY_PATH",
    "DYLD_FALLBACK_LIBRARY_PATH",
    "DYLD_FRAMEWORK_PATH",
    "DYLD_FALLBACK_FRAMEWORK_PATH",
    "DYLD_VERSIONED_LIBRARY_PATH",
    "DYLD_VERSIONED_FRAMEWORK_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_ROOT_PATH",
    "DYLD_IMAGE_SUFFIX",
    "DYLD_SHARED_CACHE_DIR",
    "DYLD_SHARED_REGION",
    "DYLD_FORCE_FLAT_NAMESPACE",
];

/// AppImage/runtime bookkeeping that must not leak into a user shell.
const BUNDLE_VARS: &[&str] = &[
    "APPDIR",
    "APPIMAGE",
    "ARGV0",
    "OWD",
    "LD_LIBRARY_PATH_ORIG",
    "APPIMAGE_EXTRACT_AND_RUN",
    "APPIMAGE_SILENT_INSTALL",
];

/// Path-list variables whose AppImage entries would make the user shell run
/// bundle binaries or load bundle plugins built for the app's runtime.
const BUNDLE_PATH_LIST_VARS: &[&str] = &[
    "PATH",
    "XDG_DATA_DIRS",
    "XDG_CONFIG_DIRS",
    "GST_PLUGIN_PATH",
    "GST_PLUGIN_SYSTEM_PATH",
    "GI_TYPELIB_PATH",
    "GIO_EXTRA_MODULES",
    "QT_PLUGIN_PATH",
    "GTK_PATH",
    "PYTHONPATH",
];

/// Single-path variables that point at AppImage-provided files/directories.
const BUNDLE_PATH_VARS: &[&str] = &[
    "GIO_MODULE_DIR",
    "GSETTINGS_SCHEMA_DIR",
    "GDK_PIXBUF_MODULE_FILE",
    "GDK_PIXBUF_MODULEDIR",
    "GST_PLUGIN_SCANNER",
    "GST_PRESET_PATH",
    "GTK_IM_MODULE_FILE",
    "FONTCONFIG_FILE",
    "FONTCONFIG_PATH",
];

/// Shell startup hooks/options inherited from the launcher.
///
/// A shell launched with `set -eu` (or a wrapper that redirects startup files)
/// exports these; every child shell must start with its own defaults.
const SHELL_STARTUP_VARS: &[&str] = &["SHELLOPTS", "BASHOPTS", "BASH_ENV", "ENV", "CDPATH"];

/// Repository-context variables that would make git operate on the launcher's
/// repository instead of the requested workspace.
const REPO_CONTEXT_VARS: &[&str] = &[
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_NAMESPACE",
    "GIT_PREFIX",
];

#[cfg(target_os = "macos")]
const DEFAULT_PATH: &str =
    "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
#[cfg(all(unix, not(target_os = "macos")))]
const DEFAULT_PATH: &str = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
#[cfg(windows)]
const DEFAULT_PATH: &str = r"C:\Windows\System32;C:\Windows;C:\Windows\System32\Wbem";

/// Fallback PATH used when the parent environment has no usable PATH.
pub fn default_path() -> OsString {
    OsString::from(DEFAULT_PATH)
}

/// AppImage mount root (`APPDIR`) when the app runs from an AppImage.
///
/// `APPDIR` is part of the AppImage runtime contract and is always absolute.
pub fn appdir() -> Option<PathBuf> {
    let value = std::env::var_os("APPDIR")?;
    if value.is_empty() {
        return None;
    }
    let path = PathBuf::from(value);
    path.is_absolute().then_some(path)
}

/// Whether this variable belongs to the app/launcher context and must not be
/// inherited by a child process.
pub fn is_launcher_context_var(key: &OsStr) -> bool {
    let upper = key.to_string_lossy().to_ascii_uppercase();
    LOADER_VARS.iter().any(|name| *name == upper.as_str())
        || BUNDLE_VARS.iter().any(|name| *name == upper.as_str())
        || SHELL_STARTUP_VARS
            .iter()
            .any(|name| *name == upper.as_str())
        || REPO_CONTEXT_VARS.iter().any(|name| *name == upper.as_str())
}

/// Applies the app-boundary rules to one environment entry.
///
/// Returns `None` when the variable must not be inherited by a child process.
/// `PATH` that becomes empty after filtering falls back to [`default_path`].
pub fn clean_value(key: &OsStr, value: OsString, appdir: Option<&Path>) -> Option<OsString> {
    if is_launcher_context_var(key) {
        return None;
    }

    let upper = key.to_string_lossy().to_ascii_uppercase();
    if upper == "PATH"
        || (appdir.is_some()
            && BUNDLE_PATH_LIST_VARS
                .iter()
                .any(|name| *name == upper.as_str()))
    {
        return filter_path_list(&value, appdir, upper == "PATH");
    }

    let Some(appdir) = appdir else {
        return Some(value);
    };

    if BUNDLE_PATH_VARS.iter().any(|name| *name == upper.as_str())
        && Path::new(&value).starts_with(appdir)
    {
        return None;
    }

    Some(value)
}

fn filter_path_list(value: &OsStr, appdir: Option<&Path>, is_path: bool) -> Option<OsString> {
    let kept: Vec<PathBuf> = std::env::split_paths(value)
        .filter(|entry| {
            let entry = entry.as_os_str();
            // Empty entries mean "current directory" on Unix; never forward
            // them into a workspace terminal.
            !entry.is_empty() && appdir.map_or(true, |appdir| !Path::new(entry).starts_with(appdir))
        })
        .collect();

    if kept.is_empty() {
        return is_path.then(default_path);
    }

    match std::env::join_paths(kept) {
        Ok(joined) => Some(joined),
        // A path containing the separator (or otherwise invalid) would make
        // `join_paths` fail; for PATH a system fallback still boots the shell.
        Err(_) if is_path => Some(default_path()),
        Err(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_appdir() -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(r"C:\tmp\app")
        } else {
            PathBuf::from("/tmp/app")
        }
    }

    fn path_list(entries: &[PathBuf]) -> OsString {
        std::env::join_paths(entries).expect("valid path list")
    }

    #[test]
    fn drops_loader_overrides_even_without_an_appimage() {
        for key in [
            "LD_LIBRARY_PATH",
            "LD_PRELOAD",
            "LD_AUDIT",
            "LD_DEBUG",
            "LD_TRACE_LOADED_OBJECTS",
            "DYLD_LIBRARY_PATH",
            "DYLD_INSERT_LIBRARIES",
            "DYLD_FALLBACK_FRAMEWORK_PATH",
        ] {
            assert!(
                clean_value(OsStr::new(key), OsString::from("/tmp/lib"), None).is_none(),
                "`{key}` deveria ter sido removida"
            );
        }
    }

    #[test]
    fn drops_shell_startup_overrides() {
        for key in ["SHELLOPTS", "BASHOPTS", "BASH_ENV", "ENV", "CDPATH"] {
            assert!(
                clean_value(OsStr::new(key), OsString::from("value"), None).is_none(),
                "`{key}` deveria ter sido removida"
            );
        }
    }

    #[test]
    fn drops_repository_context_overrides() {
        for key in [
            "GIT_DIR",
            "GIT_WORK_TREE",
            "GIT_INDEX_FILE",
            "GIT_OBJECT_DIRECTORY",
            "GIT_NAMESPACE",
        ] {
            assert!(
                clean_value(OsStr::new(key), OsString::from("value"), None).is_none(),
                "`{key}` deveria ter sido removida"
            );
        }
    }

    #[test]
    fn drops_appimage_bookkeeping_vars() {
        for key in ["APPDIR", "APPIMAGE", "ARGV0", "OWD", "LD_LIBRARY_PATH_ORIG"] {
            assert!(
                clean_value(OsStr::new(key), OsString::from("value"), None).is_none(),
                "`{key}` deveria ter sido removida"
            );
        }
    }

    #[test]
    fn filters_appdir_entries_from_path_lists() {
        let appdir = test_appdir();
        let sibling = appdir.parent().expect("parent").join("application");
        let value = path_list(&[
            appdir.join("usr/bin"),
            PathBuf::from("/usr/bin"),
            sibling.clone(),
        ]);

        let cleaned = clean_value(OsStr::new("PATH"), value, Some(&appdir)).expect("PATH");
        let entries: Vec<PathBuf> = std::env::split_paths(&cleaned).collect();
        assert_eq!(entries, vec![PathBuf::from("/usr/bin"), sibling]);
    }

    #[test]
    fn empty_path_entries_are_dropped_while_filtering() {
        let appdir = test_appdir();
        let value = path_list(&[PathBuf::new(), PathBuf::from("/usr/bin")]);
        let cleaned = clean_value(OsStr::new("PATH"), value, Some(&appdir)).expect("PATH");
        let entries: Vec<PathBuf> = std::env::split_paths(&cleaned).collect();
        assert_eq!(entries, vec![PathBuf::from("/usr/bin")]);
    }

    #[test]
    fn empty_path_entries_are_dropped_without_an_appimage() {
        let value = path_list(&[PathBuf::new(), PathBuf::from("/usr/bin")]);
        let cleaned = clean_value(OsStr::new("PATH"), value, None).expect("PATH");
        let entries: Vec<PathBuf> = std::env::split_paths(&cleaned).collect();
        assert_eq!(entries, vec![PathBuf::from("/usr/bin")]);
    }

    #[test]
    fn empty_path_falls_back_to_the_system_path() {
        let cleaned = clean_value(OsStr::new("PATH"), OsString::new(), None).expect("PATH");
        assert_eq!(cleaned, default_path());
    }

    #[test]
    fn path_falls_back_when_every_entry_belongs_to_the_bundle() {
        let appdir = test_appdir();
        let value = path_list(&[appdir.join("usr/bin")]);
        let cleaned = clean_value(OsStr::new("PATH"), value, Some(&appdir)).expect("PATH");
        assert_eq!(cleaned, default_path());
    }

    #[test]
    fn drops_single_bundle_paths_only_inside_the_bundle() {
        let appdir = test_appdir();
        let inside = appdir.join("lib/gio/modules").into_os_string();
        assert!(
            clean_value(OsStr::new("GIO_MODULE_DIR"), inside, Some(&appdir)).is_none(),
            "caminho dentro do AppDir deveria ser removido"
        );

        let outside = if cfg!(windows) {
            OsString::from(r"C:\other")
        } else {
            OsString::from("/other")
        };
        assert!(
            clean_value(OsStr::new("GIO_MODULE_DIR"), outside, Some(&appdir)).is_some(),
            "caminho fora do AppDir deveria ser preservado"
        );
    }

    #[test]
    fn preserves_unrelated_variables() {
        assert_eq!(
            clean_value(OsStr::new("HOME"), OsString::from("/home/user"), None),
            Some(OsString::from("/home/user"))
        );
        assert_eq!(
            clean_value(
                OsStr::new("SSH_AUTH_SOCK"),
                OsString::from("/tmp/agent"),
                None
            ),
            Some(OsString::from("/tmp/agent"))
        );
    }
}
