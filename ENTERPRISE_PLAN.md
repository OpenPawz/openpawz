# Enterprise Grade Plan

> Systematic plan to close the 8 gaps identified in the enterprise audit.  
> Work through phases in order — each phase builds on the previous.

---

## Overview

| # | Gap | Priority | Effort | Phase |
|---|-----|----------|--------|-------|
| 1 | No test suite | Critical | High | 1 |
| 2 | No CI/CD pipeline | Critical | Medium | 2 |
| 3 | XOR cipher for skill credentials | High | Low | 3 |
| 4 | Silent encryption fallback | High | Low | 3 |
| 5 | `Result<T, String>` error handling | Medium | High | 4 |
| 6 | No rate limiting / retry logic | Medium | Medium | 5 |
| 7 | No persistent logging | Medium | Low | 6 |
| 8 | No database migration framework | Low | Medium | 7 |

---

## Phase 1 — Test Suite

The biggest gap. No automated tests exist. Build from the ground up.

### 1A — Rust Unit Tests (engine/)

Add `#[cfg(test)]` modules to each engine file. Target the highest-risk areas first:

| Module | What to test | Tests |
|--------|-------------|-------|
| `skills/crypto.rs` | encrypt → decrypt roundtrip, wrong key rejection, empty input | 3-4 |
| `security.rs` (TS) | risk classification for all 30+ danger patterns | 10-15 |
| `agent_loop/trading.rs` | auto-approve within limits, deny over limits, daily cap | 5-6 |
| `channels/access.rs` | approve/deny/remove, DM policy enforcement | 4-5 |
| `memory/embedding.rs` | cosine similarity, edge cases (zero vec, identical vecs) | 3-4 |
| `sessions/schema.rs` | migration idempotency (run twice, no crash) | 2-3 |
| `dex/primitives.rs` | hex encode/decode, address checksums, amount conversion | 5-6 |
| `dex/abi.rs` | function selector, ABI encoding known values | 4-5 |
| `dex/rlp.rs` | RLP encoding known test vectors | 3-4 |
| `injection.rs` | all prompt injection patterns fire correctly | 8-10 |
| `nostr/crypto.rs` | NIP-04 encrypt/decrypt roundtrip, event signing | 3-4 |
| `channels/mod.rs` | `split_message()` at boundary, under, over | 3 |

**Target: ~60 unit tests across 12 modules.**

### 1B — Rust Integration Tests

Create `src-tauri/tests/` for cross-module tests:

| Test file | What it covers |
|-----------|---------------|
| `test_session_lifecycle.rs` | Create session → add messages → list → delete |
| `test_memory_roundtrip.rs` | Store memory → BM25 search → vector search → decay |
| `test_tool_classification.rs` | Full tool call → risk classify → allowlist/denylist check |
| `test_config_persistence.rs` | Set config → restart → get config |

**Target: 4 integration test files, ~20 tests.**

### 1C — TypeScript Tests (vitest)

Test the frontend logic modules (not DOM rendering):

| Module | What to test | Tests |
|--------|-------------|-------|
| `security.ts` | `classifyCommand()` for all risk levels | 10-15 |
| `features/prompt-injection/` | injection pattern matching | 8-10 |
| `features/slash-commands/` | command parsing, autocomplete matching | 5-6 |
| `components/helpers.ts` | `escHtml()`, `escAttr()`, formatting functions | 5-6 |
| `engine-bridge.ts` | IPC wrapper types (mock invoke) | 3-4 |

**Target: ~40 frontend tests.**

### 1D — Test Infrastructure

- [ ] Configure `cargo test` in `src-tauri/`
- [ ] Configure vitest with proper `vite.config.ts` test settings
- [ ] Add `npm run test` script to root `package.json`
- [ ] Add `npm run test:rust` and `npm run test:ts` scripts

**Phase 1 total: ~120 tests. Target: all critical paths covered.**

---

## Phase 2 — CI/CD Pipeline

Automate quality gates so nothing regresses.

### 2A — GitHub Actions Workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
      - run: cd src-tauri && cargo check
      - run: cd src-tauri && cargo test
      - run: cd src-tauri && cargo clippy -- -D warnings

  typescript:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx vitest run

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo install cargo-audit --locked
      - run: cd src-tauri && cargo audit
```

### 2B — Branch Protection

- Require CI pass before merge to `main`
- Require at least 1 approval on PRs

### 2C — Dependency Scanning

- Add `cargo audit` to CI (covered above)
- Add `npm audit` step for frontend deps
- Consider Dependabot for automated PR updates

---

## Phase 3 — Cryptography Fixes

Two targeted fixes, both low effort.

### 3A — XOR → AES-256-GCM for Skill Credentials

Replace `skills/crypto.rs` XOR cipher with AES-256-GCM:

- Use the `aes-gcm` crate (already a transitive dependency via Tauri)
- Keep the OS keychain for key storage (no change to `get_vault_key()`)
- Generate a random 12-byte nonce per encryption
- Store as `nonce || ciphertext || tag` (same pattern as the TS-side DB encryption)
- Add migration: re-encrypt existing credentials on first access
- **Backward compat**: detect XOR-encrypted values (no prefix) vs AES-GCM (add `aes:` prefix), auto-migrate on read

### 3B — Hard Fail on Missing Keychain

Replace the silent plaintext fallback:

- If `get_db_encryption_key()` fails → show a user-facing error dialog
- Block credential storage, not the whole app
- Add a status indicator in Settings → Security showing keychain health
- Log the failure at `error!` level, not just console warning

---

## Phase 4 — Typed Error Handling

Replace `Result<T, String>` with proper error types across the Rust backend.

### 4A — Define Error Types

Create `src-tauri/src/engine/error.rs`:

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum EngineError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Keychain error: {0}")]
    Keychain(String),

    #[error("Provider error: {provider}: {message}")]
    Provider { provider: String, message: String },

    #[error("Tool error: {tool}: {message}")]
    Tool { tool: String, message: String },

    #[error("Channel error: {channel}: {message}")]
    Channel { channel: String, message: String },

    #[error("Auth error: {0}")]
    Auth(String),

    #[error("Config error: {0}")]
    Config(String),

    #[error("{0}")]
    Other(String),
}

// Tauri commands still need String errors at the boundary
impl From<EngineError> for String {
    fn from(e: EngineError) -> String {
        e.to_string()
    }
}
```

