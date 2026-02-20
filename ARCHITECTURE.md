# Architecture

> Pawz is a Tauri v2 native desktop app — Rust backend, TypeScript frontend, IPC bridge.  
> ~50k LOC total (21k Rust + 20k TypeScript + 9k CSS)

---

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Pawz Desktop App                                           │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Frontend (TypeScript, vanilla DOM)                   │  │
│  │  • 20+ views (agents, tasks, mail, research, etc.)    │  │
│  │  • 7 feature modules (atomic design pattern)          │  │
│  │  • Material Symbols icon library                      │  │
│  └──────────────────┬────────────────────────────────────┘  │
│                     │ Tauri IPC (70+ structured commands)    │
│  ┌──────────────────▼────────────────────────────────────┐  │
│  │  Rust Backend Engine                                  │  │
│  │  • Agent loop with SSE streaming                      │  │
│  │  • Tool executor with human-in-the-loop approval      │  │
│  │  • 10 channel bridges                                 │  │
│  │  • 3 native AI providers (+ 7 via model routing)      │  │
│  │  • SQLite persistence + OS keychain                   │  │
│  │  • Docker container sandbox (bollard crate)           │  │
│  └──────────────────┬────────────────────────────────────┘  │
│                     │                                       │
│                     ▼                                       │
│               Operating System                              │
└─────────────────────────────────────────────────────────────┘
```

No Node.js backend, no gateway process, no open network ports. Every operation flows through Tauri IPC commands between the frontend and the Rust engine.

---

## Directory Structure

```
src/                          # TypeScript frontend
├── main.ts                   # App bootstrap, event listeners, IPC bridge
├── engine.ts                 # Engine bridge (state, config, IPC helpers)
├── engine-bridge.ts          # Tauri event/command wrappers
├── security.ts               # Command risk classifier, injection scanner
├── types.ts                  # Shared TypeScript types
├── styles.css                # All application styles
├── db.ts                     # SQLite helpers (Web SQL via Tauri plugin)
├── workspace.ts              # Workspace management
├── views/                    # UI views (one file per page)
│   ├── agents.ts             # Agent CRUD, avatars, mini-chat, dock
│   ├── mail.ts               # Email client (IMAP/SMTP)
│   ├── projects.ts           # Project workspaces
│   ├── memory-palace.ts      # Memory visualization
│   ├── skills.ts             # Skill vault
│   ├── research.ts           # Research workflow
│   ├── tasks.ts              # Kanban board
│   ├── trading.ts            # Crypto trading dashboard
│   ├── orchestrator.ts       # Multi-agent orchestration
│   ├── settings*.ts          # Settings tabs (10 files)
│   └── ...
├── features/                 # Feature modules (atomic design)
│   ├── slash-commands/       # 20 commands with autocomplete
│   ├── container-sandbox/    # Docker sandbox config
│   ├── prompt-injection/     # Injection detection (30+ patterns)
│   ├── memory-intelligence/  # Smart memory operations
│   ├── agent-policies/       # Per-agent tool policies
│   ├── channel-routing/      # Rule-based channel routing
│   ├── session-compaction/   # AI summarization
│   └── browser-sandbox/      # Browser profiles, screenshots, network policy
├── components/               # Shared UI components
│   ├── helpers.ts            # DOM helpers, escaping, formatting
│   └── toast.ts              # Toast notifications
└── assets/
    ├── avatars/              # 50 Pawz Boi PNGs (96×96)
    └── fonts/                # Material Symbols woff2

src-tauri/                    # Rust backend
├── src/
│   ├── main.rs               # Tauri app entry point
│   ├── lib.rs                # Command registration, plugin setup
│   └── engine/               # Core engine modules
│       ├── mod.rs            # Module exports
│       ├── agent_loop.rs     # Main agent conversation loop
│       ├── commands.rs       # 70+ Tauri IPC commands
│       ├── tool_executor.rs  # Tool execution with HIL approval
│       ├── providers.rs      # AI provider abstraction (OpenAI, Anthropic, Google)
│       ├── sessions.rs       # Session management (SQLite)
│       ├── memory.rs         # Semantic memory (embeddings, BM25, vector search)
│       ├── skills.rs         # Skill vault (37+ skills, credential injection)
│       ├── orchestrator.rs   # Boss/worker multi-agent orchestration
│       ├── compaction.rs     # Session compaction (context summarization)
│       ├── sandbox.rs        # Docker container sandboxing
│       ├── routing.rs        # Channel routing rules
│       ├── injection.rs      # Prompt injection detection (Rust side)
│       ├── types.rs          # Shared Rust types
│       ├── channels.rs       # Shared channel bridge logic
│       ├── telegram.rs       # Telegram bridge
│       ├── discord.rs        # Discord bridge
│       ├── slack.rs          # Slack bridge
│       ├── matrix.rs         # Matrix bridge
│       ├── irc.rs            # IRC bridge
│       ├── mattermost.rs     # Mattermost bridge
│       ├── nextcloud.rs      # Nextcloud Talk bridge
│       ├── nostr.rs          # Nostr bridge
│       ├── twitch.rs         # Twitch bridge
│       ├── webchat.rs        # WebChat bridge
│       ├── web.rs            # Browser automation (headless Chrome)
│       └── dex.rs / sol_dex.rs  # Trading (Coinbase CDP)
├── Cargo.toml                # Rust dependencies
├── tauri.conf.json           # Tauri config (CSP, bundle, permissions)
└── capabilities/
    └── default.json          # Filesystem scope, shell permissions
