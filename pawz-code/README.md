# Pawz CODE

A standalone developer AI agent — isolated from the main Pawz app so it can work on the OpenPawz codebase without ever breaking itself.

## The idea

Pawz Desktop is the full platform. **Pawz CODE** is a stripped sidecar that:

- Runs as a background service on your machine
- Knows your codebase inside out (persistent Engram memory in `~/.pawz-code/`)
- Has full code tools: `exec`, `read_file`, `write_file`, `list_directory`, `grep`, `fetch`
- Exposes the exact same `/chat/stream` SSE endpoint the VS Code extension already speaks
- Has **zero dependency** on the Tauri app, SQLite schema, or channels it's working on

If the OpenPawz build explodes, Pawz CODE keeps running. The surgeon never stands in the operating room.

---

## Structure

```
pawz-code/
  server/                  Rust binary — the agent service
    Cargo.toml
    src/
      main.rs              HTTP server (axum), auth middleware, SSE route
      config.rs            ~/.pawz-code/config.toml
      state.rs             AppState: config + SQLite + broadcast channel
      types.rs             EngineEvent (same wire format as Pawz Desktop)
      memory.rs            Conversation history + pinned notes (SQLite)
      tools.rs             exec, read_file, write_file, list_directory, grep, fetch, remember, recall
      provider.rs          Anthropic + OpenAI-compatible streaming parsers
      agent.rs             The agent loop: LLM → tools → LLM → ...

  vscode-extension/        VS Code extension — use @code in chat
    package.json           Contributes chatParticipant id "pawz-code" (@code)
    tsconfig.json
    src/
      extension.ts         Chat participant, diff command, workspace context injection
      pawz-client.ts       SSE streaming client (same protocol as Pawz Desktop)
      tool-renderer.ts     Maps EngineEvents → VS Code ChatResponseStream
```

---

## Quick start

### 1. Configure

On first run the binary creates `~/.pawz-code/config.toml`:

```toml
port = 3941
bind = "127.0.0.1"
auth_token = "auto-generated"
provider = "anthropic"
api_key = ""           # ← add your API key here
model = "claude-opus-4-5"
max_rounds = 20
workspace_root = ""    # ← optional: absolute path to your repo
```

Set `api_key` (Anthropic or OpenAI key) and optionally `workspace_root`.

Supported providers:

| `provider`  | `base_url`            | Models                          |
|-------------|----------------------|----------------------------------|
| `anthropic` | (auto)               | `claude-opus-4-5`, etc.        |
| `openai`    | (auto)               | `gpt-4o`, `o1`, etc.            |
| `openai`    | `http://localhost:11434` | any Ollama model            |
| `openai`    | `https://openrouter.ai/api` | any OpenRouter model       |

### 2. Build and run

```bash
cd pawz-code/server
cargo build --release
./target/release/pawz-code
```

Or for development:

```bash
cargo run
```

You should see:
```
[pawz-code] Listening on http://127.0.0.1:3941
[pawz-code] VS Code: set pawzCode.serverUrl = http://127.0.0.1:3941
```

### 3. Install the VS Code extension

```bash
cd pawz-code/vscode-extension
npm install
npm run package          # produces pawz-code-0.1.0.vsix
```

Then in VS Code: **Extensions → ⋯ → Install from VSIX** → select the `.vsix`.

### 4. Configure VS Code

Open VS Code settings and set:

```json
"pawzCode.serverUrl": "http://127.0.0.1:3941",
"pawzCode.authToken": "<paste from config.toml>"
```

### 5. Use it

In any VS Code chat panel: `@code what does the webhook.rs SSE handler do?`

---

## Tools available

| Tool | What it does |
|------|-------------|
| `exec` | Run any shell command (`git`, `cargo`, `pnpm`, `gh`, etc.) |
| `read_file` | Read file contents, optionally by line range |
| `write_file` | Write/overwrite a file, creates parent dirs |
| `list_directory` | List directory contents, optionally recursive |
| `grep` | Regex search across files with context lines |
| `fetch` | HTTP GET/POST for docs, APIs, URLs |
| `remember` | Persist a named note to long-term memory |
| `recall` | Search long-term memory notes |

---

## Memory

All conversation history is stored in `~/.pawz-code/memory.db` (SQLite). The agent builds a persistent picture of the codebase across sessions via `remember` calls.

When the container restarts, the server boots and loads the same DB — no context lost.

---

## Why separate from Pawz Desktop?

Pawz Desktop manages Discord, Telegram, trading, OAuth, n8n flows, and dozens of other things. Pawz CODE only needs a model, a DB, and code tools. Keeping them separate means:

- No shared port conflicts
- No shared DB schema coupling
- If OpenPawz refactors its engine, Pawz CODE is unaffected
- Pawz CODE can be deployed in any Docker container or CI environment
- Operator access to the Tauri app is not required
