// Settings: n8n — DOM rendering + IPC

import { pawEngine } from '../../engine';
import { showToast } from '../../components/toast';
import type { N8nConfig, N8nTestResult, N8nWorkflow } from '../../engine/atoms/types';
import { $ } from '../../components/helpers';
import { esc, makeBtn, workflowCountLabel } from './atoms';

const INPUT_STYLE =
  'width:100%;margin-top:4px;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);font-size:13px';

export async function loadN8nSettings() {
  const container = $('settings-n8n-content');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted)">Loading n8n configuration\u2026</p>';

  let config: N8nConfig;
  try {
    config = await pawEngine.n8nGetConfig();
  } catch (e: unknown) {
    container.innerHTML = `<p style="color:var(--text-error)">Failed to load: ${esc(e instanceof Error ? e.message : String(e))}</p>`;
    return;
  }

  container.innerHTML = '';

  // ── Connection Form ──────────────────────────────────────────────
  const formSection = document.createElement('div');
  formSection.className = 'settings-subsection';
  formSection.style.marginBottom = '20px';
  formSection.innerHTML = `<h3 class="settings-subsection-title">Connection</h3>`;

  const form = document.createElement('div');
  form.style.cssText = 'display:flex;flex-direction:column;gap:12px;max-width:480px;margin-top:8px';

  form.innerHTML = `
    <label style="font-size:12px;font-weight:600">n8n Instance URL
      <input type="text" id="n8n-url" value="${esc(config.url)}" placeholder="https://your-n8n.example.com"
        style="${INPUT_STYLE}" />
    </label>
    <label style="font-size:12px;font-weight:600">API Key
      <div style="display:flex;gap:6px;margin-top:4px">
        <input type="password" id="n8n-api-key" value="${esc(config.api_key)}" placeholder="n8n API key"
          style="${INPUT_STYLE};flex:1;font-family:monospace" />
        <button class="btn btn-ghost btn-sm" id="n8n-show-key" title="Toggle visibility" style="white-space:nowrap">Show</button>
      </div>
    </label>
    <label style="font-size:12px;display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" id="n8n-enabled" ${config.enabled ? 'checked' : ''} />
      Enable n8n integration
    </label>
    <label style="font-size:12px;display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" id="n8n-auto-discover" ${config.auto_discover ? 'checked' : ''} />
      Auto-discover workflows on connect
    </label>
    <label style="font-size:12px;display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" id="n8n-mcp-mode" ${config.mcp_mode ? 'checked' : ''} />
      Use MCP bridge mode <span style="font-weight:normal;color:var(--text-muted)">(Phase 3)</span>
    </label>`;

  formSection.appendChild(form);
  container.appendChild(formSection);

  // ── Toggle key visibility ────────────────────────────────────────
  const showKeyBtn = $('n8n-show-key') as HTMLButtonElement | null;
  const keyInput = $('n8n-api-key') as HTMLInputElement | null;
  if (showKeyBtn && keyInput) {
    showKeyBtn.addEventListener('click', () => {
      const visible = keyInput.type === 'text';
      keyInput.type = visible ? 'password' : 'text';
      showKeyBtn.textContent = visible ? 'Show' : 'Hide';
    });
  }

  // ── Action Buttons ───────────────────────────────────────────────
  const actionSection = document.createElement('div');
  actionSection.className = 'settings-subsection';
  actionSection.style.marginBottom = '20px';

  const actionBtns = document.createElement('div');
  actionBtns.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px';

  actionBtns.appendChild(
    makeBtn('Save', 'btn-primary', async () => {
      const urlInput = $('n8n-url') as HTMLInputElement | null;
      const apiKeyInput = $('n8n-api-key') as HTMLInputElement | null;
      const enabledInput = $('n8n-enabled') as HTMLInputElement | null;
      const autoDiscoverInput = $('n8n-auto-discover') as HTMLInputElement | null;
      const mcpModeInput = $('n8n-mcp-mode') as HTMLInputElement | null;
      if (!urlInput || !apiKeyInput) return;

      const newConfig: N8nConfig = {
        url: urlInput.value.trim(),
        api_key: apiKeyInput.value,
        enabled: enabledInput?.checked ?? false,
        auto_discover: autoDiscoverInput?.checked ?? false,
        mcp_mode: mcpModeInput?.checked ?? false,
      };

      try {
        await pawEngine.n8nSetConfig(newConfig);

        // Sync credentials to the TOML skill vault so the prompt-based
        // n8n skill (`resources/n8n/pawz-skill.toml`) keeps working.
        try {
          if (newConfig.url) {
            await pawEngine.skillSetCredential('n8n', 'N8N_BASE_URL', newConfig.url);
          }
          if (newConfig.api_key) {
            await pawEngine.skillSetCredential('n8n', 'N8N_API_KEY', newConfig.api_key);
          }
        } catch {
          // Non-fatal — skill vault sync is best-effort
          console.warn('[n8n] Could not sync credentials to TOML skill vault');
        }

        showToast('n8n configuration saved', 'success');
      } catch (e: unknown) {
        showToast(`Failed to save: ${e instanceof Error ? e.message : String(e)}`, 'error');
      }
    }),
  );

  actionBtns.appendChild(
    makeBtn('Test Connection', 'btn-ghost', async () => {
      const urlInput = $('n8n-url') as HTMLInputElement | null;
      const apiKeyInput = $('n8n-api-key') as HTMLInputElement | null;
      if (!urlInput || !apiKeyInput) return;

      const statusEl = $('n8n-test-status');
      if (statusEl) {
        statusEl.innerHTML =
          '<span style="color:var(--text-muted)">Testing connection\u2026</span>';
      }

      try {
        const result: N8nTestResult = await pawEngine.n8nTestConnection(
          urlInput.value.trim(),
          apiKeyInput.value,
        );
        renderTestResult(result);
      } catch (e: unknown) {
        if (statusEl) {
          statusEl.innerHTML = `<span style="color:var(--text-error)">Error: ${esc(e instanceof Error ? e.message : String(e))}</span>`;
        }
      }
    }),
  );

  actionSection.appendChild(actionBtns);
  container.appendChild(actionSection);

  // ── Test Result ──────────────────────────────────────────────────
  const testSection = document.createElement('div');
  testSection.className = 'settings-subsection';
  testSection.id = 'n8n-test-status';
  testSection.style.marginBottom = '20px';
  container.appendChild(testSection);

  // ── Workflow Browser ─────────────────────────────────────────────
  const wfSection = document.createElement('div');
  wfSection.className = 'settings-subsection';
  wfSection.style.marginBottom = '20px';
  wfSection.innerHTML = `
    <h3 class="settings-subsection-title">
      <span class="ms ms-sm">account_tree</span>
      Discovered Workflows
    </h3>`;

  const wfContainer = document.createElement('div');
  wfContainer.id = 'n8n-workflow-list';
  wfContainer.innerHTML =
    '<p style="color:var(--text-muted);font-size:13px">Connect to n8n and click "Refresh" to discover workflows.</p>';
  wfSection.appendChild(wfContainer);

  const wfActions = document.createElement('div');
  wfActions.style.cssText = 'display:flex;gap:8px;margin-top:8px';
  wfActions.appendChild(
    makeBtn('Refresh Workflows', 'btn-ghost', async () => {
      await refreshWorkflows();
    }),
  );
  wfSection.appendChild(wfActions);

  container.appendChild(wfSection);
}