```

---

## Rust Backend

### Agent Loop (`agent_loop.rs`)

The core conversation loop:
1. Receives user message
2. Injects auto-recalled memories into context
3. Sends to configured AI provider via SSE streaming
4. Parses tool calls from response
5. Routes each tool call through the tool executor (with HIL approval)
6. Loops back with tool results until the agent is done

### Tool Executor (`tool_executor.rs`)

Every tool call flows through the executor:
1. Classify risk level (critical/high/medium/low/safe)
2. Check allowlist/denylist patterns
3. If approval needed → emit `ToolRequest` event to frontend
4. Frontend shows approval modal → user decides
5. `engine_approve_tool` resolves the pending approval (oneshot channel)
6. Execute or deny the tool

Tool categories: `exec`, `web_search`, `web_fetch`, `file_read`, `file_write`, `memory`, `agent`, `trading`.

### AI Providers (`providers.rs`)

Three native provider implementations with SSE streaming:
- **OpenAI** — Chat completions API, function calling, multimodal
- **Anthropic** — Messages API, tool use, thinking blocks
- **Google Gemini** — GenerateContent API, function declarations, thought handling

Additional providers are handled via model-prefix routing to OpenAI-compatible endpoints (DeepSeek, xAI, Mistral, Moonshot, Azure).

### Channel Bridges

Each of the 10 bridges follows a uniform pattern:
- `start_*` / `stop_*` — spawn/kill the bridge task
- `get_*_config` / `set_*_config` — read/write bridge configuration
- `*_status` — check if bridge is running
- `approve_user` / `deny_user` / `remove_user` — user access control
- Messages received → routed to the configured agent → response sent back

### Memory (`memory.rs`)

Hybrid retrieval system:
1. **BM25 full-text search** — SQLite FTS5 virtual table
2. **Vector similarity** — Cosine similarity on Ollama-generated embeddings
3. **Weighted merge** — Combine BM25 and vector scores
4. **MMR re-ranking** — Jaccard-based diversity (lambda=0.7)
5. **Temporal decay** — Exponential decay with 30-day half-life

Auto-recall injects relevant memories into agent context. Auto-capture extracts key facts from conversations.

---

## TypeScript Frontend

### Views

Each view is a standalone TypeScript module that renders into its corresponding HTML container. Views manage their own state and DOM manipulation. No framework — pure `document.getElementById` / `innerHTML`.

### Feature Modules (Atomic Design)

Feature modules follow atoms → molecules → index pattern:
- **Atoms** — Pure functions, constants, type definitions. Zero side effects.
- **Molecules** — Functions that compose atoms and call Tauri IPC. May have side effects.
- **Index** — Barrel exports for the module.

### IPC Bridge

The frontend communicates with the Rust backend exclusively through Tauri's `invoke()` function. The `engine-bridge.ts` module wraps all IPC calls with TypeScript types.

Event-driven updates use Tauri's event system — the backend emits events (e.g., `engine-event` for streaming tokens, `agent-profile-updated` for real-time agent changes) and the frontend subscribes.

---

## Database

SQLite via Tauri's SQL plugin. Tables:

| Table | Purpose |
|-------|---------|
| `agent_modes` | Agent mode presets |
| `projects` | Build/Research/Create projects |
| `project_files` | Files within projects |
| `project_agents` | Backend-created agents (orchestrator) |
| `automation_runs` | Cron execution log |
| `research_findings` | Research discoveries |
| `content_documents` | Content creation docs |
| `email_accounts` | IMAP/SMTP config |
| `emails` | Messages + AI drafts |
| `credential_activity_log` | Credential access audit trail |
| `security_audit_log` | Security event log |
| `security_rules` | User-defined allow/deny patterns |

All sensitive fields are encrypted with AES-256-GCM. The encryption key is stored in the OS keychain.
