// Paw Agent Engine — Channel Access Control
//
// Allowlist, pairing, and user management helpers shared by all channel bridges.

use super::PendingUser;
use crate::engine::state::EngineState;
use log::info;
use tauri::Manager;

/// Check access control. Returns Ok(()) if allowed, Err(denial message) if denied.
/// Also handles adding pending pairing requests.
pub fn check_access(
    dm_policy: &str,
    user_id: &str,
    username: &str,
    display_name: &str,
    allowed_users: &[String],
    pending_users: &mut Vec<PendingUser>,
) -> Result<(), String> {
    match dm_policy {
        "allowlist" => {
            if !allowed_users.contains(&user_id.to_string()) {
                return Err("⛔ You're not on the allowlist. Ask the Paw owner to add you.".into());
            }
        }
        "pairing" => {
            if !allowed_users.contains(&user_id.to_string()) {
                if !pending_users.iter().any(|p| p.user_id == user_id) {
                    pending_users.push(PendingUser {
                        user_id: user_id.to_string(),
                        username: username.to_string(),
                        display_name: display_name.to_string(),
                        requested_at: chrono::Utc::now().to_rfc3339(),
                    });
                }
                return Err("🔒 Pairing request sent to Paw. Waiting for approval...".into());
            }
        }
        // "open" — allow everyone
        _ => {}
    }
    Ok(())
}

/// Generic approve/deny/remove user helpers for any channel config.
pub fn approve_user_generic(
    app_handle: &tauri::AppHandle,
    config_key: &str,
    user_id: &str,
) -> Result<(), String>
where
{
    // Load raw config as Value, modify, save
    let engine_state = app_handle.try_state::<EngineState>()
        .ok_or("Engine not initialized")?;
    let json_str = engine_state.store.get_config(config_key)
        .map_err(|e| format!("Load config: {}", e))?
        .unwrap_or_else(|| "{}".into());
    let mut val: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Parse config: {}", e))?;

    // Add to allowed_users
    if let Some(arr) = val.get_mut("allowed_users").and_then(|v| v.as_array_mut()) {
        let uid_val = serde_json::Value::String(user_id.to_string());
        if !arr.contains(&uid_val) {
            arr.push(uid_val);
        }
    }
    // Remove from pending_users
    if let Some(arr) = val.get_mut("pending_users").and_then(|v| v.as_array_mut()) {
        arr.retain(|p| p.get("user_id").and_then(|v| v.as_str()) != Some(user_id));
    }

    let new_json = serde_json::to_string(&val).map_err(|e| format!("Serialize: {}", e))?;
    engine_state.store.set_config(config_key, &new_json)?;
    info!("[{}] User {} approved", config_key, user_id);
    Ok(())
}

pub fn deny_user_generic(
    app_handle: &tauri::AppHandle,
    config_key: &str,
    user_id: &str,
) -> Result<(), String> {
    let engine_state = app_handle.try_state::<EngineState>()
        .ok_or("Engine not initialized")?;
    let json_str = engine_state.store.get_config(config_key)
        .map_err(|e| format!("Load config: {}", e))?
        .unwrap_or_else(|| "{}".into());
    let mut val: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Parse config: {}", e))?;

    if let Some(arr) = val.get_mut("pending_users").and_then(|v| v.as_array_mut()) {
        arr.retain(|p| p.get("user_id").and_then(|v| v.as_str()) != Some(user_id));
    }

    let new_json = serde_json::to_string(&val).map_err(|e| format!("Serialize: {}", e))?;
    engine_state.store.set_config(config_key, &new_json)?;
    info!("[{}] User {} denied", config_key, user_id);
    Ok(())
}

pub fn remove_user_generic(
    app_handle: &tauri::AppHandle,
    config_key: &str,
    user_id: &str,
) -> Result<(), String> {
    let engine_state = app_handle.try_state::<EngineState>()
        .ok_or("Engine not initialized")?;
    let json_str = engine_state.store.get_config(config_key)
        .map_err(|e| format!("Load config: {}", e))?
        .unwrap_or_else(|| "{}".into());
    let mut val: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Parse config: {}", e))?;

    if let Some(arr) = val.get_mut("allowed_users").and_then(|v| v.as_array_mut()) {
        arr.retain(|v| v.as_str() != Some(user_id));
    }

    let new_json = serde_json::to_string(&val).map_err(|e| format!("Serialize: {}", e))?;
    engine_state.store.set_config(config_key, &new_json)?;
    info!("[{}] User {} removed", config_key, user_id);
    Ok(())
}
