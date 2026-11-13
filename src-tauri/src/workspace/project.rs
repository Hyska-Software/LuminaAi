//! Detecção de perfil de projeto (linguagem e comandos de verificação).
//!
//! Ordem fixa de detecção: Node (`package.json`) → Rust (`Cargo.toml`) → Python
//! (`pyproject.toml`/`setup.py`) → Go (`go.mod`) → .NET (`*.csproj`) → desconhecido.
//! Os checks só aparecem quando o script/ferramenta correspondente existe no manifesto.

#![allow(dead_code)]

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// Comando sugerido de verificação (test/lint/build).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectCheck {
    /// Identificador estável (ex.: `npm:test`, `cargo:build`).
    pub id: String,
    /// Rótulo para a UI (ex.: "npm run test").
    pub label: String,
    /// Linha de comando executável no workspace.
    pub command: String,
}

/// Perfil detectado do workspace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectProfile {
    /// node | rust | python | go | dotnet | unknown.
    pub kind: String,
    pub name: Option<String>,
    pub checks: Vec<ProjectCheck>,
    /// Ecossistemas com pelo menos um check detectado, incluindo manifestos
    /// aninhados (ex.: `src-tauri/Cargo.toml` num workspace Tauri). O
    /// completion gate exige um check aprovado para cada ecossistema alterado.
    pub checked_ecosystems: Vec<String>,
}

impl ProjectProfile {
    fn unknown() -> Self {
        Self {
            kind: "unknown".to_string(),
            name: None,
            checks: Vec::new(),
            checked_ecosystems: Vec::new(),
        }
    }
}

fn check(id: &str, label: &str, command: &str) -> ProjectCheck {
    ProjectCheck {
        id: id.to_string(),
        label: label.to_string(),
        command: command.to_string(),
    }
}

/// Maps a check id prefix to the ecosystem it verifies. Used both by the UI
/// projection and by the completion gate receipts.
pub fn ecosystem_for_check_id(id: &str) -> Option<&'static str> {
    match id.split(':').next().unwrap_or_default() {
        "npm" | "pnpm" | "yarn" | "bun" => Some("node"),
        "cargo" => Some("rust"),
        "python" => Some("python"),
        "go" => Some("go"),
        "dotnet" => Some("dotnet"),
        _ => None,
    }
}

/// Detecta o perfil do projeto na raiz do workspace. Nunca falha: retorna `unknown`.
///
/// O `kind`/`name`/`checks` continuam sendo os do manifesto raiz (contrato da
/// UI). `checked_ecosystems` soma os manifestos aninhados (até 2 níveis, sem
/// `node_modules`/`target`/etc.) para que um monorepo como um app Tauri exija
/// verificação de Node **e** Rust.
pub fn detect(root: &Path) -> ProjectProfile {
    if !root.is_dir() {
        return ProjectProfile::unknown();
    }
    let mut profile = detect_root(root);
    profile.checked_ecosystems = checked_ecosystems(root, &profile);
    profile
}

fn detect_root(root: &Path) -> ProjectProfile {
    if let Some(profile) = detect_node(root) {
        return profile;
    }
    if let Some(profile) = detect_rust(root) {
        return profile;
    }
    if let Some(profile) = detect_python(root) {
        return profile;
    }
    if let Some(profile) = detect_go(root) {
        return profile;
    }
    if let Some(profile) = detect_dotnet(root) {
        return profile;
    }
    ProjectProfile::unknown()
}

fn checked_ecosystems(root: &Path, root_profile: &ProjectProfile) -> Vec<String> {
    let mut ecosystems: BTreeSet<&'static str> = root_profile
        .checks
        .iter()
        .filter_map(|check| ecosystem_for_check_id(&check.id))
        .collect();
    for profile in nested_profiles(root) {
        ecosystems.extend(
            profile
                .checks
                .iter()
                .filter_map(|check| ecosystem_for_check_id(&check.id)),
        );
    }
    ecosystems.into_iter().map(str::to_string).collect()
}

fn nested_profiles(root: &Path) -> Vec<ProjectProfile> {
    const MAX_DEPTH: u32 = 2;
    const MAX_DIRS: usize = 256;

    let mut profiles = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0u32)];
    let mut visited = 0usize;
    while let Some((dir, depth)) = stack.pop() {
        if depth > 0 {
            profiles.extend(detect_all_at(&dir));
        }
        if depth >= MAX_DEPTH {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut children: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_type()
                    .map(|kind| kind.is_dir() && !kind.is_symlink())
                    .unwrap_or(false)
            })
            .map(|entry| entry.path())
            .filter(|path| !is_ignored_dir(path))
            .collect();
        children.sort();
        for child in children {
            if visited >= MAX_DIRS {
                break;
            }
            visited += 1;
            stack.push((child, depth + 1));
        }
    }
    profiles
}

fn detect_all_at(dir: &Path) -> Vec<ProjectProfile> {
    [
        detect_node(dir),
        detect_rust(dir),
        detect_python(dir),
        detect_go(dir),
        detect_dotnet(dir),
    ]
    .into_iter()
    .flatten()
    .collect()
}

