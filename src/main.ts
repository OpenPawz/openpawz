// Paw — Application Entry Point
import type { AppConfig } from './types';
import { isEngineMode, setEngineMode, startEngineBridge } from './engine-bridge';
import { pawEngine } from './engine';
import { initDb, initDbEncryption } from './db';
import { appState } from './state/index';
import { escHtml, populateModelSelect, promptModal, icon } from './components/helpers';
import { initHILModal } from './components/molecules/hil_modal';
import { initChatListeners, loadSessions, populateAgentSelect, switchToAgent } from './engine/organisms/chat_controller';
import './engine/molecules/event_bus';
import { initChannels, loadChannels, getChannelConfig, getChannelStatus, startChannel, closeChannelSetup, loadDashboardCron, loadSpaceCron, loadMemory, openMemoryFile } from './views/channels';
import { initContent, loadContentDocs } from './views/content';
import * as SettingsModule from './views/settings';
import * as ModelsSettings from './views/settings-models';
import * as AgentDefaultsSettings from './views/settings-agent-defaults';
import * as SessionsSettings from './views/settings-sessions';
import * as VoiceSettings from './views/settings-voice';
import * as SkillsSettings from './views/settings-skills';
import { setConnected as setSettingsConnected } from './views/settings-config';
import * as AutomationsModule from './views/automations';
import * as MemoryPalaceModule from './views/memory-palace';
import * as MailModule from './views/mail';
import * as SkillsModule from './views/skills';
import * as FoundryModule from './views/foundry';
import * as ResearchModule from './views/research';
import * as NodesModule from './views/nodes';
import * as ProjectsModule from './views/projects';
import * as AgentsModule from './views/agents';
import * as TodayModule from './views/today';
import * as TasksModule from './views/tasks';
import * as OrchestratorModule from './views/orchestrator';
import * as TradingModule from './views/trading';

// ── Tauri bridge ───────────────────────────────────────────────────────────
interface TauriWindow {
  __TAURI__?: {
    core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
    event: { listen: <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void> };
  };
}
const tauriWindow = window as unknown as TauriWindow;
const listen = tauriWindow.__TAURI__?.event?.listen;

// ── Global error handlers ──────────────────────────────────────────────────
function crashLog(msg: string) {
  try {
    const log = JSON.parse(localStorage.getItem('paw-crash-log') || '[]') as string[];
    log.push(`${new Date().toISOString()} ${msg}`);
    while (log.length > 50) log.shift();
    localStorage.setItem('paw-crash-log', JSON.stringify(log));
  } catch { /* localStorage might be full */ }
}
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message ?? event.reason ?? 'unknown';
  crashLog(`unhandledrejection: ${msg}`);
  console.error('Unhandled promise rejection:', msg);
  event.preventDefault();
});
window.addEventListener('error', (event) => {
  const msg = event.error?.message ?? event.message ?? 'unknown';
  crashLog(`error: ${msg}`);
  console.error('Uncaught error:', msg);
});

// ── DOM convenience ────────────────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id);

// ── App-level config (persisted) ───────────────────────────────────────────
let config: AppConfig = { configured: false };

// ── View management ────────────────────────────────────────────────────────
document.querySelectorAll('[data-view]').forEach((item) => {
  item.addEventListener('click', () => {
    const view = item.getAttribute('data-view');
    if (view) switchView(view);
  });
});

const allViewIds = [
  'dashboard-view', 'setup-view', 'manual-setup-view', 'install-view',
  'chat-view', 'tasks-view', 'code-view', 'content-view', 'mail-view',
  'automations-view', 'channels-view', 'research-view', 'memory-view',
  'skills-view', 'foundry-view', 'settings-view', 'nodes-view', 'agents-view',
  'today-view', 'orchestrator-view', 'trading-view',
];

