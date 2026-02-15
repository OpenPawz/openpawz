// Memory Palace View — LanceDB-backed long-term memory
// Extracted from main.ts for maintainability

import { gateway } from '../gateway';

const $ = (id: string) => document.getElementById(id);

// ── Tauri bridge ───────────────────────────────────────────────────────────
interface TauriWindow {
  __TAURI__?: {
    core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
  };
}
const tauriWindow = window as unknown as TauriWindow;
const invoke = tauriWindow.__TAURI__?.core?.invoke;

// ── Module state ───────────────────────────────────────────────────────────
let _palaceInitialized = false;
let _palaceAvailable = false;
let _palaceSkipped = false;
let wsConnected = false;
let currentSessionKey: string | null = null;

export function setWsConnected(connected: boolean) {
  wsConnected = connected;
}

export function setCurrentSessionKey(key: string | null) {
  currentSessionKey = key;
}

export function isPalaceAvailable(): boolean {
  return _palaceAvailable;
}

export function resetPalaceState() {
  _palaceInitialized = false;
  _palaceSkipped = false;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function showToast(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info', durationMs = 3500) {
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, durationMs);
}

// ── Main loader ────────────────────────────────────────────────────────────
export async function loadMemoryPalace() {
  if (!wsConnected) return;

  // Check if memory-lancedb plugin is active in the gateway
  if (!_palaceInitialized) {
    _palaceInitialized = true;

    // memory-lancedb is a plugin, not a skill, so it won't appear in skillsStatus().
    // Instead, check if the config is written AND the gateway is running — if both
    // are true, the plugin is active (it registers on gateway startup).
    let configWritten = false;
    if (invoke) {
      try {
        configWritten = await invoke<boolean>('check_memory_configured');
      } catch { /* ignore */ }
    }

    if (configWritten) {
      // Config is present — check if gateway is actually running
      try {
        const healthy = invoke ? await invoke<boolean>('check_gateway_health', { port: null }) : false;
        if (healthy) {
          _palaceAvailable = true;
          console.log('[memory] Memory plugin configured and gateway is running');
        } else {
          console.log('[memory] Config written but gateway not running');
        }
      } catch {
        // If health check fails, still try — gateway might be starting up
        _palaceAvailable = false;
      }
    }

    initPalaceTabs();
    initPalaceRecall();
    initPalaceRemember();
    initPalaceGraph();
    initPalaceInstall();

    const banner = $('palace-install-banner');
    const filesDivider = $('palace-files-divider');

    if (!_palaceAvailable && !_palaceSkipped) {
      // Show setup banner
      if (banner) banner.style.display = 'flex';
      if (configWritten) {
        // Config is written but gateway hasn't picked it up or plugin failed
        // Show the form so users can update their settings, plus a restart note
        console.log('[memory] Config written but plugin not active — show form + restart option');
        const progressEl = $('palace-progress-text');
        const progressDiv = $('palace-install-progress');
        if (progressEl && progressDiv) {
          progressDiv.style.display = '';
          progressEl.textContent = 'Memory is configured but not active. Update settings or restart the gateway.';
        }
        // Pre-fill from settings if available
        if (invoke) {
          try {
            const existingUrl = await invoke<string | null>('get_embedding_base_url');
            const existingVersion = await invoke<string | null>('get_azure_api_version');
            const existingProvider = await invoke<string | null>('get_embedding_provider');
            const providerSel = $('palace-provider') as HTMLSelectElement | null;
            if (existingProvider && providerSel) providerSel.value = existingProvider;
            updateProviderFields();
            if (existingProvider === 'azure') {
              const baseUrlInput = $('palace-base-url') as HTMLInputElement | null;
              if (existingUrl && baseUrlInput && !baseUrlInput.value) baseUrlInput.value = existingUrl;
            } else {
              const openaiUrlInput = $('palace-base-url-openai') as HTMLInputElement | null;
              if (existingUrl && openaiUrlInput && !openaiUrlInput.value) openaiUrlInput.value = existingUrl;
            }
            const apiVersionInput = $('palace-api-version') as HTMLInputElement | null;
            if (existingVersion && apiVersionInput && !apiVersionInput.value) {
              apiVersionInput.value = existingVersion;
            }
          } catch { /* ignore */ }
        }
      }
    } else if (!_palaceAvailable && _palaceSkipped) {
      // Skipped — show files mode
      if (banner) banner.style.display = 'none';
      document.querySelectorAll('.palace-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.palace-panel').forEach(p => (p as HTMLElement).style.display = 'none');
      document.querySelector('.palace-tab[data-palace-tab="files"]')?.classList.add('active');
      const fp = $('palace-files-panel');
      if (fp) fp.style.display = 'flex';
      if (filesDivider) filesDivider.style.display = 'none';
      const memoryListBelow = $('memory-list');
      if (memoryListBelow) memoryListBelow.style.display = 'none';
    } else {
      // Memory is available — full mode
      if (banner) banner.style.display = 'none';
      if (filesDivider) filesDivider.style.display = '';
      // Show settings gear so user can reconfigure endpoint/API key
      const settingsBtn = $('palace-settings');
      if (settingsBtn) settingsBtn.style.display = '';
    }
  }

  // Only load stats + sidebar when memory is actually available
  // (don't call CLI commands when plugin is misconfigured — they can hang)
  if (_palaceAvailable) {
    await loadPalaceStats();
    await loadPalaceSidebar();
  }
}

