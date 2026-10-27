//! Terminal PTY do harness de código (F7 do `docs/goals/code-harness/PLAN.md`).
//!
//! Um terminal por sessão do Code, iniciado **pelo usuário** no painel
//! (`WORKBENCH.md` §7.3). Backend com `portable-pty` (ConPTY no Windows):
//! entrada/saída em streaming por `tauri::ipc::Channel<TerminalEvent>`, resize,
//! kill de processo e cwd no workspace da conversa. Contrato: `HARNESS.md` §8.3.
//!
//! Segurança: o terminal herda o ambiente do app (é um shell do usuário), mas
//! remove variáveis com cara de segredo; o agente **não** recebe essas tools —
//! quem digita é o usuário.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{
    native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize,
};
use serde::Serialize;
use tauri::ipc::Channel;

use crate::db::Db;
use crate::events::TerminalEvent;

/// Limite de bytes que um terminal guarda antes de descartar (o xterm tem o
/// scrollback dele; aqui só evitamos buffers infinitos no host).
const MAX_TERMINALS_PER_CONVERSATION: usize = 4;

struct TerminalSession {
    conversation_id: String,
    title: String,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

impl TerminalSession {
    fn kill(&mut self) {
        let _ = self.killer.kill();
    }
}

/// Registro process-wide de terminais abertos.
#[derive(Default)]
pub struct TerminalRegistry {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

/// DTO devolvido ao renderer ao abrir/listar terminais.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInfo {
    pub id: String,
    pub conversation_id: String,
    pub title: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    pub running: bool,
}

fn sanitized_env(program_env: &[(String, String)]) -> Vec<(String, String)> {
    program_env
        .iter()
        .filter(|(key, _)| {
            let upper = key.to_ascii_uppercase();
            !(upper.contains("API_KEY")
                || upper.contains("TOKEN")
                || upper.contains("SECRET")
                || upper.contains("PASSWORD")
                || upper.starts_with("LUMINA_"))
        })
        .cloned()
        .collect()
}

fn shell_program() -> String {
    #[cfg(windows)]
    {
        if let Some(path) = crate::workspace::exec::find_executable("pwsh") {
            return path.to_string_lossy().to_string();
        }
        if let Some(path) = crate::workspace::exec::find_executable("powershell") {
            return path.to_string_lossy().to_string();
        }
        std::env::var("ComSpec").unwrap_or_else(|_| "powershell.exe".to_string())
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

fn terminal_cwd(db: &Db, conversation_id: &str) -> PathBuf {
    let workspace = db
        .get_conversation(conversation_id)
        .ok()
        .flatten()
        .and_then(|conversation| conversation.workspace_id)
        .and_then(|workspace_id| db.get_workspace(&workspace_id).ok().flatten());
    match workspace {
        Some(workspace) => {
            let path = PathBuf::from(workspace.path);
            if path.is_dir() {
                path
            } else {
                std::env::temp_dir()
            }
        }
        None => std::env::temp_dir(),
    }
}

impl TerminalRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Abre um terminal novo e começa a transmitir a saída pelo `channel`.
    pub fn open(
        &self,
        db: &Db,
        conversation_id: &str,
        cols: u16,
        rows: u16,
        channel: Channel<TerminalEvent>,
    ) -> Result<TerminalInfo, String> {
        let existing = self
            .sessions
            .lock()
            .values()
            .filter(|session| session.conversation_id == conversation_id)
            .count();
        if existing >= MAX_TERMINALS_PER_CONVERSATION {
            return Err(format!(
                "TERMINAL_LIMIT: máximo de {MAX_TERMINALS_PER_CONVERSATION} terminais por sessão"
            ));
        }
        let cols = cols.clamp(20, 500);
        let rows = rows.clamp(5, 200);
        let cwd = terminal_cwd(db, conversation_id);
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("TERMINAL_SPAWN: {error}"))?;

        let program = shell_program();
        let mut builder = CommandBuilder::new(&program);
        builder.cwd(&cwd);
        builder.env("TERM", "xterm-256color");
        builder.env("COLORTERM", "truecolor");
        builder.env("LUMINA_AGENT", "1");
        // Higiene: remove variáveis sensíveis herdadas do ambiente do app.
        let inherited: Vec<(String, String)> = std::env::vars().collect();
        let sensitive: Vec<String> = inherited
            .iter()
            .map(|(key, _)| key.clone())
            .filter(|key| !sanitized_env(&[(key.clone(), String::new())])
                .iter()
                .any(|(kept, _)| kept == key))
            .collect();
        for key in sensitive {
            builder.env_remove(&key);
        }

        let mut child = pair
            .slave
            .spawn_command(builder)
            .map_err(|error| format!("TERMINAL_SPAWN: {error}"))?;
        drop(pair.slave);
        let mut master = pair.master;
        let mut reader = master
            .try_clone_reader()
            .map_err(|error| format!("TERMINAL_READ: {error}"))?;
        let writer = master
            .take_writer()
            .map_err(|error| format!("TERMINAL_WRITE: {error}"))?;
        let killer = child.clone_killer();
        let id = format!("term-{}", uuid::Uuid::new_v4());
        let title = cwd
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "Terminal".to_string());
        let info = TerminalInfo {
            id: id.clone(),
            conversation_id: conversation_id.to_string(),
            title: title.clone(),
            cwd: cwd.to_string_lossy().to_string(),
            cols,
            rows,
            running: true,
        };

        // Leitor: bytes do ConPTY → UTF-8 lossy → evento `data`.
        let child_wait = std::thread::spawn(move || {
            let mut buffer = [0u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => {
                        let text = String::from_utf8_lossy(&buffer[..read]).to_string();
                        if channel.send(TerminalEvent::Data { data: text }).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let code = child.wait().ok().map(|status| status.exit_code() as i32);
            let _ = channel.send(TerminalEvent::Exit { code });
        });
        let _ = child_wait;

        self.sessions.lock().insert(
            id,
            TerminalSession {
                conversation_id: conversation_id.to_string(),
                title,
                master,
                writer,
                killer,
            },
        );
        Ok(info)
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("TERMINAL_NOT_FOUND: {id}"))?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|error| format!("TERMINAL_WRITE: {error}"))?;
        let _ = session.writer.flush();
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock();
        let session = sessions
            .get(id)
            .ok_or_else(|| format!("TERMINAL_NOT_FOUND: {id}"))?;
        session
            .master
            .resize(PtySize {
                rows: rows.clamp(5, 200),
                cols: cols.clamp(20, 500),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("TERMINAL_RESIZE: {error}"))
    }

    pub fn close(&self, id: &str) -> bool {
        let mut sessions = self.sessions.lock();
        if let Some(mut session) = sessions.remove(id) {
            session.kill();
            true
        } else {
            false
        }
    }

    pub fn list(&self, conversation_id: &str) -> Vec<TerminalInfo> {
        self.sessions
            .lock()
            .iter()
            .filter(|(_, session)| session.conversation_id == conversation_id)
            .map(|(id, session)| TerminalInfo {
                id: id.clone(),
                conversation_id: session.conversation_id.clone(),
                title: session.title.clone(),
                cwd: String::new(),
                cols: 0,
                rows: 0,
                running: true,
            })
            .collect()
    }

    /// Encerra todos os terminais (shutdown do app).
    pub fn close_all(&self) -> usize {
        let mut sessions = self.sessions.lock();
        let count = sessions.len();
        for (_, mut session) in sessions.drain() {
            session.kill();
        }
        count
    }
}

/// Compartilhado entre os comandos e o `AppState`.
pub type SharedTerminals = Arc<TerminalRegistry>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_env_is_scrubbed_from_secrets() {
        let env = vec![
            ("PATH".to_string(), "C:\\bin".to_string()),
            ("OPENAI_API_KEY".to_string(), "sk-1".to_string()),
            ("GH_TOKEN".to_string(), "ghp".to_string()),
            ("DB_PASSWORD".to_string(), "pw".to_string()),
            ("LUMINA_INTERNAL".to_string(), "x".to_string()),
            ("TERM".to_string(), "dumb".to_string()),
        ];
        let clean = sanitized_env(&env);
        let keys: Vec<&str> = clean.iter().map(|(key, _)| key.as_str()).collect();
        assert!(keys.contains(&"PATH"));
        assert!(keys.contains(&"TERM"));
        assert!(!keys.contains(&"OPENAI_API_KEY"));
        assert!(!keys.contains(&"GH_TOKEN"));
        assert!(!keys.contains(&"DB_PASSWORD"));
        assert!(!keys.contains(&"LUMINA_INTERNAL"));
    }

    #[test]
    fn registry_lifecycle_is_honest_without_a_channel() {
        let registry = TerminalRegistry::new();
        assert!(!registry.close("term-missing"));
        assert!(registry.list("conv-1").is_empty());
        assert!(registry.write("term-missing", "ls\n").is_err());
        assert!(registry.resize("term-missing", 80, 24).is_err());
    }
}
