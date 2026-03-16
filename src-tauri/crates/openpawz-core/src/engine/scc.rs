// ── Session Continuity Certificates (SCC) ──────────────────────────────────
//
// Cross-session identity attestation for AI agent continuity.
//
// Problem: the audit chain and memory snapshot HMACs prove within-session
// integrity, but nothing chains sessions together. An attacker with OS
// keychain access could swap the model weights or objectives between
// sessions and the system would continue operating with no evidence of
// the substitution.
//
// Solution: at every engine startup, issue a signed Session Continuity
// Certificate that commits to:
//   - model_id:         which LLM model is configured
//   - capability_hash:  SHA-256 of the sorted capability set
//   - memory_hash:      SHA-256 of the latest audit chain tip
//   - prior_cert_hash:  HMAC of the previous SCC (or genesis hash)
//
// The SCC is HMAC-signed with a dedicated key (`PURPOSE_SCC_SIGNING`)
// derived from the OS keychain, stored alongside the audit log in SQLite.
// Any gap or substitution in the chain is detectable by walking the
// certificates and verifying each one chains to its predecessor.
//
// Security properties:
//   - Dedicated HKDF domain separation (not reusing audit or memory keys)
//   - Constant-time signature comparison (subtle::ConstantTimeEq)
//   - Forward-chaining: each cert commits to the prior cert's HMAC
//   - Timestamped: ISO-8601 UTC, monotonically ordered
//   - Forgery requires the SCC signing key from the OS keychain

use crate::atoms::error::{EngineError, EngineResult};
use crate::engine::key_vault;
use crate::engine::sessions::SessionStore;
use base64::Engine as _;
use chrono::Utc;
use hmac::{Hmac, Mac};
use log::info;
use rusqlite::params;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

type HmacSha256 = Hmac<Sha256>;

/// Genesis hash for the very first SCC (no predecessor).
const SCC_GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// SQL to create the session continuity certificates table.
pub const SCC_SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS session_continuity_certs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        model_id TEXT NOT NULL,
        capability_hash TEXT NOT NULL,
        memory_hash TEXT NOT NULL,
        prior_cert_hash TEXT NOT NULL,
        signature TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scc_session
        ON session_continuity_certs(session_id);
    CREATE INDEX IF NOT EXISTS idx_scc_timestamp
        ON session_continuity_certs(timestamp);
";

/// A single Session Continuity Certificate.
#[derive(Debug, Clone)]
pub struct SessionContinuityCert {
    pub id: i64,
    pub session_id: String,
    pub timestamp: String,
    pub model_id: String,
    pub capability_hash: String,
    pub memory_hash: String,
    pub prior_cert_hash: String,
    pub signature: String,
}

// ═════════════════════════════════════════════════════════════════════════════
// Key Management
// ═════════════════════════════════════════════════════════════════════════════

/// Get or create the SCC HMAC signing key from the unified key vault.
fn get_scc_signing_key() -> EngineResult<Zeroizing<Vec<u8>>> {
    if let Some(key_b64) = key_vault::get(key_vault::PURPOSE_SCC_SIGNING) {
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(key_b64.as_str())
            .map_err(|e| EngineError::Other(format!("Failed to decode SCC signing key: {}", e)))?;
        return Ok(Zeroizing::new(decoded));
    }
    // Generate on first use
    let mut key = Zeroizing::new(vec![0u8; 32]);
    getrandom::getrandom(&mut key)
        .map_err(|e| EngineError::Other(format!("OS CSPRNG failed: {}", e)))?;
    let key_b64 = Zeroizing::new(base64::engine::general_purpose::STANDARD.encode(key.as_slice()));
    key_vault::set(key_vault::PURPOSE_SCC_SIGNING, &key_b64);
    info!("[scc] Created new SCC signing key in unified vault");
    Ok(key)
}

// ═════════════════════════════════════════════════════════════════════════════
// Signing
// ═════════════════════════════════════════════════════════════════════════════

