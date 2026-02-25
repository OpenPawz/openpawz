// commands/browser.rs — Browser profile management, screenshot serving,
// per-agent workspace management, and outbound domain allowlist.

use crate::commands::state::EngineState;
use log::info;
use tauri::State;

// ── Browser Profile Types ──────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BrowserProfile {
    pub id: String,
    pub name: String,
    pub user_data_dir: String,
    pub created_at: String,
    pub last_used: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BrowserConfig {
    pub default_profile: String,
    pub profiles: Vec<BrowserProfile>,
    pub headless: bool,
    pub auto_close_tabs: bool,
    pub idle_timeout_secs: u64,
}

impl Default for BrowserConfig {
    fn default() -> Self {
        Self {
            default_profile: "default".into(),
            profiles: vec![BrowserProfile {
                id: "default".into(),
                name: "Default".into(),
                user_data_dir: default_profile_dir("default"),
                created_at: chrono::Utc::now().to_rfc3339(),
                last_used: chrono::Utc::now().to_rfc3339(),
                size_bytes: 0,
            }],
            headless: true,
            auto_close_tabs: true,
            idle_timeout_secs: 300,
        }
    }
}

fn default_profile_dir(profile_id: &str) -> String {
    let base = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    base.join(".paw")
        .join("browser-profiles")
        .join(profile_id)
        .to_string_lossy()
        .into()
}

fn profile_dir_size(path: &str) -> u64 {
    let p = std::path::Path::new(path);
    if !p.exists() {
        return 0;
    }
    walkdir(p)
}

fn walkdir(path: &std::path::Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let ft = entry.file_type();
            if let Ok(ft) = ft {
                if ft.is_file() {
                    total += entry.metadata().map(|m| m.len()).unwrap_or(0);
                } else if ft.is_dir() {
                    total += walkdir(&entry.path());
                }
            }
        }
    }
    total
}

// ── Browser Profile Commands ───────────────────────────────────────────

#[tauri::command]
pub fn engine_browser_get_config(state: State<'_, EngineState>) -> Result<BrowserConfig, String> {
    match state.store.get_config("browser_config") {
        Ok(Some(json)) => {
            let mut config: BrowserConfig = serde_json::from_str(&json).unwrap_or_default();
            // Refresh sizes
            for p in &mut config.profiles {
                p.size_bytes = profile_dir_size(&p.user_data_dir);
            }
            Ok(config)
        }
        _ => Ok(BrowserConfig::default()),
    }
}

#[tauri::command]
pub fn engine_browser_set_config(
    state: State<'_, EngineState>,
    config: BrowserConfig,
) -> Result<(), String> {
    let json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    state.store.set_config("browser_config", &json)?;
    info!(
        "[browser] Config saved: {} profiles, default={}",
        config.profiles.len(),
        config.default_profile
    );
    Ok(())
}

#[tauri::command]
pub fn engine_browser_create_profile(
    state: State<'_, EngineState>,
    name: String,
) -> Result<BrowserProfile, String> {
    let id = format!(
        "profile-{}",
        uuid::Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("x")
    );
    let user_data_dir = default_profile_dir(&id);

    // Create the directory
    std::fs::create_dir_all(&user_data_dir)
        .map_err(|e| format!("Failed to create profile dir: {}", e))?;

    let profile = BrowserProfile {
        id: id.clone(),
        name,
        user_data_dir,
        created_at: chrono::Utc::now().to_rfc3339(),
        last_used: chrono::Utc::now().to_rfc3339(),
        size_bytes: 0,
    };

    // Add to config
    let mut config: BrowserConfig = match state.store.get_config("browser_config") {
        Ok(Some(json)) => serde_json::from_str(&json).unwrap_or_default(),
        _ => BrowserConfig::default(),
    };
    config.profiles.push(profile.clone());
    let json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    state.store.set_config("browser_config", &json)?;

    info!("[browser] Created profile: {} ({})", id, profile.name);
    Ok(profile)
}

#[tauri::command]
pub fn engine_browser_delete_profile(
    state: State<'_, EngineState>,
    profile_id: String,
) -> Result<(), String> {
    if profile_id == "default" {
        return Err("Cannot delete the default profile".into());
    }

    let mut config: BrowserConfig = match state.store.get_config("browser_config") {
        Ok(Some(json)) => serde_json::from_str(&json).unwrap_or_default(),
        _ => BrowserConfig::default(),
    };

    let profile = config.profiles.iter().find(|p| p.id == profile_id);
    if let Some(p) = profile {
        // Remove data directory
        let dir = p.user_data_dir.clone();
        if std::path::Path::new(&dir).exists() {
            std::fs::remove_dir_all(&dir).ok();
        }
    }

    config.profiles.retain(|p| p.id != profile_id);
    if config.default_profile == profile_id {
        config.default_profile = "default".into();
    }

    let json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    state.store.set_config("browser_config", &json)?;

    info!("[browser] Deleted profile: {}", profile_id);
    Ok(())
}

