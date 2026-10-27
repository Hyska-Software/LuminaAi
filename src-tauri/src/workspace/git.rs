//! Operações de git via CLI do usuário.
//!
//! Decisão (docs/research/workspace-runtime-options.md §1): usar o `git` instalado, com
//! argv explícito, env higienizado e saída limitada. Sem libgit2/gix na v1 — hooks,
//! filtros, LFS, worktrees e configuração do usuário só o binário real reproduz.
//! Git ausente ou diretório sem repo **degrada** (`is_repo = false`), sem quebrar o harness.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio_util::sync::CancellationToken;

use super::exec::{self, ExecError, ExecOutput, ExecRequest};

const GIT_TIMEOUT: Duration = Duration::from_secs(30);
const STATUS_CAP: usize = 4 * 1024 * 1024;
const DIFF_CAP: usize = 4 * 1024 * 1024;
const TEXT_CAP: usize = 1024 * 1024;

/// Arquivo com status do git (path relativo ao root, com `/`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitFile {
    pub path: String,
    /// Código de status de um caractere (`M`, `A`, `D`, `R`, `C`, `T`, `U`…).
    pub status: String,
}

/// Estado agregado do repositório para o painel Git.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GitStatus {
    pub is_repo: bool,
    pub root: Option<PathBuf>,
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub staged: Vec<GitFile>,
    pub unstaged: Vec<GitFile>,
    pub untracked: Vec<String>,
    pub conflicted: Vec<String>,
}

/// Entrada de `git log`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitCommit {
    pub hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
}

/// Detecta repo/estado. Nunca retorna erro: fora de repo devolve `is_repo = false`.
pub async fn detect(root: &Path) -> GitStatus {
    let mut status = GitStatus::default();
    let Ok(toplevel) = run_git_checked(root, &["rev-parse", "--show-toplevel"], TEXT_CAP).await
    else {
        return status;
    };
    let toplevel = toplevel.stdout.trim();
    if toplevel.is_empty() {
        return status;
    }
    status.is_repo = true;
    status.root = Some(PathBuf::from(toplevel));

    let Ok(out) =
        run_git_checked(root, &["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"], STATUS_CAP)
            .await
    else {
        // Repo detectado mas status falhou (lock/índice): devolve o que sabemos.
        return status;
    };
    parse_status(&out.stdout, &mut status);
    status
}

/// Diff textual do working tree (ou do índice com `staged`), por path.
pub async fn diff(
    root: &Path,
    paths: &[String],
    staged: bool,
    context: u32,
    max_bytes: usize,
) -> Result<String, ExecError> {
    let unified = format!("--unified={context}");
    let mut args: Vec<&str> = vec!["diff", "--no-color", "--no-ext-diff", &unified];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    for path in paths {
        args.push(path.as_str());
    }
    let cap = if max_bytes == 0 { DIFF_CAP } else { max_bytes };
    let output = run_git_checked(root, &args, cap).await?;
    let mut text = output.stdout;
    if output.truncated {
        text.push_str("\n[diff truncado pelo limite de saída]\n");
    }
    Ok(text)
}

/// Últimos commits (mais novo primeiro).
pub async fn log(root: &Path, limit: u32) -> Result<Vec<GitCommit>, ExecError> {
    let limit = limit.clamp(1, 500);
    let count = format!("-n{limit}");
    // Campos separados por \x1f (não aparece em assunto/autor de commit realista).
    let output = run_git_checked(
        root,
        &[
            "log",
            &count,
            "--date=short",
            "--pretty=format:%H\x1f%s\x1f%an\x1f%ad",
        ],
        TEXT_CAP,
    )
    .await?;
    let mut commits = Vec::new();
    for line in output.stdout.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let mut fields = line.split('\x1f');
        let Some(hash) = fields.next() else { continue };
        let Some(subject) = fields.next() else {
            continue;
        };
        let Some(author) = fields.next() else {
            continue;
        };
        let date = fields.next().unwrap_or_default();
        commits.push(GitCommit {
            hash: hash.to_string(),
            subject: subject.to_string(),
            author: author.to_string(),
            date: date.to_string(),
        });
    }
    Ok(commits)
}

/// `git add -- <paths>`.
pub async fn stage(root: &Path, paths: &[String]) -> Result<(), ExecError> {
    let mut args: Vec<&str> = vec!["add", "--"];
    for path in paths {
        args.push(path.as_str());
    }
    run_git_checked(root, &args, TEXT_CAP).await?;
    Ok(())
}

