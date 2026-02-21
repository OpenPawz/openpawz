// Pawz Agent Engine — Skill Vault Encryption
// XOR cipher with a random key stored in the OS keychain.
// Not military-grade but prevents direct SQLite readability.

use log::info;

const VAULT_KEYRING_SERVICE: &str = "paw-skill-vault";
const VAULT_KEYRING_USER: &str = "encryption-key";

/// Get or create the vault encryption key from the OS keychain.
pub fn get_vault_key() -> Result<Vec<u8>, String> {
    let entry = keyring::Entry::new(VAULT_KEYRING_SERVICE, VAULT_KEYRING_USER)
        .map_err(|e| format!("Keyring init failed: {}", e))?;

    match entry.get_password() {
        Ok(key_b64) => {
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &key_b64)
                .map_err(|e| format!("Failed to decode vault key: {}", e))
        }
        Err(keyring::Error::NoEntry) => {
            // Generate a new random key
            use rand::Rng;
            let mut key = vec![0u8; 32];
            rand::thread_rng().fill(&mut key[..]);
            let key_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &key);
            entry.set_password(&key_b64)
                .map_err(|e| format!("Failed to store vault key in keychain: {}", e))?;
            info!("[vault] Created new vault encryption key in OS keychain");
            Ok(key)
        }
        Err(e) => Err(format!("Keyring error: {}", e)),
    }
}

/// Encrypt a plaintext credential value.
pub fn encrypt_credential(plaintext: &str, key: &[u8]) -> String {
    let bytes = plaintext.as_bytes();
    let encrypted: Vec<u8> = bytes.iter().enumerate().map(|(i, b)| b ^ key[i % key.len()]).collect();
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &encrypted)
}

/// Decrypt an encrypted credential value.
pub fn decrypt_credential(encrypted_b64: &str, key: &[u8]) -> Result<String, String> {
    let encrypted = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encrypted_b64)
        .map_err(|e| format!("Failed to decode: {}", e))?;
    let decrypted: Vec<u8> = encrypted.iter().enumerate().map(|(i, b)| b ^ key[i % key.len()]).collect();
    String::from_utf8(decrypted).map_err(|e| format!("Failed to decrypt: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_key() -> Vec<u8> {
        vec![0xAB; 32]
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = test_key();
        let plaintext = "sk-live-abc123_secret_token";
        let encrypted = encrypt_credential(plaintext, &key);
        let decrypted = decrypt_credential(&encrypted, &key).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn encrypt_decrypt_empty_string() {
        let key = test_key();
        let encrypted = encrypt_credential("", &key);
        let decrypted = decrypt_credential(&encrypted, &key).unwrap();
        assert_eq!(decrypted, "");
    }

    #[test]
    fn wrong_key_produces_wrong_output() {
        let key1 = vec![0xAB; 32];
        let key2 = vec![0xCD; 32];
        let plaintext = "my-secret-api-key";
        let encrypted = encrypt_credential(plaintext, &key1);
        let decrypted = decrypt_credential(&encrypted, &key2).unwrap();
        assert_ne!(decrypted, plaintext);
    }

    #[test]
    fn encrypt_long_text_beyond_key_length() {
        let key = vec![0x42; 32];
        let plaintext = "x".repeat(100); // longer than 32-byte key
        let encrypted = encrypt_credential(&plaintext, &key);
        let decrypted = decrypt_credential(&encrypted, &key).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn invalid_base64_returns_error() {
        let key = test_key();
        let result = decrypt_credential("not!valid!base64!!!", &key);
        assert!(result.is_err());
    }
}
