//! One-use loopback WebSocket bridge to the container's private RFB servers.
//!
//! The view-only server enforces observation independently of the renderer. A
//! control connection is revoked when ownership changes. Neither RFB port is
//! published on the host or requires the desktop to have network access.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::process::Command;
use tokio_tungstenite::tungstenite::{
    handshake::server::{Request, Response},
    Message,
};

use crate::db::Db;

fn permitted(db: &Db, conversation_id: &str, interactive: bool) -> bool {
    if !interactive {
        return true;
    }
    matches!(db.computer_control(conversation_id), Ok((true, true)))
        && matches!(db.computer_control_target(conversation_id), Ok(target) if target == "desktop")
}

pub async fn open(
    db: Arc<Db>,
    conversation_id: String,
    container: String,
    interactive: bool,
) -> Result<String, String> {
    if !permitted(&db, &conversation_id, interactive) {
        return Err("COMPUTER_HUMAN_CONTROL_REQUIRED: assuma o controle antes de interagir".into());
    }
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let path = format!("/{token}");
    let gate = super::control::gate(&conversation_id);
    let generation = if interactive {
        let generation = gate.claim_stream();
        let guard = gate.interactive_stream.clone().lock_owned().await;
        gate.stream_cleanup_result()?;
        if !permitted(&db, &conversation_id, true) || !gate.owns_stream(generation) {
            return Err("COMPUTER_HUMAN_CONTROL_REQUIRED: controle revogado".into());
        }
        Some((generation, guard))
    } else {
        None
    };
    tokio::spawn(async move {
        let mut changes = gate.subscribe();
        let generation_number = generation.as_ref().map(|(number, _)| *number);
        if generation_number.is_some_and(|value| !gate.owns_stream(value)) { return; }
        let accepted_socket = tokio::select! {
            _ = changes.changed(), if interactive => return,
            result = tokio::time::timeout(Duration::from_secs(20), listener.accept()) => result,
        };
        let Ok(Ok((socket, _))) = accepted_socket else { return };
        let handshake = tokio_tungstenite::accept_hdr_async(socket, |request: &Request, response: Response| {
                if request.uri().path() != path || request.uri().query().is_some() {
                    return Err(tokio_tungstenite::tungstenite::http::Response::builder()
                        .status(403)
                        .body(Some("Forbidden".into()))
                        .unwrap_or_default());
                }
                Ok(response)
            });
        let accepted = tokio::select! {
            _ = changes.changed(), if interactive => return,
            result = tokio::time::timeout(Duration::from_secs(5), handshake) => result,
        };
        let Ok(accepted) = accepted else { return };
        let Ok(ws) = accepted else { return };
        if !permitted(&db, &conversation_id, interactive)
            || generation_number.is_some_and(|value| !gate.owns_stream(value))
        {
            return;
        }
        let mut command = Command::new("docker");
        command.args(["exec", "-i", &container]);
        if interactive {
            // Cleanup runs inside the container only after socat has closed the
            // RFB socket; its exit status is the completion acknowledgement.
            command.args(["sh", "-c", "socat -t 0 - TCP:127.0.0.1:5901; exec /usr/local/bin/zylara-clear-input"]);
        } else {
            command.args(["socat", "-", "TCP:127.0.0.1:5900"]);
        }
        command
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let Ok(mut child) = command.spawn() else {
            return;
        };
        let (Some(mut input), Some(mut output)) = (child.stdin.take(), child.stdout.take()) else {
            if interactive { gate.set_stream_cleanup_error("interactive bridge pipes unavailable".into()); }
            return;
        };
        let (mut sender, mut receiver) = ws.split();
        let mut buffer = vec![0u8; 64 * 1024];
        loop {
            tokio::select! {
                changed = changes.changed(), if interactive => {
                    if changed.is_err() || !permitted(&db, &conversation_id, true) || generation_number.is_some_and(|value| !gate.owns_stream(value)) { break; }
                }
                result = output.read(&mut buffer) => match result {
                    Ok(0) | Err(_) => break,
                    Ok(count) => if !matches!(tokio::time::timeout(Duration::from_secs(3), sender.send(Message::Binary(buffer[..count].to_vec().into()))).await, Ok(Ok(()))) { break; },
                },
                message = receiver.next() => match message {
                    Some(Ok(Message::Binary(bytes))) if bytes.len() <= 1024 * 1024 => {
                        let _action = if interactive { Some(gate.action.lock().await) } else { None };
                        if !permitted(&db, &conversation_id, interactive) || generation_number.is_some_and(|value| !gate.owns_stream(value)) || !matches!(tokio::time::timeout(Duration::from_secs(3), input.write_all(&bytes)).await, Ok(Ok(()))) { break; }
                    }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    Some(Ok(Message::Ping(data))) => if sender.send(Message::Pong(data)).await.is_err() { break; },
                    Some(Ok(_)) => {},
                },
            }
        }
        if interactive {
            drop(input);
            let finished = tokio::time::timeout(Duration::from_secs(15), async {
                loop {
                    tokio::select! {
                        result = child.wait() => break result,
                        result = output.read(&mut buffer) => match result {
                            Ok(0) | Err(_) => break child.wait().await,
                            Ok(_) => {},
                        }
                    }
                }
            }).await;
            match finished {
                Ok(Ok(status)) if status.success() => {},
                Ok(Ok(status)) => gate.set_stream_cleanup_error(format!("cleanup exited with {status}")),
                Ok(Err(error)) => gate.set_stream_cleanup_error(error.to_string()),
                Err(_) => {
                    let _ = child.kill().await;
                    gate.set_stream_cleanup_error("interactive bridge did not finish cleanup in time".into());
                }
            }
        } else {
            let _ = child.kill().await;
        }
        drop(generation);
    });
    Ok(format!("ws://127.0.0.1:{port}/{token}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Settings;

    #[tokio::test]
    async fn interactive_stream_requires_real_takeover() {
        let dir = tempfile::tempdir().expect("temporary directory");
        let db = Arc::new(Db::open(&dir.path().join("test.db")).expect("database"));
        db.set_computer_control("conversation", Some(true), Some(false), 1)
            .expect("pause");
        assert!(
            open(db.clone(), "conversation".into(), "unused".into(), true)
                .await
                .is_err()
        );
        db.set_computer_control("conversation", Some(true), Some(true), 2)
            .expect("takeover");
        db.set_computer_control_target("conversation", "desktop")
            .expect("target");
        assert!(permitted(&db, "conversation", true));
        db.set_computer_control_target("conversation", "browser")
            .expect("browser target");
        assert!(!permitted(&db, "conversation", true));
        db.set_computer_control("conversation", Some(false), Some(false), 3)
            .expect("release");
        assert!(!permitted(&db, "conversation", true));
        assert!(permitted(&db, "conversation", false));
    }

    #[tokio::test]
    async fn revoked_unaccepted_stream_does_not_block_handoff() {
        let dir = tempfile::tempdir().expect("temporary directory");
        let db = Arc::new(Db::open(&dir.path().join("test.db")).expect("database"));
        let conversation = uuid::Uuid::new_v4().to_string();
        db.set_computer_control(&conversation, Some(true), Some(true), 1).expect("takeover");
        db.set_computer_control_target(&conversation, "desktop").expect("target");
        let _url = open(db, conversation.clone(), "unused".into(), true).await.expect("open");
        let gate = super::super::control::gate(&conversation);
        let handoff = tokio::time::timeout(Duration::from_secs(2), gate.drain_interactive_stream())
            .await.expect("revoked listener stops").expect("clean");
        drop(handoff);
    }

    #[tokio::test]
    async fn revoked_incomplete_handshake_does_not_block_handoff() {
        let dir = tempfile::tempdir().expect("temporary directory");
        let db = Arc::new(Db::open(&dir.path().join("test.db")).expect("database"));
        let conversation = uuid::Uuid::new_v4().to_string();
        db.set_computer_control(&conversation, Some(true), Some(true), 1).expect("takeover");
        db.set_computer_control_target(&conversation, "desktop").expect("target");
        let url = open(db, conversation.clone(), "unused".into(), true).await.expect("open");
        let authority = url.strip_prefix("ws://").expect("scheme").split('/').next().expect("authority");
        let _socket = tokio::net::TcpStream::connect(authority).await.expect("connect");
        let gate = super::super::control::gate(&conversation);
        let _handoff = tokio::time::timeout(Duration::from_secs(2), gate.drain_interactive_stream())
            .await.expect("handshake stops").expect("clean");
    }

    #[tokio::test]
    #[ignore = "requires Docker and the zylara/computer:test image"]
    async fn rfb_input_is_cleared_on_disconnect_and_control_revocation() {
        let dir = tempfile::tempdir().expect("temporary directory");
        let db = Arc::new(Db::open(&dir.path().join("test.db")).expect("database"));
        let settings = Settings {
            execution_environment: "docker".into(),
            computer_docker_image: "zylara/computer:test".into(),
            computer_docker_container: format!("zylara-input-it-{}", uuid::Uuid::new_v4().simple()),
            docker_network: false,
            ..Settings::default()
        };
        let conversation = db.create_conversation("RFB integration", "test", "test")
            .expect("conversation").id;
        super::super::ensure_container(&settings, dir.path(), &conversation).await.expect("container starts");
        let name = super::super::container_for(&settings, &conversation);
        let result = async {
            let ready = async {
                loop {
                    let status = Command::new("docker").args(["exec", &name, "bash", "-c", "echo > /dev/tcp/127.0.0.1/5901"])
                        .stderr(std::process::Stdio::null()).status().await.map_err(|e| e.to_string())?;
                    if status.success() { return Ok::<(), String>(()); }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            };
            tokio::time::timeout(Duration::from_secs(10), ready).await.map_err(|e| e.to_string())??;
            db.set_computer_control(&conversation, Some(true), Some(true), 1).map_err(|e| e.to_string())?;
            db.set_computer_control_target(&conversation, "desktop").map_err(|e| e.to_string())?;
            type TestSocket = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
            async fn read_bytes(ws: &mut TestSocket, buffer: &mut Vec<u8>, length: usize) -> Result<Vec<u8>, String> {
                while buffer.len() < length {
                    let frame = tokio::time::timeout(Duration::from_secs(15), ws.next()).await
                        .map_err(|e| e.to_string())?.ok_or("RFB connection closed")?.map_err(|e| e.to_string())?;
                    match frame {
                        Message::Binary(bytes) => buffer.extend_from_slice(&bytes),
                        Message::Close(_) => return Err("RFB connection closed".into()),
                        _ => {},
                    }
                }
                Ok(buffer.drain(..length).collect())
            }
            async fn connect_rfb(url: &str) -> Result<TestSocket, String> {
                let (mut ws, _) = tokio_tungstenite::connect_async(url).await.map_err(|e| e.to_string())?;
                let mut buffer = Vec::new();
                let version = read_bytes(&mut ws, &mut buffer, 12).await?;
                if version != b"RFB 003.008\n" { return Err(format!("unexpected RFB version: {version:?}")); }
                ws.send(Message::Binary(version.into())).await.map_err(|e| e.to_string())?;
                let count = read_bytes(&mut ws, &mut buffer, 1).await?[0] as usize;
                let security = read_bytes(&mut ws, &mut buffer, count).await?;
                if !security.contains(&1) { return Err("RFB None security unavailable".into()); }
                ws.send(Message::Binary(vec![1].into())).await.map_err(|e| e.to_string())?;
                if read_bytes(&mut ws, &mut buffer, 4).await? != [0, 0, 0, 0] { return Err("RFB security failed".into()); }
                ws.send(Message::Binary(vec![1].into())).await.map_err(|e| e.to_string())?;
                let init = read_bytes(&mut ws, &mut buffer, 24).await?;
                let name_len = u32::from_be_bytes([init[20], init[21], init[22], init[23]]) as usize;
                if name_len > 65536 { return Err("RFB name too large".into()); }
                read_bytes(&mut ws, &mut buffer, name_len).await?;
                Ok(ws)
            }
            async fn press(ws: &mut TestSocket) -> Result<(), String> {
                // RFB KeyEvent (down, keysym 'a') and PointerEvent (button 1).
                ws.send(Message::Binary(vec![4, 1, 0, 0, 0, 0, 0, 97, 5, 1, 0, 100, 0, 100].into()))
                    .await.map_err(|e| e.to_string())
            }
            let query = r#"import ctypes
x=ctypes.CDLL('libX11.so.6'); p=ctypes.c_void_p; u=ctypes.c_uint; i=ctypes.c_int; w=ctypes.c_ulong
x.XOpenDisplay.argtypes=[ctypes.c_char_p]; x.XOpenDisplay.restype=p
x.XDefaultRootWindow.argtypes=[p]; x.XDefaultRootWindow.restype=w
x.XQueryKeymap.argtypes=[p,ctypes.POINTER(ctypes.c_ubyte)]
x.XQueryPointer.argtypes=[p,w,ctypes.POINTER(w),ctypes.POINTER(w),ctypes.POINTER(i),ctypes.POINTER(i),ctypes.POINTER(i),ctypes.POINTER(i),ctypes.POINTER(u)]
d=x.XOpenDisplay(None); k=(ctypes.c_ubyte*32)(); x.XQueryKeymap(d,k)
r=w(); c=w(); a=i(); b=i(); e=i(); f=i(); m=u(); x.XQueryPointer(d,x.XDefaultRootWindow(d),ctypes.byref(r),ctypes.byref(c),ctypes.byref(a),ctypes.byref(b),ctypes.byref(e),ctypes.byref(f),ctypes.byref(m))
print(int(bool(k[38//8] & (1<<(38%8)))), int(bool(m.value & 256)))"#;
            async fn state(name: &str, query: &str) -> Result<String, String> {
                let out = Command::new("docker").args(["exec", name, "python3", "-c", query]).output().await.map_err(|e| e.to_string())?;
                if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).into_owned()); }
                Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
            }
            async fn wait_state(name: &str, query: &str, expected: &str) -> Result<(), String> {
                let started = std::time::Instant::now();
                loop {
                    let actual = state(name, query).await?;
                    if actual == expected { return Ok(()); }
                    if started.elapsed() > Duration::from_secs(8) {
                        return Err(format!("expected input state {expected}, got {actual}"));
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
            let gate = super::super::control::gate(&conversation);
            let first_url = open(db.clone(), conversation.clone(), name.clone(), true).await?;
            let mut first = connect_rfb(&first_url).await.map_err(|e| format!("first RFB connection: {e}"))?;
            press(&mut first).await?;
            wait_state(&name, query, "1 1").await?;
            println!("RFB disconnect case: X11 key and button are pressed (1 1)");
            drop(first);
            let guard = tokio::time::timeout(Duration::from_secs(25), gate.drain_interactive_stream()).await
                .map_err(|e| e.to_string())??;
            wait_state(&name, query, "0 0").await?;
            println!("RFB disconnect case: X11 key and button cleared (0 0)");
            drop(guard);

            let second_url = open(db.clone(), conversation.clone(), name.clone(), true).await?;
            let mut second = connect_rfb(&second_url).await.map_err(|e| format!("second RFB connection: {e}"))?;
            press(&mut second).await?;
            wait_state(&name, query, "1 1").await?;
            println!("RFB revocation case: X11 key and button are pressed (1 1)");
            // The wrapper exists only in this disposable container. It pauses
            // the real helper so the agent can race the production handoff.
            let wrap = r#"import os
p='/usr/local/bin/zylara-clear-input'
os.rename(p,p+'-real')
with open(p,'w') as f:
 f.write('#!/bin/sh\ntouch /tmp/zylara-cleanup-entered\nwhile [ ! -f /tmp/zylara-cleanup-continue ]; do sleep 0.05; done\nexec /usr/local/bin/zylara-clear-input-real\n')
os.chmod(p,0o755)"#;
            let status = Command::new("docker").args(["exec", "-u", "0", &name, "python3", "-c", wrap])
                .status().await.map_err(|e| e.to_string())?;
            if !status.success() { return Err("cannot install test cleanup barrier".into()); }
            let release_db = db.clone();
            let release_conversation = conversation.clone();
            let release = tokio::spawn(async move {
                crate::commands::computer::release_computer_control_inner(&release_db, &release_conversation, "desktop", None).await
            });
            let marker_wait = async {
                loop {
                    let status = Command::new("docker").args(["exec", &name, "test", "-f", "/tmp/zylara-cleanup-entered"])
                        .status().await.map_err(|e| e.to_string())?;
                    if status.success() { return Ok::<(), String>(()); }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            };
            tokio::time::timeout(Duration::from_secs(8), marker_wait).await.map_err(|e| e.to_string())??;
            if release.is_finished() { return Err("handoff completed before cleanup".into()); }
            let ctx = crate::tools::registry::ToolCtx {
                db: db.clone(), http: reqwest::Client::new(), conversation_id: conversation.clone(),
                message_id: "rfb-message".into(), tool_call_id: "rfb-call".into(), turn_id: "rfb-turn".into(),
                workspace: None, settings: settings.clone(), cancel: tokio_util::sync::CancellationToken::new(), agent_hooks: None,
                data_dir: dir.path().to_path_buf(), approval: None, observed: None, emit: None,
                rules: Vec::new(), jobs: None, questions: None, turn_kind: crate::domain::TurnKind::User,
                mcp: None, subagent: None, enabled_tools: Arc::new(Default::default()),
                subagent_budget: Arc::new(std::sync::atomic::AtomicU32::new(0)),
                subagent_slots: Arc::new(tokio::sync::Semaphore::new(1)), skills_roots: Vec::new(), allowed_skills: None,
            };
            let blocked = crate::tools::code::computer::run(&ctx, "computer_screenshot", &serde_json::json!({})).await;
            if !blocked.is_error || !blocked.content.contains("COMPUTER_PAUSED") {
                return Err(format!("agent was not blocked during cleanup: {}", blocked.content));
            }
            if db.computer_control(&conversation).map_err(|e| e.to_string())? != (true, true) {
                return Err("control changed before cleanup finished".into());
            }
            println!("Production handoff: agent screenshot rejected while cleanup is blocked");
            let status = Command::new("docker").args(["exec", &name, "touch", "/tmp/zylara-cleanup-continue"])
                .status().await.map_err(|e| e.to_string())?;
            if !status.success() { return Err("cannot resume cleanup".into()); }
            tokio::time::timeout(Duration::from_secs(20), release).await.map_err(|e| e.to_string())?
                .map_err(|e| e.to_string())??;
            wait_state(&name, query, "0 0").await?;
            println!("RFB revocation case: X11 key and button cleared (0 0)");
            if db.computer_control(&conversation).map_err(|e| e.to_string())? != (false, false)
                || !db.computer_needs_observation(&conversation).map_err(|e| e.to_string())? {
                return Err("handoff did not require a fresh observation".into());
            }
            let blocked = crate::tools::code::computer::run(&ctx, "computer_windows", &serde_json::json!({})).await;
            if !blocked.is_error || !blocked.content.contains("COMPUTER_OBSERVATION_REQUIRED") {
                return Err(format!("agent did not require observation: {}", blocked.content));
            }
            let shot = crate::tools::code::computer::run(&ctx, "computer_screenshot", &serde_json::json!({})).await;
            if shot.is_error { return Err(format!("agent screenshot failed after handoff: {}", shot.content)); }
            if db.computer_needs_observation(&conversation).map_err(|e| e.to_string())? {
                return Err("successful observation did not clear the requirement".into());
            }
            println!("Production handoff: agent observed successfully only after RFB cleanup");
            let _ = press(&mut second).await;
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    match second.next().await {
                        None | Some(Err(_)) | Some(Ok(Message::Close(_))) => break,
                        _ => {},
                    }
                }
            }).await.map_err(|_| "revoked RFB socket still open".to_string())?;
            if tokio_tungstenite::connect_async(&second_url).await.is_ok() {
                return Err("one-use RFB URL was accepted again".into());
            }
            wait_state(&name, query, "0 0").await?;
            db.set_computer_control(&conversation, Some(true), Some(true), 3).map_err(|e| e.to_string())?;
            db.set_computer_control_target(&conversation, "desktop").map_err(|e| e.to_string())?;
            let third_url = open(db.clone(), conversation.clone(), name.clone(), true).await?;
            let mut third = connect_rfb(&third_url).await.map_err(|e| format!("third RFB connection: {e}"))?;
            if press(&mut second).await.is_ok() {
                return Err("old RFB socket accepted input after retake".into());
            }
            println!("RFB retake case: old socket and one-use URL rejected");
            wait_state(&name, query, "0 0").await?;
            press(&mut third).await?;
            wait_state(&name, query, "1 1").await?;
            println!("RFB retake case: fresh connection can press input (1 1)");
            drop(third);
            let _guard = tokio::time::timeout(Duration::from_secs(25), gate.drain_interactive_stream()).await
                .map_err(|e| e.to_string())??;
            wait_state(&name, query, "0 0").await?;
            println!("RFB retake case: final disconnect cleared input (0 0)");
            Ok::<(), String>(())
        }.await;
        let cleanup = super::super::remove_container(&settings, dir.path(), &conversation).await;
        result.expect("RFB input, disconnection, revocation and retake");
        cleanup.expect("remove test container");
    }

    #[tokio::test]
    #[ignore = "requires Docker and the zylara/computer:test image"]
    async fn private_desktop_bridge_reads_rfb_without_container_network() {
        let dir = tempfile::tempdir().expect("temporary directory");
        let db = Arc::new(Db::open(&dir.path().join("test.db")).expect("database"));
        let settings = Settings {
            execution_environment: "docker".into(),
            computer_docker_image: "zylara/computer:test".into(),
            computer_docker_container: format!(
                "zylara-stream-it-{}",
                uuid::Uuid::new_v4().simple()
            ),
            docker_network: false,
            ..Settings::default()
        };
        let conversation = "stream-test";
        super::super::ensure_container(&settings, dir.path(), conversation)
            .await
            .expect("container starts");
        let name = super::super::container_for(&settings, conversation);
        let url = open(db.clone(), conversation.into(), name.clone(), false)
            .await
            .expect("viewer bridge");
        let result = async {
            let (mut ws, _) = tokio_tungstenite::connect_async(url)
                .await
                .map_err(|e| e.to_string())?;
            let banner = tokio::time::timeout(Duration::from_secs(15), ws.next())
                .await
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "RFB connection closed".to_string())?
                .map_err(|e| e.to_string())?;
            if !banner.into_data().starts_with(b"RFB ") {
                return Err("invalid RFB banner".to_string());
            }
            Ok::<(), String>(())
        }
        .await;
        let control_result = async {
            db.set_computer_control(conversation, Some(true), Some(true), 1)
                .map_err(|e| e.to_string())?;
            db.set_computer_control_target(conversation, "desktop")
                .map_err(|e| e.to_string())?;
            let url = open(db.clone(), conversation.into(), name, true).await?;
            let (mut ws, _) = tokio_tungstenite::connect_async(url)
                .await
                .map_err(|e| e.to_string())?;
            let banner = tokio::time::timeout(Duration::from_secs(15), ws.next())
                .await
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "control connection closed".to_string())?
                .map_err(|e| e.to_string())?;
            if !banner.into_data().starts_with(b"RFB ") {
                return Err("invalid control RFB banner".into());
            }
            db.set_computer_control(conversation, Some(false), Some(false), 2)
                .map_err(|e| e.to_string())?;
            super::super::control::gate(conversation).request_takeover();
            match tokio::time::timeout(Duration::from_secs(10), ws.next()).await {
                Ok(None) | Ok(Some(Ok(Message::Close(_)))) | Ok(Some(Err(_))) => Ok(()),
                _ => Err("control connection was not revoked".to_string()),
            }
        }
        .await;
        let _ = super::super::remove_container(&settings, dir.path(), conversation).await;
        result.expect("RFB bridge");
        control_result.expect("revoked RFB bridge");
    }
}
