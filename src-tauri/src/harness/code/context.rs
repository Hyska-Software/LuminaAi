//! Contexto do turno do perfil Code: workspace, git, projeto, instruções
//! (`AGENTS.md`), árvore resumida e estado da sessão (plano/tarefas).
//!
//! É montado **uma vez por turno** (o loop reusa) e alimenta o system prompt e
//! a política de permissões (`docs/goals/code-harness/HARNESS.md` §10.4).

use std::path::{Path, PathBuf};

use crate::db::Db;
use crate::domain::{
    Conversation, GitInfo, PermissionMode, PlanView, ProjectCheckInfo, ProjectInfo, TodoItem,
    Workspace,
};

use super::{prompt, session};

/// Limite do `AGENTS.md` injetado no prompt (mesmo racional do Codex).
const MAX_AGENTS_CHARS: usize = 32_768;
/// Limite da árvore resumida.
const MAX_TREE_CHARS: usize = 4_000;
/// Nomes de diretórios que nunca entram na árvore/prompt.
const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "out",
    ".venv",
    "venv",
    "__pycache__",
    ".idea",
    ".vscode",
    ".turbo",
    ".cache",
    "coverage",
];

/// Diretório de trabalho efetivo do turno (workspace + projeto + instruções).
#[derive(Debug, Clone, Default)]
pub struct CodeTurnContext {
    pub workspace_id: Option<String>,
    pub workspace: Option<Workspace>,
    pub root: Option<PathBuf>,
    pub trusted: bool,
    pub permission_mode: PermissionMode,
    pub git: Option<GitInfo>,
    pub project: Option<crate::workspace::project::ProjectProfile>,
    pub agents_md: Option<String>,
    pub tree: Option<String>,
    pub todos: Vec<TodoItem>,
    pub plan: Option<PlanView>,
    pub plan_mode: bool,
}

impl CodeTurnContext {
    /// Contexto de prompt (tipos do módulo `prompt`).
    pub fn prompt_context(&self) -> prompt::CodeContext {
        prompt::CodeContext {
            workspace_name: self.workspace.as_ref().map(|workspace| workspace.name.clone()),
            workspace_path: self.root.as_ref().map(|root| root.to_string_lossy().to_string()),
            git: self.git.clone(),
            project: self.project.as_ref().map(project_info),
            agents_md: self.agents_md.clone(),
            tree: self.tree.clone(),
            todos: self.todos.clone(),
            plan: self.plan.clone(),
            plan_mode: self.plan_mode,
            permission_mode: self.permission_mode,
        }
    }

    /// Handle entregue às tools que exigem workspace.
    pub fn workspace_handle(&self) -> Option<crate::tools::registry::WorkspaceHandle> {
        let root = self.root.clone()?;
        Some(crate::tools::registry::WorkspaceHandle {
            root,
            trusted: self.trusted,
            permission_mode: self.permission_mode,
        })
    }
}

fn project_info(profile: &crate::workspace::project::ProjectProfile) -> ProjectInfo {
    ProjectInfo {
        kind: profile.kind.clone(),
        name: profile.name.clone(),
        checks: profile
            .checks
            .iter()
            .map(|check| ProjectCheckInfo {
                id: check.id.clone(),
                label: check.label.clone(),
                command: check.command.clone(),
            })
            .collect(),
    }
}

/// Monta o contexto do turno a partir do banco e do disco.
pub async fn build(db: &Db, conversation: &Conversation, allow_parallel_todos: bool) -> CodeTurnContext {
    let mut context = CodeTurnContext {
        workspace_id: conversation.workspace_id.clone(),
        permission_mode: conversation.permission_mode,
        todos: session::todos(db, &conversation.id),
        plan: session::plan_view(db, &conversation.id),
        plan_mode: session::plan_mode_active(db, &conversation.id),
        ..Default::default()
    };
    let _ = allow_parallel_todos;

    let Some(workspace_id) = conversation.workspace_id.as_deref() else {
        return context;
    };
    let Ok(Some(workspace)) = db.get_workspace(workspace_id) else {
        return context;
    };
    let root = PathBuf::from(&workspace.path);
    context.trusted = workspace.trusted;
    if !root.is_dir() {
        context.workspace = Some(workspace);
        return context;
    }
    context.git = git_info(&root).await;
    context.project = Some(crate::workspace::project::detect(&root));
    context.agents_md = read_agents_md(&root);
    context.tree = tree_summary(&root);
    context.workspace = Some(workspace);
    context.root = Some(root);
    context
}

async fn git_info(root: &Path) -> Option<GitInfo> {
    let status = crate::workspace::git::detect(root).await;
    if !status.is_repo {
        return None;
    }
    Some(GitInfo {
        root: status
            .root
            .as_ref()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        branch: status.branch.unwrap_or_default(),
        ahead: status.ahead,
        behind: status.behind,
        dirty: !status.staged.is_empty()
            || !status.unstaged.is_empty()
            || !status.untracked.is_empty()
            || !status.conflicted.is_empty(),
        staged: status.staged.len() as u32,
        unstaged: status.unstaged.len() as u32,
        untracked: status.untracked.len() as u32,
    })
}

