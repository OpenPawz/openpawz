// Paw Agent Engine — Discourse Tools (Atomic Module)
//
// Full Discourse forum management via the REST API.
// Each sub-module handles one domain:
//
//   topics    — list, create, read, update, close/open, pin/unpin, archive
//   posts     — read, create (reply), edit, delete, like/unlike
//   categories — list, create, edit, set permissions
//   users     — list, get info, groups, trust levels, suspend/unsuspend
//   search    — full-text search across topics and posts
//   admin     — site settings, stats, backups, badges
//
// Shared helpers (credential resolution, API client, rate-limit retry) live here.

pub mod admin;
pub mod categories;
pub mod posts;
pub mod search;
pub mod topics;
pub mod users;

use crate::atoms::error::EngineResult;
use crate::atoms::types::*;
use crate::engine::state::EngineState;
use crate::engine::util::safe_truncate;
use log::warn;
use serde_json::Value;
use std::time::Duration;
use tauri::Manager;

// ── Public API (called by tools/mod.rs) ────────────────────────────────

/// All Discourse tool definitions across sub-modules.
pub fn definitions() -> Vec<ToolDefinition> {
    let mut defs = Vec::new();
    defs.extend(topics::definitions());
    defs.extend(posts::definitions());
    defs.extend(categories::definitions());
    defs.extend(users::definitions());
    defs.extend(search::definitions());
    defs.extend(admin::definitions());
    defs
}

/// Route a tool call to the correct sub-module executor.
pub async fn execute(
    name: &str,
    args: &Value,
    app_handle: &tauri::AppHandle,
) -> Option<Result<String, String>> {
    // Try each sub-module — first Some wins
    None.or(topics::execute(name, args, app_handle).await)
        .or(posts::execute(name, args, app_handle).await)
        .or(categories::execute(name, args, app_handle).await)
        .or(users::execute(name, args, app_handle).await)
        .or(search::execute(name, args, app_handle).await)
        .or(admin::execute(name, args, app_handle).await)
}

// ── Shared helpers ─────────────────────────────────────────────────────

/// Credential keys stored in the skill vault.
const CRED_URL: &str = "DISCOURSE_URL";
const CRED_KEY: &str = "DISCOURSE_API_KEY";
const CRED_USER: &str = "DISCOURSE_API_USERNAME";

/// Resolve the Discourse base URL, API key, and username from the skill vault.
pub(crate) fn get_credentials(
    app_handle: &tauri::AppHandle,
) -> EngineResult<(String, String, String)> {
    let state = app_handle
        .try_state::<EngineState>()
        .ok_or("Engine state not available")?;
    let creds = crate::engine::skills::get_skill_credentials(&state.store, "discourse")
        .map_err(|e| format!("Failed to get Discourse credentials: {}", e))?;

    let url = creds
        .get(CRED_URL)
        .cloned()
        .ok_or("DISCOURSE_URL not found in skill vault. Enable the Discourse skill and add your forum URL in Settings → Skills → Discourse.")?;
    let api_key = creds.get(CRED_KEY).cloned().ok_or(
        "DISCOURSE_API_KEY not found in skill vault. Create an API key in your Discourse Admin → API panel.",
    )?;
    let username = creds
        .get(CRED_USER)
        .cloned()
        .unwrap_or_else(|| "system".to_string());

    if url.is_empty() {
        return Err("Discourse URL is empty".into());
    }
    if api_key.is_empty() {
        return Err("Discourse API key is empty".into());
    }

    // Strip trailing slash
    let url = url.trim_end_matches('/').to_string();

    Ok((url, api_key, username))
}

/// Build an HTTP client with Discourse API authentication headers.
pub(crate) fn authorized_client(api_key: &str, username: &str) -> reqwest::Client {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        "Api-Key",
        reqwest::header::HeaderValue::from_str(api_key).expect("invalid API key header"),
    );
    headers.insert(
        "Api-Username",
        reqwest::header::HeaderValue::from_str(username).expect("invalid username header"),
    );
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        reqwest::header::HeaderValue::from_static("application/json"),
    );
    headers.insert(
        reqwest::header::ACCEPT,
        reqwest::header::HeaderValue::from_static("application/json"),
    );
    reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .unwrap_or_default()
}

/// Make a Discourse API request with automatic rate-limit retry (once).
pub(crate) async fn discourse_request(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    body: Option<&Value>,
) -> EngineResult<Value> {
    let mut req = client.request(method.clone(), url);
    if let Some(b) = body {
        req = req.json(b);
    }

    let resp = req.send().await.map_err(|e| format!("HTTP error: {}", e))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if status.as_u16() == 429 {
        // Rate limited — wait and retry once
        warn!("[discourse] Rate limited, waiting 2s before retry");
        tokio::time::sleep(Duration::from_secs(2)).await;

        let mut req2 = client.request(method, url);
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
                "Discourse API {} (after retry): {}",
                status2,
                safe_truncate(&text2, 400)
            )
            .into());
        }
        return serde_json::from_str(&text2).or_else(|_| Ok(Value::String(text2)));
    }

    if status.as_u16() == 204 || status.as_u16() == 200 && text.is_empty() {
        return Ok(serde_json::json!({"ok": true}));
    }

    if !status.is_success() {
        return Err(format!("Discourse API {}: {}", status, safe_truncate(&text, 400)).into());
    }

    serde_json::from_str(&text).or_else(|_| Ok(Value::String(text)))
}
