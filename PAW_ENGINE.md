# Pawz Agent Engine — Implementation Status

> Last updated: 2026-02-16

## What This Is

Pawz is an **AI command center** with a native Rust agent engine embedded in the Tauri backend. It talks directly to AI APIs — no gateway, no middleware, no OpenClaw.

**Architecture:** Frontend → Tauri IPC (`invoke()`) → Rust Engine → AI APIs directly

Zero network hop, zero open ports, zero auth tokens to manage.

---

## Current Status: Phase 6 COMPLETE ✅

### Phase Timeline
- **Phase 1** (2026-02-16): Core engine — providers, streaming, tools, SQLite sessions
- **Phase 2** (2026-02-17): Security (HIL approval), session management, token metering, error handling, attachments
- **Phase 3** (2026-02-18): Soul system (agent personality files), Memory system (long-term semantic memory)
- **Phase 4** (2026-02-18): Web browsing tools (search, read, screenshot, browse), Soul/Memory self-evolution tools
- **Phase 5** (2026-02-16): Skill Vault (37 skills across 9 categories), credential encryption, instruction injection, advanced editing, Pawz rebrand
- **Phase 6** (2026-02-16): Tasks Hub — Kanban board, agent auto-work, cron scheduling, live activity feed

---

## Phase 6 Features

### Tasks Hub — Kanban Board with Agent Auto-Work ✅

Replaces the old Build IDE view with a full Kanban task board. Agents autonomously execute tasks, move them through status columns, and report results.

#### Kanban Board ✅
- **6 columns:** Inbox → Assigned → In Progress → Review → Blocked → Done
- **Drag-and-drop:** HTML5 drag API moves tasks between columns with activity logging
- **Task cards:** Priority dot (urgent/high/medium/low), agent badge, cron indicator, time stamp
- **Task detail modal:** Title, description, priority picker, agent assignment, cron schedule, activity log
- **Stats bar:** Total tasks, active tasks, scheduled (cron) tasks

#### Agent Auto-Work ✅
- **`engine_task_run` command:** Spawns full agent loop for a task in background
  - Creates/reuses dedicated session per task (`task-{id}`)
  - Composes system prompt: base + soul files + skill instructions + task context
  - Stores user message with task title + description
  - Loads full conversation history via `load_conversation()`
  - Runs `agent_loop::run_agent_turn()` asynchronously
  - On completion: moves task → "review", logs `agent_completed` activity
  - On error: moves task → "blocked", logs `agent_error` activity
  - Emits `task-updated` Tauri event for real-time UI updates

#### Cron Scheduling ✅
- **Schedule formats:** `every Xm` (minutes), `every Xh` (hours), `daily HH:MM`
- **`compute_next_run()` helper:** Parses schedule → calculates next UTC datetime
- **`engine_tasks_cron_tick` command:** Finds due tasks, updates timestamps, logs `cron_triggered` activity, returns triggered IDs
- **Frontend timer:** 30-second interval checks for due tasks, auto-runs them via `taskRun()`
- **Per-task toggle:** `cron_enabled` flag so schedules can be paused without deletion

#### Live Activity Feed ✅
- **Feed sidebar:** Real-time activity log alongside the board
- **Activity types:** `created`, `status_change`, `agent_started`, `agent_completed`, `agent_error`, `cron_triggered`, `comment`
- **Color-coded dots:** Green (completed), blue (created/started), orange (cron), red (error)
- **Filter tabs:** All / Tasks / Status — filter activity by type
- **Relative timestamps:** "2m ago", "1h ago", "3d ago"

#### Database Tables ✅
- **`tasks`** (13 columns): id, title, description, status, priority, assigned_agent, session_id, cron_schedule, cron_enabled, last_run_at, next_run_at, created_at, updated_at
- **`task_activity`** (6 columns): id, task_id, kind, agent, content, created_at

---

## Phase 5 Features

### Skill Vault — 37 Skills Across 9 Categories ✅

The skill system has two modes:
- **Vault skills** have dedicated tool functions + encrypted credential storage. The agent calls specific tools like `email_send`, `github_api`, etc.
- **Instruction skills** inject knowledge into the agent's system prompt. The agent uses existing `exec`/`fetch`/`read_file`/`write_file` tools to interact with CLIs and APIs.

#### Skill Categories

