# Paw Agent Engine — Implementation Status

> Last updated: 2026-02-16

## What This Is

Paw now has a **native Rust agent engine** embedded directly in the Tauri backend. It replaces the OpenClaw WebSocket gateway with direct AI API calls, eliminating all networking/JSON/auth issues between the two systems.

**Old architecture:** Frontend → WebSocket → OpenClaw Gateway (Node.js) → AI APIs
**New architecture:** Frontend → Tauri IPC (`invoke()`) → Rust Engine → AI APIs directly

Zero network hop, zero open ports, zero auth tokens in engine mode.

---

## Current Status: Phase 1 COMPLETE ✅

Chat works end-to-end in engine mode with Gemini (tested & confirmed 2026-02-16).

### What's Working
- **Dual-mode switching** — Settings → General → Runtime Mode → Engine/Gateway
- **Google Gemini** — tested and working (gemini-2.0-flash confirmed)
- **OpenAI-compatible** — OpenAI, OpenRouter, Ollama, Custom endpoints (code complete, untested)
- **Anthropic** — Claude models (code complete, untested)
- **SSE streaming** — Real-time token streaming to chat UI
- **Tool definitions** — exec, fetch, read_file, write_file tools sent to model
- **Tool execution** — Shell commands, HTTP requests, file I/O
- **SQLite sessions** — Conversation history stored in `~/.paw/engine.db`
- **Engine settings UI** — Provider selection, API key, model, base URL config

### Bugs Fixed
1. **Gemini schema error** — `additionalProperties` not supported by Google; added `sanitize_schema()` recursive stripper
2. **Events silently dropped** — Engine sessions used `paw-{uuid}` which hit the `paw-*` background session filter in main.ts; changed to `eng-{uuid}`

---

## File Map

### Rust Backend (`src-tauri/src/engine/`)

| File | LOC | Purpose |
|------|-----|---------|
| `mod.rs` | 10 | Module declarations |
| `types.rs` | ~390 | All data structures: Message, Role, ToolCall, ToolDefinition, EngineEvent, Session, StoredMessage, ChatRequest/Response, EngineConfig, ProviderConfig, ProviderKind, StreamChunk |
| `providers.rs` | ~685 | AI provider HTTP clients with SSE streaming. `OpenAiProvider` (OpenAI/OpenRouter/Ollama/Custom), `AnthropicProvider`, `GoogleProvider`. `AnyProvider` enum with `from_config()` factory |
| `agent_loop.rs` | ~195 | Core agentic loop: call model → accumulate chunks → if tool calls → execute → loop back. Emits `engine-event` Tauri events for real-time streaming |
| `tool_executor.rs` | ~190 | Tool execution: `exec` (sh -c), `fetch` (reqwest), `read_file`, `write_file`. Output truncation (50KB exec, 50KB fetch, 100KB read) |
| `sessions.rs` | ~285 | SQLite session/message storage via rusqlite. DB at `~/.paw/engine.db` with WAL mode. Tables: sessions, messages, engine_config |
| `commands.rs` | ~340 | 10 Tauri `#[tauri::command]` handlers + `EngineState` struct. Smart provider resolution by model prefix (claude→Anthropic, gemini→Google, gpt→OpenAI) |

### TypeScript Frontend (`src/`)

| File | LOC | Purpose |
|------|-----|---------|
| `engine.ts` | ~192 | `PawEngineClient` class — Tauri `invoke()` wrappers for all 10 commands. Event listener system. Exported singleton `pawEngine` |
| `engine-bridge.ts` | ~142 | Translates engine events → gateway-style agent events. `isEngineMode()`, `startEngineBridge()`, `onEngineAgent()`, `engineChatSend()` |
| `views/settings-engine.ts` | ~124 | Engine settings UI: mode toggle, provider kind, API key, model, base URL, save button |

### Modified Files

| File | Changes |
|------|---------|
| `src-tauri/Cargo.toml` | Added: reqwest 0.12 (json+stream+rustls-tls), tokio 1 (full), tokio-stream 0.1, futures 0.3, uuid 1 (v4), rusqlite 0.31 (bundled) |
| `src-tauri/src/lib.rs` | Added `pub mod engine;`, `EngineState` init in `run()`, `.manage(engine_state)`, 10 engine commands in `invoke_handler` |
| `src/main.ts` | Imported engine-bridge, dual-mode in `connectGateway()`, `handleAgentEvent()` extracted as named function, registered with both gateway and engine, `sendMessage()` routes through engine in engine mode |
| `index.html` | Runtime Mode section in Settings → General with engine config panel |

---

## Architecture Details

