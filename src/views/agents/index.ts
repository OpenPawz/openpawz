// index.ts — Module state, wiring, and public API for the agents view
// Imports from sub-modules and provides the unified public interface

import { pawEngine, type BackendAgent } from '../../engine';
import { isEngineMode } from '../../engine-bridge';
import { listen } from '@tauri-apps/api/event';
import {
  type Agent,
  AVATAR_COLORS,
  SPRITE_AVATARS,
  DEFAULT_AVATAR,
  spriteAvatar,
  isAvatar,
} from './atoms';
import { renderAgents } from './molecules';
import { openAgentCreator, openAgentEditor } from './editor';
import { openMiniChat as _openMiniChat, _miniChats } from './mini-chat';
import { escAttr } from '../../components/helpers';

// ── Module state ────────────────────────────────────────────────────────────

let _agents: Agent[] = [];
let _selectedAgent: string | null = null;
let _availableModels: { id: string; name: string }[] = [
  { id: 'default', name: 'Default (Use account setting)' },
];

// Callbacks registered via configure()
let onSwitchView: ((view: string) => void) | null = null;
let onSetCurrentAgent: ((agentId: string | null) => void) | null = null;
let _onProfileUpdated: ((agentId: string, agent: Agent) => void) | null = null;

// ── Dock state ──────────────────────────────────────────────────────────────

let _dockEl: HTMLElement | null = null;
let _dockCollapsed = localStorage.getItem('paw-dock-collapsed') === 'true';

