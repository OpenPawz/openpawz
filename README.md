# Pawz

**A native desktop AI agent platform.** No terminal, no config files, no localhost ports — just download, install, and go.

Pawz is a standalone Tauri v2 app with a pure Rust backend engine. Every tool call, every API request, every file operation runs through Rust IPC — zero open ports, zero network attack surface.

---

## Features

### Multi-Agent System
- Create unlimited agents with custom personalities, models, and tool policies
- Boss/worker orchestration — agents can delegate tasks and spawn sub-agents
- Per-agent chat sessions with persistent conversation history
- Mini-chat popups (Messenger-style floating windows)
- Agent dock with collapse/expand and hover tooltips

### 10 AI Providers
| Provider | Models |
|----------|--------|
| Ollama | Any local model (auto-detected) |
| OpenAI | GPT-4o, o1, o3-mini |
| Anthropic | Claude Sonnet 4, Opus 4, Haiku |
| Google Gemini | Gemini 2.5 Pro/Flash |
| OpenRouter | Meta-provider routing |
| DeepSeek | deepseek-chat, deepseek-reasoner |
| xAI (Grok) | grok-3, grok-3-mini, grok-2 |
| Mistral | mistral-large, codestral, pixtral |
| Moonshot/Kimi | moonshot-v1 models |
| Custom | Any OpenAI-compatible endpoint |

### 10 Channel Bridges
Telegram, Discord, IRC, Slack, Matrix, Mattermost, Nextcloud Talk, Nostr, Twitch, WebChat — each with user approval flows, per-agent routing, and uniform start/stop/config commands.

### Security
- Command risk classifier (30+ danger patterns, 5 risk levels)
- Human-in-the-loop approval modal with type-to-confirm for critical commands
- Command allowlist/denylist with regex patterns
- Prompt injection scanner (30+ patterns, dual TS+Rust)
- Container sandboxing via Docker (cap_drop ALL, memory/CPU limits)
- OS keychain credential storage (macOS Keychain / libsecret)
- AES-256-GCM database field encryption
- Credential audit trail
- Network exfiltration detection
- Filesystem sandboxing with sensitive path blocking

### Memory
- Semantic long-term memory with Ollama embeddings
- Hybrid BM25 + vector similarity search
- MMR re-ranking for diversity
- Temporal decay (30-day half-life)
- Per-agent memory scope
- Auto-recall and auto-capture
- Memory Palace visualization UI
- Session compaction (AI-powered summarization)

### Voice & TTS
- Google TTS (Chirp 3 HD, Neural2, Journey)
- OpenAI TTS (9 voices)
- ElevenLabs TTS (16 premium voices)
- Talk Mode — continuous voice loop (mic → STT → agent → TTS → speaker)
- Morning Brief automation template

### Built-in Tools
- 40+ skills with encrypted credential injection
- Community skills from the [skills.sh](https://skills.sh) ecosystem — browse, install, and manage open-source agent skills
- Kanban task board with drag-and-drop, agent assignment, cron scheduling
- Research workflow with findings and synthesis reports
- Full email client (IMAP/SMTP via Himalaya)
- Coinbase CDP wallet integration + trading dashboard
- Multi-agent project orchestration
- 20 slash commands with autocomplete
- Browser automation with managed profiles and screenshot viewer

### Other
- Tailscale remote access (Serve/Funnel)
- Outbound domain allowlist
- Per-agent workspaces
- 50 custom Pawz Boi avatars
- Light/dark theme
- SQLite-backed persistence (11+ tables)

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (latest stable)
- Platform dependencies for Tauri — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development

```bash
# Clone the repo
git clone https://github.com/elisplash/paw.git
cd paw

# Install dependencies
npm install

# Run in development mode
npm run tauri dev
```

### Production Build

```bash
npm run tauri build
```

The built app will be in `src-tauri/target/release/bundle/`.

---

## Architecture

Pawz is built on [Tauri v2](https://v2.tauri.app/) with a clear separation:

```
Frontend (TypeScript)          Rust Backend
┌──────────────────┐          ┌──────────────────────────────┐
│ Vanilla DOM UI   │◄── IPC ──► Agent engine (19k LOC)       │
│ 20+ views        │          │ 10 channel bridges            │
│ 7 feature modules│          │ 3 native AI providers         │
│ Material Symbols │          │ Tool executor + HIL            │
└──────────────────┘          │ SQLite + OS keychain           │
                              │ Docker sandbox (bollard)       │
                              └──────────────────────────────┘
```

No Node.js backend, no gateway process, no open ports. Everything flows through Tauri IPC commands.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full technical breakdown.

---

## Security

Pawz takes a defense-in-depth approach to AI agent security. Every tool call goes through the Rust backend and can be intercepted, classified, and blocked before reaching the OS.

See [SECURITY.md](SECURITY.md) for the complete security architecture.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and contribution guidelines.

---

## Tech Stack

- **[Tauri v2](https://v2.tauri.app/)** — Native desktop app framework
- **Rust** — Backend engine, all business logic
- **TypeScript** — Frontend UI (vanilla DOM, no framework)
- **SQLite** — Local persistence
- **Vite** — Frontend bundler

---

## License

MIT — See [LICENSE](LICENSE)
