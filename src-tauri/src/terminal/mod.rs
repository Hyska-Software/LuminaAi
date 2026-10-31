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
//!
//! Ciclo de vida: a sessão continua no registry após o processo terminar (para
//! a UI mostrar o exit code e permitir fechar/reiniciar) e só deixa de contar
//! no limite enquanto estiver rodando. Fechar a aba remove a sessão; fechar o
//! app encerra todas as árvores de processo.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{
    native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize,
};
use serde::Serialize;
use tauri::ipc::Channel;

use crate::db::Db;
use crate::events::TerminalEvent;

/// Limite de terminais **rodando** por conversa. Abas já encerradas não contam
/// (a UI mantém o histórico até o usuário fechar a aba).
const MAX_TERMINALS_PER_CONVERSATION: usize = 4;

struct TerminalSession {
    conversation_id: String,
    title: String,
    cwd: String,
    cols: u16,
    rows: u16,
    pid: Option<u32>,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    running: Arc<AtomicBool>,
    exit_code: Arc<Mutex<Option<i32>>>,
}

impl TerminalSession {
    fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    fn terminate(&mut self) {
        if !self.is_running() {
            return;
        }
        kill_process_tree(self.pid, self.killer.as_mut());
    }
}

/// Registro process-wide de terminais abertos.
#[derive(Default)]
pub struct TerminalRegistry {
    sessions: Mutex<HashMap<String, TerminalSession>>,
    /// Serializa a checagem do limite + spawn + inserção (evita ultrapassar o
    /// máximo com dois `open_terminal` concorrentes).
    open_lock: Mutex<()>,
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
    pub exit_code: Option<i32>,
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

fn terminal_cwd(db: &Db, conversation_id: &str) -> Result<PathBuf, String> {
    let conversation = db
        .get_conversation(conversation_id)
        .map_err(|error| format!("TERMINAL_CONVERSATION: {error}"))?
        .ok_or_else(|| {
            format!("TERMINAL_CONVERSATION_NOT_FOUND: conversa {conversation_id} não encontrada")
        })?;
    let workspace_id = conversation
        .workspace_id
        .ok_or_else(|| "TERMINAL_NO_WORKSPACE: abra uma pasta para usar o terminal".to_string())?;
    let workspace = db
        .get_workspace(&workspace_id)
        .map_err(|error| format!("TERMINAL_CONVERSATION: {error}"))?
        .ok_or_else(|| format!("TERMINAL_WORKSPACE_MISSING: workspace {workspace_id} não encontrado"))?;
    let path = PathBuf::from(workspace.path);
    if !path.is_dir() {
        return Err(format!(
            "TERMINAL_WORKSPACE_MISSING: a pasta {} não está disponível",
            path.display()
        ));
    }
    Ok(path)
}

/// Kills the shell **and its descendants**. portable-pty only knows the direct
/// child (`TerminateProcess` on Windows), so `taskkill /T /F` is used first;
/// the direct killer remains as a fallback for Unix/odd failures.
fn kill_process_tree(pid: Option<u32>, killer: &mut dyn ChildKiller) {
    #[cfg(windows)]
    {
        if let Some(pid) = pid {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let mut command = std::process::Command::new("taskkill");
            command.args(["/PID", &pid.to_string(), "/T", "/F"]);
            command.stdout(std::process::Stdio::null());
            command.stderr(std::process::Stdio::null());
            command.creation_flags(CREATE_NO_WINDOW);
            if command.status().map(|status| status.success()).unwrap_or(false) {
                return;
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
    }
    let _ = killer.kill();
}

/// Stateful UTF-8 decoder: an UTF-8 code point can be split across two ConPTY
/// reads (accented text, emoji, CJK). `from_utf8_lossy` per chunk would insert
/// `�`; `encoding_rs` keeps the incomplete tail until the next read.
struct Utf8StreamDecoder {
    decoder: encoding_rs::Decoder,
}

impl Utf8StreamDecoder {
    fn new() -> Self {
        Self {
            decoder: encoding_rs::UTF_8.new_decoder_without_bom_handling(),
        }
    }

    fn push(&mut self, bytes: &[u8]) -> String {
        // `decode_to_string` writes into the String's existing capacity; it
        // does not grow it. Reserve worst-case UTF-8 (3 bytes per unit).
        let mut output = String::with_capacity(bytes.len() * 3 + 4);
        let _ = self.decoder.decode_to_string(bytes, &mut output, false);
        output
    }

    fn finish(&mut self) -> String {
        let mut output = String::with_capacity(4);
        let _ = self.decoder.decode_to_string(&[], &mut output, true);
        output
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
        // Held until the session is inserted, so two concurrent opens cannot
        // both observe a free slot and exceed the per-conversation limit.
        let _open_guard = self.open_lock.lock();
        let running_count = self
            .sessions
            .lock()
            .values()
            .filter(|session| session.is_running())
            .count();
        if running_count >= MAX_TERMINALS_PER_CONVERSATION {
            return Err(format!(
                "TERMINAL_LIMIT: máximo de {MAX_TERMINALS_PER_CONVERSATION} terminais por sessão"
            ));
        }

        let cols = cols.clamp(20, 500);
        let rows = rows.clamp(5, 200);
        let cwd = terminal_cwd(db, conversation_id)?;
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
        let master = pair.master;
        let pid = child.process_id();
        let mut cleanup_killer = child.clone_killer();
        let mut reader = match master.try_clone_reader() {
            Ok(reader) => reader,
            Err(error) => {
                kill_process_tree(pid, cleanup_killer.as_mut());
                return Err(format!("TERMINAL_READ: {error}"));
            }
        };
        let writer = match master.take_writer() {
            Ok(writer) => writer,
            Err(error) => {
                kill_process_tree(pid, cleanup_killer.as_mut());
                return Err(format!("TERMINAL_WRITE: {error}"));
            }
        };
        let killer = child.clone_killer();
        let mut reader_killer = child.clone_killer();
        let running = Arc::new(AtomicBool::new(true));
        let exit_code = Arc::new(Mutex::new(None));
        let thread_running = running.clone();
        let thread_exit = exit_code.clone();
        let id = format!("term-{}", uuid::Uuid::new_v4());
        let title = cwd
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "Terminal".to_string());
        let cwd_display = cwd.to_string_lossy().to_string();
        let info = TerminalInfo {
            id: id.clone(),
            conversation_id: conversation_id.to_string(),
            title: title.clone(),
            cwd: cwd_display.clone(),
            cols,
            rows,
            running: true,
            exit_code: None,
        };

        // Leitor: bytes do ConPTY → UTF-8 stateful → evento `data`.
        let child_wait = std::thread::spawn(move || {
            let mut decoder = Utf8StreamDecoder::new();
            let mut buffer = [0u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        let tail = decoder.finish();
                        if !tail.is_empty() {
                            let _ = channel.send(TerminalEvent::Data { data: tail });
                        }
                        break;
                    }
                    Ok(read) => {
                        let text = decoder.push(&buffer[..read]);
                        if text.is_empty() {
                            continue;
                        }
                        if channel.send(TerminalEvent::Data { data: text }).is_err() {
                            // The webview/channel is gone: do not leave an
                            // invisible shell consuming a slot.
                            kill_process_tree(pid, reader_killer.as_mut());
                            break;
                        }
                    }
                    Err(_) => {
                        kill_process_tree(pid, reader_killer.as_mut());
                        break;
                    }
                }
            }
            let code = child.wait().ok().map(|status| status.exit_code() as i32);
            thread_running.store(false, Ordering::SeqCst);
            *thread_exit.lock() = code;
            let _ = channel.send(TerminalEvent::Exit { code });
        });
        // The thread owns the PTY reader and the child handle; dropping the
        // JoinHandle only detaches it.
        drop(child_wait);

        self.sessions.lock().insert(
            id,
            TerminalSession {
                conversation_id: conversation_id.to_string(),
                title,
                cwd: cwd_display,
                cols,
                rows,
                pid,
                master,
                writer,
                killer,
                running,
                exit_code,
            },
        );
        Ok(info)
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("TERMINAL_NOT_FOUND: {id}"))?;
        if !session.is_running() {
            return Err(format!("TERMINAL_EXITED: {id}"));
        }
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|error| format!("TERMINAL_WRITE: {error}"))?;
        let _ = session.writer.flush();
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let cols = cols.clamp(20, 500);
        let rows = rows.clamp(5, 200);
        let mut sessions = self.sessions.lock();
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("TERMINAL_NOT_FOUND: {id}"))?;
        if !session.is_running() {
            return Ok(());
        }
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("TERMINAL_RESIZE: {error}"))?;
        session.cols = cols;
        session.rows = rows;
        Ok(())
    }

    /// Kills the process but keeps the session/tab so the UI can show the exit
    /// code and offer "Reiniciar".
    pub fn kill(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("TERMINAL_NOT_FOUND: {id}"))?;
        if session.is_running() {
            session.terminate();
        }
        Ok(())
    }

    pub fn close(&self, id: &str) -> bool {
        let mut sessions = self.sessions.lock();
        if let Some(mut session) = sessions.remove(id) {
            session.terminate();
            true
        } else {
            false
        }
    }

    /// Closes every terminal of a conversation (session deletion).
    pub fn close_conversation(&self, conversation_id: &str) -> usize {
        let _open_guard = self.open_lock.lock();
        let mut sessions = self.sessions.lock();
        let ids: Vec<String> = sessions
            .iter()
            .filter(|(_, session)| session.conversation_id == conversation_id)
            .map(|(id, _)| id.clone())
            .collect();
        let mut closed = 0;
        for id in ids {
            if let Some(mut session) = sessions.remove(&id) {
                session.terminate();
                closed += 1;
            }
        }
        closed
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
                cwd: session.cwd.clone(),
                cols: session.cols,
                rows: session.rows,
                running: session.is_running(),
                exit_code: *session.exit_code.lock(),
            })
            .collect()
    }

    /// Encerra todos os terminais (shutdown do app).
    pub fn close_all(&self) -> usize {
        let _open_guard = self.open_lock.lock();
        let mut sessions = self.sessions.lock();
        let count = sessions.len();
        for (_, mut session) in sessions.drain() {
            session.terminate();
        }
        count
    }
}

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
    fn utf8_decoder_keeps_split_sequences_intact() {
        let mut decoder = Utf8StreamDecoder::new();
        // "ção" split in the middle of both two-byte sequences.
        let bytes = "ção".as_bytes();
        assert!(bytes.len() >= 4);
        let first = decoder.push(&bytes[..1]);
        let rest = decoder.push(&bytes[1..]);
        let tail = decoder.finish();
        assert_eq!(format!("{first}{rest}{tail}"), "ção");
        assert!(!format!("{first}{rest}{tail}").contains('\u{FFFD}'));
    }

    #[test]
    fn utf8_decoder_replaces_invalid_bytes_once() {
        let mut decoder = Utf8StreamDecoder::new();
        let output = format!("{}a{}", decoder.push(&[0xff]), decoder.finish());
        assert_eq!(output, "\u{FFFD}a");
    }

    #[test]
    fn registry_lifecycle_is_honest_without_a_channel() {
        let registry = TerminalRegistry::new();
        assert!(!registry.close("term-missing"));
        assert!(registry.list("conv-1").is_empty());
        assert!(registry.write("term-missing", "ls\n").is_err());
        assert!(registry.resize("term-missing", 80, 24).is_err());
        assert!(registry.kill("term-missing").is_err());
        assert_eq!(registry.close_conversation("conv-1"), 0);
        assert_eq!(registry.close_all(), 0);
    }
}