// ── Provider fields toggle ─────────────────────────────────────────────────
function updateProviderFields() {
  const sel = $('palace-provider') as HTMLSelectElement | null;
  const isAzure = sel?.value === 'azure';
  const azureFields = $('palace-azure-fields');
  const openaiEndpoint = $('palace-openai-endpoint-field');
  const apiVersionField = $('palace-api-version-field');
  const apiKeyInput = $('palace-api-key') as HTMLInputElement | null;
  const modelLabelEl = $('palace-model-label');
  const modelInput = $('palace-model-name') as HTMLInputElement | null;

  if (azureFields) azureFields.style.display = isAzure ? '' : 'none';
  if (openaiEndpoint) openaiEndpoint.style.display = isAzure ? 'none' : '';
  if (apiVersionField) apiVersionField.style.display = isAzure ? '' : 'none';
  if (apiKeyInput) apiKeyInput.placeholder = isAzure ? 'Azure API key' : 'sk-...';
  if (modelLabelEl) modelLabelEl.innerHTML = isAzure
    ? 'Deployment Name <span class="palace-api-hint">(defaults to text-embedding-3-small)</span>'
    : 'Model <span class="palace-api-hint">(defaults to text-embedding-3-small)</span>';
  if (modelInput) modelInput.placeholder = isAzure
    ? 'text-embedding-3-small' : 'text-embedding-3-small';
}

function getSelectedProvider(): string {
  return (($('palace-provider') as HTMLSelectElement)?.value) || 'openai';
}

function getBaseUrlForProvider(): string {
  const provider = getSelectedProvider();
  if (provider === 'azure') {
    return ($('palace-base-url') as HTMLInputElement)?.value?.trim() ?? '';
  }
  return ($('palace-base-url-openai') as HTMLInputElement)?.value?.trim() ?? '';
}

