# OpenPawz CLI

Command-line interface to the OpenPawz AI engine. Talks directly to the same `openpawz-core` library as the desktop app — zero network overhead, shared SQLite database and configuration.

## Installation

### From source

```bash
cd src-tauri
cargo build --release -p openpawz-cli
# Binary at target/release/openpawz
```

### Move to PATH (optional)

```bash
cp target/release/openpawz ~/.local/bin/
# or
sudo cp target/release/openpawz /usr/local/bin/
```

## Quick Start

```bash
# Run the setup wizard (configures your AI provider)
openpawz setup

# Check engine status
openpawz status

# List your agents
openpawz agent list

# View chat history
openpawz session list
openpawz session history <session-id>

# Store a memory
openpawz memory store "The user prefers dark mode" --category preference --importance 7
```

## Global Flags

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--output <format>` | | Output format: `human`, `json`, `quiet` | `human` |
| `--verbose` | `-v` | Enable debug logging | off |

The `--output` flag works with every command:

```bash
# Machine-readable JSON output (for scripting)
openpawz agent list --output json

# Quiet mode — IDs only (for piping)
openpawz session list --output quiet

# Human-readable tables (default)
openpawz agent list
```

## Commands

### `setup` — Initial Setup Wizard

Interactive wizard that configures your AI provider and writes the engine config.

```bash
openpawz setup
```

Supported providers:
1. **Anthropic** (Claude) — default
2. **OpenAI** (GPT)
3. **Google** (Gemini)
4. **Ollama** (local, no API key needed)
5. **OpenRouter**

If already configured, prompts before overwriting.

---

### `status` — Engine Diagnostics

```bash
openpawz status
```

Shows:
- Engine configuration state
- AI provider status
- Memory configuration
- Data directory path
- Session count

```bash
# JSON output for monitoring scripts
openpawz status --output json
```

---

### `agent` — Agent Management

#### List all agents

```bash
openpawz agent list
```

```
AGENT ID             PROJECT              ROLE
------------------------------------------------------------
research-agent       default              researcher
code-review          backend              reviewer
```

#### Get agent details

```bash
openpawz agent get <agent-id>
```

Shows the agent's files and their sizes.

#### Create a new agent

```bash
openpawz agent create --name "Research Agent" --model claude-sonnet-4-20250514
```

The `--model` flag is optional. A unique ID is generated automatically.

#### Delete an agent

```bash
openpawz agent delete <agent-id>
```

Removes the agent and all associated files.

---

### `session` — Chat Session Management

#### List sessions

```bash
openpawz session list
openpawz session list --limit 10
```

```
ID                                       MODEL                          MSGS UPDATED
-----------------------------------------------------------------------------------------------
abc123-def456...                         claude-sonnet-4-20250514          24 2026-03-10 14:30
```

#### View chat history

```bash
openpawz session history <session-id>
openpawz session history <session-id> --limit 10
```

Messages are color-coded by role (user, assistant, system, tool).

#### Rename a session

```bash
openpawz session rename <session-id> "My Research Chat"
```

#### Delete a session

```bash
openpawz session delete <session-id>
```

#### Clean up empty sessions

```bash
openpawz session cleanup
```

Removes sessions older than 1 hour that have no messages.

---

### `config` — Engine Configuration

#### View current config

```bash
openpawz config get
```

Prints the full engine configuration as pretty-printed JSON.

#### Set a config value

```bash
openpawz config set default_model claude-sonnet-4-20250514
openpawz config set daily_budget_usd 10.0
openpawz config set max_tool_rounds 15
```

Values are parsed as JSON when possible (numbers, booleans, arrays), otherwise stored as strings.

---

### `memory` — Memory Operations

#### List memories

```bash
openpawz memory list
openpawz memory list --limit 50
```

```
[a1b2c3d4] (preference, imp:7) The user prefers dark mode
[e5f6g7h8] (fact, imp:9) Project uses Rust with Tauri

2 memor(ies)
```

#### Store a new memory

```bash
openpawz memory store "The deploy target is AWS us-east-1" \
  --category fact \
  --importance 8 \
  --agent research-agent
```

| Flag | Default | Description |
|------|---------|-------------|
| `--category` | `general` | Category: `general`, `preference`, `fact`, etc. |
| `--importance` | `5` | Importance level (0–10) |
| `--agent` | none | Associate with a specific agent |

#### Delete a memory

```bash
openpawz memory delete <memory-id>
```

---

## Scripting Examples

### Export all sessions as JSON

```bash
openpawz session list --output json > sessions.json
```

### Delete all empty sessions

```bash
openpawz session cleanup --output quiet
```

### List agent IDs (for piping)

```bash
openpawz agent list --output quiet | while read id; do
  echo "Agent: $id"
  openpawz agent get "$id" --output json
done
```

### Check if engine is configured (CI/scripts)

```bash
if openpawz status --output json | grep -q '"provider": "configured"'; then
  echo "Engine ready"
else
  echo "Run: openpawz setup"
  exit 1
fi
```

## Data Location

The CLI shares the same data directory as the desktop app:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/com.openpawz.app/` |
| Linux | `~/.local/share/com.openpawz.app/` |
| Windows | `%APPDATA%\com.openpawz.app\` |

The SQLite database, agent files, and configuration are all stored here. Changes made via the CLI are immediately visible in the desktop app and vice versa.

## Security

- All cryptographic operations use AES-256-GCM with OS CSPRNG (`getrandom`) for key/nonce generation
- Key material is stored in the OS keychain (macOS Keychain / GNOME Keyring / Windows Credential Manager)
- In-memory keys are wrapped in `Zeroizing<Vec<u8>>` — securely wiped on drop
- Per-agent key derivation via HKDF-SHA256 with domain separation
- PII auto-detection (17 regex patterns) classifies memories into security tiers
- HMAC-SHA256 chained audit log for tamper-evident operation history
- API keys entered during `setup` are stored in the engine config — consider encrypting them through the skill vault for production use
