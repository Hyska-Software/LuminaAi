//! Comandos do workspace de código (harness): abrir pasta, CRUD, árvore de
//! arquivos, busca e prévia read-only.
//!
//! Contrato: `docs/goals/code-harness/HARNESS.md` §7 e `WORKBENCH.md` §3/§7.1.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::domain::{
    Conversation, GitInfo, ProjectCheckInfo, ProjectInfo, Workspace, WorkspaceContext,
    WorkspaceFileContent, WorkspaceFileEntry,
};
use crate::state::AppState;
use crate::workspace::{project, safe_path, safe_path::Access};

/// Limite de entradas devolvidas por `list_workspace_files` (a UI avisa quando
/// trunca; o usuário refina a busca).
const MAX_TREE_ENTRIES: usize = 6_000;
/// Limite de texto devolvido pela prévia de arquivo.
const MAX_PREVIEW_BYTES: usize = 512 * 1024;
/// Limite de arquivos varridos em `search_workspace_files`.
const MAX_SEARCH_ENTRIES: usize = 20_000;

fn map_err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// Caminho absoluto canonicalizado do workspace (validado a cada comando).
pub(crate) fn workspace_path(state: &AppState, workspace_id: &str) -> Result<PathBuf, String> {
    let workspace = state
        .db
        .get_workspace(workspace_id)
        .map_err(map_err)?
        .ok_or_else(|| format!("workspace não encontrado: {workspace_id}"))?;
    let path = PathBuf::from(&workspace.path);
    if !path.is_dir() {
        return Err(format!(
            "a pasta do workspace não existe mais: {}",
            workspace.path
        ));
    }
    Ok(path)
}

/// Converte o perfil detectado para o DTO de IPC.
pub(crate) fn project_info(root: &Path) -> ProjectInfo {
    let profile = project::detect(root);
    ProjectInfo {
        kind: profile.kind,
        name: profile.name,
        checks: profile
            .checks
            .into_iter()
            .map(|check| ProjectCheckInfo {
                id: check.id,
                label: check.label,
                command: check.command,
            })
            .collect(),
    }
}

/// Complementa um workspace com git + projeto (sem persistir nada).
pub(crate) async fn enrich_workspace(root: &Path, mut workspace: Workspace) -> Workspace {
    let status = crate::workspace::git::detect(root).await;
    workspace.git = if status.is_repo {
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
    } else {
        None
    };
    workspace
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

/// Abre o seletor nativo de pasta; devolve o caminho canonicalizado.
#[tauri::command]
pub async fn pick_workspace_folder(app: AppHandle) -> Result<Option<String>, String> {
    let selected = app.dialog().file().blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|error| format!("caminho inválido: {error}"))?;
    let canonical = dunce::canonicalize(&path).unwrap_or(path);
    Ok(Some(canonical.to_string_lossy().to_string()))
}

/// Registra (ou reabre) uma pasta como workspace.
#[tauri::command]
pub async fn add_workspace(
    state: State<'_, AppState>,
    path: String,
    trusted: bool,
) -> Result<Workspace, String> {
    let raw = path.trim();
    if raw.is_empty() {
        return Err("o caminho do workspace não pode ser vazio".to_string());
    }
    let canonical = dunce::canonicalize(raw).map_err(|error| {
        format!("não foi possível abrir a pasta `{raw}`: {error}")
    })?;
    if !canonical.is_dir() {
        return Err(format!("`{raw}` não é uma pasta"));
    }
    let canonical_str = canonical.to_string_lossy().to_string();
    if let Some(existing) = state
        .db
        .find_workspace_by_path(&canonical_str)
        .map_err(map_err)?
    {
        state.db.mark_workspace_opened(&existing.id).map_err(map_err)?;
        if trusted && !existing.trusted {
            state
                .db
                .set_workspace_trusted(&existing.id, true)
                .map_err(map_err)?;
        }
        let workspace = state
            .db
            .get_workspace(&existing.id)
            .map_err(map_err)?
            .ok_or_else(|| "workspace desapareceu ao reabrir".to_string())?;
        return Ok(enrich_workspace(&canonical, workspace).await);
    }
    let name = canonical
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| canonical_str.clone());
    let workspace = state
        .db
        .create_workspace(&name, &canonical_str)
        .map_err(map_err)?;
    if trusted {
        state
            .db
            .set_workspace_trusted(&workspace.id, true)
            .map_err(map_err)?;
    }
    state
        .db
        .mark_workspace_opened(&workspace.id)
        .map_err(map_err)?;
    let workspace = state
        .db
        .get_workspace(&workspace.id)
        .map_err(map_err)?
        .ok_or_else(|| "workspace não encontrado após a criação".to_string())?;
    Ok(enrich_workspace(&canonical, workspace).await)
}

