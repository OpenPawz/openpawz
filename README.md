# 🐾 Paw

**The desktop app for OpenClaw. No terminal required.**

Paw makes AI agents accessible to everyone. No CLI, no config files, no localhost ports — just download, install, and go.

## Features (Planned)

- 📦 **One-click install** — Download the app, drag to Applications, done
- 🚀 **Embedded gateway** — No separate terminal process needed
- 🎨 **Visual configuration** — Add agents, channels, and models through a beautiful UI
- 🔑 **Bring your own keys** — Or subscribe to use ours
- 🔄 **Auto-updates** — Always on the latest version

## Development

### Prerequisites

- Node.js 18+
- Rust (install via [rustup](https://rustup.rs/))

### Getting Started

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
cd ~/Desktop/paw && git pull origin main && npm run tauri dev
```

## Business Model

- **One-time purchase** — Buy the app, use your own API keys
- **Optional subscription** — For users who don't want to manage API keys

## Tech Stack

- [Tauri](https://tauri.app/) — Lightweight native app framework
- [OpenClaw](https://github.com/openclaw/openclaw) — The AI agent infrastructure (MIT licensed)
- Rust + TypeScript + Vite

## Status

🚧 **Early development** — Stay tuned.

## License

MIT — See [LICENSE](LICENSE)

---

Built with ❤️ for the OpenClaw community.
