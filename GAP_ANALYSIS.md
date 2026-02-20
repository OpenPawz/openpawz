# Pawz — Enterprise-Grade Gap Analysis

> **Audited**: 2026-02-20 | 51k LOC (Rust + TypeScript + CSS)  
> **Scope**: Rigid Invariant Audit across all four Enterprise Pillars  
> **Method**: Static analysis, import-graph tracing, pattern scanning

---

## Severity Legend

| Level | Meaning |
|-------|---------|
| 🔴 **CRITICAL** | Must fix before production. Can cause crashes, data loss, or security breach. |
| 🟡 **DEBT** | Architectural smell or correctness bug. Won't crash but degrades reliability/maintainability. |
| 🟢 **OPTIMIZATION** | Performance or ergonomic improvement. Safe to defer. |

---

## Executive Summary

| Pillar | 🔴 Critical | 🟡 Debt | 🟢 Optimization |
|--------|:-----------:|:-------:|:----------------:|
| 1 — Dependency Enforcement | 3 | 2 | 1 |
| 2 — Security & Panic Surface | 3 | 4 | 2 |
| 3 — Type Safety & Memory Hygiene | 1 | 7 | 2 |
| 4 — Scalability Bottlenecks | 2 | 2 | 2 |
| **Total** | **9** | **15** | **7** |

---

## Pillar 1 — One-Way Dependency Enforcement

### 🔴 C-1.1 — Rust `engine/` imports upward into `commands/state.rs` (7 sites)

**The atomic rule says**: `engine/` (organism/molecule) must NEVER import from `commands/` (system layer). This is violated in **7 files**.

| File | Line | Import |
|------|------|--------|
| `src-tauri/src/engine/agent_loop.rs` | 8 | `use crate::commands::state::{EngineState, PendingApprovals, DailyTokenTracker}` |
| `src-tauri/src/engine/channels.rs` | 16 | `use crate::commands::state::{EngineState, PendingApprovals, normalize_model_name, resolve_provider_for_model}` |
| `src-tauri/src/engine/orchestrator.rs` | 7 | `use crate::commands::state::{EngineState, PendingApprovals, normalize_model_name}` |
| `src-tauri/src/engine/telegram.rs` | 20 | `use crate::commands::state::{EngineState, PendingApprovals, normalize_model_name, resolve_provider_for_model}` |
| `src-tauri/src/engine/tool_executor.rs` | 6 | `use crate::commands::state::EngineState` |
| `src-tauri/src/engine/dex.rs` | 783 | `app_handle.try_state::<crate::commands::state::EngineState>()` |
| `src-tauri/src/engine/sol_dex.rs` | 276 | `app_handle.try_state::<crate::commands::state::EngineState>()` |

**Root cause**: `EngineState`, `PendingApprovals`, `DailyTokenTracker`, `normalize_model_name()`, and `resolve_provider_for_model()` are defined in the system layer but are *consumed* by the engine layer. They belong in a lower layer.

**Enterprise Correction**: Create `src-tauri/src/engine/state.rs` and move all five constructs there. The commands layer re-exports them for backward compatibility:

```rust
// src-tauri/src/engine/state.rs  (NEW — move from commands/state.rs)
pub struct EngineState { /* ... unchanged ... */ }
pub type PendingApprovals = Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>>>;
pub struct DailyTokenTracker { /* ... unchanged ... */ }
pub fn normalize_model_name(model: &str) -> &str { /* ... unchanged ... */ }
pub fn resolve_provider_for_model(model: &str, providers: &[ProviderConfig]) -> Option<ProviderConfig> { /* ... */ }

// src-tauri/src/commands/state.rs  (becomes a re-export shim)
pub use crate::engine::state::*;
```

Then update `engine/mod.rs`:
```rust
pub mod state;   // add
```

All 7 engine files change `use crate::commands::state` → `use crate::engine::state`. Zero logic changes, one-shot find-and-replace.

---

### 🔴 C-1.2 — TS `event_bus.ts` (molecule) imports from `chat_controller` (organism)

