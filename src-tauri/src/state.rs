//! Global application state shared by every Tauri command.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

use crate::catalog::CatalogFile;
use crate::db::Db;

pub struct AppState {
    pub started_at: i64,
    pub db: Arc<Db>,
    pub catalog: CatalogFile,
    pub http: reqwest::Client,
    pub search_http: reqwest::Client,
    pub data_dir: PathBuf,
    turns: Mutex<HashMap<String, CancellationToken>>,
}

impl AppState {
    pub fn init(app: &AppHandle) -> anyhow::Result<Self> {
        let data_dir = crate::config::data_dir(app)?;
        let db_path = data_dir.join("lumina.db");
        let db = Db::open(&db_path)?;
        let catalog = CatalogFile::load()?;
        Ok(Self {
            started_at: crate::domain::now_ms(),
            db: Arc::new(db),
            catalog,
            http: crate::http::client(),
            search_http: crate::http::search_client(),
            data_dir,
            turns: Mutex::new(HashMap::new()),
        })
    }

    pub fn register_turn(&self, turn_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        self.turns.lock().insert(turn_id.to_string(), token.clone());
        token
    }

    pub fn finish_turn(&self, turn_id: &str) {
        self.turns.lock().remove(turn_id);
    }

    /// Cancel a running turn; returns true when a turn was found.
    pub fn cancel_turn(&self, turn_id: &str) -> bool {
        match self.turns.lock().get(turn_id) {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }

    pub fn cancel_all(&self) {
        for token in self.turns.lock().values() {
            token.cancel();
        }
    }

    pub fn app_handle_from_state(&self) -> Option<AppHandle> {
        None
    }
}

/// Ensure transient directories exist.
pub fn ensure_dirs(app: &AppHandle) -> anyhow::Result<()> {
    for sub in ["attachments", "artifacts", "logs"] {
        let dir = crate::config::data_dir(app)?.join(sub);
        std::fs::create_dir_all(dir)?;
    }
    let _ = app.package_info();
    Ok(())
}