// ── Install / Setup form ───────────────────────────────────────────────────
function initPalaceInstall() {
  // Provider dropdown — toggle fields on change
  $('palace-provider')?.addEventListener('change', updateProviderFields);
  // Set initial state
  updateProviderFields();

  // Settings gear — show the setup banner for reconfiguration
  $('palace-settings')?.addEventListener('click', async () => {
    const banner = $('palace-install-banner');
    if (!banner) return;
    banner.style.display = 'flex';
    // Pre-fill with existing settings
    if (invoke) {
      try {
        const existingUrl = await invoke<string | null>('get_embedding_base_url');
        const existingVersion = await invoke<string | null>('get_azure_api_version');
        const existingProvider = await invoke<string | null>('get_embedding_provider');
        const providerSel = $('palace-provider') as HTMLSelectElement | null;
        if (existingProvider && providerSel) providerSel.value = existingProvider;
        updateProviderFields();
        if (existingProvider === 'azure') {
          const baseUrlInput = $('palace-base-url') as HTMLInputElement | null;
          if (existingUrl && baseUrlInput) baseUrlInput.value = existingUrl;
        } else {
          const openaiUrlInput = $('palace-base-url-openai') as HTMLInputElement | null;
          if (existingUrl && openaiUrlInput) openaiUrlInput.value = existingUrl;
        }
        const apiVersionInput = $('palace-api-version') as HTMLInputElement | null;
        if (existingVersion && apiVersionInput) apiVersionInput.value = existingVersion;
      } catch { /* ignore */ }
    }
    // Update button text to indicate reconfiguration
    const btn = $('palace-install-btn') as HTMLButtonElement | null;
    if (btn) { btn.textContent = 'Save & Restart'; btn.disabled = false; }
    const progressDiv = $('palace-install-progress');
    if (progressDiv) progressDiv.style.display = 'none';
  });

  // ── Shared form reader & validator ──
  function readMemoryForm(): { apiKey: string; baseUrl: string; modelName: string; apiVersion: string; provider: string } | null {
    const apiKeyInput = $('palace-api-key') as HTMLInputElement | null;
    const provider = getSelectedProvider();
    let apiKey = apiKeyInput?.value?.trim() ?? '';
    let baseUrl = getBaseUrlForProvider();
    const modelName = ($('palace-model-name') as HTMLInputElement | null)?.value?.trim() ?? '';
    const apiVersion = ($('palace-api-version') as HTMLInputElement | null)?.value?.trim() ?? '';

    // Detect URL pasted into API key field
    if (apiKey.startsWith('http://') || apiKey.startsWith('https://')) {
      if (!baseUrl) {
        baseUrl = apiKey;
        apiKey = '';
        const targetId = provider === 'azure' ? 'palace-base-url' : 'palace-base-url-openai';
        const bi = $(targetId) as HTMLInputElement | null;
        if (bi) bi.value = baseUrl;
        if (apiKeyInput) { apiKeyInput.value = ''; apiKeyInput.style.borderColor = '#e44'; apiKeyInput.focus(); apiKeyInput.placeholder = 'Enter your API key here (not a URL)'; }
        return null;
      } else {
        if (apiKeyInput) { apiKeyInput.value = ''; apiKeyInput.style.borderColor = '#e44'; apiKeyInput.focus(); apiKeyInput.placeholder = 'This looks like a URL — enter your API key instead'; }
        return null;
      }
    }

    if (provider === 'azure' && !baseUrl) {
      const bi = $('palace-base-url') as HTMLInputElement | null;
      if (bi) { bi.style.borderColor = '#e44'; bi.focus(); bi.placeholder = 'Azure endpoint is required'; }
      return null;
    }

    if (!apiKey) {
      if (apiKeyInput) { apiKeyInput.style.borderColor = '#e44'; apiKeyInput.focus(); apiKeyInput.placeholder = 'API key is required'; }
      return null;
    }
    if (apiKeyInput) apiKeyInput.style.borderColor = '';
    return { apiKey, baseUrl, modelName, apiVersion, provider };
  }

  // ── Test Connection button ──
  $('palace-test-btn')?.addEventListener('click', async () => {
    const testBtn = $('palace-test-btn') as HTMLButtonElement | null;
    const progressDiv = $('palace-install-progress');
    const progressText = $('palace-progress-text') as HTMLElement | null;
    if (!testBtn || !invoke) return;

    const form = readMemoryForm();
    if (!form) return;

    testBtn.disabled = true;
    testBtn.textContent = 'Testing…';
    if (progressDiv) progressDiv.style.display = '';
    if (progressText) progressText.textContent = 'Testing embedding endpoint…';

    try {
      await invoke('test_embedding_connection', {
        apiKey: form.apiKey,
        baseUrl: form.baseUrl || null,
        model: form.modelName || null,
        apiVersion: form.apiVersion || null,
        provider: form.provider,
      });
      if (progressText) progressText.textContent = 'Connection test passed ✓';
    } catch (testErr: unknown) {
      const errMsg = typeof testErr === 'string' ? testErr : (testErr as Error)?.message || String(testErr);
      if (progressText) progressText.textContent = `Connection test failed: ${errMsg}`;
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Connection';
    }
  });

  // ── Enable / Save button ──
  $('palace-install-btn')?.addEventListener('click', async () => {
    const btn = $('palace-install-btn') as HTMLButtonElement | null;
    const progressDiv = $('palace-install-progress');
    const progressText = $('palace-progress-text') as HTMLElement | null;
    if (!btn || !invoke) return;

    const form = readMemoryForm();
    if (!form) return;
    const { apiKey, baseUrl, modelName, apiVersion, provider } = form;

    btn.disabled = true;
    btn.textContent = 'Testing connection…';
    if (progressDiv) progressDiv.style.display = '';
    if (progressText) progressText.textContent = 'Testing embedding endpoint…';

    try {
      // Step 1: Test the embedding connection before saving
      try {
        await invoke('test_embedding_connection', {
          apiKey,
          baseUrl: baseUrl || null,
          model: modelName || null,
          apiVersion: apiVersion || null,
          provider,
        });
        if (progressText) progressText.textContent = 'Connection test passed ✓ Saving configuration…';
      } catch (testErr: unknown) {
        // Connection test failed — show the error and let user fix
        const errMsg = typeof testErr === 'string' ? testErr : (testErr as Error)?.message || String(testErr);
        if (progressText) progressText.textContent = `Connection test failed: ${errMsg}`;
        btn.textContent = 'Retry';
        btn.disabled = false;
        return;
      }

      btn.textContent = 'Saving…';

      // Step 2: Write config to openclaw.json
      await invoke('enable_memory_plugin', {
        apiKey,
        baseUrl: baseUrl || null,
        model: modelName || null,
        apiVersion: apiVersion || null,
        provider,
      });

      if (progressText) progressText.textContent = 'Configuration saved! Restarting gateway…';

      // Restart gateway to pick up the new plugin config
      try {
        await invoke('stop_gateway');
        await new Promise(r => setTimeout(r, 4000));
        await invoke('start_gateway', { port: null });
        await new Promise(r => setTimeout(r, 5000));
      } catch (e) {
        console.warn('[memory] Gateway restart failed:', e);
      }

      // Re-check if memory plugin is now active
      // Config was just written and gateway restarted — check if it's healthy
      _palaceInitialized = false;
      _palaceAvailable = false;

      try {
        const healthy = await invoke<boolean>('check_gateway_health', { port: null });
        const configured = await invoke<boolean>('check_memory_configured');
        _palaceAvailable = healthy && configured;
      } catch { /* ignore */ }

      if (_palaceAvailable) {
        const banner = $('palace-install-banner');
        if (banner) banner.style.display = 'none';
        _palaceInitialized = false;
        await loadMemoryPalace();
      } else {
        if (progressText) {
          progressText.textContent = 'Configuration saved. The gateway may need a manual restart to activate the memory plugin.';
        }
        btn.textContent = 'Restart Gateway';
        btn.disabled = false;
        btn.onclick = async () => {
          btn.disabled = true;
          btn.textContent = 'Restarting…';
          try {
            await invoke('stop_gateway');
            await new Promise(r => setTimeout(r, 4000));
            await invoke('start_gateway', { port: null });
            await new Promise(r => setTimeout(r, 5000));
            _palaceInitialized = false;
            await loadMemoryPalace();
          } catch (e) {
            if (progressText) progressText.textContent = `Restart failed: ${e}`;
            btn.disabled = false;
            btn.textContent = 'Retry';
          }
        };
      }
    } catch (e) {
      if (progressText) progressText.textContent = `Error: ${e}`;
      btn.textContent = 'Retry';
      btn.disabled = false;
    }
  });

  // Skip button
  $('palace-skip-btn')?.addEventListener('click', () => {
    _palaceSkipped = true;
    const banner = $('palace-install-banner');
    if (banner) banner.style.display = 'none';

    document.querySelectorAll('.palace-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.palace-panel').forEach(p => (p as HTMLElement).style.display = 'none');
    document.querySelector('.palace-tab[data-palace-tab="files"]')?.classList.add('active');
    const fp = $('palace-files-panel');
    if (fp) fp.style.display = 'flex';

    const filesDivider = $('palace-files-divider');
    if (filesDivider) filesDivider.style.display = 'none';
    const memoryListBelow = $('memory-list');
    if (memoryListBelow) memoryListBelow.style.display = 'none';
  });
}