File: `src/engine/molecules/event_bus.ts`, lines 9–13:
```typescript
import {
  appendStreamingDelta,
  recordTokenUsage,
  updateContextLimitFromModel,
} from '../organisms/chat_controller';
```

A molecule must NEVER import from an organism. This is a **textbook layer inversion**.

**Enterprise Correction**: Invert the dependency with a callback registry:

```typescript
// src/engine/molecules/event_bus.ts
type DeltaHandler    = (delta: string) => void;
type TokenHandler    = (usage: Record<string, unknown> | undefined) => void;
type ModelHandler    = (model: string) => void;

let _onDelta: DeltaHandler    = () => {};
let _onToken: TokenHandler    = () => {};
let _onModel: ModelHandler    = () => {};

/** Called once from chat_controller.ts at startup */
export function registerStreamHandlers(opts: {
  onDelta: DeltaHandler;
  onToken: TokenHandler;
  onModel: ModelHandler;
}) {
  _onDelta = opts.onDelta;
  _onToken = opts.onToken;
  _onModel = opts.onModel;
}

// In handleAgentEvent(), replace direct calls:
//   appendStreamingDelta(delta)   →  _onDelta(delta)
//   recordTokenUsage(agentUsage)  →  _onToken(agentUsage)
//   updateContextLimitFromModel() →  _onModel(confirmedModel)
```

Then in `chat_controller.ts`:
```typescript
import { registerStreamHandlers } from '../molecules/event_bus';
// At init time:
registerStreamHandlers({
  onDelta: appendStreamingDelta,
  onToken: recordTokenUsage,
  onModel: updateContextLimitFromModel,
});
```

---

### 🔴 C-1.3 — TS `event_bus.ts` (molecule) imports from `views/research` (organism/system)

File: `src/engine/molecules/event_bus.ts`, line 14:
```typescript
import * as ResearchModule from '../../views/research';
```

This is a **two-level upward violation** (molecule → view). The research module's streaming should register itself with the event bus, not be directly imported.

**Enterprise Correction**: Extend the callback registry above:

```typescript
// src/engine/molecules/event_bus.ts
type ResearchRouter = (evtSession: string, stream: string, data: Record<string, unknown>, runId?: string) => boolean;
let _routeResearch: ResearchRouter = () => false;

export function registerResearchRouter(fn: ResearchRouter) { _routeResearch = fn; }

// In handleAgentEvent(), replace the research block:
//   if (evtSession?.startsWith('paw-research-')) { ... }
// with:
//   if (_routeResearch(evtSession ?? '', stream ?? '', data ?? {}, runId)) return;
```

Then `views/research.ts` registers at module init:
```typescript
import { registerResearchRouter } from '../engine/molecules/event_bus';
registerResearchRouter((session, stream, data, runId) => {
  if (!session.startsWith('paw-research-')) return false;
  // ... existing logic ...
  return true;
});
```

---

### 🟡 D-1.4 — `commands/state.rs` is a "junk drawer" with constructor side-effects

`EngineState::new()` (line 195–245) performs:
- DB reads (`store.get_config("engine_config")`)
- System prompt auto-patching with string surgery
- DB writes (`store.set_config(...)`)

A constructor with I/O side effects violates the principle that construction is separate from initialization.

**Correction**: Extract `EngineState::new()` → `EngineState::load_from_db(store)` and make the auto-patcher a separate `fn patch_system_prompt(config: &mut EngineConfig) -> bool`.

---

### 🟡 D-1.5 — TS barrel `engine.ts` re-exports atoms AND molecules in one namespace

`src/engine.ts`:
```typescript
export * from './engine/atoms/types';       // atoms
export { pawEngine } from './engine/molecules/ipc_client';  // molecules
```

Consumer code like `features/session-compaction/atoms.ts` imports from this barrel and unknowingly takes a dependency on the molecule layer. It should import directly from `'../../engine/atoms/types'`.