fn is_ignored_dir(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return true;
    };
    let name = name.to_ascii_lowercase();
    name.starts_with('.')
        || matches!(
            name.as_str(),
            "node_modules"
                | "target"
                | "dist"
                | "build"
                | "out"
                | "coverage"
                | "vendor"
                | "venv"
                | "__pycache__"
                | "bin"
                | "obj"
                | "tmp"
                | "temp"
        )
}

fn detect_node(root: &Path) -> Option<ProjectProfile> {
    let manifest = root.join("package.json");
    if !manifest.is_file() {
        return None;
    }
    let parsed = std::fs::read_to_string(&manifest)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
    let name = parsed
        .as_ref()
        .and_then(|value| value.get("name"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let scripts = parsed
        .as_ref()
        .and_then(|value| value.get("scripts"))
        .and_then(serde_json::Value::as_object);
    let mut checks = Vec::new();
    for script in ["test", "lint", "build", "typecheck"] {
        let exists = scripts.is_some_and(|scripts| scripts.contains_key(script));
        if exists {
            checks.push(check(
                &format!("npm:{script}"),
                &format!("npm run {script}"),
                &format!("npm run {script}"),
            ));
        }
    }
    Some(ProjectProfile {
        kind: "node".to_string(),
        name,
        checks,
        checked_ecosystems: Vec::new(),
    })
}

fn detect_rust(root: &Path) -> Option<ProjectProfile> {
    let manifest = root.join("Cargo.toml");
    if !manifest.is_file() {
        return None;
    }
    let raw = std::fs::read_to_string(&manifest).ok();
    let name = raw.as_deref().and_then(|raw| first_quoted_value(raw, "name"));
    Some(ProjectProfile {
        kind: "rust".to_string(),
        name,
        checks: vec![
            check("cargo:test", "cargo test", "cargo test"),
            check("cargo:build", "cargo build", "cargo build"),
            check(
                "cargo:clippy",
                "cargo clippy --all-targets",
                "cargo clippy --all-targets",
            ),
        ],
        checked_ecosystems: Vec::new(),
    })
}

fn detect_python(root: &Path) -> Option<ProjectProfile> {
    let pyproject = root.join("pyproject.toml");
    let setup = root.join("setup.py");
    if !pyproject.is_file() && !setup.is_file() {
        return None;
    }
    let name = std::fs::read_to_string(&pyproject)
        .ok()
        .and_then(|raw| first_quoted_value(&raw, "name"));
    Some(ProjectProfile {
        kind: "python".to_string(),
        name,
        checks: vec![
            check("python:test", "pytest -q", "pytest -q"),
            check("python:lint", "ruff check .", "ruff check ."),
        ],
        checked_ecosystems: Vec::new(),
    })
}

fn detect_go(root: &Path) -> Option<ProjectProfile> {
    let manifest = root.join("go.mod");
    if !manifest.is_file() {
        return None;
    }
    let name = std::fs::read_to_string(&manifest).ok().and_then(|raw| {
        raw.lines()
            .find_map(|line| line.trim().strip_prefix("module ").map(str::to_string))
    });
    Some(ProjectProfile {
        kind: "go".to_string(),
        name,
        checks: vec![
            check("go:test", "go test ./...", "go test ./..."),
            check("go:build", "go build ./...", "go build ./..."),
            check("go:vet", "go vet ./...", "go vet ./..."),
        ],
        checked_ecosystems: Vec::new(),
    })
}

fn detect_dotnet(root: &Path) -> Option<ProjectProfile> {
    let mut projects: Vec<std::path::PathBuf> = std::fs::read_dir(root)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("csproj"))
        })
        .collect();
    projects.sort();
    let project = projects.first()?;
    let name = project
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned());
    Some(ProjectProfile {
        kind: "dotnet".to_string(),
        name,
        checks: vec![
            check("dotnet:test", "dotnet test", "dotnet test"),
            check("dotnet:build", "dotnet build", "dotnet build"),
        ],
        checked_ecosystems: Vec::new(),
    })
}

