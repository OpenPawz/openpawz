// Settings: Logs — Orchestration, state, exports

import { $ } from '../../components/helpers';
import { initMoleculesState, renderLogViewer, destroyLogViewer } from './molecules';

// ── Log directory (matches main.ts file transport) ────────────────

let _logDir = '';

async function resolveLogDir(): Promise<string> {
  if (_logDir) return _logDir;
  try {
    const path = await import('@tauri-apps/api/path');
    _logDir = await path.join(await path.homeDir(), 'Documents', 'Paw', 'logs');
  } catch {
    _logDir = '';
  }
  return _logDir;
}

// ── State bridge ──────────────────────────────────────────────────

const { setMoleculesState } = initMoleculesState();
setMoleculesState({
  getLogDir: () => _logDir,
});

// ── Public API ────────────────────────────────────────────────────

export async function loadLogsSettings() {
  const container = $('settings-logs-content');
  if (!container) return;

  await resolveLogDir();
  setMoleculesState({ getLogDir: () => _logDir });

  await renderLogViewer(container);
}

export function unloadLogsSettings() {
  destroyLogViewer();
}

export function initLogsSettings() {
  // All dynamic — loaded when tab is opened
}
