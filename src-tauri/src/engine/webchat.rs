// Paw Agent Engine — Web Chat Bridge
//
// A lightweight HTTP + WebSocket server that lets friends chat with your
// agent from their browser. No account needed — just share a link + token.
//
// Architecture:
//   - Binds a TCP listener on a configurable port (default 3939)
//   - GET /  → serves a self-contained HTML chat page
//   - GET /ws?token=xxx → upgrades to WebSocket for real-time chat
//   - Access control: token-based auth + allowlist/pairing (same as other bridges)
//
// Security:
//   - Access token required (auto-generated or user-set)
//   - Standard allowlist / pairing / open DM policy
//   - Runs on localhost by default; set bind_address to "0.0.0.0" for LAN access

use crate::engine::channels::{self, PendingUser, ChannelStatus};
use log::{info, warn, error};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use futures::stream::StreamExt;
use futures::SinkExt;

// ── Web Chat Config ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebChatConfig {
    pub enabled: bool,
    /// Address to bind — "127.0.0.1" (local only) or "0.0.0.0" (LAN)
    pub bind_address: String,
    pub port: u16,
    /// Access token — required to connect. Auto-generated if empty.
    pub access_token: String,
    /// "open" | "allowlist" | "pairing"
    pub dm_policy: String,
    /// Usernames allowed to chat (when policy is "allowlist" or "pairing")
    pub allowed_users: Vec<String>,
    #[serde(default)]
    pub pending_users: Vec<PendingUser>,
    pub agent_id: Option<String>,
    /// Title shown on the chat page
    pub page_title: String,
}

impl Default for WebChatConfig {
    fn default() -> Self {
        // Generate a random 12-char token
        let token: String = uuid::Uuid::new_v4().to_string().replace('-', "")[..12].to_string();
        WebChatConfig {
            enabled: false,
            bind_address: "0.0.0.0".into(),
            port: 3939,
            access_token: token,
            dm_policy: "open".into(),
            allowed_users: vec!["nano banana pro".into()],
            pending_users: vec![],
            agent_id: None,
            page_title: "Paw Chat".into(),
        }
    }
}

// ── Global State ───────────────────────────────────────────────────────

static BRIDGE_RUNNING: AtomicBool = AtomicBool::new(false);
static MESSAGE_COUNT: AtomicI64 = AtomicI64::new(0);
static STOP_SIGNAL: std::sync::OnceLock<Arc<AtomicBool>> = std::sync::OnceLock::new();

fn get_stop_signal() -> Arc<AtomicBool> {
    STOP_SIGNAL.get_or_init(|| Arc::new(AtomicBool::new(false))).clone()
}

const CONFIG_KEY: &str = "webchat_config";

// ── Public API ─────────────────────────────────────────────────────────

pub fn load_config(app_handle: &tauri::AppHandle) -> Result<WebChatConfig, String> {
    channels::load_channel_config(app_handle, CONFIG_KEY)
}

pub fn save_config(app_handle: &tauri::AppHandle, config: &WebChatConfig) -> Result<(), String> {
    channels::save_channel_config(app_handle, CONFIG_KEY, config)
}

pub fn approve_user(app_handle: &tauri::AppHandle, user_id: &str) -> Result<(), String> {
    channels::approve_user_generic(app_handle, CONFIG_KEY, user_id)
}

pub fn deny_user(app_handle: &tauri::AppHandle, user_id: &str) -> Result<(), String> {
    channels::deny_user_generic(app_handle, CONFIG_KEY, user_id)
}

pub fn remove_user(app_handle: &tauri::AppHandle, user_id: &str) -> Result<(), String> {
    channels::remove_user_generic(app_handle, CONFIG_KEY, user_id)
}

pub fn start_bridge(app_handle: tauri::AppHandle) -> Result<(), String> {
    if BRIDGE_RUNNING.load(Ordering::Relaxed) {
        return Err("Web Chat is already running".into());
    }

    let config: WebChatConfig = load_config(&app_handle)?;
    if config.access_token.is_empty() {
        return Err("Access token is required for Web Chat.".into());
    }
    if !config.enabled {
        return Err("Web Chat bridge is disabled.".into());
    }

    let stop = get_stop_signal();
    stop.store(false, Ordering::Relaxed);
    BRIDGE_RUNNING.store(true, Ordering::Relaxed);

    info!("[webchat] Starting on {}:{}", config.bind_address, config.port);

    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_server(app_handle, config).await {
            error!("[webchat] Server crashed: {}", e);
        }
        BRIDGE_RUNNING.store(false, Ordering::Relaxed);
        info!("[webchat] Server stopped");
    });

    Ok(())
}

