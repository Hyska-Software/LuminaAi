//! Cliente **MCP** (Model Context Protocol) via stdio (F8, parte 2).
//!
//! Servidores configurados em `<app-data>/mcp.json`:
//!
//! ```json
//! { "servers": [ { "name": "fs", "command": "npx", "args": ["-y", "…"],
//!                  "env": { "CHAVE": "valor" }, "enabled": true } ] }
//! ```
//!
//! O transporte é o oficial de stdio: JSON-RPC 2.0 delimitado por linha (uma
//! mensagem por linha no stdin/stdout do processo filho). O Zylara faz
//! `initialize` → `notifications/initialized` → `tools/list`, expõe as tools
//! como `mcp__<servidor>__<tool>` no perfil Code e executa `tools/call` sob
//! aprovação explícita do usuário nos modos interativos (o Autônomo executa
//! direto; a tool roda fora do processo do agente).
//!
//! Contrato: `docs/goals/code-harness/PLAN.md` F8 e `TOOLS.md` §2.6.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot};

/// Versão do protocolo que o cliente fala (MCP 2024-11-05).
pub const MCP_PROTOCOL_VERSION: &str = "2024-11-05";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

/// Configuração de um servidor MCP.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub cwd: Option<String>,
}

fn default_true() -> bool {
    true
}

/// Arquivo de configuração (`mcp.json`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfig {
    #[serde(default)]
    pub servers: Vec<McpServerConfig>,
}

impl McpConfig {
    /// Carrega tolerantemente: arquivo ausente/inválido vira lista vazia.
    pub fn load(data_dir: &std::path::Path) -> Self {
        let path = data_dir.join("mcp.json");
        let Ok(raw) = std::fs::read_to_string(&path) else {
            return Self::default();
        };
        match serde_json::from_str::<McpConfig>(&raw) {
            Ok(config) => config,
            Err(error) => {
                eprintln!("mcp.json inválido (ignorado): {error}");
                Self::default()
            }
        }
    }

    /// Servidores habilitados com nome único.
    pub fn enabled_servers(&self) -> Vec<&McpServerConfig> {
        let mut seen = std::collections::HashSet::new();
        self.servers
            .iter()
            .filter(|server| server.enabled && !server.command.trim().is_empty())
            .filter(|server| seen.insert(server.name.clone()))
            .collect()
    }
}

/// Tool descoberta em um servidor MCP.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub server: String,
    pub name: String,
    /// Nome exposto ao modelo (`mcp__servidor__tool`).
    pub wire_name: String,
    pub description: String,
    pub input_schema: Value,
}

/// Sanitiza nomes para o wire (`[a-zA-Z0-9_]`).
pub fn sanitize_name(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if ch == '-' || ch == '_' || ch == '.' || ch == ' ' {
            out.push('_');
        }
    }
    while out.contains("__") {
        out = out.replace("__", "_");
    }
    out.trim_matches('_').to_string()
}

/// Nome wire de uma tool MCP.
pub fn wire_name(server: &str, tool: &str) -> String {
    format!("mcp__{}__{}", sanitize_name(server), sanitize_name(tool))
}

/// Separa `mcp__servidor__tool` em (servidor, tool) sanitizados.
pub fn parse_wire_name(name: &str) -> Option<(&str, &str)> {
    let rest = name.strip_prefix("mcp__")?;
    let (server, tool) = rest.split_once("__")?;
    if server.is_empty() || tool.is_empty() {
        return None;
    }
    Some((server, tool))
}

enum RpcRequest {
    Request { payload: String },
    Notify(String),
}

struct ClientInner {
    tx: mpsc::UnboundedSender<RpcRequest>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    next_id: AtomicU64,
    tools: RwLock<Vec<McpToolInfo>>,
    child: Mutex<Option<tokio::process::Child>>,
    alive: AtomicBool,
}

impl Drop for ClientInner {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.lock().take() {
            let _ = child.start_kill();
        }
        self.alive.store(false, Ordering::Relaxed);
    }
}

/// Um cliente conectado a um servidor MCP.
#[derive(Clone)]
pub struct McpClient {
    inner: Arc<ClientInner>,
}

