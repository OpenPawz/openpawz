# Pawz — Atomic Architecture Migration Plan

> **Prepared**: 2026-02-19  
> **Codebase audited**: 51,806 LOC (21,895 Rust + 20,375 TypeScript + 9,536 CSS)  
> **Architecture**: Tauri v2 — Rust backend, TypeScript frontend, IPC bridge  
> **Goal**: Migrate to Strict Atomic Architecture (Atoms → Molecules → Organisms → Systems)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Principles](#2-architecture-principles)
3. [Phase 0 — Gateway-Era Legacy Purge](#3-phase-0--gateway-era-legacy-purge)
4. [Phase 1 — Rust Backend Atomic Restructure](#4-phase-1--rust-backend-atomic-restructure)
5. [Phase 2 — The Golden Trait (AI Provider Abstraction)](#5-phase-2--the-golden-trait-ai-provider-abstraction)
6. [Phase 3 — Command Wrapper Pattern (Systems Layer)](#6-phase-3--command-wrapper-pattern-systems-layer)
7. [Phase 4 — TypeScript Frontend Atomic Restructure](#7-phase-4--typescript-frontend-atomic-restructure)
8. [Phase 5 — Channel Bridge Macro System](#8-phase-5--channel-bridge-macro-system)
9. [Full File-Path Mapping](#9-full-file-path-mapping)
10. [Migration Order & Risk Matrix](#10-migration-order--risk-matrix)
11. [Verification Checklist](#11-verification-checklist)

---

## 1. Executive Summary

The Pawz codebase has two structural problems blocking open-source readiness:

| Problem | Symptom | Size |
|---------|---------|------|
| **Gateway-era cruft** | `lib.rs` is 2,841 LOC — ~1,400 lines are dead OpenClaw gateway management code (Node.js install, gateway start/stop, `openclaw.json` parsing, memory-lancedb plugin patching, Azure OpenAI shim removal). Gateway was removed at commit `a8796e5` but the code remains. | ~1,400 LOC dead |
| **God-file commands.rs** | `commands.rs` is 3,238 LOC containing 70+ `#[tauri::command]` functions spanning chat, sessions, memory, skills, trading, tasks, 10 channel bridges, and orchestration — all in one file. | 3,238 LOC monolith |
| **Provider coupling** | Three concrete provider structs (`OpenAiProvider`, `AnthropicProvider`, `GoogleProvider`) with no shared trait. Adding DeepSeek/Grok/Mistral requires copy-pasting ~200 LOC per provider. | 1,223 LOC, no trait |
| **Frontend monolith** | `main.ts` is 3,378 LOC with all view routing, state management, DOM manipulation, and event handling in one file. | 3,378 LOC monolith |

**The migration introduces four layers:**

```
┌─────────────────────────────────────────────┐
│  SYSTEMS        Tauri command wrappers      │  ← #[tauri::command] thin shells
│                 (invoke → Organism → Result) │
├─────────────────────────────────────────────┤
│  ORGANISMS      Composed business workflows │  ← chat_workflow, task_runner
│                 (Molecule₁ + Molecule₂ + …) │
├─────────────────────────────────────────────┤
│  MOLECULES      Stateful orchestration      │  ← SessionManager, MemoryStore
│                 (Atom₁ + Atom₂ + State)     │
├─────────────────────────────────────────────┤
│  ATOMS          Pure functions & types      │  ← message_format, risk_classify
│                 (zero side effects)          │
└─────────────────────────────────────────────┘
```

---

## 2. Architecture Principles

### 2.1 Atomic Design Rules

| Layer | Rust Convention | TS Convention | May Depend On | May NOT Depend On |
|-------|-----------------|---------------|---------------|-------------------|
| **Atoms** | `mod atoms` — pure `fn`, no `&self`, no I/O | `atoms.ts` — pure functions, zero imports from molecules/organisms | Nothing (only std) | Molecules, Organisms, Systems |
| **Molecules** | `mod molecules` — `struct` with `&self`, owns state, calls atoms | `molecules.ts` — classes/closures with state, calls atoms | Atoms only | Organisms, Systems |
| **Organisms** | `mod organisms` — composes multiple molecules into workflows | `organisms.ts` — composes molecules | Atoms, Molecules | Systems |
| **Systems** | `#[tauri::command]` thin wrappers — deserialize → call organism → serialize | `index.ts` — public API re-exports | Atoms, Molecules, Organisms | Other Systems |

### 2.2 The One-Way Dependency Rule

```
Systems → Organisms → Molecules → Atoms → (std only)
           ↓              ↓           ↓
         never imports from a higher layer
```

### 2.3 Naming Conventions

- **Rust modules**: `src-tauri/src/engine/{domain}/{atoms,molecules,organisms,mod}.rs`
- **TS modules**: `src/features/{domain}/{atoms,molecules,organisms,index}.ts`
- **Tauri commands**: `src-tauri/src/engine/systems/{domain}_commands.rs`

---

## 3. Phase 0 — Gateway-Era Legacy Purge

### 3.1 Dead Code Inventory

The following functions/blocks in `src-tauri/src/lib.rs` are **gateway-era legacy** — they manage the OpenClaw Node.js gateway process which was fully removed at commit `a8796e5`. The native Rust engine replaced all gateway functionality.

#### 3.1.1 Functions to DELETE (lib.rs)

| Line | Function | Purpose | Status |
|------|----------|---------|--------|
| 31–46 | `get_app_data_dir()` | Resolves `~/Library/Application Support/Claw` for OpenClaw data | **DEAD** — engine uses `~/.paw/` |
| 47–58 | `get_bundled_node_path()` | Finds bundled Node.js binary | **DEAD** — no Node.js dependency |
| 61–68 | `get_npm_path()` | Finds npm binary | **DEAD** |
| 70–77 | `get_openclaw_path()` | Finds `openclaw` CLI binary | **DEAD** |
| 79–86 | `get_node_bin_dir()` | Node.js bin directory | **DEAD** |
| 88–91 | `join_path_env()` | PATH env construction for Node.js | **DEAD** |
| 93–104 | `check_node_installed()` | `#[tauri::command]` — checks if Node.js exists | **DEAD** |
| 107–113 | `check_openclaw_installed()` | `#[tauri::command]` — checks `~/.openclaw/openclaw.json` | **DEAD** |
| 117–180 | `sanitize_json5()` | Strips JSON5 comments/trailing commas from OpenClaw config | **DEAD** |
| 183–210 | `parse_openclaw_config()` | Parses `~/.openclaw/openclaw.json` | **DEAD** |
| 213–225 | `get_gateway_port()` | Reads gateway port from OpenClaw config | **DEAD** |
| 228–275 | `get_gateway_token()` | `#[tauri::command]` — reads gateway auth token | **DEAD** |
| 277–280 | `get_gateway_port_setting()` | `#[tauri::command]` — returns gateway port | **DEAD** |
| 282–470 | `install_openclaw()` | `#[tauri::command]` — extracts Node.js, runs `npm install openclaw` | **DEAD** |
| 474–476 | `is_gateway_running()` | TCP probe on gateway port | **DEAD** |
| 478–486 | `check_gateway_health()` | `#[tauri::command]` — probes gateway | **DEAD** |
| 488–595 | `start_gateway()` | `#[tauri::command]` — starts OpenClaw gateway process | **DEAD** |
| 596–633 | `stop_gateway()` | `#[tauri::command]` — stops gateway process | **DEAD** |
| 636–890 | Memory LanceDB plugin management | `find_bundled_memory_plugin()`, `ensure_memory_plugin_compatible()`, `apply_openai_to_azure_patch()`, `copy_dir_recursive()`, `remove_patched_memory_plugin()` | **DEAD** — native Rust memory system replaced this |
| 893–1026 | `test_embedding_connection()` | `#[tauri::command]` — uses curl to test OpenAI embeddings (gateway-era) | **DEAD** — engine has `engine_test_embedding` |
| 1028–1048 | `check_memory_configured()` | `#[tauri::command]` — checks OpenClaw LanceDB plugin config | **DEAD** |
| 1050–1232 | `enable_memory_plugin()` | `#[tauri::command]` — patches `openclaw.json` to enable LanceDB | **DEAD** |
| 1235–1242 | `get_embedding_base_url()` | `#[tauri::command]` — reads from paw-settings.json | **DEAD** |
| 1245–1252 | `get_azure_api_version()` | `#[tauri::command]` — reads Azure API version | **DEAD** |
| 1254–1261 | `get_embedding_provider()` | `#[tauri::command]` — reads embedding provider type | **DEAD** |
| 1263–1274 | `get_api_version_or_default()` | Helper for Azure API version | **DEAD** |
| 1276–1320 | `apply_embedding_env()` | Sets env vars for gateway subprocess | **DEAD** |
| 1357–1433 | `memory_stats()`, `memory_search()`, `memory_store()` | `#[tauri::command]` ×3 — shell out to `openclaw ltm` CLI | **DEAD** — engine has native memory commands |
| 1734–1818 | `read_openclaw_config()`, `patch_openclaw_config()`, `deep_merge_json()` | `#[tauri::command]` ×2 — direct OpenClaw config manipulation | **DEAD** |
| 1819–2315 | `repair_openclaw_config()` | `#[tauri::command]` — massive 500-line repair function for OpenClaw config edge cases | **DEAD** |
| 1233–1261 | `read_paw_settings()`, `save_paw_settings()` | Read/write `~/.openclaw/paw-settings.json` | **DEAD** — engine stores config in SQLite |
| 2569–2602 | `get_device_identity()`, `sign_device_payload()`, `load_or_create_device_identity()`, `device_identity_path()`, hex helpers | Ed25519 device auth for gateway WebSocket handshake | **DEAD** |

#### 3.1.2 Tauri Commands to REMOVE from `generate_handler![]`

Remove these from the handler registration in `lib.rs` `run()`:

```
check_node_installed, check_openclaw_installed, check_gateway_health,
get_gateway_token, get_gateway_port_setting, install_openclaw,
start_gateway, stop_gateway, check_memory_configured, enable_memory_plugin,
test_embedding_connection, get_embedding_base_url, get_azure_api_version,
get_embedding_provider, memory_stats, memory_search, memory_store,
read_openclaw_config, patch_openclaw_config, repair_openclaw_config,
get_device_identity, sign_device_payload
```

**22 dead commands** → reduces `lib.rs` from 2,841 to ~700 LOC.

#### 3.1.3 Functions to KEEP in lib.rs (non-gateway)

| Function | Purpose | Keep? |
|----------|---------|-------|
| `set_owner_only_permissions()` | Unix file permissions | ✅ Move to `engine/atoms/fs.rs` |
| `run_with_timeout()` | Process execution with timeout | ✅ Move to `engine/atoms/process.rs` |
| `write_himalaya_config()` | Email account setup (OS keychain) | ✅ Move to `engine/mail/` |
| `read_himalaya_config()` | Email config reader | ✅ Move to `engine/mail/` |
| `remove_himalaya_account()` | Email account removal | ✅ Move to `engine/mail/` |
| `keyring_has_password()`, `keyring_delete_password()` | OS keychain helpers | ✅ Move to `engine/atoms/keyring.rs` |
| `get_db_encryption_key()`, `has_db_encryption_key()` | DB encryption via keychain | ✅ Move to `engine/atoms/crypto.rs` |
| `fetch_weather()` | HTTP weather proxy | ✅ Move to `engine/skills/weather.rs` |
| `fetch_emails()` → `set_email_flag()` | Himalaya CLI wrappers (6 fns) | ✅ Move to `engine/mail/` |
| `run()` | Tauri builder + command registration | ✅ Stays in `lib.rs` (slim) |

#### 3.1.4 TypeScript Gateway References to Purge

| File | What to Remove |
|------|---------------|
| `src/types.ts` | `ConnectParams`, `HelloOk`, `HealthSummary`, `ChannelHealthSummary`, `AgentHealthSummary` — WebSocket gateway handshake types |
| `src/main.ts` | Any `check_gateway_health`, `install_openclaw`, `start_gateway`, `stop_gateway` invoke calls; gateway status UI; `setupView`, `installView` DOM refs |
| `src/engine-bridge.ts` | `isEngineMode()` / `setEngineMode()` — engine is the *only* mode now, no toggle needed |
| `src/views/settings-config.ts` | Gateway connection status, `setConnected` — no gateway to connect to |

#### 3.1.5 Gateway Purge Summary

| Metric | Before | After |
|--------|--------|-------|
| `lib.rs` LOC | 2,841 | ~700 |
| Dead Tauri commands | 22 | 0 |
| Dead internal functions | ~35 | 0 |
| Dead TS types | 5 | 0 |

---

## 4. Phase 1 — Rust Backend Atomic Restructure

### 4.1 Current Structure (Flat)

```
src-tauri/src/engine/
├── mod.rs              (31 LOC — pub mod declarations)
├── types.rs            (2,344 LOC — ALL types in one file)
├── providers.rs        (1,223 LOC — 3 concrete provider impls)
├── commands.rs         (3,238 LOC — 70+ Tauri commands)
├── agent_loop.rs       (478 LOC)
├── tool_executor.rs    (1,807 LOC)
├── sessions.rs         (1,530 LOC)
├── memory.rs           (992 LOC)
├── skills.rs           (1,110 LOC)
├── orchestrator.rs     (1,360 LOC)
├── compaction.rs       
├── routing.rs          
├── sandbox.rs          
├── injection.rs        
├── channels.rs         
├── dex.rs              
├── sol_dex.rs          
├── web.rs              
├── telegram.rs         (774 LOC)
├── discord.rs          (488 LOC)
├── irc.rs              (390 LOC)
├── slack.rs            (374 LOC)
├── matrix.rs           (425 LOC)
├── mattermost.rs       (377 LOC)
├── nextcloud.rs        (409 LOC)
├── nostr.rs            (474 LOC)
├── twitch.rs           (400 LOC)
└── webchat.rs          (545 LOC)
```

### 4.2 Target Structure (Atomic)

```
src-tauri/src/engine/
├── mod.rs                          (re-exports)
│
├── atoms/                          ← Pure functions, zero I/O
│   ├── mod.rs
│   ├── types.rs                    (Message, Role, ToolCall, ToolDefinition, etc.)
│   ├── config_types.rs             (ProviderConfig, ProviderKind, EngineConfig, etc.)
│   ├── channel_types.rs            (ChannelConfig, ChannelStatus, ApprovalFlow)
│   ├── trading_types.rs            (TradeRecord, Position, TradingPolicy)
│   ├── task_types.rs               (TaskRecord, TaskStatus, CronSpec)
│   ├── memory_types.rs             (MemoryRecord, MemoryConfig, EmbeddingConfig)
│   ├── model_routing.rs            (normalize_model_name, resolve_provider_for_model, auto_tier)
│   ├── message_format.rs           (format_messages_openai, format_messages_anthropic, format_messages_google)
│   ├── risk_classify.rs            (classify_command_risk, DANGER_PATTERNS, SAFE_PATTERNS)
│   ├── cost_estimate.rs            (estimate_cost_usd, MODEL_PRICING)
│   ├── token_count.rs              (estimate_tokens, truncate_utf8)
│   ├── injection_detect.rs         (scan_for_injection, INJECTION_PATTERNS)
│   ├── cron_parse.rs               (parse_cron, is_due)
│   ├── crypto.rs                   (AES-256-GCM helpers, key derivation)
│   ├── keyring.rs                  (OS keychain read/write/delete)
│   ├── fs.rs                       (set_owner_only_permissions, workspace_path)
│   └── process.rs                  (run_with_timeout)
│
├── molecules/                      ← Stateful components, own a resource
│   ├── mod.rs
│   ├── provider_client.rs          (AnyProvider — uses Golden Trait, see §5)
│   ├── session_store.rs            (SQLite session CRUD, message persistence)
│   ├── memory_store.rs             (SQLite + embeddings, BM25, vector, hybrid search)
│   ├── skill_vault.rs              (skill registry, credential injection, enable/disable)
│   ├── tool_executor.rs            (exec, fetch, file, memory, agent tool dispatch)
│   ├── sandbox_manager.rs          (Docker via bollard, container lifecycle)
│   ├── token_tracker.rs            (DailyTokenTracker — atomic counters, budget checks)
│   ├── embedding_client.rs         (Ollama embedding API client)
│   ├── compaction.rs               (AI-powered session summarization)
│   └── trading_store.rs            (trade history, positions, policy persistence)
│
├── organisms/                      ← Composed business workflows
│   ├── mod.rs
│   ├── chat_workflow.rs            (resolve provider → build context → agent_loop → auto_capture)
│   ├── task_runner.rs              (load task → resolve agents → execute → update status)
│   ├── cron_heartbeat.rs           (tick → find due tasks → execute_task per agent)
│   ├── orchestrator.rs             (boss/worker delegation, project lifecycle)
│   ├── auto_setup.rs               (detect Ollama → scan providers → configure)
│   ├── agent_loop.rs               (message → LLM → tool_calls → approve → execute → loop)
│   └── channel_dispatcher.rs       (route inbound message → resolve agent → chat_workflow)
│
├── channels/                       ← Channel bridge implementations
│   ├── mod.rs                      (ChannelBridge trait, registry)
│   ├── types.rs                    (shared channel types)
│   ├── telegram.rs
│   ├── discord.rs
│   ├── irc.rs
│   ├── slack.rs
│   ├── matrix.rs
│   ├── mattermost.rs
│   ├── nextcloud.rs
│   ├── nostr.rs
│   ├── twitch.rs
│   └── webchat.rs
│
├── mail/                           ← Email integration (Himalaya)
│   ├── mod.rs
│   ├── config.rs                   (write/read/remove Himalaya TOML)
│   └── client.rs                   (fetch, send, list, move, delete, flag)
│
├── trading/                        ← Coinbase CDP + DEX
│   ├── mod.rs
│   ├── dex.rs
│   ├── sol_dex.rs
│   └── web.rs
│
└── systems/                        ← #[tauri::command] thin wrappers
    ├── mod.rs
    ├── chat_commands.rs            (engine_chat_send, engine_chat_history)
    ├── session_commands.rs         (engine_sessions_list, _rename, _delete, _clear, _compact)
    ├── config_commands.rs          (engine_get_config, _set_config, _upsert_provider, _remove_provider, _status, _auto_setup)
    ├── memory_commands.rs          (engine_memory_store, _search, _stats, _delete, _list, _config, _test, _backfill)
    ├── skill_commands.rs           (engine_skills_list, _set_enabled, _set_credential, _delete_credential, _revoke_all, _instructions)
    ├── task_commands.rs            (engine_tasks_list, _create, _update, _delete, _move, _activity, _set_agents, _run, _cron_tick)
    ├── trading_commands.rs         (engine_trading_history, _summary, _policy_get, _policy_set, _positions)
    ├── sandbox_commands.rs         (engine_sandbox_check, _get_config, _set_config)
    ├── agent_file_commands.rs      (engine_agent_file_list, _get, _set, _delete)
    ├── tts_commands.rs             (engine_tts_speak, _get_config, _set_config)
    ├── channel_commands.rs         (macro-generated: engine_{channel}_{start,stop,status,get_config,...} × 10)
    ├── orchestrator_commands.rs    (engine_projects_*, engine_list_all_agents, _create_agent, _delete_agent, _project_run)
    ├── mail_commands.rs            (write_himalaya_config, fetch_emails, send_email, etc.)
    ├── security_commands.rs        (engine_approve_tool)
    └── utility_commands.rs         (fetch_weather, keyring_*, db_encryption_*)
```

### 4.3 types.rs Decomposition (2,344 LOC → 8 files)

| Current Location | Target File | Types |
|-----------------|-------------|-------|
| types.rs L1–160 | `atoms/types.rs` | `Message`, `Role`, `MessageContent`, `ContentBlock`, `ImageUrlData`, `ToolCall`, `ThoughtPart`, `FunctionCall`, `ToolDefinition`, `FunctionDefinition`, `StreamChunk`, `ToolCallDelta`, `TokenUsage` |
| types.rs L160–400 | `atoms/types.rs` | All tool definitions (`exec`, `fetch`, `read_file`, `write_file`, `list_directory`, `append_file`, `delete_file`, `memory_*`, `soul_*`, `create_agent`, `self_info`) |
| types.rs L400–600 | `atoms/config_types.rs` | `ProviderConfig`, `ProviderKind`, `EngineConfig`, `ModelRouting`, `MemoryConfig` |
| types.rs L600–800 | `atoms/task_types.rs` | `TaskRecord`, `TaskStatus`, `CronSpec`, `TaskActivity` |
| types.rs L800–1000 | `atoms/trading_types.rs` | `TradeRecord`, `Position`, `TradingPolicy` |
| types.rs L1000–1200 | `atoms/memory_types.rs` | `MemoryRecord`, `MemoryStats`, `EmbeddingConfig` |
| types.rs L1200–1600 | `atoms/cost_estimate.rs` | `estimate_cost_usd`, `MODEL_PRICING` table |
| types.rs L1600+ | `atoms/types.rs` | `ChatRequest`, `ChatResponse`, `StoredMessage`, `EngineStatus` |

---

## 5. Phase 2 — The Golden Trait (AI Provider Abstraction)

### 5.1 Problem

Currently, `providers.rs` contains three concrete structs with duplicated logic:

```rust
pub struct OpenAiProvider { client, base_url, api_key, is_azure }
pub struct AnthropicProvider { client, base_url, api_key, is_azure }
pub struct GoogleProvider { client, base_url, api_key }
```

Each implements its own `chat_stream()` method. There is no shared trait. The caller in `agent_loop.rs` uses a manual `match` on `ProviderKind`:

```rust
match provider_kind {
    ProviderKind::Anthropic => AnthropicProvider::new(&config).chat_stream(...),
    ProviderKind::Google => GoogleProvider::new(&config).chat_stream(...),
    _ => OpenAiProvider::new(&config).chat_stream(...),
}
```

Adding DeepSeek, Grok, or Mistral as first-class providers requires copy-pasting the entire `OpenAiProvider` with minor URL/header tweaks.

### 5.2 The Golden Trait

```rust
// src-tauri/src/engine/atoms/provider_trait.rs

use crate::engine::atoms::types::*;
use async_trait::async_trait;

/// The Golden Trait — every AI provider implements this.
/// Adding a new provider = implement this trait + register in ProviderRegistry.
#[async_trait]
pub trait AiProvider: Send + Sync {
    /// Human-readable provider name for logging/UI.
    fn name(&self) -> &str;

    /// The ProviderKind discriminant.
    fn kind(&self) -> ProviderKind;

    /// Send a chat completion request with streaming.
    /// Returns collected stream chunks (the caller reassembles them).
    async fn chat_stream(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
        model: &str,
        temperature: Option<f64>,
    ) -> Result<Vec<StreamChunk>, ProviderError>;

    /// Optional: generate embeddings (for memory system).
    /// Default impl returns Err (not all providers support embeddings).
    async fn embed(&self, texts: &[String], model: &str) -> Result<Vec<Vec<f32>>, ProviderError> {
        Err(ProviderError::Unsupported("embeddings not supported by this provider".into()))
    }

    /// Optional: list available models.
    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        Err(ProviderError::Unsupported("model listing not supported".into()))
    }
}

#[derive(Debug)]
pub enum ProviderError {
    /// HTTP/network error (retryable)
    Transport(String),
    /// Authentication failed (not retryable)
    Auth(String),
    /// Rate limited — includes retry_after_secs if available
    RateLimited { message: String, retry_after_secs: Option<u64> },
    /// Model not found or unavailable
    ModelNotFound(String),
    /// Feature not supported by this provider
    Unsupported(String),
    /// Generic API error with status code
    Api { status: u16, message: String },
}

pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub context_window: Option<u64>,
    pub max_output: Option<u64>,
}
```

### 5.3 Provider Implementations

```rust
// src-tauri/src/engine/molecules/providers/

mod openai_compat;   // Handles: OpenAI, DeepSeek, Grok (xAI), Mistral, Moonshot, Ollama, OpenRouter, Custom
mod anthropic;       // Handles: Anthropic (direct + Azure AI)
mod google;          // Handles: Google Gemini (generativeai + Vertex)

// The key insight: OpenAI-compatible providers differ ONLY in:
//   1. base_url
//   2. auth header format
//   3. optional request body tweaks

pub struct OpenAiCompatProvider {
    client: Client,
    config: OpenAiCompatConfig,
}

pub struct OpenAiCompatConfig {
    pub name: &'static str,
    pub base_url: String,
    pub api_key: String,
    pub auth_style: AuthStyle,          // Bearer | ApiKey header | None (Ollama)
    pub extra_headers: Vec<(String, String)>,
    pub supports_stream_options: bool,  // OpenAI yes, some compat no
    pub supports_tools: bool,           // Most yes, some older no
}

pub enum AuthStyle {
    Bearer,                             // Authorization: Bearer <key>
    AzureApiKey,                        // api-key: <key>
    None,                               // Ollama (localhost, no auth)
    Custom { header: String },          // e.g. "X-Api-Key" for some providers
}
```

### 5.4 First-Class Provider Registry

```rust
// src-tauri/src/engine/molecules/provider_registry.rs

/// Extend ProviderKind to include first-class entries for routed providers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    OpenAI,
    Anthropic,
    Google,
    Ollama,
    OpenRouter,
    DeepSeek,      // NEW — first-class
    Grok,          // NEW — first-class (xAI)
    Mistral,       // NEW — first-class
    Moonshot,      // NEW — first-class (Kimi)
    Custom,
}

impl ProviderKind {
    pub fn default_base_url(&self) -> &str {
        match self {
            Self::OpenAI     => "https://api.openai.com/v1",
            Self::Anthropic  => "https://api.anthropic.com",
            Self::Google     => "https://generativelanguage.googleapis.com/v1beta",
            Self::Ollama     => "http://localhost:11434",
            Self::OpenRouter => "https://openrouter.ai/api/v1",
            Self::DeepSeek   => "https://api.deepseek.com/v1",
            Self::Grok       => "https://api.x.ai/v1",
            Self::Mistral    => "https://api.mistral.ai/v1",
            Self::Moonshot   => "https://api.moonshot.cn/v1",
            Self::Custom     => "",
        }
    }

    pub fn auth_style(&self) -> AuthStyle {
        match self {
            Self::Ollama => AuthStyle::None,
            _ => AuthStyle::Bearer,
        }
    }

    /// Build an AiProvider from a ProviderConfig.
    pub fn build_provider(&self, config: &ProviderConfig) -> Box<dyn AiProvider> {
        match self {
            Self::Anthropic => Box::new(AnthropicProvider::new(config)),
            Self::Google    => Box::new(GoogleProvider::new(config)),
            // Everything else is OpenAI-compatible
            _ => Box::new(OpenAiCompatProvider::from_config(config)),
        }
    }
}
```

### 5.5 Adding a New Provider (Post-Migration)

To add a new OpenAI-compatible provider (e.g., Cerebras):

1. Add `Cerebras` variant to `ProviderKind` enum
2. Add `default_base_url()` match arm: `"https://api.cerebras.ai/v1"`
3. Add `auth_style()` match arm: `AuthStyle::Bearer`
4. **Done.** No new struct, no new file, no copy-paste.

For a provider with a unique API format (non-OpenAI-compatible):

1. Create `src-tauri/src/engine/molecules/providers/cerebras.rs`
2. Implement `AiProvider` trait
3. Add match arm in `build_provider()`

---

## 6. Phase 3 — Command Wrapper Pattern (Systems Layer)

### 6.1 Problem

`commands.rs` has 3,238 LOC with 70+ `#[tauri::command]` functions that each:
1. Extract state from `State<'_, EngineState>`
2. Validate input
3. Call business logic
4. Serialize result

This mixes serialization concerns with business logic.

### 6.2 The Command Wrapper Pattern

Each command becomes a thin wrapper that delegates to an Organism:

```rust
// src-tauri/src/engine/systems/chat_commands.rs

use crate::engine::organisms::chat_workflow;
use crate::engine::systems::state::EngineState;
use tauri::State;

/// Send a chat message. Thin wrapper — all logic lives in chat_workflow.
#[tauri::command]
pub async fn engine_chat_send(
    app_handle: tauri::AppHandle,
    state: State<'_, EngineState>,
    request: ChatRequest,
) -> Result<ChatResponse, String> {
    chat_workflow::send(app_handle, &state, request).await
}

#[tauri::command]
pub fn engine_chat_history(
    state: State<'_, EngineState>,
    session_id: String,
) -> Result<Vec<StoredMessage>, String> {
    state.store.get_messages(&session_id)
}
```

### 6.3 Full Command Mapping (70+ Commands → 16 System Files)

| System File | Commands | Current LOC | Target LOC |
|------------|----------|-------------|------------|
| `chat_commands.rs` | `engine_chat_send`, `engine_chat_history` | ~500 | ~30 |
| `session_commands.rs` | `engine_sessions_list`, `_rename`, `_delete`, `_clear`, `_compact` | ~100 | ~50 |
| `config_commands.rs` | `engine_get_config`, `_set_config`, `_upsert_provider`, `_remove_provider`, `_status`, `_auto_setup`, `_get_daily_spend` | ~350 | ~80 |
| `memory_commands.rs` | `engine_memory_store`, `_search`, `_stats`, `_delete`, `_list`, `_get_memory_config`, `_set_memory_config`, `_test_embedding`, `_embedding_status`, `_embedding_pull_model`, `_ensure_embedding_ready`, `_memory_backfill` | ~200 | ~100 |
| `skill_commands.rs` | `engine_skills_list`, `_set_enabled`, `_set_credential`, `_delete_credential`, `_revoke_all`, `_get_instructions`, `_set_instructions` | ~80 | ~60 |
| `task_commands.rs` | `engine_tasks_list`, `_create`, `_update`, `_delete`, `_move`, `_activity`, `_set_agents`, `_run`, `_cron_tick` | ~700 | ~100 |
| `trading_commands.rs` | `engine_trading_history`, `_summary`, `_policy_get`, `_policy_set`, `_positions_list`, `_position_close`, `_position_update_targets` | ~80 | ~60 |
| `sandbox_commands.rs` | `engine_sandbox_check`, `_get_config`, `_set_config` | ~30 | ~20 |
| `agent_file_commands.rs` | `engine_agent_file_list`, `_get`, `_set`, `_delete` | ~50 | ~30 |
| `tts_commands.rs` | `engine_tts_speak`, `_get_config`, `_set_config` | ~30 | ~20 |
| `security_commands.rs` | `engine_approve_tool` | ~30 | ~15 |
| `channel_commands.rs` | 80 channel commands (10 channels × 8 ops) — **macro-generated** | ~1,000 | ~60 (macro) |
| `orchestrator_commands.rs` | `engine_projects_list`, `_create`, `_update`, `_delete`, `_set_agents`, `_list_all_agents`, `_create_agent`, `_delete_agent`, `_project_messages`, `_project_run` | ~200 | ~80 |
| `mail_commands.rs` | `write_himalaya_config`, `read_himalaya_config`, `remove_himalaya_account`, `fetch_emails`, `fetch_email_content`, `send_email`, `list_mail_folders`, `move_email`, `delete_email`, `set_email_flag` | ~300 | ~80 |
| `utility_commands.rs` | `fetch_weather`, `keyring_has_password`, `keyring_delete_password`, `get_db_encryption_key`, `has_db_encryption_key` | ~100 | ~50 |
| `state.rs` (not commands, shared state) | `EngineState`, `PendingApprovals`, `DailyTokenTracker` | ~150 | ~150 |

---

## 7. Phase 4 — TypeScript Frontend Atomic Restructure

### 7.1 Current Structure

```
src/
├── main.ts              (3,378 LOC — GOD FILE)
├── engine.ts            (1,029 LOC — Tauri invoke wrappers)
├── engine-bridge.ts     (235 LOC — event translation)
├── types.ts             (527 LOC — mixed types)
├── security.ts          
├── db.ts                
├── workspace.ts         
├── styles.css           (9,536 LOC)
├── components/
│   ├── helpers.ts
│   └── toast.ts
├── features/
│   ├── slash-commands/  {atoms, molecules, index}  ← GOOD pattern
│   ├── agent-policies/  {atoms, molecules, index}
│   ├── channel-routing/ {atoms, molecules, index}
│   ├── container-sandbox/ {atoms, molecules, index}
│   ├── memory-intelligence/ {atoms, molecules, index}
│   ├── prompt-injection/ {atoms, molecules, index}
│   ├── session-compaction/ {atoms, molecules, index}
│   └── browser-sandbox/ (empty)
└── views/               (20+ view files)
```

**Good news**: The `features/` directory already follows Atomic Design (atoms → molecules → index). The problem is `main.ts` and `engine.ts`.

### 7.2 Target Structure

```
src/
├── main.ts                      (~200 LOC — router + bootstrap only)
├── types.ts                     (cleaned — no gateway types)
├── security.ts                  (unchanged)
├── db.ts                        (unchanged)
├── workspace.ts                 (unchanged)
│
├── engine/                      ← Replaces engine.ts + engine-bridge.ts
│   ├── index.ts                 (public API)
│   ├── atoms/
│   │   ├── types.ts             (EngineEvent, EngineChatRequest, etc.)
│   │   ├── model_context.ts     (MODEL_CONTEXT_SIZES, MODEL_COST_PER_TOKEN)
│   │   └── format.ts            (icon helper, markdown render, code highlight)
│   ├── molecules/
│   │   ├── ipc_client.ts        (Tauri invoke wrappers — from engine.ts)
│   │   ├── event_bus.ts         (Tauri event listener + dispatch — from engine-bridge.ts)
│   │   └── token_meter.ts       (token tracking, cost estimation — from main.ts)
│   └── organisms/
│       ├── chat_controller.ts   (send message, handle stream, render — from main.ts)
│       └── session_manager.ts   (session CRUD, agent-session mapping — from main.ts)
│
├── state/                       ← Extracted from main.ts globals
│   ├── index.ts                 (AppState singleton)
│   ├── atoms/
│   │   └── types.ts             (AppConfig, MessageWithAttachments)
│   └── molecules/
│       ├── config_store.ts      (config persistence)
│       └── session_state.ts     (current session, messages array)
│
├── components/                  ← UI primitives (existing + extracted)
│   ├── helpers.ts               (existing)
│   ├── toast.ts                 (existing)
│   ├── atoms/
│   │   ├── button.ts
│   │   ├── modal.ts
│   │   ├── badge.ts
│   │   └── input.ts
│   └── molecules/
│       ├── approval_dialog.ts   (HIL modal — from main.ts)
│       ├── attachment_picker.ts (file attach — from main.ts)
│       └── message_renderer.ts  (markdown + code blocks — from main.ts)
│
├── features/                    ← Already atomic (keep as-is)
│   ├── slash-commands/
│   ├── agent-policies/
│   ├── channel-routing/
│   ├── container-sandbox/
│   ├── memory-intelligence/
│   ├── prompt-injection/
│   ├── session-compaction/
│   └── browser-sandbox/
│
└── views/                       ← Organism-level (composed from features + components)
    ├── agents.ts                (keep — already well-scoped)
    ├── mail.ts                  (keep)
    ├── projects.ts              (keep)
    ├── ... (all 20+ views keep their files)
    └── settings-*.ts            (keep)
```

### 7.3 main.ts Decomposition (3,378 LOC → ~200 LOC)

| Extract From main.ts | Target | LOC |
|----------------------|--------|-----|
| Token metering state + logic (L85–185) | `engine/molecules/token_meter.ts` | ~100 |
| Model context sizes + cost tables (L130–175) | `engine/atoms/model_context.ts` | ~50 |
| Global state declarations (L80–130) | `state/molecules/session_state.ts` | ~50 |
| Agent session mapping (L95–115) | `state/molecules/session_state.ts` | ~20 |
| HIL approval modal rendering | `components/molecules/approval_dialog.ts` | ~150 |
| Attachment handling | `components/molecules/attachment_picker.ts` | ~80 |
| Message rendering (markdown, code, tool calls) | `components/molecules/message_renderer.ts` | ~200 |
| Chat send/receive logic | `engine/organisms/chat_controller.ts` | ~300 |
| Session management (create, switch, rename, delete) | `engine/organisms/session_manager.ts` | ~150 |
| View routing + nav rendering | Stays in `main.ts` | ~200 |
| Icon helper | `engine/atoms/format.ts` | ~30 |

---

## 8. Phase 5 — Channel Bridge Macro System

### 8.1 Problem

10 channel bridges × 8 commands each = 80 nearly-identical `#[tauri::command]` functions in `commands.rs`. Each channel has the same API: `start`, `stop`, `status`, `get_config`, `set_config`, `approve_user`, `deny_user`, `remove_user`.

### 8.2 Solution: Declarative Macro

```rust
// src-tauri/src/engine/systems/channel_commands.rs

/// Generate all 8 Tauri commands for a channel bridge.
macro_rules! channel_commands {
    ($channel:ident, $config_type:ty, $module:path) => {
        paste::paste! {
            #[tauri::command]
            pub async fn [<engine_ $channel _start>](app_handle: tauri::AppHandle) -> Result<(), String> {
                $module::start(app_handle).await
            }

            #[tauri::command]
            pub fn [<engine_ $channel _stop>]() -> Result<(), String> {
                $module::stop()
            }

            #[tauri::command]
            pub fn [<engine_ $channel _status>](app_handle: tauri::AppHandle) -> Result<ChannelStatus, String> {
                $module::status(app_handle)
            }

            #[tauri::command]
            pub fn [<engine_ $channel _get_config>](app_handle: tauri::AppHandle) -> Result<$config_type, String> {
                $module::get_config(app_handle)
            }

            #[tauri::command]
            pub fn [<engine_ $channel _set_config>](app_handle: tauri::AppHandle, config: $config_type) -> Result<(), String> {
                $module::set_config(app_handle, config)
            }

            #[tauri::command]
            pub fn [<engine_ $channel _approve_user>](app_handle: tauri::AppHandle, user_id: String) -> Result<(), String> {
                $module::approve_user(app_handle, user_id)
            }

            #[tauri::command]
            pub fn [<engine_ $channel _deny_user>](app_handle: tauri::AppHandle, user_id: String) -> Result<(), String> {
                $module::deny_user(app_handle, user_id)
            }

            #[tauri::command]
            pub fn [<engine_ $channel _remove_user>](app_handle: tauri::AppHandle, user_id: String) -> Result<(), String> {
                $module::remove_user(app_handle, user_id)
            }
        }
    };
}

// Generate commands for all 10 channels
channel_commands!(telegram,    TelegramConfig,    crate::engine::channels::telegram);
channel_commands!(discord,     DiscordConfig,     crate::engine::channels::discord);
channel_commands!(irc,         IrcConfig,         crate::engine::channels::irc);
channel_commands!(slack,       SlackConfig,       crate::engine::channels::slack);
channel_commands!(matrix,      MatrixConfig,      crate::engine::channels::matrix);
channel_commands!(mattermost,  MattermostConfig,  crate::engine::channels::mattermost);
channel_commands!(nextcloud,   NextcloudConfig,   crate::engine::channels::nextcloud);
channel_commands!(nostr,       NostrConfig,       crate::engine::channels::nostr);
channel_commands!(twitch,      TwitchConfig,      crate::engine::channels::twitch);
channel_commands!(webchat,     WebchatConfig,     crate::engine::channels::webchat);
```

**Result**: ~1,000 LOC of repetitive channel commands → ~60 LOC macro + 10 invocations. Adding WhatsApp becomes a one-liner: `channel_commands!(whatsapp, WhatsAppConfig, crate::engine::channels::whatsapp);`

### 8.3 Handler Registration Macro

```rust
// In lib.rs run()
macro_rules! register_channel_handlers {
    ($($channel:ident),*) => {
        paste::paste! {
            tauri::generate_handler![
                // ... other commands ...
                $( [<engine_ $channel _start>], [<engine_ $channel _stop>],
                   [<engine_ $channel _status>], [<engine_ $channel _get_config>],
                   [<engine_ $channel _set_config>], [<engine_ $channel _approve_user>],
                   [<engine_ $channel _deny_user>], [<engine_ $channel _remove_user>], )*
            ]
        }
    };
}
```

---

## 9. Full File-Path Mapping

### 9.1 Rust: Old → New

| Old Path | New Path | Action |
|----------|----------|--------|
| `lib.rs` (L31–890 gateway code) | **DELETE** | Purge |
| `lib.rs` (L893–1260 gateway memory/embedding) | **DELETE** | Purge |
| `lib.rs` (L1734–2315 openclaw config) | **DELETE** | Purge |
| `lib.rs` (L2569–2602 device identity) | **DELETE** | Purge |
| `lib.rs` (Himalaya functions) | `engine/mail/config.rs`, `engine/mail/client.rs` | Move |
| `lib.rs` (keyring functions) | `engine/atoms/keyring.rs` | Move |
| `lib.rs` (db encryption) | `engine/atoms/crypto.rs` | Move |
| `lib.rs` (fetch_weather) | `engine/systems/utility_commands.rs` | Move |
| `lib.rs` (`run()`) | `lib.rs` (stays, but slimmed to ~150 LOC) | Refactor |
| `engine/types.rs` | `engine/atoms/types.rs` + `config_types.rs` + `*_types.rs` | Split |
| `engine/providers.rs` | `engine/molecules/providers/{openai_compat,anthropic,google}.rs` | Refactor + Golden Trait |
| `engine/commands.rs` | `engine/systems/{chat,session,config,...}_commands.rs` | Split into 16 files |
| `engine/commands.rs` (EngineState) | `engine/systems/state.rs` | Extract |
| `engine/commands.rs` (DailyTokenTracker) | `engine/molecules/token_tracker.rs` | Extract |
| `engine/commands.rs` (normalize_model_name) | `engine/atoms/model_routing.rs` | Move |
| `engine/commands.rs` (resolve_provider_for_model) | `engine/atoms/model_routing.rs` | Move |
| `engine/commands.rs` (channel commands) | `engine/systems/channel_commands.rs` (macro) | Macro-ify |
| `engine/commands.rs` (task execution) | `engine/organisms/task_runner.rs` | Extract |
| `engine/commands.rs` (cron heartbeat) | `engine/organisms/cron_heartbeat.rs` | Extract |
| `engine/agent_loop.rs` | `engine/organisms/agent_loop.rs` | Move |
| `engine/tool_executor.rs` | `engine/molecules/tool_executor.rs` | Move |
| `engine/sessions.rs` | `engine/molecules/session_store.rs` | Move |
| `engine/memory.rs` | `engine/molecules/memory_store.rs` | Move |
| `engine/skills.rs` | `engine/molecules/skill_vault.rs` | Move |
| `engine/orchestrator.rs` | `engine/organisms/orchestrator.rs` | Move |
| `engine/compaction.rs` | `engine/molecules/compaction.rs` | Move |
| `engine/routing.rs` | `engine/channels/routing.rs` | Move |
| `engine/sandbox.rs` | `engine/molecules/sandbox_manager.rs` | Move |
| `engine/injection.rs` | `engine/atoms/injection_detect.rs` | Move (pure fn) |
| `engine/channels.rs` | `engine/channels/mod.rs` + `types.rs` | Move |
| `engine/dex.rs` | `engine/trading/dex.rs` | Move |
| `engine/sol_dex.rs` | `engine/trading/sol_dex.rs` | Move |
| `engine/web.rs` | `engine/trading/web.rs` | Move |
| `engine/{telegram,discord,...}.rs` | `engine/channels/{telegram,discord,...}.rs` | Move |

### 9.2 TypeScript: Old → New

| Old Path | New Path | Action |
|----------|----------|--------|
| `engine.ts` | `engine/molecules/ipc_client.ts` | Move |
| `engine-bridge.ts` | `engine/molecules/event_bus.ts` | Move + simplify |
| `types.ts` (gateway types) | **DELETE** | Purge `ConnectParams`, `HelloOk`, `HealthSummary`, etc. |
| `main.ts` (token metering) | `engine/molecules/token_meter.ts` | Extract |
| `main.ts` (model tables) | `engine/atoms/model_context.ts` | Extract |
| `main.ts` (global state) | `state/molecules/session_state.ts` | Extract |
| `main.ts` (HIL modal) | `components/molecules/approval_dialog.ts` | Extract |
| `main.ts` (attachments) | `components/molecules/attachment_picker.ts` | Extract |
| `main.ts` (message render) | `components/molecules/message_renderer.ts` | Extract |
| `main.ts` (chat logic) | `engine/organisms/chat_controller.ts` | Extract |
| `main.ts` (sessions) | `engine/organisms/session_manager.ts` | Extract |
| `main.ts` (icon helper) | `engine/atoms/format.ts` | Extract |
| `features/*` | `features/*` (unchanged) | ✅ Already atomic |
| `views/*` | `views/*` (unchanged) | ✅ Already well-scoped |

---

## 10. Migration Order & Risk Matrix

### 10.1 Recommended Execution Order

| Phase | Work | Risk | LOC Changed | Prerequisite |
|-------|------|------|-------------|--------------|
| **0a** | Delete gateway functions from `lib.rs` | 🟢 Low | -1,400 | None — dead code |
| **0b** | Remove gateway Tauri command registrations | 🟢 Low | -22 lines | 0a |
| **0c** | Purge gateway TS types from `types.ts` | 🟢 Low | -50 | 0a |
| **0d** | Remove `isEngineMode()` toggle in `engine-bridge.ts` | 🟢 Low | -20 | 0a |
| **1a** | Split `types.rs` into `atoms/` submodules | 🟡 Medium | ~2,344 moved | None |
| **1b** | Move `injection.rs` → `atoms/injection_detect.rs` | 🟢 Low | ~200 moved | 1a |
| **1c** | Extract `DailyTokenTracker` → `molecules/token_tracker.rs` | 🟢 Low | ~130 moved | 1a |
| **1d** | Extract `EngineState` → `systems/state.rs` | 🟡 Medium | ~150 moved | 1a |
| **2a** | Define `AiProvider` Golden Trait in `atoms/` | 🟢 Low | ~80 new | 1a |
| **2b** | Refactor `OpenAiProvider` → implement trait | 🟡 Medium | ~400 refactored | 2a |
| **2c** | Refactor `AnthropicProvider` → implement trait | 🟡 Medium | ~400 refactored | 2a |
| **2d** | Refactor `GoogleProvider` → implement trait | 🟡 Medium | ~350 refactored | 2a |
| **2e** | Add first-class DeepSeek/Grok/Mistral/Moonshot | 🟢 Low | ~20 new (config only) | 2b |
| **3a** | Create `systems/` directory + split commands | 🟡 Medium | ~3,238 split | 1d, 2b |
| **3b** | Create channel command macro | 🟢 Low | ~60 new, -1,000 deleted | 3a |
| **3c** | Update `lib.rs` `run()` to import from `systems/` | 🟡 Medium | ~200 changed | 3a, 3b |
| **4a** | Extract `engine.ts` → `engine/molecules/ipc_client.ts` | 🟢 Low | ~1,029 moved | None |
| **4b** | Extract token metering from `main.ts` | 🟢 Low | ~100 moved | 4a |
| **4c** | Extract chat controller from `main.ts` | 🟡 Medium | ~300 moved | 4a, 4b |
| **4d** | Extract message renderer from `main.ts` | 🟢 Low | ~200 moved | None |
| **4e** | Extract HIL modal from `main.ts` | 🟢 Low | ~150 moved | None |
| **5** | Channel bridge macro (Rust) | 🟢 Low | ~60 new | 3a |

### 10.2 Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Circular `mod` imports after restructure | Use a `prelude.rs` in `atoms/` that re-exports all types; molecules import from prelude |
| Tauri command rename breaks frontend | Phase 3 preserves all existing command names — only internal organization changes |
| Trait object performance (vtable) | Use `enum dispatch` crate or manual `match` for hot path (`chat_stream`) — measure first |
| `main.ts` extraction breaks event flow | Phase 4 runs last; extract incrementally with integration tests per extraction |

---

## 11. Verification Checklist

### After Phase 0 (Gateway Purge)

- [ ] `cargo build` succeeds with zero warnings about dead code
- [ ] No function in `lib.rs` references `openclaw`, `gateway`, `node`, `npm`
- [ ] No TypeScript file references `ConnectParams`, `HelloOk`, `HealthSummary`
- [ ] `lib.rs` is under 800 LOC
- [ ] All 70+ engine commands still work (no accidental deletion)

### After Phase 1 (Rust Atomic)

- [ ] `engine/atoms/` has zero `use` of `engine/molecules/` or `engine/organisms/`
- [ ] `engine/molecules/` has zero `use` of `engine/organisms/` or `engine/systems/`
- [ ] `cargo test` passes
- [ ] `types.rs` no longer exists as a single file

### After Phase 2 (Golden Trait)

- [ ] `providers.rs` no longer exists as a single file
- [ ] `AiProvider` trait has exactly one implementation per provider family
- [ ] Adding a new OpenAI-compatible provider requires zero new files
- [ ] All 6 existing providers still work (regression test)

### After Phase 3 (Command Wrappers)

- [ ] `commands.rs` no longer exists
- [ ] Each system file is under 100 LOC
- [ ] All Tauri command names are unchanged (frontend compatibility)
- [ ] Channel command macro generates all 80 channel commands

### After Phase 4 (TS Atomic)

- [ ] `main.ts` is under 300 LOC
- [ ] `engine.ts` no longer exists at root level
- [ ] All `features/` modules still follow atoms → molecules → index pattern
- [ ] No circular imports (`madge --circular` passes)

### After Phase 5 (Channel Macro)

- [ ] Adding a new channel bridge requires: 1 Rust file + 1 macro invocation
- [ ] All 10 existing bridges work unchanged

---

## Appendix: LOC Budget (Post-Migration)

| Layer | Estimated LOC | Files |
|-------|---------------|-------|
| **Rust atoms/** | ~3,000 | 18 files |
| **Rust molecules/** | ~6,500 | 11 files |
| **Rust organisms/** | ~3,500 | 7 files |
| **Rust channels/** | ~4,800 | 12 files |
| **Rust trading/** | ~1,200 | 4 files |
| **Rust mail/** | ~600 | 3 files |
| **Rust systems/** | ~800 | 17 files |
| **lib.rs** | ~150 | 1 file |
| **Total Rust** | ~20,550 | 73 files |
| | | |
| **TS engine/** | ~1,500 | 8 files |
| **TS state/** | ~200 | 4 files |
| **TS components/** | ~600 | 8 files |
| **TS features/** | ~2,600 | 24 files (existing) |
| **TS views/** | ~10,800 | 20 files (existing) |
| **TS main.ts** | ~200 | 1 file |
| **Total TS** | ~15,900 | 65 files |
| | | |
| **CSS** | ~9,536 | 1 file |
| **Grand Total** | ~46,000 | 139 files |

**Net reduction**: ~5,800 LOC deleted (gateway purge + macro compression + dead code removal).

---

*End of ATOMIC_MIGRATION_PLAN.md*
