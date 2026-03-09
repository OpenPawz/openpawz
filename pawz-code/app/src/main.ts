/**
 * main.ts — Pawz CODE Control App
 *
 * A compact Tauri control panel for the pawz-code daemon.
 * Reads config from ~/.pawz-code/config.toml and polls the daemon status.
 *
 * Panels:
 *   - Service status (connected/disconnected, model, provider)
 *   - Activity stats (active runs, memory entries, engram entries, protocols)
 *   - Protocol list
 *   - Controls (refresh, open config)
 *   - Log viewer
 */

interface DaemonStatus {
  status: string;
  service: string;
  version?: string;
  model?: string;
  provider?: string;
  workspace_root?: string | null;
  active_runs?: number;
  memory_entries?: number;
  engram_entries?: number;
  protocols?: string[];
  max_rounds?: number;
}

const POLL_INTERVAL_MS = 10_000;
const DEFAULT_PORT = 3941;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let authToken = '';
let serverUrl = `http://127.0.0.1:${DEFAULT_PORT}`;

// ── DOM helpers ───────────────────────────────────────────────────────────────

function el(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

function setText(id: string, value: string): void {
  const e = el(id);
  if (e) e.textContent = value;
}

function log(msg: string): void {
  const box = el('log-box');
  if (!box) return;
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
  // Keep only last 100 lines
  while (box.children.length > 100) {
    box.removeChild(box.firstChild!);
  }
}

// ── Config loader ─────────────────────────────────────────────────────────────

async function loadConfig(): Promise<void> {
  try {
    // Try to read the config via Tauri fs API if available
    // Falls back to defaults
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<{ auth_token: string; port: number; bind: string }>('load_config');
    authToken = result.auth_token;
    serverUrl = `http://${result.bind}:${result.port}`;
    log(`Config loaded: ${serverUrl}`);
  } catch {
    // No Tauri runtime — running in browser dev mode
    authToken = localStorage.getItem('pawzcode_token') ?? '';
    const storedUrl = localStorage.getItem('pawzcode_url');
    if (storedUrl) serverUrl = storedUrl;
    log(`Dev mode: ${serverUrl}`);
  }
}

// ── Status poll ───────────────────────────────────────────────────────────────

async function fetchStatus(): Promise<DaemonStatus | null> {
  if (!authToken) return null;
  try {
    const resp = await fetch(`${serverUrl}/status`, {
      headers: { Authorization: `Bearer ${authToken}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as DaemonStatus;
  } catch {
    return null;
  }
}

function applyStatus(data: DaemonStatus | null): void {
  const dot = el('status-dot');
  const statusText = el('status-text');

  if (!data) {
    dot?.classList.remove('connected');
    dot?.classList.add('disconnected');
    if (statusText) statusText.textContent = 'Disconnected';
    setText('info-model', '—');
    setText('info-provider', '—');
    setText('info-workspace', '—');
    setText('info-version', '—');
    setText('stat-runs', '—');
    setText('stat-memory', '—');
    setText('stat-engram', '—');
    setText('stat-protocols', '—');
    const protoList = el('protocols-list');
    if (protoList) protoList.textContent = 'Not connected';
    return;
  }

  dot?.classList.remove('disconnected');
  dot?.classList.add('connected');
  if (statusText) statusText.textContent = `Connected`;

  setText('info-model', data.model ?? '—');
  setText('info-provider', data.provider ?? '—');
  setText('info-workspace', data.workspace_root ?? '(not set)');
  setText('info-version', data.version ?? '—');
  setText('stat-runs', String(data.active_runs ?? 0));
  setText('stat-memory', String(data.memory_entries ?? 0));
  setText('stat-engram', String(data.engram_entries ?? 0));
  setText('stat-protocols', String((data.protocols ?? []).length));

  const protoList = el('protocols-list');
  if (protoList) {
    protoList.innerHTML = '';
    for (const p of data.protocols ?? []) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = p;
      protoList.appendChild(tag);
    }
    if ((data.protocols ?? []).length === 0) {
      protoList.textContent = 'None loaded';
    }
  }
}

async function refresh(): Promise<void> {
  const data = await fetchStatus();
  applyStatus(data);
  if (data) {
    log(`Refreshed — model: ${data.model}, runs: ${data.active_runs}`);
  } else {
    log('Daemon unreachable');
  }
}

// Expose to HTML onclick handlers
(window as unknown as Record<string, unknown>).refresh = refresh;
(window as unknown as Record<string, unknown>).openConfig = openConfig;

function openConfig(): void {
  const home = (window as unknown as { __TAURI__?: unknown }).__TAURI__
    ? '(open ~/.pawz-code/config.toml in your editor)'
    : 'Set token in localStorage: localStorage.setItem("pawzcode_token", "YOUR_TOKEN")';
  log(home);
  // In real Tauri, we'd open the config file with the system editor
}

// ── Footer time ───────────────────────────────────────────────────────────────

function updateFooterTime(): void {
  const e = el('footer-time');
  if (e) e.textContent = new Date().toLocaleTimeString();
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  log('Starting Pawz CODE control panel...');
  await loadConfig();

  if (!authToken) {
    log('⚠ No auth token configured. Edit ~/.pawz-code/config.toml');
    applyStatus(null);
  } else {
    await refresh();
  }

  // Start polling
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refresh, POLL_INTERVAL_MS);

  // Footer clock
  updateFooterTime();
  setInterval(updateFooterTime, 1000);
}

void init();