function switchView(viewName: string) {
  if (!config.configured && viewName !== 'settings') return;

  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.getAttribute('data-view') === viewName);
  });
  allViewIds.forEach((id) => $(id)?.classList.remove('active'));

  const viewMap: Record<string, string> = {
    dashboard: 'dashboard-view', chat: 'chat-view', tasks: 'tasks-view', code: 'code-view',
    content: 'content-view', mail: 'mail-view', automations: 'automations-view',
    channels: 'channels-view', research: 'research-view', memory: 'memory-view',
    skills: 'skills-view', foundry: 'foundry-view', settings: 'settings-view',
    nodes: 'nodes-view', agents: 'agents-view', today: 'today-view',
    orchestrator: 'orchestrator-view', trading: 'trading-view',
  };
  $(viewMap[viewName] ?? '')?.classList.add('active');

  if (appState.wsConnected) {
    switch (viewName) {
      case 'dashboard': loadDashboardCron(); break;
      case 'chat': loadSessions(); populateAgentSelect(); break;
      case 'channels': loadChannels(); break;
      case 'automations': {
        const al = AgentsModule.getAgents();
        AutomationsModule.setAgents(al.map(a => ({ id: a.id, name: a.name, avatar: a.avatar })));
        AutomationsModule.loadCron();
        break;
      }
      case 'agents': AgentsModule.loadAgents(); break;
      case 'today': TodayModule.loadToday(); break;
      case 'skills': SkillsSettings.loadSkillsSettings(); break;
      case 'foundry': FoundryModule.loadModels(); FoundryModule.loadModes(); break;
      case 'nodes': NodesModule.loadNodes(); NodesModule.loadPairingRequests(); break;
      case 'memory': MemoryPalaceModule.loadMemoryPalace(); loadMemory(); break;
      case 'tasks': {
        const al = AgentsModule.getAgents();
        TasksModule.setAgents(al.map(a => ({ id: a.id, name: a.name, avatar: a.avatar })));
        TasksModule.loadTasks();
        break;
      }
      case 'orchestrator': OrchestratorModule.loadProjects(); break;
      case 'trading': TradingModule.loadTrading(); break;
      case 'mail': MailModule.loadMail(); loadSpaceCron('mail'); break;
      case 'settings': SettingsModule.loadSettings(); SettingsModule.startUsageAutoRefresh(); loadActiveSettingsTab(); break;
      default: break;
    }
  }
  if (viewName !== 'settings') SettingsModule.stopUsageAutoRefresh();
  switch (viewName) {
    case 'content': loadContentDocs(); if (appState.wsConnected) loadSpaceCron('content'); break;
    case 'research': ResearchModule.loadResearchProjects(); if (appState.wsConnected) loadSpaceCron('research'); break;
    case 'code': ProjectsModule.loadProjects(); break;
    default: break;
  }
  if (viewName === 'settings') SettingsModule.loadSettings();
}

function showView(viewId: string) {
  allViewIds.forEach((id) => $(id)?.classList.remove('active'));
  $(viewId)?.classList.add('active');
}

// ── Model selector ─────────────────────────────────────────────────────────
async function refreshModelLabel() {
  const chatModelSelect = $('chat-model-select') as HTMLSelectElement | null;
  if (!chatModelSelect) return;
  try {
    const cfg = await pawEngine.getConfig();
    const defaultModel = cfg.default_model || '';
    const providers = cfg.providers ?? [];
    const currentVal = chatModelSelect.value;
    populateModelSelect(chatModelSelect, providers, {
      defaultLabel: 'Default Model',
      currentValue: currentVal && currentVal !== 'default' ? currentVal : 'default',
      showDefaultModel: defaultModel || undefined,
    });
  } catch { /* leave as-is */ }
}
(window as unknown as Record<string, unknown>).__refreshModelLabel = refreshModelLabel;