**Correction**: Grep for `from.*['"].*\/engine['"]` in `src/features/*/atoms.ts` and repoint to the atoms path. Eventually deprecate the barrel.

---

### 🟢 O-1.6 — `bridge.ts` cross-imports `features/agent-policies`

`src/engine/molecules/bridge.ts` imports from `../../features/agent-policies`. This is same-layer (molecule→molecule across domains) but creates a tight cross-domain coupling. Consider passing the policy checker as a parameter instead.

---

## Pillar 2 — Security & Panic Surface

### 🔴 C-2.1 — No HTTP request timeout on any AI provider

All three providers (`openai.rs`, `anthropic.rs`, `google.rs`) build `reqwest::Client` without `.timeout()` or `.connect_timeout()`. A hung TCP connection (common behind corporate proxies or during provider outages) will block the async task **indefinitely**.

**Enterprise Correction** — Apply to all three providers:

```rust
// In each provider's Client::builder() chain:
let client = reqwest::Client::builder()
    .connect_timeout(Duration::from_secs(10))
    .timeout(Duration::from_secs(120))  // total request timeout
    .build()
    .map_err(|e| ProviderError::Transport(e.to_string()))?;
```

For streaming endpoints where 120s total isn't enough, use `reqwest::Client::builder().read_timeout()` per-chunk instead of `.timeout()`.

---

### 🔴 C-2.2 — 10+ `Mutex::lock().unwrap()` on hot paths (panic on poison)

If any thread panics while holding a `Mutex`, the Mutex becomes "poisoned" and every subsequent `.unwrap()` on that Mutex **panics the calling thread** — including the Tauri main thread.

| File | Line(s) | Lock Target |
|------|---------|-------------|
| `commands/chat.rs` | 40 | `state.config.lock().unwrap()` **(main thread)** |
| `engine/agent_loop.rs` | 293, 315 | `pending_approvals.lock().unwrap()` |
| `engine/orchestrator.rs` | 844, 901, 915, 1227, 1281, 1295 | `pending_approvals.lock().unwrap()` / `tool_call_map.get().unwrap()` |
| `engine/channels.rs` | 237 | `approvals_clone.lock().unwrap()` |
| `engine/telegram.rs` | 681 | `approvals_clone.lock().unwrap()` |

**Enterprise Correction** — Option A (minimal): Replace all `.lock().unwrap()` → `.lock().map_err(|e| format!("lock poisoned: {e}"))?`:

```rust
// Before (CRITICAL):
let cfg = state.config.lock().unwrap();

// After:
let cfg = state.config.lock()
    .map_err(|e| format!("config lock poisoned: {e}"))?;
```

**Enterprise Correction** — Option B (recommended): Switch to `parking_lot::Mutex` which **never poisons**. A dead holder simply releases the lock. Drop-in replacement — same API, zero `.unwrap()` risk:

```toml
# Cargo.toml
[dependencies]
parking_lot = "0.12"
```
```rust
use parking_lot::Mutex;  // replaces std::sync::Mutex
// .lock() returns the guard directly — no Result, no unwrap needed
let cfg = state.config.lock();
```

---

### 🔴 C-2.3 — `result.as_ref().unwrap()` in DEX swap buy path

`src-tauri/src/engine/tool_executor.rs`, line 1203:
```rust
result.as_ref().unwrap().clone()
```

This is in the **financial swap execution path**. If a prior buy swap returned `Err`, this panics during position creation — the user loses visibility of the failed trade. In a trading context, silent panics can mean untracked positions.

**Enterprise Correction**:
```rust
let swap_result = result.as_ref()
    .map_err(|e| format!("Swap failed, cannot create position: {e}"))?
    .clone();
```

---

### 🟡 D-2.4 — Anthropic/Google error classification collapse

Both `anthropic.rs` and `google.rs` use an inner function `chat_stream_inner()` that returns `Result<_, String>`. The trait impl wraps **all** errors as `ProviderError::Transport`, losing `Auth`, `RateLimited`, and `Api { status }` discrimination.