// ── Stats loader ───────────────────────────────────────────────────────────
async function loadPalaceStats() {
  const totalEl = $('palace-total');
  const typesEl = $('palace-types');
  const edgesEl = $('palace-graph-edges');
  if (!totalEl) return;

  if (!_palaceAvailable || !invoke) {
    // Show agent file count as fallback stats
    try {
      const result = await gateway.agentFilesList();
      const files = result.files ?? [];
      totalEl.textContent = String(files.length);
      if (typesEl) typesEl.textContent = 'files';
      if (edgesEl) edgesEl.textContent = '—';
    } catch {
      totalEl.textContent = '—';
      if (typesEl) typesEl.textContent = '—';
      if (edgesEl) edgesEl.textContent = '—';
    }
    return;
  }

  try {
    // Use openclaw ltm stats via Rust command
    const statsText = await invoke<string>('memory_stats');
    // Format: "Total memories: N"
    const countMatch = statsText.match(/(\d+)/);
    if (countMatch) {
      totalEl.textContent = countMatch[1];
    } else {
      totalEl.textContent = '0';
    }
    if (typesEl) typesEl.textContent = 'memories';
    if (edgesEl) edgesEl.textContent = '—'; // LanceDB doesn't have edges
  } catch (e) {
    console.warn('[memory] Stats load failed:', e);
    totalEl.textContent = '—';
    if (typesEl) typesEl.textContent = '—';
    if (edgesEl) edgesEl.textContent = '—';
  }
}

