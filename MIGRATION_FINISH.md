# Paw — Migration Finish Plan

**For**: Sonnet (or any fast model following instructions)
**Goal**: Complete the remaining ~40% of the Atomic Migration
**Rule**: After each task, run `cargo check` (Rust) or `npx tsc --noEmit` (TS) to verify. Fix errors before moving on.

---

## Current State (verified on disk)

```
src-tauri/src/
├── atoms/          ✅  constants.rs, error.rs, traits.rs, types.rs (535 LOC)
├── commands/       ✅  13 files (agent, channels, chat, config, mail, memory, project, skills, state, task, trade, tts, utility)
├── engine/
│   ├── mod.rs           still exports types, providers, all channel modules
│   ├── types.rs         ❌ 1,873 LOC — only impls/functions, re-exports atoms::types::*
│   ├── commands.rs      tombstone (7 LOC, OK)
│   ├── providers/       ✅  mod.rs, openai.rs, anthropic.rs, google.rs
│   ├── …channel files   10 channel bridges (telegram.rs, discord.rs, etc.)
│   ├── orchestrator.rs  1,363 LOC
│   ├── sandbox.rs       390 LOC
│   └── (agent_loop, chat, memory, sessions, skills, etc.)
└── lib.rs               ✅  237 LOC, clean
```

```
src/
├── main.ts          431 LOC (target: < 300)
├── engine.ts        1,028 LOC — all IPC invoke wrappers + TS types
├── engine-bridge.ts 234 LOC — event listeners, engine mode flag
├── types.ts         526 LOC — includes 3 dead gateway types + all app types
├── state/index.ts   135 LOC ✅
├── engine/
│   ├── molecules/event_bus.ts    ✅
│   └── organisms/chat_controller.ts ✅
├── components/
│   ├── helpers.ts, toast.ts
│   └── molecules/hil_modal.ts, markdown.ts  ✅
└── views/           22 view files ✅
```

---

## Task 1 — Kill dead gateway types in `src/types.ts`

**File**: `src/types.ts`
**Action**: Delete these interfaces (they are from the old Node gateway era and unused):

- `ConnectParams` (~lines 11-28)
- `HelloOk` (~lines 30-38)
- `HealthSummary` (~lines 42-49)
- `ChannelHealthSummary` (~lines 51-58)
- `AgentHealthSummary` (~lines 60-66)

**Verify**: `grep -rn "ConnectParams\|HelloOk\|HealthSummary\|ChannelHealthSummary\|AgentHealthSummary" src/` — should return zero hits outside `types.ts` itself. If something imports them, delete that import too.

---

## Task 2 — Split `engine/types.rs` impls into domain files

**File**: `src-tauri/src/engine/types.rs` (1,873 LOC)
**Problem**: All struct data was moved to `atoms/types.rs` already, but `engine/types.rs` still holds every `impl` block, free function, and `Default` impl. It should be broken into focused molecule files.

### 2a — Create `src-tauri/src/engine/tools.rs`

Move the entire `impl ToolDefinition` block (lines ~93–1590) into a new file `engine/tools.rs`.

```rust
// engine/tools.rs — ToolDefinition constructors & builtins
use crate::atoms::types::*;

impl ToolDefinition {
    // … all the pub fn exec(), fetch(), read_file(), etc.
}
```

In `engine/types.rs`, replace that block with:
```rust
// ToolDefinition impls moved to engine/tools.rs
```

In `engine/mod.rs`, add:
```rust
pub mod tools;
```

### 2b — Create `src-tauri/src/engine/pricing.rs`

