// PawzOS Unix Socket Bridge
//
// Allows pawzos-session to talk to the OpenPawz engine directly —
// no HTTP, no Tauri IPC, raw binary frames over a Unix domain socket.
//
// Socket path: /tmp/pawzos-engine.sock
//
// Wire protocol (both directions):
//   [payload_len: u32 LE][msg_type: u8][payload: bytes]
//
// Shell → Engine (type 0x01):
//   QUERY: [session_id_len: u32][session_id: utf8][msg_len: u32][msg: utf8]
//
// Engine → Shell:
//   DELTA    (0x10): [run_id: u32-prefixed utf8][chunk: u32-prefixed utf8]
//   COMPLETE (0x11): [run_id: u32-prefixed utf8]
//   ERROR    (0x12): [run_id: u32-prefixed utf8][msg: u32-prefixed utf8]
//   THINKING (0x13): [run_id: u32-prefixed utf8][chunk: u32-prefixed utf8]

use std::path::Path;
use log::{error, info, warn};
use tauri::Manager;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};

pub const SOCKET_PATH: &str = "/tmp/pawzos-engine.sock";

// ── Message type constants ────────────────────────────────────────────────────
pub const MSG_QUERY:    u8 = 0x01;
pub const MSG_DELTA:    u8 = 0x10;
pub const MSG_COMPLETE: u8 = 0x11;
pub const MSG_ERROR:    u8 = 0x12;
pub const MSG_THINKING: u8 = 0x13;

// ── Frame helpers ─────────────────────────────────────────────────────────────

pub fn encode_frame(msg_type: u8, payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(5 + payload.len());
    let len = payload.len() as u32;
    frame.extend_from_slice(&len.to_le_bytes());
    frame.push(msg_type);
    frame.extend_from_slice(payload);
    frame
}

pub fn encode_str_pair(a: &str, b: &str) -> Vec<u8> {
    let mut buf = Vec::new();
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    buf.extend_from_slice(&(ab.len() as u32).to_le_bytes());
    buf.extend_from_slice(ab);
    buf.extend_from_slice(&(bb.len() as u32).to_le_bytes());
    buf.extend_from_slice(bb);
    buf
}

pub fn encode_str_one(a: &str) -> Vec<u8> {
    let mut buf = Vec::new();
    let ab = a.as_bytes();
    buf.extend_from_slice(&(ab.len() as u32).to_le_bytes());
    buf.extend_from_slice(ab);
    buf
}

async fn read_frame(stream: &mut UnixStream) -> Option<(u8, Vec<u8>)> {
    let mut header = [0u8; 5];
    stream.read_exact(&mut header).await.ok()?;
    let len = u32::from_le_bytes([header[0], header[1], header[2], header[3]]) as usize;
    let msg_type = header[4];
    let mut payload = vec![0u8; len];
    stream.read_exact(&mut payload).await.ok()?;
    Some((msg_type, payload))
}

fn decode_str(payload: &[u8], offset: usize) -> Option<(String, usize)> {
    if offset + 4 > payload.len() { return None; }
    let len = u32::from_le_bytes([
        payload[offset], payload[offset+1], payload[offset+2], payload[offset+3]
    ]) as usize;
    let end = offset + 4 + len;
    if end > payload.len() { return None; }
    let s = String::from_utf8_lossy(&payload[offset+4..end]).to_string();
    Some((s, end))
}

// ── Server entry point ────────────────────────────────────────────────────────

pub async fn start(app_handle: tauri::AppHandle) {
    // Remove stale socket from previous run
    if Path::new(SOCKET_PATH).exists() {
        let _ = std::fs::remove_file(SOCKET_PATH);
    }

    let listener = match UnixListener::bind(SOCKET_PATH) {
        Ok(l) => { info!("[pawzos-socket] listening on {SOCKET_PATH}"); l }
        Err(e) => { error!("[pawzos-socket] bind failed: {e}"); return; }
    };

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let app = app_handle.clone();
                tokio::spawn(async move {
                    handle_connection(stream, app).await;
                });
            }
            Err(e) => {
                warn!("[pawzos-socket] accept error: {e}");
            }
        }
    }
}

