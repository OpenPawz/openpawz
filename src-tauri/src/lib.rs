use std::process::Command;
use tauri::Emitter;

#[tauri::command]
fn check_node_installed() -> bool {
    Command::new("node")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
fn check_openclaw_installed() -> bool {
    let home = dirs::home_dir().unwrap_or_default();
    let openclaw_config = home.join(".openclaw/openclaw.json");
    openclaw_config.exists()
}

#[tauri::command]
fn get_gateway_token() -> Option<String> {
    let home = dirs::home_dir()?;
    let config_path = home.join(".openclaw/openclaw.json");
    let content = std::fs::read_to_string(config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&content).ok()?;
    config["gateway"]["auth"]["token"].as_str().map(|s| s.to_string())
}

#[tauri::command]
async fn install_openclaw(window: tauri::Window) -> Result<(), String> {
    // Emit progress events to the window
    window.emit("install-progress", serde_json::json!({
        "stage": "checking",
        "percent": 0,
        "message": "Checking system..."
    })).ok();

    // Check if npm/node is available
    let has_node = Command::new("node")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !has_node {
        return Err("Node.js is required. Please install Node.js from https://nodejs.org".to_string());
    }

    window.emit("install-progress", serde_json::json!({
        "stage": "downloading",
        "percent": 20,
        "message": "Installing OpenClaw..."
    })).ok();

    // Install openclaw globally
    let install_result = Command::new("npm")
        .args(["install", "-g", "openclaw"])
        .output()
        .map_err(|e| format!("Failed to run npm: {}", e))?;

    if !install_result.status.success() {
        let stderr = String::from_utf8_lossy(&install_result.stderr);
        return Err(format!("npm install failed: {}", stderr));
    }

    window.emit("install-progress", serde_json::json!({
        "stage": "configuring",
        "percent": 60,
        "message": "Running initial setup..."
    })).ok();

    // Run openclaw wizard
    let _wizard_result = Command::new("openclaw")
        .args(["wizard", "--non-interactive"])
        .output();

    // Wizard might fail if already configured, that's ok

    window.emit("install-progress", serde_json::json!({
        "stage": "starting",
        "percent": 80,
        "message": "Starting gateway..."
    })).ok();

    // Start the gateway
    let _ = Command::new("openclaw")
        .args(["gateway", "start"])
        .spawn();

    // Give it a moment to start
    std::thread::sleep(std::time::Duration::from_secs(2));

    window.emit("install-progress", serde_json::json!({
        "stage": "done",
        "percent": 100,
        "message": "Installation complete!"
    })).ok();

    Ok(())
}

#[tauri::command]
fn start_gateway() -> Result<(), String> {
    Command::new("openclaw")
        .args(["gateway", "start"])
        .spawn()
        .map_err(|e| format!("Failed to start gateway: {}", e))?;
    Ok(())
}

#[tauri::command]
fn stop_gateway() -> Result<(), String> {
    let _ = Command::new("pkill")
        .args(["-f", "openclaw-gateway"])
        .output();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            check_node_installed,
            check_openclaw_installed,
            get_gateway_token,
            install_openclaw,
            start_gateway,
            stop_gateway
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