// ── Screenshot Viewer ──────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ScreenshotEntry {
    pub filename: String,
    pub path: String,
    pub size_bytes: u64,
    pub created_at: String,
    pub base64_png: Option<String>,
}

/// List all screenshots in the paw-screenshots directory.
#[tauri::command]
pub fn engine_screenshots_list() -> Result<Vec<ScreenshotEntry>, String> {
    let dir = std::env::temp_dir().join("paw-screenshots");
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut entries = Vec::new();
    let read =
        std::fs::read_dir(&dir).map_err(|e| format!("Failed to read screenshots dir: {}", e))?;

    for entry in read.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("png") {
            continue;
        }
        let meta = entry.metadata().ok();
        let filename = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into();
        let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let created_at = meta
            .and_then(|m| m.created().ok())
            .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
            .unwrap_or_default();

        entries.push(ScreenshotEntry {
            filename,
            path: path.to_string_lossy().into(),
            size_bytes,
            created_at,
            base64_png: None,
        });
    }

    entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(entries)
}

/// Get a screenshot as base64-encoded PNG for display in chat.
#[tauri::command]
pub fn engine_screenshot_get(filename: String) -> Result<ScreenshotEntry, String> {
    let dir = std::env::temp_dir().join("paw-screenshots");
    let path = dir.join(&filename);
    if !path.exists() {
        return Err(format!("Screenshot not found: {}", filename));
    }

    let data = std::fs::read(&path).map_err(|e| format!("Failed to read screenshot: {}", e))?;
    let base64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data);

    let meta = std::fs::metadata(&path).ok();
    let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let created_at = meta
        .and_then(|m| m.created().ok())
        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
        .unwrap_or_default();

    Ok(ScreenshotEntry {
        filename,
        path: path.to_string_lossy().into(),
        size_bytes,
        created_at,
        base64_png: Some(base64),
    })
}

/// Delete a screenshot.
#[tauri::command]
pub fn engine_screenshot_delete(filename: String) -> Result<(), String> {
    let dir = std::env::temp_dir().join("paw-screenshots");
    let path = dir.join(&filename);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Failed to delete screenshot: {}", e))?;
    }
    info!("[browser] Deleted screenshot: {}", filename);
    Ok(())
}

// ── Per-Agent Workspaces ───────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WorkspaceInfo {
    pub agent_id: String,
    pub path: String,
    pub total_files: u64,
    pub total_size_bytes: u64,
    pub exists: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WorkspaceFile {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub modified_at: String,
}

/// List all agent workspaces with stats.
#[tauri::command]
pub fn engine_workspaces_list() -> Result<Vec<WorkspaceInfo>, String> {
    let base = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".paw")
        .join("workspaces");

    if !base.exists() {
        return Ok(vec![]);
    }

    let mut workspaces = Vec::new();
    let read =
        std::fs::read_dir(&base).map_err(|e| format!("Failed to read workspaces dir: {}", e))?;

    for entry in read.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let agent_id = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let (total_files, total_size) = count_dir_recursive(&path);

        workspaces.push(WorkspaceInfo {
            agent_id,
            path: path.to_string_lossy().into(),
            total_files,
            total_size_bytes: total_size,
            exists: true,
        });
    }

    Ok(workspaces)
}

/// List files in an agent's workspace directory.
#[tauri::command]
pub fn engine_workspace_files(
    agent_id: String,
    subdir: Option<String>,
) -> Result<Vec<WorkspaceFile>, String> {
    let base = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".paw")
        .join("workspaces")
        .join(&agent_id);

    let target = if let Some(ref sub) = subdir {
        base.join(sub)
    } else {
        base.clone()
    };

    if !target.exists() {
        return Ok(vec![]);
    }

    let mut files = Vec::new();
    let read =
        std::fs::read_dir(&target).map_err(|e| format!("Failed to read workspace dir: {}", e))?;

    for entry in read.flatten() {
        let path = entry.path();
        let meta = entry.metadata().ok();
        let is_dir = path.is_dir();
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let size_bytes = if is_dir {
            count_dir_recursive(&path).1
        } else {
            meta.as_ref().map(|m| m.len()).unwrap_or(0)
        };
        let modified_at = meta
            .and_then(|m| m.modified().ok())
            .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
            .unwrap_or_default();

        files.push(WorkspaceFile {
            name,
            path: path.to_string_lossy().into(),
            is_dir,
            size_bytes,
            modified_at,
        });
    }

    files.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(files)
}

/// Delete an agent's workspace entirely.
#[tauri::command]
pub fn engine_workspace_delete(agent_id: String) -> Result<(), String> {
    let base = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".paw")
        .join("workspaces")
        .join(&agent_id);

    if base.exists() {
        std::fs::remove_dir_all(&base).map_err(|e| format!("Failed to delete workspace: {}", e))?;
        info!("[workspace] Deleted workspace for agent: {}", agent_id);
    }
    Ok(())
}

