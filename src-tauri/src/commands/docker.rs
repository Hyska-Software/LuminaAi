//! Docker inspection/maintenance commands for the production sandbox.
//!
//! Execution itself lives in `workspace::exec`; these commands only surface
//! daemon/image state and let the user pull/validate/clean images explicitly.

use std::time::Duration;

use serde::Serialize;
use tauri::State;
use tokio_util::sync::CancellationToken;

use crate::state::AppState;
use crate::workspace::exec::{self, ExecRequest};

fn to_error(error: impl std::fmt::Display) -> String {
    format!("{error:#}")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerStatus {
    pub available: bool,
    pub server_version: Option<String>,
    pub images: Vec<String>,
    pub error: Option<String>,
}

async fn docker(
    state: &AppState,
    args: Vec<String>,
    timeout: Duration,
) -> anyhow::Result<exec::ExecOutput> {
    exec::run(
        ExecRequest {
            program: "docker".to_string(),
            args,
            cwd: state.data_dir.clone(),
            env: exec::sanitized_env(&[]),
            timeout,
            cancel: CancellationToken::new(),
            max_output_bytes: 2 * 1024 * 1024,
        },
        None,
    )
    .await
    .map_err(|error| anyhow::anyhow!("{error}"))
}

#[tauri::command]
pub async fn docker_status(state: State<'_, AppState>) -> Result<DockerStatus, String> {
    let version = docker(
        &state,
        vec!["version".into(), "--format".into(), "{{.Server.Version}}".into()],
        Duration::from_secs(10),
    )
    .await;
    match version {
        Ok(output) if output.exit_code == Some(0) => {
            let images = docker(
                &state,
                vec![
                    "images".into(),
                    "--format".into(),
                    "{{.Repository}}:{{.Tag}}|{{.ID}}|{{.Size}}".into(),
                ],
                Duration::from_secs(10),
            )
            .await
            .ok()
            .map(|value| {
                value
                    .stdout
                    .lines()
                    .filter(|line| !line.trim().is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
            Ok(DockerStatus {
                available: true,
                server_version: Some(output.stdout.trim().to_string()),
                images,
                error: None,
            })
        }
        Ok(output) => Ok(DockerStatus {
            available: false,
            server_version: None,
            images: Vec::new(),
            error: Some(output.stderr.trim().to_string()),
        }),
        Err(error) => Ok(DockerStatus {
            available: false,
            server_version: None,
            images: Vec::new(),
            error: Some(format!("{error:#}")),
        }),
    }
}

#[tauri::command]
pub async fn docker_pull_image(
    state: State<'_, AppState>,
    image: String,
) -> Result<String, String> {
    let image = image.trim();
    if image.is_empty() || image.chars().count() > 200 {
        return Err("DOCKER_IMAGE_INVALID: informe uma imagem válida".to_string());
    }
    let output = docker(
        &state,
        vec!["pull".into(), image.to_string()],
        Duration::from_secs(600),
    )
    .await
    .map_err(to_error)?;
    if output.exit_code != Some(0) {
        return Err(format!(
            "DOCKER_PULL_FAILED: {}",
            output.stderr.trim()
        ));
    }
    Ok(output.stdout.lines().last().unwrap_or_default().to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerImageInfo {
    pub image: String,
    pub id: String,
    pub architecture: String,
}

#[tauri::command]
pub async fn docker_validate_image(
    state: State<'_, AppState>,
    image: String,
) -> Result<DockerImageInfo, String> {
    let image = image.trim();
    if image.is_empty() || image.chars().count() > 200 {
        return Err("DOCKER_IMAGE_INVALID: informe uma imagem válida".to_string());
    }
    let inspect = docker(
        &state,
        vec![
            "image".into(),
            "inspect".into(),
            image.to_string(),
            "--format".into(),
            "{{.Id}}|{{.Architecture}}".into(),
        ],
        Duration::from_secs(20),
    )
    .await
    .map_err(to_error)?;
    if inspect.exit_code != Some(0) {
        return Err(format!(
            "DOCKER_IMAGE_MISSING: {} — rode o pull antes",
            inspect.stderr.trim()
        ));
    }
    let mut parts = inspect.stdout.trim().split('|');
    let id = parts.next().unwrap_or_default().to_string();
    let architecture = parts.next().unwrap_or_default().to_string();
    // A real smoke run catches broken entrypoints before the agent does.
    let smoke = docker(
        &state,
        vec![
            "run".into(),
            "--rm".into(),
            "--cap-drop".into(),
            "ALL".into(),
            "--security-opt".into(),
            "no-new-privileges".into(),
            "--network".into(),
            "none".into(),
            image.to_string(),
            "sh".into(),
            "-lc".into(),
            "true".into(),
        ],
        Duration::from_secs(60),
    )
    .await
    .map_err(to_error)?;
    if smoke.exit_code != Some(0) {
        return Err(format!(
            "DOCKER_IMAGE_UNHEALTHY: {}",
            smoke.stderr.trim()
        ));
    }
    Ok(DockerImageInfo {
        image: image.to_string(),
        id,
        architecture,
    })
}

/// Removes every container labeled `zylara.owner=zylara`. Used by the
/// command and by the boot cleanup; active containers are only removed at boot.
pub async fn cleanup_containers(state: &AppState) -> Result<u32, String> {
    let listed = docker(
        state,
        vec![
            "ps".into(),
            "-aq".into(),
            "--filter".into(),
            "label=zylara.owner=zylara".into(),
        ],
        Duration::from_secs(10),
    )
    .await
    .map_err(to_error)?;
    let ids: Vec<String> = listed
        .stdout
        .split_whitespace()
        .map(str::to_string)
        .collect();
    if !ids.is_empty() {
        let mut args = vec!["rm".into(), "-f".into()];
        args.extend(ids.iter().cloned());
        let removed = docker(state, args, Duration::from_secs(30))
            .await
            .map_err(to_error)?;
        if removed.exit_code != Some(0) {
            return Err(format!(
                "DOCKER_CLEANUP_FAILED: {}",
                removed.stderr.trim()
            ));
        }
    }
    Ok(ids.len() as u32)
}

#[tauri::command]
pub async fn docker_cleanup(state: State<'_, AppState>) -> Result<u32, String> {
    cleanup_containers(state.inner()).await
}
