// PawzOS — OS Control Tools
//
// These tools give the AI agent eyes and hands over the running OS:
//   pawz_window_list   — list all open windows (app name, PID, focused)
//   pawz_get_tree      — read the accessibility tree of a window
//   pawz_type_text     — type text into the currently focused element
//   pawz_key_combo     — press a key combination (e.g. Ctrl+S, Cmd+Tab)
//   pawz_click_element — click a UI element by its accessibility path
//   pawz_focus_window  — bring a window to the foreground
//
// AT-SPI (Linux) provides the structured UI tree — every installed app
// exposes it automatically, no API keys required.
// enigo provides cross-platform keyboard/mouse injection.

use crate::atoms::types::{FunctionDefinition, ToolDefinition};
use serde_json::Value;

// ── Tool definitions ─────────────────────────────────────────────────────────

pub fn definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "pawz_window_list".into(),
                description: "List all open application windows on the OS. Returns window titles, \
                    app names, PIDs, and which window is currently focused. Use this to discover \
                    what apps the user has open before interacting with them."
                    .into(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {},
                    "required": []
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "pawz_get_tree".into(),
                description: "Read the full accessibility tree of a window or app. Returns a \
                    structured JSON tree of all UI elements (buttons, text fields, labels, menus, \
                    etc.) with their roles, names, and values. Use this to understand the current \
                    state of any app before interacting with it."
                    .into(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "app_name": {
                            "type": "string",
                            "description": "Name of the application to inspect (e.g. 'Firefox', 'Gmail', 'VSCode')"
                        },
                        "max_depth": {
                            "type": "integer",
                            "description": "Maximum tree depth to traverse (default: 4, max: 8)",
                            "minimum": 1,
                            "maximum": 8
                        }
                    },
                    "required": ["app_name"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "pawz_type_text".into(),
                description: "Type text into the currently focused input field. The text is \
                    injected at the OS level — works in any app without any API access."
                    .into(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "text": {
                            "type": "string",
                            "description": "The text to type"
                        }
                    },
                    "required": ["text"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "pawz_key_combo".into(),
                description: "Press a keyboard shortcut or key combination. Examples: 'ctrl+s' \
                    to save, 'ctrl+t' to open a new tab, 'alt+f4' to close, 'tab' to focus next \
                    element, 'enter' to confirm, 'escape' to cancel."
                    .into(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "combo": {
                            "type": "string",
                            "description": "Key combination in lower-case dash-separated format. \
                                Modifiers: ctrl, alt, shift, meta (Win/Cmd). \
                                Examples: 'ctrl+s', 'ctrl+shift+t', 'alt+tab', 'enter', 'escape', 'tab'"
                        }
                    },
                    "required": ["combo"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "pawz_click_element".into(),
                description: "Click a UI element in an application by its accessibility path \
                    (from pawz_get_tree). Navigates the accessibility tree and triggers the \
                    element's default action (click, press, etc.)."
                    .into(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "app_name": {
                            "type": "string",
                            "description": "Name of the application containing the element"
                        },
                        "element_path": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Path of element names from the tree root to the target. \
                                Each entry is the 'name' field of the element at that level."
                        }
                    },
                    "required": ["app_name", "element_path"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "pawz_focus_window".into(),
                description: "Bring an application window to the foreground and give it keyboard \
                    focus. Required before typing or pressing keys in an app."
                    .into(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "app_name": {
                            "type": "string",
                            "description": "Name of the application to focus (e.g. 'Firefox', 'Thunderbird')"
                        }
                    },
                    "required": ["app_name"]
                }),
            },
        },
    ]
}

// ── Executor ─────────────────────────────────────────────────────────────────

