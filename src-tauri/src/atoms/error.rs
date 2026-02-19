// ── Paw Atoms: Error Types ─────────────────────────────────────────────────
// Single canonical error enum for the engine, built with `thiserror`.
//
// Design rules:
//   • Variants are coarse-grained by domain (I/O, DB, Provider, Config…).
//   • The `#[from]` attribute wires std/external error conversions automatically.
//   • `EngineError` → `String` conversion is provided via `Display` so that
//     Tauri command boundaries (`Result<T, String>`) can call `.map_err(|e|
//     e.to_string())` without boilerplate.
//   • No variant carries secret material (API keys, passwords) in its message.
//
// Migration note: functions currently returning `Result<T, String>` will
// migrate to `EngineResult<T>` incrementally as each module is refactored.
// Phase 2 will add `ProviderError` and wire it into `EngineError::Provider`.

use thiserror::Error;

// ── Primary error enum ─────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum EngineError {
    /// Filesystem or OS-level I/O failure.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// JSON serialization / deserialization failure.
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    /// SQLite / rusqlite database failure.
    #[error("Database error: {0}")]
    Database(String),

    /// AI provider HTTP or API-level failure (non-secret detail only).
    #[error("Provider error: {0}")]
    Provider(String),

    /// Engine or agent configuration is invalid or missing.
    #[error("Configuration error: {0}")]
    Config(String),

    /// Security policy violation (risk classification, approval denial, etc.).
    #[error("Security error: {0}")]
    Security(String),

    /// OS keychain / credential store failure.
    #[error("Keyring error: {0}")]
    Keyring(String),

    /// External process (CLI tool, sandbox, etc.) returned a non-zero exit.
    #[error("Process error: {0}")]
    Process(String),

    /// Catch-all for errors that do not yet have a dedicated variant.
    /// Prefer adding a specific variant over using this in new code.
    #[error("{0}")]
    Other(String),
}

// ── Convenience alias ──────────────────────────────────────────────────────

/// All engine operations should return this type.
/// At Tauri command boundaries, convert with `.map_err(|e| e.to_string())`.
pub type EngineResult<T> = Result<T, EngineError>;

// ── Conversion: EngineError → String ──────────────────────────────────────
// Lets Tauri command functions call `.map_err(EngineError::into)` directly.

impl From<EngineError> for String {
    fn from(e: EngineError) -> Self {
        e.to_string()
    }
}
