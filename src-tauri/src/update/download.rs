//! Verified, cancellable download of a release artifact.
//!
//! Bytes are streamed to a `.partial` file, hashed while they arrive and only
//! promoted to the final name after the SHA-256 from `release.json` matches.
//! A failed or cancelled download never leaves an executable behind.

use std::io::Read;
use std::path::Path;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tokio::io::AsyncWriteExt;

use super::feed;
use super::{DownloadResult, DownloadedUpdate, UpdateAsset, UpdateEvent, UpdateState};

const MAX_DOWNLOAD_BYTES: u64 = 1_500_000_000;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(120);
const READ_TIMEOUT: Duration = Duration::from_secs(60);

/// Streams the selected artifact and returns the verified file.
pub async fn run(
    client: &reqwest::Client,
    state: &UpdateState,
    version: &str,
    asset: &UpdateAsset,
    base: &str,
    on_event: &Channel<UpdateEvent>,
) -> Result<DownloadResult> {
    if !feed::is_allowed_url(&asset.download_url, base) {
        bail!("URL de download fora do repositório oficial");
    }
    if asset.size == 0 || asset.size > MAX_DOWNLOAD_BYTES {
        bail!("tamanho de atualização inválido");
    }
    let final_path = state
        .download_path(version, &asset.name)
        .context("nome de artefato inválido")?;
    let parent = final_path
        .parent()
        .context("pasta de atualizações inválida")?;
    tokio::fs::create_dir_all(parent)
        .await
        .with_context(|| format!("falha ao criar {}", parent.display()))?;
    let partial_path = final_path.with_file_name(format!("{}.partial", asset.name));
    let _ = tokio::fs::remove_file(&partial_path).await;
    let _ = tokio::fs::remove_file(&final_path).await;

    let result = stream(
        client,
        state,
        asset,
        version,
        &partial_path,
        &final_path,
        on_event,
    )
    .await;

    if result.is_err() {
        let _ = tokio::fs::remove_file(&partial_path).await;
    }
    result
}