The OpenAI provider does this correctly — it returns `Result<_, ProviderError>` directly.

**Correction**: Refactor `chat_stream_inner` to return `Result<_, ProviderError>` and classify based on HTTP status:
```rust
match status.as_u16() {
    401 | 403 => Err(ProviderError::Auth(body)),
    429 => Err(ProviderError::RateLimited {
        message: body,
        retry_after_secs: resp.headers().get("retry-after").and_then(|v| v.to_str().ok()?.parse().ok()),
    }),
    s => Err(ProviderError::Api { status: s, message: body }),
}
```

---

### 🟡 D-2.5 — 12+ bare `try_into().unwrap()` in DEX ABI decoding

`dex.rs` lines 929, 1016, 1030, 1054, 1316, 1326, 1462, 1481, 1621, 1635 contain:
```rust
result_bytes[offset..offset+32].try_into().unwrap()
```

A malfunctioning or malicious RPC node returning short data would panic the swap task. All should be:
```rust
result_bytes.get(offset..offset+32)
    .ok_or("RPC response too short")?
    .try_into()
    .map_err(|_| "ABI decode: unexpected byte length")?
```

---

### 🟡 D-2.6 — `execute_task()` in `commands/task.rs` has raw SQL in spawned closures

Lines 414–434 and 456–472 bypass `SessionStore` methods and write directly via `rusqlite::Connection::open()`:
```rust
if let Ok(conn) = rusqlite::Connection::open(&store_path_clone) {
    conn.execute("INSERT INTO messages ...", ...);
}
```

This creates duplicate SQL that can drift from the store, has no transaction boundaries, and swallows errors with `.ok()`.

**Correction**: Add `store.record_task_activity(task_id, agent_id, text)` and `store.finalize_task(task_id, status, summary)` methods to `SessionStore`, then call those from the spawned closure instead of raw SQL.

---

### 🟡 D-2.7 — `execute_task()` is a 250-line monolith that needs trait-ification

`commands/task.rs::execute_task()` directly calls:
- `agent_loop::run_agent_turn()` — needs `AgentRunner` trait for testability
- `skills::get_enabled_skill_instructions()` — needs `SkillService` trait
- `telegram::load_telegram_config()` — needs config service
- `sol_dex::get_token_price_usd()` — needs `PriceOracle` trait

Until these have trait boundaries, the task system cannot be unit-tested without a full engine.

---

### 🟢 O-2.8 — `isEngineMode()` / `setEngineMode()` toggle still exists

`engine-bridge.ts` (barrel → `bridge.ts`) still has `isEngineMode()` / `setEngineMode()`. The engine is the *only* mode now — the gateway was removed. This is dead API surface.

---

### 🟢 O-2.9 — `web.rs` has `Selector::parse(...).unwrap()` on hardcoded strings

Lines 82–85, 111-  in `engine/web.rs`. These parse constant CSS selectors that cannot fail, but should be `lazy_static!` for clarity and to prevent re-parsing on every call.

---

## Pillar 3 — Type Safety & Memory Hygiene

### 🔴 C-3.1 — `chat.rs` L40: `.unwrap()` on Tauri main-thread Mutex

```rust
let cfg = state.config.lock().unwrap();
```

This is the **only** bare `.unwrap()` on a Mutex in a `#[tauri::command]` handler on the main thread. Every other call site in `commands/` uses `.map_err()?`. A poisoned Mutex here crashes the entire application.

*(Fix covered in C-2.2 above — included here for type-safety completeness.)*

---

### 🟡 D-3.2 — 5 casts on `engineChatSend()` return type in `chat_controller.ts`

`src/engine/organisms/chat_controller.ts`, lines 720–814:
```typescript
(result as unknown as Record<string, unknown>).session_id
(result as unknown as Record<string, unknown>).usage
// ... 5 total
```

The TypeScript return type of `engineChatSend()` doesn't include `session_id`, `usage`, `text`, or `response` fields that Tauri actually returns. This forces 5 `as unknown as Record<string, unknown>` casts.