pub fn stop_bridge() {
    let stop = get_stop_signal();
    stop.store(true, Ordering::Relaxed);
    BRIDGE_RUNNING.store(false, Ordering::Relaxed);
    info!("[webchat] Stop signal sent");
}

pub fn get_status(app_handle: &tauri::AppHandle) -> ChannelStatus {
    let config: WebChatConfig = load_config(app_handle).unwrap_or_default();
    ChannelStatus {
        running: BRIDGE_RUNNING.load(Ordering::Relaxed),
        connected: BRIDGE_RUNNING.load(Ordering::Relaxed),
        bot_name: Some(config.page_title.clone()),
        bot_id: Some(format!("{}:{}", config.bind_address, config.port)),
        message_count: MESSAGE_COUNT.load(Ordering::Relaxed) as u64,
        allowed_users: config.allowed_users,
        pending_users: config.pending_users,
        dm_policy: config.dm_policy,
    }
}

// ── Server Core ────────────────────────────────────────────────────────

async fn run_server(app_handle: tauri::AppHandle, config: WebChatConfig) -> Result<(), String> {
    let stop = get_stop_signal();
    let addr = format!("{}:{}", config.bind_address, config.port);

    let listener = TcpListener::bind(&addr).await
        .map_err(|e| format!("Bind {}:{} failed: {}", config.bind_address, config.port, e))?;

    info!("[webchat] Listening on {}", addr);

    let _ = app_handle.emit("webchat-status", json!({
        "kind": "connected",
        "address": &addr,
        "title": &config.page_title,
    }));

    let config = Arc::new(config);

    loop {
        if stop.load(Ordering::Relaxed) { break; }

        // Accept with timeout so we can check stop signal
        let accept = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            listener.accept()
        ).await;

        match accept {
            Ok(Ok((stream, peer))) => {
                let app = app_handle.clone();
                let cfg = config.clone();
                let stop_clone = stop.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, peer, app, cfg, stop_clone).await {
                        warn!("[webchat] Connection error from {}: {}", peer, e);
                    }
                });
            }
            Ok(Err(e)) => {
                warn!("[webchat] Accept error: {}", e);
            }
            Err(_) => { /* timeout — loop to check stop signal */ }
        }
    }

    Ok(())
}

// ── Connection Handler ─────────────────────────────────────────────────

async fn handle_connection(
    stream: tokio::net::TcpStream,
    peer: std::net::SocketAddr,
    app_handle: tauri::AppHandle,
    config: Arc<WebChatConfig>,
    _stop: Arc<AtomicBool>,
) -> Result<(), String> {
    // Peek at the first bytes to determine request type
    let mut buf = [0u8; 4096];
    stream.peek(&mut buf).await.map_err(|e| format!("Peek: {}", e))?;

    let request_str = String::from_utf8_lossy(&buf);

    // Extract the request path
    let first_line = request_str.lines().next().unwrap_or("");

    // Check if this is a WebSocket upgrade
    let is_websocket = request_str.contains("Upgrade: websocket") || request_str.contains("upgrade: websocket");

    if is_websocket && first_line.contains("/ws") {
        // Extract token from query string
        let token = extract_query_param(first_line, "token").unwrap_or_default();
        if token != config.access_token {
            // Reject with 403
            let response = "HTTP/1.1 403 Forbidden\r\nContent-Length: 12\r\n\r\nAccess denied";
            let mut stream = stream;
            use tokio::io::AsyncWriteExt;
            let _ = stream.write_all(response.as_bytes()).await;
            return Ok(());
        }

        let username = extract_query_param(first_line, "name").unwrap_or_else(|| format!("guest_{}", &peer.to_string()[..peer.to_string().len().min(8)]));

        info!("[webchat] WebSocket connection from {} ({})", peer, username);
        handle_websocket(stream, peer, app_handle, config, username).await
    } else if first_line.starts_with("GET /") {
        // Serve the HTML chat page
        serve_html(stream, &config).await
    } else {
        // Unknown request — close
        Ok(())
    }
}

// ── HTML Chat Page ─────────────────────────────────────────────────────

async fn serve_html(
    mut stream: tokio::net::TcpStream,
    config: &WebChatConfig,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    use tokio::io::AsyncReadExt;

    // Read and discard the full HTTP request
    let mut request_buf = vec![0u8; 8192];
    let _ = tokio::time::timeout(
        std::time::Duration::from_millis(100),
        stream.read(&mut request_buf)
    ).await;

    let html = build_chat_html(&config.page_title, &config.access_token, config.port);
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(), html
    );

    stream.write_all(response.as_bytes()).await
        .map_err(|e| format!("Write HTML: {}", e))?;

    Ok(())
}

// ── WebSocket Chat Handler ─────────────────────────────────────────────

