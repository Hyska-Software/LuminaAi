//! Detecção de perfil de projeto (linguagem e comandos de verificação).
//!
//! Ordem fixa de detecção: Node (`package.json`) → Rust (`Cargo.toml`) → Python
//! (`pyproject.toml`/`setup.py`) → Go (`go.mod`) → .NET (`*.csproj`) → desconhecido.
//! Os checks só aparecem quando o script/ferramenta correspondente existe no manifesto.

#![allow(dead_code)]

use std::path::Path;

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
}

impl ProjectProfile {
    fn unknown() -> Self {
        Self {
            kind: "unknown".to_string(),
            name: None,
            checks: Vec::new(),
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

/// Detecta o perfil do projeto na raiz do workspace. Nunca falha: retorna `unknown`.
pub fn detect(root: &Path) -> ProjectProfile {
    if !root.is_dir() {
        return ProjectProfile::unknown();
    }
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
    }

    #[test]
    fn detects_python_go_and_dotnet() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(
            temp.path().join("pyproject.toml"),
            "[project]\nname = \"meu-pacote\"\n",
        )
        .expect("pyproject");
        assert_eq!(detect(temp.path()).kind, "python");

        let go = tempfile::tempdir().expect("tempdir");
        fs::write(go.path().join("go.mod"), "module exemplo.com/app\n\ngo 1.22\n").expect("go.mod");
        let profile = detect(go.path());
        assert_eq!(profile.kind, "go");
        assert_eq!(profile.name.as_deref(), Some("exemplo.com/app"));

        let dotnet = tempfile::tempdir().expect("tempdir");
        fs::write(dotnet.path().join("App.csproj"), "<Project />").expect("csproj");
        let profile = detect(dotnet.path());
        assert_eq!(profile.kind, "dotnet");
        assert_eq!(profile.name.as_deref(), Some("App"));
    }

    #[test]
    fn unknown_directory() {
        let temp = tempfile::tempdir().expect("tempdir");
        let profile = detect(temp.path());
        assert_eq!(profile.kind, "unknown");
        assert!(profile.name.is_none() && profile.checks.is_empty());
    }

    #[test]
    fn missing_directory_is_unknown() {
        let temp = tempfile::tempdir().expect("tempdir");
        let profile = detect(&temp.path().join("nao-existe"));
        assert_eq!(profile.kind, "unknown");
    }
}
