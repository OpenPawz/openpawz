// ── Paw Atoms: Constants ───────────────────────────────────────────────────
// All named constants for the crate live here.
// Rationale: collecting constants in one place eliminates magic strings,
// makes auditing easier, and keeps every layer's code self-documenting.

// ── Database encryption key identifiers ───────────────────────────────────
// Used by `get_db_encryption_key()` / `has_db_encryption_key()` in lib.rs.
// The keychain entry is keyed on (service, user) — changing either value
// would cause existing keys to become unreachable. Treat as stable identifiers.
pub(crate) const DB_KEY_SERVICE: &str = "paw-db-encryption";
pub(crate) const DB_KEY_USER: &str    = "paw-db-key";

// ── Cron task execution cost-control limits ────────────────────────────────
// Used by `run_cron_heartbeat()` in engine/commands.rs.
//
// Background: cron sessions reuse the same session_id across runs, causing
// message history to grow unboundedly (up to 500 messages / 100k tokens).
// This is the #1 driver of runaway API costs in unattended execution.
// We prune old messages before each run and cap tool rounds.
pub(crate) const CRON_SESSION_KEEP_MESSAGES: i64 = 20; // keep ~2-3 runs of context
pub(crate) const CRON_MAX_TOOL_ROUNDS: u32        = 10; // prevent runaway tool loops