// ── Sidebar loader ─────────────────────────────────────────────────────────
async function loadPalaceSidebar() {
  const list = $('palace-memory-list');
  if (!list) return;

  list.innerHTML = '';

  if (!_palaceAvailable || !invoke) {
    // Fall back to showing agent files
    try {
      const result = await gateway.agentFilesList();
      const files = result.files ?? [];
      if (!files.length) {
        list.innerHTML = `<div class="palace-list-empty">No agent files yet</div>`;
        return;
      }
      for (const file of files) {
        const displayName = file.path ?? file.name ?? 'unknown';
        const displaySize = file.sizeBytes ?? file.size;
        const card = document.createElement('div');
        card.className = 'palace-memory-card';
        card.innerHTML = `
          <span class="palace-memory-type">file</span>
          <div class="palace-memory-subject">${escHtml(displayName)}</div>
          <div class="palace-memory-preview">${displaySize ? formatBytes(displaySize) : 'Agent file'}</div>
        `;
        card.addEventListener('click', () => {
          document.querySelectorAll('.palace-tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.palace-panel').forEach(p => (p as HTMLElement).style.display = 'none');
          document.querySelector('.palace-tab[data-palace-tab="files"]')?.classList.add('active');
          const fp = $('palace-files-panel');
          if (fp) fp.style.display = 'flex';
          // Emit custom event for main.ts to handle file opening
          window.dispatchEvent(new CustomEvent('palace-open-file', { detail: displayName }));
        });
        list.appendChild(card);
      }
    } catch (e) {
      console.warn('Agent files load failed:', e);
      list.innerHTML = '<div class="palace-list-empty">Could not load files</div>';
    }
    return;
  }

  try {
    // Use openclaw ltm search via Rust command
    const jsonText = await invoke<string>('memory_search', { query: 'recent important information', limit: 20 });
    const memories: { id?: string; text?: string; category?: string; importance?: number; score?: number }[] = JSON.parse(jsonText);
    if (!memories.length) {
      list.innerHTML = '<div class="palace-list-empty">No memories yet</div>';
      return;
    }
    for (const mem of memories) {
      const card = document.createElement('div');
      card.className = 'palace-memory-card';
      card.innerHTML = `
        <span class="palace-memory-type">${escHtml(mem.category ?? 'other')}</span>
        <div class="palace-memory-subject">${escHtml((mem.text ?? '').slice(0, 60))}${(mem.text?.length ?? 0) > 60 ? '…' : ''}</div>
        <div class="palace-memory-preview">${mem.score != null ? `${(mem.score * 100).toFixed(0)}% match` : ''}</div>
      `;
      card.addEventListener('click', () => {
        if (mem.id) palaceRecallById(mem.id);
      });
      list.appendChild(card);
    }
  } catch (e) {
    console.warn('Memory sidebar load failed:', e);
    list.innerHTML = '<div class="palace-list-empty">Could not load memories</div>';
  }
}