**Correction**: Align the TS interface with the Rust `ChatResponse` struct:
```typescript
// src/engine/atoms/types.ts — expand ChatResponse
export interface EngineChatResponse {
  runId: string;
  sessionKey: string;
  status: string;
  session_id?: string;   // ADD
  text?: string;         // ADD
  usage?: TokenUsage;    // ADD (define TokenUsage interface)
  response?: {           // ADD
    usage?: TokenUsage;
    model?: string;
  };
}
```

---

### 🟡 D-3.3 — `event_bus.ts` double-calls `recordTokenUsage` (token double-counting)

Lines 81–83:
```typescript
recordTokenUsage(agentUsage);
const evtUsage = (evt as Record<string, unknown>).usage;
if (evtUsage) recordTokenUsage(evtUsage);
```

If both `agentUsage` and `evtUsage` are populated from the same event (common), `sessionOutputTokens += outputTokens` is called **twice**, inflating costs.

**Correction**: Deduplicate by checking if usage was already recorded:
```typescript
const usage = agentUsage ?? evtUsage;
if (usage) recordTokenUsage(usage);
```

---

### 🟡 D-3.4 — `chat_controller.ts` L127: pointless double-cast on typed Session

```typescript
(s as unknown as Record<string, unknown>).label
```

The `Session` interface already has `label?: string`. This compiles as-is with `s.label`. The double-cast provides zero safety for a non-existent type mismatch.

**Correction**: `s.label ?? s.displayName ?? s.key`

---

### 🟡 D-3.5 — `channels.ts` uses `config as any` × 8 for channel config setters

Lines 492–499 pass untyped `config` objects through `as any`. Each channel has a strongly-typed config interface that is being bypassed.

**Correction**: Discriminated switch on `channelType`:
```typescript
switch (channelType) {
  case 'telegram': await pawEngine.telegramSetConfig(config as TelegramConfig); break;
  case 'discord':  await pawEngine.discordSetConfig(config as DiscordConfig);   break;
  // ...
}
```

---

### 🟡 D-3.6 — 4× `@ts-ignore` on `window.__TAURI__` instead of type augmentation

Files: `features/memory-intelligence/molecules.ts` (L40, 52, 63, 70), `features/container-sandbox/molecules.ts` (L77).

Other files already augment the `Window` interface correctly (e.g., `main.ts`, `today.ts`). These should use the same pattern:
```typescript
import { invoke } from '@tauri-apps/api/core';
// or declare global { interface Window { __TAURI__: ... } }
```

---

### 🟡 D-3.7 — Memory search clones entire `Memory` structs during scoring

`src-tauri/src/engine/memory.rs`, lines 795–878:

During hybrid search scoring and MMR diversification, `Memory` structs (which contain `content: String` — potentially large) are cloned into `score_map` and `selected` vectors.

**Correction**: Use index-based scoring:
```rust
// Instead of HashMap<Memory, f32>
let mut scores: Vec<(usize, f32)> = Vec::new();
// ... score by index into the original results vec
// At end: results.into_iter().enumerate().filter(|(i, _)| ...).map(|(_, m)| m).collect()
```

---

### 🟡 D-3.8 — Wasteful `thought_parts.clone()` per streaming chunk

`src-tauri/src/engine/agent_loop.rs`, line 119:
```rust
chunk.thought_parts.clone()
```

Accumulates by cloning every chunk's thought_parts vector. Since the chunk is consumed after this point, use `std::mem::take()`:
```rust
streaming_thoughts.extend(std::mem::take(&mut chunk.thought_parts));
```

---

### 🟢 O-3.9 — `event_bus.ts` accepts `payload: unknown` with chain of casts

Lines 16–22 perform a cascade of `as Record<string, unknown>` casts. Define a typed `AgentEventPayload` interface and narrow once:
```typescript
interface AgentEventPayload {
  stream?: string;
  data?: Record<string, unknown>;
  runId?: string;
  sessionKey?: string;
  usage?: Record<string, unknown>;
}
```

