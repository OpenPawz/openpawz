// src/engine/organisms/chat_controller.ts
// Thin orchestrator for the main chat view.
// Imports atoms + molecules and wires them to the existing DOM.
// All rendering, input, metering, and TTS logic lives in molecules.

import { pawEngine } from '../../engine';
import { engineChatSend } from '../molecules/bridge';
import {
  appState,
  agentSessionMap,
  persistAgentSessionMap,
  MODEL_COST_PER_TOKEN,
  createStreamState,
  sweepStaleStreams,
  type StreamState,
  type MessageWithAttachments,
} from '../../state/index';
import { escHtml, icon, confirmModal } from '../../components/helpers';
import { showToast } from '../../components/toast';
import * as AgentsModule from '../../views/agents';
import * as SettingsModule from '../../views/settings-main';
import {
  addActiveJob,
  clearActiveJobs,
} from '../../components/chat-mission-panel';
import {
  interceptSlashCommand,
  getSessionOverrides as getSlashOverrides,
  isSlashCommand,
  getAutocompleteSuggestions,
  type CommandContext,
} from '../../features/slash-commands';
import { parseCredentialSignal, handleCredentialRequired } from '../molecules/credential_bridge';
import type { Agent, ToolCall, Message } from '../../types';

// ── Molecule imports ─────────────────────────────────────────────────────
import {
  generateSessionLabel,
  extractContent,
  findLastIndex,
  fileToBase64,
  fileTypeIcon,
} from '../atoms/chat';
import {
  renderMessages as rendererRenderMessages,
  showStreamingMessage as rendererShowStreaming,
  appendStreamingDelta as rendererAppendDelta,
  appendThinkingDelta as rendererAppendThinking,
  scrollToBottom as rendererScrollToBottom,
  type RenderOpts,
} from '../molecules/chat_renderer';
import { createTokenMeter, type TokenMeterController, type TokenMeterState } from '../molecules/token_meter';
import { speakMessage, autoSpeakIfEnabled, createTalkMode, type TtsState } from '../molecules/tts';

// ── DOM shorthand ────────────────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id);

// ── Scroll helper (RAF-debounced) ────────────────────────────────────────
const _scrollRaf = { value: false };

export function scrollToBottom(): void {
  const chatMessages = $('chat-messages');
  if (!chatMessages) return;
  rendererScrollToBottom(chatMessages, _scrollRaf);
}

// ── TTS state (scoped to main chat view) ─────────────────────────────────
const _ttsState: TtsState = {
  ttsAudio: null,
  ttsActiveBtn: null,
};

// Sync TTS state with appState for backward compat
function syncTtsToAppState(): void {
  appState.ttsAudio = _ttsState.ttsAudio;
  appState.ttsActiveBtn = _ttsState.ttsActiveBtn;
}

// ── Token meter (lazily initialized) ─────────────────────────────────────
let _tokenMeter: TokenMeterController | null = null;

function getTokenMeter(): TokenMeterController {
  if (!_tokenMeter) {
    _tokenMeter = createTokenMeter({
      meterId: 'token-meter',
      fillId: 'token-meter-fill',
      labelId: 'token-meter-label',
      breakdownPanelId: 'context-breakdown-panel',
      compactionWarningId: 'compaction-warning',
      compactionWarningTextId: 'compaction-warning-text',
      budgetAlertId: 'session-budget-alert',
      budgetAlertTextId: 'session-budget-alert-text',
    });
  }
  return _tokenMeter;
}

/** Build a TokenMeterState snapshot from appState. */
function meterSnapshot(): TokenMeterState {
  return {
    sessionTokensUsed: appState.sessionTokensUsed,
    sessionInputTokens: appState.sessionInputTokens,
    sessionOutputTokens: appState.sessionOutputTokens,
    sessionCost: appState.sessionCost,
    modelContextLimit: appState.modelContextLimit,
    compactionDismissed: appState.compactionDismissed,
    lastRecordedTotal: appState.lastRecordedTotal,
    activeModelKey: appState.activeModelKey,
    sessionToolResultTokens: appState.sessionToolResultTokens,
    sessionToolCallCount: appState.sessionToolCallCount,
    messageCount: appState.messages.length,
    messages: appState.messages,
  };
}

/** Write token meter state changes back to appState. */
function syncMeterToAppState(state: TokenMeterState): void {
  appState.sessionTokensUsed = state.sessionTokensUsed;
  appState.sessionInputTokens = state.sessionInputTokens;
  appState.sessionOutputTokens = state.sessionOutputTokens;
  appState.sessionCost = state.sessionCost;
  appState.modelContextLimit = state.modelContextLimit;
  appState.compactionDismissed = state.compactionDismissed;
  appState.lastRecordedTotal = state.lastRecordedTotal;
  appState.activeModelKey = state.activeModelKey;
  appState.sessionToolResultTokens = state.sessionToolResultTokens;
  appState.sessionToolCallCount = state.sessionToolCallCount;
}

// ── Stream teardown ──────────────────────────────────────────────────────

