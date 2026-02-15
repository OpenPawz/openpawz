// Settings View — Logs, Usage, Presence, Nodes, Devices, Exec Approvals
// Extracted from main.ts for maintainability

import { gateway } from '../gateway';
import type { ExecApprovalsSnapshot } from '../types';

const $ = (id: string) => document.getElementById(id);

// Shared state — will be passed from main
let wsConnected = false;

export function setWsConnected(connected: boolean) {
  wsConnected = connected;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Logs Viewer ────────────────────────────────────────────────────────────
export async function loadSettingsLogs() {
  if (!wsConnected) return;
  const section = $('settings-logs-section');
  const output = $('settings-logs-output');
  const linesSelect = $('settings-logs-lines') as HTMLSelectElement | null;
  try {
    const lines = parseInt(linesSelect?.value ?? '100', 10);
    const result = await gateway.logsTail(lines);
    if (section) section.style.display = '';
    if (output) output.textContent = (result.lines ?? []).join('\n') || '(no logs)';
  } catch (e) {
    console.warn('[settings] Logs load failed:', e);
    if (section) section.style.display = 'none';
  }
}

// ── Usage Dashboard ────────────────────────────────────────────────────────
export async function loadSettingsUsage() {
  if (!wsConnected) return;
  const section = $('settings-usage-section');
  const content = $('settings-usage-content');
  try {
    const [status, cost] = await Promise.all([
      gateway.usageStatus().catch(() => null),
      gateway.usageCost().catch(() => null),
    ]);
    if (!status && !cost) { if (section) section.style.display = 'none'; return; }
    if (section) section.style.display = '';
    let html = '';
    if (status?.total) {
      html += `<div class="usage-card">
        <div class="usage-card-label">Requests</div>
        <div class="usage-card-value">${status.total.requests?.toLocaleString() ?? '—'}</div>
      </div>
      <div class="usage-card">
        <div class="usage-card-label">Tokens</div>
        <div class="usage-card-value">${status.total.tokens?.toLocaleString() ?? '—'}</div>
        <div class="usage-card-sub">In: ${(status.total.inputTokens ?? 0).toLocaleString()} / Out: ${(status.total.outputTokens ?? 0).toLocaleString()}</div>
      </div>`;
    }
    if (cost?.totalCost != null) {
      html += `<div class="usage-card">
        <div class="usage-card-label">Cost</div>
        <div class="usage-card-value">$${cost.totalCost.toFixed(4)} ${cost.currency ?? ''}</div>
      </div>`;
    }
    if (status?.byModel) {
      html += '<div class="usage-models"><h4>By Model</h4>';
      for (const [model, data] of Object.entries(status.byModel)) {
        const d = data as { requests?: number; tokens?: number };
        html += `<div class="usage-model-row"><span class="usage-model-name">${escHtml(model)}</span><span>${(d.requests ?? 0).toLocaleString()} req / ${(d.tokens ?? 0).toLocaleString()} tok</span></div>`;
      }
      html += '</div>';
    }
    if (content) content.innerHTML = html || '<p style="color:var(--text-muted)">No usage data</p>';
  } catch (e) {
    console.warn('[settings] Usage load failed:', e);
    if (section) section.style.display = 'none';
  }
}

// ── System Presence ────────────────────────────────────────────────────────
export async function loadSettingsPresence() {
  if (!wsConnected) return;
  const section = $('settings-presence-section');
  const list = $('settings-presence-list');
  try {
    const result = await gateway.systemPresence();
    const entries = result.entries ?? [];
    if (!entries.length) { if (section) section.style.display = 'none'; return; }
    if (section) section.style.display = '';
    if (list) {
      list.innerHTML = entries.map(e => {
        const name = e.client?.id ?? e.connId ?? 'Unknown';
        const platform = e.client?.platform ?? '';
        const role = e.role ?? '';
        return `
          <div class="presence-entry">
            <div class="presence-dot online"></div>
            <div class="presence-info">
              <div class="presence-name">${escHtml(name)}</div>
              <div class="presence-meta">${escHtml(role)} · ${escHtml(platform)}${e.connectedAt ? ' · ' + new Date(e.connectedAt).toLocaleString() : ''}</div>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (e) {
    console.warn('[settings] Presence load failed:', e);
    if (section) section.style.display = 'none';
  }
}

// ── Nodes View ─────────────────────────────────────────────────────────────
export async function loadSettingsNodes() {
  if (!wsConnected) return;
  const section = $('settings-nodes-section');
  const list = $('settings-nodes-list');
  try {
    const result = await gateway.nodeList();
    const nodes = result.nodes ?? [];
    if (!nodes.length) { 
      if (section) section.style.display = 'none'; 
      return; 
    }
    if (section) section.style.display = '';
    if (list) {
      list.innerHTML = nodes.map(n => {
        const status = n.connected ? 'online' : 'offline';
        const caps = n.caps?.join(', ') || 'none';
        return `
          <div class="node-entry">
            <div class="presence-dot ${status}"></div>
            <div class="presence-info">
              <div class="presence-name">${escHtml(n.name || n.id)}</div>
              <div class="presence-meta">${escHtml(n.platform || '')} · ${escHtml(n.deviceFamily || '')} · Caps: ${escHtml(caps)}</div>
            </div>
            ${n.connected ? `<button class="btn btn-ghost btn-sm node-invoke-btn" data-node-id="${escHtml(n.id)}">Invoke</button>` : ''}
          </div>
        `;
      }).join('');
      
      // Wire invoke buttons
      list.querySelectorAll('.node-invoke-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const nodeId = btn.getAttribute('data-node-id');
          if (!nodeId) return;
          const command = prompt('Command to invoke (e.g., camera.snap):');
          if (!command) return;
          try {
            const result = await gateway.nodeInvoke(nodeId, command);
            alert(`Result: ${JSON.stringify(result, null, 2)}`);
          } catch (e) {
            alert(`Error: ${e instanceof Error ? e.message : e}`);
          }
        });
      });
    }
  } catch (e) {
    console.warn('[settings] Nodes load failed:', e);
    if (section) section.style.display = 'none';
  }
}

// ── Device Pairing ─────────────────────────────────────────────────────────
export async function loadSettingsDevices() {
  if (!wsConnected) return;
  const section = $('settings-devices-section');
  const list = $('settings-devices-list');
  const emptyEl = $('settings-devices-empty');
  try {
    const result = await gateway.devicePairList();
    const devices = result.devices ?? [];
    if (section) section.style.display = '';
    if (!devices.length) {
      if (list) list.innerHTML = '';
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (list) {
      list.innerHTML = devices.map(d => {
        const name = d.name || d.id;
        const platform = d.platform || 'Unknown';
        const paired = d.pairedAt ? new Date(d.pairedAt).toLocaleDateString() : '—';
        return `
          <div class="device-card">
            <div class="device-card-info">
              <div class="device-card-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
              </div>
              <div>
                <div class="device-card-name">${escHtml(name)}</div>
                <div class="device-card-meta">${escHtml(platform)} · Paired ${escHtml(paired)}</div>
              </div>
            </div>
            <div class="device-card-actions">
              <button class="btn btn-ghost btn-sm device-rotate-btn" data-device-id="${escHtml(d.id)}" title="Rotate auth token">
                <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                Rotate Token
              </button>
              <button class="btn btn-danger btn-sm device-revoke-btn" data-device-id="${escHtml(d.id)}" title="Revoke device access">
                <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                Revoke
              </button>
            </div>
          </div>
        `;
      }).join('');

      // Wire rotate buttons
      list.querySelectorAll('.device-rotate-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const deviceId = btn.getAttribute('data-device-id');
          if (!deviceId) return;
          try {
            const result = await gateway.deviceTokenRotate(deviceId);
            showSettingsToast(`Token rotated${result.token ? ' — new token: ' + result.token.slice(0, 8) + '…' : ''}`, 'success');
          } catch (e) {
            showSettingsToast(`Failed to rotate token: ${e instanceof Error ? e.message : e}`, 'error');
          }
        });
      });

      // Wire revoke buttons
      list.querySelectorAll('.device-revoke-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const deviceId = btn.getAttribute('data-device-id');
          if (!deviceId) return;
          if (!confirm('Revoke access for this device? It will need to re-pair.')) return;
          try {
            await gateway.deviceTokenRevoke(deviceId);
            showSettingsToast('Device access revoked', 'success');
            loadSettingsDevices(); // Refresh list
          } catch (e) {
            showSettingsToast(`Failed to revoke: ${e instanceof Error ? e.message : e}`, 'error');
          }
        });
      });
    }
  } catch (e) {
    console.warn('[settings] Devices load failed:', e);
    if (section) section.style.display = 'none';
  }
}

// ── Exec Approvals Config ──────────────────────────────────────────────────
let _currentApprovals: ExecApprovalsSnapshot | null = null;

export async function loadSettingsApprovals() {
  if (!wsConnected) return;
  const section = $('settings-approvals-section');
  const allowList = $('approvals-allow-list') as HTMLTextAreaElement | null;
  const denyList = $('approvals-deny-list') as HTMLTextAreaElement | null;
  const askPolicy = $('approvals-ask-policy') as HTMLSelectElement | null;
  try {
    const snapshot = await gateway.execApprovalsGet();
    _currentApprovals = snapshot;
    if (section) section.style.display = '';
    if (allowList) allowList.value = (snapshot.gateway?.allow ?? []).join('\n');
    if (denyList) denyList.value = (snapshot.gateway?.deny ?? []).join('\n');
    if (askPolicy) askPolicy.value = snapshot.gateway?.askPolicy ?? 'ask';
  } catch (e) {
    console.warn('[settings] Approvals load failed:', e);
    if (section) section.style.display = 'none';
  }
}

async function saveSettingsApprovals() {
  const allowList = $('approvals-allow-list') as HTMLTextAreaElement | null;
  const denyList = $('approvals-deny-list') as HTMLTextAreaElement | null;
  const askPolicy = $('approvals-ask-policy') as HTMLSelectElement | null;
  if (!allowList || !denyList || !askPolicy) return;

  const allow = allowList.value.split('\n').map(s => s.trim()).filter(Boolean);
  const deny = denyList.value.split('\n').map(s => s.trim()).filter(Boolean);
  const policy = askPolicy.value;

  try {
    await gateway.execApprovalsSet({
      gateway: { allow, deny, askPolicy: policy },
    });
    showSettingsToast('Approval rules saved', 'success');
    _currentApprovals = { gateway: { allow, deny, askPolicy: policy }, node: _currentApprovals?.node ?? { allow: [], deny: [], askPolicy: 'ask' } };
  } catch (e) {
    showSettingsToast(`Failed to save: ${e instanceof Error ? e.message : e}`, 'error');
  }
}

// ── Settings toast (inline) ────────────────────────────────────────────────
function showSettingsToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  // Try to use the global toast if available
  const toast = document.getElementById('global-toast');
  if (toast) {
    toast.textContent = message;
    toast.className = `global-toast toast-${type}`;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3500);
  }
}

// ── Initialize event listeners ─────────────────────────────────────────────
export function initSettings() {
  $('settings-refresh-logs')?.addEventListener('click', () => loadSettingsLogs());
  $('settings-refresh-usage')?.addEventListener('click', () => loadSettingsUsage());
  $('settings-refresh-presence')?.addEventListener('click', () => loadSettingsPresence());
  $('settings-refresh-nodes')?.addEventListener('click', () => loadSettingsNodes());
  $('settings-refresh-devices')?.addEventListener('click', () => loadSettingsDevices());
  $('settings-refresh-approvals')?.addEventListener('click', () => loadSettingsApprovals());
  $('settings-save-approvals')?.addEventListener('click', () => saveSettingsApprovals());
}

// ── Load all settings data ─────────────────────────────────────────────────
export async function loadSettings() {
  await Promise.all([
    loadSettingsLogs(),
    loadSettingsUsage(),
    loadSettingsPresence(),
    loadSettingsNodes(),
    loadSettingsDevices(),
    loadSettingsApprovals(),
  ]);
}