### Event Flow (Engine Mode)
```
User types message
  → main.ts sendMessage()
    → engineChatSend() [engine-bridge.ts]
      → pawEngine.chatSend() [engine.ts]
        → invoke('engine_chat_send') [Tauri IPC]
          → Rust engine_chat_send [commands.rs]
            → spawns async agent_loop::run_agent_turn
              → provider.chat_stream() [SSE to AI API]
              → emits engine-event (Delta/ToolRequest/ToolResult/Complete/Error)
            → stores messages in SQLite
  
  engine-event Tauri events
    → PawEngineClient listener [engine.ts]
      → wildcard dispatch
        → translateEngineEvent() [engine-bridge.ts]
          → handleAgentEvent() [main.ts]
            → appendStreamingDelta() / finalizeStreaming()
```

### Session ID Conventions
- `eng-{uuid}` — Engine chat sessions (MUST NOT start with `paw-`)
- `paw-research-*` — Research module background sessions (routed separately)
- `paw-build-*` — Build module sessions (routed separately)
- `paw-*` — Other background sessions (filtered/dropped in main chat handler)

### Provider Resolution (commands.rs)
When no `provider_id` is specified, the engine resolves by model name prefix:
- `claude*` / `anthropic*` → Anthropic provider
- `gemini*` / `google*` → Google provider
- `gpt*` / `o1*` / `o3*` → OpenAI provider
- Fallback → default provider → first configured provider

### EngineConfig (persisted in SQLite)
```json
{
  "providers": [{ "id": "google", "kind": "google", "api_key": "...", "base_url": null, "default_model": "gemini-2.0-flash" }],
  "default_provider": "google",
  "default_model": "gemini-2.0-flash",
  "default_system_prompt": "You are a helpful AI assistant...",
  "max_tool_rounds": 20,
  "tool_timeout_secs": 120
}
```

---

## Phase 2 — What's Needed Next

### Priority 1: Security (HIL — Human In the Loop)
- **Location:** `tool_executor.rs` has a TODO comment marking where to add this
- **What:** Before executing `exec` or `write_file`, emit a `ToolRequest` event and WAIT for user approval via a frontend dialog
- **Frontend:** Need an approval modal/toast in main.ts that responds via a Tauri command (`engine_approve_tool`)
- **Rust:** Add a oneshot channel or similar mechanism in tool_executor to pause execution until approval arrives
- **Reference:** Paw's existing `security.ts` has command classification logic that could be reused

### Priority 2: Session Management in Engine Mode
- **What:** The session list/dropdown and history loading in main.ts still call gateway methods
- **Need:** Wire `loadSessions()` and `loadChatHistory()` to use `pawEngine.sessionsList()` and `pawEngine.chatHistory()` when in engine mode
- **Also:** Session rename/delete buttons should call engine equivalents

### Priority 3: Token Metering
- **What:** The engine doesn't report token usage back to the frontend
- **Need:** Parse usage info from API responses (each provider returns it differently) and include in Complete events
- **Frontend:** The `recordTokenUsage()` function in main.ts expects `{ input_tokens, output_tokens }` shape

### Priority 4: Error Handling
- **Retry logic** for transient API errors (429 rate limit, 500/503 server errors)
- **Better error display** — currently errors may not always surface clearly in the UI
- **API key validation** — test the key on save in settings

### Priority 5: Attachments
- **What:** The gateway path handles file/image attachments via `chatOpts.attachments`
- **Need:** Add attachment support to `ChatRequest` and format them per provider (base64 images for OpenAI/Anthropic, inline data for Google)

### Priority 6: Multi-Provider Testing
- Test with Anthropic API key (Claude models)
- Test with OpenAI API key (GPT-4o, etc.)
- Test with OpenRouter
- Test with local Ollama

---

## Build & Test Commands

```bash
# On Mac (development)
cd ~/Desktop/paw
git pull origin main
npm run tauri dev          # First build takes 5-10 min (Rust compilation)

# On Codespaces (code changes)
cd /workspaces/paw
cargo check                # Verify Rust compiles (in src-tauri/)
npx tsc --noEmit           # Verify TypeScript compiles
git add -A && git commit -m "..." && git push

# Logs
# Rust logs appear in the terminal running `npm run tauri dev`
# Frontend logs: Cmd+Option+I → Console tab in the Tauri webview
```

## Key Technical Notes

- **Tauri lib name:** `paw_temp_lib` (set in Cargo.toml)
- **Engine DB path:** `~/.paw/engine.db` (SQLite with WAL mode)
- **Tauri event name:** `engine-event` (all engine events flow through this single channel)
- **Runtime mode storage:** `localStorage.getItem('paw-runtime-mode')` — `'engine'` or `'gateway'`
- **Google Gemini quirk:** Rejects `additionalProperties`, `$schema`, `$ref` in tool schemas — `sanitize_schema()` strips these
- **Session ID prefix:** `eng-` not `paw-` (paw-* gets filtered by background session handler)
- **Existing lib.rs is ~2,660 lines** — all the OpenClaw gateway commands (check_node, install_openclaw, start_gateway, etc.) remain intact for gateway mode
