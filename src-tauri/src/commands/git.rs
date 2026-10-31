//! Comandos de git do painel Alterações (harness de código).
//!
//! Todo acesso usa o `git` CLI do usuário via [`crate::workspace::exec`] —
//! sem libgit2. Operações de leitura (status/diff/log) são livres; mutações
//! (stage/unstage/discard/commit/switch) são ações explícitas do usuário no
//! painel (`WORKBENCH.md` §7.2) e nunca são chamadas pelo modelo.
//!
//! Contrato: `docs/goals/code-harness/HARNESS.md` §9.

use std::path::PathBuf;
use std::time::Duration;

use tauri::State;
use tokio_util::sync::CancellationToken;

use crate::domain::{
    WorkspaceCommitDetail, WorkspaceCommitFile, WorkspaceGitCommit, WorkspaceGitFile,
    WorkspaceGitStatus,
};
use crate::state::AppState;
use crate::workspace::exec::{self, ExecRequest};

use super::workspace::workspace_path;

/// Saída máxima de um comando git (diff grande é truncado com aviso).
const GIT_OUTPUT_CAP: usize = 1_000_000;
/// Timeout de um comando git (rede/hooks lentos precisam de folga).
const GIT_TIMEOUT: Duration = Duration::from_secs(60);

fn map_err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// Roda um comando git no workspace e devolve o stdout.
async fn run_git(root: &PathBuf, args: &[&str]) -> Result<String, String> {
    let request = ExecRequest {
        program: "git".to_string(),
        args: args.iter().map(|arg| arg.to_string()).collect(),
        cwd: root.clone(),
        env: exec::sanitized_env(&[
            ("GIT_TERMINAL_PROMPT", "0"),
            ("GIT_OPTIONAL_LOCKS", "0"),
        ]),
        timeout: GIT_TIMEOUT,
        cancel: CancellationToken::new(),
        max_output_bytes: GIT_OUTPUT_CAP,
    };
    let output = exec::run(request, None)
        .await
        .map_err(|error| format!("{}: {}", error.code, error.message))?;
    if output.timed_out {
        return Err("git demorou demais para responder".to_string());
    }
    if output.exit_code.unwrap_or(1) != 0 {
        let detail = output.stderr.trim();
        return Err(if detail.is_empty() {
            format!("git falhou (exit {})", output.exit_code.unwrap_or(-1))
        } else {
            format!("git falhou: {detail}")
        });
    }
    Ok(output.stdout)
}

fn to_status(status: crate::workspace::git::GitStatus) -> WorkspaceGitStatus {
    WorkspaceGitStatus {
        is_repo: status.is_repo,
        root: status
            .root
            .map(|path| path.to_string_lossy().to_string()),
        branch: status.branch,
        ahead: status.ahead,
        behind: status.behind,
        staged: status
            .staged
            .into_iter()
            .map(|file| WorkspaceGitFile {
                path: file.path,
                status: file.status,
            })
            .collect(),
        unstaged: status
            .unstaged
            .into_iter()
            .map(|file| WorkspaceGitFile {
                path: file.path,
                status: file.status,
            })
            .collect(),
        untracked: status.untracked,
        conflicted: status.conflicted,
    }
}

async fn status_of(state: &AppState, workspace_id: &str) -> Result<WorkspaceGitStatus, String> {
    let root = workspace_path(state, workspace_id)?;
    Ok(to_status(crate::workspace::git::detect(&root).await))
}