// ── Helpers ─────────────────────────────────────────────────────────

function renderTestResult(result: N8nTestResult) {
  const el = $('n8n-test-status');
  if (!el) return;

  if (result.connected) {
    const versionStr = result.version ? ` \u00b7 v${esc(result.version)}` : '';
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:13px;max-width:480px">
        <span style="color:var(--text-muted)">Status</span>
        <span><span class="ms ms-sm" style="color:var(--success)">check_circle</span> Connected${versionStr}</span>
        <span style="color:var(--text-muted)">Workflows</span>
        <span>${workflowCountLabel(result.workflow_count)}</span>
      </div>`;
  } else {
    el.innerHTML = `
      <div style="font-size:13px">
        <span class="ms ms-sm" style="color:var(--text-error)">error</span>
        <span style="color:var(--text-error)">${esc(result.error || 'Connection failed')}</span>
      </div>`;
  }
}

async function refreshWorkflows() {
  const container = $('n8n-workflow-list');
  if (!container) return;

  container.innerHTML =
    '<p style="color:var(--text-muted);font-size:13px">Fetching workflows\u2026</p>';

  let workflows: N8nWorkflow[];
  try {
    workflows = await pawEngine.n8nListWorkflows();
  } catch (e: unknown) {
    container.innerHTML = `<p style="color:var(--text-error);font-size:13px">${esc(e instanceof Error ? e.message : String(e))}</p>`;
    return;
  }

  if (workflows.length === 0) {
    container.innerHTML =
      '<p style="color:var(--text-muted);font-size:13px">No workflows found on this n8n instance.</p>';
    return;
  }

  container.innerHTML = '';

  const table = document.createElement('div');
  table.style.cssText =
    'display:grid;grid-template-columns:1fr auto auto;gap:4px 12px;font-size:13px;max-width:640px';

  // Header
  table.innerHTML = `
    <span style="font-weight:600;color:var(--text-muted);font-size:11px;text-transform:uppercase">Name</span>
    <span style="font-weight:600;color:var(--text-muted);font-size:11px;text-transform:uppercase">Status</span>
    <span style="font-weight:600;color:var(--text-muted);font-size:11px;text-transform:uppercase">Nodes</span>`;

  for (const wf of workflows) {
    const statusDot = wf.active
      ? '<span class="ms ms-sm" style="color:var(--success);font-size:10px">circle</span> Active'
      : '<span class="ms ms-sm" style="color:var(--text-muted);font-size:10px">circle</span> Inactive';

    const nodeCount = wf.nodes.length;

    const row = document.createElement('span');
    row.textContent = wf.name;
    row.title = `ID: ${wf.id}`;
    table.appendChild(row);

    const statusCell = document.createElement('span');
    statusCell.innerHTML = statusDot;
    table.appendChild(statusCell);

    const nodeCell = document.createElement('span');
    nodeCell.textContent = `${nodeCount} node${nodeCount !== 1 ? 's' : ''}`;
    nodeCell.style.color = 'var(--text-muted)';
    table.appendChild(nodeCell);
  }

  container.appendChild(table);
}