/// Compute HMAC-SHA256 over the certificate fields.
/// Message: session_id|timestamp|model_id|capability_hash|memory_hash|prior_cert_hash
fn compute_scc_signature(
    key: &[u8],
    session_id: &str,
    timestamp: &str,
    model_id: &str,
    capability_hash: &str,
    memory_hash: &str,
    prior_cert_hash: &str,
) -> String {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC can take key of any size");
    let msg = format!(
        "{}|{}|{}|{}|{}|{}",
        session_id, timestamp, model_id, capability_hash, memory_hash, prior_cert_hash
    );
    mac.update(msg.as_bytes());
    mac.finalize()
        .into_bytes()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

// ═════════════════════════════════════════════════════════════════════════════
// Core API
// ═════════════════════════════════════════════════════════════════════════════

/// Compute the capability hash from the current Tauri capability set.
///
/// In practice this is a SHA-256 over the sorted, deduplicated list of
/// permission strings the engine was compiled/configured with.
/// Callers pass in the capability strings they have access to.
pub fn compute_capability_hash(capabilities: &[String]) -> String {
    let mut sorted = capabilities.to_vec();
    sorted.sort();
    sorted.dedup();
    let joined = sorted.join("|");
    let hash = Sha256::digest(joined.as_bytes());
    format!("{:x}", hash)
}

/// Compute the memory hash from the latest audit chain tip.
///
/// This anchors the SCC to the current state of the audit log.
/// If the audit log is empty, returns the genesis hash.
pub fn compute_memory_hash(store: &SessionStore) -> String {
    let conn = store.conn.lock();
    conn.query_row(
        "SELECT signature FROM unified_audit_log ORDER BY id DESC LIMIT 1",
        [],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_else(|_| SCC_GENESIS_HASH.to_string())
}

/// Issue a new Session Continuity Certificate at engine startup.
///
/// This is the main entry point — call once per process lifetime,
/// immediately after the engine state is initialized and the key vault
/// is prefetched.
pub fn issue_certificate(
    store: &SessionStore,
    model_id: &str,
    capabilities: &[String],
) -> EngineResult<i64> {
    let key = get_scc_signing_key()?;
    let conn = store.conn.lock();
    let timestamp = Utc::now().to_rfc3339();
    let session_id = format!("boot-{}", uuid::Uuid::new_v4());

    let capability_hash = compute_capability_hash(capabilities);
    let memory_hash = {
        conn.query_row(
            "SELECT signature FROM unified_audit_log ORDER BY id DESC LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| SCC_GENESIS_HASH.to_string())
    };

    // Chain to prior certificate
    let prior_cert_hash: String = conn
        .query_row(
            "SELECT signature FROM session_continuity_certs ORDER BY id DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| SCC_GENESIS_HASH.to_string());

    let signature = compute_scc_signature(
        &key,
        &session_id,
        &timestamp,
        model_id,
        &capability_hash,
        &memory_hash,
        &prior_cert_hash,
    );

    conn.execute(
        "INSERT INTO session_continuity_certs
         (session_id, timestamp, model_id, capability_hash, memory_hash, prior_cert_hash, signature)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            session_id,
            timestamp,
            model_id,
            capability_hash,
            memory_hash,
            prior_cert_hash,
            signature,
        ],
    )?;

    let cert_id = conn.last_insert_rowid();
    info!(
        "[scc] Issued certificate #{} for session {} (model={}, cap_hash={}…, mem_hash={}…)",
        cert_id,
        session_id,
        model_id,
        &capability_hash[..8.min(capability_hash.len())],
        &memory_hash[..8.min(memory_hash.len())],
    );

    Ok(cert_id)
}

// ═════════════════════════════════════════════════════════════════════════════
// Verification
// ═════════════════════════════════════════════════════════════════════════════

/// Verify the entire SCC chain from genesis to the latest certificate.
///
/// Returns `Ok(count)` with the number of valid certificates, or an error
/// describing where the chain broke.
pub fn verify_chain(store: &SessionStore) -> EngineResult<usize> {
    let key = get_scc_signing_key()?;
    let conn = store.conn.lock();

    let mut stmt = conn.prepare(
        "SELECT id, session_id, timestamp, model_id, capability_hash, memory_hash, prior_cert_hash, signature
         FROM session_continuity_certs ORDER BY id ASC",
    )?;

    let certs: Vec<SessionContinuityCert> = stmt
        .query_map([], |row| {
            Ok(SessionContinuityCert {
                id: row.get(0)?,
                session_id: row.get(1)?,
                timestamp: row.get(2)?,
                model_id: row.get(3)?,
                capability_hash: row.get(4)?,
                memory_hash: row.get(5)?,
                prior_cert_hash: row.get(6)?,
                signature: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    if certs.is_empty() {
        return Ok(0);
    }

    let mut expected_prior = SCC_GENESIS_HASH.to_string();

    for cert in &certs {
        // Verify forward chain: this cert's prior_cert_hash must match the
        // previous cert's signature (or genesis for the first one).
        if !bool::from(
            cert.prior_cert_hash
                .as_bytes()
                .ct_eq(expected_prior.as_bytes()),
        ) {
            return Err(EngineError::Other(format!(
                "SCC chain broken at cert #{}: prior_cert_hash mismatch (expected {}…, got {}…)",
                cert.id,
                &expected_prior[..8.min(expected_prior.len())],
                &cert.prior_cert_hash[..8.min(cert.prior_cert_hash.len())],
            )));
        }

        // Recompute and verify the signature
        let expected_sig = compute_scc_signature(
            &key,
            &cert.session_id,
            &cert.timestamp,
            &cert.model_id,
            &cert.capability_hash,
            &cert.memory_hash,
            &cert.prior_cert_hash,
        );

        if !bool::from(cert.signature.as_bytes().ct_eq(expected_sig.as_bytes())) {
            return Err(EngineError::Other(format!(
                "SCC chain broken at cert #{}: signature mismatch (forged or corrupted)",
                cert.id,
            )));
        }

        expected_prior = cert.signature.clone();
    }

    info!(
        "[scc] Chain verification passed — {} certificates valid",
        certs.len()
    );
    Ok(certs.len())
}

/// Get the latest certificate (if any).
pub fn latest_certificate(store: &SessionStore) -> EngineResult<Option<SessionContinuityCert>> {
    let conn = store.conn.lock();
    let result = conn.query_row(
        "SELECT id, session_id, timestamp, model_id, capability_hash, memory_hash, prior_cert_hash, signature
         FROM session_continuity_certs ORDER BY id DESC LIMIT 1",
        [],
        |row| {
            Ok(SessionContinuityCert {
                id: row.get(0)?,
                session_id: row.get(1)?,
                timestamp: row.get(2)?,
                model_id: row.get(3)?,
                capability_hash: row.get(4)?,
                memory_hash: row.get(5)?,
                prior_cert_hash: row.get(6)?,
                signature: row.get(7)?,
            })
        },
    );
    match result {
        Ok(cert) => Ok(Some(cert)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// List all certificates, newest first.
pub fn list_certificates(
    store: &SessionStore,
    limit: usize,
) -> EngineResult<Vec<SessionContinuityCert>> {
    let conn = store.conn.lock();
    let mut stmt = conn.prepare(
        "SELECT id, session_id, timestamp, model_id, capability_hash, memory_hash, prior_cert_hash, signature
         FROM session_continuity_certs ORDER BY id DESC LIMIT ?1",
    )?;
    let certs = stmt
        .query_map(params![limit as i64], |row| {
            Ok(SessionContinuityCert {
                id: row.get(0)?,
                session_id: row.get(1)?,
                timestamp: row.get(2)?,
                model_id: row.get(3)?,
                capability_hash: row.get(4)?,
                memory_hash: row.get(5)?,
                prior_cert_hash: row.get(6)?,
                signature: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(certs)
}