#[tauri::command]
pub async fn git_status(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<WorkspaceGitStatus, String> {
    status_of(&state, &workspace_id).await
}

#[tauri::command]
pub async fn git_fetch(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<WorkspaceGitStatus, String> {
    let root = workspace_path(&state, &workspace_id)?;
    crate::workspace::git::fetch(&root).await.map_err(map_err)?;
    status_of(&state, &workspace_id).await
}

#[tauri::command]
pub async fn git_pull(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<WorkspaceGitStatus, String> {
    let root = workspace_path(&state, &workspace_id)?;
    crate::workspace::git::pull(&root).await.map_err(map_err)?;
    status_of(&state, &workspace_id).await
}

#[tauri::command]
pub async fn git_push(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<WorkspaceGitStatus, String> {
    let root = workspace_path(&state, &workspace_id)?;
    crate::workspace::git::push(&root).await.map_err(map_err)?;
    status_of(&state, &workspace_id).await
}

#[tauri::command]
pub async fn git_diff(
    state: State<'_, AppState>,
    workspace_id: String,
    paths: Option<Vec<String>>,
    staged: Option<bool>,
) -> Result<String, String> {
    let root = workspace_path(&state, &workspace_id)?;
    let paths = paths.unwrap_or_default();
    crate::workspace::git::diff(
        &root,
        &paths,
        staged.unwrap_or(false),
        3,
        GIT_OUTPUT_CAP,
    )
    .await
    .map_err(|error| format!("{}: {}", error.code, error.message))
}

#[tauri::command]
pub async fn git_stage(
    state: State<'_, AppState>,
    workspace_id: String,
    paths: Vec<String>,
) -> Result<WorkspaceGitStatus, String> {
    if paths.is_empty() {
        return Err("nenhum arquivo selecionado".to_string());
    }
    let root = workspace_path(&state, &workspace_id)?;
    crate::workspace::git::stage(&root, &paths)
        .await
        .map_err(map_err)?;
    status_of(&state, &workspace_id).await
}

#[tauri::command]
pub async fn git_unstage(
    state: State<'_, AppState>,
    workspace_id: String,
    paths: Vec<String>,
) -> Result<WorkspaceGitStatus, String> {
    if paths.is_empty() {
        return Err("nenhum arquivo selecionado".to_string());
    }
    let root = workspace_path(&state, &workspace_id)?;
    crate::workspace::git::unstage(&root, &paths)
        .await
        .map_err(map_err)?;
    status_of(&state, &workspace_id).await
}

/// Stage every pending change (`git add -A`). The UI only offers this when the
/// repository has no merge conflicts, so conflicts are never auto-resolved.
#[tauri::command]
pub async fn git_stage_all(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<WorkspaceGitStatus, String> {
    let root = workspace_path(&state, &workspace_id)?;
    crate::workspace::git::stage_all(&root)
        .await
        .map_err(map_err)?;
    status_of(&state, &workspace_id).await
}

/// Clears the whole index (`git restore --staged -- :/`).
#[tauri::command]
pub async fn git_unstage_all(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<WorkspaceGitStatus, String> {
    let root = workspace_path(&state, &workspace_id)?;
    crate::workspace::git::unstage_all(&root)
        .await
        .map_err(map_err)?;
    status_of(&state, &workspace_id).await
}

/// Descartar alterações de working tree (destrutivo; a UI confirma antes).
#[tauri::command]
pub async fn git_discard(
    state: State<'_, AppState>,
    workspace_id: String,
    paths: Vec<String>,
) -> Result<WorkspaceGitStatus, String> {
    if paths.is_empty() {
        return Err("nenhum arquivo selecionado".to_string());
    }
    let root = workspace_path(&state, &workspace_id)?;
    let mut args = vec!["restore", "--"];
    for path in &paths {
        args.push(path.as_str());
    }
    run_git(&root, &args).await?;
    status_of(&state, &workspace_id).await
}

/// Creates a commit from the working tree. `paths = None` means "Tudo": stage
/// every pending change (`git add -A`) before committing; `Some(paths)` stages
/// only those paths first.
#[tauri::command]
pub async fn git_commit(
    state: State<'_, AppState>,
    workspace_id: String,
    message: String,
    paths: Option<Vec<String>>,
) -> Result<WorkspaceGitStatus, String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("a mensagem do commit não pode ser vazia".to_string());
    }
    if trimmed.chars().count() > 4_000 {
        return Err("a mensagem do commit é longa demais".to_string());
    }
    let root = workspace_path(&state, &workspace_id)?;
    match paths {
        Some(paths) if !paths.is_empty() => {
            crate::workspace::git::stage(&root, &paths)
                .await
                .map_err(map_err)?;
        }
        Some(_) => {}
        // "Tudo" sends no explicit paths: stage the whole working tree so
        // modified, new and deleted files are all included in the commit.
        None => {
            crate::workspace::git::stage_all(&root)
                .await
                .map_err(map_err)?;
        }
    }
    crate::workspace::git::commit(&root, trimmed)
        .await
        .map_err(map_err)?;
    status_of(&state, &workspace_id).await
}

#[tauri::command]
pub async fn git_branches(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<serde_json::Value, String> {
    let root = workspace_path(&state, &workspace_id)?;
    let branches = crate::workspace::git::branches(&root)
        .await
        .map_err(map_err)?;
    let current = crate::workspace::git::detect(&root).await.branch;
    Ok(serde_json::json!({ "current": current, "branches": branches }))
}

#[tauri::command]
pub async fn git_switch_branch(
    state: State<'_, AppState>,
    workspace_id: String,
    branch: String,
) -> Result<WorkspaceGitStatus, String> {
    let trimmed = branch.trim();
    if trimmed.is_empty() {
        return Err("o nome da branch não pode ser vazio".to_string());
    }
    let root = workspace_path(&state, &workspace_id)?;
    run_git(&root, &["switch", trimmed]).await?;
    status_of(&state, &workspace_id).await
}

#[tauri::command]
pub async fn git_log(
    state: State<'_, AppState>,
    workspace_id: String,
    limit: Option<u32>,
) -> Result<Vec<WorkspaceGitCommit>, String> {
    let root = workspace_path(&state, &workspace_id)?;
    let limit = limit.unwrap_or(20).clamp(1, 200);
    let commits = crate::workspace::git::log(&root, limit)
        .await
        .map_err(map_err)?;
    Ok(commits
        .into_iter()
        .map(|commit| WorkspaceGitCommit {
            hash: commit.hash,
            subject: commit.subject,
            author: commit.author,
            date: commit.date,
        })
        .collect())
}

/// Metadados + arquivos/patch completo de um commit (aba de histórico do Code).
#[tauri::command]
pub async fn git_commit_detail(
    state: State<'_, AppState>,
    workspace_id: String,
    revision: String,
) -> Result<WorkspaceCommitDetail, String> {
    let root = workspace_path(&state, &workspace_id)?;
    let detail = crate::workspace::git::commit_detail(&root, &revision, GIT_OUTPUT_CAP)
        .await
        .map_err(|error| format!("{}: {}", error.code, error.message))?;
    Ok(WorkspaceCommitDetail {
        hash: detail.hash,
        author: detail.author,
        email: detail.email,
        date: detail.date,
        subject: detail.subject,
        body: detail.body,
        files: detail
            .files
            .into_iter()
            .map(|file| WorkspaceCommitFile {
                path: file.path,
                old_path: file.old_path,
                status: file.status,
                added: file.added,
                removed: file.removed,
                binary: file.binary,
                diff: file.diff,
            })
            .collect(),
        truncated: detail.truncated,
    })
}

/// Sugestão de mensagem de commit.
///
/// Usa o modelo padrão configurado (request curto, não-streaming) com o status e
/// o diff do working tree. Se o provedor falhar, cai numa heurística local
/// honesta — sugerir nunca bloqueia o commit do usuário (`HARNESS.md` §9).
#[tauri::command]
pub async fn suggest_commit_message(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<String, String> {
    let root = workspace_path(&state, &workspace_id)?;
    let status = crate::workspace::git::detect(&root).await;
    let files: Vec<String> = status
        .staged
        .iter()
        .chain(status.unstaged.iter())
        .map(|file| format!("{} {}", file.status, file.path))
        .chain(status.untracked.iter().map(|path| format!("? {path}")))
        .collect();
    if files.is_empty() {
        return Err("não há alterações para descrever".to_string());
    }

    let settings = crate::config::load_settings(&app);
    let diff = crate::workspace::git::diff(&root, &[], false, 1, 12_000)
        .await
        .unwrap_or_default();
    let user_text = format!(
        "Changed files:\n{}\n\nDiff (1-line context summary):\n{}",
        files.join("\n"),
        if diff.trim().is_empty() {
            "(no textual diff — new or binary files)".to_string()
        } else {
            diff
        }
    );
    let deps = crate::harness::HarnessDeps {
        app: Some(app.clone()),
        db: state.db.clone(),
        http: state.http.clone(),
        search_http: state.search_http.clone(),
        catalog: state.catalog.clone(),
        streamer: None,
        credential_override: None,
        refresh_override: None,
        model_source: None,
        api_key_override: None,
        data_dir: Some(state.data_dir.clone()),
        skills_roots: Some(Vec::new()),
        approvals: None,
        observed: None,
        jobs: None,
            questions: None,
            mcp: None,
    };
    let request = crate::harness::batch::BatchRequest {
        provider_id: &settings.default_provider,
        model_id: &settings.default_model,
        system_prompt: "You write concise commit messages in Brazilian Portuguese. \
                        Reply with ONLY the message, in one line, in the format \
                        `type(scope): description`, max 72 characters, imperative mood. \
                        Types: feat, fix, refactor, test, docs, chore, perf. Do not use a \
                        trailing period, quotes, Markdown or explanations.",
        user_text: &user_text,
        max_output_tokens: 200,
        temperature: Some(0.2),
    };
    match crate::harness::batch::complete_text(&deps, request).await {
        Ok(text) => {
            let line = text
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .unwrap_or("")
                .trim_matches('"')
                .trim_end_matches('.')
                .chars()
                .take(72)
                .collect::<String>();
            if line.is_empty() {
                Ok(heuristic_commit_message(&status, &files))
            } else {
                Ok(line)
            }
        }
        Err(error) => {
            eprintln!("lumina: sugestão de commit pela IA falhou, usando heurística: {error:#}");
            Ok(heuristic_commit_message(&status, &files))
        }
    }
}

/// Fallback local (sem modelo) para a sugestão de commit.
fn heuristic_commit_message(
    status: &crate::workspace::git::GitStatus,
    files: &[String],
) -> String {
    let first = files
        .first()
        .map(|entry| entry.trim_start_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '/'))
        .unwrap_or("arquivos");
    let scope = first.split(['/', ' ']).next().unwrap_or(first);
    let action = if status.untracked.len() == files.len() {
        "Adiciona"
    } else if status
        .staged
        .iter()
        .chain(status.unstaged.iter())
        .any(|file| file.status == "D")
    {
        "Remove"
    } else {
        "Atualiza"
    };
    let suffix = if files.len() > 1 {
        format!(" e mais {} arquivo(s)", files.len() - 1)
    } else {
        String::new()
    };
    format!("{action} {scope}{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_git_status_into_ipc_dto() {
        let status = crate::workspace::git::GitStatus {
            is_repo: true,
            root: Some(PathBuf::from("C:/repo")),
            branch: Some("main".to_string()),
            ahead: 2,
            behind: 1,
            staged: vec![crate::workspace::git::GitFile {
                path: "src/a.ts".to_string(),
                status: "M".to_string(),
            }],
            unstaged: Vec::new(),
            untracked: vec!["novo.md".to_string()],
            conflicted: Vec::new(),
        };
        let dto = to_status(status);
        assert!(dto.is_repo);
        assert_eq!(dto.branch.as_deref(), Some("main"));
        assert_eq!(dto.staged.len(), 1);
        assert_eq!(dto.untracked, vec!["novo.md".to_string()]);
    }
}
