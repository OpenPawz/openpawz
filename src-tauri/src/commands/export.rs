// commands/export.rs — Compliance Data Export
//
// One-click export of ALL data held by OpenPawz for a given scope:
//   - Conversations (sessions + messages)
//   - Engram memories (episodic, semantic, procedural)
//   - Unified audit log (with chain verification)
//   - Integration action log
//   - Credential usage log (guardrails)
//   - Flow definitions + run history
//
// Output: a single JSON file suitable for compliance review, legal hold,
// or GDPR data-subject access requests.

use crate::atoms::engram_types::MemoryScope;
use crate::commands::action_log::IntegrationActionLog;
use crate::commands::guardrails::CredentialUsageLog;
use crate::commands::state::EngineState;
use crate::engine::audit;
use chrono::Utc;
use serde::Serialize;
use tauri::State;

// ── Export Envelope ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ComplianceExport {
    /// Export metadata
    pub metadata: ExportMetadata,
    /// Sessions with their messages
    pub conversations: Vec<ConversationExport>,
    /// Engram memory counts + data
    pub memory: MemoryExport,
    /// Signed audit log entries + chain verification
    pub audit: AuditExport,
    /// Integration action log
    pub action_log: Vec<IntegrationActionLog>,
    /// Credential usage log
    pub credential_log: Vec<CredentialUsageLog>,
    /// Flow definitions + runs
    pub flows: FlowExport,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportMetadata {
    pub export_id: String,
    pub generated_at: String,
    pub generator: String,
    pub version: String,
    pub scope: ExportScope,
    /// Total records exported
    pub total_records: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportScope {
    /// Filter by agent ID (None = all agents)
    pub agent_id: Option<String>,
    /// Filter by date range start (ISO-8601)
    pub from: Option<String>,
    /// Filter by date range end (ISO-8601)
    pub to: Option<String>,
    /// What was included
    pub sections: Vec<String>,
}

// ── Conversation Export ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ConversationExport {
    pub session_id: String,
    pub label: Option<String>,
    pub model: Option<String>,
    pub agent_id: Option<String>,
    pub created_at: String,
    pub message_count: i64,
    pub messages: Vec<MessageExport>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MessageExport {
    pub id: String,
    pub role: String,
    pub content: String,
    pub tool_calls_json: Option<String>,
    pub tool_call_id: Option<String>,
    pub name: Option<String>,
    pub created_at: String,
}

// ── Memory Export ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct MemoryExport {
    pub episodic_count: usize,
    pub semantic_count: usize,
    pub procedural_count: usize,
    pub edge_count: usize,
    pub episodic: Vec<serde_json::Value>,
    pub semantic: Vec<serde_json::Value>,
    pub procedural: Vec<serde_json::Value>,
}

// ── Audit Export ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct AuditExport {
    pub chain_verified: bool,
    pub chain_length: u64,
    pub entries: Vec<audit::UnifiedAuditEntry>,
    pub stats: Option<audit::AuditStats>,
}