---

### 🟢 O-3.10 — Zero `unsafe` in Rust (positive confirmation)

Zero `unsafe` blocks exist in the entire `src-tauri/src/` tree. No UB risk from raw pointer usage. `Arc`/`Mutex` coverage on all shared mutable state is correct.

---

## Pillar 4 — Scalability Bottlenecks

### 🔴 C-4.1 — Global `streamingContent` / `streamingEl` prevents multi-agent concurrency

`appState` has a **single** `streamingContent: string` and `streamingEl: HTMLElement | null`. All agent streams write to this one location. When concurrent events arrive (task stream + user chat, or rapid agent switch), they can **clobber each other**:

1. `streamingRunId` is set to `null` at send-start → any arriving event claims the slot
2. Agent switch sets `streamingEl = null` but not `streamingContent` → stale events can still append
3. `messages[]` is a single flat array replaced on session switch — no per-agent state

**Enterprise Correction**: Replace scalar streaming state with a per-session map:

```typescript
interface StreamState {
  content: string;
  el: HTMLElement | null;
  runId: string | null;
  resolve: ((text: string) => void) | null;
  timeout: ReturnType<typeof setTimeout> | null;
}

// Replace in appState:
activeStreams: new Map<string, StreamState>(),
```

In `event_bus.ts`, route events by `evtSession` key into the correct stream slot. This is the prerequisite for multi-agent concurrency.

---

### 🔴 C-4.2 — Single `Mutex<Connection>` serializes all DB access (defeats WAL)

`SessionStore` wraps a **single** `rusqlite::Connection` in `std::sync::Mutex`. SQLite in WAL mode supports concurrent readers, but this architecture forces all commands through one lock:

- 4 concurrent agent loops calling `add_message` / `load_conversation`
- Plus UI commands (list sessions, rename, search)
- All serialize → latency spikes under load

**Enterprise Correction** — Option A: Use `r2d2_sqlite` connection pool:
```rust
use r2d2_sqlite::SqliteConnectionManager;
pub struct SessionStore {
    pool: r2d2::Pool<SqliteConnectionManager>,
}
```

**Option B** (simpler): Open separate read-only connections for queries, keep the single Mutex for writes:
```rust
pub struct SessionStore {
    write_conn: Mutex<Connection>,  // serialized writer
    read_pool: Vec<Connection>,     // N read-only connections for concurrent queries
}
```

---

### 🟡 D-4.3 — Token double-counting inflates budget warnings

*(Cross-ref with D-3.3)* — The duplicated `recordTokenUsage` call causes `sessionOutputTokens` to accumulate at 2× the actual rate. This triggers premature budget warnings and inaccurate cost estimates in the UI.

---

### 🟡 D-4.4 — 80 channel commands = 48.5% of all 165 registered commands

`channel_commands!` macro generates 80 functions (10 channels × 8 ops). Each generates serde deserialization glue. Estimated binary overhead: ~160–400KB.

**Correction** (optional): Replace with a single dynamic dispatch command:
```rust
#[tauri::command]
pub async fn engine_channel_op(
    app_handle: tauri::AppHandle,
    channel: String,
    op: String,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    match (channel.as_str(), op.as_str()) {
        ("telegram", "start") => telegram::start_bridge(app_handle).await.map(|_| json!({})),
        // ... dynamically routed
    }
}
```

This would cut 79 commands. However, the current approach **works correctly** and Tauri's proc-macro generates an efficient jump table. The bloat is moderate. **Defer unless binary size becomes a constraint.**

---

### 🟢 O-4.5 — `streamingRunId` race window during send

Between `streamingRunId = null` (set at send-start in `chat_controller.ts`) and the first `lifecycle:start` event arriving, **any** incoming event can claim the streaming slot. A stale event from a previous run arriving in this window would hijack the new stream.

**Correction**: Pre-assign a client-generated UUID before calling `engineChatSend`:
```typescript
const clientRunId = crypto.randomUUID();
appState.streamingRunId = clientRunId;
const result = await engineChatSend({ ...opts, clientRunId });
```