impl McpClient {
    async fn connect(config: &McpServerConfig) -> Result<Self, String> {
        let mut command = tokio::process::Command::new(&config.command);
        command
            .args(&config.args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        if let Some(cwd) = &config.cwd {
            command.current_dir(cwd);
        }
        for (key, value) in &config.env {
            command.env(key, value);
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("MCP_SPAWN: servidor `{}`: {error}", config.name))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| crate::i18n::t("mcp.errors.stdinUnavailable"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| crate::i18n::t("mcp.errors.stdoutUnavailable"))?;
        let stderr = child.stderr.take();

        let (request_tx, mut request_rx) = mpsc::unbounded_channel::<RpcRequest>();
        // Escritor: serializa mensagens no stdin do servidor.
        tokio::spawn(async move {
            let mut stdin = stdin;
            while let Some(request) = request_rx.recv().await {
                let line = match request {
                    RpcRequest::Request { payload } => payload,
                    RpcRequest::Notify(payload) => payload,
                };
                if stdin.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
                if stdin.write_all(b"\n").await.is_err() {
                    break;
                }
                if stdin.flush().await.is_err() {
                    break;
                }
            }
            let _ = stdin.shutdown().await;
        });

        let inner = Arc::new(ClientInner {
            tx: request_tx,
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            tools: RwLock::new(Vec::new()),
            child: Mutex::new(Some(child)),
            alive: AtomicBool::new(true),
        });

        // Leitor: linha → JSON-RPC; responde o `pending` correspondente.
        let reader_inner = inner.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let Ok(message) = serde_json::from_str::<Value>(trimmed) else {
                    continue;
                };
                let Some(id) = message.get("id").and_then(Value::as_u64) else {
                    // Notificação do servidor (logs/progresso): ignorada.
                    continue;
                };
                let Some(sender) = reader_inner.pending.lock().remove(&id) else {
                    continue;
                };
                if let Some(error) = message.get("error") {
                    let _ = sender.send(Err(format!("MCP_PROTOCOL: {error}")));
                } else {
                    let _ = sender.send(Ok(message.get("result").cloned().unwrap_or(Value::Null)));
                }
            }
            reader_inner.alive.store(false, Ordering::Relaxed);
        });

        // Drena stderr para não travar o servidor (logs viram diagnóstico local).
        if let Some(stderr) = stderr {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = line;
                }
            });
        }

        let client = Self { inner };
        let initialized = tokio::time::timeout(
            CONNECT_TIMEOUT,
            client.request(
                "initialize",
                json!({
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": { "name": "zylara", "version": env!("CARGO_PKG_VERSION") }
                }),
            ),
        )
        .await
        .map_err(|_| {
            crate::i18n::t_args(
                "mcp.errors.initializeTimeout",
                &[("server", &config.name)],
            )
        })?
        .map_err(|error| format!("MCP_INIT: `{}`: {error}", config.name))?;
        // Servidores que não declaram tools são inúteis, mas não são um erro fatal.
        if initialized.get("capabilities").is_some() {
            client.notify("notifications/initialized", json!({}));
        }
        Ok(client)
    }

    fn notify(&self, method: &str, params: Value) {
        let message = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        let _ = self.inner.tx.send(RpcRequest::Notify(message.to_string()));
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        if !self.inner.alive.load(Ordering::Relaxed) {
            return Err("MCP_UNAVAILABLE: o servidor encerrou".to_string());
        }
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let (reply_tx, reply_rx) = oneshot::channel();
        self.inner.pending.lock().insert(id, reply_tx);
        let payload = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        })
        .to_string();
        if self
            .inner
            .tx
            .send(RpcRequest::Request { payload })
            .is_err()
        {
            self.inner.pending.lock().remove(&id);
            return Err("MCP_UNAVAILABLE: canal de escrita fechado".to_string());
        }
        match tokio::time::timeout(REQUEST_TIMEOUT, reply_rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("MCP_UNAVAILABLE: resposta perdida".to_string()),
            Err(_) => {
                self.inner.pending.lock().remove(&id);
                Err(format!("MCP_TIMEOUT: `{method}` excedeu {}s", REQUEST_TIMEOUT.as_secs()))
            }
        }
    }

    /// Lista as tools do servidor (com cache por cliente).
    pub async fn list_tools(&self, server: &str) -> Result<Vec<McpToolInfo>, String> {
        let response = self.request("tools/list", json!({})).await?;
        let Some(items) = response.get("tools").and_then(Value::as_array) else {
            return Err("MCP_PROTOCOL: `tools/list` sem `tools`".to_string());
        };
        let mut tools = Vec::with_capacity(items.len());
        for item in items {
            let Some(name) = item.get("name").and_then(Value::as_str) else {
                continue;
            };
            let schema = item
                .get("inputSchema")
                .cloned()
                .filter(Value::is_object)
                .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
            tools.push(McpToolInfo {
                server: server.to_string(),
                name: name.to_string(),
                wire_name: wire_name(server, name),
                description: item
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("ferramenta MCP")
                    .to_string(),
                input_schema: schema,
            });
        }
        *self.inner.tools.write() = tools.clone();
        Ok(tools)
    }

    /// Executa `tools/call` e devolve o resultado bruto do servidor.
    pub async fn call_tool(&self, name: &str, arguments: Value) -> Result<Value, String> {
        self.request(
            "tools/call",
            json!({ "name": name, "arguments": arguments }),
        )
        .await
    }
}