fn count_dir_recursive(path: &std::path::Path) -> (u64, u64) {
    let mut files = 0u64;
    let mut bytes = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(ft) = entry.file_type() {
                if ft.is_file() {
                    files += 1;
                    bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
                } else if ft.is_dir() {
                    let (f, b) = count_dir_recursive(&entry.path());
                    files += f;
                    bytes += b;
                }
            }
        }
    }
    (files, bytes)
}

// ── Outbound Domain Allowlist ──────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NetworkPolicy {
    /// Whether the outbound allowlist is enforced
    pub enabled: bool,
    /// Allowed domains (if enabled, only these domains can be fetched)
    pub allowed_domains: Vec<String>,
    /// Blocked domains (always blocked even if allowlist is disabled)
    pub blocked_domains: Vec<String>,
    /// Whether to log all outbound requests
    pub log_requests: bool,
    /// Recent outbound request log (last 100)
    pub recent_requests: Vec<NetworkRequest>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NetworkRequest {
    pub url: String,
    pub domain: String,
    pub allowed: bool,
    pub timestamp: String,
    pub tool_name: String,
}

impl Default for NetworkPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            allowed_domains: vec![
                // Default safe domains
                "api.openai.com".into(),
                "api.anthropic.com".into(),
                "generativelanguage.googleapis.com".into(),
                "openrouter.ai".into(),
                "api.elevenlabs.io".into(),
                "duckduckgo.com".into(),
                "html.duckduckgo.com".into(),
                "api.coinbase.com".into(),
                "localhost".into(),
            ],
            blocked_domains: vec![
                // Default blocked
                "pastebin.com".into(),
                "transfer.sh".into(),
                "file.io".into(),
                "0x0.st".into(),
            ],
            log_requests: true,
            recent_requests: Vec::new(),
        }
    }
}

#[tauri::command]
pub fn engine_network_get_policy(state: State<'_, EngineState>) -> Result<NetworkPolicy, String> {
    match state.store.get_config("network_policy") {
        Ok(Some(json)) => serde_json::from_str(&json).map_err(|e| e.to_string()),
        _ => Ok(NetworkPolicy::default()),
    }
}

#[tauri::command]
pub fn engine_network_set_policy(
    state: State<'_, EngineState>,
    policy: NetworkPolicy,
) -> Result<(), String> {
    // Don't persist recent_requests — they're ephemeral
    let mut save_policy = policy.clone();
    save_policy.recent_requests = Vec::new();
    let json = serde_json::to_string(&save_policy).map_err(|e| e.to_string())?;
    state.store.set_config("network_policy", &json)?;
    info!(
        "[network] Policy saved: enabled={}, {} allowed, {} blocked",
        policy.enabled,
        policy.allowed_domains.len(),
        policy.blocked_domains.len()
    );
    Ok(())
}

/// Check if a URL is allowed by the outbound policy.
/// Returns (allowed: bool, domain: String).
#[tauri::command]
pub fn engine_network_check_url(
    state: State<'_, EngineState>,
    url: String,
) -> Result<(bool, String), String> {
    let policy: NetworkPolicy = match state.store.get_config("network_policy") {
        Ok(Some(json)) => serde_json::from_str(&json).unwrap_or_default(),
        _ => NetworkPolicy::default(),
    };

    let domain = extract_domain(&url);

    // Always block blocked domains
    if policy
        .blocked_domains
        .iter()
        .any(|d| domain_matches(&domain, d))
    {
        return Ok((false, domain));
    }

    // If allowlist is enabled, check against it
    if policy.enabled {
        let allowed = policy
            .allowed_domains
            .iter()
            .any(|d| domain_matches(&domain, d));
        return Ok((allowed, domain));
    }

    // If allowlist is disabled, all non-blocked domains are allowed
    Ok((true, domain))
}

/// Public wrapper for use by tool_executor network policy enforcement
pub fn extract_domain_from_url(url: &str) -> String {
    extract_domain(url)
}

/// Public wrapper for use by tool_executor network policy enforcement
pub fn domain_matches_pub(actual: &str, pattern: &str) -> bool {
    domain_matches(actual, pattern)
}

fn extract_domain(url: &str) -> String {
    url.trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_lowercase()
}

fn domain_matches(actual: &str, pattern: &str) -> bool {
    let pattern = pattern.to_lowercase();
    let actual = actual.to_lowercase();
    if actual == pattern {
        return true;
    }
    // Wildcard subdomain matching: *.example.com matches sub.example.com
    if pattern.starts_with("*.") {
        let suffix = &pattern[1..]; // .example.com
        return actual.ends_with(suffix);
    }
    // Also match subdomains: api.openai.com matches openai.com pattern
    actual.ends_with(&format!(".{}", pattern))
}