---

### 🟢 O-4.6 — No read/write lock separation on `EngineConfig`

`state.config` uses `Mutex<EngineConfig>`. Config is read on every chat send (to resolve model/provider) but written rarely (settings change). A `RwLock` would allow concurrent reads:

```rust
pub config: RwLock<EngineConfig>,
// Readers: config.read().map_err(...)? — concurrent
// Writers: config.write().map_err(...)? — exclusive
```

---

## Priority Fix Order

### Batch 1 — Crash Prevention (< 1 day)

| ID | Fix | Effort |
|----|-----|--------|
| C-2.1 | Add `.timeout()` to all 3 provider `Client::builder()` calls | 15 min |
| C-2.2 | Replace all `Mutex::lock().unwrap()` → `.map_err()?` (or switch to `parking_lot`) | 30 min |
| C-2.3 | Guard `.unwrap()` in DEX swap buy path | 5 min |
| C-3.1 | Fix `chat.rs` L40 `.unwrap()` (covered by C-2.2) | — |

### Batch 2 — Architecture Invariants (1–2 days)

| ID | Fix | Effort |
|----|-----|--------|
| C-1.1 | Move `EngineState` + helpers from `commands/state.rs` → `engine/state.rs` | 2 hr |
| C-1.2 | Refactor `event_bus.ts` to callback registration pattern | 1 hr |
| C-1.3 | Extract research routing from `event_bus.ts` to registration pattern | 30 min |

### Batch 3 — Correctness (1–2 days)

| ID | Fix | Effort |
|----|-----|--------|
| D-3.3 | Deduplicate `recordTokenUsage` in event_bus.ts | 15 min |
| D-2.4 | Anthropic/Google error classification (return `ProviderError` from inner fn) | 2 hr |
| D-2.5 | Replace 12 `try_into().unwrap()` in DEX ABI decoding | 1 hr |
| D-3.2 | Expand TS `EngineChatResponse` to match Rust struct | 30 min |

### Batch 4 — Scalability (2–3 days)

| ID | Fix | Effort |
|----|-----|--------|
| C-4.1 | Per-session streaming state (`Map<sessionKey, StreamState>`) | 4 hr |
| C-4.2 | SQLite connection pool or read/write separation | 3 hr |

### Batch 5 — Debt Cleanup (ongoing)

| ID | Fix | Effort |
|----|-----|--------|
| D-1.4 | Extract `EngineState::new()` side effects | 1 hr |
| D-1.5 | Repoint barrel imports in feature atoms | 30 min |
| D-2.6 | Move raw SQL from task.rs into SessionStore methods | 2 hr |
| D-2.7 | Trait-ify `agent_loop` + `skills` for testability | 4 hr |
| D-3.4 – D-3.8 | Minor TS cast cleanups + Rust clone optimizations | 2 hr |

---

## Positive Findings (What's Already Enterprise-Grade)

| Area | Status |
|------|--------|
| **Zero `unsafe` blocks** in Rust | ✅ No UB risk |
| **`atoms/` layer is clean** | ✅ Zero upward imports (Rust and TS) |
| **ProviderError enum** is well-designed | ✅ 6 variants including `RateLimited { retry_after_secs }` |
| **OpenAI provider** handles retries, 429, malformed SSE correctly | ✅ Best of the 3 |
| **All shared state behind Mutex/Arc** | ✅ No bare `static mut` |
| **SQLite WAL mode enabled** | ✅ Correct pragma |
| **`features/` directory follows atomic pattern** | ✅ atoms → molecules → index |
| **DailyTokenTracker uses AtomicU64** | ✅ Lock-free hot path |
| **Channel bridges use OnceLock + AtomicBool shutdown** | ✅ Clean signal pattern |
| **Session-agent mapping persisted to localStorage** | ✅ Survives refresh |
| **`state/index.ts` is properly isolated** | ✅ Only imports from `../types` |
