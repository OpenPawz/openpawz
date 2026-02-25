// commands/guardrails.rs — Tauri IPC commands for safety guardrails
//
// Phase 3.5: rate limits, agent permissions, credential audit trail.

use crate::engine::channels;
use serde::{Deserialize, Serialize};

// ── Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitConfig {
    pub service: String,
    #[serde(rename = "maxActions")]
    pub max_actions: u32,
    #[serde(rename = "windowMinutes")]
    pub window_minutes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentServicePermission {
    #[serde(rename = "agentId")]
    pub agent_id: String,
    pub service: String,
    pub access: String, // none | read | write | full
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialUsageLog {
    pub timestamp: String,
    pub agent: String,
    pub service: String,
    pub action: String,
    #[serde(rename = "accessLevel")]
    pub access_level: String,
    pub approved: bool,
    pub result: String, // success | denied | failed
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenInfo {
    pub service: String,
    #[serde(rename = "expiresAt", default)]
    pub expires_at: Option<String>,
    #[serde(rename = "hasRefreshToken", default)]
    pub has_refresh_token: bool,
    #[serde(rename = "lastRefreshed", default)]
    pub last_refreshed: Option<String>,
}

// ── Storage keys ───────────────────────────────────────────────────────

const RATE_LIMITS_KEY: &str = "guardrail_rate_limits";
const PERMISSIONS_KEY: &str = "guardrail_permissions";
const AUDIT_LOG_KEY: &str = "guardrail_audit_log";
const TOKEN_INFO_KEY: &str = "guardrail_token_info";

fn load_rate_limits(app: &tauri::AppHandle) -> Vec<RateLimitConfig> {
    channels::load_channel_config::<Vec<RateLimitConfig>>(app, RATE_LIMITS_KEY)
        .unwrap_or_default()
}

fn save_rate_limits(
    app: &tauri::AppHandle,
    limits: &[RateLimitConfig],
) -> Result<(), String> {
    channels::save_channel_config(app, RATE_LIMITS_KEY, &limits.to_vec())
        .map_err(|e| e.to_string())
}

fn load_permissions(app: &tauri::AppHandle) -> Vec<AgentServicePermission> {
    channels::load_channel_config::<Vec<AgentServicePermission>>(app, PERMISSIONS_KEY)
        .unwrap_or_default()
}

fn save_permissions(
    app: &tauri::AppHandle,
    perms: &[AgentServicePermission],
) -> Result<(), String> {
    channels::save_channel_config(app, PERMISSIONS_KEY, &perms.to_vec())
        .map_err(|e| e.to_string())
}

fn load_audit_log(app: &tauri::AppHandle) -> Vec<CredentialUsageLog> {
    channels::load_channel_config::<Vec<CredentialUsageLog>>(app, AUDIT_LOG_KEY)
        .unwrap_or_default()
}

fn save_audit_log(
    app: &tauri::AppHandle,
    logs: &[CredentialUsageLog],
) -> Result<(), String> {
    channels::save_channel_config(app, AUDIT_LOG_KEY, &logs.to_vec())
        .map_err(|e| e.to_string())
}

fn load_token_info(app: &tauri::AppHandle) -> Vec<TokenInfo> {
    channels::load_channel_config::<Vec<TokenInfo>>(app, TOKEN_INFO_KEY)
        .unwrap_or_default()
}

fn save_token_info(
    app: &tauri::AppHandle,
    tokens: &[TokenInfo],
) -> Result<(), String> {
    channels::save_channel_config(app, TOKEN_INFO_KEY, &tokens.to_vec())
        .map_err(|e| e.to_string())
}

// ── Rate Limit Commands ────────────────────────────────────────────────

/// Get configured rate limits (user overrides).
#[tauri::command]
pub fn engine_guardrails_get_rate_limits(
    app_handle: tauri::AppHandle,
) -> Result<Vec<RateLimitConfig>, String> {
    Ok(load_rate_limits(&app_handle))
}

/// Set / update rate limit for a service.
#[tauri::command]
pub fn engine_guardrails_set_rate_limit(
    app_handle: tauri::AppHandle,
    service: String,
    max_actions: u32,
    window_minutes: u32,
) -> Result<(), String> {
    let mut limits = load_rate_limits(&app_handle);
    if let Some(existing) = limits.iter_mut().find(|l| l.service == service) {
        existing.max_actions = max_actions;
        existing.window_minutes = window_minutes;
    } else {
        limits.push(RateLimitConfig {
            service,
            max_actions,
            window_minutes,
        });
    }
    save_rate_limits(&app_handle, &limits)
}

// ── Permission Commands ────────────────────────────────────────────────

/// Get all agent service permissions.
#[tauri::command]
pub fn engine_guardrails_get_permissions(
    app_handle: tauri::AppHandle,
) -> Result<Vec<AgentServicePermission>, String> {
    Ok(load_permissions(&app_handle))
}

/// Get permissions for a specific agent.
#[tauri::command]
pub fn engine_guardrails_get_agent_permissions(
    app_handle: tauri::AppHandle,
    agent_id: String,
) -> Result<Vec<AgentServicePermission>, String> {
    let perms = load_permissions(&app_handle);
    Ok(perms
        .into_iter()
        .filter(|p| p.agent_id == agent_id)
        .collect())
}

/// Set a single agent-service permission.
#[tauri::command]
pub fn engine_guardrails_set_permission(
    app_handle: tauri::AppHandle,
    agent_id: String,
    service: String,
    access: String,
) -> Result<(), String> {
    // Validate access level
    match access.as_str() {
        "none" | "read" | "write" | "full" => {}
        _ => return Err(format!("Invalid access level: {}", access)),
    }

    let mut perms = load_permissions(&app_handle);

    if let Some(existing) = perms
        .iter_mut()
        .find(|p| p.agent_id == agent_id && p.service == service)
    {
        existing.access = access;
    } else {
        perms.push(AgentServicePermission {
            agent_id,
            service,
            access,
        });
    }

    save_permissions(&app_handle, &perms)
}

// ── Audit Log Commands ─────────────────────────────────────────────────

/// Log a credential/integration usage event.
#[tauri::command]
pub fn engine_guardrails_log_action(
    app_handle: tauri::AppHandle,
    service: String,
    action: String,
    result: String,
) -> Result<(), String> {
    let mut logs = load_audit_log(&app_handle);

    logs.push(CredentialUsageLog {
        timestamp: chrono::Utc::now().to_rfc3339(),
        agent: "default".into(), // TODO: pass actual agent ID from frontend
        service,
        action,
        access_level: "write".into(), // TODO: derive from permission check
        approved: true,
        result,
    });

    // Keep only last 500 entries
    if logs.len() > 500 {
        logs = logs.split_off(logs.len() - 500);
    }

    save_audit_log(&app_handle, &logs)
}

/// Get the audit log.
#[tauri::command]
pub fn engine_guardrails_get_audit_log(
    app_handle: tauri::AppHandle,
) -> Result<Vec<CredentialUsageLog>, String> {
    Ok(load_audit_log(&app_handle))
}

/// Clear the audit log.
#[tauri::command]
pub fn engine_guardrails_clear_audit(
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    save_audit_log(&app_handle, &[])
}

// ── Token Info Commands ────────────────────────────────────────────────

/// Check which tokens are expiring soon (within N days).
#[tauri::command]
pub fn engine_guardrails_check_token_expiry(
    app_handle: tauri::AppHandle,
    within_days: u32,
) -> Result<Vec<TokenInfo>, String> {
    let tokens = load_token_info(&app_handle);
    let cutoff = chrono::Utc::now()
        + chrono::Duration::days(i64::from(within_days));

    let expiring: Vec<TokenInfo> = tokens
        .into_iter()
        .filter(|t| {
            if let Some(ref expires) = t.expires_at {
                if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(expires) {
                    return dt < cutoff;
                }
            }
            false
        })
        .collect();

    Ok(expiring)
}

/// Update token info for a service (e.g. after refresh).
#[tauri::command]
pub fn engine_guardrails_update_token_info(
    app_handle: tauri::AppHandle,
    service: String,
    expires_at: Option<String>,
    has_refresh_token: bool,
) -> Result<(), String> {
    let mut tokens = load_token_info(&app_handle);

    if let Some(existing) = tokens.iter_mut().find(|t| t.service == service) {
        existing.expires_at = expires_at;
        existing.has_refresh_token = has_refresh_token;
        existing.last_refreshed = Some(chrono::Utc::now().to_rfc3339());
    } else {
        tokens.push(TokenInfo {
            service,
            expires_at,
            has_refresh_token,
            last_refreshed: Some(chrono::Utc::now().to_rfc3339()),
        });
    }

    save_token_info(&app_handle, &tokens)
}