impl std::fmt::Debug for McpClient {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("McpClient")
    }
}

/// Dono dos servidores MCP do app (conexão preguiçosa, cache de tools).
pub struct McpManager {
    config: McpConfig,
    clients: Mutex<HashMap<String, Arc<McpClient>>>,
    tools: RwLock<Vec<McpToolInfo>>,
}

impl McpManager {
    pub fn load(data_dir: &std::path::Path) -> Self {
        Self {
            config: McpConfig::load(data_dir),
            clients: Mutex::new(HashMap::new()),
            tools: RwLock::new(Vec::new()),
        }
    }

    pub fn empty() -> Self {
        Self {
            config: McpConfig::default(),
            clients: Mutex::new(HashMap::new()),
            tools: RwLock::new(Vec::new()),
        }
    }

    pub fn config(&self) -> &McpConfig {
        &self.config
    }

    /// Tools em cache (sem I/O; usado para montar o wire de um turno).
    pub fn cached_tools(&self) -> Vec<McpToolInfo> {
        self.tools.read().clone()
    }

    pub fn has_servers(&self) -> bool {
        !self.config.enabled_servers().is_empty()
    }

    async fn client(&self, server: &McpServerConfig) -> Result<Arc<McpClient>, String> {
        if let Some(client) = self.clients.lock().get(&server.name) {
            return Ok(client.clone());
        }
        let client = Arc::new(McpClient::connect(server).await?);
        self.clients
            .lock()
            .insert(server.name.clone(), client.clone());
        Ok(client)
    }

    /// Conecta os servidores habilitados e atualiza o cache de tools.
    /// Falhas por servidor não derrubam os demais (degradação honesta).
    pub async fn refresh_tools(&self) -> Vec<McpToolInfo> {
        let mut all = Vec::new();
        for server in self.config.enabled_servers() {
            let server_name = server.name.clone();
            match self.client(server).await {
                Ok(client) => match client.list_tools(&server_name).await {
                    Ok(tools) => all.extend(tools),
                    Err(error) => eprintln!("MCP `{server_name}`: {error}"),
                },
                Err(error) => eprintln!("MCP `{server_name}`: {error}"),
            }
        }
        *self.tools.write() = all.clone();
        all
    }

    /// Executa uma tool MCP pelo nome wire.
    pub async fn call(&self, wire: &str, arguments: Value) -> Result<Value, String> {
        let Some((server_name, tool_name)) = parse_wire_name(wire) else {
            return Err(format!("MCP_INVALID: nome de tool `{wire}`"));
        };
        let server = self
            .config
            .enabled_servers()
            .into_iter()
            .find(|server| sanitize_name(&server.name) == server_name)
            .cloned()
            .ok_or_else(|| format!("MCP_UNKNOWN_SERVER: `{server_name}`"))?;
        let client = self.client(&server).await?;
        let tool = self
            .tools
            .read()
            .iter()
            .find(|tool| tool.wire_name == wire)
            .map(|tool| tool.name.clone())
            .unwrap_or_else(|| tool_name.to_string());
        client.call_tool(&tool, arguments).await
    }
}

