// Paw Agent Engine — Trello Tools (Atomic Module)
//
// Full Trello board, list, card, and checklist management via the REST API.
// Each sub-module handles one domain:
//
//   boards     — list, create, get, update, delete
//   lists      — get lists on board, create, update, archive
//   cards      — CRUD, move, comments, labels, attachments
//   checklists — create, add items, toggle, delete
//   search     — search across boards, list members
//
// Shared helpers (credential resolution, API client, rate-limit retry) live here.

pub mod boards;
pub mod lists;
pub mod cards;
pub mod checklists;
pub mod search;

use crate::atoms::types::*;
use crate::atoms::error::EngineResult;
use crate::engine::state::EngineState;
use log::warn;
use serde_json::Value;
use tauri::Manager;
use std::time::Duration;

pub(crate) const TRELLO_API: &str = "https://api.trello.com/1";

// ── Public API (called by tools/mod.rs) ────────────────────────────────

/// All Trello tool definitions across sub-modules.
pub fn definitions() -> Vec<ToolDefinition> {
    let mut defs = Vec::new();
    defs.extend(boards::definitions());
    defs.extend(lists::definitions());
    defs.extend(cards::definitions());
    defs.extend(checklists::definitions());
    defs.extend(search::definitions());
    defs
}

/// Route a tool call to the correct sub-module executor.
pub async fn execute(
    name: &str,
    args: &Value,
    app_handle: &tauri::AppHandle,
) -> Option<Result<String, String>> {
    None
        .or(boards::execute(name, args, app_handle).await)
        .or(lists::execute(name, args, app_handle).await)
        .or(cards::execute(name, args, app_handle).await)
        .or(checklists::execute(name, args, app_handle).await)
        .or(search::execute(name, args, app_handle).await)
}

// ── Shared helpers ─────────────────────────────────────────────────────

/// Resolve the Trello API key from the skill vault.
pub(crate) fn get_api_key(app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let state = app_handle.try_state::<EngineState>()
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

/// Resolve the Trello token from the skill vault.
pub(crate) fn get_token(app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let state = app_handle.try_state::<EngineState>()
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

/// Build authentication query string: key=...&token=...
pub(crate) fn auth_query(app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let key = get_api_key(app_handle)?;
    let token = get_token(app_handle)?;
    Ok(format!("key={}&token={}", key, token))
}

/// Build a reqwest client for Trello API calls.
pub(crate) fn client() -> reqwest::Client {
    reqwest::Client::new()
}

/// Make a Trello API request with automatic rate-limit retry (once).
/// Auth is passed via query string (Trello convention).
pub(crate) async fn trello_request(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    body: Option<&Value>,
) -> EngineResult<Value> {
    let mut req = client.request(method.clone(), url)
        .header("Content-Type", "application/json");
    if let Some(b) = body {
        req = req.json(b);
    }

    let resp = req.send().await.map_err(|e| format!("HTTP error: {}", e))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if status.as_u16() == 429 {
        // Rate limited — wait and retry once
        warn!("[trello] Rate limited, waiting 1.5s");
        tokio::time::sleep(Duration::from_secs_f64(1.5)).await;

        let mut req2 = client.request(method, url)
            .header("Content-Type", "application/json");
        if let Some(b) = body {
            req2 = req2.json(b);
        }
        let resp2 = req2.send().await.map_err(|e| format!("Retry HTTP error: {}", e))?;
        let status2 = resp2.status();
        let text2 = resp2.text().await.unwrap_or_default();
        if !status2.is_success() {
            return Err(format!("Trello API {} (after retry): {}", status2, &text2[..text2.len().min(500)]).into());
        }
        return serde_json::from_str(&text2)
            .or_else(|_| Ok(Value::String(text2)));
    }

    if !status.is_success() {
        return Err(format!("Trello API {}: {}", status, &text[..text.len().min(500)]).into());
    }

    if text.is_empty() {
        return Ok(serde_json::json!({"ok": true}));
    }

    serde_json::from_str(&text)
        .or_else(|_| Ok(Value::String(text)))
}

/// Build a full Trello API URL with auth query string.
pub(crate) fn api_url(path: &str, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let auth = auth_query(app_handle)?;
    let sep = if path.contains('?') { "&" } else { "?" };
    Ok(format!("{}{}{}{}", TRELLO_API, path, sep, auth))
}