| Category | Skills | Type |
|----------|--------|------|
| **Vault** (🔐) | Email, Slack, GitHub, REST API, Webhooks, Discord, Notion, Trello | Credentials + tools/instructions |
| **Communication** (💬) | WhatsApp, iMessage | CLI instruction |
| **Productivity** (📋) | Apple Notes, Apple Reminders, Things 3, Obsidian, Bear Notes | CLI instruction |
| **API** (🔌) | Google Workspace, Google Places | API instruction |
| **Development** (🛠️) | tmux, Session Logs | CLI instruction |
| **Media** (🎬) | Whisper (local), Whisper API, Image Generation (DALL-E), Video Frames (ffmpeg), ElevenLabs TTS, Spotify, GIF Search | Mixed |
| **Smart Home** (🏠) | Philips Hue, Sonos, Eight Sleep, Camera Capture | CLI instruction |
| **CLI** (⌨️) | Weather, Blog Watcher, Summarize | Instruction |
| **System** (🖥️) | 1Password, Peekaboo (macOS UI), Security Audit | CLI instruction |

#### Credential Injection ✅
When a skill has stored credentials and is enabled, `get_enabled_skill_instructions()` decrypts the credentials and appends them to the instruction text:
```
Credentials (use these values directly — do NOT ask the user for them):
- DISCORD_BOT_TOKEN = MTIz...
- DISCORD_DEFAULT_CHANNEL = 1234567890
```
This means instruction-based skills with credentials (Discord, Notion, Trello, etc.) actually work — the agent gets the real token values in its system prompt and uses `fetch` to call the APIs.

#### Custom Instruction Editing (Advanced) ✅
- **SQLite table:** `skill_custom_instructions(skill_id TEXT PRIMARY KEY, instructions TEXT, updated_at TEXT)`
- Users can edit any skill's agent instructions via the Advanced section in the Skills UI
- Custom instructions override defaults. "Reset to Default" clears the custom version.
- **Tauri commands:** `engine_skill_get_instructions`, `engine_skill_set_instructions`

#### Encrypted Credential Vault ✅
- **XOR encryption** with 32-byte random key stored in **OS keychain** (`keyring` crate v3, service: `paw-skill-vault`)
- Credentials stored as base64-encoded encrypted blobs in SQLite `skill_credentials` table
- Never logged or exposed to frontend — only decrypted at tool execution time or for instruction injection
- Per-skill revoke-all support

#### Binary & Environment Detection ✅
- `get_all_skill_status()` checks `which <binary>` for each required binary
- Missing binaries shown with install hints (e.g., `brew install tmux`)
- Missing env vars checked via `std::env::var()`
- Skill is "Ready" only when: enabled + all required credentials set + all binaries on PATH + all env vars present

#### Skills UI ✅ (`settings-skills.ts`)
- **Category grouping** with filter tabs (All, Enabled, per-category)
- **Summary bar**: total skills, ready count, enabled count
- **Skill cards**: icon, name, status badge (🟢 Ready / 🔴 Missing binary / 🟡 Missing creds / ⚫ Disabled), enable/disable toggle
- **Badges**: 📖 Instruction, 🔧 Tools, 🔑 Vault
- **Binary/env status**: warning boxes with install commands
- **Credential inputs**: password-masked fields with Set/Update/Delete per key
- **Advanced section**: expandable editor for agent instructions, save/reset to default

### Pawz Rebrand ✅
- All OpenClaw references removed
- Welcome page: "Welcome to Pawz — Your AI command center — Pawz are safer than Claws"
- Always engine mode (no gateway toggle)
- Settings cleaned of gateway sections
- Skills moved from settings to sidebar view

---

## Phase 4 Features

### Web Browsing Tools ✅ (`web.rs`, 538 LOC)
- **`web_search`** — DuckDuckGo HTML scraping (no API key). Returns title, URL, snippet for each result.
- **`web_read`** — Fetch URL + extract readable text via `scraper` crate. Supports CSS selectors for targeted extraction. Auto-detects `<article>`, `<main>`, `<body>`.
- **`web_screenshot`** — Headless Chrome screenshot via `headless_chrome` crate. Saves PNG to temp dir, also extracts visible text.
- **`web_browse`** — Full interactive headless browser with persistent session. Actions: navigate, click, type, press, extract, javascript, scroll, links, info. Lazy `OnceLock` singleton for Chrome instance.

### Soul & Memory Self-Evolution Tools ✅
- **`soul_read`** / **`soul_write`** / **`soul_list`** — Agent can read/write its own personality files (IDENTITY.md, SOUL.md, USER.md, AGENTS.md, TOOLS.md)
- **`memory_store`** / **`memory_search`** — Agent can store and search its own long-term memories

---

## Phase 3 Features

