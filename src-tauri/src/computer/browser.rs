//! Local Chromium/Edge browser session driven over the DevTools Protocol.
//!
//! The agent never talks to the user's personal browser profile: each
//! conversation gets an isolated profile under `<app-data>/browser/`, a random
//! loopback debugging port, and a dedicated Chromium process. The panel mirrors
//! the active page with CDP screenshots; the agent uses accessibility refs for
//! click/type, not coordinates or arbitrary JS.

use std::collections::HashMap;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio_tungstenite::{connect_async, tungstenite::Message};

const START_TIMEOUT: Duration = Duration::from_secs(20);
const CDP_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_SNAPSHOT_ELEMENTS: usize = 200;
const MAX_EXTRACT_CHARS: usize = 30_000;

static GLOBAL: OnceLock<BrowserManager> = OnceLock::new();

pub fn init_global(data_dir: &Path) {
    let _ = GLOBAL.set(BrowserManager::new(data_dir.to_path_buf()));
}

pub fn global() -> Option<&'static BrowserManager> {
    GLOBAL.get()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTab {
    pub id: String,
    pub title: String,
    pub url: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub executable: Option<String>,
    pub profile_dir: Option<String>,
    pub download_dir: Option<String>,
    pub tabs: Vec<BrowserTab>,
    pub active_tab: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserFrame {
    pub data_url: String,
    pub url: String,
    pub title: String,
    pub width: u32,
    pub height: u32,
    pub captured_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserElement {
    #[serde(rename = "ref")]
    pub reference: String,
    pub role: String,
    pub name: String,
    pub value: String,
    pub disabled: bool,
    pub backend_node_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSnapshot {
    pub url: String,
    pub title: String,
    pub elements: Vec<BrowserElement>,
    pub screenshot: Option<String>,
    pub width: u32,
    pub height: u32,
    pub captured_at: i64,
}

struct BrowserSession {
    child: Child,
    port: u16,
    executable: String,
    profile_dir: PathBuf,
    download_dir: PathBuf,
    active_tab: Mutex<Option<String>>,
    refs: Mutex<HashMap<String, Vec<BrowserElement>>>,
}

impl BrowserSession {
    fn pid(&self) -> u32 {
        self.child.id()
    }
}

/// Process-wide manager; the app has one browser process per conversation.
pub struct BrowserManager {
    data_dir: PathBuf,
    sessions: Mutex<HashMap<String, BrowserSession>>,
    start_lock: tokio::sync::Mutex<()>,
    http: reqwest::Client,
}

impl BrowserManager {
    fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            sessions: Mutex::new(HashMap::new()),
            start_lock: tokio::sync::Mutex::new(()),
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap_or_default(),
        }
    }

    fn safe_id(value: &str) -> String {
        value
            .chars()
            .map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '-' })
            .collect()
    }

    fn profile_dir(&self, conversation_id: &str) -> PathBuf {
        self.data_dir
            .join("browser")
            .join(Self::safe_id(conversation_id))
    }

    fn default_download_dir(&self, conversation_id: &str) -> PathBuf {
        self.data_dir
            .join("browser-downloads")
            .join(Self::safe_id(conversation_id))
    }

    fn is_running(session: &mut BrowserSession) -> bool {
        matches!(session.child.try_wait(), Ok(None))
    }

    /// True when a live browser is attached to this conversation.
    pub fn is_active(&self, conversation_id: &str) -> bool {
        let mut sessions = self.sessions.lock();
        let Some(session) = sessions.get_mut(conversation_id) else {
            return false;
        };
        if Self::is_running(session) {
            return true;
        }
        sessions.remove(conversation_id);
        false
    }

    async fn endpoint_json(&self, port: u16, path: &str) -> Result<Value, String> {
        let url = format!("http://127.0.0.1:{port}{path}");
        let response = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|error| format!("BROWSER_CDP_UNREACHABLE: {error}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "BROWSER_CDP_HTTP: {} em {url}",
                response.status()
            ));
        }
        response
            .json()
            .await
            .map_err(|error| format!("BROWSER_CDP_INVALID: {error}"))
    }

    async fn tabs_of(&self, port: u16, active: Option<&str>) -> Result<Vec<BrowserTab>, String> {
        let value = self.endpoint_json(port, "/json/list").await?;
        let items = value.as_array().cloned().unwrap_or_default();
        let mut tabs = Vec::new();
        for item in items {
            if item.get("type").and_then(Value::as_str) != Some("page") {
                continue;
            }
            let Some(id) = item.get("id").and_then(Value::as_str) else {
                continue;
            };
            let url = item.get("url").and_then(Value::as_str).unwrap_or("about:blank");
            // DevTools internal targets are not part of the user's browser.
            if url.starts_with("devtools://") {
                continue;
            }
            tabs.push(BrowserTab {
                id: id.to_string(),
                title: item
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Nova aba")
                    .to_string(),
                url: url.to_string(),
                active: active == Some(id),
            });
        }
        if !tabs.is_empty() && !tabs.iter().any(|tab| tab.active) {
            if let Some(first) = tabs.first_mut() {
                first.active = true;
            }
        }
        Ok(tabs)
    }

    pub async fn status(&self, conversation_id: &str) -> BrowserStatus {
        let info = {
            let mut sessions = self.sessions.lock();
            let info = if let Some(session) = sessions.get_mut(conversation_id) {
                if Self::is_running(session) {
                    Some((
                        session.port,
                        session.executable.clone(),
                        session.profile_dir.to_string_lossy().to_string(),
                        session.download_dir.to_string_lossy().to_string(),
                        session.active_tab.lock().clone(),
                    ))
                } else {
                    None
                }
            } else {
                None
            };
            if info.is_none() {
                sessions.remove(conversation_id);
            }
            info
        };
        let Some((port, executable, profile_dir, download_dir, active)) = info else {
            return BrowserStatus {
                running: false,
                port: None,
                executable: None,
                profile_dir: None,
                download_dir: None,
                tabs: Vec::new(),
                active_tab: None,
            };
        };
        let tabs = self.tabs_of(port, active.as_deref()).await.unwrap_or_default();
        let active_tab = active
            .filter(|id| tabs.iter().any(|tab| &tab.id == id))
            .or_else(|| tabs.first().map(|tab| tab.id.clone()));
        BrowserStatus {
            running: true,
            port: Some(port),
            executable: Some(executable),
            profile_dir: Some(profile_dir),
            download_dir: Some(download_dir),
            tabs,
            active_tab,
        }
    }

    /// Starts the isolated browser if needed and returns its current status.
    pub async fn ensure(
        &self,
        conversation_id: &str,
        download_dir: Option<PathBuf>,
    ) -> Result<BrowserStatus, String> {
        let _guard = self.start_lock.lock().await;
        if self.is_active(conversation_id) {
            return Ok(self.status(conversation_id).await);
        }
        let executable = find_browser_executable()
            .ok_or_else(|| "BROWSER_NOT_FOUND: Chrome/Edge não encontrado neste computador".to_string())?;
        let profile = self.profile_dir(conversation_id);
        std::fs::create_dir_all(&profile)
            .map_err(|error| format!("BROWSER_PROFILE: {error}"))?;
        let downloads = download_dir
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| self.default_download_dir(conversation_id));
        std::fs::create_dir_all(&downloads)
            .map_err(|error| format!("BROWSER_DOWNLOAD_DIR: {error}"))?;
        let port = free_port()?;
        let mut command = Command::new(&executable);
        command
            .arg(format!("--remote-debugging-port={port}"))
            .arg("--remote-debugging-address=127.0.0.1")
            .arg(format!("--user-data-dir={}", profile.display()))
            .arg("--no-first-run")
            .arg("--no-default-browser-check")
            .arg("--disable-background-networking")
            .arg("--disable-component-update")
            .arg("--disable-default-apps")
            .arg("--disable-extensions")
            .arg("--disable-sync")
            .arg("--disable-features=Translate,MediaRouter")
            .arg("--window-size=1280,820")
            .arg("about:blank")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            // Keep the child attached to this process but never open a console.
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let child = command
            .spawn()
            .map_err(|error| format!("BROWSER_SPAWN: {error}"))?;
        let pid = child.id();
        let session = BrowserSession {
            child,
            port,
            executable: executable.to_string_lossy().to_string(),
            profile_dir: profile,
            download_dir: downloads.clone(),
            active_tab: Mutex::new(None),
            refs: Mutex::new(HashMap::new()),
        };
        self.sessions
            .lock()
            .insert(conversation_id.to_string(), session);

        // Wait for the DevTools endpoint. A broken browser must not linger.
        let started = Instant::now();
        loop {
            if let Ok(value) = self.endpoint_json(port, "/json/version").await {
                let _ = value;
                break;
            }
            if started.elapsed() > START_TIMEOUT {
                self.close(conversation_id);
                return Err("BROWSER_START_TIMEOUT: o navegador não abriu o CDP".to_string());
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
        if let Some(version) = self.endpoint_json(port, "/json/version").await.ok() {
            if let Some(ws) = version.get("webSocketDebuggerUrl").and_then(Value::as_str) {
                let _ = cdp_call(
                    ws,
                    "Browser.setDownloadBehavior",
                    json!({ "behavior": "allow", "downloadPath": downloads.to_string_lossy() }),
                )
                .await;
            }
        }
        let _ = pid;
        Ok(self.status(conversation_id).await)
    }

    pub fn close(&self, conversation_id: &str) -> bool {
        let Some(mut session) = self.sessions.lock().remove(conversation_id) else {
            return false;
        };
        let _ = session.child.kill();
        let _ = session.child.wait();
        true
    }

    pub fn close_all(&self) {
        let mut sessions = self.sessions.lock();
        for (_, mut session) in sessions.drain() {
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
    }

    async fn session_port(&self, conversation_id: &str) -> Result<(u16, String), String> {
        let mut sessions = self.sessions.lock();
        let session = sessions
            .get_mut(conversation_id)
            .ok_or_else(|| "BROWSER_NOT_RUNNING: abra o navegador primeiro".to_string())?;
        if !Self::is_running(session) {
            sessions.remove(conversation_id);
            return Err("BROWSER_NOT_RUNNING: o navegador foi encerrado".to_string());
        }
        Ok((session.port, session.executable.clone()))
    }

    async fn tab_ws(&self, port: u16, tab_id: Option<&str>) -> Result<String, String> {
        let value = self.endpoint_json(port, "/json/list").await?;
        let items = value.as_array().cloned().unwrap_or_default();
        let target = match tab_id {
            Some(id) => items
                .iter()
                .find(|item| item.get("id").and_then(Value::as_str) == Some(id)),
            None => items
                .iter()
                .find(|item| item.get("type").and_then(Value::as_str) == Some("page")),
        }
        .ok_or_else(|| "BROWSER_TAB_NOT_FOUND: aba não encontrada".to_string())?;
        target
            .get("webSocketDebuggerUrl")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "BROWSER_CDP_INVALID: aba sem WebSocket de debug".to_string())
    }

    async fn active_tab_id(&self, conversation_id: &str, port: u16) -> Result<String, String> {
        let active = self
            .sessions
            .lock()
            .get(conversation_id)
            .and_then(|session| session.active_tab.lock().clone());
        if let Some(active) = active {
            return Ok(active);
        }
        let tabs = self.tabs_of(port, None).await?;
        tabs.first()
            .map(|tab| tab.id.clone())
            .ok_or_else(|| "BROWSER_TAB_NOT_FOUND: nenhuma aba aberta".to_string())
    }

    pub async fn tabs(&self, conversation_id: &str) -> Result<Vec<BrowserTab>, String> {
        let (port, _) = self.session_port(conversation_id).await?;
        let active = self
            .sessions
            .lock()
            .get(conversation_id)
            .and_then(|session| session.active_tab.lock().clone());
        self.tabs_of(port, active.as_deref()).await
    }

    pub async fn new_tab(
        &self,
        conversation_id: &str,
        url: Option<&str>,
    ) -> Result<BrowserTab, String> {
        let (port, _) = self.session_port(conversation_id).await?;
        let target = normalize_navigation(url.unwrap_or("about:blank"))?;
        let encoded: String = url::form_urlencoded::byte_serialize(target.as_bytes()).collect();
        let request = self
            .http
            .put(format!("http://127.0.0.1:{port}/json/new?{encoded}"))
            .send()
            .await
            .map_err(|error| format!("BROWSER_TAB_FAILED: {error}"))?;
        let value: Value = request
            .json()
            .await
            .map_err(|error| format!("BROWSER_TAB_INVALID: {error}"))?;
        let id = value
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "BROWSER_TAB_INVALID: resposta sem id".to_string())?
            .to_string();
        if let Some(session) = self.sessions.lock().get(conversation_id) {
            *session.active_tab.lock() = Some(id.clone());
        }
        Ok(BrowserTab {
            id,
            title: value
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Nova aba")
                .to_string(),
            url: value
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or("about:blank")
                .to_string(),
            active: true,
        })
    }

    pub async fn close_tab(&self, conversation_id: &str, tab_id: &str) -> Result<(), String> {
        let (port, _) = self.session_port(conversation_id).await?;
        let _ = self
            .http
            .get(format!("http://127.0.0.1:{port}/json/close/{tab_id}"))
            .send()
            .await
            .map_err(|error| format!("BROWSER_TAB_CLOSE: {error}"))?;
        if let Some(session) = self.sessions.lock().get(conversation_id) {
            let mut active = session.active_tab.lock();
            if active.as_deref() == Some(tab_id) {
                *active = None;
            }
            session.refs.lock().remove(tab_id);
        }
        Ok(())
    }

    pub async fn activate_tab(&self, conversation_id: &str, tab_id: &str) -> Result<(), String> {
        let (port, _) = self.session_port(conversation_id).await?;
        let _ = self
            .http
            .get(format!("http://127.0.0.1:{port}/json/activate/{tab_id}"))
            .send()
            .await
            .map_err(|error| format!("BROWSER_TAB_ACTIVATE: {error}"))?;
        if let Some(session) = self.sessions.lock().get(conversation_id) {
            *session.active_tab.lock() = Some(tab_id.to_string());
        }
        Ok(())
    }

    pub async fn navigate(
        &self,
        conversation_id: &str,
        tab_id: Option<&str>,
        url: &str,
    ) -> Result<String, String> {
        let (port, _) = self.session_port(conversation_id).await?;
        let target = normalize_navigation(url)?;
        let tab = match tab_id {
            Some(id) => id.to_string(),
            None => self.active_tab_id(conversation_id, port).await?,
        };
        let ws = self.tab_ws(port, Some(&tab)).await?;
        cdp_call(&ws, "Page.enable", json!({})).await?;
        cdp_call(&ws, "Page.navigate", json!({ "url": target })).await?;
        self.activate_tab(conversation_id, &tab).await?;
        self.wait_ready(&ws).await;
        Ok(target)
    }

    async fn wait_ready(&self, ws: &str) {
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(8) {
            if let Ok(result) = cdp_call(
                ws,
                "Runtime.evaluate",
                json!({ "expression": "document.readyState", "returnByValue": true }),
            )
            .await
            {
                if result
                    .get("result")
                    .and_then(|value| value.get("value"))
                    .and_then(Value::as_str)
                    == Some("complete")
                {
                    return;
                }
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }

    pub async fn history(
        &self,
        conversation_id: &str,
        tab_id: Option<&str>,
        action: &str,
    ) -> Result<(), String> {
        let (port, _) = self.session_port(conversation_id).await?;
        let tab = match tab_id {
            Some(id) => id.to_string(),
            None => self.active_tab_id(conversation_id, port).await?,
        };
        let ws = self.tab_ws(port, Some(&tab)).await?;
        match action {
            "reload" => {
                cdp_call(&ws, "Page.reload", json!({ "ignoreCache": true })).await?;
            }
            "back" | "forward" => {
                cdp_call(&ws, "Page.enable", json!({})).await?;
                let history = cdp_call(&ws, "Page.getNavigationHistory", json!({})).await?;
                let index = history
                    .get("currentIndex")
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                let entries = history
                    .get("entries")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let next = if action == "back" { index - 1 } else { index + 1 };
                if next < 0 || next as usize >= entries.len() {
                    return Ok(());
                }
                let entry_id = entries[next as usize]
                    .get("id")
                    .and_then(Value::as_i64)
                    .ok_or_else(|| "BROWSER_HISTORY_INVALID".to_string())?;
                cdp_call(
                    &ws,
                    "Page.navigateToHistoryEntry",
                    json!({ "entryId": entry_id }),
                )
                .await?;
            }
            other => return Err(format!("BROWSER_HISTORY_INVALID: ação `{other}`")),
        }
        Ok(())
    }

    pub async fn frame(
        &self,
        conversation_id: &str,
        tab_id: Option<&str>,
    ) -> Result<BrowserFrame, String> {
        let (port, _) = self.session_port(conversation_id).await?;
        let tab = match tab_id {
            Some(id) => id.to_string(),
            None => self.active_tab_id(conversation_id, port).await?,
        };
        let ws = self.tab_ws(port, Some(&tab)).await?;
        cdp_call(&ws, "Page.enable", json!({})).await?;
        let shot = cdp_call(
            &ws,
            "Page.captureScreenshot",
            json!({ "format": "jpeg", "quality": 70, "captureBeyondViewport": false }),
        )
        .await?;
        let data = shot
            .get("data")
            .and_then(Value::as_str)
            .ok_or_else(|| "BROWSER_FRAME_EMPTY".to_string())?;
        let meta = self.page_meta(&ws).await.unwrap_or_default();
        Ok(BrowserFrame {
            data_url: format!("data:image/jpeg;base64,{data}"),
            url: meta.0,
            title: meta.1,
            width: 1280,
            height: 820,
            captured_at: crate::domain::now_ms(),
        })
    }

    async fn page_meta(&self, ws: &str) -> Result<(String, String), String> {
        let value = cdp_call(
            ws,
            "Runtime.evaluate",
            json!({
                "expression": "({url: location.href, title: document.title})",
                "returnByValue": true,
            }),
        )
        .await?;
        let result = value.get("result").and_then(|value| value.get("value"));
        Ok((
            result
                .and_then(|value| value.get("url"))
                .and_then(Value::as_str)
                .unwrap_or("about:blank")
                .to_string(),
            result
                .and_then(|value| value.get("title"))
                .and_then(Value::as_str)
                .unwrap_or("Nova aba")
                .to_string(),
        ))
    }

    pub async fn snapshot(
        &self,
        conversation_id: &str,
        tab_id: Option<&str>,
    ) -> Result<BrowserSnapshot, String> {
        let (port, _) = self.session_port(conversation_id).await?;
        let tab = match tab_id {
            Some(id) => id.to_string(),
            None => self.active_tab_id(conversation_id, port).await?,
        };
        let ws = self.tab_ws(port, Some(&tab)).await?;
        cdp_call(&ws, "Accessibility.enable", json!({})).await?;
        let tree = cdp_call(&ws, "Accessibility.getFullAXTree", json!({})).await?;
        let nodes = tree
            .get("nodes")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut elements = Vec::new();
        for node in nodes {
            if elements.len() >= MAX_SNAPSHOT_ELEMENTS {
                break;
            }
            if node.get("ignored").and_then(Value::as_bool) == Some(true) {
                continue;
            }
            let role = node
                .get("role")
                .and_then(|value| value.get("value"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let name = node
                .get("name")
                .and_then(|value| value.get("value"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if name.trim().is_empty() && role.trim().is_empty() {
                continue;
            }
            let Some(backend) = node.get("backendDOMNodeId").and_then(Value::as_i64) else {
                continue;
            };
            let interactive = matches!(
                role,
                "button"
                    | "link"
                    | "textbox"
                    | "searchbox"
                    | "checkbox"
                    | "radio"
                    | "combobox"
                    | "menuitem"
                    | "tab"
                    | "switch"
                    | "slider"
                    | "spinbutton"
            );
            if !interactive && name.trim().is_empty() {
                continue;
            }
            let value = node
                .get("value")
                .and_then(|value| value.get("value"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let disabled = node
                .get("properties")
                .and_then(Value::as_array)
                .is_some_and(|properties| {
                    properties.iter().any(|property| {
                        property.get("name").and_then(Value::as_str) == Some("disabled")
                            && property
                                .get("value")
                                .and_then(|value| value.get("value"))
                                .and_then(Value::as_bool)
                                == Some(true)
                    })
                });
            elements.push(BrowserElement {
                reference: format!("e{}", elements.len() + 1),
                role: role.to_string(),
                name: name.chars().take(300).collect(),
                value: value.chars().take(300).collect(),
                disabled,
                backend_node_id: backend,
            });
        }
        if let Some(session) = self.sessions.lock().get(conversation_id) {
            session.refs.lock().insert(tab.clone(), elements.clone());
        }
        let meta = self.page_meta(&ws).await.unwrap_or_default();
        let shot = cdp_call(
            &ws,
            "Page.captureScreenshot",
            json!({ "format": "jpeg", "quality": 65, "captureBeyondViewport": false }),
        )
        .await
        .ok()
        .and_then(|value| value.get("data").and_then(Value::as_str).map(str::to_string));
        Ok(BrowserSnapshot {
            url: meta.0,
            title: meta.1,
            elements,
            screenshot: shot,
            width: 1280,
            height: 820,
            captured_at: crate::domain::now_ms(),
        })
    }

    fn lookup_ref(
        &self,
        conversation_id: &str,
        tab_id: Option<&str>,
        reference: &str,
    ) -> Result<BrowserElement, String> {
        let sessions = self.sessions.lock();
        let session = sessions
            .get(conversation_id)
            .ok_or_else(|| "BROWSER_NOT_RUNNING".to_string())?;
        let refs = session.refs.lock();
        let tab = tab_id
            .map(str::to_string)
            .or_else(|| session.active_tab.lock().clone())
            .ok_or_else(|| "BROWSER_TAB_NOT_FOUND".to_string())?;
        refs.get(&tab)
            .and_then(|items| items.iter().find(|item| item.reference == reference))
            .cloned()
            .ok_or_else(|| {
                format!("BROWSER_REF_NOT_FOUND: `{reference}`; chame browser_snapshot primeiro")
            })
    }

    pub async fn click(
        &self,
        conversation_id: &str,
        tab_id: Option<&str>,
        reference: &str,
    ) -> Result<BrowserElement, String> {
        let element = self.lookup_ref(conversation_id, tab_id, reference)?;
        let (port, _) = self.session_port(conversation_id).await?;
        let tab = match tab_id {
            Some(id) => id.to_string(),
            None => self.active_tab_id(conversation_id, port).await?,
        };
        let ws = self.tab_ws(port, Some(&tab)).await?;
        let mut client = CdpClient::connect(&ws).await?;
        let center = element_center(&mut client, element.backend_node_id).await;
        if let Some((x, y)) = center {
            client
                .call(
                    "Input.dispatchMouseEvent",
                    json!({
                        "type": "mouseMoved",
                        "x": x,
                        "y": y,
                    }),
                )
                .await?;
            client
                .call(
                    "Input.dispatchMouseEvent",
                    json!({
                        "type": "mousePressed",
                        "x": x,
                        "y": y,
                        "button": "left",
                        "clickCount": 1,
                        "buttons": 1,
                    }),
                )
                .await?;
            client
                .call(
                    "Input.dispatchMouseEvent",
                    json!({
                        "type": "mouseReleased",
                        "x": x,
                        "y": y,
                        "button": "left",
                        "clickCount": 1,
                        "buttons": 0,
                    }),
                )
                .await?;
        } else {
            // Some AX nodes have no layout box (e.g. an element inside a
            // closed shadow root); the DOM click fallback is still useful and
            // is explicit in the result.
            let object = client
                .call(
                    "DOM.resolveNode",
                    json!({ "backendNodeId": element.backend_node_id }),
                )
                .await?;
            let object_id = object
                .get("object")
                .and_then(|value| value.get("objectId"))
                .and_then(Value::as_str)
                .ok_or_else(|| "BROWSER_REF_RESOLVE: nó sem objectId".to_string())?;
            client
                .call(
                    "Runtime.callFunctionOn",
                    json!({
                        "objectId": object_id,
                        "functionDeclaration": "function(){ this.click(); }",
                        "returnByValue": true,
                    }),
                )
                .await?;
        }
        Ok(element)
    }

    pub async fn type_text(
        &self,
        conversation_id: &str,
        tab_id: Option<&str>,
        reference: &str,
        text: &str,
    ) -> Result<BrowserElement, String> {
        if text.chars().count() > 4_000 {
            return Err("BROWSER_INPUT_TOO_LARGE: o texto passa de 4.000 caracteres".to_string());
        }
        let element = self.lookup_ref(conversation_id, tab_id, reference)?;
        let (port, _) = self.session_port(conversation_id).await?;
        let tab = match tab_id {
            Some(id) => id.to_string(),
            None => self.active_tab_id(conversation_id, port).await?,
        };
        let ws = self.tab_ws(port, Some(&tab)).await?;
        let mut client = CdpClient::connect(&ws).await?;
        let object = client
            .call(
                "DOM.resolveNode",
                json!({ "backendNodeId": element.backend_node_id }),
            )
            .await?;
        let object_id = object
            .get("object")
            .and_then(|value| value.get("objectId"))
            .and_then(Value::as_str)
            .ok_or_else(|| "BROWSER_REF_RESOLVE: nó sem objectId".to_string())?;
        client
            .call(
                "Runtime.callFunctionOn",
                json!({
                    "objectId": object_id,
                    "functionDeclaration": "function(){ this.focus(); }",
                    "returnByValue": true,
                }),
            )
            .await?;
        client
            .call(
                "Input.insertText",
                json!({ "text": text }),
            )
            .await?;
        // React/controlled inputs usually listen to input/change; the native
        // insertText already emits input, this keeps change listeners useful.
        client
            .call(
                "Runtime.callFunctionOn",
                json!({
                    "objectId": object_id,
                    "functionDeclaration": "function(){ this.dispatchEvent(new Event('change', {bubbles:true})); }",
                    "returnByValue": true,
                }),
            )
            .await?;
        Ok(element)
    }

    pub async fn click_at(
        &self,
        conversation_id: &str,
        tab_id: Option<&str>,
        x: f64,
        y: f64,
    ) -> Result<(), String> {        if !(0.0..=10_000.0).contains(&x) || !(0.0..=10_000.0).contains(&y) {
            return Err("BROWSER_POINT_INVALID: coordenada fora da página".to_string());
        }
        let (port, _) = self.session_port(conversation_id).await?;
        let tab = match tab_id {
            Some(id) => id.to_string(),
            None => self.active_tab_id(conversation_id, port).await?,
        };
        let ws = self.tab_ws(port, Some(&tab)).await?;
        let mut client = CdpClient::connect(&ws).await?;
        client
            .call(
                "Input.dispatchMouseEvent",
                json!({ "type": "mouseMoved", "x": x, "y": y }),
            )
            .await?;
        client
            .call(
                "Input.dispatchMouseEvent",
                json!({
                    "type": "mousePressed",
                    "x": x,
                    "y": y,
                    "button": "left",
                    "clickCount": 1,
                    "buttons": 1,
                }),
            )
            .await?;
        client
            .call(
                "Input.dispatchMouseEvent",
                json!({
                    "type": "mouseReleased",
                    "x": x,
                    "y": y,
                    "button": "left",
                    "clickCount": 1,
                    "buttons": 0,
                }),
            )
            .await?;
        Ok(())
    }

    pub async fn scroll(
        &self,
        conversation_id: &str,
        tab_id: Option<&str>,
        delta: i32,
    ) -> Result<(), String> {
        let (port, _) = self.session_port(conversation_id).await?;
        let tab = match tab_id {
            Some(id) => id.to_string(),
            None => self.active_tab_id(conversation_id, port).await?,
        };
        let ws = self.tab_ws(port, Some(&tab)).await?;
        let mut client = CdpClient::connect(&ws).await?;
        client
            .call(
                "Input.dispatchMouseEvent",
                json!({
                    "type": "mouseWheel",
                    "x": 640,
                    "y": 410,
                    "deltaX": 0,
                    "deltaY": delta,
                }),
            )
            .await?;
        Ok(())
    }

    pub async fn hover(
        &self,
        conversation_id: &str,
        tab_id: Option<&str>,
        reference: &str,
    ) -> Result<BrowserElement, String> {
        let element = self.lookup_ref(conversation_id, tab_id, reference)?;
        let (port, _) = self.session_port(conversation_id).await?;
        let tab = match tab_id {
            Some(id) => id.to_string(),
            None => self.active_tab_id(conversation_id, port).await?,
        };
        let ws = self.tab_ws(port, Some(&tab)).await?;
        let mut client = CdpClient::connect(&ws).await?;
        if let Some((x, y)) = element_center(&mut client, element.backend_node_id).await {
            client
                .call(
                    "Input.dispatchMouseEvent",
                    json!({ "type": "mouseMoved", "x": x, "y": y }),
                )
                .await?;
        }
        Ok(element)
    }

    pub async fn select(
        &self,
        conversation_id: &str,
        tab_id: Option<&str>,
        reference: &str,
        value: &str,
    ) -> Result<BrowserElement, String> {
        let element = self.lookup_ref(conversation_id, tab_id, reference)?;
        let (port, _) = self.session_port(conversation_id).await?;
        let tab = match tab_id {
            Some(id) => id.to_string(),
            None => self.active_tab_id(conversation_id, port).await?,
        };
        let ws = self.tab_ws(port, Some(&tab)).await?;
        let mut client = CdpClient::connect(&ws).await?;
        let object = client
            .call(
                "DOM.resolveNode",
                json!({ "backendNodeId": element.backend_node_id }),
            )
            .await?;
        let object_id = object
            .get("object")
            .and_then(|value| value.get("objectId"))
            .and_then(Value::as_str)
            .ok_or_else(|| "BROWSER_REF_RESOLVE: nó sem objectId".to_string())?;
        client
            .call(
                "Runtime.callFunctionOn",
                json!({
                    "objectId": object_id,
                    "functionDeclaration": "function(value){ this.value = value; this.dispatchEvent(new Event('input', {bubbles:true})); this.dispatchEvent(new Event('change', {bubbles:true})); }",
                    "arguments": [{ "value": value }],
                    "returnByValue": true,
                }),
            )
            .await?;
        Ok(element)
    }

    pub async fn upload(
        &self,
        conversation_id: &str,
        tab_id: Option<&str>,
        reference: &str,
        path: &str,
    ) -> Result<BrowserElement, String> {
        let element = self.lookup_ref(conversation_id, tab_id, reference)?;
        let (port, _) = self.session_port(conversation_id).await?;
        let tab = match tab_id {
            Some(id) => id.to_string(),
            None => self.active_tab_id(conversation_id, port).await?,
        };
        let ws = self.tab_ws(port, Some(&tab)).await?;
        let mut client = CdpClient::connect(&ws).await?;
        client
            .call(
                "DOM.setFileInputFiles",
                json!({ "files": [path], "backendNodeId": element.backend_node_id }),
            )
            .await?;
        Ok(element)
    }

    pub async fn insert_text(        &self,
        conversation_id: &str,
        tab_id: Option<&str>,
        text: &str,
    ) -> Result<(), String> {
        let (port, _) = self.session_port(conversation_id).await?;
        let tab = match tab_id {
            Some(id) => id.to_string(),
            None => self.active_tab_id(conversation_id, port).await?,
        };
        let ws = self.tab_ws(port, Some(&tab)).await?;
        let mut client = CdpClient::connect(&ws).await?;
        client
            .call("Input.insertText", json!({ "text": text }))
            .await?;
        Ok(())
    }

    pub async fn press(
        &self,
        conversation_id: &str,
        tab_id: Option<&str>,
        key: &str,
    ) -> Result<(), String> {
        let (port, _) = self.session_port(conversation_id).await?;
        let tab = match tab_id {
            Some(id) => id.to_string(),
            None => self.active_tab_id(conversation_id, port).await?,
        };
        let ws = self.tab_ws(port, Some(&tab)).await?;
        let (code, vk) = match key {
            "Enter" | "Return" => ("Enter", 13),
            "Tab" => ("Tab", 9),
            "Escape" | "Esc" => ("Escape", 27),
            "Backspace" => ("Backspace", 8),
            "ArrowUp" => ("ArrowUp", 38),
            "ArrowDown" => ("ArrowDown", 40),
            "ArrowLeft" => ("ArrowLeft", 37),
            "ArrowRight" => ("ArrowRight", 39),
            "Space" => ("Space", 32),
            other => {
                return Err(format!(
                    "BROWSER_KEY_INVALID: tecla `{other}` não suportada (use Enter, Tab, Escape, Backspace, setas ou Space)"
                ))
            }
        };
        cdp_call(
            &ws,
            "Input.dispatchKeyEvent",
            json!({
                "type": "keyDown",
                "key": key,
                "code": code,
                "windowsVirtualKeyCode": vk,
                "nativeVirtualKeyCode": vk,
            }),
        )
        .await?;
        cdp_call(
            &ws,
            "Input.dispatchKeyEvent",
            json!({
                "type": "keyUp",
                "key": key,
                "code": code,
                "windowsVirtualKeyCode": vk,
                "nativeVirtualKeyCode": vk,
            }),
        )
        .await?;
        Ok(())
    }

    pub async fn extract(
        &self,
        conversation_id: &str,
        tab_id: Option<&str>,
    ) -> Result<Value, String> {
        let (port, _) = self.session_port(conversation_id).await?;
        let tab = match tab_id {
            Some(id) => id.to_string(),
            None => self.active_tab_id(conversation_id, port).await?,
        };
        let ws = self.tab_ws(port, Some(&tab)).await?;
        let value = cdp_call(
            &ws,
            "Runtime.evaluate",
            json!({
                "expression": "({url: location.href, title: document.title, text: document.body ? document.body.innerText : ''})",
                "returnByValue": true,
            }),
        )
        .await?;
        let mut result = value
            .get("result")
            .and_then(|value| value.get("value"))
            .cloned()
            .unwrap_or_else(|| json!({}));
        if let Some(text) = result.get("text").and_then(Value::as_str) {
            let truncated: String = text.chars().take(MAX_EXTRACT_CHARS).collect();
            result["text"] = json!(truncated);
        }
        Ok(result)
    }

    pub async fn wait_download(
        &self,
        conversation_id: &str,
        tab_id: Option<&str>,
        reference: &str,
    ) -> Result<Value, String> {
        let dir = self
            .sessions
            .lock()
            .get(conversation_id)
            .map(|session| session.download_dir.clone())
            .ok_or_else(|| "BROWSER_NOT_RUNNING".to_string())?;
        let before: std::collections::HashSet<PathBuf> = std::fs::read_dir(&dir)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path())
            .collect();
        self.click(conversation_id, tab_id, reference).await?;
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(20) {
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if before.contains(&path) || !path.is_file() {
                        continue;
                    }
                    let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
                    if size > 0 {
                        return Ok(json!({
                            "path": path.to_string_lossy(),
                            "name": path.file_name().map(|name| name.to_string_lossy().to_string()),
                            "size": size,
                        }));
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        Err("BROWSER_DOWNLOAD_TIMEOUT: nenhum arquivo apareceu na pasta de downloads".to_string())
    }

    pub async fn take_control(&self, conversation_id: &str, paused: bool) -> Result<(), String> {
        let pid = {
            let sessions = self.sessions.lock();
            sessions
                .get(conversation_id)
                .map(|session| session.pid())
                .ok_or_else(|| "BROWSER_NOT_RUNNING".to_string())?
        };
        if paused {
            focus_process(pid).await;
        }
        Ok(())
    }
}

pub fn validate_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("BROWSER_URL_INVALID: URL vazia".to_string());
    }
    if trimmed == "about:blank" {
        return Ok(trimmed.to_string());
    }
    let parsed = url::Url::parse(trimmed)
        .map_err(|error| format!("BROWSER_URL_INVALID: {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("BROWSER_URL_FORBIDDEN: apenas http/https são permitidos".to_string());
    }
    if parsed.host_str().is_none() {
        return Err("BROWSER_URL_INVALID: URL sem host".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("BROWSER_URL_FORBIDDEN: credenciais na URL não são permitidas".to_string());
    }
    Ok(parsed.to_string())
}

/// Address-bar input: full http(s) URLs pass through; bare domains get https,
/// and plain text becomes a DuckDuckGo search.
pub fn normalize_navigation(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("BROWSER_URL_INVALID: URL vazia".to_string());
    }
    if trimmed.eq_ignore_ascii_case("about:blank") {
        return Ok("about:blank".to_string());
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return validate_url(trimmed);
    }
    // Explicit scheme-like input is never treated as a search term; it goes
    // through the allowlist and gets rejected (file/chrome/javascript/...).
    if let Some((scheme, _)) = trimmed.split_once(':') {
        if !scheme.is_empty()
            && scheme
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '+' || ch == '-' || ch == '.')
        {
            return validate_url(trimmed);
        }
    }
    let looks_like_host = trimmed.contains('.') && !trimmed.contains(char::is_whitespace);
    if looks_like_host {
        return validate_url(&format!("https://{trimmed}"));
    }
    let query: String = url::form_urlencoded::byte_serialize(trimmed.as_bytes()).collect();
    Ok(format!("https://duckduckgo.com/?q={query}"))
}

async fn element_center(client: &mut CdpClient, backend_node_id: i64) -> Option<(f64, f64)> {
    let _ = client
        .call(
            "DOM.scrollIntoViewIfNeeded",
            json!({ "backendNodeId": backend_node_id }),
        )
        .await;
    let model = client
        .call(
            "DOM.getBoxModel",
            json!({ "backendNodeId": backend_node_id }),
        )
        .await
        .ok()?;
    let content = model
        .get("model")
        .and_then(|value| value.get("content"))
        .and_then(Value::as_array)?;
    let numbers: Vec<f64> = content.iter().filter_map(Value::as_f64).collect();
    if numbers.len() < 8 {
        return None;
    }
    let xs = [numbers[0], numbers[2], numbers[4], numbers[6]];
    let ys = [numbers[1], numbers[3], numbers[5], numbers[7]];
    let min_x = xs.iter().cloned().fold(f64::INFINITY, f64::min);
    let max_x = xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let min_y = ys.iter().cloned().fold(f64::INFINITY, f64::min);
    let max_y = ys.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    Some(((min_x + max_x) / 2.0, (min_y + max_y) / 2.0))
}

/// Applies the deployment browser policy after URL normalization. Deny wins;
/// an empty allowlist means "public hosts only" subject to the private-host
/// switch. Cloud metadata is always refused.
pub fn validate_with_policy(
    settings: &crate::domain::Settings,
    raw: &str,
) -> Result<String, String> {
    let target = normalize_navigation(raw)?;
    if target == "about:blank" {
        return Ok(target);
    }
    let parsed = url::Url::parse(&target)
        .map_err(|error| format!("BROWSER_URL_INVALID: {error}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "BROWSER_URL_INVALID: URL sem host".to_string())?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host == "169.254.169.254" || host == "metadata.google.internal" {
        return Err("BROWSER_URL_FORBIDDEN: metadata de nuvem não é acessível".to_string());
    }
    if is_private_host(&host) && !settings.browser_allow_private_hosts {
        return Err(format!(
            "BROWSER_URL_FORBIDDEN: `{host}` é privado/local; habilite hosts privados nas configurações"
        ));
    }
    if settings
        .browser_blocked_domains
        .iter()
        .any(|rule| domain_matches(&host, rule))
    {
        return Err(format!("BROWSER_URL_FORBIDDEN: `{host}` está na denylist"));
    }
    if !settings.browser_allowed_domains.is_empty()
        && !settings
            .browser_allowed_domains
            .iter()
            .any(|rule| domain_matches(&host, rule))
    {
        return Err(format!(
            "BROWSER_URL_FORBIDDEN: `{host}` não está na allowlist do navegador"
        ));
    }
    Ok(target)
}

fn domain_matches(host: &str, rule: &str) -> bool {
    let rule = rule.trim().trim_start_matches('.').to_ascii_lowercase();
    !rule.is_empty() && (host == rule || host.ends_with(&format!(".{rule}")))
}

fn is_private_host(host: &str) -> bool {
    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(ip) => {
                ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.is_unspecified()
            }
            std::net::IpAddr::V6(ip) => {
                ip.is_loopback() || ip.is_unspecified() || ip.is_unique_local()
            }
        };
    }
    false
}

fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("BROWSER_PORT: {error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("BROWSER_PORT: {error}"))
}

fn find_browser_executable() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("LUMINA_BROWSER_PATH") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some(path);
        }
    }
    let mut candidates = Vec::new();
    #[cfg(windows)]
    {
        for key in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Ok(base) = std::env::var(key) {
                let base = PathBuf::from(base);
                candidates.push(base.join("Google/Chrome/Application/chrome.exe"));
                candidates.push(base.join("Microsoft/Edge/Application/msedge.exe"));
                candidates.push(base.join("Chromium/Application/chrome.exe"));
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
        candidates.push(PathBuf::from("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"));
        candidates.push(PathBuf::from("/Applications/Chromium.app/Contents/MacOS/Chromium"));
    }
    #[cfg(not(windows))]
    {
        for name in ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"] {
            if let Some(path) = crate::workspace::exec::find_executable(name) {
                candidates.push(path);
            }
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

struct CdpClient {
    socket: WsStream,
    next_id: u64,
}

impl CdpClient {
    async fn connect(ws_url: &str) -> Result<Self, String> {
        let (socket, _) = tokio::time::timeout(CDP_TIMEOUT, connect_async(ws_url))
            .await
            .map_err(|_| "BROWSER_CDP_TIMEOUT: conexão".to_string())?
            .map_err(|error| format!("BROWSER_CDP_CONNECT: {error}"))?;
        Ok(Self {
            socket,
            next_id: 1,
        })
    }

    async fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let request = json!({ "id": id, "method": method, "params": params });
        self.socket
            .send(Message::Text(request.to_string().into()))
            .await
            .map_err(|error| format!("BROWSER_CDP_SEND: {error}"))?;
        let started = Instant::now();
        loop {
            if started.elapsed() > CDP_TIMEOUT {
                return Err(format!("BROWSER_CDP_TIMEOUT: {method}"));
            }
            let next = tokio::time::timeout(CDP_TIMEOUT, self.socket.next())
                .await
                .map_err(|_| format!("BROWSER_CDP_TIMEOUT: {method}"))?;
            match next {
                Some(Ok(Message::Text(text))) => {
                    let Ok(value) = serde_json::from_str::<Value>(&text) else {
                        continue;
                    };
                    if value.get("id").and_then(Value::as_i64) != Some(id as i64) {
                        continue;
                    }
                    if let Some(error) = value.get("error") {
                        return Err(format!("BROWSER_CDP_ERROR: {error}"));
                    }
                    return Ok(value.get("result").cloned().unwrap_or_else(|| json!({})));
                }
                Some(Ok(Message::Close(_))) | None => {
                    return Err(format!("BROWSER_CDP_CLOSED: {method}"));
                }
                Some(Ok(_)) => {}
                Some(Err(error)) => return Err(format!("BROWSER_CDP_READ: {error}")),
            }
        }
    }
}

async fn cdp_call(ws_url: &str, method: &str, params: Value) -> Result<Value, String> {
    let mut client = CdpClient::connect(ws_url).await?;
    client.call(method, params).await
}

async fn focus_process(pid: u32) {
    #[cfg(windows)]
    {
        let script = format!(
            "$ws = New-Object -ComObject WScript.Shell; [void]$ws.AppActivate({pid})"
        );
        let mut command = tokio::process::Command::new("powershell");
        command
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
        let _ = command.status().await;
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_and_https_urls_are_allowed() {
        assert_eq!(validate_url("https://example.com/a").expect("https"), "https://example.com/a");
        assert_eq!(validate_url("about:blank").expect("blank"), "about:blank");
        for forbidden in [
            "file:///etc/passwd",
            "chrome://settings",
            "devtools://devtools/bundled/inspector.html",
            "javascript:alert(1)",
            "https://user:pass@example.com",
        ] {
            assert!(validate_url(forbidden).is_err(), "{forbidden} deveria falhar");
        }
    }

    #[test]
    fn address_bar_accepts_bare_hosts_and_searches_text() {
        assert_eq!(
            normalize_navigation("example.com").expect("host"),
            "https://example.com/"
        );
        assert!(normalize_navigation("lumina agentes")
            .expect("search")
            .starts_with("https://duckduckgo.com/?q=lumina+agentes"));
        assert!(normalize_navigation("file:///etc/passwd").is_err());
    }

    #[test]
    fn browser_policy_denies_before_allows_and_blocks_metadata() {
        let mut settings = crate::domain::Settings::default();
        settings.browser_blocked_domains = vec!["evil.test".to_string()];
        settings.browser_allowed_domains = vec!["example.com".to_string()];
        assert!(validate_with_policy(&settings, "https://example.com/a").is_ok());
        assert!(validate_with_policy(&settings, "https://sub.example.com/a").is_ok());
        assert!(validate_with_policy(&settings, "https://other.test/a").is_err());
        assert!(validate_with_policy(&settings, "https://evil.test/a").is_err());
        assert!(validate_with_policy(&settings, "http://169.254.169.254/latest").is_err());
        settings.browser_allow_private_hosts = false;
        assert!(validate_with_policy(&settings, "http://127.0.0.1:3000").is_err());
    }

    #[test]
    fn profile_ids_are_sanitized() {
        assert_eq!(BrowserManager::safe_id("conv/../x y"), "conv----x-y");
    }

    #[tokio::test]
    #[ignore = "opens a real local Chromium/Edge window"]
    async fn local_cdp_browser_navigates_snapshots_and_types() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener");
        let port = listener.local_addr().expect("addr").port();
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    let mut buffer = [0u8; 4096];
                    let _ = socket.read(&mut buffer).await;
                    let body = "<!doctype html><html><head><title>Lumina CDP</title></head><body><h1>Olá</h1><button id=\"go\">Enviar</button><input aria-label=\"Nome\" /></body></html>";
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                });
            }
        });

        let dir = std::env::temp_dir().join(format!(
            "lumina-browser-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("temp");
        let manager = BrowserManager::new(dir.clone());
        let status = manager
            .ensure("conv-test", None)
            .await
            .expect("browser starts");
        assert!(status.running);
        manager
            .navigate("conv-test", None, &format!("http://127.0.0.1:{port}/"))
            .await
            .expect("navigate");
        let snapshot = manager
            .snapshot("conv-test", None)
            .await
            .expect("snapshot");
        assert!(snapshot.title.contains("Lumina") || snapshot.url.contains(&port.to_string()));
        assert!(!snapshot.elements.is_empty());
        let button = snapshot
            .elements
            .iter()
            .find(|element| element.role == "button")
            .expect("button ref");
        manager
            .click("conv-test", None, &button.reference)
            .await
            .expect("click");
        let input = snapshot
            .elements
            .iter()
            .find(|element| element.role == "textbox")
            .expect("textbox ref");
        manager
            .type_text("conv-test", None, &input.reference, "Lumina")
            .await
            .expect("type");
        let frame = manager.frame("conv-test", None).await.expect("frame");
        assert!(frame.data_url.starts_with("data:image/jpeg;base64,"));
        manager.close("conv-test");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
