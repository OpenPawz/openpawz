# PawzHub

> The open-source skill marketplace for [OpenPawz](https://github.com/OpenPawz/openpawz) — your AI, your rules.

**41 skills** across 9 categories. All verified. All MIT licensed.

---

## Skills

### Vault (Credential-based)

| Skill | Description | Credentials | Tools |
|-------|-------------|-------------|-------|
| **[Email](skills/email)** | Send and read emails via IMAP/SMTP | SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, IMAP_HOST, IMAP_PORT | `email_send`, `email_read` |
| **[Slack](skills/slack)** | Send messages to Slack channels and DMs | SLACK_BOT_TOKEN | `slack_send`, `slack_read` |
| **[Telegram](skills/telegram)** | Send proactive messages to Telegram users | (uses channel bridge) | `telegram_send`, `telegram_read` |
| **[GitHub](skills/github)** | Issues, PRs, repos via gh CLI and GitHub API | GITHUB_TOKEN | `github_api` |
| **[REST API](skills/rest-api)** | Authenticated calls to any REST service | API_BASE_URL, API_KEY | `rest_api_call` |
| **[Webhooks](skills/webhook)** | Send data to webhook URLs (Zapier, IFTTT, n8n) | WEBHOOK_URL | `webhook_send` |
| **[Discord](skills/discord)** | Full server management — 23 tools | DISCORD_BOT_TOKEN | 23 `discord_*` tools |
| **[Coinbase](skills/coinbase)** | Trade crypto via Coinbase Developer Platform | CDP_API_KEY_NAME, CDP_API_KEY_SECRET | 5 `coinbase_*` tools |
| **[DEX Trading](skills/dex)** | Self-custody Ethereum + Uniswap V3 | DEX_RPC_URL, DEX_PRIVATE_KEY | 13 `dex_*` tools |
| **[Solana DEX](skills/solana-dex)** | Jupiter + PumpPortal for Solana | SOLANA_RPC_URL, SOLANA_PRIVATE_KEY | 7 `sol_*` tools |

### API Integrations

| Skill | Description | Credentials |
|-------|-------------|-------------|
| **[Notion](skills/notion)** | Pages, databases, and blocks via the Notion API | NOTION_API_KEY |
| **[Trello](skills/trello)** | Boards, lists, cards, labels — 28 tools | TRELLO_API_KEY, TRELLO_TOKEN |
| **[Google Workspace](skills/google-workspace)** | Gmail, Calendar, Drive, Sheets, Docs | OAuth |
| **[Google Places](skills/google-places)** | Search places, details, and reviews | GOOGLE_PLACES_API_KEY |
| **[n8n](skills/n8n)** | Trigger and manage n8n workflows via REST API | N8N_API_KEY, N8N_BASE_URL |

### Productivity

| Skill | Description | Requires |
|-------|-------------|----------|
| **[Apple Notes](skills/apple-notes)** | Manage Apple Notes on macOS | `memo` CLI |
| **[Apple Reminders](skills/apple-reminders)** | Manage Apple Reminders on macOS | `remindctl` CLI |
| **[Things 3](skills/things)** | Things 3 task management | `things` CLI |
| **[Obsidian](skills/obsidian)** | Obsidian vault management | `obsidian-cli` |
| **[Bear Notes](skills/bear-notes)** | Bear note management | `grizzly` CLI |

### Media

| Skill | Description | Requires |
|-------|-------------|----------|
| **[Whisper (Local)](skills/whisper)** | Local speech-to-text, no API key | `whisper` CLI |
| **[Whisper API](skills/whisper-api)** | OpenAI Whisper cloud API | OPENAI_API_KEY |
| **[Image Generation](skills/image-gen)** | Text-to-image via Gemini | GEMINI_API_KEY |
| **[Video Frames](skills/video-frames)** | Extract frames/clips from video | `ffmpeg` |
| **[ElevenLabs TTS](skills/tts-elevenlabs)** | Text-to-speech | ELEVENLABS_API_KEY, `sag` CLI |
| **[Spotify](skills/spotify)** | Control Spotify playback | `spotify_player` |
| **[GIF Search](skills/gifgrep)** | Search GIFs from Giphy/Tenor | `gifgrep` CLI |

### Smart Home

| Skill | Description | Requires |
|-------|-------------|----------|
| **[Philips Hue](skills/hue)** | Control lights, rooms, scenes | `openhue` CLI |
| **[Sonos](skills/sonos)** | Control speakers | `sonos` CLI |
| **[Eight Sleep](skills/eight-sleep)** | Control pod temperature | `eightctl` CLI |
| **[Camera Capture](skills/camsnap)** | Capture from IP cameras | `camsnap` CLI |

### Communication

| Skill | Description | Requires |
|-------|-------------|----------|
| **[WhatsApp](skills/whatsapp)** | Send messages, search history | `wacli` CLI |
| **[iMessage](skills/imessage)** | Send iMessages on macOS | `imsg` CLI |

### CLI Tools

| Skill | Description | Requires |
|-------|-------------|----------|
| **[Weather](skills/weather)** | Weather and forecasts (no API key) | Nothing |
| **[Blog Watcher](skills/blogwatcher)** | Monitor RSS/Atom feeds | Nothing |
| **[Summarize](skills/summarize)** | Summarize URLs, podcasts, PDFs | `summarize` CLI |

### Development

| Skill | Description | Requires |
|-------|-------------|----------|
| **[tmux](skills/tmux)** | Control tmux sessions | `tmux` |
| **[Session Logs](skills/session-logs)** | Search past conversations | `rg` (ripgrep) |

### System

| Skill | Description | Requires |
|-------|-------------|----------|
| **[1Password](skills/one-password)** | Access vaults via op CLI | `op` CLI |
| **[Peekaboo](skills/peekaboo)** | macOS UI automation | `peekaboo` CLI |
| **[Security Audit](skills/security-audit)** | Host security checks | Nothing |

---

## How to Install

### From the Pawz App (Recommended)

1. Open the **Skills** tab in the sidebar
2. Browse or search the PawzHub catalog
3. Click **Install**
4. Configure credentials if required
5. Assign to your agents

### Manual

```bash
# Copy the skill manifest to your local skills directory
cp skills/{skill-id}/pawz-skill.toml ~/.paw/skills/{skill-id}/pawz-skill.toml
```

Pawz hot-reloads the skill directory — the skill appears immediately.

---

## How to Contribute

1. **Fork** this repository
2. Create `skills/{your-skill-id}/pawz-skill.toml`
3. Open a **Pull Request**
4. CI validates your manifest automatically
5. Maintainer reviews and merges

### Manifest Format

```toml
[skill]
id = "my-skill"
name = "My Skill"
version = "1.0.0"
author = "yourgithub"
category = "productivity"
icon = "edit_note"
description = "What this skill does (10-500 chars)"
install_hint = "How to get credentials"

[[credentials]]
key = "MY_API_KEY"
label = "API Key"
description = "Where to find this key"
required = true
placeholder = "sk-..."

[instructions]
text = """
Agent instructions go here.
Tell the agent which endpoints to call, how to authenticate, etc.
"""

[widget]
type = "table"
title = "Widget Title"
refresh = "5m"

[[widget.fields]]
key = "name"
label = "Name"
type = "text"
```

### CI Checks

| Check | Description |
|-------|-------------|
| Valid TOML | Syntax correct, required fields present |
| Unique ID | No collision with existing skills |
| Valid category | Must be: vault, cli, api, productivity, media, smart_home, communication, development, system |
| Safe ID | Alphanumeric + hyphens only |
| Semver version | `X.Y.Z` format |
| Description length | 10-500 characters |

---

## Three Tiers

| Tier | Badge | What it adds |
|------|-------|-------------|
| **Skill** | 🔵 | Prompt injection only (SKILL.md) |
| **Integration** | 🟣 | + Credentials + tools + widgets (pawz-skill.toml) |
| **Extension** | 🟡 | + Custom sidebar views + persistent storage |

---

## Security

- Credentials are **AES-256-GCM encrypted** in SQLite with a 256-bit key in the OS keychain
- Skills cannot execute arbitrary code — they only inject instructions into agent prompts
- All `fetch` calls are subject to the domain allowlist/blocklist
- All `exec` calls route through the Docker sandbox when enabled
- No skill has access to the OS keychain, engine source code, or blocked packages

---

## License

MIT — same as [OpenPawz](https://github.com/OpenPawz/openpawz).
