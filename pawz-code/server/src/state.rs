// pawz-code — state.rs
// Shared application state: config, SQLite memory DB, and the SSE broadcast channel.

use crate::config::Config;
use anyhow::Result;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub db: Arc<Mutex<Connection>>,
    /// Broadcast channel — every SSE connection subscribes; agent loop publishes here.
    pub sse_tx: broadcast::Sender<String>,
}

impl AppState {
    pub fn new(config: Config) -> Result<Self> {
        let db_path = Config::db_path();
        std::fs::create_dir_all(db_path.parent().unwrap())?;

        let conn = Connection::open(&db_path)?;
        init_schema(&conn)?;

        let (tx, _) = broadcast::channel::<String>(1024);

        Ok(AppState {
            config: Arc::new(config),
            db: Arc::new(Mutex::new(conn)),
            sse_tx: tx,
        })
    }

    /// Broadcast a serialised EngineEvent JSON string to all SSE subscribers.
    pub fn fire(&self, json: String) {
        let _ = self.sse_tx.send(json);
    }
}

fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS messages (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  TEXT NOT NULL,
            role        TEXT NOT NULL,
            content_json TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_msg_session ON messages(session_id, id);

        CREATE TABLE IF NOT EXISTS memories (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            key         TEXT NOT NULL,
            content     TEXT NOT NULL,
            tags        TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mem_key ON memories(key);
        "#,
    )
}