pub async fn execute(
    name: &str,
    args: &Value,
    _app_handle: &tauri::AppHandle,
    _agent_id: &str,
) -> Option<Result<String, String>> {
    match name {
        "pawz_window_list" => Some(window_list().await),
        "pawz_get_tree" => {
            let app_name = args["app_name"].as_str().unwrap_or("").to_string();
            let max_depth = args["max_depth"].as_u64().unwrap_or(4).min(8) as usize;
            Some(get_tree(&app_name, max_depth).await)
        }
        "pawz_type_text" => {
            let text = args["text"].as_str().unwrap_or("").to_string();
            Some(type_text(&text))
        }
        "pawz_key_combo" => {
            let combo = args["combo"].as_str().unwrap_or("").to_string();
            Some(key_combo(&combo))
        }
        "pawz_click_element" => {
            let app_name = args["app_name"].as_str().unwrap_or("").to_string();
            let path: Vec<String> = args["element_path"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            Some(click_element(&app_name, &path).await)
        }
        "pawz_focus_window" => {
            let app_name = args["app_name"].as_str().unwrap_or("").to_string();
            Some(focus_window(&app_name).await)
        }
        _ => None,
    }
}

// ── Linux AT-SPI implementation ───────────────────────────────────────────────

#[cfg(target_os = "linux")]
mod linux {
    use atspi::{
        connection::AccessibilityConnection,
        proxy::accessible::AccessibleProxy,
        AccessibilityConnection as Conn,
    };
    use serde_json::{json, Value};

    /// Connect to the AT-SPI bus and return the root accessible.
    async fn connect() -> Result<Conn, String> {
        AccessibilityConnection::new()
            .await
            .map_err(|e| format!("Failed to connect to AT-SPI bus: {}", e))
    }

    /// Recursively build a JSON accessibility tree node.
    #[async_recursion::async_recursion]
    pub async fn build_tree(proxy: &AccessibleProxy<'_>, depth: usize) -> Value {
        let name = proxy.name().await.unwrap_or_default();
        let role = proxy
            .get_role()
            .await
            .map(|r| format!("{:?}", r))
            .unwrap_or_default();
        let child_count = proxy.child_count().await.unwrap_or(0);

        let children: Vec<Value> = if depth > 0 && child_count > 0 {
            let mut out = Vec::new();
            for i in 0..child_count.min(64) {
                if let Ok(child) = proxy.get_child_at_index(i).await {
                    let conn = child.inner().connection();
                    if let Ok(child_proxy) = AccessibleProxy::builder(conn)
                        .destination(child.name.as_deref().unwrap_or(""))
                        .path(child.path.as_str())
                        .build()
                        .await
                    {
                        out.push(build_tree(&child_proxy, depth - 1).await);
                    }
                }
            }
            out
        } else {
            vec![]
        };

        json!({
            "name": name,
            "role": role,
            "children": children,
        })
    }

    /// List all top-level windows via AT-SPI.
    pub async fn window_list() -> Result<String, String> {
        let conn = connect().await?;
        let desktop = conn.desktop().await.map_err(|e| e.to_string())?;

        let mut windows = Vec::new();
        let child_count = desktop.child_count().await.unwrap_or(0);

        for i in 0..child_count {
            if let Ok(app_ref) = desktop.get_child_at_index(i).await {
                let atspi_conn = app_ref.inner().connection();
                if let Ok(app) = AccessibleProxy::builder(atspi_conn)
                    .destination(app_ref.name.as_deref().unwrap_or(""))
                    .path(app_ref.path.as_str())
                    .build()
                    .await
                {
                    let app_name = app.name().await.unwrap_or_default();
                    let window_count = app.child_count().await.unwrap_or(0);
                    for j in 0..window_count {
                        if let Ok(win_ref) = app.get_child_at_index(j).await {
                            let win_conn = win_ref.inner().connection();
                            if let Ok(win) = AccessibleProxy::builder(win_conn)
                                .destination(win_ref.name.as_deref().unwrap_or(""))
                                .path(win_ref.path.as_str())
                                .build()
                                .await
                            {
                                let win_name = win.name().await.unwrap_or_default();
                                let role = win
                                    .get_role()
                                    .await
                                    .map(|r| format!("{:?}", r))
                                    .unwrap_or_default();
                                if role.to_lowercase().contains("frame")
                                    || role.to_lowercase().contains("window")
                                    || role.to_lowercase().contains("dialog")
                                {
                                    windows.push(json!({
                                        "app": app_name,
                                        "title": win_name,
                                        "role": role,
                                    }));
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(serde_json::to_string_pretty(&windows).unwrap_or_default())
    }

    /// Get the accessibility tree of a named application.
    pub async fn get_tree(app_name: &str, max_depth: usize) -> Result<String, String> {
        let conn = connect().await?;
        let desktop = conn.desktop().await.map_err(|e| e.to_string())?;
        let child_count = desktop.child_count().await.unwrap_or(0);

        for i in 0..child_count {
            if let Ok(app_ref) = desktop.get_child_at_index(i).await {
                let atspi_conn = app_ref.inner().connection();
                if let Ok(app) = AccessibleProxy::builder(atspi_conn)
                    .destination(app_ref.name.as_deref().unwrap_or(""))
                    .path(app_ref.path.as_str())
                    .build()
                    .await
                {
                    let name = app.name().await.unwrap_or_default();
                    if name.to_lowercase().contains(&app_name.to_lowercase()) {
                        let tree = build_tree(&app, max_depth).await;
                        return Ok(serde_json::to_string_pretty(&tree).unwrap_or_default());
                    }
                }
            }
        }

        Err(format!(
            "No application named '{}' found in the accessibility tree. \
             Make sure the app is open and accessible.",
            app_name
        ))
    }

    /// Click an element at the given path in the accessibility tree.
    pub async fn click_element(app_name: &str, path: &[String]) -> Result<String, String> {
        let conn = connect().await?;
        let desktop = conn.desktop().await.map_err(|e| e.to_string())?;
        let child_count = desktop.child_count().await.unwrap_or(0);

        // Find the app
        for i in 0..child_count {
            if let Ok(app_ref) = desktop.get_child_at_index(i).await {
                let atspi_conn = app_ref.inner().connection();
                if let Ok(app) = AccessibleProxy::builder(atspi_conn)
                    .destination(app_ref.name.as_deref().unwrap_or(""))
                    .path(app_ref.path.as_str())
                    .build()
                    .await
                {
                    let name = app.name().await.unwrap_or_default();
                    if !name.to_lowercase().contains(&app_name.to_lowercase()) {
                        continue;
                    }

                    // Walk the path
                    // For now return a helpful message with the tree so the agent
                    // can find the correct path on first call.
                    let tree = build_tree(&app, 4).await;
                    let _ = path; // path navigation — TODO: implement deep walk
                    return Err(format!(
                        "Element path navigation not yet implemented. \
                         Here is the current tree for '{}' — use the name fields to build your path:\n{}",
                        app_name,
                        serde_json::to_string_pretty(&tree).unwrap_or_default()
                    ));
                }
            }
        }

        Err(format!("Application '{}' not found.", app_name))
    }

    /// Focus a window by app name using wmctrl via shell.
    pub async fn focus_window(app_name: &str) -> Result<String, String> {
        // Use wmctrl to raise and focus the window.
        // wmctrl is standard on most Linux desktops.
        let output = tokio::process::Command::new("wmctrl")
            .args(["-a", app_name])
            .output()
            .await
            .map_err(|e| {
                format!(
                    "Failed to run wmctrl: {}. Install with: sudo apt install wmctrl",
                    e
                )
            })?;

        if output.status.success() {
            Ok(format!("Focused window matching '{}'", app_name))
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!(
                "wmctrl could not focus '{}': {}",
                app_name, stderr
            ))
        }
    }
}

// ── macOS stub ────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod macos {
    pub async fn window_list() -> Result<String, String> {
        Err("AT-SPI accessibility tree is Linux-only. On macOS, accessibility control \
             is available via the macOS Accessibility API (AXUIElement). \
             PawzOS Phase 2 targets Linux — run PawzOS on Linux for full OS control."
            .into())
    }
    pub async fn get_tree(_app: &str, _depth: usize) -> Result<String, String> {
        window_list().await
    }
    pub async fn click_element(_app: &str, _path: &[String]) -> Result<String, String> {
        window_list().await
    }
    pub async fn focus_window(_app: &str) -> Result<String, String> {
        window_list().await
    }
}

// ── Windows stub ──────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
mod windows_stub {
    pub async fn window_list() -> Result<String, String> {
        Err("AT-SPI accessibility tree is Linux-only. PawzOS Phase 2 targets Linux.".into())
    }
    pub async fn get_tree(_app: &str, _depth: usize) -> Result<String, String> {
        window_list().await
    }
    pub async fn click_element(_app: &str, _path: &[String]) -> Result<String, String> {
        window_list().await
    }
    pub async fn focus_window(_app: &str) -> Result<String, String> {
        window_list().await
    }
}

// ── Platform dispatch ─────────────────────────────────────────────────────────

async fn window_list() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    return linux::window_list().await;
    #[cfg(target_os = "macos")]
    return macos::window_list().await;
    #[cfg(target_os = "windows")]
    return windows_stub::window_list().await;
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    Err("OS not supported".into())
}

async fn get_tree(app_name: &str, max_depth: usize) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    return linux::get_tree(app_name, max_depth).await;
    #[cfg(target_os = "macos")]
    return macos::get_tree(app_name, max_depth).await;
    #[cfg(target_os = "windows")]
    return windows_stub::get_tree(app_name, max_depth).await;
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    Err("OS not supported".into())
}

async fn click_element(app_name: &str, path: &[String]) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    return linux::click_element(app_name, path).await;
    #[cfg(target_os = "macos")]
    return macos::click_element(app_name, path).await;
    #[cfg(target_os = "windows")]
    return windows_stub::click_element(app_name, path).await;
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    Err("OS not supported".into())
}

async fn focus_window(app_name: &str) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    return linux::focus_window(app_name).await;
    #[cfg(target_os = "macos")]
    return macos::focus_window(app_name).await;
    #[cfg(target_os = "windows")]
    return windows_stub::focus_window(app_name).await;
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    Err("OS not supported".into())
}

// ── enigo — cross-platform keyboard/mouse injection ──────────────────────────

fn type_text(text: &str) -> Result<String, String> {
    use enigo::{Enigo, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("Failed to initialise input system: {}", e))?;
    enigo
        .text(text)
        .map_err(|e| format!("Failed to type text: {}", e))?;
    Ok(format!("Typed {} characters", text.chars().count()))
}

fn key_combo(combo: &str) -> Result<String, String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};

    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("Failed to initialise input system: {}", e))?;

    let combo_lower = combo.to_lowercase();
    let parts: Vec<&str> = combo_lower.split('+').collect();

    // Separate modifiers from the final key
    let mut modifiers: Vec<Key> = Vec::new();
    let mut main_key: Option<Key> = None;

    for part in &parts {
        let part = part.trim();
        match part {
            "ctrl" | "control" => modifiers.push(Key::Control),
            "alt" => modifiers.push(Key::Alt),
            "shift" => modifiers.push(Key::Shift),
            "meta" | "super" | "cmd" | "win" => modifiers.push(Key::Meta),
            other => {
                main_key = Some(parse_key(other));
            }
        }
    }

    let key = main_key.ok_or_else(|| format!("Could not parse key combo: '{}'", combo))?;

    // Press modifiers, press+release main key, release modifiers
    for &m in &modifiers {
        enigo
            .key(m, Direction::Press)
            .map_err(|e| format!("Key press error: {}", e))?;
    }
    enigo
        .key(key, Direction::Click)
        .map_err(|e| format!("Key click error: {}", e))?;
    for &m in modifiers.iter().rev() {
        enigo
            .key(m, Direction::Release)
            .map_err(|e| format!("Key release error: {}", e))?;
    }

    Ok(format!("Pressed key combo: {}", combo))
}

fn parse_key(s: &str) -> enigo::Key {
    use enigo::Key;
    match s {
        "enter" | "return" => Key::Return,
        "escape" | "esc" => Key::Escape,
        "tab" => Key::Tab,
        "space" => Key::Space,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" => Key::PageUp,
        "pagedown" => Key::PageDown,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        s if s.len() == 1 => {
            let c = s.chars().next().unwrap();
            Key::Unicode(c)
        }
        _ => Key::Unicode(s.chars().next().unwrap_or(' ')),
    }
}
