// commands/audit.rs — Tauri IPC commands for the unified signed audit log.
//
// Exposes: query, stats, verify chain integrity, export.

use crate::commands::state::EngineState;
use crate::engine::audit;
use tauri::State;

/// Query recent audit log entries with optional filters.
#[tauri::command]
pub fn engine_audit_query(
    state: State<'_, EngineState>,
    limit: Option<usize>,
    category: Option<String>,
    agent_id: Option<String>,
) -> Result<Vec<audit::UnifiedAuditEntry>, String> {
    let limit = limit.unwrap_or(100);
    audit::query_recent(
        &state.store,
        limit,
        category.as_deref(),
        agent_id.as_deref(),
    )
    .map_err(|e| e.to_string())
}

/// Get audit log statistics (totals, category breakdown, date range).
#[tauri::command]
pub fn engine_audit_stats(state: State<'_, EngineState>) -> Result<audit::AuditStats, String> {
    audit::stats(&state.store).map_err(|e| e.to_string())
}

/// Verify the HMAC chain integrity of the entire audit log.
/// Returns { "intact": true, "count": N } or { "intact": false, "broken_at": row_id }.
#[tauri::command]
pub fn engine_audit_verify_chain(
    state: State<'_, EngineState>,
) -> Result<serde_json::Value, String> {
    match audit::verify_chain(&state.store) {
        Ok(Ok(count)) => Ok(serde_json::json!({
            "intact": true,
            "verified_entries": count,
        })),
        Ok(Err(broken_id)) => Ok(serde_json::json!({
            "intact": false,
            "broken_at_row": broken_id,
        })),
        Err(e) => Err(e.to_string()),
    }
}
