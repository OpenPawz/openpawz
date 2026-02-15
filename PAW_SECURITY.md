# Paw — Security Architecture & Roadmap

Paw is a Tauri 2 desktop wrapper around OpenClaw. Because every system call flows through Paw's Rust backend before reaching the OS, it's the natural enforcement point for security controls. This document tracks what's built, what's missing, and what to build next.

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
│  │  Rust Backend (lib.rs)                           │   │
│  │  • OS Keychain (keyring crate)                   │   │
│  │  • File permissions (chmod 0o600)                │   │
│  │  • Filesystem scope enforcement                  │   │
│  │  • ⚠️  NO command filtering yet                  │   │
│  └──────────────┬───────────────────────────────────┘   │
│                 │                                        │
│  ┌──────────────▼───────────────────────────────────┐   │
│  │  OpenClaw Gateway (WebSocket)                    │   │
│  │  • exec.approval.requested → Paw approves/denies│   │
│  │  • Agent tool calls intercepted                   │   │
│  │  • Auth token required for connection             │   │
│  └──────────────┬───────────────────────────────────┘   │
│                 │                                        │
│                 ▼                                        │
│           Operating System                               │
└─────────────────────────────────────────────────────────┘
```

**Key insight**: The agent never touches the OS directly. Every tool call goes through `exec.approval.requested` → Paw shows a modal → user decides. This is the Human-in-the-Loop (HIL) protocol. The gap is that Paw currently shows all requests the same way — `sudo rm -rf /` looks identical to `git status`.

---

## What's Already Built

### 1. HIL — Human-in-the-Loop (Exec Approvals) ✅

| Component | Status | Location |
|-----------|--------|----------|
| Live approval modal | ✅ | `main.ts:3021` — `exec.approval.requested` event listener |
| Allow / Deny buttons | ✅ | `main.ts:3081-3089` — resolves via `exec.approvals.resolve` |
| Approval policy toggles | ✅ | Settings → visual toggle switches per category |
| Allowlist / Denylist config | ✅ | `exec.approvals.get/set` — per-tool-category allow/deny |
| Per-node approval rules | ✅ | `exec.approvals.node.get/set` — separate rules for remote nodes |
| Auto-deny for mail permissions | ✅ | `classifyMailPermission()` checks Credential Vault toggles first |
| Approval details shown | ✅ | Modal shows tool name + full JSON args |

**Gap**: No risk classification. A `sudo` command looks the same as `ls`. No command allowlisting.

### 2. File Permissions (chmod) ✅

| Component | Status | Location |
|-----------|--------|----------|
| `set_owner_only_permissions()` | ✅ | `lib.rs:12` — sets `0o600` on sensitive files |
| Applied to himalaya config | ✅ | `lib.rs:1646` — after writing email config |
| Applied after account removal | ✅ | `lib.rs:1753` — after removing account from config |
| No-op on non-Unix | ✅ | `lib.rs:20` — Windows ACL not handled |

**Gap**: Only protects Paw's own config files. Agent can run `chmod 777` on anything else.

### 3. OS Keychain ✅

| Component | Status | Location |
|-----------|--------|----------|
| Password storage | ✅ | `lib.rs:1570` — `keyring::Entry::new()` + `.set_password()` |
| Keychain check | ✅ | `keyring_has_password` Tauri command |
| Keychain delete | ✅ | `keyring_delete_password` Tauri command |
| Never plaintext | ✅ | Config files contain keyring references, not passwords |

**No gaps** — this is solid.

### 4. Tauri Filesystem Scope ✅ (Partial)

| Component | Status | Location |
|-----------|--------|----------|
| Scoped to `~/Documents/Paw/**` | ✅ | `capabilities/default.json:23-27` |
| Shell limited to `open` | ✅ | `capabilities/default.json:29` — `shell:allow-open` only |
| SQL operations scoped | ✅ | `sql:allow-load/execute/select/close` |

**Gap**: Scope is broad — entire `~/Documents/Paw` tree. No per-project scoping. Projects view uses `window.__TAURI__?.dialog` which bypasses scope.

### 5. Gateway Auth Token ✅

| Component | Status | Location |
|-----------|--------|----------|
| Token-based WebSocket auth | ✅ | `gateway.ts` — sends token on connect |
| Token read from config | ✅ | `lib.rs` — `get_gateway_token` reads `~/.openclaw/openclaw.json` |
| Per-device token rotation | ✅ | `device.token.rotate` wired in Settings |
| Per-device token revocation | ✅ | `device.token.revoke` wired in Settings |

**Gap**: No auto-rotation schedule. Token never expires unless manually rotated.

### 6. Credential Audit Log ✅

| Component | Status | Location |
|-----------|--------|----------|
| SQLite `credential_activity_log` table | ✅ | `db.ts:139` |
| Logs all agent email actions | ✅ | `db.ts:338` — insert with action, tool, detail, was_allowed |
| Viewable in Mail sidebar | ✅ | Mail view → collapsible activity log |

**Gap**: Only covers email/credential actions. No unified audit trail for shell commands, file writes, network requests.

### 7. Channel Access Policies ✅

| Component | Status | Location |
|-----------|--------|----------|
| DM Policy per channel | ✅ | `main.ts:1676` — pairing / allowlist / open / disabled |
| Group Policy per channel | ✅ | `main.ts:1686` — allowlist / open / disabled |
| Allowed users list | ✅ | Per-channel comma-separated allowlist |

**No gaps** for channel-level access control.

### 8. Config Redaction Warning ✅

| Component | Status | Location |
|-----------|--------|----------|
| Detects `__OPENCLAW_REDACTED__` | ✅ | `main.ts` — warns before saving corrupted config |
| Confirmation dialog | ✅ | User must explicitly confirm to save redacted values |

---

## What's Missing — Critical

### C1. sudo / su / Privilege Escalation Detection ❌

**Risk**: Agent can request `sudo rm -rf /`, `su -c 'dangerous'`, `doas`, `pkexec`, or any privilege escalation command. The approval modal shows it, but it looks the same as a safe command. Users click "Allow" without reading.

**What to build**:

- [ ] **Dangerous command classifier** — pattern-match exec approval requests against a blocklist
- [ ] **Red "DANGER" modal variant** — when a dangerous command is detected, show a visually distinct warning (red border, skull icon, "This command requests elevated privileges")
- [ ] **Auto-deny option for privilege escalation** — toggle in Settings: "Never allow sudo/su commands"
- [ ] **Require explicit typing to approve** — for dangerous commands, user must type "ALLOW" instead of clicking a button

**Patterns to detect**:
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

**Location**: Enhance `exec.approval.requested` handler in `main.ts:3021`

### C2. Content Security Policy (CSP) ❌

**Risk**: `tauri.conf.json` has `"csp": null` — no Content Security Policy at all. A compromised frontend could load arbitrary scripts, make requests to any domain, etc.

**What to build**:

- [ ] **Set restrictive CSP** in `tauri.conf.json`:
  ```json
  "security": {
    "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*; img-src 'self' data:; font-src 'self'"
  }
  ```
- [ ] **Block external script loading** — only allow `'self'` origin
- [ ] **Restrict WebSocket connections** — only `ws://127.0.0.1:*` (localhost gateway)
- [ ] **Allow data: URIs for images** — needed for attachment previews

**Location**: `src-tauri/tauri.conf.json:24-26`

### C3. Command Allowlist / Denylist ❌

**Risk**: The current exec approval system is binary (allow/deny per request). No way to pre-approve safe commands or permanently block dangerous ones.

**What to build**:

- [ ] **Command allowlist in Settings** — regex patterns for auto-approved commands
  - Default safe list: `git *`, `npm *`, `node *`, `python *`, `ls`, `cat`, `echo`, `pwd`, `which`, `find` (read-only variants)
- [ ] **Command denylist in Settings** — regex patterns for auto-denied commands
  - Default deny list: `sudo *`, `su *`, `rm -rf /`, `chmod 777 *`, `dd if=*`, `curl * | sh`
- [ ] **Policy modes**:
  - `ask` (default) — show modal for every command
  - `allowlist` — auto-approve allowlisted, ask for everything else
  - `strict` — auto-approve allowlisted, auto-deny everything else
- [ ] **Per-session overrides** — "Allow all for this session" with a timer (30min, 1hr)
- [ ] **Persist to SQLite** — new `security_rules` table

**Location**: New section in Settings view, new table in `db.ts`

---

## What's Missing — High Priority

### H1. Unified Security Audit Dashboard ❌

**What to build**:

- [ ] **Unified audit log** — combine credential activity log + exec approval decisions + skill installs into one view
- [ ] **New SQLite table `security_audit_log`** — all security-relevant events:
  - `exec_approval` — tool approved/denied, with tool name + args + timestamp
  - `credential_access` — email password read/used
  - `skill_install` — skill package installed
  - `config_change` — gateway config modified
  - `token_rotate` — device token rotated/revoked
  - `login_attempt` — channel login attempt
- [ ] **Filterable by type, date, severity**
- [ ] **Export to JSON/CSV** for compliance
- [ ] **Security score widget** — quick health check (CSP set? Token rotated recently? Audit log clean?)

### H2. Skill Vetting / Package Safety ❌

**Risk**: `skills.install` installs npm packages with no safety check. A malicious skill package could contain arbitrary code.

**What to build**:

- [ ] **Pre-install safety check** — before `skills.install`, run `npm audit` on the package
- [ ] **Risk score display** — show download count, last publish date, known vulnerabilities
- [ ] **Verified skills badge** — maintain a list of known-safe skills (or pull from community list)
- [ ] **Warn on first-time packages** — "This skill has never been installed before. Are you sure?"
- [ ] **Post-install sandbox check** — verify the skill doesn't request unexpected permissions

### H3. Filesystem Sandboxing Hardening ❌

**Current**: Tauri scope is `$HOME/Documents/Paw/**`. Projects view can browse any directory.

**What to build**:

- [ ] **Per-project filesystem scope** — when a project folder is added, scope Tauri to that specific path
- [ ] **Block traversal outside scope** — Projects view shouldn't allow `../../../etc/passwd`
- [ ] **Read-only mode** — option to browse project files read-only (agent can read but not write)
- [ ] **Sensitive path blocking** — never allow browsing `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.*` dirs
- [ ] **Agent filesystem restrictions** — through exec approvals, restrict which paths the agent can write to

### H4. Token Auto-Rotation ❌

**Current**: Gateway token never expires unless manually rotated via `device.token.rotate`.

**What to build**:

- [ ] **Auto-rotation schedule** — configurable interval (weekly, monthly, on-upgrade)
- [ ] **Rotation reminder** — Settings badge: "Token hasn't been rotated in 30 days"
- [ ] **Token age display** — show when the token was last rotated
- [ ] **Auto-rotate on update** — when OpenClaw is updated, offer to rotate the token

---

## What's Missing — Medium Priority

### M1. Network Sandboxing ❌

**Risk**: The agent can make HTTP requests to any domain via tool calls.

**What to build**:

- [ ] **Outbound domain allowlist** — restrict which domains the agent can reach
- [ ] **Log all outbound requests** — audit trail of network activity
- [ ] **Block exfiltration patterns** — detect if agent is sending local data to unknown domains

**Difficulty**: Hard — requires either a proxy layer or Tauri plugin. May need to inspect exec approval args for `curl`/`wget`/`fetch` commands.

### M2. Encryption at Rest ❌

**Risk**: `paw.db` (SQLite) stores email data, credential logs, project files in plaintext on disk.

**What to build**:

- [ ] **SQLCipher integration** — encrypt the SQLite database
- [ ] **Key derivation from OS keychain** — derive encryption key from a keychain-stored secret
- [ ] **Encrypt config files** — `~/.openclaw/openclaw.json` contains the gateway auth token in plaintext

### M3. Session Isolation ❌

**Risk**: All sessions share the same agent context. One session could theoretically access another's data.

**What to build**:

- [ ] **Session-aware exec approvals** — show which session is requesting a tool call
- [ ] **Per-session filesystem scope** — different sessions get different allowed paths
- [ ] **Session kill switch** — terminate a specific session's agent run if it goes rogue

### M4. Gateway Connection Security ❌

**Current**: WebSocket connects to `ws://127.0.0.1:port` — unencrypted localhost.

**What to build**:

- [ ] **Validate localhost-only** — ensure gateway never binds to `0.0.0.0`
- [ ] **Optional TLS for remote gateway** — support `wss://` when gateway is running on a different machine
- [ ] **Connection integrity check** — verify the handshake nonce to prevent MITM on localhost

### M5. Crash Recovery & Watchdog ❌

**Risk**: If the gateway crashes, the agent dies silently. No auto-restart, no user guidance.

**What to build**:

- [ ] **Health check watchdog** — periodic ping, auto-restart gateway if it dies
- [ ] **Crash notification** — "Gateway stopped unexpectedly. Restart now?"
- [ ] **Crash log capture** — save last stdout/stderr before crash

---

## Implementation Plan

### Sprint A — Critical Security (Immediate)

| # | Task | Effort | Files |
|---|------|--------|-------|
| A1 | Dangerous command classifier + red modal | 1 day | `main.ts` (exec approval handler), `styles.css`, `index.html` (modal variant) |
| A2 | Set proper CSP in tauri.conf.json | 30 min | `src-tauri/tauri.conf.json` |
| A3 | Command allowlist/denylist UI in Settings | 1 day | `settings.ts`, `db.ts` (new table), `main.ts` (exec approval handler) |
| A4 | Auto-deny sudo/su toggle | 30 min | `main.ts` (pattern check in exec approval handler) |

### Sprint B — Audit & Trust (Next)

| # | Task | Effort | Files |
|---|------|--------|-------|
| B1 | Unified security audit log table | 1 day | `db.ts`, `settings.ts` or new `security.ts` view |
| B2 | Skill vetting pre-install check | 1 day | `skills.ts` (add safety check before install) |
| B3 | Token age display + rotation reminder | 2 hrs | `settings.ts` |
| B4 | Sensitive path blocking for Projects | 2 hrs | `projects.ts` (block `~/.ssh`, etc.) |

### Sprint C — Hardening (Later)

| # | Task | Effort | Files |
|---|------|--------|-------|
| C1 | Per-project Tauri scope | 1 day | `capabilities/default.json`, `projects.ts` |
| C2 | SQLCipher for paw.db | 2 days | `Cargo.toml`, `lib.rs`, `db.ts` |
| C3 | Gateway localhost validation | 2 hrs | `main.ts` (connect), `lib.rs` (start_gateway) |
| C4 | Crash watchdog + auto-restart | 1 day | `main.ts` (health polling), `lib.rs` |
| C5 | Network request auditing | 1 day | `main.ts` (exec approval args inspection) |

---

## Security Protocols Summary

| Protocol | Status | Paw Component |
|----------|--------|---------------|
| **HIL (Human-in-the-Loop)** | ✅ Built | Exec approval modal, allow/deny per request, mail permission auto-deny |
| **chmod (file permissions)** | ✅ Built (own files) | `set_owner_only_permissions()` on himalaya config — agent `chmod` not blocked |
| **sudo/su detection** | ❌ Not built | No pattern matching on exec approval requests |
| **Command allowlist** | ❌ Not built | No pre-approved or pre-denied command patterns |
| **OS Keychain** | ✅ Built | Rust `keyring` crate — macOS Keychain / libsecret / Windows |
| **Filesystem sandbox** | ✅ Partial | Tauri scope `~/Documents/Paw/**` — Projects view is unscoped |
| **CSP** | ❌ Not built | `"csp": null` — wide open |
| **Gateway auth** | ✅ Built | Token-based WebSocket auth + per-device rotation/revocation |
| **Credential audit** | ✅ Built (mail only) | `credential_activity_log` table — no unified audit dashboard |
| **Channel access control** | ✅ Built | Per-channel DM/group policies with allowlists |
| **Skill vetting** | ❌ Not built | `skills.install` has no safety check |
| **Encryption at rest** | ❌ Not built | SQLite and config files are plaintext |
| **Token auto-rotation** | ❌ Not built | Manual rotation only |
| **Network sandboxing** | ❌ Not built | Agent can reach any domain |
| **Crash recovery** | ❌ Not built | No watchdog, no auto-restart |

---

## File Reference

| File | Security Role |
|------|---------------|
| `src-tauri/src/lib.rs` | Rust backend — keychain, chmod, gateway lifecycle |
| `src-tauri/tauri.conf.json` | CSP config (currently null), bundle config |
| `src-tauri/capabilities/default.json` | Filesystem scope, shell permissions |
| `src/main.ts:2950-3095` | Exec approval handler, mail permission classifier, approval modal |
| `src/main.ts:1660-1820` | Channel setup — DM/group policies, allowlists |
| `src/gateway.ts:607-625` | Exec approval gateway methods |
| `src/db.ts:139` | `credential_activity_log` table schema |
| `src/db.ts:338` | Audit log insert function |
| `src/views/settings.ts` | Approval toggles, device token management, usage dashboard |
| `src/views/mail.ts` | Credential vault, permission toggles per account |
| `src/views/skills.ts` | Skill install (no vetting) |
| `src/views/projects.ts` | File browser (no sensitive path blocking) |

---

## OpenClaw Security Context

Paw wraps OpenClaw, which has its own security:
- **Gateway auth token** — required for all WebSocket communication
- **Exec approval system** — agent tool calls require approval before executing
- **Channel pairing** — new contacts must be approved before interacting
- **Device pairing** — new devices must be approved before connecting

What OpenClaw does NOT have:
- No command classification (safe vs dangerous)
- No command allowlist/denylist
- No filesystem sandboxing (it runs as the user's process)
- No network restrictions
- No encryption at rest

**This is exactly why Paw is the right place to add these controls** — it sits between the user and OpenClaw, with Rust-level enforcement capabilities.
