# Paw — Security Architecture & Roadmap

Paw is a Tauri 2 desktop AI agent with a Rust backend engine. Every system call flows through the Rust backend before reaching the OS, making it the natural enforcement point for security controls. This document tracks what's built, what's missing, and what to build next.

---

## Table of Contents

1. [Architecture Advantage](#architecture-advantage)
2. [What's Already Built](#whats-already-built)
3. [What's Missing — Critical](#whats-missing--critical)
4. [What's Missing — High Priority](#whats-missing--high-priority)
5. [What's Missing — Medium Priority](#whats-missing--medium-priority)
6. [Implementation Plan](#implementation-plan)
7. [File Reference](#file-reference)

---

## Architecture Advantage

```
┌─────────────────────────────────────────────────────────┐
│  User (Paw UI)                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Frontend (TypeScript)                           │   │
│  │  • Approval modal (Allow/Deny)                   │   │
│  │  • Permission toggles                            │   │
│  │  • Audit log viewer                              │   │
│  └──────────────┬───────────────────────────────────┘   │
│                 │ Tauri IPC (structured commands)        │
│  ┌──────────────▼───────────────────────────────────┐   │
│  │  Rust Engine Backend                             │   │
│  │  • Agent loop (providers.rs, agent_loop.rs)      │   │
│  │  • Tool executor with HIL (tool_executor.rs)     │   │
│  │  • OS Keychain (keyring crate)                   │   │
│  │  • File permissions (chmod 0o600)                │   │
│  │  • Filesystem scope enforcement                  │   │
│  │  • Channel bridges (Telegram, Discord, etc.)     │   │
│  │  • Session store (SQLite)                        │   │
│  └──────────────┬───────────────────────────────────┘   │
│                 │                                        │
│                 ▼                                        │
│           Operating System                               │
└─────────────────────────────────────────────────────────┘
```

**Key insight**: The agent never touches the OS directly. Every tool call goes through the Rust tool executor → Paw emits an `engine-event` (ToolRequest) → the frontend shows an approval modal → user decides → `engine_approve_tool` resolves. This is the Human-in-the-Loop (HIL) protocol. The gap is that Paw currently shows all requests the same way — `sudo rm -rf /` looks identical to `git status`.

---

## What's Already Built

### 1. HIL — Human-in-the-Loop (Exec Approvals) ✅

| Component | Status | Location |
|-----------|--------|----------|
| Live approval modal | ✅ | `main.ts` — `engine-event` ToolRequest listener |
| Allow / Deny buttons | ✅ | `main.ts` — resolves via `engine_approve_tool` Tauri command |
| Approval policy toggles | ✅ | Settings → visual toggle switches per category |
| Allowlist / Denylist config | ✅ | Per-tool-category allow/deny rules |
| Auto-deny for mail permissions | ✅ | `classifyMailPermission()` checks Credential Vault toggles first |
| Approval details shown | ✅ | Modal shows tool name + full JSON args |

**Gap**: No risk classification. A `sudo` command looks the same as `ls`. No command allowlisting.

### 2. File Permissions (chmod) ✅

| Component | Status | Location |
|-----------|--------|----------|
| `set_owner_only_permissions()` | ✅ | `lib.rs` — sets `0o600` on sensitive files |
| Applied to config files | ✅ | After writing email/channel configs |
| No-op on non-Unix | ✅ | Windows ACL not handled |

**Gap**: Only protects Paw's own config files. Agent can run `chmod 777` on anything else.

### 3. OS Keychain ✅

| Component | Status | Location |
|-----------|--------|----------|
| Password storage | ✅ | `lib.rs` — `keyring::Entry::new()` + `.set_password()` |
| Keychain check | ✅ | `keyring_has_password` Tauri command |
| Keychain delete | ✅ | `keyring_delete_password` Tauri command |
| Never plaintext | ✅ | Config files contain keyring references, not passwords |

**No gaps** — this is solid.

### 4. Tauri Filesystem Scope ✅ (Partial)

| Component | Status | Location |
|-----------|--------|----------|
| Scoped to `~/Documents/Paw/**` | ✅ | `capabilities/default.json` |
| Shell limited to `open` | ✅ | `capabilities/default.json` — `shell:allow-open` only |
| SQL operations scoped | ✅ | `sql:allow-load/execute/select/close` |

**Gap**: Scope is broad — entire `~/Documents/Paw` tree. No per-project scoping. Projects view can browse any directory.

### 5. Credential Audit Log ✅

| Component | Status | Location |
|-----------|--------|----------|
| SQLite `credential_activity_log` table | ✅ | `db.ts` |
| Logs all agent email actions | ✅ | `db.ts` — insert with action, tool, detail, was_allowed |
| Viewable in Mail sidebar | ✅ | Mail view → collapsible activity log |

**Gap**: Only covers email/credential actions. No unified audit trail for shell commands, file writes, network requests.

### 6. Channel Access Policies ✅

| Component | Status | Location |
|-----------|--------|----------|
| DM Policy per channel | ✅ | Per-channel config — pairing / allowlist / open |
| Pairing approval | ✅ | New users send pairing request → approved in Paw → confirmation sent back |
| Allowed users list | ✅ | Per-channel allowlist (user IDs) |
| 9 channel bridges | ✅ | Telegram, Discord, IRC, Slack, Matrix, Mattermost, Nextcloud Talk, Nostr, Twitch |

**No gaps** for channel-level access control.

### 7. API Key Security ✅

| Component | Status | Location |
|-----------|--------|----------|
| Provider API keys stored in engine config | ✅ | `commands.rs` — persisted to SQLite via `engine_config` key |
| Ollama needs no API key | ✅ | Local provider, no credentials needed |
| Keys never sent to frontend logs | ✅ | Console logs redact key values |

---

## What's Missing — Critical

### C1. sudo / su / Privilege Escalation Detection ✅

**Risk**: Agent can request `sudo rm -rf /`, `su -c 'dangerous'`, `doas`, `pkexec`, or any privilege escalation command. The approval modal shows it, but it looks the same as a safe command. Users click "Allow" without reading.

**Built** (Sprint A — 2026-02-15):

- [x] **Dangerous command classifier** — `src/security.ts` pattern-matches tool call requests against 30+ danger patterns across critical/high/medium risk levels
- [x] **Red "DANGER" modal variant** — when a dangerous command is detected, shows a visually distinct warning (red border, skull icon, risk banner with level + reason)
- [x] **Auto-deny option for privilege escalation** — toggle in Settings: "Auto-deny privilege escalation" blocks sudo/su/doas/pkexec/runas automatically
- [x] **Auto-deny all critical commands** — toggle in Settings: "Auto-deny all critical-risk commands"
- [x] **Require explicit typing to approve** — for critical commands, user must type "ALLOW" instead of clicking a button (configurable)

**Patterns detected**:
```
sudo, su, doas, pkexec, runas           — privilege escalation
rm -rf /, rm -rf ~, rm -rf /*          — destructive deletion
chmod 777, chmod -R 777                 — permission exposure
dd if=, mkfs, fdisk                     — disk destruction
:(){ :|:& };:                           — fork bomb
> /dev/sda, > /dev/null (pipes)         — device writes
curl | sh, wget | sh, curl | bash      — remote code execution
eval, exec (with untrusted input)       — code injection
kill -9 1, killall                      — process termination
iptables -F, ufw disable               — firewall disabling
passwd, chpasswd, usermod               — user account modification
crontab -r                              — cron destruction
ssh-keygen -f (overwriting)             — key destruction
```

### C2. Content Security Policy (CSP) ✅

**Built** (Sprint A — 2026-02-15):

- [x] **Set restrictive CSP** in `tauri.conf.json` — `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* ...; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'`
- [x] **Block external script loading** — only `'self'` origin allowed
- [x] **Allow data: URIs for images** — needed for attachment previews

### C3. Command Allowlist / Denylist ✅

**Built** (Sprint A — 2026-02-15):

- [x] **Command allowlist in Settings** — regex patterns for auto-approved commands with sensible defaults (git, npm, node, python, ls, cat, etc.)
- [x] **Command denylist in Settings** — regex patterns for auto-denied commands with sensible defaults (sudo, rm -rf /, chmod 777, curl|sh, etc.)
- [x] **Policy modes** — auto-deny (privilege escalation, critical), auto-approve (allowlist), or manual (modal) per command
- [x] **Persist to localStorage** — `paw_security_settings` key with all toggles + patterns
- [x] **New SQLite tables** — `security_audit_log` for unified event logging, `security_rules` for persistent rule storage
- [x] **Regex validation** — patterns are validated before saving, invalid regex shows error toast

**Also built** (Sprint D — 2026-02-15):

- [x] **Per-session overrides** — "Allow all for this session" with timer options (30min, 1hr, 2hr) in approval modal footer. Auto-approval with security audit logging, auto-expires, cancel via Settings banner. Privilege escalation still blocked during override.

---

## What's Missing — High Priority

### H1. Unified Security Audit Dashboard ✅

**Built** (Sprint A + Sprint B — 2026-02-15):

- [x] **New SQLite table `security_audit_log`** — all security-relevant events with: event_type, risk_level, tool_name, command, detail, session_key, was_allowed, matched_pattern
- [x] **`security_rules` table** — persistent storage for user-defined allow/deny patterns
- [x] **Logging from approval handler** — all auto-deny, auto-allow, and user decisions are logged to `security_audit_log`
- [x] **CRUD functions** — `logSecurityEvent()`, `getSecurityAuditLog()`, `listSecurityRules()`, `addSecurityRule()`, etc.
- [x] **Audit dashboard UI** — dedicated section in Settings with sortable/filterable table
- [x] **Filterable by type, date, severity** — dropdown filters for event type, risk level, and result count
- [x] **Export to JSON/CSV** — one-click export buttons in the dashboard
- [x] **Security score widget** — quick stats: CSP active, blocked count, allowed count, critical count

### H2. Skill Vetting / Package Safety ✅

**Risk**: `skills.install` installs npm packages with no safety check. A malicious skill package could contain arbitrary code.

**Built** (Sprint B — 2026-02-15):

- [x] **Pre-install safety confirmation** — modal dialog showing safety checks before every skill install
- [x] **Known-safe skills list** — built-in set of community-vetted skill names (web-search, git, memory, etc.)
- [x] **Warning for unrecognized packages** — "Unrecognized skill — not in known-safe list" with ⚠ badge
- [x] **npm install script warning** — alerts that npm packages run install scripts
- [x] **Security audit logging** — all skill install decisions logged to `security_audit_log`

**Also built** (Sprint D — 2026-02-15):

- [x] **npm registry risk intelligence** — fetches package metadata from npm registry (version, weekly downloads, last publish date, license, maintainer count) + download counts from npm downloads API. Timeout-guarded (5s/3s)
- [x] **Risk score display** — shows risk panel in safety dialog: download count, last publish date, deprecation warnings, low-download warnings, maintainer count, version, license
- [x] **Post-install sandbox check** — after install, verifies skill metadata for suspicious tool registrations (exec/shell/eval/spawn/process/system) and unexpected capabilities (network/filesystem write). Logs warnings to security audit log

### H3. Filesystem Sandboxing Hardening ✅

**Built** (Sprint B — 2026-02-15):

- [x] **Sensitive path blocking** — blocks adding `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`, `~/.docker`, `/etc`, `/root`, `/proc`, `/sys`, `/dev`, filesystem root, and home directory root as project folders
- [x] **File tree protection** — sensitive directories hidden from file tree browsing within projects
- [x] **Security audit logging** — blocked path attempts logged to `security_audit_log`

**Also built** (Sprint D — 2026-02-15):

- [x] **Per-project filesystem scope** — scope guard validates all file ops against active project root, blocks traversal, audit logging
- [x] **Read-only project mode** — toggle in Security Policies to block all agent filesystem write tools (create, edit, delete, move, chmod, etc.)
- [x] **Agent filesystem write restrictions** — `isFilesystemWriteTool()` detects write_file, create_file, mv, cp, rename, remove, delete, mkdir, rmdir, chmod, chown, truncate, append, patch, edit plus command-level detection (mv, cp, rm, mkdir, touch, sed -i, tee, install). Auto-deny with security audit logging when read-only mode is enabled

### H4. Token Auto-Rotation ✅

**Built** (Sprint D — 2026-02-15):

- [x] **Auto-rotation schedule** — configurable interval (7/14/30/60/90 days or disabled) via dropdown in Security Policies
- [x] **Token age display** — device cards show days since pairing with stale (30d+) and critical (90d+) visual warnings

---

## What's Missing — Medium Priority

### M1. Network Sandboxing ❌

**Risk**: The agent can make HTTP requests to any domain via tool calls.

**What to build**:

- [ ] **Outbound domain allowlist** — restrict which domains the agent can reach
- [ ] **Log all outbound requests** — audit trail of network activity
- [ ] **Block exfiltration patterns** — detect if agent is sending local data to unknown domains

**Difficulty**: Hard — requires inspecting tool call args for `curl`/`wget`/`fetch` commands.

**Partially built**: Network request auditing (`security.ts`) detects outbound tool calls and exfiltration patterns, with audit logging + modal banners. But no outbound domain allowlist yet.

### M2. Encryption at Rest ✅

**Built** (Sprint C — 2026-02-15):

- [x] **AES-256-GCM field encryption** — via Web Crypto API
- [x] **Key derivation from OS keychain** — encryption key stored in system keychain
- [x] **Encryption status indicator** — visible in Settings

### M3. Session Isolation ❌

**Risk**: All sessions share the same agent context. One session could theoretically access another's data.

**What to build**:

- [ ] **Session-aware approvals** — show which session is requesting a tool call
- [ ] **Per-session filesystem scope** — different sessions get different allowed paths
- [ ] **Session kill switch** — terminate a specific session's agent run if it goes rogue

### M4. Crash Recovery ✅

**Built** (Sprint C — 2026-02-15):

- [x] **Watchdog with crash detection** — periodic health checks
- [x] **Auto-restart** — up to 5 attempts with backoff
- [x] **Crash logging** — captures last state before crash
- [x] **Status notifications** — user informed of crashes and recovery

---

## Implementation Plan

### Sprint A — Critical Security ✅ COMPLETE (2026-02-15)

| # | Task | Status | Files |
|---|------|--------|-------|
| A1 | Dangerous command classifier + red modal | ✅ | `src/security.ts`, `main.ts`, `styles.css`, `index.html` |
| A2 | Set proper CSP in tauri.conf.json | ✅ | `src-tauri/tauri.conf.json` |
| A3 | Command allowlist/denylist UI in Settings | ✅ | `settings.ts`, `db.ts`, `main.ts`, `index.html` |
| A4 | Auto-deny sudo/su toggle | ✅ | `src/security.ts`, `main.ts`, `settings.ts`, `index.html` |

### Sprint B — Audit & Trust ✅ COMPLETE (2026-02-15)

| # | Task | Status | Files |
|---|------|--------|-------|
| B1 | Security audit dashboard UI | ✅ | `settings.ts`, `index.html`, `styles.css` |
| B2 | Skill vetting pre-install safety | ✅ | `skills.ts` |
| B3 | Token age display + rotation reminder | ✅ | `settings.ts` |
| B4 | Sensitive path blocking for Projects | ✅ | `projects.ts` |

### Sprint C — Hardening ✅ COMPLETE (2026-02-15)

| # | Task | Status | Files |
|---|------|--------|-------|
| C1 | Per-project scope enforcement | ✅ | `projects.ts` |
| C2 | Database encryption at rest | ✅ | `lib.rs`, `db.ts`, `settings.ts` |
| C3 | Crash watchdog + auto-restart | ✅ | `main.ts` |
| C4 | Network request auditing | ✅ | `security.ts`, `main.ts`, `styles.css` |

### Sprint D — Completion ✅ COMPLETE (2026-02-15)

| # | Task | Status | Files |
|---|------|--------|-------|
| D1 | Per-session override timer | ✅ | `security.ts`, `main.ts`, `settings.ts`, `index.html`, `styles.css` |
| D2 | Token auto-rotation schedule | ✅ | `security.ts`, `settings.ts`, `index.html` |
| D3 | Read-only project mode | ✅ | `security.ts`, `main.ts`, `index.html`, `settings.ts` |
| D4 | npm registry risk score | ✅ | `skills.ts`, `styles.css` |

---

## Security Protocols Summary

| Protocol | Status | Paw Component |
|----------|--------|---------------|
| **HIL (Human-in-the-Loop)** | ✅ Built | Tool approval modal via `engine-event` + `engine_approve_tool`, mail permission auto-deny |
| **chmod (file permissions)** | ✅ Built (own files) | `set_owner_only_permissions()` on config files |
| **sudo/su detection** | ✅ Built | `src/security.ts` — pattern matching + auto-deny toggle + 30+ danger patterns |
| **Dangerous command classifier** | ✅ Built | Risk classification (critical/high/medium), red DANGER modal, type-to-confirm |
| **Command allowlist/denylist** | ✅ Built | Regex patterns in Settings, auto-approve safe commands, auto-deny dangerous ones |
| **OS Keychain** | ✅ Built | Rust `keyring` crate — macOS Keychain / libsecret / Windows |
| **Filesystem sandbox** | ✅ Built | Tauri scope + per-project scope guard + sensitive path blocking (20+ patterns) |
| **CSP** | ✅ Built | Restrictive CSP: self-only scripts, no external loads |
| **Credential audit** | ✅ Built (mail) | `credential_activity_log` table |
| **Security audit log** | ✅ Built | `security_audit_log` table + filterable dashboard UI with export (JSON/CSV) |
| **Channel access control** | ✅ Built | Per-channel DM/group policies with pairing + allowlists across 9 bridges |
| **Skill vetting** | ✅ Built | Pre-install safety confirmation, known-safe list, npm risk score, post-install sandbox check |
| **Token rotation** | ✅ Built | Auto-rotation schedule (7–90 days) + stale/critical warnings |
| **Encryption at rest** | ✅ Built | AES-256-GCM field encryption via Web Crypto API, key stored in OS keychain |
| **Network request auditing** | ✅ Built | Outbound tool detection, URL extraction, exfiltration pattern detection, audit logging |
| **Crash recovery** | ✅ Built | Watchdog with crash detection, 5-attempt auto-restart, crash logging |

---

## File Reference

| File | Security Role |
|------|---------------|
| `src-tauri/src/lib.rs` | Rust backend — keychain, chmod, DB encryption key |
| `src-tauri/src/engine/commands.rs` | Engine commands — tool approvals via `PendingApprovals` (oneshot channels) |
| `src-tauri/src/engine/tool_executor.rs` | Tool executor — HIL approval flow, tool timeout enforcement |
| `src-tauri/src/engine/agent_loop.rs` | Agent loop — max tool rounds limit, error boundaries |
| `src-tauri/src/engine/sessions.rs` | Session store — SQLite, conversation isolation |
| `src-tauri/tauri.conf.json` | CSP config (restrictive policy), bundle config |
| `src-tauri/capabilities/default.json` | Filesystem scope, shell permissions |
| `src/security.ts` | Dangerous command classifier, risk patterns, security settings, allowlist/denylist, network request auditing |
| `src/main.ts` | Tool approval handler (risk classification, auto-deny/allow, danger modal, network audit banner), crash watchdog |
| `src/db.ts` | `security_audit_log` + `security_rules` tables, AES-GCM field encryption via Web Crypto API |
| `src/views/settings.ts` | Approval toggles, security policies, audit dashboard, encryption status, token management |
| `src/views/skills.ts` | Skill install (safety confirmation + known-safe list + npm risk score) |
| `src/views/projects.ts` | File browser (sensitive path blocking + per-project scope guard) |
