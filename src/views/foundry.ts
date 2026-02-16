// Foundry View — Models, Agent Modes, Multi-Agent Management
// Extracted from main.ts for maintainability

import { gateway } from '../gateway';
import { listModes, saveMode, deleteMode } from '../db';
import type { AgentMode } from '../db';
import type { AgentSummary } from '../types';
import { isEngineMode } from '../engine-bridge';
import { pawEngine } from '../engine';

const $ = (id: string) => document.getElementById(id);

// ── Module state ───────────────────────────────────────────────────────────
let wsConnected = false;
let _cachedModels: { id: string; name?: string; provider?: string; contextWindow?: number; reasoning?: boolean }[] = [];
let _editingModeId: string | null = null;
let _agentsList: AgentSummary[] = [];
let _currentAgentId: string | null = null;
let _editingAgentId: string | null = null;

export function setWsConnected(connected: boolean) {
  wsConnected = connected;
}

export function getCachedModels() {
  return _cachedModels;
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

// Callbacks for main.ts integration
let promptModalFn: ((title: string, placeholder?: string) => Promise<string | null>) | null = null;

export function configure(opts: {
  promptModal: (title: string, placeholder?: string) => Promise<string | null>;
}) {
  promptModalFn = opts.promptModal;
}

// ── Models ─────────────────────────────────────────────────────────────────
export async function loadModels() {
  const list = $('models-list');
  const empty = $('models-empty');
  const loading = $('models-loading');
  if (!wsConnected || !list) return;

  if (loading) loading.style.display = '';
  if (empty) empty.style.display = 'none';
  list.innerHTML = '';

  try {
    const result = await gateway.modelsList();
    if (loading) loading.style.display = 'none';

    const models = result.models ?? [];
    _cachedModels = models;
    if (!models.length) {
      if (empty) empty.style.display = 'flex';
      return;
    }

    for (const model of models) {
      const card = document.createElement('div');
      card.className = 'model-card';
      card.innerHTML = `
        <div class="model-card-header">
          <span class="model-card-name">${escHtml(model.name ?? model.id)}</span>
          ${model.provider ? `<span class="model-card-provider">${escHtml(model.provider)}</span>` : ''}
        </div>
        <div class="model-card-meta">
          ${model.contextWindow ? `<span>${model.contextWindow.toLocaleString()} tokens</span>` : ''}
          ${model.reasoning ? `<span class="model-card-badge">Reasoning</span>` : ''}
        </div>
      `;
      list.appendChild(card);
    }
  } catch (e) {
    console.warn('Models load failed:', e);
    if (loading) loading.style.display = 'none';
    if (empty) empty.style.display = 'flex';
  }
}

// ── Agent Modes ────────────────────────────────────────────────────────────
export async function loadModes() {
  const list = $('modes-list');
  const empty = $('modes-empty');
  if (!list) return;
  list.innerHTML = '';

  try {
    const modes = await listModes();
    if (!modes.length) {
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    for (const mode of modes) {
      const card = document.createElement('div');
      card.className = 'mode-card';
      card.style.borderLeftColor = mode.color || 'var(--accent)';
      card.innerHTML = `
        <div class="mode-card-icon" style="background:${mode.color}22">${mode.icon || mode.name?.charAt(0) || 'M'}</div>
        <div class="mode-card-info">
          <div class="mode-card-name">${escHtml(mode.name)}</div>
          <div class="mode-card-detail">${mode.model ? escHtml(mode.model) : 'Default model'} · ${mode.thinking_level || 'normal'} thinking</div>
        </div>
        ${mode.is_default ? '<span class="mode-card-default">Default</span>' : ''}
      `;
      card.addEventListener('click', () => editMode(mode));
      list.appendChild(card);
    }
  } catch (e) {
    console.warn('Modes load failed:', e);
  }
}

function editMode(mode?: AgentMode) {
  _editingModeId = mode?.id ?? null;
  const modal = $('mode-modal');
  const title = $('mode-modal-title');
  const deleteBtn = $('mode-modal-delete');
  if (!modal) return;
  modal.style.display = 'flex';
  if (title) title.textContent = mode ? 'Edit Agent Mode' : 'New Agent Mode';
  if (deleteBtn) deleteBtn.style.display = mode && !mode.is_default ? '' : 'none';

  const modelSelect = $('mode-form-model') as HTMLSelectElement;
  if (modelSelect) {
    modelSelect.innerHTML = '<option value="">Default model</option>';
    for (const m of _cachedModels) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name ?? m.id;
      if (mode?.model === m.id) opt.selected = true;
      modelSelect.appendChild(opt);
    }
  }

  ($('mode-form-icon') as HTMLInputElement).value = mode?.icon ?? '';
  ($('mode-form-name') as HTMLInputElement).value = mode?.name ?? '';
  ($('mode-form-color') as HTMLInputElement).value = mode?.color ?? '#0073EA';
  ($('mode-form-prompt') as HTMLTextAreaElement).value = mode?.system_prompt ?? '';
  ($('mode-form-thinking') as HTMLSelectElement).value = mode?.thinking_level ?? 'normal';
  ($('mode-form-temp') as HTMLInputElement).value = String(mode?.temperature ?? 1);
  const tempVal = $('mode-form-temp-value');
  if (tempVal) tempVal.textContent = String(mode?.temperature ?? 1.0);
}

function hideModeModal() {
  const modal = $('mode-modal');
  if (modal) modal.style.display = 'none';
  _editingModeId = null;
}

// ── Agents ─────────────────────────────────────────────────────────────────
const AGENT_STANDARD_FILES: { name: string; label: string; description: string }[] = [
  { name: 'AGENTS.md',    label: 'Instructions',   description: 'Operating rules, priorities, memory usage guide' },
  { name: 'SOUL.md',      label: 'Persona',         description: 'Personality, tone, communication style, boundaries' },
  { name: 'USER.md',      label: 'About User',      description: 'Who the user is, how to address them, preferences' },
  { name: 'IDENTITY.md',  label: 'Identity',         description: 'Agent name, emoji, vibe/creature, avatar' },
  { name: 'TOOLS.md',     label: 'Tool Notes',       description: 'Notes about local tools and conventions' },
  { name: 'HEARTBEAT.md', label: 'Heartbeat',        description: 'Optional cron checklist (keep short to save tokens)' },
];

export async function loadAgents() {
  const list = $('agents-list');
  const empty = $('agents-empty');
  const loading = $('agents-loading');
  if (!wsConnected || !list) return;

  if (loading) loading.style.display = '';
  if (empty) empty.style.display = 'none';
  list.innerHTML = '';

  try {
    if (isEngineMode()) {
      // Engine mode: show default agent with its files
      if (loading) loading.style.display = 'none';
      _agentsList = [{
        id: 'default',
        name: 'Default Agent',
        identity: { name: 'Default Agent', emoji: '🧠' },
      }] as AgentSummary[];

      const card = document.createElement('div');
      card.className = 'agent-card';
      card.innerHTML = `
        <div class="agent-card-avatar">🧠</div>
        <div class="agent-card-body">
          <div class="agent-card-name">Default Agent <span class="agent-card-badge">Default</span></div>
          <div class="agent-card-id">default</div>
          <div class="agent-card-theme">Soul files define this agent's personality</div>
        </div>
        <svg class="agent-card-chevron" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
      `;
      card.addEventListener('click', () => openAgentDetail('default'));
      list.appendChild(card);
      return;
    }

    const result = await gateway.listAgents();
    if (loading) loading.style.display = 'none';

    _agentsList = result.agents ?? [];
    if (!_agentsList.length) {
      if (empty) empty.style.display = 'flex';
      return;
    }

    const defaultId = result.defaultId;

    for (const agent of _agentsList) {
      const card = document.createElement('div');
      card.className = 'agent-card';
      const isDefault = agent.id === defaultId;
      const emoji = agent.identity?.emoji ?? agent.name?.charAt(0)?.toUpperCase() ?? 'A';
      const name = agent.identity?.name ?? agent.name ?? agent.id;
      const theme = agent.identity?.theme ?? '';
      card.innerHTML = `
        <div class="agent-card-avatar">${escHtml(emoji)}</div>
        <div class="agent-card-body">
          <div class="agent-card-name">${escHtml(name)}${isDefault ? ' <span class="agent-card-badge">Default</span>' : ''}</div>
          <div class="agent-card-id">${escHtml(agent.id)}</div>
          ${theme ? `<div class="agent-card-theme">${escHtml(theme)}</div>` : ''}
        </div>
        <svg class="agent-card-chevron" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
      `;
      card.addEventListener('click', () => openAgentDetail(agent.id));
      list.appendChild(card);
    }
  } catch (e) {
    console.warn('Agents load failed:', e);
    if (loading) loading.style.display = 'none';
    if (empty) empty.style.display = 'flex';
  }
}

async function openAgentDetail(agentId: string) {
  _currentAgentId = agentId;
  const listView = $('agents-list-view');
  const detailView = $('agent-detail-view');
  if (listView) listView.style.display = 'none';
  if (detailView) detailView.style.display = '';

  const agent = _agentsList.find(a => a.id === agentId);
  const emojiEl = $('agent-detail-emoji');
  const nameEl = $('agent-detail-name');
  const idEl = $('agent-detail-id');
  const deleteBtn = $('agent-detail-delete');
  if (emojiEl) emojiEl.textContent = agent?.identity?.emoji ?? agent?.name?.charAt(0)?.toUpperCase() ?? 'A';
  if (nameEl) nameEl.textContent = agent?.identity?.name ?? agent?.name ?? agentId;
  if (idEl) idEl.textContent = agentId;
  if (deleteBtn) deleteBtn.style.display = agentId === 'main' ? 'none' : '';

  await loadAgentFiles(agentId);
}

function closeAgentDetail() {
  _currentAgentId = null;
  const listView = $('agents-list-view');
  const detailView = $('agent-detail-view');
  const editor = $('agent-file-editor');
  if (listView) listView.style.display = '';
  if (detailView) detailView.style.display = 'none';
  if (editor) editor.style.display = 'none';
}

async function loadAgentFiles(agentId: string) {
  const grid = $('agent-files-list');
  const workspaceEl = $('agent-detail-workspace');
  if (!grid) return;
  grid.innerHTML = '<div class="view-loading">Loading files…</div>';

  try {
    let files: { path?: string; name?: string; sizeBytes?: number }[] = [];
    let workspace = '—';

    if (isEngineMode()) {
      // Engine mode: agent files stored in SQLite
      const engineFiles = await pawEngine.agentFileList(agentId);
      files = engineFiles.map(f => ({
        path: f.file_name,
        name: f.file_name,
        sizeBytes: new Blob([f.content]).size,
      }));
      workspace = '~/.paw/engine.db (agent files)';
    } else {
      const result = await gateway.agentFilesList(agentId);
      workspace = result.workspace || '—';
      files = result.files ?? [];
    }

    if (workspaceEl) workspaceEl.textContent = workspace;
    grid.innerHTML = '';

    const existingPaths = new Set(files.map(f => f.path ?? f.name ?? ''));
    for (const sf of AGENT_STANDARD_FILES) {
      const exists = existingPaths.has(sf.name);
      const file = files.find(f => (f.path ?? f.name) === sf.name);
      const card = document.createElement('div');
      card.className = `agent-file-card ${exists ? '' : 'agent-file-card-new'}`;
      card.innerHTML = `
        <div class="agent-file-card-icon">${exists ? 'F' : '+'}</div>
        <div class="agent-file-card-body">
          <div class="agent-file-card-name">${escHtml(sf.name)}</div>
          <div class="agent-file-card-desc">${escHtml(sf.label)} — ${escHtml(sf.description)}</div>
          ${exists && file?.sizeBytes ? `<div class="agent-file-card-size">${formatBytes(file.sizeBytes)}</div>` : ''}
        </div>
      `;
      card.addEventListener('click', () => openAgentFileEditor(agentId, sf.name, exists));
      grid.appendChild(card);
    }

    for (const file of files) {
      const path = file.path ?? file.name ?? '';
      if (AGENT_STANDARD_FILES.some(sf => sf.name === path)) continue;
      const card = document.createElement('div');
      card.className = 'agent-file-card';
      card.innerHTML = `
        <div class="agent-file-card-icon">F</div>
        <div class="agent-file-card-body">
          <div class="agent-file-card-name">${escHtml(path)}</div>
          ${file.sizeBytes ? `<div class="agent-file-card-size">${formatBytes(file.sizeBytes)}</div>` : ''}
        </div>
      `;
      card.addEventListener('click', () => openAgentFileEditor(agentId, path, true));
      grid.appendChild(card);
    }
  } catch (e) {
    console.warn('Agent files load failed:', e);
    grid.innerHTML = '<div class="empty-state"><div class="empty-title">Could not load files</div></div>';
  }
}

async function openAgentFileEditor(agentId: string, filePath: string, exists: boolean) {
  const editor = $('agent-file-editor');
  const pathEl = $('agent-file-editor-path');
  const content = $('agent-file-editor-content') as HTMLTextAreaElement | null;
  if (!editor || !content) return;

  editor.style.display = '';
  if (pathEl) pathEl.textContent = filePath;
  content.value = exists ? 'Loading…' : '';
  content.disabled = exists;
  content.dataset.agentId = agentId;
  content.dataset.filePath = filePath;

  if (exists) {
    try {
      let fileContent: string;
      if (isEngineMode()) {
        const engineFile = await pawEngine.agentFileGet(filePath, agentId);
        fileContent = engineFile?.content ?? '';
      } else {
        const result = await gateway.agentFilesGet(filePath, agentId);
        fileContent = result.content ?? '';
      }
      content.value = fileContent;
      content.disabled = false;
    } catch (e) {
      content.value = `Error loading file: ${e}`;
      content.disabled = false;
    }
  } else {
    const standard = AGENT_STANDARD_FILES.find(sf => sf.name === filePath);
    if (standard) {
      content.value = getAgentFileTemplate(filePath, agentId);
    }
    content.disabled = false;
  }

  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function getAgentFileTemplate(fileName: string, agentId: string): string {
  const templates: Record<string, string> = {
    'AGENTS.md': `# ${agentId} — Operating Instructions\n\n## Priorities\n1. Be helpful and accurate\n2. Use memory to remember context across sessions\n3. Follow the user's preferences defined in USER.md\n\n## Rules\n- Always check memory before answering questions about past conversations\n- Be concise unless asked for detail\n- Ask clarifying questions when intent is ambiguous\n`,
    'SOUL.md': `# ${agentId} — Persona\n\n## Personality\n- Friendly and professional\n- Direct and clear in communication\n- Proactive — anticipates needs\n\n## Tone\n- Warm but not overly casual\n- Confident without being arrogant\n\n## Boundaries\n- Always be honest about limitations\n- Never fabricate information\n`,
    'USER.md': `# About the User\n\n## How to address them\n- Use their first name\n\n## Preferences\n- Prefers concise responses\n- Likes code examples over lengthy explanations\n`,
    'IDENTITY.md': `# IDENTITY.md - Agent Identity\n\n- Name: ${agentId}\n- Creature: helpful assistant\n- Vibe: warm and capable\n`,
    'TOOLS.md': `# ${agentId} — Tool Notes\n\n## Available Tools\nThis agent has access to the standard OpenClaw tool set.\n\n## Conventions\n- Use the file system for persistent work\n- Use memory_store for important facts to remember\n`,
    'HEARTBEAT.md': `# ${agentId} — Heartbeat Checklist\n\n- [ ] Check for pending tasks\n- [ ] Review recent messages\n`,
  };
  return templates[fileName] ?? `# ${fileName}\n\n`;
}

function showAgentModal(agent?: AgentSummary) {
  _editingAgentId = agent?.id ?? null;
  const modal = $('agent-modal');
  const title = $('agent-modal-title');
  const saveBtn = $('agent-modal-save');
  if (!modal) return;
  modal.style.display = 'flex';
  if (title) title.textContent = agent ? 'Edit Agent' : 'New Agent';
  if (saveBtn) saveBtn.textContent = agent ? 'Save Changes' : 'Create Agent';

  const modelSelect = $('agent-form-model') as HTMLSelectElement;
  if (modelSelect) {
    modelSelect.innerHTML = '<option value="">Default model</option>';
    for (const m of _cachedModels) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name ?? m.id;
      modelSelect.appendChild(opt);
    }
  }

  ($('agent-form-emoji') as HTMLInputElement).value = agent?.identity?.emoji ?? '';
  ($('agent-form-name') as HTMLInputElement).value = agent?.identity?.name ?? agent?.name ?? '';
  ($('agent-form-workspace') as HTMLInputElement).value = '';
}

function hideAgentModal() {
  const modal = $('agent-modal');
  if (modal) modal.style.display = 'none';
  _editingAgentId = null;
}

// ── Event wiring ───────────────────────────────────────────────────────────
export function initFoundryEvents() {
  $('refresh-models-btn')?.addEventListener('click', () => { loadModels(); loadModes(); });

  // Foundry tab switching
  document.querySelectorAll('.foundry-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.foundry-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.getAttribute('data-foundry-tab');
      const modelsPanel = $('foundry-models-panel');
      const modesPanel = $('foundry-modes-panel');
      const agentsPanel = $('foundry-agents-panel');
      if (modelsPanel) modelsPanel.style.display = target === 'models' ? '' : 'none';
      if (modesPanel) modesPanel.style.display = target === 'modes' ? '' : 'none';
      if (agentsPanel) agentsPanel.style.display = target === 'agents' ? '' : 'none';
      if (target === 'agents') loadAgents();
    });
  });

  // Mode modal
  $('modes-add-btn')?.addEventListener('click', () => editMode());
  $('mode-modal-close')?.addEventListener('click', hideModeModal);
  $('mode-modal-cancel')?.addEventListener('click', hideModeModal);

  $('mode-form-temp')?.addEventListener('input', () => {
    const val = ($('mode-form-temp') as HTMLInputElement).value;
    const display = $('mode-form-temp-value');
    if (display) display.textContent = parseFloat(val).toFixed(1);
  });

  $('mode-modal-save')?.addEventListener('click', async () => {
    const name = ($('mode-form-name') as HTMLInputElement).value.trim();
    if (!name) { alert('Name is required'); return; }
    const id = _editingModeId ?? name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    await saveMode({
      id,
      name,
      icon: ($('mode-form-icon') as HTMLInputElement).value || '',
      color: ($('mode-form-color') as HTMLInputElement).value || '#0073EA',
      model: ($('mode-form-model') as HTMLSelectElement).value || null,
      system_prompt: ($('mode-form-prompt') as HTMLTextAreaElement).value,
      thinking_level: ($('mode-form-thinking') as HTMLSelectElement).value,
      temperature: parseFloat(($('mode-form-temp') as HTMLInputElement).value),
    });
    hideModeModal();
    loadModes();
  });

  $('mode-modal-delete')?.addEventListener('click', async () => {
    if (!_editingModeId || !confirm('Delete this mode?')) return;
    await deleteMode(_editingModeId);
    hideModeModal();
    loadModes();
  });

  // Agent detail
  $('agent-detail-back')?.addEventListener('click', closeAgentDetail);

  $('agent-file-editor-save')?.addEventListener('click', async () => {
    const content = $('agent-file-editor-content') as HTMLTextAreaElement | null;
    if (!content?.dataset.filePath || !content?.dataset.agentId) return;
    try {
      if (isEngineMode()) {
        await pawEngine.agentFileSet(content.dataset.filePath, content.value, content.dataset.agentId);
      } else {
        await gateway.agentFilesSet(content.dataset.filePath, content.value, content.dataset.agentId);
      }
      showToast('File saved', 'success');
      loadAgentFiles(content.dataset.agentId);
    } catch (e) {
      showToast(`Save failed: ${e instanceof Error ? e.message : e}`, 'error');
    }
  });

  $('agent-file-editor-close')?.addEventListener('click', () => {
    const editor = $('agent-file-editor');
    if (editor) editor.style.display = 'none';
  });

  $('agent-files-refresh')?.addEventListener('click', () => {
    if (_currentAgentId) loadAgentFiles(_currentAgentId);
  });

  $('agent-files-new')?.addEventListener('click', async () => {
    if (!_currentAgentId) return;
    const name = await promptModalFn?.('New File', 'File name (e.g. PROJECTS.md)…');
    if (!name) return;
    const fileName = name.endsWith('.md') ? name : name + '.md';
    openAgentFileEditor(_currentAgentId, fileName, false);
  });

  // Agent create modal
  $('agents-create-btn')?.addEventListener('click', () => showAgentModal());
  $('agent-modal-close')?.addEventListener('click', hideAgentModal);
  $('agent-modal-cancel')?.addEventListener('click', hideAgentModal);

  $('agent-modal-save')?.addEventListener('click', async () => {
    const name = ($('agent-form-name') as HTMLInputElement).value.trim();
    if (!name) { showToast('Name is required', 'error'); return; }
    const emoji = ($('agent-form-emoji') as HTMLInputElement).value || '';
    const workspace = ($('agent-form-workspace') as HTMLInputElement).value.trim() || undefined;
    const model = ($('agent-form-model') as HTMLSelectElement).value || undefined;

    try {
      if (_editingAgentId) {
        await gateway.updateAgent({ agentId: _editingAgentId, name, workspace, model });
        showToast('Agent updated', 'success');
      } else {
        const result = await gateway.createAgent({ name, workspace, emoji });
        showToast(`Agent "${result.name}" created`, 'success');
        hideAgentModal();
        await loadAgents();
        openAgentDetail(result.agentId);
        return;
      }
    } catch (e) {
      showToast(`Failed: ${e instanceof Error ? e.message : e}`, 'error');
      return;
    }
    hideAgentModal();
    loadAgents();
  });

  $('agent-detail-edit')?.addEventListener('click', () => {
    if (!_currentAgentId) return;
    const agent = _agentsList.find(a => a.id === _currentAgentId);
    showAgentModal(agent);
  });

  $('agent-detail-delete')?.addEventListener('click', async () => {
    if (!_currentAgentId || _currentAgentId === 'main') return;
    const agent = _agentsList.find(a => a.id === _currentAgentId);
    const name = agent?.identity?.name ?? agent?.name ?? _currentAgentId;
    if (!confirm(`Delete agent "${name}"? This will remove the agent and optionally its workspace files.`)) return;
    const deleteFiles = confirm('Also delete workspace files? (Cancel = keep files)');
    try {
      await gateway.deleteAgent(_currentAgentId, deleteFiles);
      showToast(`Agent "${name}" deleted`, 'success');
      closeAgentDetail();
      loadAgents();
    } catch (e) {
      showToast(`Delete failed: ${e instanceof Error ? e.message : e}`, 'error');
    }
  });
}
