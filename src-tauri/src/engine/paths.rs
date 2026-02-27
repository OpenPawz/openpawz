// Paw Engine — Centralized path management
//
// All paths under the Paw data root are resolved through this module.
// Default root: `~/.paw/`.  Users can override via a redirect file
// at `~/.paw/storage.conf` (single line: the new root path).
//
// The redirect file lives at the DEFAULT location so we can always
// find it — even when the data itself has been moved elsewhere.

use std::path::PathBuf;
use std::sync::RwLock;

/// Cached override for the data root, loaded from `~/.paw/storage.conf`.
/// `None` → use default `~/.paw/`.  `Some(path)` → user-configured root.
static DATA_ROOT_OVERRIDE: RwLock<Option<PathBuf>> = RwLock::new(None);

/// The fixed location of the redirect file (always `~/.paw/storage.conf`).
fn storage_conf_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".paw").join("storage.conf"))
}

/// Load the data root override from `~/.paw/storage.conf`.
/// Called once at app startup (before SessionStore::open).
pub fn load_data_root_from_conf() {
    if let Some(conf) = storage_conf_path() {
        if conf.exists() {
            if let Ok(content) = std::fs::read_to_string(&conf) {
                let trimmed = content.trim().to_string();
                if !trimmed.is_empty() {
                    let pb = PathBuf::from(&trimmed);
                    if pb.exists() || std::fs::create_dir_all(&pb).is_ok() {
                        log::info!("[paths] Custom data root loaded: {}", trimmed);
                        set_data_root_override(Some(pb));
                        return;
                    }
                    log::warn!(
                        "[paths] Custom data root '{}' is invalid, falling back to default",
                        trimmed
                    );
                }
            }
        }
    }
    log::info!("[paths] Using default data root (~/.paw/)");
}

/// Persist the data root override to `~/.paw/storage.conf`.
pub fn save_data_root_to_conf(path: Option<&str>) -> Result<(), String> {
    let conf = storage_conf_path().ok_or("Cannot determine home directory")?;
    // Ensure ~/.paw/ exists
    if let Some(parent) = conf.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create ~/.paw/: {}", e))?;
    }
    match path {
        Some(p) if !p.is_empty() => {
            std::fs::write(&conf, p).map_err(|e| format!("Cannot write storage.conf: {}", e))?;
        }
        _ => {
            // Remove the file to reset to default
            if conf.exists() {
                std::fs::remove_file(&conf).ok();
            }
        }
    }
    Ok(())
}

/// Set the data root override (called once at startup from the stored config).
pub fn set_data_root_override(path: Option<PathBuf>) {
    let mut w = DATA_ROOT_OVERRIDE.write().unwrap();
    *w = path;
}

/// Get the current data root override (for reporting to the frontend).
pub fn get_data_root_override() -> Option<PathBuf> {
    DATA_ROOT_OVERRIDE.read().unwrap().clone()
}

// ── Root ───────────────────────────────────────────────────────────────

/// The default data root: `~/.paw/`
pub fn default_data_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".paw")
}

/// The root data directory for all Paw engine data.
/// Defaults to `~/.paw/`, overridable via Settings → Storage.
pub fn paw_data_dir() -> PathBuf {
    // Check override first
    if let Some(ref p) = *DATA_ROOT_OVERRIDE.read().unwrap() {
        return p.clone();
    }
    default_data_dir()
}

// ── Derived paths ──────────────────────────────────────────────────────

/// Engine SQLite database: `{data_root}/engine.db`
pub fn engine_db_path() -> PathBuf {
    let dir = paw_data_dir();
    std::fs::create_dir_all(&dir).ok();
    dir.join("engine.db")
}

/// Per-agent workspace: `{data_root}/workspaces/{agent_id}/`
pub fn agent_workspace_dir(agent_id: &str) -> PathBuf {
    paw_data_dir().join("workspaces").join(agent_id)
}

/// TOML skills directory: `{data_root}/skills/`
pub fn skills_dir() -> Option<PathBuf> {
    Some(paw_data_dir().join("skills"))
}

/// Browser profile directory: `{data_root}/browser-profiles/{profile_id}/`
pub fn browser_profile_dir(profile_id: &str) -> PathBuf {
    paw_data_dir().join("browser-profiles").join(profile_id)
}

/// Agent workspaces base: `{data_root}/workspaces/`
pub fn workspaces_base_dir() -> PathBuf {
    paw_data_dir().join("workspaces")
}