function teardownStream(sessionKey: string, reason: string): void {
  const stream = appState.activeStreams.get(sessionKey);
  if (!stream) return;
  console.debug(
    `[chat] Tearing down stream for ${sessionKey.slice(0, 12) || '(empty)'}: ${reason}`,
  );
  pawEngine.chatAbort(sessionKey).catch(() => {});
  if (stream.resolve) {
    stream.resolve(stream.content || `(${reason})`);
    stream.resolve = null;
  }
  if (stream.timeout) {
    clearTimeout(stream.timeout);
    stream.timeout = null;
  }
  appState.activeStreams.delete(sessionKey);
  // Clean up streaming UI
  document.getElementById('streaming-message')?.remove();
  clearActiveJobs();
  const abortBtn = document.getElementById('chat-abort-btn');
  if (abortBtn) abortBtn.style.display = 'none';
}

// ── Re-exports for backward compat ───────────────────────────────────────
// These are used by event_bus.ts and other modules.
export { fileToBase64, extractContent };

// ── Render opts builder ──────────────────────────────────────────────────

function buildRenderOpts(): RenderOpts {
  const agent = AgentsModule.getCurrentAgent();
  return {
    agentName: agent?.name ?? 'AGENT',
    agentAvatar: agent?.avatar,
    onRetry: (content: string) => retryMessage(content),
    onSpeak: (text: string, btn: HTMLButtonElement) => {
      speakMessage(text, btn, _ttsState);
      syncTtsToAppState();
    },
    isStreaming: appState.activeStreams.has(appState.currentSessionKey ?? ''),
  };
}

// ── Session management ───────────────────────────────────────────────────
export async function loadSessions(opts?: { skipHistory?: boolean }): Promise<void> {
  if (!appState.wsConnected) return;
  try {
    const engineSessions = await pawEngine.sessionsList(200);

    // Auto-prune empty sessions older than 1 hour
    pawEngine
      .sessionCleanup(3600, appState.currentSessionKey ?? undefined)
      .then((n) => {
        if (n > 0) console.debug(`[chat] Pruned ${n} empty session(s)`);
      })
      .catch((e) => console.warn('[chat] Session cleanup failed:', e));

    const ONE_HOUR = 60 * 60 * 1000;
    const now = Date.now();
    const keptSessions = engineSessions.filter((s) => {
      const age = s.updated_at ? now - new Date(s.updated_at).getTime() : Infinity;
      const isEmpty = s.message_count === 0;
      const isCurrentSession = s.id === appState.currentSessionKey;
      return !(isEmpty && age > ONE_HOUR && !isCurrentSession);
    });

    appState.sessions = keptSessions.map((s) => ({
      key: s.id,
      kind: 'direct' as const,
      label: s.label ?? undefined,
      displayName: s.label ?? s.id,
      updatedAt: s.updated_at ? new Date(s.updated_at).getTime() : undefined,
      agentId: s.agent_id ?? undefined,
    }));

    const currentAgent = AgentsModule.getCurrentAgent();
    if (!appState.currentSessionKey && currentAgent) {
      const savedKey = agentSessionMap.get(currentAgent.id);
      const isValidSaved =
        savedKey &&
        appState.sessions.some(
          (s) =>
            s.key === savedKey &&
            (s.agentId === currentAgent.id || (currentAgent.id === 'default' && !s.agentId)),
        );
      if (isValidSaved) {
        appState.currentSessionKey = savedKey;
      } else {
        const agentSession = appState.sessions.find(
          (s) => s.agentId === currentAgent.id || (currentAgent.id === 'default' && !s.agentId),
        );
        if (agentSession) {
          appState.currentSessionKey = agentSession.key;
          agentSessionMap.set(currentAgent.id, agentSession.key);
          persistAgentSessionMap();
        }
      }
    } else if (!appState.currentSessionKey && appState.sessions.length) {
      appState.currentSessionKey = appState.sessions[0].key;
    }

    renderSessionSelect();
    const sessionBusy = appState.activeStreams.has(appState.currentSessionKey ?? '');
    if (!opts?.skipHistory && appState.currentSessionKey && !sessionBusy) {
      await loadChatHistory(appState.currentSessionKey);
    }
  } catch (e) {
    console.warn('[chat] Sessions load failed:', e);
  }
}

export function renderSessionSelect(): void {
  const chatSessionSelect = $('chat-session-select') as HTMLSelectElement | null;
  if (!chatSessionSelect) return;
  chatSessionSelect.innerHTML = '';

  const currentAgent = AgentsModule.getCurrentAgent();
  const agentSessions = currentAgent
    ? appState.sessions.filter(
        (s) => s.agentId === currentAgent.id || (currentAgent.id === 'default' && !s.agentId),
      )
    : appState.sessions;

  if (!agentSessions.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No sessions — send a message to start';
    chatSessionSelect.appendChild(opt);
    return;
  }

  const MAX_SESSIONS = 25;
  const sorted = [...agentSessions].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const limited = sorted.slice(0, MAX_SESSIONS);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);

  const groups: { label: string; sessions: typeof limited }[] = [
    { label: 'Today', sessions: [] },
    { label: 'Yesterday', sessions: [] },
    { label: 'This Week', sessions: [] },
    { label: 'Older', sessions: [] },
  ];

  for (const s of limited) {
    const t = s.updatedAt ?? 0;
    if (t >= todayStart.getTime()) groups[0].sessions.push(s);
    else if (t >= yesterdayStart.getTime()) groups[1].sessions.push(s);
    else if (t >= weekStart.getTime()) groups[2].sessions.push(s);
    else groups[3].sessions.push(s);
  }

  for (const g of groups) {
    if (!g.sessions.length) continue;
    const optgroup = document.createElement('optgroup');
    optgroup.label = g.label;
    for (const s of g.sessions) {
      const opt = document.createElement('option');
      opt.value = s.key;
      const raw = s.label ?? s.displayName ?? 'Untitled chat';
      const label = raw.length > 40 ? `${raw.slice(0, 37)}…` : raw;
      opt.textContent = label;
      opt.title = raw;
      if (s.key === appState.currentSessionKey) opt.selected = true;
      optgroup.appendChild(opt);
    }
    chatSessionSelect.appendChild(optgroup);
  }

  if (sorted.length > MAX_SESSIONS) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.disabled = true;
    opt.textContent = `… ${sorted.length - MAX_SESSIONS} older sessions`;
    chatSessionSelect.appendChild(opt);
  }
}