### 4B — Migrate Module by Module

Migrate in order of dependency depth (leaves first):

1. `dex/primitives.rs`, `dex/rlp.rs`, `dex/abi.rs` — pure functions
2. `sessions/` — DB layer
3. `memory/` — depends on sessions
4. `skills/` — crypto + DB
5. `providers/` — network
6. `channels/`, bridges — network + DB
7. `tools/` — calls everything
8. `agent_loop/` — top-level orchestration
9. `commands.rs` — Tauri boundary (keep `Result<T, String>` here, convert via `.map_err(|e| e.to_string())`)

### 4C — Add `thiserror` Dependency

```toml
[dependencies]
thiserror = "2"
```

---

## Phase 5 — Retry Logic & Rate Limiting

### 5A — HTTP Retry Wrapper

Create `src-tauri/src/engine/http.rs`:

- Exponential backoff with jitter (base 1s, max 30s, 3 retries)
- Retry on 429 (rate limit), 500, 502, 503, 504
- Respect `Retry-After` header
- Circuit breaker: after 5 consecutive failures, fail fast for 60s

### 5B — Apply to Provider Calls

Wrap SSE streaming calls in `providers/openai.rs`, `anthropic.rs`, `google.rs` with retry logic. SSE streams that drop mid-response should resume from the last received token.

### 5C — Apply to Channel Bridges

Add reconnect logic to long-lived bridge connections:
- Telegram polling: retry on network error with backoff
- Discord/Slack/Matrix WebSocket: auto-reconnect with backoff
- Nostr relay: already has reconnect (verify backoff is exponential)

### 5D — Apply to Tool Execution

`tools/fetch.rs` — retry on transient HTTP errors.
`tools/exec.rs` — add configurable timeout (default 60s, max 300s).

---

## Phase 6 — Persistent Logging

### 6A — File Transport

Implement a file-based log transport:

- Write to `$APP_DATA/logs/pawz-YYYY-MM-DD.log`
- Rotate daily, keep 7 days
- Format: `[timestamp] [LEVEL] [module] message {data}`
- Register on app startup in `main.ts`

### 6B — Rust-Side Logging

- Logs already go through `log` crate macros (`info!`, `debug!`, etc.)
- Add `env_logger` or `tracing-subscriber` with file output
- Same rotation policy: daily, 7-day retention

### 6C — Log Viewer

- Add a "Logs" tab in Settings (or expand the existing diagnostics panel)
- Show today's log file with tail-follow
- Filter by level, module, search text

---

## Phase 7 — Database Migrations

### 7A — Migration Framework

Create `src-tauri/src/engine/sessions/migrations/`:

```
migrations/
├── mod.rs              // Run pending migrations
├── v001_initial.rs     // Current schema (all CREATE TABLE statements)
├── v002_credential_audit.rs  // ALTER TABLE additions
├── v003_security_rules.rs
└── ...
```

### 7B — Migration Table

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 7C — Migration Runner

On app startup:
1. Check `schema_migrations` for highest applied version
2. Run any unapplied migrations in order
3. Record each applied migration
4. Log success/failure

### 7D — Migrate Existing Schema

- Move the current 284-line DDL from `sessions/schema.rs` into `v001_initial.rs`
- Each future schema change gets its own numbered migration file
- No more inline `ALTER TABLE` scattered through code

---

## Execution Order

```
Phase 1 (Tests)          ████████████████  ← Do first, biggest impact
Phase 2 (CI/CD)          ████████          ← Do immediately after tests exist
Phase 3 (Crypto)         ████              ← Quick wins, high security value
Phase 4 (Error types)    ████████████████  ← Largest refactor, do incrementally
Phase 5 (Retry/backoff)  ████████          ← Resilience layer
Phase 6 (Logging)        ████              ← Quality of life
Phase 7 (Migrations)     ████████          ← Future-proofing
```

**Estimated total: ~3,000-4,000 lines of new code across all phases.**

---

## Success Criteria

After all phases:
- [ ] `cargo test` runs 80+ tests with 0 failures
- [ ] `npx vitest run` runs 40+ tests with 0 failures
- [ ] GitHub Actions CI passes on every push
- [ ] `cargo audit` reports 0 known vulnerabilities
- [ ] All credentials encrypted with AES-256-GCM (no XOR)
- [ ] Missing keychain shows user-facing error, not silent fallback
- [ ] All engine functions return typed errors (not String)
- [ ] Provider/bridge calls retry on transient failures
- [ ] Logs persist to disk with 7-day rotation
- [ ] Schema changes tracked via numbered migrations