/// Lê `AGENTS.md` (raiz) + `.lumina/instructions.md` quando existirem.
pub fn read_agents_md(root: &Path) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    for (relative, label) in [
        ("AGENTS.md", "AGENTS.md"),
        (".lumina/instructions.md", ".lumina/instructions.md"),
    ] {
        let path = root.join(relative);
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        parts.push(format!("<!-- {label} -->\n{}", trimmed));
    }
    if parts.is_empty() {
        return None;
    }
    let joined = parts.join("\n\n");
    if joined.chars().count() > MAX_AGENTS_CHARS {
        return Some(
            joined
                .chars()
                .take(MAX_AGENTS_CHARS)
                .collect::<String>()
                + "\n…[instruções truncadas]",
        );
    }
    Some(joined)
}

/// Resumo da árvore (2 níveis, diretórios com contagens) para o prompt.
pub fn tree_summary(root: &Path) -> Option<String> {
    fn walk(dir: &Path, depth: u32, max_depth: u32, out: &mut String, budget: &mut usize) {
        if *budget == 0 || depth > max_depth {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let mut items: Vec<(String, bool)> = entries
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') && name != ".github" && name != ".lumina" {
                    return None;
                }
                if IGNORED_DIRS.contains(&name.as_str()) {
                    return None;
                }
                let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
                Some((name, is_dir))
            })
            .collect();
        items.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
        for (name, is_dir) in items {
            if *budget == 0 {
                return;
            }
            let indent = "  ".repeat(depth as usize);
            if is_dir {
                let child = dir.join(&name);
                let (files, dirs) = count_children(&child);
                let line = format!("{indent}{name}/ ({files} arquivos, {dirs} dirs)\n");
                *budget = budget.saturating_sub(line.len());
                out.push_str(&line);
                walk(&child, depth + 1, max_depth, out, budget);
            } else {
                let line = format!("{indent}{name}\n");
                *budget = budget.saturating_sub(line.len());
                out.push_str(&line);
            }
        }
    }

    fn count_children(dir: &Path) -> (usize, usize) {
        let mut files = 0;
        let mut dirs = 0;
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if IGNORED_DIRS.contains(&name.as_str()) {
                    continue;
                }
                match entry.file_type() {
                    Ok(kind) if kind.is_dir() => dirs += 1,
                    Ok(_) => files += 1,
                    Err(_) => {}
                }
            }
        }
        (files, dirs)
    }

    let mut out = String::new();
    let mut budget = MAX_TREE_CHARS;
    walk(root, 0, 1, &mut out, &mut budget);
    if out.trim().is_empty() {
        return None;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::CONVERSATION_MODE_CODE;

    fn conversation(workspace_id: Option<String>) -> Conversation {
        Conversation {
            id: "conv-1".to_string(),
            title: "Sessão".to_string(),
            created_at: 0,
            updated_at: 0,
            pinned: false,
            provider_id: "opencode-go".to_string(),
            model_id: "deepseek-v4.1-flash".to_string(),
            message_count: 0,
            preview: None,
            mode: CONVERSATION_MODE_CODE.to_string(),
            code_linked: false,
            workspace_id,
            agent_kind: "lumina".to_string(),
            permission_mode: PermissionMode::Edit,
        }
    }

    #[tokio::test]
    async fn builds_context_without_workspace() {
        let db = Db::open_in_memory().expect("db");
        let context = build(&db, &conversation(None), false).await;
        assert!(context.workspace.is_none());
        assert!(context.prompt_context().workspace_path.is_none());
        assert!(!context.plan_mode);
    }

    #[tokio::test]
    async fn reads_agents_md_and_tree_from_disk() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("AGENTS.md"), "# Regras\n\nUse pnpm.\n").expect("agents");
        std::fs::create_dir_all(dir.path().join("src")).expect("src");
        std::fs::write(dir.path().join("src/app.ts"), "export const a = 1;\n").expect("file");
        std::fs::create_dir_all(dir.path().join("node_modules/x")).expect("node_modules");
        let db = Db::open_in_memory().expect("db");
        let workspace = db
            .create_workspace("demo", &dir.path().to_string_lossy())
            .expect("workspace");
        db.set_workspace_trusted(&workspace.id, true).expect("trust");
        let mut conv = conversation(Some(workspace.id.clone()));
        conv.mode = CONVERSATION_MODE_CODE.to_string();
        let context = build(&db, &conv, false).await;
        assert!(context.trusted);
        assert_eq!(context.permission_mode, PermissionMode::Edit);
        assert!(context.agents_md.as_deref().unwrap().contains("Use pnpm"));
        let tree = context.tree.as_deref().unwrap();
        assert!(tree.contains("src/"));
        assert!(!tree.contains("node_modules"));
        assert!(context.workspace.is_some());
    }
}