### Soul System — Agent Personality Files ✅
- **SQLite table:** `agent_files(agent_id TEXT, file_name TEXT, content TEXT, updated_at TEXT)`
- **5 standard files:** IDENTITY.md, SOUL.md, USER.md, AGENTS.md, TOOLS.md per agent
- **System prompt composition:** `compose_agent_context()` loads files in order, joins with `\n\n---\n\n`, prepended to system prompt
- **Tauri commands:** `engine_agent_file_list`, `engine_agent_file_get`, `engine_agent_file_set`, `engine_agent_file_delete`
- **Frontend Foundry:** Agent cards, file editor, all wired to engine IPC

### Memory System — Long-Term Semantic Memory ✅
- **SQLite table:** `memories(id TEXT PRIMARY KEY, content TEXT, category TEXT, importance INTEGER, embedding BLOB, created_at TEXT)`
- **Ollama embeddings:** `EmbeddingClient` calls local Ollama at `http://localhost:11434/api/embeddings` with `nomic-embed-text` (768 dims). Falls back to OpenAI-compatible format.
- **Vector search:** Cosine similarity in pure Rust over SQLite BLOBs
- **Keyword fallback:** SQL LIKE search when embeddings unavailable
- **Auto-recall:** Before each turn, searches memory for relevant context → injects as `## Relevant Memories`
- **Auto-capture:** After each turn, heuristic pattern matching extracts memorable facts
- **Memory config:** `MemoryConfig` with `embedding_url`, `embedding_model`, `embedding_dims`, `auto_recall`, `auto_capture`, `recall_limit`, `recall_threshold`
- **Tauri commands:** `engine_memory_store`, `engine_memory_search`, `engine_memory_stats`, `engine_memory_delete`, `engine_memory_list`, `engine_get_memory_config`, `engine_set_memory_config`, `engine_test_embedding`

---

## Phase 2 Features

### P1: Human-in-the-Loop (HIL) Tool Approval ✅
- `PendingApprovals` map with `tokio::sync::oneshot` channels. Agent emits `ToolRequest` and pauses until frontend resolves via `engine_approve_tool`.
- Frontend security pipeline: risk classification, allowlist/denylist, auto-deny privilege escalation, read-only project mode, session overrides.

### P2: Session Management ✅
- `loadSessions()`, `loadChatHistory()`, session rename/delete all route to engine in engine mode

### P3: Token Metering ✅
- `TokenUsage` parsed per provider: OpenAI (`stream_options.include_usage`), Anthropic (`message_start`/`message_delta`), Google (`usageMetadata`)
- Accumulated across agent loop turns, forwarded in `Complete` event

### P4: Error Handling & Retry ✅
- Exponential backoff: 3 retries, delays 1s→2s→4s. Retryable: 429, 500, 502, 503, 529. Non-retryable fail immediately.

### P5: Attachment Support ✅
- OpenAI format: `image_url` content blocks with `data:{mime};base64,{content}` URIs

---

## Phase 1 Features (Baseline)
- **6 AI providers:** Anthropic, OpenAI, Google Gemini, OpenRouter, Ollama, Custom
- **SSE streaming** to chat UI
- **13 built-in tools:** exec, fetch, read_file, write_file, soul_read, soul_write, soul_list, memory_store, memory_search, web_search, web_read, web_screenshot, web_browse
- **7 vault skill tools:** email_send, email_read, slack_send, slack_read, github_api, rest_api_call, webhook_send
- **SQLite sessions** in `~/.paw/engine.db` (WAL mode)

---

## File Map

### Rust Backend (`src-tauri/src/engine/`)