async fn stream(
    client: &reqwest::Client,
    state: &UpdateState,
    asset: &UpdateAsset,
    version: &str,
    partial_path: &Path,
    final_path: &Path,
    on_event: &Channel<UpdateEvent>,
) -> Result<DownloadResult> {
    let mut response = client
        .get(&asset.download_url)
        .header("Accept", "application/octet-stream")
        .send()
        .await
        .context("falha ao baixar a atualização")?;
    if !response.status().is_success() {
        bail!(
            "servidor respondeu {} ao baixar a atualização",
            response.status()
        );
    }
    if let Some(length) = response.content_length() {
        if length != asset.size {
            bail!(
                "tamanho do download ({length}) difere do release.json ({})",
                asset.size
            );
        }
    }
    if state.cancel_requested() {
        let _ = on_event.send(UpdateEvent::Cancelled);
        return Ok(DownloadResult {
            cancelled: true,
            download: None,
        });
    }

    let _ = on_event.send(UpdateEvent::Started {
        name: asset.name.clone(),
        total: asset.size,
    });

    let mut file = tokio::fs::File::create(partial_path)
        .await
        .with_context(|| format!("falha ao criar {}", partial_path.display()))?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut last_emit = Instant::now() - PROGRESS_INTERVAL;
    let mut last_percent = -1.0f32;
    let started = Instant::now();

    loop {
        if state.cancel_requested() {
            let _ = file.flush().await;
            drop(file);
            let _ = tokio::fs::remove_file(partial_path).await;
            let _ = on_event.send(UpdateEvent::Cancelled);
            return Ok(DownloadResult {
                cancelled: true,
                download: None,
            });
        }

        let Some(chunk) = tokio::time::timeout(READ_TIMEOUT, response.chunk())
            .await
            .map_err(|_| anyhow::anyhow!("o download parou de responder"))?
            .context("download interrompido")?
        else {
            break;
        };
        received = received.saturating_add(chunk.len() as u64);
        if received > asset.size || received > MAX_DOWNLOAD_BYTES {
            bail!("download maior que o esperado");
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .context("falha ao gravar a atualização")?;

        let percent = progress_percent(received, asset.size);
        let elapsed = started.elapsed();
        let emit_due = received == asset.size
            || last_emit.elapsed() >= PROGRESS_INTERVAL
            || percent - last_percent >= 1.0;
        if emit_due {
            let seconds = elapsed.as_secs_f64().max(0.001);
            let _ = on_event.send(UpdateEvent::Progress {
                received,
                total: asset.size,
                percent,
                bytes_per_sec: (received as f64 / seconds).round() as u64,
            });
            last_emit = Instant::now();
            last_percent = percent;
        }
    }

    file.flush()
        .await
        .context("falha ao finalizar o download")?;
    drop(file);

    if state.cancel_requested() {
        let _ = tokio::fs::remove_file(partial_path).await;
        let _ = on_event.send(UpdateEvent::Cancelled);
        return Ok(DownloadResult {
            cancelled: true,
            download: None,
        });
    }
    if received != asset.size {
        bail!("download incompleto: {received} de {} bytes", asset.size);
    }

    let _ = on_event.send(UpdateEvent::Verifying);
    let digest: String = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    if !digest.eq_ignore_ascii_case(&asset.sha256) {
        bail!("o arquivo baixado não corresponde ao SHA-256 esperado");
    }
    if state.cancel_requested() {
        let _ = tokio::fs::remove_file(partial_path).await;
        let _ = on_event.send(UpdateEvent::Cancelled);
        return Ok(DownloadResult {
            cancelled: true,
            download: None,
        });
    }

    tokio::fs::rename(partial_path, final_path)
        .await
        .with_context(|| format!("falha ao finalizar {}", final_path.display()))?;

    let download = DownloadedUpdate {
        version: version.to_string(),
        path: final_path.to_string_lossy().to_string(),
        size: asset.size,
        sha256: asset.sha256.clone(),
    };
    let _ = on_event.send(UpdateEvent::Done {
        download: download.clone(),
    });
    Ok(DownloadResult {
        cancelled: false,
        download: Some(download),
    })
}

fn progress_percent(received: u64, total: u64) -> f32 {
    if total == 0 {
        return 0.0;
    }
    let percent = (received as f64 / total as f64) * 100.0;
    (percent.clamp(0.0, 100.0) * 10.0).round() as f32 / 10.0
}

/// SHA-256 of a file. Used again right before launching the installer so a
/// file modified on disk is never executed.
pub fn sha256_file(path: &Path) -> Result<String> {
    let mut file =
        std::fs::File::open(path).with_context(|| format!("falha ao abrir {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .with_context(|| format!("falha ao ler {}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};
    use std::thread::JoinHandle;

    use serde_json::Value;
    use tauri::ipc::InvokeResponseBody;

    use crate::update::UpdateState;

    #[test]
    fn computes_the_sha256_of_a_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("artifact.bin");
        std::fs::write(&path, b"zylara").expect("gravar");
        let expected = Sha256::digest(b"zylara")
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        assert_eq!(sha256_file(&path).expect("hash"), expected);
    }

    #[test]
    fn formats_progress_with_one_decimal_and_clamps() {
        assert_eq!(progress_percent(0, 100), 0.0);
        assert_eq!(progress_percent(42, 100), 42.0);
        assert_eq!(progress_percent(999, 100), 100.0);
        assert_eq!(progress_percent(1, 3), 33.3);
        assert_eq!(progress_percent(10, 0), 0.0);
    }

    fn hash(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    /// Minimal one-shot HTTP server used to exercise the real streaming path.
    fn serve_once(payload: Vec<u8>, declared_size: Option<usize>) -> (String, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let handle = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut request = [0u8; 4096];
                let _ = stream.read(&mut request);
                let length = declared_size.unwrap_or(payload.len());
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n"
                );
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(&payload);
                let _ = stream.flush();
            }
        });
        (format!("http://127.0.0.1:{port}"), handle)
    }

    fn asset(base: &str, sha256: String, size: u64) -> UpdateAsset {
        UpdateAsset {
            name: "artifact.bin".into(),
            size,
            sha256,
            download_url: format!("{base}/releases/download/v0.2.0/artifact.bin"),
            platform_label: "Teste".into(),
            kind: "setup".into(),
        }
    }

    fn sink() -> (Channel<UpdateEvent>, Arc<Mutex<Vec<Value>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let target = Arc::clone(&events);
        let channel = Channel::<UpdateEvent>::new(move |body| {
            if let InvokeResponseBody::Json(json) = body {
                if let Ok(value) = serde_json::from_str::<Value>(&json) {
                    target.lock().expect("lock").push(value);
                }
            }
            Ok(())
        });
        (channel, events)
    }

    #[tokio::test]
    async fn downloads_verifies_and_promotes_the_artifact() {
        let payload = b"zylara-update-payload".to_vec();
        let expected = hash(&payload);
        let (base, server) = serve_once(payload.clone(), None);
        let dir = tempfile::tempdir().expect("tempdir");
        let state = UpdateState::new(dir.path().to_path_buf());
        let (channel, events) = sink();
        let item = asset(&base, expected.clone(), payload.len() as u64);
        let client = crate::http::client();

        let result = run(&client, &state, "0.2.0", &item, &base, &channel)
            .await
            .expect("download");
        server.join().expect("server");

        let download = result.download.expect("verified download");
        assert!(!result.cancelled);
        assert_eq!(download.sha256, expected);
        assert_eq!(std::fs::read(&download.path).expect("ler"), payload);
        assert!(!std::path::Path::new(&download.path)
            .with_file_name("artifact.bin.partial")
            .exists());

        let kinds: Vec<String> = events
            .lock()
            .expect("lock")
            .iter()
            .filter_map(|event| event["kind"].as_str().map(str::to_string))
            .collect();
        assert!(kinds.contains(&"started".to_string()));
        assert!(kinds.contains(&"progress".to_string()));
        assert!(kinds.contains(&"verifying".to_string()));
        assert_eq!(kinds.last().map(String::as_str), Some("done"));
    }

    #[tokio::test]
    async fn rejects_a_hash_mismatch_and_removes_the_partial_file() {
        let payload = b"tampered".to_vec();
        let (base, server) = serve_once(payload.clone(), None);
        let dir = tempfile::tempdir().expect("tempdir");
        let state = UpdateState::new(dir.path().to_path_buf());
        let (channel, _) = sink();
        let item = asset(&base, hash(b"expected"), payload.len() as u64);
        let client = crate::http::client();

        let error = run(&client, &state, "0.2.0", &item, &base, &channel)
            .await
            .expect_err("hash inválido");
        server.join().expect("server");
        assert!(format!("{error:#}").to_ascii_lowercase().contains("sha"));

        let version_dir = state.updates_root().join("0.2.0");
        assert!(
            !version_dir.exists()
                || std::fs::read_dir(&version_dir)
                    .expect("listar")
                    .filter_map(Result::ok)
                    .next()
                    .is_none()
        );
    }

    #[tokio::test]
    async fn rejects_a_content_length_that_differs_from_the_manifest() {
        let payload = b"short".to_vec();
        let (base, server) = serve_once(payload.clone(), Some(999));
        let dir = tempfile::tempdir().expect("tempdir");
        let state = UpdateState::new(dir.path().to_path_buf());
        let (channel, _) = sink();
        let item = asset(&base, hash(&payload), payload.len() as u64);
        let client = crate::http::client();

        let error = run(&client, &state, "0.2.0", &item, &base, &channel)
            .await
            .expect_err("tamanho inválido");
        server.join().expect("server");
        assert!(format!("{error:#}").contains("tamanho"));
    }

    #[tokio::test]
    async fn a_cancelled_download_never_writes_the_executable() {
        let payload = b"cancelled".to_vec();
        let (base, server) = serve_once(payload.clone(), None);
        let dir = tempfile::tempdir().expect("tempdir");
        let state = UpdateState::new(dir.path().to_path_buf());
        state.request_cancel();
        let (channel, _) = sink();
        let item = asset(&base, hash(&payload), payload.len() as u64);
        let client = crate::http::client();

        let result = run(&client, &state, "0.2.0", &item, &base, &channel)
            .await
            .expect("cancelado");
        server.join().expect("server");
        assert!(result.cancelled);
        assert!(result.download.is_none());
        assert!(!state
            .updates_root()
            .join("0.2.0")
            .join("artifact.bin")
            .exists());
    }
}
