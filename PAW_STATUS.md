# Paw — Full Architecture, Status & Wiring Plan

> Last updated: 2026-02-14  
> Cross-referenced against: [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) main branch

---

## What Paw Is

Paw is a **Tauri desktop app** (Rust + TypeScript + Vite) that wraps the [OpenClaw](https://github.com/openclaw/openclaw) AI agent gateway. It gives non-technical users a visual interface to run AI agents — no terminal, no config files, no localhost ports.

**Target user**: Someone who wants AI agents but will never open a terminal.

**Business model**: One-time purchase (bring your own API keys) + optional subscription (managed keys).

### What OpenClaw Is (upstream)

OpenClaw is a local-first personal AI assistant framework with:
- **Multi-channel inbox**: WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, BlueBubbles (iMessage), iMessage (legacy), Microsoft Teams, Matrix, Zalo, WebChat, macOS, iOS/Android
- **Multi-agent routing**: isolated sessions per agent, workspace, or sender
- **Voice Wake + Talk Mode**: always-on speech with ElevenLabs (macOS/iOS/Android)
- **TTS**: ElevenLabs, OpenAI, Edge text-to-speech on all channels
- **Browser control**: CDP-managed Chrome/Chromium automation
- **Canvas + A2UI**: agent-driven visual workspace
- **Nodes**: iOS/Android nodes with camera, screen, location, voice capabilities
- **Device pairing**: secure pairing flow for mobile nodes
- **Exec approvals**: human-in-the-loop tool approval system
- **Webhooks**: external trigger endpoints (`/hooks/wake`, `/hooks/agent`)
- **OpenAI HTTP API**: Chat Completions endpoint
- **OpenResponses HTTP API**: `/v1/responses` endpoint
- **Plugin system**: channel extensions, voice-call (Twilio/Telnyx/Plivo), talk-voice, etc.
- **Chrome extension**: browser relay for CDP control
- **Tailscale exposure**: Serve/Funnel for remote access
- **Onboarding wizard**: guided setup flow via gateway

**Paw needs to surface ALL of this through a GUI.**

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                    Paw Desktop                        │
│  ┌─────────────────┐  ┌──────────────────────────┐   │
│  │  Rust Backend    │  │  Web Frontend (Vite)     │   │
│  │  src-tauri/      │  │  src/main.ts (3,379 LOC) │   │
│  │  lib.rs (1,622)  │  │  styles.css  (3,292 LOC) │   │
│  │                  │  │  index.html  (1,346 LOC) │   │
│  │  Tauri Commands: │  │  gateway.ts  (585 LOC)   │   │
│  │  - install       │  │  types.ts    (432 LOC)   │   │
│  │  - start/stop gw │  │  api.ts      (41 LOC)    │   │
│  │  - config R/W    │  │  db.ts       (269 LOC)   │   │
│  │  - memory CLI    │  │                          │   │
│  │  - health check  │  │  Total: ~6,000 LOC       │   │
│  └───────┬──────────┘  └──────────┬───────────────┘   │
│          │    Tauri IPC (invoke)  │                    │
│          └────────────────────────┘                    │
│                       │                                │
│              WebSocket (ws://127.0.0.1:18789)          │
│                       ▼                                │
│         ┌──────────────────────────┐                   │
│         │   OpenClaw Gateway       │                   │
│         │   (Node.js process)      │                   │
│         │   Protocol v3 WS API     │                   │
│         └──────────────────────────┘                   │
└──────────────────────────────────────────────────────┘
```

### Communication Flow

1. **Tauri IPC** (`invoke`): Frontend → Rust backend for OS-level operations (install, start/stop gateway, file I/O, config editing, `openclaw ltm` CLI commands)
2. **WebSocket** (protocol v3): Frontend → OpenClaw gateway for all runtime operations (chat, sessions, agents, channels, cron, skills, models, config, agent files)
3. **Local SQLite** (`@tauri-apps/plugin-sql`): Frontend-only persistent storage for agent modes, projects, content documents, research findings, email accounts

---

## Feature-by-Feature Status

### Legend
- ✅ **WIRED** — Connected to gateway, functional when gateway is running
- 🔶 **PARTIAL** — UI exists, some logic works, but key paths are broken or incomplete
- 🔴 **SHELL ONLY** — UI exists in HTML/CSS but has no working backend logic
- ⚪ **NOT BUILT** — Mentioned in plans but no code exists

---

### 1. Onboarding & Setup ✅ WIRED
| Component | Status | Details |
|-----------|--------|---------|
| Detect existing OpenClaw | ✅ | `check_openclaw_installed` — checks `~/.openclaw/openclaw.json` exists |
| Auto-read token/port | ✅ | `get_gateway_token`, `get_gateway_port_setting` — reads from config |
| Manual gateway config | ✅ | Form → saves to localStorage → connects WebSocket |
| Install OpenClaw | 🔶 | `install_openclaw` command exists. Downloads Node.js bundle, runs `npm install openclaw`. **Blocker**: Requires bundled `resources/node/node-{os}-{arch}.tar.gz` which is NOT in the repo — install will fail without it |
| Auto-start gateway | ✅ | `start_gateway` → runs `openclaw gateway install` + `openclaw gateway start` |
| Auto-stop gateway | ✅ | `stop_gateway` → runs `openclaw gateway stop` with fallback to `pkill` |
| Config repair | ✅ | `repair_openclaw_config` — removes stale keys added by earlier versions |
| Reconnect logic | ✅ | Exponential backoff (3s→60s), max 20 attempts, 15s health poll |

**What's missing**:
- No bundled Node.js tarballs in `resources/node/` — first-time install will fail
- No progress UI for "starting gateway" (only for installation)
- No error recovery if gateway crashes after connection

---

### 2. Chat ✅ WIRED
| Component | Status | Details |
|-----------|--------|---------|
| Session list | ✅ | `sessions.list` → dropdown select. Filters out internal `paw-*` sessions |
| Load history | ✅ | `chat.history` → renders messages with timestamps |
| Send message | ✅ | `chat.send` → streaming via `agent` events (deltas) + `chat` final event |
| Streaming bubbles | ✅ | Live delta appending, auto-scroll, 120s timeout |
| New chat | ✅ | Clears messages and session key |
| Tool call badges | ✅ | Shows "N tool calls" badge on messages |
| Agent name display | ✅ | Fetches from `agents.list` on connect |
| Abort | 🔴 | No abort button in the Chat UI (exists in Research though) |

**What's missing**:
- No session delete/rename from Chat UI
- No session search
- No markdown rendering in chat messages (plain text only)
- No image/file attachment support
- No thinking level selector per message
- No agent mode selection integration (modes exist in DB but aren't sent with messages)
- No session title shown — just a dropdown of keys/labels

---

### 3. Build (IDE) 🔶 PARTIAL
| Component | Status | Details |
|-----------|--------|---------|
| Create project | ✅ | Creates project in SQLite with `space: 'build'` |
| File explorer | 🔶 | Shows in-memory file list, but NOT connected to `project_files` DB table |
| Code editor | 🔶 | Plain `<textarea>` — no syntax highlighting, no Monaco |
| Tab system | ✅ | Open/close/switch tabs for in-memory files |
| Build chat | 🔶 | Sends to gateway with file context, but response goes to "check Chat view" — **NOT streamed back into Build** |
| Run/deploy | 🔴 | No run, build, or deploy functionality |
| Git integration | 🔴 | No git operations despite "Code" view existing |

**What's critically missing**:
- Files are **only in memory** — not saved to SQLite `project_files` table (no persistence)
- Build chat responses are NOT routed back to the Build view — they say "check Chat view"
- No syntax highlighting (should add CodeMirror or Monaco)
- No file save/load from gateway agent workspace
- No terminal/console output panel
- The "Code" view (`code-view`) is a completely **empty shell** — zero functionality

---

### 4. Create (Content Studio) ✅ WIRED
| Component | Status | Details |
|-----------|--------|---------|
| Document CRUD | ✅ | Create, open, save, delete via SQLite `content_documents` table |
| Document list sidebar | ✅ | Shows documents with word count and date |
| Text editor | ✅ | Plain `<textarea>` with auto word count |
| Content type select | ✅ | markdown/html/plaintext selector |
| AI Improve | 🔶 | Sends to gateway but says "check Chat for response" — **does NOT stream result back into editor** |
| Delete document | ✅ | With confirmation |

**What's missing**:
- AI Improve result doesn't come back to the editor — broken UX
- No markdown preview/rendering
- No export (PDF, HTML, etc.)
- No AI generate from scratch
- No rich text formatting toolbar

---

### 5. Mail 🔴 SHELL ONLY
| Component | Status | Details |
|-----------|--------|---------|
| Email account setup | 🔴 | DB table `email_accounts` exists but NO UI to add accounts, NO IMAP/SMTP logic |
| Inbox | 🔴 | DB table `emails` exists but nothing reads from IMAP |
| Send email | 🔴 | No SMTP sending logic |
| AI draft | 🔴 | DB column `agent_draft` exists but no drafting logic |
| Approval guardrails | 🔴 | `agent_draft_status` column exists but nothing uses it |

**What's critically missing**:
- **EVERYTHING**. Tables exist in SQLite, the view HTML shows "No email accounts configured", but there is zero backend logic for mail. No IMAP connection, no SMTP, no email parsing, no AI integration.
- This needs: IMAP/SMTP Rust commands (Tauri), or gateway-side email integration, or a third-party email API
- The "New" badge in the sidebar is misleading

---

### 6. Automate (Cron/Scheduled Tasks) ✅ WIRED
| Component | Status | Details |
|-----------|--------|---------|
| List jobs | ✅ | `cron.list` → renders active/paused/history board |
| Create job | ✅ | Modal with label, cron schedule, prompt. `cron.add` |
| Toggle enable/disable | ✅ | `cron.update` with `enabled` toggle |
| Run now | ✅ | `cron.run` triggers immediate execution |
| Delete job | ✅ | `cron.remove` with confirmation |
| Run history | ✅ | `cron.runs` shows last 10 runs with status |
| Schedule presets | ✅ | Dropdown with common cron patterns |
| Dashboard widget | ✅ | Shows up to 8 jobs on dashboard |
| Space-contextual cron | ✅ | Filters jobs by keyword per space (build/content/mail/research) |

**Working well.** Minor improvements:
- No cron expression validation
- No visual cron builder (text-only)
- No job edit (only create/delete/toggle)

---

### 7. Channels ✅ WIRED
| Component | Status | Details |
|-----------|--------|---------|
| List channels | ✅ | `channels.status` with probe → renders cards |
| Show status | ✅ | Connected/Disconnected/Not configured with visual indicators |
| Login flow | ✅ | `web.login.start` + `web.login.wait` (120s timeout) |
| Logout | ✅ | `channels.logout` with confirmation |
| Refresh | ✅ | Per-channel and global refresh |
| Account display | ✅ | Shows linked accounts per channel |

**Working well.** Depends on gateway having channels configured in `openclaw.json`.

---

### 8. Research ✅ WIRED
| Component | Status | Details |
|-----------|--------|---------|
| Create project | ✅ | SQLite `projects` table with `space: 'research'` |
| Project sidebar | ✅ | Lists projects with active selection |
| Research input | ✅ | Text input → sends to gateway via `chat.send` with research prompt |
| Live streaming | ✅ | Agent events routed to research live output area (filtered by `paw-research-*` session) |
| Save findings | ✅ | Auto-saves to `content_documents` with `content_type: 'research-finding'` |
| View findings | ✅ | Finding cards with markdown-ish rendering, timestamps, delete button |
| Generate report | ✅ | Compiles all findings → sends to agent → renders synthesized report |
| Abort research | ✅ | `chat.abort` on the research session |
| Delete project | ✅ | Cascading delete of project + all findings |

**Working well.** Improvements needed:
- No way to edit findings after save
- No export report to file
- Report lives in memory only (not saved to DB)
- Web browsing capabilities depend on agent having the right skills (brave_search, fetch, etc.)

---

### 9. Memory ✅ WIRED (Complex)
| Component | Status | Details |
|-----------|--------|---------|
| Agent files list | ✅ | `agents.files.list` → shows files with size |
| Agent file view/edit | ✅ | `agents.files.get`/`agents.files.set` with save |
| LanceDB setup | ✅ | `enable_memory_plugin` writes to `openclaw.json`, tests embedding connection, restarts gateway |
| Azure OpenAI routing | ✅ | Full Azure support: source patches, runtime shim (`NODE_OPTIONS --require`), env var injection |
| Provider selection | ✅ | OpenAI / Azure dropdown with provider-specific fields |
| Connection testing | ✅ | `test_embedding_connection` sends real embedding request via curl |
| Recall (semantic search) | ✅ | `memory_search` → `openclaw ltm search` CLI |
| Remember (store memory) | 🔶 | Uses `chat.send` to ask agent to call `memory_store` — **indirect and unreliable** |
| Knowledge graph viz | 🔶 | Canvas bubble chart grouped by category — but data is just memory search results, not a real graph |
| Memory stats | ✅ | `memory_stats` → `openclaw ltm stats` CLI |
| Sidebar search | ✅ | Client-side filter of loaded memory cards |
| Skip setup | ✅ | Falls back to agent files view |
| Reconfigure | ✅ | Settings gear reopens setup form with pre-filled values |

**Biggest issues**:
- "Remember" is routing through chat session to ask the agent to store — it should call the CLI directly (`openclaw ltm store`)
- Knowledge graph is a mock bubble chart, not an actual relationship graph
- LanceDB plugin availability depends on gateway restart (which can fail silently)

---

### 10. Skills ✅ WIRED
| Component | Status | Details |
|-----------|--------|---------|
| List skills | ✅ | `skills.status` → installed vs available with requirement checks |
| Install skill | ✅ | `skills.install` with loading state |
| Enable/disable toggle | ✅ | `skills.update` with `enabled` flag |
| Configure (API keys) | ✅ | Modal with env var inputs, `skills.update` with `apiKey`/`env` |
| Missing requirement indicators | ✅ | Shows missing bins, env vars, config |
| Browse bins | ✅ | `skills.bins` → modal list with install buttons |
| Custom bin install | ✅ | Free-text name → `skills.install` |
| Toast notifications | ✅ | Success/error/info toasts with auto-dismiss |

**Working well.** One of the most complete features.

---

### 11. Foundry (Models + Agent Modes) ✅ WIRED
| Component | Status | Details |
|-----------|--------|---------|
| Models list | ✅ | `models.list` → cards with provider, context window, reasoning badge |
| Agent modes CRUD | ✅ | SQLite-backed — create, edit, delete modes |
| Mode config | ✅ | Name, icon, color, model select, system prompt, thinking level, temperature |
| Default mode | ✅ | Seed data creates General/Code Review/Quick Chat modes |
| Tab switching | ✅ | Models ↔ Modes tabs |

**What's missing**:
- **Agent modes are NOT sent with chat messages** — they exist in the DB but `chat.send` doesn't use them
- No way to switch active mode in Chat view
- No model switching from Foundry (read-only list)
- No subscription/billing UI (planned per business model)

---

### 12. Settings ✅ WIRED
| Component | Status | Details |
|-----------|--------|---------|
| Gateway URL/token config | ✅ | Edit + reconnect |
| OpenClaw config editor | ✅ | `config.get` → JSON textarea → `config.set` |
| Config reload | ✅ | Re-fetches from gateway |
| Gateway version display | ✅ | Shows uptime from health check |
| About section | ✅ | Version, links |

---

### 13. Code View 🔴 SHELL ONLY

The sidebar has a "Code" nav item (`data-view="code"`), and the HTML contains `<div id="code-view">` — but the view body is **completely empty**. There is:
- No HTML content for the code view
- No JavaScript handlers
- No gateway integration
- Zero functionality

This was planned for "Git repos, branches, PRs, code review" per the dashboard card description.

---

### 14. Dashboard ✅ WIRED
| Component | Status | Details |
|-----------|--------|---------|
| Welcome greeting | ✅ | Static |
| Quick actions | ✅ | New Chat, Build App, Check Mail (navigation buttons) |
| Feature cards | ✅ | Navigates to each view |
| Cron widget | ✅ | Shows scheduled tasks from gateway |
---

### 15. TTS (Text-to-Speech) ⚪ NOT BUILT
| Component | Status | Details |
|-----------|--------|--------|
| TTS status/toggle | ⚪ | `tts.status`, `tts.enable`, `tts.disable` — no UI |
| Provider selection | ⚪ | `tts.providers`, `tts.setProvider` — ElevenLabs/OpenAI/Edge |
| Convert text → speech | ⚪ | `tts.convert` — play audio next to messages |

OpenClaw supports full TTS with multiple providers. Paw has **zero** coverage.

---

### 16. Talk Mode ⚪ NOT BUILT
| Component | Status | Details |
|-----------|--------|--------|
| Talk config | ⚪ | `talk.config` — voice ID, provider settings |
| Talk mode toggle | ⚪ | `talk.mode` — enable/disable continuous voice conversation |
| Talk mode event | ⚪ | `talk.mode` event — react to talk mode state changes |

ElevenLabs-powered continuous conversation. Paw has **zero** coverage.

---

### 17. Voice Wake ⚪ NOT BUILT
| Component | Status | Details |
|-----------|--------|--------|
| Get wake words | ⚪ | `voicewake.get` — list configured wake words |
| Set wake words | ⚪ | `voicewake.set` — configure wake word triggers |
| Wake events | ⚪ | `voicewake.changed` event — react to wake word config changes |

Wake word system for hands-free activation. Paw has **zero** coverage.

---

### 18. Node Management ⚪ NOT BUILT
| Component | Status | Details |
|-----------|--------|--------|
| List nodes | ⚪ | `node.list` typed in gateway.ts but **never called from UI** |
| Describe node | ⚪ | `node.describe` — capabilities, commands |
| Invoke node command | ⚪ | `node.invoke` — camera.snap, screen.record, location.get, etc. |
| Node pairing flow | ⚪ | `node.pair.request/list/approve/reject/verify` |
| Rename node | ⚪ | `node.rename` |
| Node events | ⚪ | `node.pair.requested/resolved`, `node.invoke.request` events |

iOS/Android nodes with camera, screen, location, voice capabilities. Paw has **zero** UI coverage (11 methods, 0 called).

---

### 19. Device Pairing ⚪ NOT BUILT
| Component | Status | Details |
|-----------|--------|--------|
| List devices | ⚪ | `device.pair.list` |
| Approve/reject | ⚪ | `device.pair.approve/reject` |
| Token management | ⚪ | `device.token.rotate/revoke` |
| Device events | ⚪ | `device.pair.requested/resolved` events |

Secure device pairing for trusted clients. Paw has **zero** coverage.

---

### 20. Exec Approvals ⚪ NOT BUILT (UI)
| Component | Status | Details |
|-----------|--------|--------|
| Approval config | ⚪ | `exec.approvals.get/set` typed in gateway.ts but **never called** |
| Approval prompts | ⚪ | `exec.approval.requested` event — tool wants permission |
| Resolve approvals | ⚪ | `exec.approval.resolve` — approve/deny from Paw |
| Node approvals | ⚪ | `exec.approvals.node.get/set` |

Human-in-the-loop safety system. Gateway types exist but **no UI or event handling**.

---

### 21. Usage Tracking ⚪ NOT BUILT
| Component | Status | Details |
|-----------|--------|--------|
| Usage status | ⚪ | `usage.status` — token counts, request counts |
| Cost breakdown | ⚪ | `usage.cost` — dollar cost per model/provider |

Critical for users on pay-per-use API keys. Paw has **zero** coverage.

---

### 22. Onboarding Wizard ⚪ NOT BUILT
| Component | Status | Details |
|-----------|--------|--------|
| Start wizard | ⚪ | `wizard.start` — begin guided setup |
| Step through | ⚪ | `wizard.next` — advance to next step |
| Cancel | ⚪ | `wizard.cancel` |
| Status | ⚪ | `wizard.status` — check wizard state |

OpenClaw's built-in guided setup flow. Could replace or supplement Paw's manual config form. **High priority** for non-technical users.

---

### 23. Browser Control ⚪ NOT BUILT
| Component | Status | Details |
|-----------|--------|--------|
| Browser request | ⚪ | `browser.request` — CDP Chrome control |

Agent-driven browser automation. Single method but powerful feature.

---

### 24. Self-Update ⚪ NOT BUILT
| Component | Status | Details |
|-----------|--------|--------|
| Update OpenClaw | ⚪ | `update.run` — update OpenClaw from within Paw |

One-click update for non-technical users. **High priority**.

---

### 25. Logs Viewer ⚪ NOT BUILT
| Component | Status | Details |
|-----------|--------|--------|
| Tail logs | ⚪ | `logs.tail` typed in gateway.ts but **never called** |

Real-time gateway log viewer for debugging. Could be a Settings tab.
---

## Critical Gaps — What Needs Wiring

### Priority 1: Things that look broken to users

| Issue | Location | Fix Required |
|-------|----------|-------------|
| **Agent modes not used in chat** | `sendMessage()` in main.ts | Pass the selected mode's `system_prompt`, `model`, `thinking_level` to `chat.send` |
| **Build chat responses lost** | Build chat send handler | Route `paw-build-*` session events back to Build view (like Research does) |
| **Content AI Improve responses lost** | `content-ai-improve` handler | Stream response back to the editor, don't redirect to Chat |
| **Mail is completely empty** | mail-view, db.ts | Either: (a) implement IMAP/SMTP in Rust, (b) integrate with gateway mail channel, or (c) remove from UI |
| **Code view is completely empty** | code-view | Either build git integration or remove from nav |
| **No bundled Node.js** | resources/node/ | Add platform-specific Node.js tarballs for the installer or document how to add them |
| **Remember uses chat instead of CLI** | `palace-remember-save` handler | Use `invoke('memory_store', ...)` Tauri command instead of roundtripping through chat |

### Priority 2: Data loss / persistence issues

| Issue | Location | Fix Required |
|-------|----------|-------------|
| **Build files not persisted** | Build IDE handlers | Save/load from `project_files` table in SQLite |
| **Research reports not saved** | `generateResearchReport()` | Save generated report to SQLite |
| **No session persistence across restarts** | Chat sessions | Sessions come from gateway — but selected session / scroll position lost |

### Priority 3: Missing polish

| Issue | Location | Fix Required |
|-------|----------|-------------|
| Chat messages are plain text | `renderMessages()` | Add markdown rendering (at minimum: bold, code, headers, links, lists) |
| No chat abort button | chat-view HTML | Add Stop button visible during streaming |
| No syntax highlighting in Build | build-code-editor | Add CodeMirror or similar |
| Knowledge graph is fake data | `renderPalaceGraph()` | Either build real graph from memory relationships or remove |
| No mode selector in Chat | chat-view header | Add dropdown to switch agent mode |
| Cron jobs can't be edited | Cron modal | Add edit mode, not just create/delete |

---

## File Map

| File | LOC | Purpose |
|------|-----|---------|
| `src/main.ts` | 3,379 | **All UI logic** — navigation, views, event handlers, data loading, DOM manipulation |
| `src/styles.css` | 3,292 | **All styling** — Monday.com-inspired light theme, layout, components, view-specific styles |
| `index.html` | 1,346 | **All DOM structure** — sidebar, every view's HTML, modals |
| `src/gateway.ts` | 585 | **WebSocket gateway client** — Protocol v3 handshake, request/response, events, high-level API |
| `src/types.ts` | 432 | **TypeScript types** — all gateway protocol types, UI types |
| `src/db.ts` | 269 | **SQLite database** — migrations, CRUD for modes/projects/docs |
| `src/api.ts` | 41 | **HTTP health probe** — pre-WebSocket connectivity check |
| `src-tauri/src/lib.rs` | 1,622 | **Rust backend** — Tauri commands, install, gateway lifecycle, memory plugin, config management |
| `src-tauri/src/main.rs` | 6 | Entry point (calls `lib::run()`) |

---

## Complete Gateway Protocol Coverage (OpenClaw vs Paw)

Source of truth: `openclaw/src/gateway/server-methods-list.ts`

### All 88+ Gateway Methods

#### Core / Health / Status
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `health` | ✅ | ✅ | Keepalive + health polling |
| `status` | ✅ | ❌ | Detailed gateway status — **not exposed in any view** |
| `logs.tail` | ✅ | ❌ | **No logs viewer UI exists** |

#### Channels
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `channels.status` | ✅ | ✅ | Channels view |
| `channels.logout` | ✅ | ✅ | Channels view |
| `web.login.start` | ✅ | ✅ | Channels view |
| `web.login.wait` | ✅ | ✅ | Channels view |

#### Sessions
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `sessions.list` | ✅ | ✅ | Chat session dropdown |
| `sessions.preview` | ❌ | ❌ | **NOT TYPED** — preview message for session list |
| `sessions.patch` | ✅ | ❌ | Rename/update session — **no UI** |
| `sessions.reset` | ✅ | ❌ | Clear session history — **no UI** |
| `sessions.delete` | ✅ | ❌ | Delete session — **no UI** |
| `sessions.compact` | ❌ | ❌ | **NOT TYPED** — compact session store |

#### Chat
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `chat.history` | ✅ | ✅ | Chat + Research views |
| `chat.send` | ✅ | ✅ | Chat + Research + Build + Content |
| `chat.abort` | ✅ | ✅ | Research only — **missing from Chat view** |

#### Agent
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `agent` | ✅ | ❌ | Direct agent run — typed but not called |
| `agent.identity.get` | ✅ | ❌ | Typed but not called |
| `agent.wait` | ❌ | ❌ | **NOT TYPED** — wait for agent completion |
| `agents.list` | ✅ | ✅ | Chat view (display agent name) |
| `agents.create` | ❌ | ❌ | **NOT TYPED** — create multi-agent! |
| `agents.update` | ❌ | ❌ | **NOT TYPED** — update agent config |
| `agents.delete` | ❌ | ❌ | **NOT TYPED** — delete agent |
| `agents.files.list` | ✅ | ✅ | Memory view |
| `agents.files.get` | ✅ | ✅ | Memory view |
| `agents.files.set` | ✅ | ✅ | Memory view |

#### Cron / Automation
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `cron.list` | ✅ | ✅ | Automations view |
| `cron.status` | ✅ | ❌ | Typed but not called from UI |
| `cron.add` | ✅ | ✅ | Automations view |
| `cron.update` | ✅ | ✅ | Automations view (enable/disable) |
| `cron.remove` | ✅ | ✅ | Automations view |
| `cron.run` | ✅ | ✅ | Automations view |
| `cron.runs` | ✅ | ✅ | Automations view (history) |
| `wake` | ❌ | ❌ | **NOT TYPED** — send wake event (system trigger) |

#### Skills
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `skills.status` | ✅ | ✅ | Skills view |
| `skills.bins` | ✅ | ✅ | Skills bins modal |
| `skills.install` | ✅ | ✅ | Skills view |
| `skills.update` | ✅ | ✅ | Skills view (enable/disable/config) |

#### Models
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `models.list` | ✅ | ✅ | Foundry view |

#### Config
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `config.get` | ✅ | ✅ | Settings view |
| `config.set` | ✅ | ✅ | Settings view |
| `config.apply` | ❌ | ❌ | **NOT TYPED** — validate + write + restart (safer than set!) |
| `config.patch` | ✅ | ❌ | Typed but not called |
| `config.schema` | ✅ | ❌ | Typed but not called — **could power a proper config editor** |

#### TTS (Text-to-Speech) — ENTIRELY MISSING FROM PAW
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `tts.status` | ❌ | ❌ | Get TTS status/provider/mode |
| `tts.providers` | ❌ | ❌ | List available TTS providers |
| `tts.enable` | ❌ | ❌ | Enable TTS |
| `tts.disable` | ❌ | ❌ | Disable TTS |
| `tts.convert` | ❌ | ❌ | Convert text → speech audio |
| `tts.setProvider` | ❌ | ❌ | Set TTS provider (elevenlabs/openai/edge) |

#### Talk Mode — ENTIRELY MISSING FROM PAW
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `talk.config` | ❌ | ❌ | Get talk config (ElevenLabs voice, etc.) |
| `talk.mode` | ❌ | ❌ | Enable/disable continuous talk mode |

#### Voice Wake — ENTIRELY MISSING FROM PAW
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `voicewake.get` | ❌ | ❌ | Get wake word triggers |
| `voicewake.set` | ❌ | ❌ | Set wake word triggers |

#### Node Management — ENTIRELY MISSING FROM PAW UI
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `node.list` | ✅ | ❌ | Typed but not called |
| `node.describe` | ❌ | ❌ | Node capabilities |
| `node.invoke` | ❌ | ❌ | Invoke command on a node (camera.snap, etc.) |
| `node.invoke.result` | ❌ | ❌ | Node → gateway result |
| `node.event` | ❌ | ❌ | Node events |
| `node.rename` | ❌ | ❌ | Rename a paired node |
| `node.pair.request` | ❌ | ❌ | Request pairing |
| `node.pair.list` | ❌ | ❌ | List pairing requests |
| `node.pair.approve` | ❌ | ❌ | Approve pairing |
| `node.pair.reject` | ❌ | ❌ | Reject pairing |
| `node.pair.verify` | ❌ | ❌ | Verify node token |

#### Device Pairing — ENTIRELY MISSING FROM PAW
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `device.pair.list` | ❌ | ❌ | List paired devices |
| `device.pair.approve` | ❌ | ❌ | Approve device |
| `device.pair.reject` | ❌ | ❌ | Reject device |
| `device.token.rotate` | ❌ | ❌ | Rotate device auth token |
| `device.token.revoke` | ❌ | ❌ | Revoke device auth token |

#### Exec Approvals — NOT EXPOSED IN PAW UI
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `exec.approvals.get` | ✅ | ❌ | Typed but not called |
| `exec.approvals.set` | ✅ | ❌ | Typed but not called |
| `exec.approvals.node.get` | ❌ | ❌ | NOT TYPED |
| `exec.approvals.node.set` | ❌ | ❌ | NOT TYPED |
| `exec.approval.request` | ❌ | ❌ | NOT TYPED |
| `exec.approval.waitDecision` | ❌ | ❌ | NOT TYPED |
| `exec.approval.resolve` | ❌ | ❌ | NOT TYPED |

#### Usage Tracking — ENTIRELY MISSING FROM PAW
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `usage.status` | ❌ | ❌ | Token/cost usage stats |
| `usage.cost` | ❌ | ❌ | Billing/cost breakdown |

#### System / Presence
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `system-presence` | ✅ | ❌ | Typed but not called — **no connected clients view** |
| `system-event` | ❌ | ❌ | NOT TYPED — trigger system event |
| `last-heartbeat` | ❌ | ❌ | NOT TYPED |
| `set-heartbeats` | ❌ | ❌ | NOT TYPED |

#### Onboarding Wizard — ENTIRELY MISSING FROM PAW
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `wizard.start` | ❌ | ❌ | Start guided setup |
| `wizard.next` | ❌ | ❌ | Next wizard step |
| `wizard.cancel` | ❌ | ❌ | Cancel wizard |
| `wizard.status` | ❌ | ❌ | Wizard status |

#### Update — MISSING FROM PAW
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `update.run` | ❌ | ❌ | Self-update OpenClaw |

#### Browser Control — MISSING FROM PAW
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `browser.request` | ❌ | ❌ | CDP browser control |

#### Direct Send
| Method | In gateway.ts | Called from UI | Notes |
|--------|:---:|:---:|-------|
| `send` | ✅ | ❌ | Typed but not called |

### All 18 Gateway Events

| Event | Consumed by Paw | Notes |
|-------|:---:|-------|
| `connect.challenge` | ✅ | Handshake nonce |
| `agent` | ✅ | Streaming deltas for chat/research |
| `chat` | ✅ | Final assembled messages |
| `presence` | ❌ | **Not consumed** — connected clients updates |
| `tick` | ❌ | **Not consumed** — periodic status ticks |
| `talk.mode` | ❌ | **Not consumed** — talk mode state changes |
| `shutdown` | ❌ | **Not consumed** — gateway shutting down gracefully |
| `health` | ❌ | **Not consumed** — health snapshot pushes |
| `heartbeat` | ❌ | **Not consumed** — heartbeat events |
| `cron` | ❌ | **Not consumed** — cron job fired/completed |
| `node.pair.requested` | ❌ | **Not consumed** — node wants to pair |
| `node.pair.resolved` | ❌ | **Not consumed** — pairing approved/rejected |
| `node.invoke.request` | ❌ | **Not consumed** — node invoke request |
| `device.pair.requested` | ❌ | **Not consumed** — device pairing request |
| `device.pair.resolved` | ❌ | **Not consumed** — device pairing resolved |
| `voicewake.changed` | ❌ | **Not consumed** — wake words updated |
| `exec.approval.requested` | ❌ | **Not consumed** — tool needs approval |
| `exec.approval.resolved` | ❌ | **Not consumed** — approval resolved |

### Coverage Summary

| Category | Methods in OpenClaw | Methods typed in Paw | Methods called from UI | % Coverage |
|----------|:---:|:---:|:---:|:---:|
| Core/Health | 3 | 2 | 1 | 33% |
| Channels | 4 | 4 | 4 | **100%** |
| Sessions | 6 | 4 | 1 | 17% |
| Chat | 3 | 3 | 3 | **100%** |
| Agent | 8 | 5 | 1 | 13% |
| Cron | 7 | 7 | 6 | 86% |
| Skills | 4 | 4 | 4 | **100%** |
| Models | 1 | 1 | 1 | **100%** |
| Config | 5 | 4 | 2 | 40% |
| **TTS** | **6** | **0** | **0** | **0%** |
| **Talk** | **2** | **0** | **0** | **0%** |
| **Voice Wake** | **2** | **0** | **0** | **0%** |
| **Nodes** | **11** | **1** | **0** | **0%** |
| **Devices** | **5** | **0** | **0** | **0%** |
| **Exec Approvals** | **7** | **2** | **0** | **0%** |
| **Usage** | **2** | **0** | **0** | **0%** |
| **System** | **4** | **1** | **0** | **0%** |
| **Wizard** | **4** | **0** | **0** | **0%** |
| **Update** | **1** | **0** | **0** | **0%** |
| **Browser** | **1** | **0** | **0** | **0%** |
| Send/Agent | 2 | 2 | 0 | 0% |
| **TOTAL** | **~88** | **~40** | **~23** | **~26%** |

---

## Database Schema (SQLite — paw.db)

| Table | Used By | Status |
|-------|---------|--------|
| `agent_modes` | Foundry modes | ✅ CRUD works, but **modes not used in chat** |
| `projects` | Build, Research | ✅ Working |
| `project_files` | Build IDE | 🔴 Table exists, **never read or written** |
| `automation_runs` | Automations | 🔴 Table exists, **never read or written** (uses gateway's `cron.runs` instead) |
| `research_findings` | Research | 🔴 Table exists, but **findings stored in `content_documents` instead** |
| `content_documents` | Content + Research findings | ✅ Working |
| `email_accounts` | Mail | 🔴 Table exists, **nothing uses it** |
| `emails` | Mail | 🔴 Table exists, **nothing uses it** |

**Note**: `research_findings` and `automation_runs` tables are orphaned — created by migrations but never used. Research findings go to `content_documents` with `content_type: 'research-finding'`. Automation runs come from the gateway (`cron.runs`).

---

## Tauri Commands (Rust → Frontend)

| Command | Used | Working |
|---------|------|---------|
| `check_node_installed` | Install flow | ✅ |
| `check_openclaw_installed` | Setup detection | ✅ |
| `check_gateway_health` | Health polling | ✅ |
| `get_gateway_token` | Config reading | ✅ |
| `get_gateway_port_setting` | Config reading | ✅ |
| `install_openclaw` | Installation | 🔶 Needs bundled Node.js |
| `start_gateway` | Gateway lifecycle | ✅ |
| `stop_gateway` | Gateway lifecycle | ✅ |
| `check_memory_configured` | Memory setup | ✅ |
| `enable_memory_plugin` | Memory setup | ✅ |
| `test_embedding_connection` | Memory setup | ✅ |
| `get_embedding_base_url` | Memory reconfigure | ✅ |
| `get_azure_api_version` | Memory reconfigure | ✅ |
| `get_embedding_provider` | Memory reconfigure | ✅ |
| `memory_stats` | Memory view | ✅ |
| `memory_search` | Memory recall | ✅ |
| `repair_openclaw_config` | Startup | ✅ |

---

## What Needs to Happen Next (Prioritized)

### Phase 1: Fix broken wiring (users see errors NOW)
1. **Wire agent modes to chat** — When sending a message, include the selected mode's model/system_prompt/thinking_level
2. **Route Build chat responses** — Mirror Research's event routing pattern for `paw-build-*` sessions
3. **Route Content AI responses** — Stream AI improve results back to the editor
4. **Add chat abort button** — Simple: show a Stop button during streaming, call `chat.abort`
5. **Add markdown rendering to chat** — At minimum reuse `formatResearchContent()` for chat messages

### Phase 2: Fix data loss
6. **Persist Build files to SQLite** — Use the `project_files` table that already exists
7. **Save research reports to DB** — Store generated reports as content documents
8. **Fix Memory "Remember"** — Add a `memory_store` Tauri command that calls `openclaw ltm store` directly

### Phase 3: Session management (OpenClaw has it, Paw ignores it)
9. **Session rename** — Call `sessions.patch` with label
10. **Session delete** — Call `sessions.delete`, refresh dropdown
11. **Session reset/clear** — Call `sessions.reset` for "new conversation, same session"
12. **Session search/filter** — Client-side filter on session list

### Phase 4: Wire up the "FREE" features (gateway already supports them, Paw just needs UI)

These are features that OpenClaw already exposes via gateway methods. Paw just needs to add the UI and call them.

#### 4a. Exec Approvals (high-impact safety feature)
13. **Approval dashboard** — Call `exec.approvals.get/set`, show allow/deny lists
14. **Live approval notifications** — Listen to `exec.approval.requested` event, show approve/deny dialog
15. **Resolve approvals** — Wire approve/deny buttons → `exec.approval.resolve`

#### 4b. Usage & Billing
16. **Usage dashboard** — Call `usage.status` + `usage.cost`, show token/cost breakdown

#### 4c. TTS (Text-to-Speech)
17. **TTS settings panel** — `tts.status`, `tts.providers`, enable/disable/setProvider
18. **TTS toggle in chat** — Enable TTS for responses, preview voices
19. **Convert button** — `tts.convert` next to assistant messages

#### 4d. Logs Viewer
20. **Logs tab in Settings** — `logs.tail` with auto-refresh, filterable

#### 4e. System Presence
21. **Connected clients card** — `system-presence` → show who/what is connected (devices, apps, CLI)

#### 4f. Node Management
22. **Nodes view** — `node.list` + `node.describe` → list paired nodes with caps/commands
23. **Node pairing** — `node.pair.list/approve/reject` → approve iOS/Android nodes from Paw
24. **Node invoke** — `node.invoke` → trigger camera.snap, screen.record, etc. from desktop

#### 4g. Device Pairing
25. **Paired devices** — `device.pair.list/approve/reject` → manage trusted devices
26. **Token management** — `device.token.rotate/revoke`

#### 4h. Voice Wake + Talk Mode
27. **Wake words editor** — `voicewake.get/set` → manage wake word triggers
28. **Talk mode toggle** — `talk.mode` (enable/disable), `talk.config` (show voice settings)
29. **Listen for changes** — consume `voicewake.changed` and `talk.mode` events

#### 4i. Multi-Agent Management
30. **Agent CRUD** — `agents.create/update/delete` → manage multiple agents from Paw
31. **Agent routing** — configure which channels/sessions route to which agent

#### 4j. Self-Update
32. **Update button** — `update.run` → update OpenClaw from Paw, show progress

#### 4k. Onboarding Wizard
33. **Wizard flow** — `wizard.start/next/cancel/status` → guided first-run setup
34. Could replace/supplement current manual setup form

#### 4l. Browser Control
35. **Browser panel** — `browser.request` → start/stop managed browser, view tabs, take screenshots

#### 4m. Gateway Config
36. **Config validation** — `config.schema` → validate before saving
37. **Config apply** — `config.apply` instead of `config.set` (validate + write + restart atomically)
38. **Config patch** — `config.patch` for partial updates (safer than full set)

#### 4n. Gateway Events
39. Listen to `shutdown` event → show "gateway shutting down" banner
40. Listen to `health` event → update status in real-time without polling
41. Listen to `cron` event → update automations board in real-time
42. Listen to `presence` event → update connected clients live

### Phase 5: Remove or build empty shells
43. **Mail** — Decision needed: build it (significant effort: IMAP/SMTP in Rust backend or via gateway channel) or remove it from the UI
44. **Code view** — Decision needed: build git integration (gateway has no git methods) or remove
45. **Clean up orphaned DB tables** — Remove `research_findings`, `automation_runs`, `email_accounts`, `emails` if not building their features

### Phase 6: Polish
46. Add syntax highlighting to Build editor (CodeMirror)
47. Cron job editing (currently create/delete only)
48. Real knowledge graph (or remove the mock)
49. Export research reports
50. Chat image/file/attachment support (OpenClaw `agent` method supports `attachments` array)
51. Webhook configuration UI

---

## Dependencies on OpenClaw

Paw is **100% dependent on OpenClaw gateway**. Without it running:
- Chat, Research, Build chat, Content AI → all broken
- Channels, Skills, Models, Cron → all empty
- Memory (LanceDB) → requires both gateway + plugin configured
- Only local SQLite operations work (create/edit documents, manage modes)

OpenClaw must be installed as an npm package, its gateway started as a macOS LaunchAgent (or manually), and `~/.openclaw/openclaw.json` must contain a valid `gateway.auth.token`.

The gateway exposes its full API via WebSocket on `ws://127.0.0.1:{port}` (default port 18789).

---

## Summary

**What works**: Chat (streaming), Research (full flow), Channels, Automations, Skills, Models/Modes, Memory (with setup), Settings, Dashboard. The core gateway integration is solid for the features it covers.

**What's broken**: Agent modes disconnected from chat, Build/Content chat responses lost, Mail is an empty shell, Code view is empty, Build files aren't persisted, Memory "Remember" is indirect.

**What's missing entirely**: TTS (6 methods), Talk Mode (2), Voice Wake (2), Node Management (11), Device Pairing (5), Exec Approvals (7), Usage Tracking (2), Onboarding Wizard (4), Self-Update (1), Browser Control (1), Logs Viewer (1). That's **42 gateway methods with zero coverage** — entire product subsystems invisible to Paw users.

**Coverage reality**: Paw calls **~23 of ~88 gateway methods** (**26% protocol coverage**). Only 3 of 18 gateway events are consumed. The gateway WebSocket client (`gateway.ts`) is well-structured, but needs **48+ new method wrappers** and **15 new event handlers**.

**Core insight**: The WebSocket client architecture is sound — adding new methods is straightforward (add type → add wrapper → add UI). The main work is:
1. **Frontend wiring** — connecting existing UI to existing gateway calls
2. **New views** — building UI for the 11 OpenClaw subsystems with zero coverage
3. **Event consumption** — reacting to the 15 unconsumed gateway events in real-time

**Priority for "works out of the box" goal**: Onboarding Wizard + Self-Update + Exec Approvals + Usage Tracking are the highest impact for non-technical users.
