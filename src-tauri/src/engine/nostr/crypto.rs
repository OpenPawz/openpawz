// Paw Agent Engine — Nostr Cryptography
//
// Event signing (secp256k1 Schnorr / BIP-340), NIP-04 encrypted DMs
// (ECDH + AES-256-CBC), pubkey derivation, and hex utilities.

use serde_json::json;

// ── Nostr Event Signing (secp256k1 Schnorr / BIP-340) ─────────────────
//
// NIP-01 event structure:
//   id: sha256([0, pubkey, created_at, kind, tags, content])
//   sig: schnorr signature of id using secret key (via k256 crate)

/// Create and sign a Nostr event with arbitrary kind and tags.
pub(crate) fn sign_event(
    secret_key: &[u8],
    pubkey_hex: &str,
    kind: u64,
    tags: &serde_json::Value,
    content: &str,
) -> Result<serde_json::Value, String> {
    use sha2::{Sha256, Digest};
    use k256::schnorr::SigningKey;

    let created_at = chrono::Utc::now().timestamp();

    // Serialize for id computation: [0, pubkey, created_at, kind, tags, content]
    let serialized = json!([0, pubkey_hex, created_at, kind, tags, content]);
    let serialized_str = serde_json::to_string(&serialized)
        .map_err(|e| format!("serialize: {}", e))?;

    let mut hasher = Sha256::new();
    hasher.update(serialized_str.as_bytes());
    let id_bytes = hasher.finalize();
    let id_hex = hex_encode(&id_bytes);

    // BIP-340 Schnorr signature over the event id
    let signing_key = SigningKey::from_bytes(secret_key)
        .map_err(|e| format!("Invalid signing key: {}", e))?;
    let aux_rand: [u8; 32] = rand::random();
    let sig = signing_key.sign_raw(&id_bytes, &aux_rand)
        .map_err(|e| format!("Schnorr sign failed: {}", e))?;
    let sig_hex = hex_encode(&sig.to_bytes());

    Ok(json!({
        "id": id_hex,
        "pubkey": pubkey_hex,
        "created_at": created_at,
        "kind": kind,
        "tags": tags,
        "content": content,
        "sig": sig_hex,
    }))
}

/// Build a kind-1 public reply event (NIP-01).
pub(crate) fn build_reply_event(
    secret_key: &[u8],
    pubkey_hex: &str,
    content: &str,
    reply_to_id: &str,
    reply_to_pk: &str,
) -> Result<serde_json::Value, String> {
    let tags = json!([
        ["e", reply_to_id, "", "reply"],
        ["p", reply_to_pk]
    ]);
    sign_event(secret_key, pubkey_hex, 1, &tags, content)
}

// ── NIP-04 Encrypted DMs (ECDH + AES-256-CBC) ─────────────────────────
//
// NIP-04 protocol for kind-4 events:
//   1. ECDH shared secret = x-coordinate of (our_privkey × their_pubkey)
//   2. AES-256-CBC encrypt with random 16-byte IV and PKCS#7 padding
//   3. Content format: base64(ciphertext) + "?iv=" + base64(iv)
//
// Note: NIP-04 is deprecated in favor of NIP-44 (ChaCha20 + HMAC-SHA256)
// with NIP-17 gift wrapping. Kind-4 DMs remain widely supported by
// clients (Damus, Amethyst, Primal, etc.).

/// Compute ECDH shared secret (x-coordinate) between our secret key and a pubkey.
fn compute_shared_secret(secret_key: &[u8], pubkey_hex: &str) -> Result<[u8; 32], String> {
    let sk = k256::SecretKey::from_slice(secret_key)
        .map_err(|e| format!("Invalid secret key: {}", e))?;

    // BIP-340 x-only pubkey → SEC1 compressed (prepend 0x02)
    let pk_bytes = hex_decode(pubkey_hex)?;
    if pk_bytes.len() != 32 {
        return Err(format!("Invalid pubkey length: {} (expected 32)", pk_bytes.len()));
    }
    let mut sec1 = Vec::with_capacity(33);
    sec1.push(0x02);
    sec1.extend_from_slice(&pk_bytes);
    let pk = k256::PublicKey::from_sec1_bytes(&sec1)
        .map_err(|e| format!("Invalid pubkey: {}", e))?;

    use k256::elliptic_curve::ecdh::diffie_hellman;
    let shared = diffie_hellman(sk.to_nonzero_scalar(), pk.as_affine());
    let mut out = [0u8; 32];
    out.copy_from_slice(shared.raw_secret_bytes().as_slice());
    Ok(out)
}

