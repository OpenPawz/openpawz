// Paw Agent Engine — Trello Tools (Atomic Module)
//
// Full Trello project management via the REST API.
// Each sub-module handles one domain:
//
//   boards     — list, create, get, update, delete
//   lists      — get lists, create, update, archive
//   cards      — CRUD, move, comments, attachments
//   labels     — list, create, update, delete, assign/remove
//   checklists — create, add items, toggle, delete
//   members    — list board members, search
//
// Shared helpers (credential resolution, API client) live here.

pub mod boards;
pub mod cards;
pub mod checklists;
pub mod labels;
pub mod lists;
pub mod members;

use crate::atoms::error::EngineResult;
use crate::atoms::types::*;
use crate::engine::state::EngineState;
use log::warn;
use serde_json::Value;
use std::time::Duration;
use tauri::Manager;

pub(crate) const TRELLO_API: &str = "https://api.trello.com/1";

// ── Public API (called by tools/mod.rs) ────────────────────────────────

/// All Trello tool definitions across sub-modules.
pub fn definitions() -> Vec<ToolDefinition> {
    let mut defs = Vec::new();
    defs.extend(boards::definitions());
    defs.extend(lists::definitions());
    defs.extend(cards::definitions());
    defs.extend(labels::definitions());
    defs.extend(checklists::definitions());
    defs.extend(members::definitions());
    defs
}

/// Route a tool call to the correct sub-module executor.
pub async fn execute(
    name: &str,
    args: &Value,
    app_handle: &tauri::AppHandle,
) -> Option<Result<String, String>> {
    None.or(boards::execute(name, args, app_handle).await)
        .or(lists::execute(name, args, app_handle).await)
        .or(cards::execute(name, args, app_handle).await)
        .or(labels::execute(name, args, app_handle).await)
        .or(checklists::execute(name, args, app_handle).await)
        .or(members::execute(name, args, app_handle).await)
}

// ── Shared helpers ─────────────────────────────────────────────────────

/// Resolve Trello API key from the skill vault.
pub(crate) fn get_api_key(app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let state = app_handle
        .try_state::<EngineState>()
        .ok_or("Engine state not available")?;
    let creds = crate::engine::skills::get_skill_credentials(&state.store, "trello")
        .map_err(|e| format!("Failed to get Trello credentials: {}", e))?;
    let key = creds.get("TRELLO_API_KEY")
        .cloned()
        .ok_or("TRELLO_API_KEY not found in skill vault. Enable the Trello skill and add your API key in Settings → Skills → Trello.")?;
    if key.is_empty() {
        return Err("Trello API key is empty".into());
    }
    Ok(key)
}

/// Resolve Trello token from the skill vault.
pub(crate) fn get_token(app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let state = app_handle
        .try_state::<EngineState>()
        .ok_or("Engine state not available")?;
    let creds = crate::engine::skills::get_skill_credentials(&state.store, "trello")
        .map_err(|e| format!("Failed to get Trello credentials: {}", e))?;
    let token = creds.get("TRELLO_TOKEN")
        .cloned()
        .ok_or("TRELLO_TOKEN not found in skill vault. Enable the Trello skill and add your token in Settings → Skills → Trello.")?;
    if token.is_empty() {
        return Err("Trello token is empty".into());
    }
    Ok(token)
}

/// Get both key and token at once.
pub(crate) fn get_credentials(app_handle: &tauri::AppHandle) -> EngineResult<(String, String)> {
    Ok((get_api_key(app_handle)?, get_token(app_handle)?))
}

/// Build a URL with auth query params appended.
pub(crate) fn auth_url(path: &str, key: &str, token: &str) -> String {
    let sep = if path.contains('?') { '&' } else { '?' };
    format!("{}{}{sep}key={}&token={}", TRELLO_API, path, key, token)
}

/// Build reqwest client.
pub(crate) fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// Make a Trello API request with rate-limit handling.
pub(crate) async fn trello_request(
    method: reqwest::Method,
    url: &str,
    body: Option<&Value>,
) -> EngineResult<Value> {
    let http = client();
    let mut req = http
        .request(method.clone(), url)
        .header("Content-Type", "application/json");
    if let Some(b) = body {
        req = req.json(b);
    }

    let resp = req.send().await.map_err(|e| format!("HTTP error: {}", e))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if status.as_u16() == 429 {
        // Rate limited — wait and retry once
        warn!("[trello] Rate limited, waiting 1s and retrying");
        tokio::time::sleep(Duration::from_secs(1)).await;

        let mut req2 = http
            .request(method, url)
            .header("Content-Type", "application/json");
        if let Some(b) = body {
            req2 = req2.json(b);
        }
        let resp2 = req2
            .send()
            .await
            .map_err(|e| format!("Retry HTTP error: {}", e))?;
        let status2 = resp2.status();
        let text2 = resp2.text().await.unwrap_or_default();
        if !status2.is_success() {
            return Err(format!(
                "Trello API {} (after retry): {}",
                status2,
                &text2[..text2.len().min(500)]
            )
            .into());
        }
        return serde_json::from_str(&text2).or_else(|_| Ok(Value::String(text2)));
    }

    if !status.is_success() {
        return Err(format!("Trello API {}: {}", status, &text[..text.len().min(500)]).into());
    }

    if text.is_empty() {
        return Ok(serde_json::json!({"ok": true}));
    }

    serde_json::from_str(&text).or_else(|_| Ok(Value::String(text)))
}
