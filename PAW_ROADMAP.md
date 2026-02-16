# Paw — Full Feature Roadmap & Wiring Plan

> **Last updated**: 2026-02-16  
> **Philosophy**: Paw exists so people never open a terminal, never edit JSON, never run bash commands. Every OpenClaw capability must be accessible through a visual GUI — buttons, dropdowns, forms, toggles. If it exists in OpenClaw, it must exist in Paw.  
> **Source of truth**: OpenClaw gateway dashboard (screenshots Feb 2026) + OpenClaw gateway source (`config-Dhccn237.js` Zod schemas)

---

## Table of Contents

1. [Gateway API Surface](#gateway-api-surface)
2. [Dashboard / Overview](#1-dashboard--overview)
3. [Channels](#2-channels)
4. [Instances / Presence](#3-instances--presence)
5. [Sessions](#4-sessions)
6. [Usage & Cost](#5-usage--cost)
7. [Cron Jobs](#6-cron-jobs)
8. [Agents](#7-agents)
9. [Skills](#8-skills)
10. [Nodes & Exec Approvals](#9-nodes--exec-approvals)
11. [Models & Providers](#10-models--providers)
12. [Config Editor (Raw)](#11-config-editor-raw)
13. [Environment Variables](#12-environment-variables)
14. [Agent Defaults](#13-agent-defaults)
15. [Tools & Exec Security](#14-tools--exec-security)
16. [Sessions Config](#15-sessions-config)
17. [Messages Config](#16-messages-config)
18. [Memory Config](#17-memory-config)
19. [Compaction & Context Pruning](#18-compaction--context-pruning)
20. [Hooks / Webhooks](#19-hooks--webhooks)
21. [Gateway Config](#20-gateway-config)
22. [Logging](#21-logging)
23. [Updates](#22-updates)
24. [UI / Identity Customization](#23-ui--identity-customization)
25. [Voice & TTS](#24-voice--tts)
26. [Sandbox Config](#25-sandbox-config)
27. [Debug View](#26-debug-view)
28. [Browser Control (Enhanced)](#27-browser-control-enhanced)
29. [Implementation Architecture](#implementation-architecture)
30. [Priority Matrix](#priority-matrix)

---

## Gateway API Surface

Every Paw feature reads/writes OpenClaw config via WebSocket. No local-only config — all state lives in `~/.openclaw/openclaw.json` and is managed through the gateway.

| Method | Purpose | Client Call | Used Today |
|---|---|---|---|
| `config.get` | Read full config JSON + file path | `gateway.configGet()` → `{ config, path }` | ✅ Settings JSON editor |
| `config.set` | Replace entire config | `gateway.configSet(config)` | ✅ Settings Save |
| `config.patch` | Merge-patch specific keys | `gateway.configPatch(patch)` | ❌ Typed, not called |
| `config.apply` | Validate + write + optionally restart | `gateway.configApply(config)` → `{ ok, restarted, errors }` | ✅ Settings Apply |
| `config.schema` | Get JSON schema for validation | `gateway.configSchema()` → `{ schema }` | ✅ Settings View Schema |
| `models.list` | List resolved models | `gateway.modelsList()` → `{ models }` | ✅ Foundry Models tab |
| `skills.status` | Get installed skills + state | `gateway.skillsStatus()` | ✅ Skills view |
| `skills.update` | Enable/disable skill, set env/apiKey | `gateway.skillsUpdate(key, updates)` | ✅ Skills view |
| `sessions.list` | List sessions with filters | `gateway.listSessions(opts?)` | ✅ Chat dropdown |
| `usage.status` | Token/request totals | `gateway.usageStatus()` | ✅ Settings Usage |
| `usage.cost` | Per-model cost breakdown | `gateway.usageCost()` | ✅ Settings Usage |
| `channels.status` | Channel health with probe | `gateway.getChannelsStatus(probe?)` | ✅ Channels view |
| `cron.*` | Job CRUD + runs | Multiple methods | ✅ Automations |
| `agents.*` | Agent CRUD + files | Multiple methods | ✅ Foundry |
| `node.*` | Node management | Multiple methods | ✅ Nodes view |
| `device.*` | Device pairing | Multiple methods | ✅ Settings |
| `tts.*` | Text-to-speech | 5 methods typed | ❌ No UI |
| `talk.*` | Voice conversation | 2 methods typed | ❌ No UI |
| `voicewake.*` | Wake words | 2 methods typed | ❌ No UI |

### Read/Write Pattern (for all settings)

```typescript
// READ: load current config
const { config } = await gateway.configGet();
const currentValue = config.some.nested.path;

// WRITE: patch a specific field (preferred — safe merge)
await gateway.configPatch({ some: { nested: { path: newValue } } });

// WRITE + VALIDATE: apply with restart if needed
const result = await gateway.configApply(newConfig);
if (!result.ok) showToast(result.errors.join(', '), 'error');
```

---

## 1. Dashboard / Overview

**OpenClaw dashboard has**: Gateway Access (WS URL, token, password, session key), Snapshot (status, uptime, tick interval, channels refresh), Instances/Sessions/Cron summary cards, Notes section.

### What Paw has today ✅
- Welcome greeting + quick actions (New Chat, Build App, Check Mail, Wake Agent)
- Feature grid cards for navigation
- Cron widget (up to 8 jobs)

### What's MISSING ❌
| Feature | Dashboard Reference | Source | Implementation |
|---|---|---|---|
| **Gateway Snapshot card** | Status, Uptime, Tick Interval, Last Channels Refresh | `gateway.getHealth()` + `gateway.getStatus()` | Card row on dashboard — already have data, just not on dashboard |
| **Instances count card** | "1 — Presence beacons in the last 5 minutes" | `gateway.systemPresence()` | Summary card with count |
| **Sessions count card** | "6 — Recent session keys tracked" | `gateway.listSessions()` | Summary card with count |
| **Cron enabled/disabled card** | "Enabled — Next wake n/a" | `gateway.cronStatus()` | Summary card (already have data in Automations) |
| **Default Session Key display** | `agent:main:main` shown in overview | `config.agents.defaults` or health response | Display in gateway card |

**Priority**: P3 — nice to have, all the data is already fetched by other views

---

## 2. Channels

**OpenClaw dashboard has**: Per-channel cards for WhatsApp, Telegram, Discord, Google Chat, Slack, Signal, iMessage, Nostr — each with detailed status fields, config schema editing, probe/save/reload buttons.

### What Paw has today ✅
- Channel cards with connected/disconnected status
- Per-channel setup forms (Telegram bot token, Discord token, WhatsApp QR, Slack tokens, Signal phone)
- Login flow (QR code, wait)
- Logout per channel
- Direct message send per channel

### What's MISSING ❌
| Feature | Dashboard Reference | Source | Implementation |
|---|---|---|---|
| **Detailed status fields** | Configured, Linked, Running, Connected, Last connect, Last message, Auth age | `gateway.getChannelsStatus(probe: true)` — data is already returned | Parse and display all status fields per channel card |
| **Probe button** | Per-channel "Probe" to test connection | `gateway.getChannelsStatus(probe: true)` with per-channel filter | Add Probe button per card, show result |
| **Save/Reload per channel** | Save config changes, Reload from disk | `gateway.configPatch({ channels: { <ch>: { ... } } })` for save, `configGet()` reload | Add Save/Reload buttons per channel card |
| **Config schema-driven forms** | Each channel has a JSON editor when schema is available | `gateway.configSchema()` → extract per-channel schema | Dynamic form generation from schema (or at minimum, a JSON editor per channel) |
| **Nostr support** | Profile editing (name, bio, avatar), Public Key display | `config.channels.nostr` | Add Nostr card with profile form |
| **iMessage support** | macOS bridge status, Last start, Last probe | `config.channels.imessage` | Add iMessage card |
| **Matrix support** | Config for Matrix homeserver | `config.channels.matrix` | Add Matrix card |
| **Zalo support** | Config for Zalo channel | `config.channels.zalo` | Add Zalo card |
| **Blue Bubbles toggle** | Alternative iMessage via BlueBubbles API | `config.channels.bluebubbles` | Add BlueBubbles card |
| **Microsoft Teams** | Bot registration, channel config | `config.channels.msteams` | Add Teams card |

**Priority**: P1 — channels are a core user need. The dashboard shows WAY more detail than Paw currently surfaces.

**Source code reference**: `config-Dhccn237.js` → `ChannelsSchema` (each channel has `enabled`, `accounts`, plus channel-specific fields)

---

## 3. Instances / Presence

**OpenClaw dashboard has**: Dedicated "Instances" page showing connected instances with hostname, IP, platform tags, last input, reason.

### What Paw has today ✅
- System Presence in Settings (connected clients list with name, role, platform, connected time)

### What's MISSING ❌
| Feature | Dashboard Reference | Source | Implementation |
|---|---|---|---|
| **Dedicated Instances view** | Full page, not just a settings subsection | `gateway.systemPresence()` | Either dedicated section or expanded Settings card |
| **IP address display** | "192.168.1.22" per instance | Presence response data | Display in instance card |
| **Platform tags** | "gateway", "macos 26.2", "Mac", "unknown" as badges | Presence response data | Tag/chip badges per instance |
| **Last input time** | "just now" / "n/a" | Presence response data | Display per instance |
| **Reason field** | "self" | Presence response data | Display per instance |
| **Refresh button** | Explicit refresh | `gateway.systemPresence()` | Already have, may need to surface |

**Priority**: P3 — we have the core data, just need richer display. Could enhance existing Settings presence section.

---

## 4. Sessions

**OpenClaw dashboard has**: Dedicated Sessions page with filters, per-session overrides (Thinking/Verbose/Reasoning dropdowns), token counts, kind, store display.

### What Paw has today ✅
- Session list dropdown in Chat view
- Session rename (`sessions.patch`)
- Session delete (`sessions.delete`)
- Session reset/clear (`sessions.reset`)
- Session compact (`sessions.compact`)
- Token meter per active session in chat header

### What's MISSING ❌
| Feature | Dashboard Reference | Source | Implementation |
|---|---|---|---|
| **Dedicated Sessions view/page** | Full page table with all sessions | `gateway.listSessions(opts)` | New view or major Settings section |
| **Session filter: Active within** | "Active within (minutes)" input | `listSessions({ activeWithin: N })` | Filter input |
| **Session filter: Limit** | "120" — max sessions to return | `listSessions({ limit: N })` | Filter input |
| **Session filter: Include global** | Checkbox | `listSessions({ includeGlobal: true })` | Checkbox |
| **Session filter: Include unknown** | Checkbox | `listSessions({ includeUnknown: true })` | Checkbox |
| **Session Kind column** | "direct" / "dm" / "group" / "thread" | Session response data | Display per row |
| **Tokens per session** | "316576 / 1048576" | Session response data | Display per row |
| **Per-session Thinking override** | Dropdown: inherit/off/minimal/low/medium/high/xhigh | `gateway.patchSession(key, { thinking: '...' })` | Inline dropdown per session |
| **Per-session Verbose override** | Dropdown: inherit/off/on/full | `gateway.patchSession(key, { verbose: '...' })` | Inline dropdown per session |
| **Per-session Reasoning override** | Dropdown: inherit/off/on | `gateway.patchSession(key, { reasoning: '...' })` | Inline dropdown per session |
| **Click session → open in Chat** | Session key is a link to chat | Navigation + `chatHistory(key)` | Clickable session key links |
| **Session store display** | "Store: (multiple)" | Session response data | Display in header |
| **Label editing inline** | Text input per row | `gateway.patchSession(key, { label: '...' })` | Inline edit |
| **Bulk actions** | Select multiple → delete | Multiple `sessions.delete` | Checkbox + bulk delete |

**Priority**: P1 — sessions are a core part of the dashboard and a common user need. Per-session overrides are a power feature that no other UI exposes.

**Source code reference**: `gateway.listSessions(opts?)` already supports filter params. `gateway.patchSession(key, patch)` already supports per-session overrides.

---

## 5. Usage & Cost

**OpenClaw dashboard has**: Date range picker, Local/Tokens/Cost toggles, complex filter bar, Activity by Time chart, Daily Usage chart, Sessions list, Export, Pin.

### What Paw has today ✅
- Usage dashboard in Settings: requests, tokens (in/out), total cost, period
- Per-model cost breakdown cards
- Budget alert with configurable USD limit
- Per-conversation cost estimate in chat header
- 30s auto-refresh

### What's MISSING ❌
| Feature | Dashboard Reference | Source | Implementation |
|---|---|---|---|
| **Date range picker** | Today/7d/30d + custom date inputs | `gateway.usageStatus({ from, to })` (if supported) or local date filtering | Date picker UI with presets |
| **Activity by Time chart** | Bar/line chart showing token usage over time | Aggregate from session timestamps | Chart visualization (lightweight — e.g. SVG bars or canvas) |
| **Daily Usage chart** | Per-day breakdown | Aggregate per day | Chart visualization |
| **Sessions list in Usage** | List of sessions with cost, sorted by recent | `gateway.listSessions()` + cost data | Table of sessions with cost column |
| **Tokens vs Cost toggle** | Switch display between token count and dollar cost | Client-side toggle | Toggle button in header |
| **Filter bar** | Complex query: `key:agent:main:cron* model:gpt-4o has:errors minTokens:2000` | Client-side filter on loaded data | Search input with query parsing |
| **Export button** | Export CSV/JSON | Build export from loaded data | Dropdown: Export CSV, Export JSON |
| **Pin feature** | Pin current filter for quick access | localStorage persistence | Pin button + pinned filters strip |

**Priority**: P2 — we have the basics, charts and filters add value but aren't blocking.

---

## 6. Cron Jobs

**OpenClaw dashboard has**: Scheduler status (Enabled/Jobs/Next Wake), extremely detailed New Job form with scheduling options, session mode, wake mode, payload type, delivery, channel routing, timeout.

### What Paw has today ✅
- Scheduler status bar (running/stopped, job count)
- Board layout: Active/Paused/History columns
- Job cards with label, schedule, prompt, run times
- Create/Edit modal (label, schedule/preset, prompt, agent ID)
- Run Now, Enable/Disable toggle, Delete, Run history with error details
- Duration bar visualization

### What's MISSING ❌
| Feature | Dashboard Reference | Source | Implementation |
|---|---|---|---|
| **Description field** | Text description separate from prompt | `cron.add({ description })` | Add to create/edit modal |
| **Schedule type toggle** | "Every" vs "Cron" | UI toggle — "Every" generates cron expression | Toggle: simple interval picker vs raw cron |
| **Every + Unit selector** | "Every 30 Minutes" | UI → generates `*/30 * * * *` | Dropdown: Minutes/Hours/Days + number input |
| **Session mode** | Isolated / Shared / New / Current | `cron.add({ session: 'isolated' })` | Dropdown in create/edit modal |
| **Wake mode** | Now / Scheduled / Background | `cron.add({ wakeMode: 'now' })` | Dropdown in create/edit modal |
| **Payload type** | Agent turn / System message / Raw | `cron.add({ payload: 'agent-turn' })` | Dropdown in create/edit modal |
| **Delivery type** | Announce summary (default) / Silent / Full transcript | `cron.add({ delivery: 'announce-summary' })` | Dropdown in create/edit modal |
| **Timeout field** | Timeout in seconds | `cron.add({ timeoutSeconds: N })` | Number input in create/edit modal |
| **Channel selector** | Channel dropdown: last / whatsapp / telegram etc | `cron.add({ channel: 'last' })` | Dropdown populated from channels |
| **To field** | Phone number or chat ID for delivery | `cron.add({ to: '+1555...' })` | Text input |
| **Next Wake display** | "Next wake n/a" on scheduler card | `gateway.cronStatus()` | Display on scheduler status bar |
| **Agent message** | Full textarea for the message to send | Already have "prompt" — might need rename or separate field | Rename to "Agent message" or add |

**Priority**: P1 — the current cron create form is too basic compared to what OpenClaw supports. Users need session mode, delivery, and channel routing to build morning briefs and other automations.

**Source code reference**: `gateway.cronAdd(job)` — need to verify what fields are accepted. Check `config-Dhccn237.js` → `CronJobSchema`.

---

## 7. Agents

**OpenClaw dashboard has**: Agent list with tabs per agent (Overview/Files/Tools/Skills/Channels/Cron Jobs), per-agent model selection with dropdown + fallbacks, identity editing, workspace path, default toggle, skills filter, Reload Config + Save buttons.

### What Paw has today ✅ (in Foundry)
- Agent list cards with emoji, name, ID, default badge
- Agent detail with standard file grid (AGENTS.md, SOUL.md, etc.)
- Agent file editor (textarea)
- Create agent modal (emoji, name, workspace, model)
- Delete agent, edit agent
- Set default agent

### What's MISSING ❌
| Feature | Dashboard Reference | Source | Implementation |
|---|---|---|---|
| **Per-agent tabs** | Overview / Files / Tools / Skills / Channels / Cron Jobs | New tab navigation per agent | Tab bar in agent detail view |
| **Overview tab: Workspace path** | `/Users/elibury/.openclaw/workspace` | `agents.list` response or `config.agents.list[].workspace` | Display + editable field |
| **Overview tab: Primary Model** | `google/gemini-2.5-pro` with dropdown | `gateway.modelsList()` for options, agent config for current | Dropdown populated from models list |
| **Overview tab: Fallbacks** | "provider/model, provider/model" | `config.agents.list[].model.fallbacks` | Comma-separated text input |
| **Overview tab: Identity Name** | "Dave" | `config.agents.list[].identityName` or agent identity | Editable text field |
| **Overview tab: Skills Filter** | "all skills" / custom filter | `config.agents.list[].skills` | Dropdown or multi-select |
| **Tools tab** | Per-agent tool allow/deny/exec overrides | `config.agents.list[].tools` | Tool config form per agent |
| **Skills tab** | Which skills this agent uses | `config.agents.list[].skills` + `gateway.skillsStatus(agentId)` | Skills list filtered to this agent |
| **Channels tab** | Which channels route to this agent | `config.agents.list[].channels` or routing config | Channel routing checkboxes |
| **Cron Jobs tab** | Cron jobs using this agent | Filter `cronList()` by agentId | Cron job cards filtered |
| **Reload Config button** | Reloads agent config from disk | `gateway.configGet()` + re-render | Button per agent |
| **Save button** | Saves agent config changes | `gateway.updateAgent(params)` or `configPatch` | Save button per agent |

**Priority**: P1 — agents are a core feature. The per-agent tabs (especially Tools, Skills, Channels routing) are essential for multi-agent setups. Currently Foundry only shows files — it doesn't expose the actual agent configuration.

---

## 8. Skills

**OpenClaw dashboard has**: Search filter, "49 shown" count, Built-in skills section, per-skill descriptions, openclaw-bundled/blocked tags, missing binary info, install method specificity ("Install 1Password CLI (brew)").

### What Paw has today ✅
- Installed / Available sections
- Skill cards with status badges, descriptions, missing API key warnings
- Install with safety check (npm registry intelligence, sandbox verification)
- Enable/disable, Configure (env vars), Docs link
- Browsable bins modal, custom bin install
- Security event logging

### What's MISSING ❌
| Feature | Dashboard Reference | Source | Implementation |
|---|---|---|---|
| **Search/filter input** | "Search skills" text input | Client-side filter | Add filter input above skills list |
| **Count display** | "49 shown" | Count from response | Display count badge |
| **Built-in / Custom grouping** | "BUILT-IN SKILLS 49" section header | Group by `source` field (openclaw-bundled vs workspace vs managed) | Section headers with counts |
| **Install method hint** | "Install 1Password CLI (brew)", "Install memo via Homebrew" | Derive from skill missing requirements + platform | Show install method on install button |
| **Missing binary display** | "Missing: bin:op", "Missing: bin:memo" | `skill.missing` field | Display missing requirements below card |

**Priority**: P3 — Skills view is already one of the most complete. These are polish items.

---

## 9. Nodes & Exec Approvals

**OpenClaw dashboard has**: Dedicated Nodes page with Exec Approvals section (Target host selector, Scope tabs Defaults/per-agent, Security Mode, Ask Mode, Ask Fallback, Auto-allow skill CLIs, Exec Node Binding).

### What Paw has today ✅
- **Nodes view**: Node list, describe, invoke commands, rename, pairing request cards
- **Settings Exec Approvals**: Per-tool 3-way toggle (Allow/Ask/Block), add rule, ask policy radio

### What's MISSING ❌
| Feature | Dashboard Reference | Source | Implementation |
|---|---|---|---|
| **Target Host selector** | "Gateway" dropdown — edit gateway vs node approvals | `gateway.execApprovalsGet()` vs `gateway.execApprovalsNodeGet()` | Dropdown toggle in exec approvals section |
| **Scope tabs: Defaults vs per-agent** | Tab bar switching between defaults and per-agent rules | Config: `tools.exec` (defaults) vs per-agent tools config | Tab navigation in exec approvals |
| **Security Mode dropdown** | "Deny" / "Allowlist" / "Full" | `config.tools.exec.security` | Dropdown replacing current radio cards |
| **Ask Mode dropdown** | "On miss" / "Always" / "Off" | `config.tools.exec.ask` | Dropdown |
| **Ask Fallback dropdown** | "Deny" — what happens when UI prompt is unavailable | `config.tools.exec.askFallback` | Dropdown |
| **Auto-allow skill CLIs** | Checkbox — allow executables listed by gateway | `config.tools.exec.autoAllowSkillBins` | Checkbox |
| **Exec Node Binding section** | Pin agents to specific nodes for exec | `config.tools.exec.nodeBinding` | Node selector per agent or default |
| **Per-agent Security** | Different exec policies per agent (via scope tabs) | Per-agent tools overrides | Form per agent in tabs |

**Priority**: P2 — exec approvals are important for security. The current implementation works but doesn't expose the full configuration depth.

---

## 10. Models & Providers

**OpenClaw dashboard**: Not a dedicated page in screenshots, but used within Agents (model dropdown) and is critical config.

### What Paw has today ✅
- Foundry Models tab: read-only model cards with name, provider, context window, reasoning badge

### What's MISSING ❌
| Feature | Source | Implementation |
|---|---|---|
| **Add/edit/delete providers** | `config.models.providers` | Provider management UI |
| **Provider form** | `models.providers.<name>` → baseUrl, apiKey, api, authMode, headers, models[] | Card per provider with expand/edit |
| **Provider API type** | `openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai`, `github-copilot`, `bedrock-converse-stream`, `ollama` | Dropdown |
| **Add/edit/delete models** | `models.providers.<name>.models[]` | Per-provider model list with CRUD |
| **Model definition form** | id, name, api, reasoning, input[], contextWindow, maxTokens, cost, headers, compat | Model editor form |
| **Default model selector** | `agents.defaults.model.primary` | Dropdown from `modelsList()` |
| **Fallback models** | `agents.defaults.model.fallbacks` | Tag/chip list |
| **Image model** | `agents.defaults.imageModel.primary` + fallbacks | Dropdown + tags |
| **API Key masking** | Sensitive field handling | `type="password"` with show/hide |

**Write**: `configPatch({ models: { providers: { <name>: { ... } } } })`  
**Delete provider**: `configPatch({ models: { providers: { <name>: null } } })`

**Priority**: P1 — model/provider management is the #1 thing users need to configure. Currently read-only.

---

## 11. Config Editor (Raw)

**OpenClaw dashboard has**: "Config" in sidebar — likely a raw JSON config editor.

### What Paw has today ✅
- Settings: JSON textarea via `configGet()` → edit → `configSet()` or `configApply()`
- View Schema button

### What's MISSING ❌
| Feature | Source | Implementation |
|---|---|---|
| **Syntax highlighting** | Better editing experience | CodeMirror or Monaco for JSON |
| **Validation before save** | `config.schema` | Run against schema, show inline errors |
| **Diff view** | Show what changed before apply | Before/after diff display |
| **Undo/revert** | Restore previous config | Keep last config in memory |

**Priority**: P4 — the raw editor works, these are polish items. Most users should use the structured settings panels instead.

---

## 12. Environment Variables

> Config path: `env`

### What Paw has today ✅
- Nothing — no env var UI

### What's NEEDED ❌
| Field | Type | Config Path | Notes |
|---|---|---|---|
| Key-value pairs | `Record<string,string>` | `env.vars` | Table of env var rows |
| Shell env enabled | `boolean` | `env.shellEnv.enabled` | Toggle |
| Shell env timeout | `number` | `env.shellEnv.timeoutMs` | Number input |

**UI**: Table of env var rows (key + value inputs + delete button). "Add Variable" button. Toggle for shell env inheritance.  
**Write**: `configPatch({ env: { vars: { KEY: 'value' } } })`  
**Delete var**: `configPatch({ env: { vars: { KEY: null } } })`

**Priority**: P1 — API keys and custom vars are set here. Critical for provider configuration.

---

## 13. Agent Defaults

> Config path: `agents.defaults`

### What Paw has today ✅
- Nothing — no agent defaults UI (only per-agent overrides via Foundry)

### What's NEEDED ❌
| Field | Type | Config Path | Options |
|---|---|---|---|
| Thinking level | `enum` | `agents.defaults.thinkingDefault` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| Verbose mode | `enum` | `agents.defaults.verboseDefault` | `off`, `on`, `full` |
| Elevated mode | `enum` | `agents.defaults.elevatedDefault` | `off`, `on`, `ask`, `full` |
| Context tokens | `number` | `agents.defaults.contextTokens` | Positive integer |
| Max concurrent | `number` | `agents.defaults.maxConcurrent` | Positive integer |
| Timeout (sec) | `number` | `agents.defaults.timeoutSeconds` | Positive integer |
| Workspace path | `string` | `agents.defaults.workspace` | Directory path |
| Repo root | `string` | `agents.defaults.repoRoot` | Directory path |
| Skip bootstrap | `boolean` | `agents.defaults.skipBootstrap` | Toggle |
| User timezone | `string` | `agents.defaults.userTimezone` | e.g. `America/New_York` |
| Time format | `enum` | `agents.defaults.timeFormat` | `auto`, `12`, `24` |
| Typing mode | `enum` | `agents.defaults.typingMode` | `never`, `instant`, `thinking`, `message` |
| Media max MB | `number` | `agents.defaults.mediaMaxMb` | Positive number |
| Block streaming | `enum` | `agents.defaults.blockStreamingDefault` | `off`, `on` |

**UI**: Form with labeled inputs grouped by category.  
**Write**: `configPatch({ agents: { defaults: { <field>: value } } })`

**Priority**: P1 — these defaults affect every conversation. Users need to set thinking level, timeouts, and workspace without editing JSON.

---

## 14. Tools & Exec Security

> Config path: `tools`

### What Paw has today ✅
- Exec Approvals in Settings (per-tool Allow/Ask/Block toggles, ask policy radio)

### What's MISSING ❌ (config-level tools, beyond approvals)
| Field | Type | Config Path | Options |
|---|---|---|---|
| Tool profile | `enum` | `tools.profile` | Predefined tool profiles |
| Allow list | `string[]` | `tools.allow` | Tool names to allow |
| Also allow | `string[]` | `tools.alsoAllow` | Additional tools beyond profile |
| Deny list | `string[]` | `tools.deny` | Blocked tools |
| Exec host | `enum` | `tools.exec.host` | `sandbox`, `gateway`, `node` |
| Exec security | `enum` | `tools.exec.security` | `deny`, `allowlist`, `full` |
| Exec ask mode | `enum` | `tools.exec.ask` | `off`, `on-miss`, `always` |
| Exec ask fallback | `enum` | `tools.exec.askFallback` | `deny`, `allow` |
| Safe bins | `string[]` | `tools.exec.safeBins` | Allowed executables |
| Exec timeout | `number` | `tools.exec.timeoutSec` | Seconds |
| FS workspace only | `boolean` | `tools.fs.workspaceOnly` | Limit FS to workspace |
| Elevated tools | `boolean` | `tools.elevated.enabled` | Enable elevated-mode tools |

**UI**: Combined form. Tool allow/deny as editable tag lists. Exec section with dropdowns.  
**Write**: `configPatch({ tools: { exec: { security: '...' } } })`

**Priority**: P2 — the existing exec approvals cover the runtime approval flow. This covers the config-level defaults.

---

## 15. Sessions Config

> Config path: `session`

### What Paw has today ✅
- Nothing — session config not exposed

### What's NEEDED ❌
| Field | Type | Config Path | Options |
|---|---|---|---|
| Title gen model | `string` | `session.titleGenModel` | Model ID dropdown |
| Compact model | `string` | `session.compactModel` | Model ID dropdown |
| Store | `string` | `session.store` | Storage backend |
| Idle timeout | `string` | `session.idleTimeout` | Duration |
| Auto-compact | `boolean/object` | `session.autoCompact` | Toggle + config |
| Reset mode | `enum` | `session.reset.mode` | `off`, `idle`, `always` |
| Reset idle timeout | `string` | `session.reset.idleTimeout` | Duration |
| Reset max messages | `number` | `session.reset.maxMessages` | Count |
| Reset max tokens | `number` | `session.reset.maxTokens` | Token count |
| Reset by type | `object` | `session.resetByType` | Per direct/dm/group/thread overrides |

**Write**: `configPatch({ session: { ... } })`

**Priority**: P2 — affects how sessions behave (compaction, reset, timeout). Power users need this.

---

## 16. Messages Config

> Config path: `messages`

### What Paw has today ✅
- Nothing

### What's NEEDED ❌
| Field | Type | Config Path |
|---|---|---|
| Group chat mention patterns | `string[]` | `messages.groupChat.mentionPatterns` |
| Group chat history limit | `number` | `messages.groupChat.historyLimit` |
| Queue max size | `number` | `messages.queue.maxSize` |
| Queue wait ms | `number` | `messages.queue.waitMs` |
| TTS enabled | `boolean` | `messages.tts.enabled` |
| TTS voice | `string` | `messages.tts.defaultVoice` |

**Write**: `configPatch({ messages: { ... } })`

**Priority**: P3 — mostly relevant for channel-based messaging, not direct Paw chat.

---

## 17. Memory Config

> Config path: `memory`

### What Paw has today ✅
- LanceDB setup flow (provider picker, connection test, enable)
- Agent files view + edit
- Memory recall (semantic search) + memory store
- Memory stats + export

### What's MISSING ❌
| Field | Type | Config Path |
|---|---|---|
| QMD enabled | `boolean` | `memory.qmd.enabled` |
| QMD auto-update | `boolean` | `memory.qmd.update.auto` |
| QMD paths | `array` | `memory.qmd.paths` |
| QMD session limits | `object` | `memory.qmd.sessions` |
| QMD token limits | `object` | `memory.qmd.limits` |

**Write**: `configPatch({ memory: { qmd: { ... } } })`

**Priority**: P3 — advanced memory tuning. The setup flow covers the basics.

---

## 18. Compaction & Context Pruning

> Config path: `agents.defaults.compaction`, `agents.defaults.contextPruning`

### What Paw has today ✅
- Compaction warning banner in chat (80%/95% thresholds)
- Manual compact button in chat header

### What's MISSING ❌
| Field | Type | Config Path | Options |
|---|---|---|---|
| Compaction mode | `enum` | `agents.defaults.compaction.mode` | `default`, `safeguard` |
| Reserve tokens floor | `number` | `agents.defaults.compaction.reserveTokensFloor` | Token count |
| Max history share | `number` | `agents.defaults.compaction.maxHistoryShare` | 0.1–0.9 |
| Memory flush enabled | `boolean` | `agents.defaults.compaction.memoryFlush.enabled` | Toggle |
| Context pruning mode | `enum` | `agents.defaults.contextPruning.mode` | `off`, `cache-ttl` |
| Pruning TTL | `string` | `agents.defaults.contextPruning.ttl` | Duration |

**Write**: `configPatch({ agents: { defaults: { compaction: { ... } } } })`

**Priority**: P2 — "it forgets mid-sentence" is a top community pain point. Compaction config directly addresses this.

---

## 19. Hooks / Webhooks

> Config path: `hooks`

### What Paw has today ✅
- Nothing

### What's NEEDED ❌
| Field | Type | Config Path |
|---|---|---|
| Enabled | `boolean` | `hooks.enabled` |
| Path | `string` | `hooks.path` |
| Token | `string` (sensitive) | `hooks.token` |
| Default session key | `string` | `hooks.defaultSessionKey` |
| Allow request session key | `boolean` | `hooks.allowRequestSessionKey` |
| Allowed agent IDs | `string[]` | `hooks.allowedAgentIds` |
| Max body bytes | `number` | `hooks.maxBodyBytes` |
| Mappings | `array` | `hooks.mappings` |
| Gmail webhook config | `object` | `hooks.gmail` |

**Write**: `configPatch({ hooks: { ... } })`

**Priority**: P3 — webhooks are needed for external integrations (Gmail push, custom triggers).

---

## 20. Gateway Config

> Config path: `gateway`

### What Paw has today ✅
- Gateway URL + token editing in Settings
- Display: uptime, sessions, agents, channels, version

### What's MISSING ❌
| Field | Type | Config Path | Options |
|---|---|---|---|
| Port | `number` | `gateway.port` | 1–65535 |
| Mode | `enum` | `gateway.mode` | `local`, `remote` |
| Bind | `enum` | `gateway.bind` | `auto`, `lan`, `loopback`, `custom`, `tailnet` |
| Auth mode | `enum` | `gateway.auth.mode` | `token`, `password`, `trusted-proxy` |
| Auth token | `string` (sensitive) | `gateway.auth.token` | Masked |
| Rate limit | `object` | `gateway.auth.rateLimit` | `maxAttempts`, `windowMs`, `lockoutMs` |
| TLS enabled | `boolean` | `gateway.tls.enabled` | Toggle |
| TLS auto-generate | `boolean` | `gateway.tls.autoGenerate` | Toggle |
| Reload mode | `enum` | `gateway.reload.mode` | `off`, `restart`, `hot`, `hybrid` |

**Write**: `configPatch({ gateway: { ... } })`  
**⚠️ Warning**: Changing port/bind/auth may disconnect the client. Show confirmation dialog.

**Priority**: P3 — most users run defaults. But Tailscale/LAN users need bind and TLS.

---

## 21. Logging

> Config path: `logging`

### What Paw has today ✅
- Log viewer in Settings (tail with line count)

### What's MISSING ❌
| Field | Type | Config Path | Options |
|---|---|---|---|
| Level | `enum` | `logging.level` | `silent`, `fatal`, `error`, `warn`, `info`, `debug`, `trace` |
| Console level | `enum` | `logging.consoleLevel` | Same as above |
| Console style | `enum` | `logging.consoleStyle` | `pretty`, `compact`, `json` |
| Log file path | `string` | `logging.file` | File path |
| Redact sensitive | `enum` | `logging.redactSensitive` | `off`, `tools` |

**Write**: `configPatch({ logging: { level: '...' } })`

**Priority**: P4 — log viewing works. Config is for power users.

---

## 22. Updates

> Config path: `update`

### What Paw has today ✅
- "Update OpenClaw" button in Settings

### What's MISSING ❌
| Field | Type | Config Path | Options |
|---|---|---|---|
| Channel | `enum` | `update.channel` | `stable`, `beta`, `dev` |
| Check on start | `boolean` | `update.checkOnStart` | Toggle |

**Write**: `configPatch({ update: { channel: '...' } })`

**Priority**: P4 — one-click update works. Channel selection is for beta testers.

---

## 23. UI / Identity Customization

> Config path: `ui`

### What Paw has today ✅
- Nothing — Paw has its own CSS themes but doesn't expose OpenClaw's UI config

### What's NEEDED ❌
| Field | Type | Config Path |
|---|---|---|
| Seam color | `string` (hex) | `ui.seamColor` |
| Assistant name | `string` | `ui.assistant.name` |
| Assistant avatar | `string` | `ui.assistant.avatar` |

**Write**: `configPatch({ ui: { assistant: { name: '...' } } })`

**Priority**: P4 — cosmetic.

---

## 24. Voice & TTS

> Config paths: `talk`, `messages.tts`, gateway TTS methods

### What Paw has today ✅
- Nothing — all gateway methods typed but zero UI.

### What's NEEDED ❌

#### TTS (Text-to-Speech)
| Feature | Source | Implementation |
|---|---|---|
| **TTS provider selector** | `gateway.ttsProviders()` → `gateway.ttsSetProvider(provider, voice?)` | Dropdown in settings |
| **TTS enable/disable** | `gateway.ttsEnable(enabled)` | Toggle |
| **TTS status display** | `gateway.ttsStatus()` | Status badge |
| **Voice preview** | `gateway.ttsConvert(text, voice?)` | Play button with sample text |
| **Per-message play button** | `gateway.ttsConvert(messageText)` | Play icon on assistant messages in chat |
| **Voice selector** | Provider-specific voices | Dropdown per provider |

#### Talk Mode (Continuous Voice)
| Feature | Source | Implementation |
|---|---|---|
| **Talk mode toggle** | `gateway.talkMode(enabled)` | Large toggle button |
| **Talk config** | `gateway.talkConfig()` | Show current voice ID, model, settings |
| **Config form** | `config.talk` → voiceId, modelId, outputFormat, apiKey, interruptOnSpeech | Form in settings |

#### Voice Wake
| Feature | Source | Implementation |
|---|---|---|
| **Wake words list** | `gateway.voicewakeGet()` | Display current triggers |
| **Edit wake words** | `gateway.voicewakeSet(triggers)` | Editable list |
| **Wake event listener** | `voicewake.changed` event | Auto-refresh on change |

**Priority**: P2 — morning briefs are the #1 community use case. TTS in chat is highly requested.

---

## 25. Sandbox Config

> Config path: `agents.defaults.sandbox`

### What Paw has today ✅
- Nothing

### What's NEEDED ❌
| Field | Type | Config Path | Options |
|---|---|---|---|
| Mode | `enum` | `agents.defaults.sandbox.mode` | `off`, `non-main`, `all` |
| Workspace access | `enum` | `agents.defaults.sandbox.workspaceAccess` | `none`, `ro`, `rw` |
| Session tools | `enum` | `agents.defaults.sandbox.sessionToolsVisibility` | `spawned`, `all` |
| Scope | `enum` | `agents.defaults.sandbox.scope` | `session`, `agent`, `shared` |
| Per session | `boolean` | `agents.defaults.sandbox.perSession` | Toggle |

**Write**: `configPatch({ agents: { defaults: { sandbox: { ... } } } })`

**Priority**: P3 — needed for multi-agent security.

---

## 26. Debug View

**OpenClaw dashboard has**: "Debug" in sidebar.

### What Paw has today ✅
- Nothing — no debug view

### What's NEEDED ❌
| Feature | Source | Implementation |
|---|---|---|
| **Gateway health snapshot** | `gateway.getHealth()` | Real-time health data display |
| **WebSocket connection info** | Internal state | Show connection status, latency, protocol version, reconnect count |
| **Event stream viewer** | All gateway events | Live event log showing every WS event with timestamp |
| **Config diff** | `configGet()` before/after | Show last config change |
| **Tick events** | `tick` gateway event (not consumed today) | Show periodic tick data |
| **Heartbeat info** | `gateway.lastHeartbeat()` | Display heartbeat status |
| **System events** | `gateway.systemEvent()` | Trigger and view system events |

**Priority**: P4 — power user tool for troubleshooting.

---

## 27. Browser Control (Enhanced)

### What Paw has today ✅
- Settings section: Running/stopped badge, open tabs list, Start/Stop buttons

### What's MISSING ❌
| Feature | Source | Implementation |
|---|---|---|
| **Screenshot viewer** | Agent screenshots from `browser.status` or agent files | Lightbox view of captured screenshots |
| **Tab interaction** | Click tab → navigate, close tab | Per-tab action buttons |
| **URL bar / navigate** | Direct URL input → browser goes to page | Input field + Go button |
| **Console log viewer** | Browser console output | Log display panel |

**Priority**: P4 — browser automation works, visibility is limited.

---

## Implementation Architecture

### File Structure (New / Modified)

```
src/views/
  settings.ts              — EXISTING: gateway status, logs, usage, security, devices
  settings-config.ts       — NEW: config editor backbone (load/save/cache/validate)
  settings-models.ts       — NEW: providers + model management
  settings-agents.ts       — NEW: agent defaults + enhanced agent config
  settings-tools.ts        — NEW: tools, exec policy, filesystem
  settings-env.ts          — NEW: environment variables table
  settings-channels.ts     — NEW: enhanced channel config editing
  settings-sessions.ts     — NEW: session config + session list management
  settings-advanced.ts     — NEW: gateway, logging, updates, ui, talk, skills, hooks, sandbox
  settings-voice.ts        — NEW: TTS, talk mode, voice wake
  automations.ts           — MODIFY: add missing cron fields (session mode, delivery, etc.)
  foundry.ts               — MODIFY: add per-agent tabs (Tools/Skills/Channels/Cron)
  skills.ts                — MODIFY: add search filter, grouping, count
  nodes.ts                 — MODIFY: add scope tabs for exec approvals
```

### Shared Config Editor Module (`settings-config.ts`)

```typescript
// Core config read/write utilities used by all settings panels

let _configCache: Record<string, unknown> | null = null;

/** Fetch config from gateway (cached, invalidate on write) */
export async function getConfig(): Promise<Record<string, unknown>> {
  if (!_configCache) {
    const result = await gateway.configGet();
    _configCache = result.config;
  }
  return _configCache;
}

/** Deep-get a config value by dot path */
export function getConfigValue(config: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((obj: any, key) => obj?.[key], config);
}

/** Patch config and invalidate cache */
export async function patchConfig(patch: Record<string, unknown>): Promise<boolean> {
  const result = await gateway.configApply(patch);
  _configCache = null;
  if (!result.ok) {
    showToast(`Config error: ${result.errors?.join(', ')}`, 'error');
    return false;
  }
  showToast('Settings saved', 'success');
  return true;
}

/** Invalidate cache (call after external config changes) */
export function invalidateConfigCache(): void {
  _configCache = null;
}
```

### Sensitive Field Handling

Fields like API keys, tokens, passwords:
- Display as `type="password"` inputs with show/hide toggle
- Never log or display in toasts
- Use `configPatch()` not `configSet()` to avoid overwriting other fields

### Validation Strategy

1. **Client-side**: Type checks, required fields, enum values before sending
2. **Server-side**: `config.apply` runs full Zod schema validation and returns errors
3. **UI**: Show inline validation errors under fields, toast for server errors

### Save Strategy

- **Auto-save per field** (debounced 500ms) for simple toggles/dropdowns
- **Explicit Save button** for complex forms (providers, agents, channels)
- All writes go through `configApply()` for validation
- Show "Unsaved changes" indicator when form is dirty

---

## Priority Matrix

Everything mapped to priority tiers with effort estimates.

### P1 — Must Have (Users are blocked without these)

| # | Feature | Section | Effort | What it unblocks |
|---|---------|---------|--------|------------------|
| 1 | **Models & Providers CRUD** | §10 | L | Users can't add/change/remove AI providers or models |
| 2 | **Environment Variables** | §12 | M | API keys, custom vars — required for provider config |
| 3 | **Agent Defaults** | §13 | M | Thinking level, timeout, workspace — affects every conversation |
| 4 | **Enhanced Channels** | §2 | L | Per-channel config, probe, save/reload — channels are a top feature |
| 5 | **Sessions view** | §4 | L | Per-session overrides, token display, filtering — power users need this |
| 6 | **Cron job enhancements** | §6 | M | Session mode, delivery, channel routing — needed for morning briefs |
| 7 | **Agent tabs & routing** | §7 | L | Per-agent tools/skills/channels — needed for multi-agent |
| 8 | **Shared config editor module** | §impl | M | Foundation for all settings panels |

### P2 — Important (Major value add)

| # | Feature | Section | Effort | What it adds |
|---|---------|---------|--------|--------------|
| 9 | **Voice & TTS** | §24 | L | Morning briefs, audio responses — #1 community request |
| 10 | **Compaction config** | §18 | S | Stop "it forgets" complaints |
| 11 | **Tools config** | §14 | M | Full exec security management |
| 12 | **Nodes exec enhancements** | §9 | M | Target host, scope tabs, full exec policy |
| 13 | **Sessions config** | §15 | M | Compaction settings, reset behavior |
| 14 | **Usage enhancements** | §5 | L | Charts, date range, export |

### P3 — Nice to Have

| # | Feature | Section | Effort |
|---|---------|---------|--------|
| 15 | Dashboard overview cards | §1 | S |
| 16 | Instances view enhancement | §3 | S |
| 17 | Messages config | §16 | S |
| 18 | Memory config (QMD) | §17 | S |
| 19 | Webhooks/Hooks | §19 | M |
| 20 | Gateway config (port/bind/TLS) | §20 | M |
| 21 | Sandbox config | §25 | S |
| 22 | Skills polish (search, grouping) | §8 | S |

### P4 — Polish / Power User

| # | Feature | Section | Effort |
|---|---------|---------|--------|
| 23 | Logging config | §21 | S |
| 24 | Updates config (channel) | §22 | S |
| 25 | UI customization | §23 | S |
| 26 | Debug view | §26 | M |
| 27 | Browser enhancements | §27 | M |
| 28 | Config editor polish (syntax, diff) | §11 | M |

### Effort Key
- **S** = Small (1-2 hours) — single form/section, few fields
- **M** = Medium (2-4 hours) — complex form, multiple sub-sections
- **L** = Large (4-8 hours) — new view with multiple tabs, dynamic rendering, CRUD

---

## Existing Features (Keep As-Is)

These are already fully wired and working:

| Feature | Location | Status |
|---|---|---|
| Gateway Connection config | Settings | ✅ |
| Gateway Status (health/uptime) | Settings | ✅ |
| Usage & Cost dashboard | Settings | ✅ |
| Budget alerts | Settings | ✅ |
| Gateway Logs viewer | Settings | ✅ |
| System Presence | Settings | ✅ |
| Paired Nodes | Nodes view | ✅ |
| Paired Devices | Settings | ✅ |
| Setup Wizard | Settings | ✅ |
| Browser Control | Settings | ✅ |
| Exec Approvals (runtime) | Settings | ✅ |
| Security Audit | Settings | ✅ |
| Security Policies | Settings | ✅ |
| Token Auto-Rotation | Settings | ✅ |
| Self-Update | Settings | ✅ |
| Chat (full streaming) | Chat view | ✅ |
| Session management | Chat view | ✅ |
| Channels (login/logout/status) | Channels view | ✅ |
| Automations (CRUD + history) | Automations view | ✅ |
| Skills (install/enable/config) | Skills view | ✅ |
| Models list (read-only) | Foundry | ✅ |
| Agent modes CRUD | Foundry | ✅ |
| Multi-agent CRUD | Foundry | ✅ |
| Agent files editor | Foundry | ✅ |
| Research (full flow) | Research view | ✅ |
| Mail (Himalaya + vault) | Mail view | ✅ |
| Memory (LanceDB setup + search) | Memory view | ✅ |
| Content AI Improve | Content view | ✅ |
| Projects file browser | Projects view | ✅ |
| Node management | Nodes view | ✅ |

---

## Gateway Events Still Not Consumed

| Event | Use Case | Priority |
|---|---|---|
| `tick` | Real-time dashboard status updates | P3 |
| `health` | Auto-update health without polling | P3 |
| `heartbeat` | Heartbeat monitoring in debug view | P4 |
| `talk.mode` | Update talk mode UI when changed externally | P2 (when voice built) |
| `voicewake.changed` | Update wake words UI when changed | P2 (when voice built) |

---

## Navigation Plan

The settings should be restructured into a tabbed/sidebar layout matching OpenClaw's dashboard:

```
Settings (sidebar or tab nav)
├── Status          — Gateway health, uptime (EXISTING)
├── Models          — Providers + models CRUD (NEW §10)
├── Agents          — Defaults + agent config (NEW §13)
├── Tools           — Exec security + tool policies (NEW §14)
├── Environment     — Env vars table (NEW §12)
├── Sessions        — Session config + list (NEW §4 + §15)
├── Channels        — Enhanced per-channel config (ENHANCED §2)
├── Voice           — TTS + Talk + Wake (NEW §24)
├── Automation      — Cron config (link to Automations)
├── Webhooks        — Hooks config (NEW §19)
├── Memory          — Memory config (link to Memory Palace)
├── Gateway         — Port, bind, TLS, auth (NEW §20)
├── Logging         — Level, style (NEW §21)
├── Security        — Audit + Policies (EXISTING)
├── Devices         — Pairing + tokens (EXISTING)
├── Browser         — Control + tabs (EXISTING)
├── Updates         — Channel, check-on-start (EXISTING + §22)
├── Debug           — Event stream, health, WS info (NEW §26)
├── Config          — Raw JSON editor (EXISTING, enhanced §11)
```

---

## Summary

**Total features identified**: 28 feature areas across the OpenClaw dashboard and config schema.

**Already built**: ~18 feature areas are wired and working in Paw today.

**Missing entirely**: ~10 feature areas have zero UI:
1. Models & Providers management (read-only today)
2. Environment Variables
3. Agent Defaults config
4. Per-agent tabs (Tools/Skills/Channels/Cron)
5. Sessions dedicated view with overrides
6. Enhanced Cron (session mode, delivery, channel)
7. Voice & TTS
8. Webhooks
9. Debug view
10. Config-level tools settings

**Partially built** (has basics, missing depth): ~6 areas:
1. Channels (login/status works, no per-channel config editing)
2. Usage (basics work, no charts/filters/export)
3. Exec Approvals (runtime works, no config-level depth)
4. Browser (start/stop works, no screenshots/interaction)
5. Skills (install/config works, no search/grouping)
6. Gateway (connection works, no port/bind/TLS config)

**The goal**: A user downloads Paw, installs OpenClaw, and never touches a terminal again. Every configuration, every feature, every integration — accessible through buttons, forms, and toggles.
