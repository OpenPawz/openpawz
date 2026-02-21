<div align="center">

# Pawz

**The most secure, capable, and extensible AI agent platform for the desktop.**

[![CI](https://github.com/elisplash/paw/actions/workflows/ci.yml/badge.svg)](https://github.com/elisplash/paw/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-530_passing-brightgreen.svg)](#quality--trust)
[![Rust](https://img.shields.io/badge/Rust-33k_LOC-orange.svg)](#architecture)

*No terminal. No config files. No localhost ports. Download, install, go.*

</div>

---

## Why Pawz?

Most desktop AI apps are Electron wrappers around a chat box. Pawz is a native Tauri v2 application with a pure Rust backend engine — 33,000 lines of async Rust powering every tool call, every API request, every file operation. Zero open ports. Zero network attack surface.

| | Pawz | ChatGPT Desktop | Open-source alternatives |
|---|---|---|---|
| **Architecture** | Native Tauri + Rust engine | Electron wrapper | Electron + Node.js |
| **Security layers** | 7 (injection scan → Docker sandbox) | 1 | ~2 |
| **Test suite** | 530 tests, 3-job CI | Proprietary | Varies |
| **AI providers** | Unlimited (any OpenAI-compatible) | 1 locked-in | Self-host only |
| **Channel bridges** | 11 platforms | None | Plugin-based |
| **Binary size** | ~5 MB | ~200 MB | ~200 MB |
| **Cost** | $0 forever (MIT) | $20/mo | Self-host |

---

## Quality & Trust

Pawz ships with enterprise-grade quality gates. Every commit is validated by 3 parallel CI jobs.

### 530 Tests

| Layer | Count | Coverage |
|-------|------:|----------|
| Rust unit tests | 124 | Cryptography, injection detection, DeFi primitives, access control, routing, retry logic |
| Rust integration tests | 40 | Session lifecycle, memory roundtrip, tool classification, config persistence |
| TypeScript tests | 366 | Risk classifier, injection patterns, command parsing, view modules, error handling |

### CI Pipeline

```
TypeScript    tsc → eslint → vitest → prettier
Rust          cargo check → cargo test → cargo clippy -D warnings
Security      cargo audit → npm audit
```

Zero clippy warnings enforced. Zero known vulnerabilities. Dependabot enabled.

### Enterprise Hardening

| Hardening | What we did |
|-----------|-------------|
| **AES-256-GCM encryption** | All credentials encrypted at rest — OS keychain for key storage, 12-byte random nonce per field |
| **Typed error handling** | 12-variant `EngineError` enum via `thiserror` — no `Result<T, String>` anywhere in the engine |
| **Retry & circuit breakers** | Exponential backoff with jitter, `Retry-After` support, 60s circuit breaker cooldown |
| **Persistent logging** | Daily rotation, 7-day pruning, structured format, in-app log viewer |
| **Hard-fail keychain** | Missing OS keychain shows user error — no silent plaintext fallback |
| **Zero warnings** | `cargo clippy -- -D warnings` enforced in CI on every commit |

See [ENTERPRISE_PLAN.md](ENTERPRISE_PLAN.md) for the full hardening audit with test counts per module.

---

## Security

Pawz takes a defense-in-depth approach. The agent never touches the OS directly — every tool call flows through the Rust engine where it can be intercepted, classified, and blocked.

### 7 Security Layers

1. **Prompt injection scanner** — Dual TypeScript + Rust detection, 30+ patterns, 4 severity levels
2. **Command risk classifier** — 30+ danger patterns across 5 risk levels (Safe → Critical)
3. **Human-in-the-Loop approval** — Side-effect tools require explicit user approval; Critical commands require typing "ALLOW"
4. **Per-agent tool policies** — Allowlist, denylist, or unrestricted mode per agent
5. **Container sandboxing** — Docker isolation with `CAP_DROP ALL`, memory/CPU limits, network disabled
6. **Browser network policy** — Domain allowlist/blocklist prevents data exfiltration
7. **Credential vault** — OS keychain + AES-256-GCM encrypted SQLite; keys never appear in prompts

See [SECURITY.md](SECURITY.md) for the complete security architecture.

---

## Features

### Multi-Agent System
- Unlimited agents with custom personalities, models, and tool policies
- Boss/worker orchestration — agents delegate tasks and spawn sub-agents at runtime
- Per-agent chat sessions with persistent history and mini-chat popups
- Agent dock with avatars (50 custom Pawz Boi sprites)

### 10 AI Providers
| Provider | Models |
|----------|--------|
| Ollama | Any local model (auto-detected, fully offline) |
| OpenAI | GPT-4o, o1, o3-mini |
| Anthropic | Claude Sonnet 4, Opus 4, Haiku |
| Google Gemini | Gemini 2.5 Pro/Flash |
| OpenRouter | Meta-provider routing |
| DeepSeek | deepseek-chat, deepseek-reasoner |
| xAI (Grok) | grok-3, grok-3-mini |
| Mistral | mistral-large, codestral, pixtral |
| Moonshot/Kimi | moonshot-v1 models |
| Custom | Any OpenAI-compatible endpoint |

### 11 Channel Bridges
Telegram · Discord · IRC · Slack · Matrix · Mattermost · Nextcloud Talk · Nostr · Twitch · WebChat · WhatsApp

Each bridge includes user approval flows, per-agent routing, and uniform start/stop/config commands. The same agent brain, memory, and tools work across every platform.

### Memory System
- Hybrid BM25 + vector similarity search with Ollama embeddings
- MMR re-ranking for diversity (lambda=0.7)
- Temporal decay with 30-day half-life
- Auto-recall and auto-capture per agent
- Memory Palace visualization UI

### Built-in Tools & Skills
- 40+ skills with encrypted credential injection
- Community skills from the [skills.sh](https://skills.sh) ecosystem
- Kanban task board with agent assignment and cron scheduling
- Research workflow with findings and synthesis
- Full email client (IMAP/SMTP via Himalaya)
- Browser automation with managed profiles
- DeFi trading on ETH (7 EVM chains) + Solana (Jupiter, PumpPortal)
- 20 slash commands with autocomplete

### Voice
- Google TTS (Chirp 3 HD, Neural2, Journey)
- OpenAI TTS (9 voices)
- ElevenLabs TTS (16 premium voices)
- Talk Mode — continuous voice loop (mic → STT → agent → TTS → speaker)

---

## Architecture

```
Frontend (TypeScript · 32k LOC)        Rust Engine (33k LOC)
┌──────────────────────┐              ┌────────────────────────────────┐
│ Vanilla DOM · 20+ views │◄── IPC ──► │ 134 Tauri commands              │
│ 7 feature modules       │   (typed)  │ 11 channel bridges              │
│ 10k CSS · Material Icons│            │ 3 native AI providers           │
│ 366 tests               │            │ Tool executor + HIL approval    │
└──────────────────────┘              │ 164 tests · 0 clippy warnings  │
                                       │ AES-256-GCM encrypted SQLite    │
                                       │ OS keychain · Docker sandbox    │
                                       └────────────────────────────────┘
```

No Node.js backend. No gateway process. No open ports. Everything flows through Tauri IPC.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full technical breakdown.

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (latest stable)
- Platform dependencies for Tauri — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development

```bash
git clone https://github.com/elisplash/paw.git
cd paw
npm install
npm run tauri dev
```

### Run Tests

```bash
# TypeScript tests
npx vitest run

# Rust tests
cd src-tauri && cargo test

# Lint
npx tsc --noEmit
cd src-tauri && cargo clippy -- -D warnings
```

### Production Build

```bash
npm run tauri build
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Full technical breakdown — directory structure, module design, data flow |
| [SECURITY.md](SECURITY.md) | Complete security architecture — 7 layers, threat model, credential handling |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development setup, code style, testing, PR guidelines |
| [ENTERPRISE_PLAN.md](ENTERPRISE_PLAN.md) | Enterprise hardening audit — all phases with test counts |
| [Docs Site](https://elisplash.github.io/paw/) | Full documentation with guides, channel setup, and API reference |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri v2](https://v2.tauri.app/) |
| Backend | Rust (async, Tokio) |
| Frontend | TypeScript (vanilla DOM) |
| Database | SQLite (19 tables, AES-256-GCM encrypted fields) |
| Bundler | Vite |
| Testing | vitest (TS) + cargo test (Rust) |
| CI | GitHub Actions (3 parallel jobs) |

---

## License

MIT — See [LICENSE](LICENSE)