// ── Recall by ID ───────────────────────────────────────────────────────────
async function palaceRecallById(memoryId: string) {
  const resultsEl = $('palace-recall-results');
  const emptyEl = $('palace-recall-empty');
  if (!resultsEl) return;

  // Switch to recall tab
  document.querySelectorAll('.palace-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.palace-panel').forEach(p => (p as HTMLElement).style.display = 'none');
  document.querySelector('.palace-tab[data-palace-tab="recall"]')?.classList.add('active');
  const recallPanel = $('palace-recall-panel');
  if (recallPanel) recallPanel.style.display = 'flex';

  resultsEl.innerHTML = '<div style="padding:1rem;color:var(--text-secondary)">Loading…</div>';
  if (emptyEl) emptyEl.style.display = 'none';

  if (!invoke) {
    resultsEl.innerHTML = '<div style="padding:1rem;color:var(--danger)">Memory not available</div>';
    return;
  }

  try {
    // Use openclaw ltm search via Rust command
    const jsonText = await invoke<string>('memory_search', { query: memoryId, limit: 1 });
    const memories = JSON.parse(jsonText);
    resultsEl.innerHTML = '';
    if (Array.isArray(memories) && memories.length) {
      resultsEl.appendChild(renderRecallCard(memories[0]));
    } else {
      resultsEl.innerHTML = '<div style="padding:1rem;color:var(--text-secondary)">Memory not found</div>';
    }
  } catch (e) {
    resultsEl.innerHTML = `<div style="padding:1rem;color:var(--danger)">Error: ${escHtml(String(e))}</div>`;
  }
}

// ── Recall card renderer ───────────────────────────────────────────────────
function renderRecallCard(mem: { id?: string; text?: string; category?: string; importance?: number; score?: number }): HTMLElement {
  const card = document.createElement('div');
  card.className = 'palace-result-card';

  const score = mem.score != null ? `<span class="palace-result-score">${(mem.score * 100).toFixed(0)}%</span>` : '';
  const importance = mem.importance != null ? `<span class="palace-result-tag">importance: ${mem.importance}</span>` : '';

  card.innerHTML = `
    <div class="palace-result-header">
      <span class="palace-result-type">${escHtml(mem.category ?? 'other')}</span>
      ${score}
    </div>
    <div class="palace-result-content">${escHtml(mem.text ?? '')}</div>
    <div class="palace-result-meta">
      ${importance}
    </div>
  `;
  return card;
}

// ── Tab switching ──────────────────────────────────────────────────────────
function initPalaceTabs() {
  document.querySelectorAll('.palace-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = (tab as HTMLElement).dataset.palaceTab;
      if (!target) return;

      document.querySelectorAll('.palace-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.palace-panel').forEach(p => (p as HTMLElement).style.display = 'none');
      const panel = $(`palace-${target}-panel`);
      if (panel) panel.style.display = 'flex';
    });
  });
}