/// `git restore --staged -- <paths>` (desfaz o staging, mantém o working tree).
pub async fn unstage(root: &Path, paths: &[String]) -> Result<(), ExecError> {
    let mut args: Vec<&str> = vec!["restore", "--staged", "--"];
    for path in paths {
        args.push(path.as_str());
    }
    run_git_checked(root, &args, TEXT_CAP).await?;
    Ok(())
}

/// `git commit -m <message>` (hooks do usuário rodam; não commita vazio).
pub async fn commit(root: &Path, message: &str) -> Result<(), ExecError> {
    let message = message.trim();
    if message.is_empty() {
        return Err(ExecError::failed("mensagem de commit obrigatória", None));
    }
    run_git_checked(root, &["commit", "-m", message], TEXT_CAP).await?;
    Ok(())
}

/// Branches locais (`git for-each-ref refs/heads`), em ordem alfabética.
pub async fn branches(root: &Path) -> Result<Vec<String>, ExecError> {
    let output = run_git_checked(
        root,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            "--sort=refname",
            "refs/heads",
        ],
        TEXT_CAP,
    )
    .await?;
    Ok(output
        .stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

fn git_request(root: &Path, args: &[&str], cap: usize) -> ExecRequest {
    let mut full_args: Vec<String> = vec![
        "-C".to_string(),
        root.to_string_lossy().into_owned(),
        "-c".to_string(),
        "core.quotepath=false".to_string(),
    ];
    full_args.extend(args.iter().map(|arg| (*arg).to_string()));
    ExecRequest {
        program: "git".to_string(),
        args: full_args,
        cwd: root.to_path_buf(),
        env: exec::sanitized_env(&[("LC_ALL", "C"), ("LANG", "C")]),
        timeout: GIT_TIMEOUT,
        cancel: CancellationToken::new(),
        max_output_bytes: cap,
    }
}

/// Roda o git e devolve a saída crua (sem exigir exit code 0).
async fn run_git_capture(
    root: &Path,
    args: &[&str],
    cap: usize,
) -> Result<ExecOutput, ExecError> {
    exec::run(git_request(root, args, cap), None).await
}

/// Roda o git exigindo exit code 0; em falha devolve `EXEC_FAILED` com stderr.
async fn run_git_checked(
    root: &Path,
    args: &[&str],
    cap: usize,
) -> Result<ExecOutput, ExecError> {
    let output = run_git_capture(root, args, cap).await?;
    if output.timed_out {
        return Err(ExecError::failed("git excedeu o tempo limite", None));
    }
    if output.cancelled {
        return Err(ExecError::failed("git cancelado", None));
    }
    if output.exit_code != Some(0) {
        let detail = output.stderr.trim();
        let detail = if detail.is_empty() {
            output.stdout.trim()
        } else {
            detail
        };
        return Err(ExecError::failed(
            format!("git {}: {}", args.first().copied().unwrap_or("?"), detail),
            output.exit_code,
        ));
    }
    Ok(output)
}

fn parse_status(raw: &str, status: &mut GitStatus) {
    let tokens: Vec<&str> = raw.split('\0').collect();
    let mut index = 0;
    while index < tokens.len() {
        let token = tokens[index];
        index += 1;
        if token.is_empty() {
            continue;
        }
        // Cabeçalhos `# ...` podem vir como um token só, com várias linhas separadas
        // por LF, ou um token por linha dependendo da versão do git — tratamos os dois.
        if token.starts_with('#') {
            for line in token.lines() {
                parse_header_line(line, status);
            }
            continue;
        }
        if let Some(rest) = token.strip_prefix("1 ") {
            if let Some((xy, path)) = parse_entry(rest, 7) {
                push_changed(status, &xy, path);
            }
            continue;
        }
        if let Some(rest) = token.strip_prefix("2 ") {
            // Rename/copy: o token seguinte (NUL-delimitado) é o path de origem.
            if let Some((xy, path)) = parse_entry(rest, 8) {
                let orig = tokens.get(index).copied().unwrap_or_default();
                index += 1;
                let file = GitFile {
                    path: path.to_string(),
                    status: rename_status(&xy, orig),
                };
                push_changed_file(status, &xy, file);
            }
            continue;
        }
        if let Some(rest) = token.strip_prefix("u ") {
            if let Some((_, path)) = parse_entry(rest, 9) {
                status.conflicted.push(path.to_string());
            }
            continue;
        }
        if let Some(path) = token.strip_prefix("? ") {
            status.untracked.push(path.to_string());
            continue;
        }
        // `! path` (ignorado) não interessa ao painel.
    }
}

fn parse_header_line(line: &str, status: &mut GitStatus) {
    let line = line.trim_end_matches('\r');
    if let Some(branch) = line.strip_prefix("# branch.head ") {
        status.branch = Some(branch.trim().to_string());
        return;
    }
    if let Some(ab) = line.strip_prefix("# branch.ab ") {
        for part in ab.split_whitespace() {
            if let Some(value) = part.strip_prefix('+') {
                status.ahead = value.parse().unwrap_or(0);
            } else if let Some(value) = part.strip_prefix('-') {
                status.behind = value.parse().unwrap_or(0);
            }
        }
    }
}

/// Extrai `(<XY>, <path>)` de uma entrada porcelain v2.
/// `fields_before_path` varia por tipo: `1` = 7, `2` = 8 (inclui score), `u` = 9.
fn parse_entry(rest: &str, fields_before_path: usize) -> Option<(String, &str)> {
    let mut fields = rest.splitn(fields_before_path + 1, ' ');
    let xy = fields.next()?;
    for _ in 1..fields_before_path {
        fields.next()?;
    }
    let path = fields.next()?;
    Some((xy.to_string(), path))
}

fn push_changed(status: &mut GitStatus, xy: &str, path: &str) {
    let file = GitFile {
        path: path.to_string(),
        status: String::new(),
    };
    push_changed_file(status, xy, file);
}

fn push_changed_file(status: &mut GitStatus, xy: &str, mut file: GitFile) {
    let mut chars = xy.chars();
    let staged = chars.next().unwrap_or('.');
    let unstaged = chars.next().unwrap_or('.');
    if staged != '.' && staged != ' ' {
        if file.status.is_empty() {
            file.status = staged.to_string();
        }
        status.staged.push(file.clone());
    }
    if unstaged != '.' && unstaged != ' ' {
        if file.status.is_empty() {
            file.status = unstaged.to_string();
        }
        status.unstaged.push(file);
    }
}

fn rename_status(xy: &str, _orig: &str) -> String {
    // XY de rename preserva R/C; expõe o caractere de maior prioridade.
    xy.chars()
        .find(|c| *c != '.' && *c != ' ')
        .map(|c| c.to_string())
        .unwrap_or_else(|| "R".to_string())
}

/* ------------------------------------------------------------------ */
/* Testes                                                              */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;

    #[cfg(windows)]
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn git_available() -> bool {
        let mut command = Command::new("git");
        command.arg("--version");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        matches!(command.output(), Ok(out) if out.status.success())
    }

    fn run_git(dir: &Path, args: &[&str]) -> bool {
        let mut command = Command::new("git");
        command.args(args).current_dir(dir);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        matches!(command.output(), Ok(out) if out.status.success())
    }

    /// Cria repo com um commit inicial. `None` quando git não está disponível.
    fn setup_repo(dir: &Path) -> Option<()> {
        if !git_available() {
            eprintln!("git ausente no PATH: teste ignorado");
            return None;
        }
        let initialized = run_git(dir, &["init", "-b", "main"]) || run_git(dir, &["init"]);
        if !initialized {
            eprintln!("git init falhou: teste ignorado");
            return None;
        }
        let _ = run_git(dir, &["config", "user.email", "teste@lumina.local"]);
        let _ = run_git(dir, &["config", "user.name", "Teste Lumina"]);
        fs::write(dir.join("a.txt"), "linha1\n").expect("escrever a.txt");
        if !run_git(dir, &["add", "."]) || !run_git(dir, &["commit", "-m", "initial commit"]) {
            eprintln!("commit inicial falhou: teste ignorado");
            return None;
        }
        Some(())
    }

    #[tokio::test]
    async fn detects_status_and_untracked() {
        let temp = tempfile::tempdir().expect("tempdir");
        if setup_repo(temp.path()).is_none() {
            return;
        }
        fs::write(temp.path().join("a.txt"), "linha1\nlinha2\n").expect("modificar a");
        fs::write(temp.path().join("b.txt"), "novo\n").expect("criar b");

        let status = detect(temp.path()).await;
        assert!(status.is_repo);
        assert!(status.root.is_some());
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert!(
            status
                .unstaged
                .iter()
                .any(|file| file.path == "a.txt" && file.status == "M"),
            "unstaged: {:?}",
            status.unstaged
        );
        assert!(
            status.untracked.iter().any(|path| path == "b.txt"),
            "untracked: {:?}",
            status.untracked
        );
        assert!(status.staged.is_empty());
        assert!(status.conflicted.is_empty());
    }

    #[tokio::test]
    async fn diff_log_stage_commit_and_branches() {
        let temp = tempfile::tempdir().expect("tempdir");
        if setup_repo(temp.path()).is_none() {
            return;
        }
        fs::write(temp.path().join("a.txt"), "linha1\nlinha2\n").expect("modificar a");
        fs::write(temp.path().join("b.txt"), "novo\n").expect("criar b");

        let diff_text = diff(temp.path(), &["a.txt".to_string()], false, 3, 0)
            .await
            .expect("diff");
        assert!(diff_text.contains("+linha2"), "diff: {diff_text}");
        assert!(diff_text.contains("--- a/a.txt") || diff_text.contains("a/a.txt"));

        let commits = log(temp.path(), 10).await.expect("log");
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].subject, "initial commit");
        assert_eq!(commits[0].hash.len(), 40);

        stage(temp.path(), &["a.txt".to_string(), "b.txt".to_string()])
            .await
            .expect("stage");
        let status = detect(temp.path()).await;
        assert!(
            status.staged.iter().any(|file| file.path == "a.txt"),
            "staged: {:?}",
            status.staged
        );
        assert!(status.staged.iter().any(|file| file.path == "b.txt"));

        unstage(temp.path(), &["b.txt".to_string()])
            .await
            .expect("unstage");
        let status = detect(temp.path()).await;
        assert!(status.staged.iter().any(|file| file.path == "a.txt"));
        assert!(status.untracked.iter().any(|path| path == "b.txt"));

        commit(temp.path(), "test: altera a").await.expect("commit");
        let commits = log(temp.path(), 10).await.expect("log");
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].subject, "test: altera a");

        let branches = branches(temp.path()).await.expect("branches");
        assert!(branches.contains(&"main".to_string()), "branches: {branches:?}");
    }

    #[tokio::test]
    async fn empty_message_is_rejected() {
        let temp = tempfile::tempdir().expect("tempdir");
        let error = commit(temp.path(), "   ").await.expect_err("deve falhar");
        assert!(error.message.contains("mensagem"));
    }

    #[tokio::test]
    async fn non_repo_is_degraded() {
        let temp = tempfile::tempdir().expect("tempdir");
        let status = detect(temp.path()).await;
        assert!(!status.is_repo);
        assert!(status.root.is_none());
        assert!(status.branch.is_none());
        assert!(status.staged.is_empty() && status.unstaged.is_empty());
    }

    #[test]
    fn parses_porcelain_v2_fixture() {
        let raw = concat!(
            "# branch.oid abc\n",
            "# branch.head main\n",
            "# branch.ab +2 -1\0",
            "1 .M N... 100644 100644 100644 hash hash a.txt\0",
            "1 M. N... 100644 100644 100644 hash hash b.txt\0",
            "2 R. N... 100644 100644 100644 hash hash R100 novo.txt\0",
            "antigo.txt\0",
            "u UU N... 100644 100644 100644 100644 hash hash hash conflito.txt\0",
            "? sem-track.txt\0",
            "! ignorado.txt\0"
        );
        let mut status = GitStatus::default();
        parse_status(raw, &mut status);
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.ahead, 2);
        assert_eq!(status.behind, 1);
        assert!(status
            .unstaged
            .iter()
            .any(|file| file.path == "a.txt" && file.status == "M"));
        assert!(status
            .staged
            .iter()
            .any(|file| file.path == "b.txt" && file.status == "M"));
        assert!(status
            .staged
            .iter()
            .any(|file| file.path == "novo.txt" && file.status == "R"));
        assert!(status.conflicted.iter().any(|path| path == "conflito.txt"));
        assert!(status.untracked.iter().any(|path| path == "sem-track.txt"));
    }
}