function setDockCollapsed(collapsed: boolean) {
  _dockCollapsed = collapsed;
  localStorage.setItem('paw-dock-collapsed', String(collapsed));
  if (_dockEl) _dockEl.classList.toggle('agent-dock-collapsed', collapsed);
  // Update toggle icon
  const icon = _dockEl?.querySelector('.agent-dock-toggle .ms') as HTMLElement | null;
  if (icon) icon.textContent = collapsed ? 'left_panel_open' : 'right_panel_close';
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Seed initial soul files for a new agent so it knows who it is from the first conversation.
 * Only writes files that don't already exist to avoid overwriting user edits.
 */
async function seedSoulFiles(agent: Agent): Promise<void> {
  try {
    const existing = await pawEngine.agentFileList(agent.id);
    const existingNames = new Set(existing.map(f => f.file_name));

    if (!existingNames.has('IDENTITY.md')) {
      const personality = agent.personality;
      const personalityDesc = [
        personality.tone !== 'balanced' ? `Tone: ${personality.tone}` : '',
        personality.initiative !== 'balanced' ? `Initiative: ${personality.initiative}` : '',
        personality.detail !== 'balanced' ? `Detail level: ${personality.detail}` : '',
      ].filter(Boolean).join(', ');

      const identity = [
        `# ${agent.name}`,
        '',
        `## Identity`,
        `- **Name**: ${agent.name}`,
        `- **Agent ID**: ${agent.id}`,
        `- **Role**: ${agent.bio || 'AI assistant'}`,
        agent.template !== 'general' && agent.template !== 'custom' ? `- **Specialty**: ${agent.template}` : '',
        personalityDesc ? `- **Personality**: ${personalityDesc}` : '',
        '',
        agent.boundaries.length > 0 ? `## Boundaries\n${agent.boundaries.map(b => `- ${b}`).join('\n')}` : '',
        '',
        agent.systemPrompt ? `## Custom Instructions\n${agent.systemPrompt}` : '',
      ].filter(Boolean).join('\n');

      await pawEngine.agentFileSet('IDENTITY.md', identity.trim(), agent.id);
    }

    if (!existingNames.has('SOUL.md')) {
      const soul = [
        `# Soul`,
        '',
        `Write your personality, values, and communication style here.`,
        `Use \`soul_write\` to update this file as you develop your voice.`,
      ].join('\n');
      await pawEngine.agentFileSet('SOUL.md', soul, agent.id);
    }

    if (!existingNames.has('USER.md')) {
      const user = [
        `# About the User`,
        '',
        `Record what you learn about the user here — their name, preferences, projects, etc.`,
        `Use \`soul_write\` to update this file when you learn new things.`,
      ].join('\n');
      await pawEngine.agentFileSet('USER.md', user, agent.id);
    }

    console.log(`[agents] Seeded soul files for ${agent.name} (${agent.id})`);
  } catch (e) {
    console.warn(`[agents] Failed to seed soul files for ${agent.id}:`, e);
  }
}

/** Fetch configured models from the engine and populate the model picker. */
async function refreshAvailableModels() {
  try {
    const config = await pawEngine.getConfig();
    const models: { id: string; name: string }[] = [
      { id: 'default', name: 'Default (Use account setting)' },
    ];
    // Add each provider's default model, plus well-known models per provider kind
    const WELL_KNOWN: Record<string, { id: string; name: string }[]> = {
      google: [
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      ],
      anthropic: [
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 ($3/$15)' },
        { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5 ($1/$5)' },
        { id: 'claude-3-haiku-20240307', name: 'Claude Haiku 3 ($0.25/$1.25) cheapest' },
        { id: 'claude-opus-4-6', name: 'Claude Opus 4.6 ($5/$25)' },
        { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5 (agentic)' },
      ],
      openai: [
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
        { id: 'o1', name: 'o1' },
        { id: 'o3-mini', name: 'o3-mini' },
      ],
      openrouter: [],
      ollama: [],
      custom: [],
    };
    const seen = new Set<string>(['default']);
    for (const p of config.providers ?? []) {
      // Provider's own default model
      if (p.default_model && !seen.has(p.default_model)) {
        seen.add(p.default_model);
        models.push({ id: p.default_model, name: `${p.default_model} (${p.kind})` });
      }
      // Well-known models for this provider kind
      for (const wk of WELL_KNOWN[p.kind] ?? []) {
        if (!seen.has(wk.id)) {
          seen.add(wk.id);
          models.push(wk);
        }
      }
    }
    // Also add the global default model if set
    if (config.default_model && !seen.has(config.default_model)) {
      models.push({ id: config.default_model, name: `${config.default_model} (default)` });
    }
    _availableModels = models;
  } catch (e) {
    console.warn('[agents] Could not load models from engine config:', e);
  }
}

function startChatWithAgent(agentId: string) {
  _selectedAgent = agentId;
  onSetCurrentAgent?.(agentId);
  onSwitchView?.('chat');
}

function saveAgents() {
  // Persist all agents to localStorage (backend agents too so edits to name/avatar/personality survive reload)
  localStorage.setItem('paw-agents', JSON.stringify(_agents));
  renderAgentDock();
}

// Build the EditorCallbacks object to pass into editor functions
function makeEditorCallbacks() {
  return {
    getAgents: () => _agents,
    getAvailableModels: () => _availableModels,
    onCreated: (agent: Agent) => {
      _agents.push(agent);
      saveAgents();
      _renderAgents();
    },
    onUpdated: () => {
      saveAgents();
      _renderAgents();
    },
    onDeleted: (agentId: string) => {
      _agents = _agents.filter(a => a.id !== agentId);
      saveAgents();
      _renderAgents();
    },
    seedSoulFiles,
  };
}

// Internal render helper that passes correct callbacks
function _renderAgents() {
  renderAgents(_agents, {
    onChat: (id) => startChatWithAgent(id),
    onMiniChat: (id) => openMiniChat(id),
    onEdit: (id) => openAgentEditor(id, makeEditorCallbacks()),
    onCreate: () => openAgentCreator(makeEditorCallbacks()),
  });
}

// ── Public API ─────────────────────────────────────────────────────────────

export function configure(opts: {
  switchView: (view: string) => void;
  setCurrentAgent?: (agentId: string | null) => void;
}) {
  onSwitchView = opts.switchView;
  onSetCurrentAgent = opts.setCurrentAgent ?? null;
}

export async function loadAgents() {
  console.log('[agents] loadAgents called');
  // Refresh available models from engine config (non-blocking)
  await refreshAvailableModels();
  // Load from localStorage (manually created agents)
  try {
    const stored = localStorage.getItem('paw-agents');
    _agents = stored ? JSON.parse(stored) : [];
    // Tag localStorage agents as local
    _agents.forEach(a => { if (!a.source) a.source = 'local'; });
    // Migrate ANY non-numeric avatar to a new Pawz Boi avatar
    let migrated = false;
    const usedNums = new Set<number>();
    _agents.forEach(a => {
      if (!/^\d+$/.test(a.avatar)) {
        let num: number;
        do { num = Math.floor(Math.random() * 50) + 1; } while (usedNums.has(num));
        usedNums.add(num);
        a.avatar = String(num);
        migrated = true;
      }
    });
    if (migrated) localStorage.setItem('paw-agents', JSON.stringify(_agents));
    console.log('[agents] Loaded from storage:', _agents.length, 'agents');
  } catch {
    _agents = [];
  }

  // Ensure there's always a default agent
  const existingDefault = _agents.find(a => a.id === 'default');
  if (existingDefault && !isAvatar(existingDefault.avatar)) {
    existingDefault.avatar = DEFAULT_AVATAR;
    saveAgents();
  }
  if (!existingDefault) {
    _agents.unshift({
      id: 'default',
      name: 'Pawz',
      avatar: DEFAULT_AVATAR,
      color: AVATAR_COLORS[0],
      bio: 'Your main AI agent',
      model: 'default',
      template: 'general',
      personality: { tone: 'balanced', initiative: 'balanced', detail: 'balanced' },
      skills: ['web_search', 'web_fetch', 'read', 'write', 'exec'],
      boundaries: ['Ask before sending emails', 'No destructive git commands without permission'],
      createdAt: new Date().toISOString(),
      source: 'local',
    });
    saveAgents();
  }

  // Merge backend-created agents (from project_agents table)
  if (isEngineMode()) {
    try {
      const backendAgents: BackendAgent[] = await pawEngine.listAllAgents();
      console.log('[agents] Backend agents:', backendAgents.length);
      const usedSprites = new Set(_agents.map(a => a.avatar));
      function pickUniqueSprite(preferred: string): string {
        if (!usedSprites.has(preferred)) { usedSprites.add(preferred); return preferred; }
        const avail = SPRITE_AVATARS.find(s => !usedSprites.has(s));
        if (avail) { usedSprites.add(avail); return avail; }
        return preferred; // fallback if all used
      }
      for (const ba of backendAgents) {
        // Skip if already in local list (by agent_id)
        if (_agents.find(a => a.id === ba.agent_id)) continue;
        // Convert backend agent to Agent format — each gets a unique sprite
        const specialtySprite: Record<string, string> = {
          coder: '10', researcher: '15', designer: '20', communicator: '25',
          security: '30', general: '35', writer: '40', analyst: '45',
        };
        const preferredSprite = specialtySprite[ba.specialty] || '35';
        _agents.push({
          id: ba.agent_id,
          name: ba.agent_id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          avatar: pickUniqueSprite(preferredSprite),
          color: AVATAR_COLORS[_agents.length % AVATAR_COLORS.length],
          bio: `${ba.role} — ${ba.specialty}`,
          model: ba.model || 'default',
          template: 'custom',
          personality: { tone: 'balanced', initiative: 'balanced', detail: 'balanced' },
          skills: ba.capabilities || [],
          boundaries: [],
          systemPrompt: ba.system_prompt,
          createdAt: new Date().toISOString(),
          source: 'backend',
          projectId: ba.project_id,
        });
      }
    } catch (e) {
      console.warn('[agents] Failed to load backend agents:', e);
    }
  }

  _renderAgents();
  renderAgentDock();

  // Seed soul files for all agents that don't have them yet (one-time migration)
  if (isEngineMode()) {
    for (const agent of _agents) {
      seedSoulFiles(agent);
    }
  }
}

/**
 * Render or refresh the floating agent dock tray.
 * Called after agents load and whenever agents list changes.
 * Needs both _agents and _miniChats, so lives here in index.ts.
 */
export function renderAgentDock() {
  // Create dock container if needed
  if (!_dockEl) {
    _dockEl = document.createElement('div');
    _dockEl.id = 'agent-dock';
    _dockEl.className = 'agent-dock';
    if (_dockCollapsed) _dockEl.classList.add('agent-dock-collapsed');
    document.body.appendChild(_dockEl);
  }

  const agents = _agents.filter(a => a.id !== 'default'); // Don't show default Dave in dock
  if (agents.length === 0) {
    _dockEl.style.display = 'none';
    return;
  }
  _dockEl.style.display = '';

  const toggleIcon = _dockCollapsed ? 'left_panel_open' : 'right_panel_close';
  const agentItems = agents.map(a => {
    const isOpen = _miniChats.has(a.id);
    const mc = _miniChats.get(a.id);
    const unread = mc?.unreadCount ?? 0;
    return `
      <div class="agent-dock-item${isOpen ? ' agent-dock-active' : ''}" data-agent-id="${a.id}">
        <div class="agent-dock-avatar">${spriteAvatar(a.avatar, 40)}</div>
        <span class="agent-dock-tooltip">${escAttr(a.name)}</span>
        ${unread > 0 ? `<span class="agent-dock-badge">${unread > 9 ? '9+' : unread}</span>` : ''}
      </div>
    `;
  }).join('');

  _dockEl.innerHTML = `
    <button class="agent-dock-toggle" title="${_dockCollapsed ? 'Show agents' : 'Hide agents'}">
      <span class="ms ms-sm">${toggleIcon}</span>
    </button>
    <div class="agent-dock-items">
      ${agentItems}
    </div>
  `;

  // Toggle button
  _dockEl.querySelector('.agent-dock-toggle')?.addEventListener('click', () => {
    setDockCollapsed(!_dockCollapsed);
  });

  // Bind click events on agent items
  _dockEl.querySelectorAll('.agent-dock-item').forEach(item => {
    item.addEventListener('click', () => {
      const agentId = (item as HTMLElement).dataset.agentId;
      if (agentId) openMiniChat(agentId);
    });
  });
}

export function getAgents(): Agent[] {
  return _agents;
}

export function getCurrentAgent(): Agent | null {
  return _agents.find(a => a.id === _selectedAgent) || _agents[0] || null;
}

/** Set the selected agent by ID (used by main.ts agent dropdown). */
export function setSelectedAgent(agentId: string | null) {
  _selectedAgent = agentId;
}

/** Open a mini-chat popup for any agent (callable from outside the module). */
export function openMiniChat(agentId: string) {
  _openMiniChat(agentId, () => _agents);
}

/** Register a callback for profile updates (called from main.ts) */
export function onProfileUpdated(cb: (agentId: string, agent: Agent) => void) {
  _onProfileUpdated = cb;
}

// ── Profile Update Event Listener ────────────────────────────────────────

let _profileUpdateListenerInitialized = false;

function initProfileUpdateListener() {
  if (_profileUpdateListenerInitialized) return;
  _profileUpdateListenerInitialized = true;

  listen<Record<string, string>>('agent-profile-updated', (event) => {
    const data = event.payload;
    const agentId = data.agent_id;
    if (!agentId) return;

    console.log('[agents] Profile update event received:', data);

    const agent = _agents.find(a => a.id === agentId);
    if (!agent) {
      console.warn(`[agents] update_profile: agent '${agentId}' not found`);
      return;
    }

    // Apply updates
    if (data.name) agent.name = data.name;
    if (data.avatar) agent.avatar = data.avatar;
    if (data.bio) agent.bio = data.bio;
    if (data.system_prompt) agent.systemPrompt = data.system_prompt;

    // Persist and re-render
    saveAgents();
    _renderAgents();
    renderAgentDock();

    // Notify main.ts to update chat header if this is the current agent
    if (_onProfileUpdated) _onProfileUpdated(agentId, agent);
    console.log(`[agents] Profile updated for '${agentId}':`, agent.name, agent.avatar);
  }).catch(e => console.warn('[agents] Failed to listen for profile updates:', e));
}

export function initAgents() {
  loadAgents();
  initProfileUpdateListener();
}

// ── Re-exports (maintain public interface for existing callers) ────────────

export { spriteAvatar, type Agent } from './atoms';
// closeMiniChat is not used externally but re-exported for completeness
export { closeMiniChat } from './mini-chat';
