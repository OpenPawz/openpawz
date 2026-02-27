// src-tauri/src/commands/integrations.rs — Integration Management Commands
//
// Consolidated Tauri commands for connecting, disconnecting, listing,
// and managing integration services. Bridges the frontend Integrations
// view to the channel config persistence layer.

use crate::engine::channels;
use serde::{Deserialize, Serialize};

// ── Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectedService {
    pub service_id: String,
    pub connected_at: String,
    pub last_used: Option<String>,
    pub tool_count: u32,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrationOverview {
    pub connected: Vec<ConnectedService>,
    pub total_actions_today: u32,
    pub services_needing_attention: u32,
}

// ── Storage keys ───────────────────────────────────────────────────────

const CONNECTED_KEY: &str = "connected_service_ids";
const CONNECTED_DETAILS_KEY: &str = "connected_service_details";

// ── Helpers ────────────────────────────────────────────────────────────

fn load_connected_ids(app: &tauri::AppHandle) -> Vec<String> {
    channels::load_channel_config::<Vec<String>>(app, CONNECTED_KEY).unwrap_or_default()
}

fn save_connected_ids(app: &tauri::AppHandle, ids: &[String]) -> Result<(), String> {
    channels::save_channel_config(app, CONNECTED_KEY, &ids.to_vec()).map_err(|e| e.to_string())
}

fn load_details(app: &tauri::AppHandle) -> Vec<ConnectedService> {
    channels::load_channel_config::<Vec<ConnectedService>>(app, CONNECTED_DETAILS_KEY)
        .unwrap_or_default()
}

fn save_details(app: &tauri::AppHandle, details: &[ConnectedService]) -> Result<(), String> {
    channels::save_channel_config(app, CONNECTED_DETAILS_KEY, &details.to_vec())
        .map_err(|e| e.to_string())
}

// ── Commands ───────────────────────────────────────────────────────────

/// List all connected service IDs.
#[tauri::command]
pub fn engine_integrations_list_connected(
    app_handle: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    Ok(load_connected_ids(&app_handle))
}

/// Get detailed info for all connected services.
#[tauri::command]
pub fn engine_integrations_get_connected(
    app_handle: tauri::AppHandle,
) -> Result<Vec<ConnectedService>, String> {
    Ok(load_details(&app_handle))
}

/// Connect a service — adds to connected list and creates a detail record.
#[tauri::command]
pub fn engine_integrations_connect(
    app_handle: tauri::AppHandle,
    service_id: String,
    tool_count: u32,
) -> Result<ConnectedService, String> {
    let mut ids = load_connected_ids(&app_handle);
    if !ids.contains(&service_id) {
        ids.push(service_id.clone());
        save_connected_ids(&app_handle, &ids)?;
    }

    let now = chrono::Utc::now().to_rfc3339();
    let mut details = load_details(&app_handle);
    // Remove old entry if exists
    details.retain(|d| d.service_id != service_id);

    let svc = ConnectedService {
        service_id: service_id.clone(),
        connected_at: now.clone(),
        last_used: Some(now),
        tool_count,
        status: "connected".into(),
    };
    details.push(svc.clone());
    save_details(&app_handle, &details)?;

    // Also update health monitor with initial status
    let _ = crate::commands::health_monitor::engine_health_update_service(
        app_handle,
        service_id,
        "healthy".into(),
        Some("Connected".into()),
        None,
    );

    Ok(svc)
}

/// Disconnect a service — removes from connected list and updates status.
#[tauri::command]
pub fn engine_integrations_disconnect(
    app_handle: tauri::AppHandle,
    service_id: String,
) -> Result<(), String> {
    let mut ids = load_connected_ids(&app_handle);
    ids.retain(|id| id != &service_id);
    save_connected_ids(&app_handle, &ids)?;

    let mut details = load_details(&app_handle);
    if let Some(d) = details.iter_mut().find(|d| d.service_id == service_id) {
        d.status = "disconnected".into();
    }
    save_details(&app_handle, &details)?;

    // Update health monitor
    let _ = crate::commands::health_monitor::engine_health_update_service(
        app_handle,
        service_id,
        "unknown".into(),
        Some("Disconnected".into()),
        None,
    );

    Ok(())
}

/// Update the last-used timestamp for a service.
#[tauri::command]
pub fn engine_integrations_touch(
    app_handle: tauri::AppHandle,
    service_id: String,
) -> Result<(), String> {
    let mut details = load_details(&app_handle);
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(d) = details.iter_mut().find(|d| d.service_id == service_id) {
        d.last_used = Some(now);
    }
    save_details(&app_handle, &details)?;
    Ok(())
}

/// Get a high-level overview: connected count, today's actions, attention needed.
#[tauri::command]
pub fn engine_integrations_overview(
    app_handle: tauri::AppHandle,
) -> Result<IntegrationOverview, String> {
    let connected = load_details(&app_handle);
    let needing_attention = connected
        .iter()
        .filter(|c| c.status == "error" || c.status == "expired")
        .count() as u32;

    // Get action stats from action_log
    let total_today = match crate::commands::action_log::engine_action_log_stats(app_handle) {
        Ok(stats) => stats.total as u32,
        Err(_) => 0,
    };

    Ok(IntegrationOverview {
        connected,
        total_actions_today: total_today,
        services_needing_attention: needing_attention,
    })
}