// ── Flow Export ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct FlowExport {
    pub flow_count: usize,
    pub flows: Vec<FlowExportEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FlowExportEntry {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub runs: Vec<FlowRunExport>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FlowRunExport {
    pub id: String,
    pub status: String,
    pub duration_ms: Option<i64>,
    pub error: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

// ── Main Export Command ────────────────────────────────────────────────

/// Generate a full compliance export as a JSON string.
/// Optionally filter by agent_id. Returns the JSON blob.
#[tauri::command]
pub fn engine_compliance_export(
    state: State<'_, EngineState>,
    app_handle: tauri::AppHandle,
    agent_id: Option<String>,
) -> Result<String, String> {
    let store = &state.store;
    let mut total_records: usize = 0;
    let mut sections = Vec::new();

    // ── 1. Conversations ───────────────────────────────────────────
    sections.push("conversations".to_string());
    let sessions = store
        .list_sessions_filtered(1000, agent_id.as_deref())
        .map_err(|e| format!("Failed to list sessions: {}", e))?;

    let mut conversations = Vec::with_capacity(sessions.len());
    for session in &sessions {
        let messages = store.get_messages(&session.id, 10_000).unwrap_or_default();
        total_records += messages.len();

        let msg_exports: Vec<MessageExport> = messages
            .into_iter()
            .map(|m| MessageExport {
                id: m.id,
                role: m.role,
                content: m.content,
                tool_calls_json: m.tool_calls_json,
                tool_call_id: m.tool_call_id,
                name: m.name,
                created_at: m.created_at,
            })
            .collect();

        conversations.push(ConversationExport {
            session_id: session.id.clone(),
            label: session.label.clone(),
            model: Some(session.model.clone()),
            agent_id: session.agent_id.clone(),
            created_at: session.created_at.clone(),
            message_count: session.message_count,
            messages: msg_exports,
        });
    }
    total_records += sessions.len();

    // ── 2. Engram Memories ─────────────────────────────────────────
    sections.push("memory".to_string());

    // Use a global scope to get all memories
    let scope = if let Some(ref aid) = agent_id {
        MemoryScope {
            agent_id: Some(aid.clone()),
            ..Default::default()
        }
    } else {
        MemoryScope::global()
    };

    let episodic_list = store
        .engram_list_episodic(&scope, None, 10_000)
        .unwrap_or_default();
    let episodic_count = episodic_list.len();
    let episodic: Vec<serde_json::Value> = episodic_list
        .iter()
        .filter_map(|m| serde_json::to_value(m).ok())
        .collect();

    let semantic_count = store.engram_count_semantic().unwrap_or(0);
    // Search with empty query to get all semantic memories
    let semantic_list = store
        .engram_search_semantic_bm25("*", &scope, 10_000)
        .unwrap_or_default();
    let semantic: Vec<serde_json::Value> = semantic_list
        .iter()
        .filter_map(|(m, _score)| serde_json::to_value(m).ok())
        .collect();

    let procedural_count = store.engram_count_procedural().unwrap_or(0);
    let procedural_list = store
        .engram_search_procedural("*", &scope, 10_000)
        .unwrap_or_default();
    let procedural: Vec<serde_json::Value> = procedural_list
        .iter()
        .filter_map(|m| serde_json::to_value(m).ok())
        .collect();

    let edge_count = store.engram_count_edges().unwrap_or(0);
    total_records += episodic_count + semantic_count + procedural_count + edge_count;

    let memory = MemoryExport {
        episodic_count,
        semantic_count,
        procedural_count,
        edge_count,
        episodic,
        semantic,
        procedural,
    };

    // ── 3. Unified Audit Log ───────────────────────────────────────
    sections.push("audit_log".to_string());
    let audit_entries =
        audit::query_recent(store, 100_000, None, agent_id.as_deref()).unwrap_or_default();
    total_records += audit_entries.len();

    let chain_result = audit::verify_chain(store).ok();
    let chain_verified = chain_result.as_ref().map(|r| r.is_ok()).unwrap_or(false);
    let chain_length = chain_result
        .as_ref()
        .and_then(|r| r.as_ref().ok().copied())
        .unwrap_or(0);

    let audit_stats = audit::stats(store).ok();

    let audit_export = AuditExport {
        chain_verified,
        chain_length,
        entries: audit_entries,
        stats: audit_stats,
    };

    // ── 4. Integration Action Log ──────────────────────────────────
    sections.push("action_log".to_string());
    let action_log: Vec<IntegrationActionLog> = {
        // Re-use the same load logic from action_log module
        crate::commands::action_log::engine_action_log_list(app_handle.clone(), Some(10_000), None)
            .unwrap_or_default()
    };
    total_records += action_log.len();

    // ── 5. Credential Usage Log ────────────────────────────────────
    sections.push("credential_log".to_string());
    let credential_log: Vec<CredentialUsageLog> =
        crate::commands::guardrails::engine_guardrails_get_audit_log(app_handle.clone())
            .unwrap_or_default();
    total_records += credential_log.len();

    // ── 6. Flows + Runs ────────────────────────────────────────────
    sections.push("flows".to_string());
    let flows = store.list_flows().unwrap_or_default();
    let mut flow_entries = Vec::with_capacity(flows.len());

    for flow in &flows {
        let runs = store.list_flow_runs(&flow.id, 1000).unwrap_or_default();
        total_records += runs.len();

        let run_exports: Vec<FlowRunExport> = runs
            .into_iter()
            .map(|r| FlowRunExport {
                id: r.id,
                status: r.status,
                duration_ms: r.duration_ms,
                error: r.error,
                started_at: r.started_at,
                finished_at: r.finished_at,
            })
            .collect();

        flow_entries.push(FlowExportEntry {
            id: flow.id.clone(),
            name: flow.name.clone(),
            description: flow.description.clone(),
            created_at: flow.created_at.clone(),
            updated_at: flow.updated_at.clone(),
            runs: run_exports,
        });
    }
    total_records += flows.len();

    let flow_export = FlowExport {
        flow_count: flows.len(),
        flows: flow_entries,
    };

    // ── Build envelope ─────────────────────────────────────────────
    let export = ComplianceExport {
        metadata: ExportMetadata {
            export_id: uuid::Uuid::new_v4().to_string(),
            generated_at: Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
            generator: "OpenPawz Compliance Export".to_string(),
            version: "1.0.0".to_string(),
            scope: ExportScope {
                agent_id,
                from: None,
                to: None,
                sections,
            },
            total_records,
        },
        conversations,
        memory,
        audit: audit_export,
        action_log,
        credential_log,
        flows: flow_export,
    };

    serde_json::to_string_pretty(&export).map_err(|e| format!("JSON serialization failed: {}", e))
}

/// Save a compliance export to a file (user picks location from frontend).
/// Returns the file path written.
#[tauri::command]
pub fn engine_compliance_export_to_file(
    state: State<'_, EngineState>,
    app_handle: tauri::AppHandle,
    path: String,
    agent_id: Option<String>,
) -> Result<String, String> {
    let json = engine_compliance_export(state, app_handle, agent_id)?;
    std::fs::write(&path, &json).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(path)
}