// ── Engine connection ──────────────────────────────────────────────────────
async function connectEngine(): Promise<boolean> {
  if (isEngineMode()) {
    console.log('[main] Engine mode — using Tauri IPC');
    await startEngineBridge();
    appState.wsConnected = true;
    setSettingsConnected(true);
    SettingsModule.setWsConnected(true);
    MemoryPalaceModule.setWsConnected(true);
    MailModule.setWsConnected(true);
    SkillsModule.setWsConnected(true);
    FoundryModule.setWsConnected(true);
    ResearchModule.setWsConnected(true);
    NodesModule.setWsConnected(true);
    AutomationsModule.setWsConnected(true);
    TradingModule.setWsConnected(true);

    const statusDot = $('status-dot');
    const statusText = $('status-text');
    const chatAgentName = $('chat-agent-name');
    const chatAvatarEl = $('chat-avatar');

    statusDot?.classList.add('connected');
    statusDot?.classList.remove('error');
    if (statusText) statusText.textContent = 'Engine';

    const initAgent = AgentsModule.getCurrentAgent();
    if (chatAgentName) {
      chatAgentName.innerHTML = initAgent
        ? `${AgentsModule.spriteAvatar(initAgent.avatar, 20)} ${escHtml(initAgent.name)}`
        : `${AgentsModule.spriteAvatar('5', 20)} Paw`;
    }
    if (chatAvatarEl && initAgent) {
      chatAvatarEl.innerHTML = AgentsModule.spriteAvatar(initAgent.avatar, 32);
    }

    refreshModelLabel();
    TasksModule.startCronTimer();
    if (listen) {
      listen<{ task_id: string; status: string }>('task-updated', (event) => {
        TasksModule.onTaskUpdated(event.payload);
      });
    }

    pawEngine.autoSetup().then(result => {
      if (result.action === 'ollama_added') {
        console.log(`[main] Auto-setup: ${result.message}`);
        showToast(result.message || `Ollama detected! Using model '${result.model}'.`, 'success');
        ModelsSettings.loadModelsSettings();
      } else if (result.action === 'none' && result.message) {
        console.log('[main] Auto-setup:', result.message);
      }
    }).catch(e => console.warn('[main] Auto-setup failed (non-fatal):', e));

    pawEngine.ensureEmbeddingReady().then(status => {
      if (status.error) {
        console.warn('[main] Ollama embedding setup:', status.error);
      } else {
        console.log(`[main] Ollama ready: model=${status.model_name} dims=${status.embedding_dims}`);
      }
    }).catch(e => console.warn('[main] Ollama auto-init failed (non-fatal):', e));

    return true;
  }
  console.warn('[main] connectEngine: engine mode should have handled it above');
  return false;
}

// ── Config persistence ─────────────────────────────────────────────────────
function loadConfigFromStorage() {
  const saved = localStorage.getItem('claw-config');
  if (saved) {
    try { config = JSON.parse(saved); } catch { /* invalid */ }
  }
}

// ── Settings tabs ──────────────────────────────────────────────────────────
let _activeSettingsTab = 'general';

function loadActiveSettingsTab() {
  switch (_activeSettingsTab) {
    case 'models': ModelsSettings.loadModelsSettings(); break;
    case 'agent-defaults': AgentDefaultsSettings.loadAgentDefaultsSettings(); break;
    case 'sessions': SessionsSettings.loadSessionsSettings(); break;
    case 'voice': VoiceSettings.loadVoiceSettings(); break;
    case 'skills': SkillsSettings.loadSkillsSettings(); break;
    default: break;
  }
}

function initSettingsTabs() {
  const bar = $('settings-tab-bar');
  if (!bar) return;
  bar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.settings-tab') as HTMLElement | null;
    if (!btn) return;
    const tab = btn.dataset.settingsTab;
    if (!tab || tab === _activeSettingsTab) return;
    bar.querySelectorAll('.settings-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.settings-tab-panel').forEach(p => {
      (p as HTMLElement).style.display = 'none';
    });
    const panel = $(`settings-panel-${tab}`);
    if (panel) panel.style.display = '';
    _activeSettingsTab = tab;
    loadActiveSettingsTab();
  });
}

// ── Theme ──────────────────────────────────────────────────────────────────
const THEME_KEY = 'paw-theme';
function getTheme(): 'dark' | 'light' {
  return (localStorage.getItem(THEME_KEY) as 'dark' | 'light') || 'dark';
}
function setTheme(theme: 'dark' | 'light') {
  if (theme === 'dark') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  localStorage.setItem(THEME_KEY, theme);
  const label = document.getElementById('theme-label');
  if (label) label.textContent = theme === 'dark' ? 'Dark' : 'Light';
}
function initTheme() {
  setTheme(getTheme());
  $('theme-toggle')?.addEventListener('click', () => {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  });
}

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info', durationMs = 3500) {
  const container = $('global-toast');
  if (!container) return;
  container.textContent = message;
  container.className = `global-toast toast-${type}`;
  container.style.display = '';
  container.style.opacity = '1';
  setTimeout(() => {
    container.style.opacity = '0';
    setTimeout(() => { container.style.display = 'none'; }, 300);
  }, durationMs);
}