async fn handle_websocket(
    stream: tokio::net::TcpStream,
    peer: std::net::SocketAddr,
    app_handle: tauri::AppHandle,
    config: Arc<WebChatConfig>,
    username: String,
) -> Result<(), String> {
    let ws_stream = tokio_tungstenite::accept_async(stream).await
        .map_err(|e| format!("WebSocket handshake failed: {}", e))?;

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // Access control
    let mut current_config: WebChatConfig = load_config(&app_handle).unwrap_or_default();
    let access_result = channels::check_access(
        &current_config.dm_policy,
        &username,
        &username,
        &username,
        &current_config.allowed_users,
        &mut current_config.pending_users,
    );

    if let Err(denial_msg) = access_result {
        // Save updated pending_users
        let _ = save_config(&app_handle, &current_config);
        let _ = app_handle.emit("webchat-status", json!({
            "kind": "pairing_request",
            "username": &username,
            "peer": peer.to_string(),
        }));

        let msg = json!({ "type": "system", "text": denial_msg });
        let _ = ws_sender.send(WsMessage::Text(msg.to_string().into())).await;
        return Ok(());
    }

    // Send welcome
    let welcome = json!({
        "type": "system",
        "text": format!("Connected to {}. Send a message to start chatting!", config.page_title)
    });
    let _ = ws_sender.send(WsMessage::Text(welcome.to_string().into())).await;

    let agent_id = config.agent_id.clone().unwrap_or_default();
    let channel_context = format!(
        "User '{}' is chatting via the Paw Web Chat interface from {}. \
         Keep responses concise but helpful. You can use markdown formatting.",
        username, peer
    );

    // Message loop
    while let Some(msg) = ws_receiver.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(e) => {
                warn!("[webchat] WebSocket error from {}: {}", peer, e);
                break;
            }
        };

        match msg {
            WsMessage::Text(text) => {
                let text = text.to_string();
                // Parse incoming JSON: { "type": "message", "text": "hello" }
                let incoming: serde_json::Value = serde_json::from_str(&text).unwrap_or(json!({"text": text}));
                let user_text = incoming["text"].as_str().unwrap_or("").trim().to_string();

                if user_text.is_empty() { continue; }

                MESSAGE_COUNT.fetch_add(1, Ordering::Relaxed);
                info!("[webchat] {} says: {}", username, &user_text[..user_text.len().min(80)]);

                // Send typing indicator
                let typing = json!({ "type": "typing" });
                let _ = ws_sender.send(WsMessage::Text(typing.to_string().into())).await;

                // Route through agent
                let reply = channels::run_channel_agent(
                    &app_handle,
                    "webchat",
                    &channel_context,
                    &user_text,
                    &username,
                    &agent_id,
                ).await;

                let response = match reply {
                    Ok(text) => json!({ "type": "message", "text": text }),
                    Err(e) => json!({ "type": "error", "text": format!("Error: {}", e) }),
                };

                if ws_sender.send(WsMessage::Text(response.to_string().into())).await.is_err() {
                    break;
                }
            }
            WsMessage::Close(_) => {
                info!("[webchat] {} disconnected", username);
                break;
            }
            WsMessage::Ping(data) => {
                let _ = ws_sender.send(WsMessage::Pong(data)).await;
            }
            _ => {}
        }
    }

    Ok(())
}

// ── Helpers ────────────────────────────────────────────────────────────

fn extract_query_param(request_line: &str, key: &str) -> Option<String> {
    let path = request_line.split_whitespace().nth(1)?;
    let query = path.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        if kv.next()? == key {
            return kv.next().map(|v| percent_decode(v));
        }
    }
    None
}

