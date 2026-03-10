// Paw Agent Engine — Web Chat Session Management
//
// Stateless HMAC-signed session tokens for authenticated webchat users.
// No server-side session store needed — the token IS the session.
//
// Format: base64url( username | created_at | HMAC-SHA256(username|created_at, key) )
//
// Security properties:
//   - Signing key stored in OS keychain via unified key vault
//   - Constant-time signature comparison (subtle::ConstantTimeEq)
//   - Survives app restart (no in-memory state)
//   - 24-hour expiry baked into token — no pruning needed
//   - Forgery requires the 256-bit HMAC key

use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};
use subtle::ConstantTimeEq;

use crate::engine::key_vault;

type HmacSha256 = Hmac<Sha256>;

const SESSION_TTL_SECS: u64 = 86_400; // 24 hours
const PURPOSE_WEBCHAT_SESSION: &str = "webchat-session";

/// Get or create the HMAC signing key for webchat sessions.
fn get_signing_key() -> [u8; 32] {
    if let Some(key_b64) = key_vault::get(PURPOSE_WEBCHAT_SESSION) {
        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(&key_b64) {
            if bytes.len() == 32 {
                let mut key = [0u8; 32];
                key.copy_from_slice(&bytes);
                return key;
            }
        }
    }
    // Generate on first use
    let mut key = [0u8; 32];
    getrandom::getrandom(&mut key).expect("OS CSPRNG failed");
    let b64 = base64::engine::general_purpose::STANDARD.encode(key);
    key_vault::set(PURPOSE_WEBCHAT_SESSION, &b64);
    key
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Create a signed session token for `username`.
/// Stateless — no server-side storage needed.
pub(crate) fn create_session(username: String) -> String {
    let created_at = now_secs();
    let payload = format!("{}|{}", username, created_at);

    let key = get_signing_key();
    let mut mac = HmacSha256::new_from_slice(&key).expect("HMAC accepts any key size");
    mac.update(payload.as_bytes());
    let sig = mac.finalize().into_bytes();

    let sig_hex: String = sig.iter().map(|b| format!("{:02x}", b)).collect();
    let token_raw = format!("{}|{}", payload, sig_hex);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(token_raw.as_bytes())
}

/// Validate a session token and return the associated username.
/// Returns `None` if the signature is invalid or the token has expired.
/// Uses constant-time comparison to prevent timing side-channel attacks.
pub(crate) fn validate_session(token: &str) -> Option<String> {
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(token)
        .ok()?;
    let token_str = std::str::from_utf8(&decoded).ok()?;

    // Split: username|created_at|sig_hex (sig is always 64 hex chars)
    if token_str.len() < 66 {
        return None; // too short to contain |sig_hex
    }
    let (payload, sig_hex) = token_str.rsplit_once('|')?;

    // Recompute HMAC
    let key = get_signing_key();
    let mut mac = HmacSha256::new_from_slice(&key).expect("HMAC accepts any key size");
    mac.update(payload.as_bytes());
    let expected = mac.finalize().into_bytes();
    let expected_hex: String = expected.iter().map(|b| format!("{:02x}", b)).collect();

    // §Security: Constant-time comparison prevents timing side-channel
    if !bool::from(expected_hex.as_bytes().ct_eq(sig_hex.as_bytes())) {
        return None;
    }

    // Check expiry
    let (username, created_str) = payload.rsplit_once('|')?;
    let created_at: u64 = created_str.parse().ok()?;

    if now_secs().saturating_sub(created_at) > SESSION_TTL_SECS {
        return None;
    }

    Some(username.to_string())
}

/// Extract a cookie value by name from raw HTTP headers.
pub(crate) fn extract_cookie<'a>(headers: &'a str, name: &str) -> Option<&'a str> {
    for line in headers.lines() {
        if line.to_lowercase().starts_with("cookie:") {
            let value = &line["cookie:".len()..];
            for cookie in value.split(';') {
                let cookie = cookie.trim();
                if let Some(rest) = cookie.strip_prefix(name) {
                    if let Some(val) = rest.strip_prefix('=') {
                        return Some(val.trim());
                    }
                }
            }
        }
    }
    None
}
