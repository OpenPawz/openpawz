// Paw Agent Engine — Session Manager
// Stores conversation history in SQLite via rusqlite.
// Independent of the Tauri SQL plugin — uses its own connection pool
// for the engine's data, separate from the frontend's paw.db.

use crate::engine::types::*;
use log::{info, warn, error};
use rusqlite::{Connection, params};
use std::path::PathBuf;
use std::sync::Mutex;

/// Get the path to the engine's SQLite database.
fn engine_db_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_default();
    let dir = home.join(".paw");
    std::fs::create_dir_all(&dir).ok();
    dir.join("engine.db")
}

/// Thread-safe database wrapper.
pub struct SessionStore {
    conn: Mutex<Connection>,
}

impl SessionStore {
    /// Open (or create) the engine database and initialize tables.
    pub fn open() -> Result<Self, String> {
        let path = engine_db_path();
        info!("[engine] Opening session store at {:?}", path);

        let conn = Connection::open(&path)
            .map_err(|e| format!("Failed to open engine DB: {}", e))?;

        // Enable WAL mode for better concurrent read performance
        conn.execute_batch("PRAGMA journal_mode=WAL;").ok();

        // Create tables
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                label TEXT,
                model TEXT NOT NULL DEFAULT '',
                system_prompt TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                message_count INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                tool_calls_json TEXT,
                tool_call_id TEXT,
                name TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_messages_session
                ON messages(session_id, created_at);

            CREATE TABLE IF NOT EXISTS engine_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        ").map_err(|e| format!("Failed to create tables: {}", e))?;

        Ok(SessionStore { conn: Mutex::new(conn) })
    }

    // ── Session CRUD ───────────────────────────────────────────────────

    pub fn create_session(&self, id: &str, model: &str, system_prompt: Option<&str>) -> Result<Session, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;

        conn.execute(
            "INSERT INTO sessions (id, model, system_prompt) VALUES (?1, ?2, ?3)",
            params![id, model, system_prompt],
        ).map_err(|e| format!("Failed to create session: {}", e))?;

        Ok(Session {
            id: id.to_string(),
            label: None,
            model: model.to_string(),
            system_prompt: system_prompt.map(|s| s.to_string()),
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            message_count: 0,
        })
    }

    pub fn list_sessions(&self, limit: i64) -> Result<Vec<Session>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;

        let mut stmt = conn.prepare(
            "SELECT id, label, model, system_prompt, created_at, updated_at, message_count
             FROM sessions ORDER BY updated_at DESC LIMIT ?1"
        ).map_err(|e| format!("Prepare error: {}", e))?;

        let sessions = stmt.query_map(params![limit], |row| {
            Ok(Session {
                id: row.get(0)?,
                label: row.get(1)?,
                model: row.get(2)?,
                system_prompt: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                message_count: row.get(6)?,
            })
        }).map_err(|e| format!("Query error: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

        Ok(sessions)
    }

    pub fn get_session(&self, id: &str) -> Result<Option<Session>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;

        let result = conn.query_row(
            "SELECT id, label, model, system_prompt, created_at, updated_at, message_count
             FROM sessions WHERE id = ?1",
            params![id],
            |row| {
                Ok(Session {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    model: row.get(2)?,
                    system_prompt: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    message_count: row.get(6)?,
                })
            },
        );

        match result {
            Ok(session) => Ok(Some(session)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("Query error: {}", e)),
        }
    }

    pub fn rename_session(&self, id: &str, label: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        conn.execute(
            "UPDATE sessions SET label = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![label, id],
        ).map_err(|e| format!("Update error: {}", e))?;
        Ok(())
    }

    pub fn delete_session(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        conn.execute("DELETE FROM messages WHERE session_id = ?1", params![id])
            .map_err(|e| format!("Delete messages error: {}", e))?;
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])
            .map_err(|e| format!("Delete session error: {}", e))?;
        Ok(())
    }

    // ── Message CRUD ───────────────────────────────────────────────────

    pub fn add_message(&self, msg: &StoredMessage) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;

        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, tool_calls_json, tool_call_id, name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                msg.id,
                msg.session_id,
                msg.role,
                msg.content,
                msg.tool_calls_json,
                msg.tool_call_id,
                msg.name,
            ],
        ).map_err(|e| format!("Insert message error: {}", e))?;

        // Update session stats
        conn.execute(
            "UPDATE sessions SET
                message_count = (SELECT COUNT(*) FROM messages WHERE session_id = ?1),
                updated_at = datetime('now')
             WHERE id = ?1",
            params![msg.session_id],
        ).map_err(|e| format!("Update session error: {}", e))?;

        Ok(())
    }

    pub fn get_messages(&self, session_id: &str, limit: i64) -> Result<Vec<StoredMessage>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;

        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, tool_calls_json, tool_call_id, name, created_at
             FROM messages WHERE session_id = ?1 ORDER BY created_at ASC LIMIT ?2"
        ).map_err(|e| format!("Prepare error: {}", e))?;

        let messages = stmt.query_map(params![session_id, limit], |row| {
            Ok(StoredMessage {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                tool_calls_json: row.get(4)?,
                tool_call_id: row.get(5)?,
                name: row.get(6)?,
                created_at: row.get(7)?,
            })
        }).map_err(|e| format!("Query error: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

        Ok(messages)
    }

    /// Convert stored messages to engine Message types for sending to AI provider.
    pub fn load_conversation(&self, session_id: &str, system_prompt: Option<&str>) -> Result<Vec<Message>, String> {
        let stored = self.get_messages(session_id, 1000)?;
        let mut messages = Vec::new();

        // Add system prompt if provided
        if let Some(prompt) = system_prompt {
            messages.push(Message {
                role: Role::System,
                content: MessageContent::Text(prompt.to_string()),
                tool_calls: None,
                tool_call_id: None,
                name: None,
            });
        }

        for sm in &stored {
            let role = match sm.role.as_str() {
                "system" => Role::System,
                "user" => Role::User,
                "assistant" => Role::Assistant,
                "tool" => Role::Tool,
                _ => Role::User,
            };

            let tool_calls: Option<Vec<ToolCall>> = sm.tool_calls_json.as_ref()
                .and_then(|json| serde_json::from_str(json).ok());

            messages.push(Message {
                role,
                content: MessageContent::Text(sm.content.clone()),
                tool_calls,
                tool_call_id: sm.tool_call_id.clone(),
                name: sm.name.clone(),
            });
        }

        Ok(messages)
    }

    // ── Config storage ─────────────────────────────────────────────────

    pub fn get_config(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        let result = conn.query_row(
            "SELECT value FROM engine_config WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        );
        match result {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("Config read error: {}", e)),
        }
    }

    pub fn set_config(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        conn.execute(
            "INSERT OR REPLACE INTO engine_config (key, value) VALUES (?1, ?2)",
            params![key, value],
        ).map_err(|e| format!("Config write error: {}", e))?;
        Ok(())
    }
}