export function populateAgentSelect(): void {
  const chatAgentSelect = $('chat-agent-select') as HTMLSelectElement | null;
  if (!chatAgentSelect) return;
  const agents = AgentsModule.getAgents();
  const currentAgent = AgentsModule.getCurrentAgent();
  chatAgentSelect.innerHTML = '';
  for (const a of agents) {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name;
    if (a.id === currentAgent?.id) opt.selected = true;
    chatAgentSelect.appendChild(opt);
  }
}

export async function switchToAgent(agentId: string): Promise<void> {
  const prevAgent = AgentsModule.getCurrentAgent();
  if (prevAgent && appState.currentSessionKey) {
    agentSessionMap.set(prevAgent.id, appState.currentSessionKey);
    persistAgentSessionMap();
  }

  const oldKey = appState.currentSessionKey ?? '';
  teardownStream(oldKey, 'Agent switched');

  AgentsModule.setSelectedAgent(agentId);
  const agent = AgentsModule.getCurrentAgent();
  const chatAgentName = $('chat-agent-name');
  if (chatAgentName && agent) {
    chatAgentName.innerHTML = `${AgentsModule.spriteAvatar(agent.avatar, 20)} ${escHtml(agent.name)}`;
  }
  const chatAvatarEl = document.getElementById('chat-avatar');
  if (chatAvatarEl && agent) {
    chatAvatarEl.innerHTML = AgentsModule.spriteAvatar(agent.avatar, 32);
  }
  const chatAgentSelect = $('chat-agent-select') as HTMLSelectElement | null;
  if (chatAgentSelect) chatAgentSelect.value = agentId;

  resetTokenMeter();

  const savedSessionKey = agentSessionMap.get(agentId);
  const savedSessionValid =
    savedSessionKey &&
    appState.sessions.some(
      (s) =>
        s.key === savedSessionKey &&
        (s.agentId === agentId || (agentId === 'default' && !s.agentId)),
    );
  if (savedSessionValid) {
    appState.currentSessionKey = savedSessionKey;
    renderSessionSelect();
    await loadChatHistory(savedSessionKey);
    const chatSessionSelect = $('chat-session-select') as HTMLSelectElement | null;
    if (chatSessionSelect) chatSessionSelect.value = savedSessionKey;
  } else {
    const agentSession = appState.sessions.find(
      (s) => s.agentId === agentId || (agentId === 'default' && !s.agentId),
    );
    if (agentSession) {
      appState.currentSessionKey = agentSession.key;
      agentSessionMap.set(agentId, agentSession.key);
      persistAgentSessionMap();
      renderSessionSelect();
      await loadChatHistory(agentSession.key);
      const chatSessionSelect = $('chat-session-select') as HTMLSelectElement | null;
      if (chatSessionSelect) chatSessionSelect.value = agentSession.key;
    } else {
      appState.currentSessionKey = null;
      appState.messages = [];
      renderSessionSelect();
      renderMessages();
      const chatSessionSelect = $('chat-session-select') as HTMLSelectElement | null;
      if (chatSessionSelect) chatSessionSelect.value = '';
    }
  }
  console.debug(
    `[chat] Switched to agent "${agent?.name}" (${agentId}), session=${appState.currentSessionKey ?? 'new'}`,
  );
}

export async function loadChatHistory(sessionKey: string): Promise<void> {
  if (!appState.wsConnected) return;
  try {
    const stored = await pawEngine.chatHistory(sessionKey, 200);
    appState.messages = stored
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        timestamp: new Date(m.created_at),
      }));
    renderMessages();
  } catch (e) {
    console.warn('[chat] History load failed:', e);
    appState.messages = [];
    renderMessages();
  }
}

// ── Token metering (delegates to molecule) ───────────────────────────────

export function resetTokenMeter(): void {
  const state = meterSnapshot();
  getTokenMeter().reset(state);
  syncMeterToAppState(state);
}

export function updateTokenMeter(): void {
  getTokenMeter().update(meterSnapshot());
}

export function recordTokenUsage(usage: Record<string, unknown> | undefined): void {
  const state = meterSnapshot();
  getTokenMeter().recordUsage(usage, state, SettingsModule.getBudgetLimit);
  syncMeterToAppState(state);
}