/// Primeiro `name = "<valor>"` de um manifesto (aceita `name = 'valor'`).
fn first_quoted_value(raw: &str, key: &str) -> Option<String> {
    for line in raw.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix(key) else {
            continue;
        };
        let Some(rest) = rest.trim_start().strip_prefix('=') else {
            continue;
        };
        let rest = rest.trim();
        if let Some(value) = rest
            .strip_prefix('"')
            .and_then(|rest| rest.split('"').next())
        {
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
        if let Some(value) = rest
            .strip_prefix('\'')
            .and_then(|rest| rest.split('\'').next())
        {
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

/* ------------------------------------------------------------------ */
/* Testes                                                              */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn detects_node_project_with_scripts() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(
            temp.path().join("package.json"),
            r#"{"name":"zylara-web","scripts":{"test":"vitest","lint":"eslint .","build":"vite build"}}"#,
        )
        .expect("package.json");
        let profile = detect(temp.path());
        assert_eq!(profile.kind, "node");
        assert_eq!(profile.name.as_deref(), Some("zylara-web"));
        let ids: Vec<&str> = profile.checks.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["npm:test", "npm:lint", "npm:build"]);
        assert_eq!(profile.checks[0].command, "npm run test");
        assert_eq!(profile.checked_ecosystems, vec!["node"]);
    }

    #[test]
    fn node_without_scripts_has_no_checks() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(
            temp.path().join("package.json"),
            r#"{"name":"vazio"}"#,
        )
        .expect("package.json");
        let profile = detect(temp.path());
        assert_eq!(profile.kind, "node");
        assert!(profile.checks.is_empty());
        assert!(profile.checked_ecosystems.is_empty());
    }

    #[test]
    fn detects_rust_project() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(
            temp.path().join("Cargo.toml"),
            "[package]\nname = \"zylara\"\nversion = \"0.1.0\"\n",
        )
        .expect("Cargo.toml");
        let profile = detect(temp.path());
        assert_eq!(profile.kind, "rust");
        assert_eq!(profile.name.as_deref(), Some("zylara"));
        assert!(profile.checks.iter().any(|c| c.id == "cargo:test"));
        assert_eq!(profile.checked_ecosystems, vec!["rust"]);
    }

    #[test]
    fn detects_nested_manifest_ecosystems_for_monorepos() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(
            temp.path().join("package.json"),
            r#"{"name":"app","scripts":{"test":"vitest","typecheck":"tsc --noEmit"}}"#,
        )
        .expect("package.json");
        let backend = temp.path().join("src-tauri");
        fs::create_dir_all(&backend).expect("src-tauri");
        fs::write(
            backend.join("Cargo.toml"),
            "[package]\nname = \"app-backend\"\nversion = \"0.1.0\"\n",
        )
        .expect("Cargo.toml");
        let web = temp.path().join("packages").join("web");
        fs::create_dir_all(&web).expect("packages/web");
        fs::write(
            web.join("package.json"),
            r#"{"name":"web","scripts":{"test":"vitest"}}"#,
        )
        .expect("web package.json");

        let profile = detect(temp.path());
        // The root manifest still defines the UI-facing kind/checks.
        assert_eq!(profile.kind, "node");
        assert_eq!(profile.checked_ecosystems, vec!["node", "rust"]);
    }

    #[test]
    fn nested_manifests_inside_ignored_directories_are_skipped() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(
            temp.path().join("package.json"),
            r#"{"name":"app","scripts":{"test":"vitest"}}"#,
        )
        .expect("package.json");
        let vendored = temp.path().join("node_modules").join("dep");
        fs::create_dir_all(&vendored).expect("node_modules/dep");
        fs::write(
            vendored.join("Cargo.toml"),
            "[package]\nname = \"dep\"\n",
        )
        .expect("Cargo.toml");

        let profile = detect(temp.path());
        assert_eq!(profile.checked_ecosystems, vec!["node"]);
    }

    #[test]
    fn check_ids_map_to_ecosystems() {
        for (id, expected) in [
            ("npm:test", Some("node")),
            ("pnpm:typecheck", Some("node")),
            ("cargo:test", Some("rust")),
            ("python:test", Some("python")),
            ("go:build", Some("go")),
            ("dotnet:build", Some("dotnet")),
            ("make:test", None),
        ] {
            assert_eq!(ecosystem_for_check_id(id), expected, "{id}");
        }
    }

    #[test]
    fn detects_python_go_and_dotnet() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(
            temp.path().join("pyproject.toml"),
            "[project]\nname = \"meu-pacote\"\n",
        )
        .expect("pyproject");
        let profile = detect(temp.path());
        assert_eq!(profile.kind, "python");
        assert_eq!(profile.checked_ecosystems, vec!["python"]);

        let go = tempfile::tempdir().expect("tempdir");
        fs::write(go.path().join("go.mod"), "module exemplo.com/app\n\ngo 1.22\n").expect("go.mod");
        let profile = detect(go.path());
        assert_eq!(profile.kind, "go");
        assert_eq!(profile.name.as_deref(), Some("exemplo.com/app"));
        assert_eq!(profile.checked_ecosystems, vec!["go"]);

        let dotnet = tempfile::tempdir().expect("tempdir");
        fs::write(dotnet.path().join("App.csproj"), "<Project />").expect("csproj");
        let profile = detect(dotnet.path());
        assert_eq!(profile.kind, "dotnet");
        assert_eq!(profile.name.as_deref(), Some("App"));
        assert_eq!(profile.checked_ecosystems, vec!["dotnet"]);
    }

    #[test]
    fn unknown_directory() {
        let temp = tempfile::tempdir().expect("tempdir");
        let profile = detect(temp.path());
        assert_eq!(profile.kind, "unknown");
        assert!(profile.name.is_none() && profile.checks.is_empty());
        assert!(profile.checked_ecosystems.is_empty());
    }

    #[test]
    fn missing_directory_is_unknown() {
        let temp = tempfile::tempdir().expect("tempdir");
        let profile = detect(&temp.path().join("nao-existe"));
        assert_eq!(profile.kind, "unknown");
    }
}
