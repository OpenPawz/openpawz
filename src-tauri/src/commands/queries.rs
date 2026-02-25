// commands/queries.rs — Tauri IPC commands for agent queries
//
// Phase 2.9: execute read-only queries against connected services via n8n.

use crate::engine::channels;
use serde::{Deserialize, Serialize};

// ── Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryRequest {
    /// Natural language query from the user.
    pub question: String,
    /// Service IDs to query (empty = auto-detect).
    #[serde(rename = "serviceIds", default)]
    pub service_ids: Vec<String>,
    /// Optional query category for routing.
    #[serde(default)]
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryHighlight {
    pub severity: String,
    pub icon: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryKpi {
    pub label: String,
    pub value: String,
    #[serde(default)]
    pub trend: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryData {
    #[serde(rename = "type")]
    pub data_type: String,
    #[serde(default)]
    pub columns: Option<Vec<String>>,
    #[serde(default)]
    pub rows: Option<Vec<Vec<String>>>,
    #[serde(default)]
    pub items: Option<Vec<String>>,
    #[serde(default)]
    pub kpis: Option<Vec<QueryKpi>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    #[serde(rename = "queryId")]
    pub query_id: String,
    pub status: String,
    pub formatted: String,
    #[serde(default)]
    pub data: Option<QueryData>,
    #[serde(default)]
    pub highlights: Option<Vec<QueryHighlight>>,
    #[serde(rename = "executedAt")]
    pub executed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryHistoryEntry {
    pub id: String,
    pub question: String,
    #[serde(rename = "serviceIds")]
    pub service_ids: Vec<String>,
    pub status: String,
    pub formatted: String,
    #[serde(rename = "executedAt")]
    pub executed_at: String,
}

// ── Storage helpers ─────────────────────────────────────────────────────

const STORAGE_KEY: &str = "query_history";

fn load_history(app_handle: &tauri::AppHandle) -> Vec<QueryHistoryEntry> {
    channels::load_channel_config::<Vec<QueryHistoryEntry>>(app_handle, STORAGE_KEY)
        .unwrap_or_default()
}

fn save_history(
    app_handle: &tauri::AppHandle,
    history: &[QueryHistoryEntry],
) -> Result<(), String> {
    channels::save_channel_config(app_handle, STORAGE_KEY, &history.to_vec())
        .map_err(|e| e.to_string())
}

// ── Commands ───────────────────────────────────────────────────────────

/// Execute a query against connected services.
/// In Phase 2.9 this constructs a placeholder result; Phase 3+ will
/// route through n8n workflow execution for real data.
#[tauri::command]
pub async fn engine_queries_execute(
    app_handle: tauri::AppHandle,
    request: QueryRequest,
) -> Result<QueryResult, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let query_id = format!("q-{}", now.replace([':', '-', '+'], ""));

    // Detect target services from the question if not provided
    let target_services = if request.service_ids.is_empty() {
        _detect_services(&request.question)
    } else {
        request.service_ids.clone()
    };

    // Store in history
    let entry = QueryHistoryEntry {
        id: query_id.clone(),
        question: request.question.clone(),
        service_ids: target_services.clone(),
        status: "success".to_string(),
        formatted: format!(
            "Query '{}' targeting {} service(s) — awaiting n8n workflow execution (Phase 3+).",
            request.question,
            target_services.len()
        ),
        executed_at: now.clone(),
    };

    let mut history = load_history(&app_handle);
    history.push(entry);

    // Keep last 100 entries
    if history.len() > 100 {
        history = history.split_off(history.len() - 100);
    }

    save_history(&app_handle, &history)?;

    Ok(QueryResult {
        query_id,
        status: "success".to_string(),
        formatted: format!(
            "🔍 Query received: \"{}\"\n\
             📡 Target service(s): {}\n\
             ⏳ Real-time data fetching will be available once n8n workflows are configured.\n\
             Use the Automations tab to set up service connections.",
            request.question,
            target_services.join(", "),
        ),
        data: None,
        highlights: None,
        executed_at: now,
    })
}

/// List recent query history.
#[tauri::command]
pub async fn engine_queries_history(
    app_handle: tauri::AppHandle,
) -> Result<Vec<QueryHistoryEntry>, String> {
    Ok(load_history(&app_handle))
}

/// Clear query history.
#[tauri::command]
pub async fn engine_queries_clear_history(
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    save_history(&app_handle, &[])?;
    Ok(())
}

// ── Service detection ──────────────────────────────────────────────────

/// Naive keyword-based service detection from natural language queries.
fn _detect_services(question: &str) -> Vec<String> {
    let q = question.to_lowercase();
    let mut services = Vec::new();

    let patterns: &[(&str, &[&str])] = &[
        ("hubspot",   &["hubspot", "deal", "pipeline", "contacts", "companies"]),
        ("salesforce", &["salesforce", "opportunity", "leads", "accounts"]),
        ("trello",    &["trello", "board", "card", "kanban"]),
        ("jira",      &["jira", "sprint", "epic", "story"]),
        ("linear",    &["linear", "cycle", "project"]),
        ("slack",     &["slack", "channel", "message", "dm", "mention"]),
        ("discord",   &["discord", "server", "guild"]),
        ("telegram",  &["telegram", "bot", "group chat"]),
        ("github",    &["github", "repo", "pull request", "pr", "commit", "issue"]),
        ("notion",    &["notion", "page", "database", "wiki"]),
        ("google-sheets", &["sheet", "spreadsheet", "google sheets"]),
        ("gmail",     &["gmail", "email", "inbox", "mail"]),
        ("shopify",   &["shopify", "order", "product", "inventory"]),
        ("stripe",    &["stripe", "payment", "charge", "balance"]),
        ("zendesk",   &["zendesk", "ticket", "support"]),
        ("asana",     &["asana"]),
        ("clickup",   &["clickup"]),
        ("monday",    &["monday"]),
        ("todoist",   &["todoist"]),
        ("airtable",  &["airtable", "base"]),
        ("sendgrid",  &["sendgrid"]),
        ("twilio",    &["twilio", "sms", "call log"]),
    ];

    for (service_id, keywords) in patterns {
        if keywords.iter().any(|kw| q.contains(kw)) {
            services.push(service_id.to_string());
        }
    }

    // Default to a general query if no service detected
    if services.is_empty() {
        services.push("general".to_string());
    }

    services
}