// ── Recall search ──────────────────────────────────────────────────────────
function initPalaceRecall() {
  const btn = $('palace-recall-btn');
  const input = $('palace-recall-input') as HTMLTextAreaElement | null;
  if (!btn || !input) return;

  btn.addEventListener('click', () => palaceRecallSearch());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      palaceRecallSearch();
    }
  });
}

async function palaceRecallSearch() {
  const input = $('palace-recall-input') as HTMLTextAreaElement | null;
  const resultsEl = $('palace-recall-results');
  const emptyEl = $('palace-recall-empty');
  if (!input || !resultsEl) return;

  const query = input.value.trim();
  if (!query) return;

  resultsEl.innerHTML = '<div style="padding:1rem;color:var(--text-secondary)">Searching…</div>';
  if (emptyEl) emptyEl.style.display = 'none';

  if (!_palaceAvailable || !invoke) {
    resultsEl.innerHTML = `<div class="empty-state" style="padding:1rem;">
      <div class="empty-title">Memory not enabled</div>
      <div class="empty-subtitle" style="max-width:380px;line-height:1.6">
        Enable long-term memory in the Memory tab to use semantic recall.
      </div>
    </div>`;
    return;
  }

  try {
    // Use openclaw ltm search via Rust command
    const jsonText = await invoke<string>('memory_search', { query, limit: 10 });
    const memories: { id?: string; text?: string; category?: string; importance?: number; score?: number }[] = JSON.parse(jsonText);
    resultsEl.innerHTML = '';
    if (!memories.length) {
      if (emptyEl) emptyEl.style.display = 'flex';
      return;
    }
    for (const mem of memories) {
      resultsEl.appendChild(renderRecallCard(mem));
    }
  } catch (e) {
    resultsEl.innerHTML = `<div style="padding:1rem;color:var(--danger)">Recall failed: ${escHtml(String(e))}</div>`;
  }
}

