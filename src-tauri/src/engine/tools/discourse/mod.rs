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
    // Top-level diagnostic tool
    defs.push(ToolDefinition {
        tool_type: "function".into(),
        function: FunctionDefinition {
            name: "discourse_test_connection".into(),
            description: "Test and diagnose the Discourse API connection. Verifies the forum URL is reachable, validates API key and username authentication, and runs a quick functional check. Use this FIRST before other Discourse tools to confirm credentials work.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        },
    });
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
    // Handle top-level diagnostic tool
    if name == "discourse_test_connection" {
        return Some(test_connection(app_handle).await.map_err(|e| e.to_string()));
    }

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

use log::info;

/// Resolve the Discourse base URL, API key, and username from the skill vault.
pub(crate) fn get_credentials(
    app_handle: &tauri::AppHandle,
) -> EngineResult<(String, String, String)> {
    let state = app_handle
        .try_state::<EngineState>()
        .ok_or("Engine state not available")?;
    let creds = crate::engine::skills::get_skill_credentials(&state.store, "discourse")
        .map_err(|e| format!("Failed to get Discourse credentials: {}", e))?;

    info!(
        "[discourse] Vault keys present: URL={}, API_KEY={}, API_USERNAME={}",
        creds.contains_key(CRED_URL),
        creds.contains_key(CRED_KEY),
        creds.contains_key(CRED_USER),
    );

    let url = creds
        .get(CRED_URL)
        .cloned()
        .ok_or("DISCOURSE_URL not found. Go to Integrations → Built-In Tools → Discourse and enter your forum URL.")?;
    let api_key = creds.get(CRED_KEY).cloned().ok_or(
        "DISCOURSE_API_KEY not found. Go to Integrations → Built-In Tools → Discourse and enter your API key from Discourse Admin → API → Keys.",
    )?;
    let username = creds
        .get(CRED_USER)
        .cloned()
        .unwrap_or_else(|| "system".to_string());

    if url.is_empty() {
        return Err(
            "Discourse URL is empty. Go to Integrations → Discourse and enter your forum URL."
                .into(),
        );
    }
    if api_key.is_empty() {
        return Err(
            "Discourse API key is empty. Go to Integrations → Discourse and enter your API key."
                .into(),
        );
    }

    // Strip trailing slash
    let url = url.trim_end_matches('/').to_string();

    info!(
        "[discourse] Credentials loaded — URL: {}, username: {}, key: {}...{}",
        url,
        username,
        &api_key[..4.min(api_key.len())],
        if api_key.len() > 8 {
            &api_key[api_key.len() - 4..]
        } else {
            ""
        },
    );

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
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default()
}

/// Make a Discourse API request with automatic rate-limit retry (once).
/// On 403, provides specific guidance about API username issues.
pub(crate) async fn discourse_request(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    body: Option<&Value>,
) -> EngineResult<Value> {
    info!("[discourse] {} {}", method, url);

    let mut req = client.request(method.clone(), url);
    if let Some(b) = body {
        req = req.json(b);
    }

    let resp = req.send().await.map_err(|e| format!("HTTP request to Discourse failed: {}. Check your DISCOURSE_URL is correct and the server is reachable.", e))?;
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

    if status.as_u16() == 403 {
        warn!(
            "[discourse] 403 Forbidden — API key or username rejected: {}",
            safe_truncate(&text, 200)
        );
        return Err(format!(
            "Discourse API 403 Forbidden — authentication rejected.\n\
            This usually means the Api-Username header doesn't match a valid Discourse user.\n\
            Common fix: Use 'system' as the API Username (Integrations → Discourse → API Username).\n\
            The API Username must be an actual Discourse account username, NOT the API key description.\n\
            Response: {}",
            safe_truncate(&text, 300)
        ).into());
    }

    if status.as_u16() == 404 {
        return Err(format!(
            "Discourse API 404 Not Found for {}. The endpoint may not exist on this Discourse version. Response: {}",
            url, safe_truncate(&text, 300)
        ).into());
    }

    if !status.is_success() {
        return Err(format!("Discourse API {}: {}", status, safe_truncate(&text, 400)).into());
    }

    serde_json::from_str(&text).or_else(|_| Ok(Value::String(text)))
}

/// Test Discourse API connection. Returns a diagnostic report.
pub(crate) async fn test_connection(app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;

    let mut report = String::new();
    report.push_str("**Discourse Connection Test**\n");
    report.push_str(&format!("URL: {}\n", base_url));
    report.push_str(&format!("API Username: {}\n", username));
    report.push_str(&format!(
        "API Key: {}...{}\n\n",
        &api_key[..4.min(api_key.len())],
        if api_key.len() > 8 {
            &api_key[api_key.len() - 4..]
        } else {
            "????"
        }
    ));

    // Step 1: Test unauthenticated access (is the forum reachable?)
    let plain_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_default();

    let ping_url = format!("{}/site/basic-info.json", base_url);
    match plain_client.get(&ping_url).send().await {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                let body: Value = resp.json().await.unwrap_or_default();
                let title = body["title"].as_str().unwrap_or("(unknown)");
                report.push_str(&format!("✅ Forum reachable: {} ({})\n", title, status));
            } else if status.as_u16() == 403 {
                report.push_str(
                    "⚠️ Forum has login_required enabled — all API calls need valid auth\n",
                );
            } else {
                report.push_str(&format!("❌ Forum returned {} (unauthenticated)\n", status));
            }
        }
        Err(e) => {
            report.push_str(&format!("❌ Cannot reach forum: {}\n", e));
            report.push_str("Check your DISCOURSE_URL in Integrations → Discourse\n");
            return Ok(report);
        }
    }

    // Step 2: Test authenticated access (API key + username valid?)
    let auth_client = authorized_client(&api_key, &username);
    let auth_url = format!("{}/session/current.json", base_url);
    match auth_client.get(&auth_url).send().await {
        Ok(resp) => {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            if status.is_success() {
                let body: Value = serde_json::from_str(&text).unwrap_or_default();
                let acting_user = body["current_user"]["username"]
                    .as_str()
                    .unwrap_or("(unknown)");
                let admin = body["current_user"]["admin"].as_bool().unwrap_or(false);
                report.push_str(&format!(
                    "✅ API auth valid — acting as: {} (admin: {})\n",
                    acting_user, admin
                ));
            } else if status.as_u16() == 403 || status.as_u16() == 404 {
                report.push_str(&format!("❌ API auth FAILED (HTTP {})\n", status));
                report.push_str(&format!("   Response: {}\n", safe_truncate(&text, 200)));
                report.push_str("\n**Troubleshooting:**\n");
                report.push_str(&format!("• Current API Username: '{}'\n", username));
                report.push_str(
                    "• The API Username must be an actual Discourse user (e.g. 'system')\n",
                );
                report.push_str(
                    "• It is NOT the API key description — check Discourse Admin → API → Keys\n",
                );
                report.push_str("• For 'All Users' scope keys, use 'system' as the username\n");
                report.push_str("• Verify the API key hasn't been revoked or regenerated\n");
            } else {
                report.push_str(&format!(
                    "⚠️ Unexpected response: {} — {}\n",
                    status,
                    safe_truncate(&text, 200)
                ));
            }
        }
        Err(e) => {
            report.push_str(&format!("❌ Auth request failed: {}\n", e));
        }
    }

    // Step 3: Quick functional test — try listing categories (usually public)
    let cat_url = format!("{}/categories.json", base_url);
    match auth_client.get(&cat_url).send().await {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                let body: Value = resp.json().await.unwrap_or_default();
                let count = body["category_list"]["categories"]
                    .as_array()
                    .map(|a| a.len())
                    .unwrap_or(0);
                report.push_str(&format!(
                    "✅ Category listing works — {} categories found\n",
                    count
                ));
            } else {
                let text = resp.text().await.unwrap_or_default();
                report.push_str(&format!(
                    "❌ Category listing failed (HTTP {}): {}\n",
                    status,
                    safe_truncate(&text, 200)
                ));
            }
        }
        Err(e) => {
            report.push_str(&format!("❌ Category request failed: {}\n", e));
        }
    }

    report.push_str("\n**Status:** ");
    if report.contains("❌ API auth FAILED") {
        report.push_str("CREDENTIALS INVALID — update API Username in Integrations → Discourse");
    } else if report.contains("❌ Cannot reach") {
        report.push_str("FORUM UNREACHABLE — check URL");
    } else if report.contains("✅ API auth valid") {
        report.push_str("ALL GOOD — Discourse tools are fully operational");
    } else {
        report.push_str("PARTIAL — some checks failed, see details above");
    }

    Ok(report)
}