export function updateContextLimitFromModel(modelName: string): void {
  const state = meterSnapshot();
  getTokenMeter().updateContextLimitFromModel(modelName, state);
  syncMeterToAppState(state);
}

export function updateContextBreakdownPopover(): void {
  getTokenMeter().updateBreakdownPopover(meterSnapshot());
}

// ── Streaming pipeline (delegates to renderer molecule) ──────────────────

export function showStreamingMessage(): void {
  const chatEmpty = $('chat-empty');
  const chatMessages = $('chat-messages');
  if (chatEmpty) chatEmpty.style.display = 'none';
  if (!chatMessages) return;

  const agent = AgentsModule.getCurrentAgent();
  const contentEl = rendererShowStreaming(chatMessages, agent?.name ?? 'AGENT');

  // Create session-keyed stream state
  const key = appState.currentSessionKey ?? '';
  sweepStaleStreams();
  const ss = createStreamState(agent?.id);
  ss.el = contentEl;
  appState.activeStreams.set(key, ss);

  const abortBtn = $('chat-abort-btn');
  if (abortBtn) abortBtn.style.display = '';
  scrollToBottom();

  const modelName =
    ($('chat-model-select') as HTMLSelectElement | null)?.selectedOptions?.[0]?.text ?? 'model';
  addActiveJob(`Streaming · ${modelName}`);
}

export function appendStreamingDelta(text: string): void {
  const key = appState.currentSessionKey ?? '';
  const ss = appState.activeStreams.get(key);
  if (!ss) return;
  ss.content += text;
  if (ss.el) {
    rendererAppendDelta(ss.el, ss.content);
    scrollToBottom();
  }
}

export function appendThinkingDelta(text: string): void {
  const key = appState.currentSessionKey ?? '';
  const ss = appState.activeStreams.get(key);
  if (!ss) return;
  ss.thinkingContent += text;

  const streamMsg = document.getElementById('streaming-message');
  if (!streamMsg) return;

  rendererAppendThinking(streamMsg, ss.thinkingContent);
  scrollToBottom();
}

export function finalizeStreaming(
  finalContent: string,
  toolCalls?: ToolCall[],
  streamSessionKey?: string,
): void {
  $('streaming-message')?.remove();
  clearActiveJobs();

  const key = streamSessionKey ?? appState.currentSessionKey ?? '';
  const ss = appState.activeStreams.get(key);
  const savedRunId = ss?.runId ?? null;
  const streamingAgent = ss?.agentId ?? null;
  const thinkingContent = ss?.thinkingContent || undefined;
  appState.activeStreams.delete(key);

  const abortBtn = $('chat-abort-btn');
  if (abortBtn) abortBtn.style.display = 'none';

  const currentAgent = AgentsModule.getCurrentAgent();
  if (streamingAgent && currentAgent && streamingAgent !== currentAgent.id) {
    console.debug(
      `[chat] Streaming agent (${streamingAgent}) differs from current (${currentAgent.id}) — skipping UI render`,
    );
    return;
  }

  if (finalContent) {
    addMessage({
      role: 'assistant',
      content: finalContent,
      timestamp: new Date(),
      toolCalls,
      thinkingContent,
    });
    autoSpeakIfEnabled(finalContent, _ttsState).then(() => syncTtsToAppState());

    // Fallback token estimation
    if (
      appState.sessionTokensUsed === 0 ||
      appState.lastRecordedTotal === appState.sessionTokensUsed
    ) {
      const userMsg = appState.messages.filter((m) => m.role === 'user').pop();
      const userChars = userMsg?.content?.length ?? 0;
      const assistantChars = finalContent.length;
      const estInput = Math.ceil(userChars / 4);
      const estOutput = Math.ceil(assistantChars / 4);
      appState.sessionInputTokens += estInput;
      appState.sessionOutputTokens += estOutput;
      appState.sessionTokensUsed += estInput + estOutput;
      const rate = MODEL_COST_PER_TOKEN[appState.activeModelKey] ?? MODEL_COST_PER_TOKEN['default'];
      appState.sessionCost += estInput * rate.input + estOutput * rate.output;
      console.debug(`[token] Fallback estimate: ~${estInput + estOutput} tokens`);
      updateTokenMeter();
    }
  } else {
    console.warn(
      `[chat] finalizeStreaming: empty content (runId=${savedRunId?.slice(0, 12) ?? 'null'}). Fetching history fallback...`,
    );
    const sk = appState.currentSessionKey;
    if (sk) {
      pawEngine
        .chatHistory(sk, 10)
        .then((stored) => {
          for (let i = stored.length - 1; i >= 0; i--) {
            if (stored[i].role === 'assistant' && stored[i].content) {
              addMessage({ role: 'assistant', content: stored[i].content, timestamp: new Date() });
              return;
            }
          }
          addMessage({
            role: 'assistant',
            content: '*(No response received)*',
            timestamp: new Date(),
          });
        })
        .catch(() => {
          addMessage({
            role: 'assistant',
            content: '*(No response received)*',
            timestamp: new Date(),
          });
        });
    } else {
      addMessage({ role: 'assistant', content: '*(No response received)*', timestamp: new Date() });
    }
  }
}