impl Default for McpManager {
    fn default() -> Self {
        Self::empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_names_for_the_wire() {
        assert_eq!(sanitize_name("File System"), "file_system");
        assert_eq!(sanitize_name("a--b"), "a_b");
        assert_eq!(wire_name("fs", "read-file"), "mcp__fs__read_file");
        assert_eq!(parse_wire_name("mcp__fs__read_file"), Some(("fs", "read_file")));
        assert_eq!(parse_wire_name("write_file"), None);
        assert_eq!(parse_wire_name("mcp__x"), None);
    }

    #[test]
    fn config_parses_tolerantly_and_filters_disabled() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(
            dir.path().join("mcp.json"),
            r#"{"servers":[
                {"name":"fs","command":"node","args":["server.js"]},
                {"name":"off","command":"node","enabled":false},
                {"name":"bad","command":""}
            ]}"#,
        )
        .expect("escrever");
        let config = McpConfig::load(dir.path());
        let enabled = config.enabled_servers();
        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0].name, "fs");

        std::fs::write(dir.path().join("mcp.json"), "{ não é json").expect("escrever");
        assert!(McpConfig::load(dir.path()).servers.is_empty());
    }

    #[tokio::test]
    async fn manager_without_servers_degrades_honestly() {
        let manager = McpManager::empty();
        assert!(!manager.has_servers());
        assert!(manager.cached_tools().is_empty());
        assert!(manager.call("mcp__x__y", json!({})).await.is_err());
        assert!(manager.refresh_tools().await.is_empty());
    }

    /// Servidor MCP fake em Node (apenas stdio JSON-RPC por linha).
    const FAKE_SERVER: &str = r#"
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id === undefined) { return; }
  let result;
  if (message.method === 'initialize') {
    result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } };
  } else if (message.method === 'tools/list') {
    result = { tools: [{ name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }] };
  } else if (message.method === 'tools/call') {
    result = { content: [{ type: 'text', text: 'echo:' + JSON.stringify(message.params.arguments) }] };
  } else {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unknown method' } }) + '\n');
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
});
"#;

    fn node_available() -> bool {
        crate::workspace::exec::find_executable("node").is_some()
    }

    #[tokio::test]
    async fn client_performs_the_stdio_handshake_lists_and_calls_tools() {
        if !node_available() {
            eprintln!("node ausente: teste MCP pulado");
            return;
        }
        let dir = tempfile::tempdir().expect("tempdir");
        let script = dir.path().join("fake-mcp.js");
        std::fs::write(&script, FAKE_SERVER).expect("escrever servidor");
        let server = McpServerConfig {
            name: "fake".to_string(),
            command: "node".to_string(),
            args: vec![script.to_string_lossy().to_string()],
            env: HashMap::new(),
            enabled: true,
            cwd: None,
        };
        let client = McpClient::connect(&server).await.expect("handshake");
        let tools = client.list_tools("fake").await.expect("tools/list");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].wire_name, "mcp__fake__echo");
        let result = client
            .call_tool("echo", json!({ "text": "olá" }))
            .await
            .expect("tools/call");
        assert!(result["content"][0]["text"]
            .as_str()
            .expect("texto")
            .contains("olá"));
    }

    #[tokio::test]
    async fn manager_refreshes_and_calls_through_the_wire_name() {
        if !node_available() {
            eprintln!("node ausente: teste MCP pulado");
            return;
        }
        let dir = tempfile::tempdir().expect("tempdir");
        let script = dir.path().join("fake-mcp.js");
        std::fs::write(&script, FAKE_SERVER).expect("escrever servidor");
        std::fs::write(
            dir.path().join("mcp.json"),
            serde_json::to_string(&json!({
                "servers": [{
                    "name": "fake",
                    "command": "node",
                    "args": [script.to_string_lossy().to_string()]
                }]
            }))
            .expect("json"),
        )
        .expect("escrever config");
        let manager = McpManager::load(dir.path());
        assert!(manager.has_servers());
        let tools = manager.refresh_tools().await;
        assert_eq!(tools.len(), 1);
        assert_eq!(manager.cached_tools()[0].name, "echo");
        let result = manager
            .call("mcp__fake__echo", json!({ "text": "oi" }))
            .await
            .expect("chamada");
        assert!(result["content"][0]["text"]
            .as_str()
            .expect("texto")
            .contains("oi"));
    }
}