// ── Remember form ──────────────────────────────────────────────────────────
function initPalaceRemember() {
  const btn = $('palace-remember-save');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const category = ($('palace-remember-type') as HTMLSelectElement | null)?.value ?? 'other';
    const content = ($('palace-remember-content') as HTMLTextAreaElement | null)?.value.trim() ?? '';
    const importanceStr = ($('palace-remember-importance') as HTMLSelectElement | null)?.value ?? '5';
    const importance = parseInt(importanceStr, 10) || 5;

    if (!content) {
      alert('Content is required.');
      return;
    }

    if (!_palaceAvailable) {
      alert('Memory not enabled. Enable long-term memory in the Memory tab first.');
      return;
    }

    btn.textContent = 'Saving…';
    (btn as HTMLButtonElement).disabled = true;

    try {
      // Call the Tauri command directly for reliable storage
      if (invoke) {
        await invoke('memory_store', {
          content,
          category,
          importance,
        });
      } else {
        // Fallback: ask agent to store (less reliable, for browser-only dev)
        const storeSessionKey = currentSessionKey ?? 'default';
        const storePrompt = `Please store this in long-term memory using memory_store: "${content.replace(/"/g, '\\"')}" with category "${category}" and importance ${importance}. Just confirm when done.`;
        await Promise.race([
          gateway.chatSend(storeSessionKey, storePrompt),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000)),
        ]);
      }

      // Clear form
      if ($('palace-remember-content') as HTMLTextAreaElement) ($('palace-remember-content') as HTMLTextAreaElement).value = '';

      showToast('Memory saved!', 'success');
      await loadPalaceSidebar();
      await loadPalaceStats();
    } catch (e) {
      showToast(`Save failed: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      btn.textContent = 'Save Memory';
      (btn as HTMLButtonElement).disabled = false;
    }
  });
}

// ── Knowledge graph visualization ──────────────────────────────────────────
function initPalaceGraph() {
  const renderBtn = $('palace-graph-render');
  if (!renderBtn) return;

  renderBtn.addEventListener('click', () => renderPalaceGraph());
}

async function renderPalaceGraph() {
  const canvas = $('palace-graph-canvas') as HTMLCanvasElement | null;
  const emptyEl = $('palace-graph-empty');
  if (!canvas) return;

  if (!_palaceAvailable) {
    if (emptyEl) {
      emptyEl.style.display = 'flex';
      emptyEl.innerHTML = `
        <div class="empty-title">Memory Map</div>
        <div class="empty-subtitle">Enable long-term memory to visualize stored knowledge</div>
      `;
    }
    return;
  }

  if (emptyEl) { emptyEl.style.display = 'flex'; emptyEl.textContent = 'Loading memory map…'; }

  if (!invoke) {
    if (emptyEl) { emptyEl.style.display = 'flex'; emptyEl.textContent = 'Memory not available.'; }
    return;
  }

  try {
    // Use openclaw ltm search via Rust command
    const jsonText = await invoke<string>('memory_search', { query: '*', limit: 50 });
    let memories: { id?: string; text?: string; category?: string; importance?: number; score?: number }[] = [];
    try { memories = JSON.parse(jsonText); } catch { /* empty */ }

    if (!memories.length) {
      if (emptyEl) { emptyEl.style.display = 'flex'; emptyEl.textContent = 'No memories to visualize.'; }
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    // Render bubble chart grouped by category
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.parentElement?.getBoundingClientRect();
    canvas.width = rect?.width ?? 600;
    canvas.height = rect?.height ?? 400;

    const categoryColors: Record<string, string> = {
      other: '#676879', preference: '#0073EA', fact: '#00CA72',
      decision: '#FDAB3D', procedure: '#E44258', concept: '#A25DDC',
      code: '#579BFC', person: '#FF642E', project: '#CAB641',
    };

    // Group by category, place category clusters
    const groups = new Map<string, typeof memories>();
    for (const mem of memories) {
      const cat = mem.category ?? 'other';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(mem);
    }

    // Layout: distribute category centers in a circle
    const categories = Array.from(groups.entries());
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const radius = Math.min(cx, cy) * 0.55;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    categories.forEach(([cat, mems], i) => {
      const angle = (i / categories.length) * Math.PI * 2 - Math.PI / 2;
      const groupX = cx + Math.cos(angle) * radius;
      const groupY = cy + Math.sin(angle) * radius;

      // Draw category label
      ctx.fillStyle = '#676879';
      ctx.font = 'bold 12px Figtree, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(cat.toUpperCase(), groupX, groupY - 30 - mems.length * 2);

      // Draw bubbles for each memory
      mems.forEach((mem, j) => {
        const innerAngle = (j / mems.length) * Math.PI * 2;
        const spread = Math.min(25 + mems.length * 4, 60);
        const mx = groupX + Math.cos(innerAngle) * spread * (0.3 + Math.random() * 0.7);
        const my = groupY + Math.sin(innerAngle) * spread * (0.3 + Math.random() * 0.7);
        const size = 4 + (mem.importance ?? 5) * 0.8;
        const color = categoryColors[cat] ?? '#676879';

        ctx.beginPath();
        ctx.arc(mx, my, size, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.7;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // Count label
      ctx.fillStyle = categoryColors[cat] ?? '#676879';
      ctx.font = '11px Figtree, sans-serif';
      ctx.fillText(`${mems.length}`, groupX, groupY + 35 + mems.length * 2);
    });
  } catch (e) {
    console.warn('Graph render failed:', e);
    if (emptyEl) { emptyEl.style.display = 'flex'; emptyEl.textContent = 'Failed to load memory map.'; }
  }
}

// ── UI event wiring ────────────────────────────────────────────────────────
export function initPalaceEvents() {
  // Refresh button
  $('palace-refresh')?.addEventListener('click', async () => {
    _palaceInitialized = false;
    _palaceSkipped = false;
    await loadMemoryPalace();
  });

  // Sidebar search filter (local filter of visible cards)
  $('palace-search')?.addEventListener('input', () => {
    const query = (($('palace-search') as HTMLInputElement)?.value ?? '').toLowerCase();
    document.querySelectorAll('.palace-memory-card').forEach(card => {
      const text = card.textContent?.toLowerCase() ?? '';
      (card as HTMLElement).style.display = text.includes(query) ? '' : 'none';
    });
  });
}