// ── Message rendering (delegates to renderer molecule) ───────────────────

export function addMessage(message: MessageWithAttachments): void {
  appState.messages.push(message);
  renderMessages();

  // Credential bridge: detect [CREDENTIAL_REQUIRED] signals
  if (message.role === 'assistant' && message.content) {
    const signal = parseCredentialSignal(message.content);
    if (signal) {
      handleCredentialRequired(signal).catch((e) =>
        console.warn('[chat] Credential bridge error:', e),
      );
    }
  }
}

function retryMessage(content: string): void {
  const currentKey = appState.currentSessionKey ?? '';
  if (appState.activeStreams.has(currentKey) || !content) return;
  const lastUserIdx = findLastIndex(appState.messages, (m) => m.role === 'user');
  if (lastUserIdx >= 0) appState.messages.splice(lastUserIdx);
  renderMessages();
  const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
  if (chatInput) {
    chatInput.value = content;
    chatInput.style.height = 'auto';
  }
  sendMessage();
}

export function renderMessages(): void {
  const chatMessages = $('chat-messages');
  const chatEmpty = $('chat-empty');
  if (!chatMessages) return;

  rendererRenderMessages(chatMessages, appState.messages, buildRenderOpts(), chatEmpty);
  scrollToBottom();
}

// ── Attachment helpers ─────────────────────────────────────────────────────

export function renderAttachmentPreview(): void {
  const chatAttachmentPreview = $('chat-attachment-preview');
  if (!chatAttachmentPreview) return;
  if (appState.pendingAttachments.length === 0) {
    chatAttachmentPreview.style.display = 'none';
    chatAttachmentPreview.innerHTML = '';
    return;
  }
  chatAttachmentPreview.style.display = 'flex';
  chatAttachmentPreview.innerHTML = '';
  for (let i = 0; i < appState.pendingAttachments.length; i++) {
    const file = appState.pendingAttachments[i];
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.className = 'attachment-chip-thumb';
      img.onload = () => URL.revokeObjectURL(img.src);
      chip.appendChild(img);
    } else {
      const iconWrap = document.createElement('span');
      iconWrap.className = 'attachment-chip-icon';
      iconWrap.innerHTML = icon(fileTypeIcon(file.type));
      chip.appendChild(iconWrap);
    }
    const meta = document.createElement('div');
    meta.className = 'attachment-chip-meta';
    const nameEl = document.createElement('span');
    nameEl.className = 'attachment-chip-name';
    nameEl.textContent = file.name.length > 24 ? `${file.name.slice(0, 21)}...` : file.name;
    nameEl.title = file.name;
    meta.appendChild(nameEl);
    const sizeEl = document.createElement('span');
    sizeEl.className = 'attachment-chip-size';
    sizeEl.textContent =
      file.size < 1024
        ? `${file.size} B`
        : file.size < 1048576
          ? `${(file.size / 1024).toFixed(1)} KB`
          : `${(file.size / 1048576).toFixed(1)} MB`;
    meta.appendChild(sizeEl);
    chip.appendChild(meta);
    const removeBtn = document.createElement('button');
    removeBtn.className = 'attachment-chip-remove';
    removeBtn.innerHTML = icon('x');
    removeBtn.title = 'Remove';
    const idx = i;
    removeBtn.addEventListener('click', () => {
      appState.pendingAttachments.splice(idx, 1);
      renderAttachmentPreview();
    });
    chip.appendChild(removeBtn);
    chatAttachmentPreview.appendChild(chip);
  }
}

export function clearPendingAttachments(): void {
  appState.pendingAttachments = [];
  renderAttachmentPreview();
}

// ── Send message ──────────────────────────────────────────────────────────

function buildSlashCommandContext(chatModelSelect: HTMLSelectElement | null): CommandContext {
  return {
    sessionKey: appState.currentSessionKey,
    addSystemMessage: (text: string) =>
      addMessage({ role: 'assistant', content: text, timestamp: new Date() }),
    clearChatUI: () => {
      const el = document.getElementById('chat-messages');
      if (el) el.innerHTML = '';
      appState.messages = [];
    },
    newSession: async (label?: string) => {
      appState.currentSessionKey = null;
      if (label) {
        const newId = `session_${Date.now()}`;
        const result = await pawEngine.chatSend({ session_id: newId, message: '', model: '' });
        if (result.session_id) {
          appState.currentSessionKey = result.session_id;
          await pawEngine.sessionRename(appState.currentSessionKey!, label);
        }
      }
    },
    reloadSessions: () => loadSessions({ skipHistory: true }),
    getCurrentModel: () => chatModelSelect?.value || 'default',
  };
}

async function encodeFileAttachments(): Promise<
  Array<{ type: string; mimeType: string; content: string; name?: string }>
> {
  const attachments: Array<{ type: string; mimeType: string; content: string; name?: string }> = [];
  for (const file of appState.pendingAttachments) {
    try {
      const base64 = await fileToBase64(file);
      const mime =
        file.type ||
        (file.name?.match(/\.(txt|md|csv|json|xml|html|css|js|ts|py|rs|sh|yaml|yml|toml|log)$/i)
          ? 'text/plain'
          : 'application/octet-stream');
      attachments.push({
        type: mime.startsWith('image/') ? 'image' : 'file',
        mimeType: mime,
        content: base64,
        name: file.name,
      });
    } catch (e) {
      console.error('[chat] Attachment encode failed:', file.name, e);
    }
  }
  return attachments;
}

