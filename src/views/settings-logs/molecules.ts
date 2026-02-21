// Settings: Logs — DOM rendering, tail-follow, filtering

import { escHtml, $ } from '../../components/helpers';
import { getRecentLogs, type LogEntry } from '../../logger';
import {
  LOG_LEVEL_CLASSES,
  LOG_LEVEL_LABELS,
  LOG_LEVEL_OPTIONS,
  TAIL_POLL_INTERVAL_MS,
  MAX_RENDERED_LINES,
  parseLogLine,
} from './atoms';

// ── State bridge ──────────────────────────────────────────────────────

interface MoleculesState {
  getLogDir: () => string;
}

let _state: MoleculesState;
let _tailTimer: ReturnType<typeof setInterval> | null = null;
let _lastEntryCount = 0;
let _autoFollow = true;
let _filterLevel = '';
let _filterModule = '';
let _filterSearch = '';
let _currentSource: 'live' | 'file' = 'live';

export function initMoleculesState() {
  return {
    setMoleculesState(s: MoleculesState) {
      _state = s;
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function matchesFilter(entry: { level: string; module: string; message: string }): boolean {
  if (_filterLevel && entry.level !== _filterLevel) return false;
  if (_filterModule && !entry.module.toLowerCase().includes(_filterModule.toLowerCase()))
    return false;
  if (
    _filterSearch &&
    !entry.message.toLowerCase().includes(_filterSearch.toLowerCase()) &&
    !entry.module.toLowerCase().includes(_filterSearch.toLowerCase())
  )
    return false;
  return true;
}

function renderEntry(entry: LogEntry): string {
  if (!matchesFilter(entry)) return '';
  const cls = LOG_LEVEL_CLASSES[entry.level];
  const badge = LOG_LEVEL_LABELS[entry.level];
  const ts = entry.timestamp.replace('T', ' ').replace('Z', '');
  const data = entry.data
    ? ` <span class="log-data">${escHtml(JSON.stringify(entry.data))}</span>`
    : '';
  return `<div class="log-line ${cls}"><span class="log-ts">${escHtml(ts)}</span> <span class="log-badge ${cls}">${badge}</span> <span class="log-module">[${escHtml(entry.module)}]</span> <span class="log-msg">${escHtml(entry.message)}</span>${data}</div>`;
}

function renderParsedLine(line: string): string {
  const parsed = parseLogLine(line);
  if (!parsed) {
    // Non-matching line (e.g. continuation) — show as-is
    if (_filterSearch && !line.toLowerCase().includes(_filterSearch.toLowerCase())) return '';
    return `<div class="log-line log-level-debug"><span class="log-msg">${escHtml(line)}</span></div>`;
  }
  if (!matchesFilter(parsed)) return '';
  const cls = LOG_LEVEL_CLASSES[parsed.level];
  const badge = LOG_LEVEL_LABELS[parsed.level];
  const ts = parsed.timestamp.replace('T', ' ').replace('Z', '');
  return `<div class="log-line ${cls}"><span class="log-ts">${escHtml(ts)}</span> <span class="log-badge ${cls}">${badge}</span> <span class="log-module">[${escHtml(parsed.module)}]</span> <span class="log-msg">${escHtml(parsed.message)}</span></div>`;
}

function scrollToBottom() {
  const output = $('log-viewer-output');
  if (output && _autoFollow) {
    output.scrollTop = output.scrollHeight;
  }
}

// ── Live tail (in-memory ring buffer) ─────────────────────────────

function refreshLiveView() {
  const output = $('log-viewer-output');
  if (!output) return;

  const entries = getRecentLogs(MAX_RENDERED_LINES);
  const html = entries.map(renderEntry).filter(Boolean).join('');
  output.innerHTML =
    html || '<div class="log-empty">No log entries match the current filters.</div>';
  _lastEntryCount = entries.length;
  scrollToBottom();
}

function startTail() {
  stopTail();
  _tailTimer = setInterval(() => {
    if (_currentSource !== 'live') return;
    const entries = getRecentLogs(MAX_RENDERED_LINES);
    if (entries.length !== _lastEntryCount) {
      refreshLiveView();
    }
  }, TAIL_POLL_INTERVAL_MS);
}

function stopTail() {
  if (_tailTimer) {
    clearInterval(_tailTimer);
    _tailTimer = null;
  }
}

// ── File log view ─────────────────────────────────────────────────

async function loadLogFile(date: string) {
  const output = $('log-viewer-output');
  if (!output) return;

  output.innerHTML = '<div class="log-empty">Loading...</div>';

  try {
    const fs = await import('@tauri-apps/plugin-fs');
    const path = await import('@tauri-apps/api/path');
    const logDir = _state.getLogDir();
    const filePath = await path.join(logDir, `paw-${date}.log`);

    let content: string;
    try {
      content = await fs.readTextFile(filePath);
    } catch {
      output.innerHTML = `<div class="log-empty">No log file found for ${escHtml(date)}.</div>`;
      return;
    }

    const lines = content.split('\n').filter((l) => l.trim());
    const rendered = lines
      .slice(-MAX_RENDERED_LINES)
      .map(renderParsedLine)
      .filter(Boolean)
      .join('');

    output.innerHTML =
      rendered || '<div class="log-empty">No log entries match the current filters.</div>';
    scrollToBottom();
  } catch (e) {
    output.innerHTML = `<div class="log-empty">Error reading logs: ${escHtml(String(e))}</div>`;
  }
}

async function listLogFiles(): Promise<string[]> {
  try {
    const fs = await import('@tauri-apps/plugin-fs');
    const logDir = _state.getLogDir();
    const entries = await fs.readDir(logDir);
    return entries
      .map((e) => e.name || '')
      .filter((n) => /^paw-\d{4}-\d{2}-\d{2}\.log$/.test(n))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// ── Render ─────────────────────────────────────────────────────────

export async function renderLogViewer(container: HTMLElement) {
  const files = await listLogFiles();
  const fileOptions = files
    .map((f) => {
      const m = f.match(/^paw-(\d{4}-\d{2}-\d{2})\.log$/);
      const date = m ? m[1] : f;
      return `<option value="${date}">${date}</option>`;
    })
    .join('');

  container.innerHTML = `
    <div class="log-viewer">
      <div class="log-toolbar">
        <div class="log-toolbar-group">
          <label class="log-toolbar-label">Source</label>
          <select class="form-input log-toolbar-select" id="log-source-select">
            <option value="live" selected>Live (in-memory)</option>
            ${fileOptions}
          </select>
        </div>
        <div class="log-toolbar-group">
          <label class="log-toolbar-label">Level</label>
          <select class="form-input log-toolbar-select" id="log-level-filter">
            ${LOG_LEVEL_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}
          </select>
        </div>
        <div class="log-toolbar-group">
          <label class="log-toolbar-label">Module</label>
          <input type="text" class="form-input log-toolbar-input" id="log-module-filter" placeholder="e.g. engine, chat">
        </div>
        <div class="log-toolbar-group">
          <label class="log-toolbar-label">Search</label>
          <input type="text" class="form-input log-toolbar-input" id="log-search-filter" placeholder="Search messages...">
        </div>
        <div class="log-toolbar-group log-toolbar-actions">
          <button class="btn btn-ghost btn-sm" id="log-refresh-btn" title="Refresh">
            <span class="ms ms-sm">refresh</span>
          </button>
          <label class="log-toolbar-toggle" title="Auto-follow new entries">
            <input type="checkbox" id="log-auto-follow" checked>
            <span class="ms ms-sm">vertical_align_bottom</span>
            Follow
          </label>
        </div>
      </div>
      <div class="log-viewer-output" id="log-viewer-output"></div>
      <div class="log-status-bar">
        <span id="log-status-text">Live tail active</span>
      </div>
    </div>
  `;

  // ── Wire events ──
  const sourceSelect = $('log-source-select') as HTMLSelectElement | null;
  const levelFilter = $('log-level-filter') as HTMLSelectElement | null;
  const moduleFilter = $('log-module-filter') as HTMLInputElement | null;
  const searchFilter = $('log-search-filter') as HTMLInputElement | null;
  const refreshBtn = $('log-refresh-btn');
  const autoFollowCb = $('log-auto-follow') as HTMLInputElement | null;

  sourceSelect?.addEventListener('change', () => {
    const val = sourceSelect.value;
    if (val === 'live') {
      _currentSource = 'live';
      refreshLiveView();
      startTail();
      updateStatus('Live tail active');
    } else {
      _currentSource = 'file';
      stopTail();
      loadLogFile(val);
      updateStatus(`Viewing log file: paw-${val}.log`);
    }
  });

  levelFilter?.addEventListener('change', () => {
    _filterLevel = levelFilter.value;
    applyFilters();
  });

  let moduleTimer: ReturnType<typeof setTimeout> | null = null;
  moduleFilter?.addEventListener('input', () => {
    if (moduleTimer) clearTimeout(moduleTimer);
    moduleTimer = setTimeout(() => {
      _filterModule = moduleFilter.value;
      applyFilters();
    }, 300);
  });

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  searchFilter?.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      _filterSearch = searchFilter.value;
      applyFilters();
    }, 300);
  });

  refreshBtn?.addEventListener('click', () => {
    applyFilters();
  });

  autoFollowCb?.addEventListener('change', () => {
    _autoFollow = autoFollowCb.checked;
    if (_autoFollow) scrollToBottom();
  });

  // Initial render
  _currentSource = 'live';
  _filterLevel = '';
  _filterModule = '';
  _filterSearch = '';
  _autoFollow = true;
  refreshLiveView();
  startTail();
}

function applyFilters() {
  if (_currentSource === 'live') {
    refreshLiveView();
  } else {
    const sourceSelect = $('log-source-select') as HTMLSelectElement | null;
    if (sourceSelect) loadLogFile(sourceSelect.value);
  }
}

function updateStatus(text: string) {
  const el = $('log-status-text');
  if (el) el.textContent = text;
}

/** Clean up timers when leaving the tab. */
export function destroyLogViewer() {
  stopTail();
}