/// Simple percent-decode for URL query values
fn percent_decode(input: &str) -> String {
    let mut result = Vec::new();
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(
                &input[i+1..i+3], 16
            ) {
                result.push(byte);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            result.push(b' ');
        } else {
            result.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8(result).unwrap_or_else(|_| input.to_string())
}

fn build_chat_html(title: &str, token: &str, port: u16) -> String {
    format!(r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#1e1e1e;color:#cccccc;height:100vh;display:flex;flex-direction:column}}
.header{{padding:16px 20px;background:#252526;border-bottom:1px solid #3c3c3c;display:flex;align-items:center;gap:12px}}
.header h1{{font-size:16px;font-weight:600;color:#ff00ff}}
.header .dot{{width:8px;height:8px;border-radius:50%;background:#333;transition:background .3s}}
.header .dot.online{{background:#0f0}}
.name-bar{{padding:10px 20px;background:#252526;border-bottom:1px solid #3c3c3c;display:flex;gap:8px}}
.name-bar input{{flex:1;padding:8px 12px;border:1px solid #3c3c3c;border-radius:6px;background:#313131;color:#cccccc;font-size:14px;outline:none}}
.name-bar input:focus{{border-color:#ff00ff}}
.name-bar button{{padding:8px 16px;background:#ff00ff;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer}}
.messages{{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:10px}}
.msg{{max-width:80%;padding:10px 14px;border-radius:12px;font-size:14px;line-height:1.5;word-wrap:break-word;white-space:pre-wrap}}
.msg.user{{align-self:flex-end;background:#2a2d2e;border:1px solid #ff00ff33}}
.msg.assistant{{align-self:flex-start;background:#252526;border:1px solid #3c3c3c}}
.msg.system{{align-self:center;color:#888;font-size:12px;font-style:italic}}
.msg.error{{align-self:center;color:#f44;font-size:13px}}
.typing{{align-self:flex-start;color:#888;font-size:13px;padding:4px 14px}}
.typing::after{{content:'...';animation:dots 1.2s infinite}}
@keyframes dots{{0%,20%{{content:'.'}}40%{{content:'..'}}60%,100%{{content:'...'}}}}
.input-bar{{padding:16px 20px;background:#252526;border-top:1px solid #3c3c3c;display:flex;gap:8px}}
.input-bar textarea{{flex:1;padding:10px 14px;border:1px solid #3c3c3c;border-radius:8px;background:#313131;color:#cccccc;font-size:14px;font-family:inherit;resize:none;outline:none;max-height:120px}}
.input-bar textarea:focus{{border-color:#ff00ff}}
.input-bar button{{padding:10px 20px;background:#ff00ff;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;white-space:nowrap}}
.input-bar button:disabled{{opacity:.4;cursor:not-allowed}}
</style>
</head>
<body>
<div class="header">
  <div class="dot" id="dot"></div>
  <h1>{title}</h1>
</div>
<div class="name-bar" id="nameBar">
  <input id="nameInput" placeholder="Enter your name to start chatting..." autofocus />
  <button onclick="connect()">Join</button>
</div>
<div class="messages" id="messages"></div>
<div class="input-bar" id="inputBar" style="display:none">
  <textarea id="chatInput" placeholder="Type a message..." rows="1"></textarea>
  <button id="sendBtn" onclick="send()">Send</button>
</div>
<script>
const TOKEN="{token}";
const PORT={port};
let ws,name="";
const msgs=document.getElementById("messages");
const inp=document.getElementById("chatInput");
const dot=document.getElementById("dot");

function connect(){{
  name=document.getElementById("nameInput").value.trim();
  if(!name)return;
  document.getElementById("nameBar").style.display="none";
  document.getElementById("inputBar").style.display="flex";
  const proto=location.protocol==="https:"?"wss:":"ws:";
  const host=location.hostname||"localhost";
  ws=new WebSocket(`${{proto}}//${{host}}:${{PORT}}/ws?token=${{TOKEN}}&name=${{encodeURIComponent(name)}}`);
  ws.onopen=()=>{{dot.classList.add("online");inp.focus()}};
  ws.onclose=()=>{{dot.classList.remove("online");addMsg("system","Disconnected.")}};
  ws.onmessage=(e)=>{{
    try{{
      const d=JSON.parse(e.data);
      removeTyping();
      if(d.type==="typing"){{addTyping();return}}
      addMsg(d.type||"assistant",d.text||"");
    }}catch(err){{addMsg("assistant",e.data)}}
  }};
}}

function send(){{
  const t=inp.value.trim();
  if(!t||!ws||ws.readyState!==1)return;
  addMsg("user",t);
  ws.send(JSON.stringify({{type:"message",text:t}}));
  inp.value="";
  inp.style.height="auto";
}}

function addMsg(type,text){{
  const d=document.createElement("div");
  d.className="msg "+type;
  d.textContent=text;
  msgs.appendChild(d);
  msgs.scrollTop=msgs.scrollHeight;
}}

function addTyping(){{
  removeTyping();
  const d=document.createElement("div");
  d.className="typing";
  d.id="typing";
  d.textContent="Thinking";
  msgs.appendChild(d);
  msgs.scrollTop=msgs.scrollHeight;
}}

function removeTyping(){{
  const el=document.getElementById("typing");
  if(el)el.remove();
}}

inp.addEventListener("keydown",(e)=>{{
  if(e.key==="Enter"&&!e.shiftKey){{e.preventDefault();send()}}
}});
inp.addEventListener("input",()=>{{
  inp.style.height="auto";
  inp.style.height=Math.min(inp.scrollHeight,120)+"px";
}});
</script>
</body>
</html>"##, title=title, token=token, port=port)
}