Move `model_price()`, `estimate_cost_usd()`, and `ModelPrice` (if it's an impl, not a struct) from `engine/types.rs` into `engine/pricing.rs`.

```rust
// engine/pricing.rs — Model pricing & cost estimation
use crate::atoms::types::*;

pub fn model_price(model: &str) -> ModelPrice { … }
pub fn estimate_cost_usd(…) -> f64 { … }
```

In `engine/mod.rs`, add:
```rust
pub mod pricing;
```

### 2c — Move remaining impls inline

After 2a and 2b, `engine/types.rs` should be ~200 LOC or less (ProviderKind impls, MessageContent impls, ModelRouting impls, Default impls, truncate_utf8, classify_task_complexity). This is acceptable as a "glue" file that re-exports `atoms::types::*` and adds behavior. No further splitting needed.

**Verify**: `cargo check` must pass. `wc -l src-tauri/src/engine/types.rs` should be ≤ 300.

---

## Task 3 — Merge `engine.ts` into `engine/molecules/ipc_client.ts`

**File**: `src/engine.ts` (1,028 LOC)
**Action**: 

### 3a — Move types into `src/engine/atoms/types.ts`

Create `src/engine/atoms/types.ts`. Move all `export interface` and `export type` declarations from `engine.ts` (there are ~20 of them: `EngineProviderConfig`, `EngineConfig`, `ModelRouting`, `EngineChatRequest`, etc.) into this file.

### 3b — Move IPC functions into `src/engine/molecules/ipc_client.ts`

Create `src/engine/molecules/ipc_client.ts`. Move all the `export async function engine_*()` invoke wrappers from `engine.ts` into this file.

```typescript
// src/engine/molecules/ipc_client.ts
import { invoke } from "@tauri-apps/api/core";
import type { EngineConfig, EngineSession, … } from "../atoms/types";

export async function engineGetConfig(): Promise<EngineConfig> {
  return invoke("engine_get_config");
}
// … rest of IPC wrappers
```

### 3c — Delete `src/engine.ts`

After moving everything out, delete or empty the old file. Update all imports across `src/` that `import … from "./engine"` to point to:
- Types → `"./engine/atoms/types"`  
- Functions → `"./engine/molecules/ipc_client"`

Use `grep -rn 'from.*["\x27].*\/engine["\x27]' src/` to find all import sites. **Do not miss any.**

**Verify**: `npx tsc --noEmit` must pass.

---

## Task 4 — Merge `engine-bridge.ts` into `engine/molecules/event_bus.ts`

**File**: `src/engine-bridge.ts` (234 LOC)
**Action**: The event-listening functions (`onEngineAgent`, `onEngineToolApproval`, `resolveEngineToolApproval`, `startEngineBridge`) should merge into the existing `src/engine/molecules/event_bus.ts`. The `isEngineMode()` / `setEngineMode()` helpers can go into `src/state/index.ts` (they are just a boolean flag).

After merging, delete `src/engine-bridge.ts` and update all imports.

Use `grep -rn 'from.*engine-bridge' src/` to find import sites.

**Verify**: `npx tsc --noEmit` must pass.

---

## Task 5 — Slim `main.ts` to < 300 LOC

**File**: `src/main.ts` (431 LOC)
**Action**: After Tasks 3–4 consolidated the engine layer, review `main.ts` for any remaining logic that can be extracted:

- If there are inline utility functions, move to `components/helpers.ts`
- If there is view-registration boilerplate, consider a `views/index.ts` barrel export
- If there is sidebar/nav rendering, consider `components/molecules/sidebar.ts`

Target: `main.ts` should be pure orchestration — import views, wire routes, call `startEngineBridge()`, mount DOM. Under 300 LOC.

**Verify**: `wc -l src/main.ts` < 300. App still works.

---

## Task 6 — (Optional, lower priority) Extract missing Rust command files

Three command categories from the original plan don't have dedicated files in `commands/`:

| Missing file | Source logic | Action |
|---|---|---|
| `commands/sandbox.rs` | `engine/sandbox.rs` has the logic; `commands/config.rs` has `engine_sandbox_*` wrappers | Move the 3 sandbox commands from `config.rs` into a new `commands/sandbox.rs` |
| `commands/orchestrator.rs` | `engine/orchestrator.rs` (1,363 LOC) | Not needed now — `commands/project.rs` already handles project commands |
| `commands/security.rs` | No security commands exist yet | Skip — nothing to extract |

This is cosmetic. Only do it if time permits.

---

## Execution Order

```
Task 1  →  (trivial, 5 min)     Delete dead TS gateway types
Task 2  →  (medium, 20 min)     Split engine/types.rs
Task 3  →  (medium, 30 min)     engine.ts → engine/atoms/types.ts + engine/molecules/ipc_client.ts
Task 4  →  (easy, 15 min)       engine-bridge.ts → event_bus.ts + state
Task 5  →  (easy, 15 min)       Slim main.ts
Task 6  →  (optional, 10 min)   Sandbox command extraction
```

Do them **in order**. Each task should compile cleanly before starting the next.

---

## Verification Checklist (run after all tasks)

```bash
# Rust
cargo check                                           # must pass
wc -l src-tauri/src/engine/types.rs                   # ≤ 300
test -f src-tauri/src/engine/tools.rs && echo OK      # exists
test -f src-tauri/src/engine/pricing.rs && echo OK    # exists

# TypeScript
npx tsc --noEmit                                      # must pass
wc -l src/main.ts                                     # < 300
test -f src/engine.ts && echo "FAIL: still exists" || echo OK
test -f src/engine-bridge.ts && echo "FAIL: still exists" || echo OK
test -f src/engine/atoms/types.ts && echo OK
test -f src/engine/molecules/ipc_client.ts && echo OK
grep -rn "ConnectParams\|HelloOk\|HealthSummary" src/ # 0 results
grep -rn 'from.*["\x27]\./engine["\x27]' src/        # 0 results (no bare ./engine imports)
grep -rn 'from.*engine-bridge' src/                   # 0 results
```

All checks green = migration complete.