// ── Per-connection handler ────────────────────────────────────────────────────

async fn handle_connection(mut stream: UnixStream, app_handle: tauri::AppHandle) {
    info!("[pawzos-socket] new connection");

    // Subscribe to SSE events BEFORE handling any queries so we don't miss
    // events emitted while we're still reading the query frame.
    let sse_rx = {
        let es = app_handle.state::<crate::engine::state::EngineState>();
        es.sse_events.subscribe()
    };

    loop {
        let frame = match read_frame(&mut stream).await {
            Some(f) => f,
            None    => { info!("[pawzos-socket] connection closed"); return; }
        };

        match frame.0 {
            MSG_QUERY => {
                let (session_id, after_sid) = match decode_str(&frame.1, 0) {
                    Some(v) => v,
                    None    => { error!("[pawzos-socket] malformed QUERY"); return; }
                };
                let (message, _) = match decode_str(&frame.1, after_sid) {
                    Some(v) => v,
                    None    => { error!("[pawzos-socket] malformed QUERY message"); return; }
                };

                info!("[pawzos-socket] QUERY session={session_id} msg={message:?}");

                // Dispatch to the engine, get back the run_id
                let run_id = match dispatch_query(&app_handle, session_id, message).await {
                    Some(id) => id,
                    None => {
                        let frame = encode_frame(MSG_ERROR, &encode_str_pair("", "dispatch failed"));
                        let _ = stream.write_all(&frame).await;
                        return;
                    }
                };

                // Stream SSE events back as binary frames until Complete/Error
                stream_events_for_run(&mut stream, sse_rx, &run_id).await;
                return; // one query per connection for now
            }
            other => {
                warn!("[pawzos-socket] unexpected msg type 0x{other:02x}");
            }
        }
    }
}

async fn dispatch_query(
    app_handle: &tauri::AppHandle,
    session_id: String,
    message:    String,
) -> Option<String> {
    match crate::engine::pawzos::dispatch(app_handle, message, Some(session_id)).await {
        Ok(run_id) => Some(run_id),
        Err(e) => {
            error!("[pawzos-socket] dispatch error: {e}");
            None
        }
    }
}

async fn stream_events_for_run(
    stream: &mut UnixStream,
    mut rx: tokio::sync::broadcast::Receiver<String>,
    run_id: &str,
) {
    use tokio::time::{timeout, Duration};

    loop {
        let json = match timeout(Duration::from_secs(120), rx.recv()).await {
            Ok(Ok(j))  => j,
            Ok(Err(_)) => { break; }
            Err(_)     => {
                // Timeout — send error and bail
                let _ = stream.write_all(&encode_frame(
                    MSG_ERROR,
                    &encode_str_pair(run_id, "engine timeout"),
                )).await;
                break;
            }
        };

        // Parse the JSON event to extract type and content
        let v: serde_json::Value = match serde_json::from_str(&json) {
            Ok(v)  => v,
            Err(_) => continue,
        };

        let event_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let event_run  = v.get("run_id").and_then(|r| r.as_str()).unwrap_or("");

        // Only forward events for this run
        if !event_run.is_empty() && event_run != run_id { continue; }

        let frame = match event_type {
            "Delta" => {
                let text = v.get("text").and_then(|t| t.as_str()).unwrap_or("");
                encode_frame(MSG_DELTA, &encode_str_pair(run_id, text))
            }
            "ThinkingDelta" => {
                let text = v.get("text").and_then(|t| t.as_str()).unwrap_or("");
                encode_frame(MSG_THINKING, &encode_str_pair(run_id, text))
            }
            "Complete" => {
                let f = encode_frame(MSG_COMPLETE, &encode_str_one(run_id));
                let _ = stream.write_all(&f).await;
                break;
            }
            "Error" => {
                let msg = v.get("message").and_then(|m| m.as_str()).unwrap_or("unknown error");
                let f = encode_frame(MSG_ERROR, &encode_str_pair(run_id, msg));
                let _ = stream.write_all(&f).await;
                break;
            }
            _ => continue,
        };

        if stream.write_all(&frame).await.is_err() { break; }
    }
}