| File | LOC | Purpose |
|------|-----|---------|
| `mod.rs` | 13 | Module declarations (commands, types, providers, agent_loop, tool_executor, sessions, memory, skills, web) |
| `types.rs` | 891 | All data types + **22 tool definitions** (13 builtins in `builtins()` + 7 skill tools in `skill_tools()` + 2 factory methods). Message, Role, ToolCall, ToolDefinition, EngineEvent, Session, ChatRequest, EngineConfig, ProviderConfig, TokenUsage, ChatAttachment, Task, TaskActivity, etc. |
| `providers.rs` | 860 | AI provider HTTP clients. `OpenAiProvider`, `AnthropicProvider`, `GoogleProvider`, `AnyProvider`. SSE streaming, exponential retry, token usage parsing, attachment formatting |
| `agent_loop.rs` | 258 | Core agentic loop: call model → accumulate → tool calls → HIL approval → execute → loop. Token usage accumulation |
| `tool_executor.rs` | 753 | All tool handlers: exec (sh -c), fetch (reqwest), read_file, write_file, soul_read/write/list, memory_store/search, web_search/read/screenshot/browse, + 7 skill tool handlers (email SMTP/IMAP, Slack API, GitHub API, REST, webhook) |
| `sessions.rs` | 870 | SQLite storage: sessions, messages, engine_config, agent_files, memories, tasks, task_activity tables. `compose_agent_context()`. Memory CRUD + vector search (cosine similarity) + keyword fallback. Full tasks CRUD + activity logging + cron helpers |
| `skills.rs` | 1072 | **37 skill definitions** across 9 categories. `SkillCategory` enum, `SkillDefinition`/`SkillStatus` structs. Encrypted credential vault (keyring + XOR + base64). Binary/env detection. `get_enabled_skill_instructions()` with credential injection + custom instruction support. DB methods for skill_credentials, skill_state, skill_custom_instructions tables |
| `web.rs` | 538 | Web tools: DuckDuckGo search (HTML scraping), URL reader (scraper crate), headless Chrome screenshots, interactive browser (persistent OnceLock session) |
| `memory.rs` | 245 | `EmbeddingClient` (Ollama + OpenAI-compatible). `store_memory()`, `search_memories()`, `extract_memorable_facts()` (heuristic auto-capture) |
| `commands.rs` | 1101 | **39 Tauri commands** + `EngineState` struct with `PendingApprovals`, `MemoryConfig`. System prompt composition (base + agent context + memory + skill instructions). Auto-recall/capture. Task auto-work + cron scheduling |

### TypeScript Frontend (`src/`)

| File | LOC | Purpose |
|------|-----|---------|
| `engine.ts` | 430 | `PawEngineClient` class — 40 methods wrapping `invoke()` for all 39 commands + event listener. Skills, memory, agent files, sessions, config, chat, tasks |
| `engine-bridge.ts` | 223 | Engine → gateway-style event translation. HIL approval handlers. Attachment passthrough. Usage forwarding |
| `views/tasks.ts` | 477 | Tasks Hub: Kanban board, drag-and-drop, live activity feed, task modal, cron timer, agent auto-work |
| `views/settings-skills.ts` | 414 | Skills UI: category tabs, filter, skill cards, credential inputs, binary/env status, Advanced instruction editor, save/reset |
| `views/settings-engine.ts` | 125 | Engine settings: provider, model, API key, base URL |

### Modified Files

| File | Changes |
|------|---------|
| `src-tauri/Cargo.toml` | reqwest, tokio, tokio-stream, futures, uuid, rusqlite, headless_chrome, scraper, url, keyring, rand, base64, chrono, dirs, ed25519-dalek, sha2 |
| `src-tauri/src/lib.rs` | `pub mod engine;`, `EngineState` init, `.manage(engine_state)`, **39 engine commands** registered |
| `src/main.ts` | Engine-bridge imports, dual-mode send/sessions/history, HIL approval handler, attachment handling, Tasks module wiring (bind events, cron timer, task-updated listener) |
| `src/views/foundry.ts` | Agent file editor wired to `pawEngine` |
| `src/views/memory-palace.ts` | All memory views wired to `pawEngine` |
| `index.html` | Pawz branding, Skills view in sidebar, engine settings panel |

---

## Architecture Details

### System Prompt Composition
The full system prompt is assembled from 4 sources (in order, joined by `\n\n---\n\n`):
1. **Base prompt** — user's system prompt or default from `EngineConfig`
2. **Agent context** — Soul files (IDENTITY.md, SOUL.md, USER.md, AGENTS.md, TOOLS.md)
3. **Memory context** — Auto-recalled relevant memories (`## Relevant Memories`)
4. **Skill instructions** — All enabled skills' instructions with credential injection (`# Enabled Skills`)

### Event Flow (Engine Mode)
```
User types message
  → main.ts sendMessage()
    → engineChatSend() [engine-bridge.ts]
      → pawEngine.chatSend() [engine.ts]
        → invoke('engine_chat_send') [Tauri IPC]
          → Rust engine_chat_send [commands.rs]
            → compose system prompt (base + soul + memory + skills)
            → spawns async agent_loop::run_agent_turn
              → provider.chat_stream() [SSE to AI API]
              → emits engine-event (Delta/ToolRequest/ToolResult/Complete/Error)
              → on ToolRequest: PAUSES on oneshot channel
            → stores messages in SQLite

  engine-event Tauri events
    → PawEngineClient listener [engine.ts]
      → translateEngineEvent() [engine-bridge.ts]
        → handleAgentEvent() [main.ts] — chat UI updates
      → onEngineToolApproval handler [main.ts]
        → security classification → approval modal / auto-approve
        → resolveEngineToolApproval() → oneshot channel resolves
          → agent_loop resumes
```

