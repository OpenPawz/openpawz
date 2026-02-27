// commands/health_monitor.rs — Integration health monitoring & workflow chains
//
// Phase 6: Periodic credential checks, health status, chain rules.

use crate::engine::channels;
use serde::{Deserialize, Serialize};

// ── Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceHealth {
    pub service: String,
    #[serde(rename = "serviceName")]
    pub service_name: String,
    pub icon: String,
    pub status: String, // healthy | degraded | error | expired | unknown
    #[serde(rename = "lastChecked")]
    pub last_checked: String,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(rename = "tokenExpiry", default)]
    pub token_expiry: Option<String>,
    #[serde(rename = "daysUntilExpiry", default)]
    pub days_until_expiry: Option<i64>,
    #[serde(rename = "recentFailures", default)]
    pub recent_failures: u32,
    #[serde(rename = "todayActions", default)]
    pub today_actions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainRule {
    pub id: String,
    pub name: String,
    pub trigger: ChainEndpoint,
    pub then: ChainEndpoint,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainEndpoint {
    pub service: String,
    pub action: String,
    #[serde(default)]
    pub params: Option<std::collections::HashMap<String, String>>,
}

// ── Storage ────────────────────────────────────────────────────────────

const HEALTH_KEY: &str = "integration_health";
const CHAINS_KEY: &str = "workflow_chains";

fn load_health(app: &tauri::AppHandle) -> Vec<ServiceHealth> {
    channels::load_channel_config::<Vec<ServiceHealth>>(app, HEALTH_KEY).unwrap_or_default()
}

fn save_health(app: &tauri::AppHandle, health: &[ServiceHealth]) -> Result<(), String> {
    channels::save_channel_config(app, HEALTH_KEY, &health.to_vec()).map_err(|e| e.to_string())
}

fn load_chains(app: &tauri::AppHandle) -> Vec<ChainRule> {
    channels::load_channel_config::<Vec<ChainRule>>(app, CHAINS_KEY).unwrap_or_default()
}

fn save_chains(app: &tauri::AppHandle, chains: &[ChainRule]) -> Result<(), String> {
    channels::save_channel_config(app, CHAINS_KEY, &chains.to_vec()).map_err(|e| e.to_string())
}

// ── Health Commands ────────────────────────────────────────────────────

/// Get health status for all connected services.
#[tauri::command]
pub fn engine_health_check_services(
    app_handle: tauri::AppHandle,
) -> Result<Vec<ServiceHealth>, String> {
    let mut health = load_health(&app_handle);

    // Check for connected services with no health record
    let connected: Vec<String> =
        channels::load_channel_config::<Vec<String>>(&app_handle, "connected_service_ids")
            .unwrap_or_default();

    let now = chrono::Utc::now().to_rfc3339();
    for svc in &connected {
        if !health.iter().any(|h| &h.service == svc) {
            health.push(ServiceHealth {
                service: svc.clone(),
                service_name: capitalize(svc),
                icon: "extension".into(),
                status: "unknown".into(),
                last_checked: now.clone(),
                message: None,
                token_expiry: None,
                days_until_expiry: None,
                recent_failures: 0,
                today_actions: 0,
            });
        }
    }

    // Update timestamps
    for h in &mut health {
        h.last_checked = now.clone();
        // Derive status from failures
        if h.recent_failures >= 3 {
            h.status = "error".into();
            h.message = Some(format!("{} recent failures", h.recent_failures));
        }
    }

    let _ = save_health(&app_handle, &health);
    Ok(health)
}

/// Update health status for a specific service (e.g. after an action).
#[tauri::command]
pub fn engine_health_update_service(
    app_handle: tauri::AppHandle,
    service: String,
    status: String,
    message: Option<String>,
    recent_failures: Option<u32>,
) -> Result<(), String> {
    let mut health = load_health(&app_handle);
    let now = chrono::Utc::now().to_rfc3339();

    if let Some(h) = health.iter_mut().find(|h| h.service == service) {
        h.status = status;
        h.message = message;
        h.last_checked = now;
        if let Some(f) = recent_failures {
            h.recent_failures = f;
        }
    } else {
        health.push(ServiceHealth {
            service: service.clone(),
            service_name: capitalize(&service),
            icon: "extension".into(),
            status,
            last_checked: now,
            message,
            token_expiry: None,
            days_until_expiry: None,
            recent_failures: recent_failures.unwrap_or(0),
            today_actions: 0,
        });
    }

    save_health(&app_handle, &health)
}

/// Trigger re-authentication for a service.
#[tauri::command]
pub fn engine_health_trigger_reauth(service: String) -> Result<String, String> {
    // Stub: in production, this would clear stored credentials and
    // prompt the credential flow (Phase 3). For now, return guidance.
    Ok(format!(
        "Re-authentication triggered for {}. Please reconnect in the Integrations view.",
        capitalize(&service)
    ))
}

// ── Chain Rule Commands ────────────────────────────────────────────────

/// List all workflow chain rules.
#[tauri::command]
pub fn engine_health_list_chains(app_handle: tauri::AppHandle) -> Result<Vec<ChainRule>, String> {
    Ok(load_chains(&app_handle))
}

/// Create or update a chain rule.
#[tauri::command]
pub fn engine_health_save_chain(
    app_handle: tauri::AppHandle,
    chain: ChainRule,
) -> Result<(), String> {
    let mut chains = load_chains(&app_handle);

    if let Some(pos) = chains.iter().position(|c| c.id == chain.id) {
        chains[pos] = chain;
    } else {
        chains.push(chain);
    }

    save_chains(&app_handle, &chains)
}

/// Toggle a chain rule on/off.
#[tauri::command]
pub fn engine_health_toggle_chain(
    app_handle: tauri::AppHandle,
    chain_id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut chains = load_chains(&app_handle);

    if let Some(chain) = chains.iter_mut().find(|c| c.id == chain_id) {
        chain.enabled = enabled;
        save_chains(&app_handle, &chains)
    } else {
        Err(format!("Chain rule not found: {}", chain_id))
    }
}

/// Delete a chain rule.
#[tauri::command]
pub fn engine_health_delete_chain(
    app_handle: tauri::AppHandle,
    chain_id: String,
) -> Result<(), String> {
    let mut chains = load_chains(&app_handle);
    let before = chains.len();
    chains.retain(|c| c.id != chain_id);
    if chains.len() == before {
        return Err(format!("Chain rule not found: {}", chain_id));
    }
    save_chains(&app_handle, &chains)
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(c) => c.to_uppercase().to_string() + chars.as_str(),
    }
}