function handleSendResult(
  result: {
    sessionKey?: string;
    session_id?: string;
    runId?: string;
    text?: string;
    response?: unknown;
    usage?: unknown;
  },
  ss: StreamState,
  streamKey: string,
): void {
  if (result.runId) ss.runId = result.runId;
  if (result.sessionKey) {
    appState.currentSessionKey = result.sessionKey;
    if (result.sessionKey !== streamKey) {
      appState.activeStreams.delete(streamKey);
      appState.activeStreams.set(result.sessionKey, ss);
    }
    const curAgent = AgentsModule.getCurrentAgent();
    if (curAgent) {
      agentSessionMap.set(curAgent.id, result.sessionKey);
      persistAgentSessionMap();
    }

    const isNewSession = result.sessionKey !== streamKey || streamKey === 'default' || !streamKey;
    const existingSession = appState.sessions.find((s) => s.key === result.sessionKey);
    if (isNewSession || !existingSession?.label) {
      const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
      const msgContent =
        chatInput?.value || appState.messages[appState.messages.length - 1]?.content || '';
      const autoLabel = generateSessionLabel(msgContent);
      pawEngine
        .sessionRename(result.sessionKey, autoLabel)
        .then(() => {
          const s = appState.sessions.find((s2) => s2.key === result.sessionKey);
          if (s) {
            s.label = autoLabel;
            s.displayName = autoLabel;
          }
          renderSessionSelect();
          console.debug('[chat] Auto-labeled session:', autoLabel);
        })
        .catch((e) => console.warn('[chat] Auto-label failed:', e));
    }
  }

  if (result.usage) recordTokenUsage(result.usage as Record<string, unknown>);

  const ackText =
    result.text ??
    (typeof result.response === 'string' ? result.response : null) ??
    extractContent(result.response);
  if (ackText && ss.resolve) {
    appendStreamingDelta(ackText);
    ss.resolve(ackText);
    ss.resolve = null;
  }
}

export async function sendMessage(): Promise<void> {
  const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
  const chatSend = document.getElementById('chat-send') as HTMLButtonElement | null;
  const chatModelSelect = document.getElementById('chat-model-select') as HTMLSelectElement | null;
  let content = chatInput?.value.trim();
  const currentKey = appState.currentSessionKey ?? '';
  if (!content || appState.activeStreams.has(currentKey)) return;

  // Slash command interception
  if (isSlashCommand(content)) {
    const cmdCtx = buildSlashCommandContext(chatModelSelect);
    const result = await interceptSlashCommand(content, cmdCtx);
    if (result.handled) {
      if (chatInput) {
        chatInput.value = '';
        chatInput.style.height = 'auto';
      }
      if (result.systemMessage) cmdCtx.addSystemMessage(result.systemMessage);
      if (result.refreshSessions) loadSessions({ skipHistory: true }).catch(() => {});
      if (result.preventDefault && !result.rewrittenInput) return;
      if (result.rewrittenInput) content = result.rewrittenInput;
    }
  }

  const attachments = await encodeFileAttachments();

  const userMsg: Message = { role: 'user', content, timestamp: new Date() };
  if (attachments.length) {
    userMsg.attachments = attachments.map((a) => ({
      name: a.name ?? 'attachment',
      mimeType: a.mimeType,
      data: a.content,
    }));
  }
  addMessage(userMsg);
  if (chatInput) {
    chatInput.value = '';
    chatInput.style.height = 'auto';
  }
  clearPendingAttachments();
  if (chatSend) chatSend.disabled = true;

  showStreamingMessage();

  const streamKey = appState.currentSessionKey ?? '';
  const ss = appState.activeStreams.get(streamKey);
  if (!ss) {
    console.error('[chat] Stream state missing for key:', streamKey);
    if (chatSend) chatSend.disabled = false;
    return;
  }

  const responsePromise = new Promise<string>((resolve) => {
    ss.resolve = resolve;
    ss.timeout = setTimeout(() => {
      console.warn('[chat] Streaming timeout — auto-finalizing');
      resolve(ss.content || '(Response timed out)');
    }, 600_000);
  });

  try {
    const sessionKey = appState.currentSessionKey ?? 'default';
    const chatOpts: Record<string, unknown> = {};
    const currentAgent = AgentsModule.getCurrentAgent();
    if (currentAgent) {
      if (currentAgent.model && currentAgent.model !== 'default')
        chatOpts.model = currentAgent.model;
      chatOpts.agentProfile = currentAgent;
    }
    if (attachments.length) chatOpts.attachments = attachments;
    const chatModelVal = chatModelSelect?.value;
    if (chatModelVal && chatModelVal !== 'default') chatOpts.model = chatModelVal;
    const slashOverrides = getSlashOverrides();
    if (slashOverrides.model) chatOpts.model = slashOverrides.model;
    if (slashOverrides.thinkingLevel) {
      chatOpts.thinkingLevel = slashOverrides.thinkingLevel;
    } else if (currentAgent?.thinking_level) {
      chatOpts.thinkingLevel = currentAgent.thinking_level;
    }
    if (slashOverrides.temperature !== undefined) chatOpts.temperature = slashOverrides.temperature;

    const result = await engineChatSend(
      sessionKey,
      content,
      chatOpts as {
        model?: string;
        thinkingLevel?: string;
        temperature?: number;
        attachments?: Array<{ type?: string; mimeType: string; content: string }>;
        agentProfile?: Partial<Agent>;
      },
    );
    console.debug('[chat] send ack:', JSON.stringify(result).slice(0, 300));
    handleSendResult(result, ss, streamKey);

    const finalText = await responsePromise;
    if (appState.activeStreams.has(streamKey)) {
      finalizeStreaming(finalText, undefined, streamKey);
    } else {
      console.debug('[chat] Stream already torn down — skipping finalizeStreaming');
    }
    loadSessions({ skipHistory: true }).catch(() => {});
  } catch (error) {
    console.error('[chat] error:', error);
    if (ss?.el && appState.activeStreams.has(streamKey)) {
      const errMsg = error instanceof Error ? error.message : 'Failed to get response';
      finalizeStreaming(ss.content || `Error: ${errMsg}`, undefined, streamKey);
    }
  } finally {
    const finalKey = appState.currentSessionKey ?? streamKey;
    appState.activeStreams.delete(finalKey);
    appState.activeStreams.delete(streamKey);
    if (ss?.timeout) {
      clearTimeout(ss.timeout);
      ss.timeout = null;
    }
    const chatSendBtn = document.getElementById('chat-send') as HTMLButtonElement | null;
    if (chatSendBtn) chatSendBtn.disabled = false;
  }
}