/// NIP-04 encrypt: AES-256-CBC with ECDH shared key.
pub(crate) fn nip04_encrypt(secret_key: &[u8], receiver_pk_hex: &str, plaintext: &str) -> Result<String, String> {
    use base64::Engine;
    use cbc::cipher::{BlockEncryptMut, KeyIvInit, block_padding::Pkcs7};

    let shared = compute_shared_secret(secret_key, receiver_pk_hex)?;
    let iv: [u8; 16] = rand::random();

    let pt = plaintext.as_bytes();
    // Buffer: plaintext + up to 16 bytes PKCS#7 padding
    let mut buf = vec![0u8; pt.len() + 16];
    buf[..pt.len()].copy_from_slice(pt);

    let ciphertext = cbc::Encryptor::<aes::Aes256>::new_from_slices(&shared, &iv)
        .map_err(|e| format!("AES init: {}", e))?
        .encrypt_padded_mut::<Pkcs7>(&mut buf, pt.len())
        .map_err(|e| format!("AES encrypt: {}", e))?;

    let b64 = base64::engine::general_purpose::STANDARD;
    Ok(format!("{}?iv={}", b64.encode(ciphertext), b64.encode(iv)))
}

/// NIP-04 decrypt: AES-256-CBC with ECDH shared key.
pub(crate) fn nip04_decrypt(secret_key: &[u8], sender_pk_hex: &str, content: &str) -> Result<String, String> {
    use base64::Engine;
    use cbc::cipher::{BlockDecryptMut, KeyIvInit, block_padding::Pkcs7};

    let parts: Vec<&str> = content.split("?iv=").collect();
    if parts.len() != 2 {
        return Err("Invalid NIP-04 format (expected base64?iv=base64)".into());
    }

    let b64 = base64::engine::general_purpose::STANDARD;
    let ciphertext = b64.decode(parts[0].trim())
        .map_err(|e| format!("base64 ciphertext: {}", e))?;
    let iv = b64.decode(parts[1].trim())
        .map_err(|e| format!("base64 iv: {}", e))?;
    if iv.len() != 16 {
        return Err(format!("Invalid IV length: {} (expected 16)", iv.len()));
    }

    let shared = compute_shared_secret(secret_key, sender_pk_hex)?;

    let mut buf = ciphertext;
    let plaintext = cbc::Decryptor::<aes::Aes256>::new_from_slices(&shared, &iv)
        .map_err(|e| format!("AES init: {}", e))?
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|e| format!("AES decrypt: {}", e))?;

    String::from_utf8(plaintext.to_vec()).map_err(|e| format!("UTF-8: {}", e))
}

// ── secp256k1 Pubkey Derivation (BIP-340 x-only) ──────────────────────
//
// Nostr uses the x-coordinate of the secp256k1 public key (BIP-340).
// We use the `k256` crate (already a dependency for DEX/Ethereum wallet)
// to perform proper elliptic curve point multiplication.

pub(crate) fn derive_pubkey(secret_key: &[u8]) -> Result<Vec<u8>, String> {
    use k256::elliptic_curve::sec1::ToEncodedPoint;

    let sk = k256::SecretKey::from_slice(secret_key)
        .map_err(|e| format!("Invalid secret key: {}", e))?;
    let pk = sk.public_key();
    let point = pk.to_encoded_point(true); // compressed
    // BIP-340 x-only: skip the 0x02/0x03 prefix byte, take the 32-byte x-coordinate
    let compressed = point.as_bytes();
    if compressed.len() != 33 {
        return Err("Unexpected compressed pubkey length".into());
    }
    Ok(compressed[1..].to_vec())
}

// ── Hex Utils ──────────────────────────────────────────────────────────

pub(crate) fn hex_decode(hex: &str) -> Result<Vec<u8>, String> {
    if hex.len() % 2 != 0 {
        return Err("Odd hex length".into());
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).map_err(|e| format!("hex: {}", e)))
        .collect()
}

pub(crate) fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}