// ── Initialize ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('[main] Paw starting...');

    for (const el of document.querySelectorAll<HTMLElement>('[data-icon]')) {
      const name = el.dataset.icon;
      if (name) el.innerHTML = icon(name);
    }

    initTheme();

    try {
      const prevLog = localStorage.getItem('paw-crash-log');
      if (prevLog) {
        const entries = JSON.parse(prevLog) as string[];
        if (entries.length) entries.slice(-5).forEach(e => console.warn('  ', e));
      }
    } catch { /* ignore */ }
    crashLog('startup');

    await initDb().catch(e => console.warn('[main] DB init failed:', e));
    await initDbEncryption().catch(e => console.warn('[main] DB encryption init failed:', e));

    MemoryPalaceModule.initPalaceEvents();
    window.addEventListener('palace-open-file', (e: Event) => {
      openMemoryFile((e as CustomEvent).detail as string);
    });

    MailModule.configure({
      switchView,
      setCurrentSession: (key) => { appState.currentSessionKey = key; },
      getChatInput: () => document.getElementById('chat-input') as HTMLTextAreaElement | null,
      closeChannelSetup,
    });
    MailModule.initMailEvents();

    $('refresh-skills-btn')?.addEventListener('click', () => SkillsSettings.loadSkillsSettings());

    FoundryModule.initFoundryEvents();
    ResearchModule.configure({ promptModal });
    ResearchModule.initResearchEvents();

    localStorage.setItem('paw-runtime-mode', 'engine');

    AgentsModule.configure({
      switchView,
      setCurrentAgent: (agentId) => { if (agentId) switchToAgent(agentId); },
    });
    AgentsModule.initAgents();

    AgentsModule.onProfileUpdated((agentId, agent) => {
      const current = AgentsModule.getCurrentAgent();
      const chatAgentName = $('chat-agent-name');
      if (current && current.id === agentId && chatAgentName) {
        chatAgentName.innerHTML = `${AgentsModule.spriteAvatar(agent.avatar, 20)} ${escHtml(agent.name)}`;
      }
      populateAgentSelect();
    });

    NodesModule.initNodesEvents();
    SettingsModule.initSettings();
    initSettingsTabs();
    ModelsSettings.initModelsSettings();
    AgentDefaultsSettings.initAgentDefaultsSettings();
    SessionsSettings.initSessionsSettings();
    VoiceSettings.initVoiceSettings();

    setEngineMode(true);

    ProjectsModule.bindEvents();
    TasksModule.bindTaskEvents();
    OrchestratorModule.initOrchestrator();

    initChannels();
    initContent();
    initChatListeners();
    initHILModal();

    loadConfigFromStorage();
    console.log('[main] Pawz engine mode — starting...');
    switchView('dashboard');
    await connectEngine();

    // Auto-reconnect configured channels on startup
    (async () => {
      try {
        const tgCfg = await pawEngine.telegramGetConfig();
        if (tgCfg.enabled && tgCfg.bot_token) {
          const tgStatus = await pawEngine.telegramStatus();
          if (!tgStatus.running) {
            await pawEngine.telegramStart();
            console.log('[main] Auto-started Telegram bridge');
          }
        }
      } catch (e) { console.warn('[main] Telegram auto-start skipped:', e); }

      const channels = ['discord', 'irc', 'slack', 'matrix', 'mattermost', 'nextcloud', 'nostr', 'twitch'] as const;
      for (const ch of channels) {
        try {
          const cfg = await getChannelConfig(ch);
          if (cfg && (cfg as Record<string, unknown>).enabled) {
            const status = await getChannelStatus(ch);
            if (status && !status.running) {
              await startChannel(ch);
              console.log(`[main] Auto-started ${ch} bridge`);
            }
          }
        } catch (e) { console.warn(`[main] ${ch} auto-start skipped:`, e); }
      }
    })();

    console.log('[main] Pawz initialized');
  } catch (e) {
    console.error('[main] Init error:', e);
    showView('setup-view');
  }
});