### Session ID Conventions
- `eng-{uuid}` — Engine chat sessions (MUST NOT start with `paw-`)
- `paw-research-*`, `paw-build-*`, `paw-*` — Background sessions (filtered in main chat)

### Provider Resolution
From model name prefix: `claude*`→Anthropic, `gemini*`→Google, `gpt*`/`o1*`/`o3*`→OpenAI. Fallback→default→first configured.

### Database Schema (10 tables in `~/.paw/engine.db`)
| Table | Purpose |
|-------|---------|
| `sessions` | Session metadata (id, model, system_prompt, timestamps) |
| `messages` | Conversation messages (role, content, tool_calls, tool_results) |
| `engine_config` | Serialized EngineConfig JSON |
| `agent_files` | Soul/personality files per agent |
| `memories` | Long-term memories with embeddings |
| `skill_credentials` | Encrypted credential key-value pairs per skill |
| `skill_state` | Enabled/disabled state per skill |
| `skill_custom_instructions` | User-edited skill instructions |
| `tasks` | Kanban tasks (title, description, status, priority, agent, cron schedule, timestamps) |
| `task_activity` | Activity log entries per task (kind, agent, content, timestamp) |

### 39 Tauri Commands
**Chat:** `engine_chat_send`, `engine_chat_history`
**Sessions:** `engine_sessions_list`, `engine_session_rename`, `engine_session_delete`, `engine_session_clear`
**Config:** `engine_get_config`, `engine_set_config`, `engine_upsert_provider`, `engine_remove_provider`, `engine_status`
**Approval:** `engine_approve_tool`
**Agent Files:** `engine_agent_file_list`, `engine_agent_file_get`, `engine_agent_file_set`, `engine_agent_file_delete`
**Memory:** `engine_memory_store`, `engine_memory_search`, `engine_memory_stats`, `engine_memory_delete`, `engine_memory_list`, `engine_get_memory_config`, `engine_set_memory_config`, `engine_test_embedding`
**Skills:** `engine_skills_list`, `engine_skill_set_enabled`, `engine_skill_set_credential`, `engine_skill_delete_credential`, `engine_skill_revoke_all`, `engine_skill_get_instructions`, `engine_skill_set_instructions`
**Tasks:** `engine_tasks_list`, `engine_task_create`, `engine_task_update`, `engine_task_delete`, `engine_task_move`, `engine_task_activity`, `engine_task_run`, `engine_tasks_cron_tick`

---

## What's Needed Next

### Priority 1: Multi-Provider Testing
- Test with Anthropic, OpenAI, OpenRouter, Ollama API keys
- Verify HIL, metering, memory flow per provider

### Priority 2: Attachment Support — Additional Providers
- Anthropic: `type: "image"` content blocks
- Google: `inlineData: { mimeType, data }` parts

### Priority 3: API Key Validation
- Test API key on save in settings (lightweight test call)
- Show success/error feedback

### Priority 4: Extended Error Surfacing
- Ensure all error states display clearly in chat UI

---

## Build & Test Commands

```bash
# On Mac (development)
cd ~/Desktop/paw
git pull origin main
npm run tauri dev          # First build takes 5-10 min

# On Codespaces (code changes)
cd /workspaces/paw
cargo check --manifest-path src-tauri/Cargo.toml  # Rust
npx tsc --noEmit                                   # TypeScript
git add -A && git commit -m "..." && git push

# Logs: Rust → terminal. Frontend → Cmd+Option+I → Console
```

## Key Technical Notes

- **Tauri lib name:** `paw_temp_lib` (Cargo.toml)
- **Engine DB:** `~/.paw/engine.db` (SQLite WAL, 10 tables)
- **Event channel:** `engine-event` (single Tauri event for all engine events)
- **Session prefix:** `eng-` (not `paw-`, which gets filtered)
- **Google quirk:** Rejects `additionalProperties`/`$schema`/`$ref` — `sanitize_schema()` strips these
- **Vault encryption:** XOR with 32-byte random key in OS keychain (`paw-skill-vault` service)
- **Web browsing:** headless_chrome v1 with OnceLock singleton browser instance
- **Total engine Rust LOC:** ~5,768 across 9 files
- **Total engine TS LOC:** ~1,648 across 5 files