#[tauri::command]
pub async fn list_workspaces(state: State<'_, AppState>) -> Result<Vec<Workspace>, String> {
    state.db.list_workspaces().map_err(map_err)
}

/// Workspace + contexto (git/projeto) para o header do layout Code.
#[tauri::command]
pub async fn get_workspace_context(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<WorkspaceContext>, String> {
    let Some(workspace) = state.db.get_workspace(&id).map_err(map_err)? else {
        return Ok(None);
    };
    let root = PathBuf::from(&workspace.path);
    if !root.is_dir() {
        return Ok(Some(WorkspaceContext {
            workspace,
            project: None,
        }));
    }
    let workspace = enrich_workspace(&root, workspace).await;
    Ok(Some(WorkspaceContext {
        workspace,
        project: Some(project_info(&root)),
    }))
}

#[tauri::command]
pub async fn rename_workspace(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<Workspace, String> {
    let mut workspace = state
        .db
        .get_workspace(&id)
        .map_err(map_err)?
        .ok_or_else(|| format!("workspace não encontrado: {id}"))?;
    workspace.name = name.trim().to_string();
    state.db.update_workspace(&workspace).map_err(map_err)?;
    let updated = state
        .db
        .get_workspace(&id)
        .map_err(map_err)?
        .ok_or_else(|| format!("workspace não encontrado: {id}"))?;
    Ok(updated)
}

/// Remove o workspace do Lumina. **Não** apaga a pasta do usuário.
#[tauri::command]
pub async fn remove_workspace(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let removed = state.db.delete_workspace(&id).map_err(map_err)?;
    if !removed {
        return Err(format!("workspace não encontrado: {id}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn set_workspace_trusted(
    state: State<'_, AppState>,
    id: String,
    trusted: bool,
) -> Result<Workspace, String> {
    state
        .db
        .set_workspace_trusted(&id, trusted)
        .map_err(map_err)?;
    state
        .db
        .get_workspace(&id)
        .map_err(map_err)?
        .ok_or_else(|| format!("workspace não encontrado: {id}"))
}

/// Vincula (ou desvincula) uma sessão a um workspace.
#[tauri::command]
pub async fn set_conversation_workspace(
    state: State<'_, AppState>,
    conversation_id: String,
    workspace_id: Option<String>,
) -> Result<Conversation, String> {
    state
        .db
        .set_conversation_workspace(&conversation_id, workspace_id.as_deref())
        .map_err(map_err)?;
    state
        .db
        .get_conversation(&conversation_id)
        .map_err(map_err)?
        .ok_or_else(|| format!("conversa não encontrada: {conversation_id}"))
}

#[tauri::command]
pub async fn open_workspace_in_explorer(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let root = workspace_path(&state, &id)?;
    app.opener()
        .open_path(root.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| format!("não foi possível abrir a pasta: {error}"))
}

/* ------------------------------------------------------------------ */
/* Árvore, busca e prévia                                              */
/* ------------------------------------------------------------------ */

fn build_tree(entries: &[(String, bool, u64)], _root_label: &str) -> Vec<WorkspaceFileEntry> {
    use std::collections::HashMap;
    // Passo 1: agrupa filhos por pai (None = raiz da listagem).
    let mut children: HashMap<Option<String>, Vec<String>> = HashMap::new();
    let mut info: HashMap<String, (bool, u64)> = HashMap::new();
    for (path, is_dir, size) in entries {
        let parent = path.rsplit_once('/').map(|(parent, _)| parent.to_string());
        children.entry(parent).or_default().push(path.clone());
        info.insert(path.clone(), (*is_dir, *size));
    }
    // Passo 2: monta recursivamente, diretórios primeiro e nome ordenado.
    fn build(
        path: &str,
        children: &HashMap<Option<String>, Vec<String>>,
        info: &HashMap<String, (bool, u64)>,
    ) -> WorkspaceFileEntry {
        let (is_dir, size) = info.get(path).copied().unwrap_or((false, 0));
        let name = path.rsplit('/').next().unwrap_or(path).to_string();
        let depth = path.matches('/').count() as u32;
        let mut child_nodes: Vec<WorkspaceFileEntry> = children
            .get(&Some(path.to_string()))
            .map(|paths| {
                paths
                    .iter()
                    .map(|child| build(child, children, info))
                    .collect()
            })
            .unwrap_or_default();
        child_nodes.sort_by(|left, right| {
            right
                .is_dir
                .cmp(&left.is_dir)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        WorkspaceFileEntry {
            path: path.to_string(),
            name,
            is_dir,
            depth,
            size: if is_dir { None } else { Some(size) },
            git_status: None,
            children: child_nodes,
        }
    }
    let mut roots: Vec<WorkspaceFileEntry> = children
        .get(&None)
        .map(|paths| {
            paths
                .iter()
                .map(|path| build(path, &children, &info))
                .collect()
        })
        .unwrap_or_default();
    roots.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    roots
}

/// Lista a árvore do workspace a partir de um diretório relativo.
#[tauri::command]
pub async fn list_workspace_files(
    state: State<'_, AppState>,
    workspace_id: String,
    path: Option<String>,
    depth: Option<u32>,
) -> Result<Vec<WorkspaceFileEntry>, String> {
    let root = workspace_path(&state, &workspace_id)?;
    let relative = path.unwrap_or_else(|| ".".to_string());
    let base = safe_path::resolve(&root, &relative, Access::Read).map_err(map_err)?;
    if !base.is_dir() {
        return Err(format!("`{relative}` não é uma pasta"));
    }
    let depth = depth.unwrap_or(2).clamp(1, 6);
    let mut entries: Vec<(String, bool, u64)> = Vec::new();
    let walker = ignore::WalkBuilder::new(&base)
        .max_depth(Some(depth as usize + 1))
        .hidden(true)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .follow_links(false)
        .build();
    for entry in walker.flatten() {
        if entries.len() >= MAX_TREE_ENTRIES {
            break;
        }
        let entry_path = entry.path();
        if entry_path == base {
            continue;
        }
        let Ok(relative_path) = entry_path.strip_prefix(&root) else {
            continue;
        };
        let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
        let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        entries.push((
            relative_path.to_string_lossy().replace('\\', "/"),
            is_dir,
            size,
        ));
    }
    let mut tree = build_tree(&entries, &relative);
    // Badges de git para os arquivos visíveis.
    let status = crate::workspace::git::detect(&root).await;
    if status.is_repo {
        use std::collections::HashMap;
        let mut badges: HashMap<String, String> = HashMap::new();
        for file in &status.staged {
            badges.insert(file.path.clone(), file.status.clone());
        }
        for file in &status.unstaged {
            badges.entry(file.path.clone()).or_insert_with(|| file.status.clone());
        }
        for path in &status.untracked {
            badges.insert(path.clone(), "U".to_string());
        }
        for path in &status.conflicted {
            badges.insert(path.clone(), "!".to_string());
        }
        fn apply_badges(entries: &mut [WorkspaceFileEntry], badges: &HashMap<String, String>) {
            for entry in entries.iter_mut() {
                if let Some(badge) = badges.get(&entry.path) {
                    entry.git_status = Some(badge.clone());
                }
                apply_badges(&mut entry.children, badges);
            }
        }
        apply_badges(&mut tree, &badges);
    }
    Ok(tree)
}

/// Busca arquivos por nome (substring, case-insensitive) para `@` menções.
#[tauri::command]
pub async fn search_workspace_files(
    state: State<'_, AppState>,
    workspace_id: String,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<String>, String> {
    let root = workspace_path(&state, &workspace_id)?;
    let needle = query.trim().to_lowercase();
    let limit = limit.unwrap_or(50).clamp(1, 200) as usize;
    let mut matches: Vec<(u8, String)> = Vec::new();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let mut visited = 0usize;
    let walker = ignore::WalkBuilder::new(&root)
        .hidden(true)
        .git_ignore(true)
        .git_global(false)
        .follow_links(false)
        .build();
    for entry in walker.flatten() {
        if visited >= MAX_SEARCH_ENTRIES || matches.len() >= limit * 4 {
            break;
        }
        let Some(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        visited += 1;
        let Ok(relative_path) = entry.path().strip_prefix(&root) else {
            continue;
        };
        let relative_path = relative_path.to_string_lossy().replace('\\', "/");
        let lower = relative_path.to_lowercase();
        let Some(position) = lower.find(&needle) else {
            continue;
        };
        // Prioriza nome de arquivo, depois path; e prefixo antes de meio.
        let name_start = relative_path.rfind('/').map(|index| index + 1).unwrap_or(0);
        let score = if position == name_start {
            0
        } else if position == 0 {
            1
        } else {
            2
        };
        matches.push((score, relative_path));
    }
    matches.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then_with(|| left.1.len().cmp(&right.1.len()))
            .then_with(|| left.1.cmp(&right.1))
    });
    Ok(matches
        .into_iter()
        .take(limit)
        .map(|(_, path)| path)
        .collect())
}

/// Prévia read-only de um arquivo do workspace (para o painel).
#[tauri::command]
pub async fn read_workspace_file(
    state: State<'_, AppState>,
    workspace_id: String,
    path: String,
) -> Result<WorkspaceFileContent, String> {
    let root = workspace_path(&state, &workspace_id)?;
    let file_path = safe_path::resolve(&root, &path, Access::Read).map_err(map_err)?;
    let metadata = std::fs::metadata(&file_path)
        .map_err(|error| format!("não foi possível ler `{path}`: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("`{path}` não é um arquivo"));
    }
    let size = metadata.len();
    let relative = safe_path::to_relative(&root, &file_path);
    if size > MAX_PREVIEW_BYTES as u64 * 8 {
        return Ok(WorkspaceFileContent {
            path: relative,
            text: String::new(),
            truncated: true,
            size,
            binary: true,
            encoding: None,
        });
    }
    let bytes = std::fs::read(&file_path)
        .map_err(|error| format!("não foi possível abrir `{path}`: {error}"))?;
    if bytes.iter().take(8_000).any(|byte| *byte == 0) {
        return Ok(WorkspaceFileContent {
            path: relative,
            text: String::new(),
            truncated: false,
            size,
            binary: true,
            encoding: None,
        });
    }
    let (text, encoding) = match std::str::from_utf8(&bytes) {
        Ok(text) => (text.to_string(), None),
        Err(_) => {
            let mut detector =
                chardetng::EncodingDetector::new(chardetng::Iso2022JpDetection::Deny);
            detector.feed(&bytes, true);
            let encoding = detector.guess(None, chardetng::Utf8Detection::Allow);
            let (decoded, _, _) = encoding.decode(&bytes);
            (decoded.to_string(), Some(encoding.name().to_string()))
        }
    };
    let truncated = bytes.len() > MAX_PREVIEW_BYTES;
    let text = if truncated {
        let mut boundary = MAX_PREVIEW_BYTES.min(text.len());
        while boundary > 0 && !text.is_char_boundary(boundary) {
            boundary -= 1;
        }
        text[..boundary].to_string()
    } else {
        text
    };
    Ok(WorkspaceFileContent {
        path: relative,
        text,
        truncated,
        size,
        binary: false,
        encoding,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tree_builder_nests_and_sorts_dirs_first() {
        let entries = vec![
            ("src".to_string(), true, 0),
            ("src/app.ts".to_string(), false, 12),
            ("src/lib".to_string(), true, 0),
            ("src/lib/util.ts".to_string(), false, 4),
            ("README.md".to_string(), false, 8),
        ];
        let tree = build_tree(&entries, ".");
        assert_eq!(tree[0].name, "src");
        assert!(tree[0].is_dir);
        assert_eq!(tree[0].children.len(), 2);
        assert_eq!(tree[1].name, "README.md");
    }

    #[test]
    fn project_info_maps_checks() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(
            dir.path().join("Cargo.toml"),
            "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n",
        )
        .expect("write");
        let info = project_info(dir.path());
        assert_eq!(info.kind, "rust");
        assert!(!info.checks.is_empty());
        assert!(info.checks.iter().any(|check| check.command.contains("cargo")));
    }
}