// ── Wire up all chat DOM event listeners ─────────────────────────────────
// Called once from main.ts DOMContentLoaded.

// Talk mode controller (scoped to main chat view)
let _talkMode: ReturnType<typeof createTalkMode> | null = null;

export function initChatListeners(): void {
  const chatSend = document.getElementById('chat-send') as HTMLButtonElement | null;
  const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
  const chatAttachBtn = document.getElementById('chat-attach-btn');
  const chatFileInput = document.getElementById('chat-file-input') as HTMLInputElement | null;
  const chatSessionSelect = document.getElementById(
    'chat-session-select',
  ) as HTMLSelectElement | null;
  const chatAgentSelect = document.getElementById('chat-agent-select') as HTMLSelectElement | null;

  chatSend?.addEventListener('click', sendMessage);

  chatInput?.addEventListener('keydown', (e) => {
    const popup = document.getElementById('slash-autocomplete');
    if (popup && popup.style.display !== 'none') {
      if (e.key === 'Escape') {
        popup.style.display = 'none';
        e.preventDefault();
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        const selected = popup.querySelector('.slash-ac-item.selected') as HTMLElement | null;
        if (selected) {
          e.preventDefault();
          const cmd = selected.dataset.command ?? '';
          if (chatInput) {
            chatInput.value = `${cmd} `;
            chatInput.focus();
          }
          popup.style.display = 'none';
          return;
        }
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = Array.from(popup.querySelectorAll('.slash-ac-item')) as HTMLElement[];
        const cur = items.findIndex((el) => el.classList.contains('selected'));
        items.forEach((el) => el.classList.remove('selected'));
        const next =
          e.key === 'ArrowDown'
            ? (cur + 1) % items.length
            : (cur - 1 + items.length) % items.length;
        items[next]?.classList.add('selected');
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  chatInput?.addEventListener('input', () => {
    if (!chatInput) return;
    chatInput.style.height = 'auto';
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
    const val = chatInput.value;
    let popup = document.getElementById('slash-autocomplete') as HTMLElement | null;
    if (val.startsWith('/') && !val.includes(' ')) {
      const suggestions = getAutocompleteSuggestions(val);
      if (suggestions.length > 0) {
        if (!popup) {
          popup = document.createElement('div');
          popup.id = 'slash-autocomplete';
          popup.className = 'slash-autocomplete-popup';
          chatInput.parentElement?.insertBefore(popup, chatInput);
        }
        popup.innerHTML = suggestions
          .map(
            (s, i) =>
              `<div class="slash-ac-item${i === 0 ? ' selected' : ''}" data-command="${escHtml(s.command)}">
            <span class="slash-ac-cmd">${escHtml(s.command)}</span>
            <span class="slash-ac-desc">${escHtml(s.description)}</span>
          </div>`,
          )
          .join('');
        popup.style.display = 'block';
        popup.querySelectorAll('.slash-ac-item').forEach((item) => {
          item.addEventListener('click', () => {
            const cmd = (item as HTMLElement).dataset.command ?? '';
            if (chatInput) {
              chatInput.value = `${cmd} `;
              chatInput.focus();
            }
            if (popup) popup.style.display = 'none';
          });
        });
      } else if (popup) {
        popup.style.display = 'none';
      }
    } else if (popup) {
      popup.style.display = 'none';
    }
  });

  chatAttachBtn?.addEventListener('click', () => chatFileInput?.click());
  chatFileInput?.addEventListener('change', () => {
    if (!chatFileInput?.files) return;
    for (const file of Array.from(chatFileInput.files)) appState.pendingAttachments.push(file);
    chatFileInput.value = '';
    renderAttachmentPreview();
  });

  chatSessionSelect?.addEventListener('change', () => {
    const key = chatSessionSelect?.value;
    if (!key) return;

    const oldKey = appState.currentSessionKey ?? '';
    if (oldKey !== key) {
      teardownStream(oldKey, 'Session switched');
    }

    appState.currentSessionKey = key;
    const curAgent = AgentsModule.getCurrentAgent();
    if (curAgent) {
      agentSessionMap.set(curAgent.id, key);
      persistAgentSessionMap();
    }
    resetTokenMeter();
    loadChatHistory(key);
  });

  chatAgentSelect?.addEventListener('change', () => {
    const agentId = chatAgentSelect?.value;
    if (agentId) switchToAgent(agentId);
  });

  $('new-chat-btn')?.addEventListener('click', () => {
    const oldKey = appState.currentSessionKey ?? '';
    teardownStream(oldKey, 'New chat');
    appState.messages = [];
    appState.currentSessionKey = null;
    resetTokenMeter();
    renderMessages();
    const chatSessionSelect2 = document.getElementById(
      'chat-session-select',
    ) as HTMLSelectElement | null;
    if (chatSessionSelect2) chatSessionSelect2.value = '';
  });

  $('chat-abort-btn')?.addEventListener('click', async () => {
    const key = appState.currentSessionKey ?? '';
    teardownStream(key, 'Stopped');
    showToast('Agent stopped', 'info');
  });

  $('session-rename-btn')?.addEventListener('click', async () => {
    if (!appState.currentSessionKey || !appState.wsConnected) return;
    const { promptModal } = await import('../../components/helpers');
    const name = await promptModal('Rename session', 'New name…');
    if (!name) return;
    try {
      await pawEngine.sessionRename(appState.currentSessionKey, name);
      showToast('Session renamed', 'success');
      await loadSessions();
    } catch (e) {
      showToast(`Rename failed: ${e instanceof Error ? e.message : e}`, 'error');
    }
  });

  $('session-delete-btn')?.addEventListener('click', async () => {
    if (!appState.currentSessionKey || !appState.wsConnected) return;
    if (!(await confirmModal('Delete this session? This cannot be undone.'))) return;
    try {
      await pawEngine.sessionDelete(appState.currentSessionKey);
      appState.currentSessionKey = null;
      appState.messages = [];
      renderMessages();
      showToast('Session deleted', 'success');
      await loadSessions();
    } catch (e) {
      showToast(`Delete failed: ${e instanceof Error ? e.message : e}`, 'error');
    }
  });

  $('session-clear-btn')?.addEventListener('click', async () => {
    if (!appState.currentSessionKey || !appState.wsConnected) return;
    if (!(await confirmModal('Clear all messages in this session?'))) return;
    try {
      await pawEngine.sessionClear(appState.currentSessionKey);
      appState.messages = [];
      resetTokenMeter();
      renderMessages();
      showToast('Session history cleared', 'success');
    } catch (e) {
      showToast(`Clear failed: ${e instanceof Error ? e.message : e}`, 'error');
    }
  });

  $('session-compact-btn')?.addEventListener('click', async () => {
    if (!appState.wsConnected || !appState.currentSessionKey) return;
    try {
      const result = await pawEngine.sessionCompact(appState.currentSessionKey);
      showToast(
        `Compacted: ${result.messages_before} → ${result.messages_after} messages`,
        'success',
      );
      resetTokenMeter();
      const ba = document.getElementById('session-budget-alert');
      if (ba) ba.style.display = 'none';
      const history = await pawEngine.chatHistory(appState.currentSessionKey, 100);
      appState.messages = history.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        timestamp: new Date(m.created_at),
      }));
      renderMessages();
    } catch (e) {
      showToast(`Compact failed: ${e instanceof Error ? e.message : e}`, 'error');
    }
  });

  $('compaction-warning-dismiss')?.addEventListener('click', () => {
    appState.compactionDismissed = true;
    const warning = document.getElementById('compaction-warning');
    if (warning) warning.style.display = 'none';
  });

  // Talk Mode: use scoped TalkModeController
  _talkMode = createTalkMode(
    () => document.getElementById('chat-input') as HTMLTextAreaElement | null,
    () => document.getElementById('chat-talk-btn'),
  );
  $('chat-talk-btn')?.addEventListener('click', () => _talkMode?.toggle());

  // Context breakdown popover on token meter click
  initContextBreakdownClick();
}

function initContextBreakdownClick(): void {
  const meter = $('token-meter');
  if (!meter) return;
  meter.style.cursor = 'pointer';
  meter.addEventListener('click', (e) => {
    e.stopPropagation();
    getTokenMeter().toggleBreakdown();
    getTokenMeter().updateBreakdownPopover(meterSnapshot());
  });
  document.addEventListener('click', () => {
    const panel = $('context-breakdown-panel');
    if (panel) panel.style.display = 'none';
  });
  const panel = $('context-breakdown-panel');
  if (panel) {
    panel.addEventListener('click', (e) => e.stopPropagation());
  }
}
