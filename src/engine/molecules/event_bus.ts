// src/engine/molecules/event_bus.ts
// Registers the Tauri IPC agent event listener and routes incoming events
// to the correct handler: streaming chat bubbles, research view, or task sessions.
//
// Uses a callback registration pattern so the engine layer never imports
// from the view layer (chat_controller, views/research).  The view layer
// calls registerStreamHandlers() and registerResearchRouter() at startup.

import { onEngineAgent } from './bridge';
import { appState, type StreamState } from '../../state/index';

// ── Callback type definitions ────────────────────────────────────────────────

export interface StreamHandlers {
  onDelta: (text: string) => void;
  onThinking: (text: string) => void;
  onToken: (usage: Record<string, unknown> | undefined) => void;
  onModel: (model: string) => void;
}

export interface ResearchRouter {
  isStreaming: () => boolean;
  getRunId: () => string | null;
  appendDelta: (text: string) => void;
  resolveStream: (text?: string) => void;
}

let _streamHandlers: StreamHandlers | null = null;
let _researchRouter: ResearchRouter | null = null;

/** Register stream handlers (call once from chat_controller at startup). */
export function registerStreamHandlers(h: StreamHandlers): void {
  _streamHandlers = h;
}

/** Register research router (call once from views/research at startup). */
export function registerResearchRouter(r: ResearchRouter): void {
  _researchRouter = r;
}

// ── Session-scoped subscribers (Phase 2) ─────────────────────────────────────
// Mini-hubs subscribe to receive events for their specific sessions.
// The main _streamHandlers still handles the "current" session for the main chat view.

export interface SessionSubscriber {
  /** Handlers for stream events routed to this subscriber */
  handlers: StreamHandlers;
  /** The session key this subscriber is scoped to */
  sessionKey: string;
  /** Epoch ms when the subscriber was registered */
  subscribedAt: number;
  /** Epoch ms of last event received (for stale detection) */
  lastEventAt: number;
}

const _sessionSubscribers = new Map<string, SessionSubscriber>();

/** Max stale duration before auto-unsubscribe (15 minutes) */
const STALE_SUBSCRIBER_MS = 15 * 60 * 1000;
/** Max simultaneous session subscribers */
const MAX_SUBSCRIBERS = 8;

/**
 * Subscribe to stream events for a specific session key.
 * Returns an unsubscribe function that must be called on cleanup.
 *
 * Used by mini-hub instances to receive their own session's events
 * without interfering with the main chat view.
 */
export function subscribeSession(
  sessionKey: string,
  handlers: StreamHandlers,
): () => void {
  // Enforce max subscribers cap
  if (_sessionSubscribers.size >= MAX_SUBSCRIBERS) {
    sweepStaleSubscribers();
    // If still at cap after sweep, evict oldest
    if (_sessionSubscribers.size >= MAX_SUBSCRIBERS) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [key, sub] of _sessionSubscribers) {
        if (sub.subscribedAt < oldestTime) {
          oldestTime = sub.subscribedAt;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        console.debug(`[event_bus] Evicting oldest subscriber: ${oldestKey}`);
        _sessionSubscribers.delete(oldestKey);
      }
    }
  }

  const now = Date.now();
  _sessionSubscribers.set(sessionKey, {
    handlers,
    sessionKey,
    subscribedAt: now,
    lastEventAt: now,
  });

  console.debug(`[event_bus] Session subscribed: ${sessionKey} (total: ${_sessionSubscribers.size})`);

  // Return unsubscribe function
  return () => {
    _sessionSubscribers.delete(sessionKey);
    console.debug(`[event_bus] Session unsubscribed: ${sessionKey} (total: ${_sessionSubscribers.size})`);
  };
}

/**
 * Remove subscribers that haven't received events in STALE_SUBSCRIBER_MS.
 * Called automatically when new subscribers are added at cap.
 */
export function sweepStaleSubscribers(): number {
  const now = Date.now();
  let swept = 0;
  for (const [key, sub] of _sessionSubscribers) {
    if (now - sub.lastEventAt > STALE_SUBSCRIBER_MS) {
      _sessionSubscribers.delete(key);
      swept++;
      console.debug(`[event_bus] Swept stale subscriber: ${key}`);
    }
  }
  return swept;
}

/**
 * Get the number of active session subscribers (for diagnostics).
 */
export function getSubscriberCount(): number {
  return _sessionSubscribers.size;
}

function handleAgentEvent(payload: unknown): void {
  try {
    const evt = payload as Record<string, unknown>;
    const stream = evt.stream as string | undefined;
    const data = evt.data as Record<string, unknown> | undefined;
    const runId = evt.runId as string | undefined;
    const evtSession = evt.sessionKey as string | undefined;

    if (stream !== 'assistant') {
      console.debug(
        `[event_bus] stream=${stream} session=${evtSession} runId=${String(runId).slice(0, 12)} isLoading=${appState.isLoading}`,
      );
    }

    // ── Route research sessions ──
    if (evtSession && evtSession.startsWith('paw-research-')) {
      if (!_researchRouter || !_researchRouter.isStreaming()) return;
      if (_researchRouter.getRunId() && runId && runId !== _researchRouter.getRunId()) return;
      if (stream === 'assistant' && data) {
        const delta = data.delta as string | undefined;
        if (delta) _researchRouter.appendDelta(delta);
      } else if (stream === 'lifecycle' && data) {
        if ((data.phase as string) === 'end') _researchRouter.resolveStream();
      } else if (stream === 'tool' && data) {
        const tool = (data.name ?? data.tool) as string | undefined;
        const phase = data.phase as string | undefined;
        if (phase === 'start' && tool) _researchRouter.appendDelta(`\n\n▶ ${tool}...`);
      } else if (stream === 'error' && data) {
        const error = (data.message ?? data.error ?? '') as string;
        if (error) _researchRouter.appendDelta(`\n\nError: ${error}`);
        _researchRouter.resolveStream();
      }
      return;
    }

    // ── Drop background task events unless the user is viewing that session
    //    OR a mini-hub subscriber is listening ──
    if (
      evtSession &&
      evtSession.startsWith('eng-task-') &&
      evtSession !== appState.currentSessionKey &&
      !_sessionSubscribers.has(evtSession)
    )
      return;

    // ── Drop other paw-* internal sessions ──
    if (evtSession && evtSession.startsWith('paw-')) return;

    // ── Drop channel bridge sessions ──
    if (
      evtSession &&
      (evtSession.startsWith('eng-tg-') ||
        evtSession.startsWith('eng-discord-') ||
        evtSession.startsWith('eng-irc-') ||
        evtSession.startsWith('eng-slack-') ||
        evtSession.startsWith('eng-matrix-'))
    )
      return;

    // ── Guard: only process while streaming is active ──
    // Look up the stream for this event's session (or current session)
    const streamKey = evtSession ?? appState.currentSessionKey ?? '';
    const stream_s: StreamState | undefined = appState.activeStreams.get(streamKey);

    if (!stream_s && !appState.isLoading) return;
    if (stream_s?.runId && runId && runId !== stream_s.runId) return;

    // ── Phase 2: Route to session subscriber if one exists ──
    // Mini-hub subscribers get ALL events for their session (no filtering).
    const subscriber = evtSession ? _sessionSubscribers.get(evtSession) : undefined;
    if (subscriber) {
      subscriber.lastEventAt = Date.now();
      routeToHandlers(subscriber.handlers, stream, data, runId, stream_s);
    }

    // ── Main chat view handler: only process events for the current session ──
    // Allow lifecycle:end and error events through for non-visible sessions
    // so abort/complete can resolve their stream promises even if the user
    // switched away. Only filter out delta/tool events for other sessions.
    const isTerminal = stream === 'lifecycle' || stream === 'error';
    const isCurrentSession = !evtSession || !appState.currentSessionKey || evtSession === appState.currentSessionKey;
    if (!isTerminal && !isCurrentSession) return;

    routeToHandlers(_streamHandlers, stream, data, runId, stream_s);
  } catch (e) {
    console.warn('[event_bus] Handler error:', e);
  }
}

/**
 * Route a parsed event to a set of StreamHandlers.
 * Extracted to avoid duplicating dispatch logic between main chat and mini-hub subscribers.
 */
function routeToHandlers(
  handlers: StreamHandlers | null,
  stream: string | undefined,
  data: Record<string, unknown> | undefined,
  runId: string | undefined,
  stream_s: StreamState | undefined,
): void {
  if (!handlers || !data) return;

  if (stream === 'assistant') {
    const delta = data.delta as string | undefined;
    if (delta) handlers.onDelta(delta);
  } else if (stream === 'thinking') {
    const delta = data.delta as string | undefined;
    if (delta) handlers.onThinking(delta);
  } else if (stream === 'lifecycle') {
    const phase = data.phase as string | undefined;
    if (phase === 'start') {
      if (stream_s && !stream_s.runId && runId) stream_s.runId = runId;
      console.debug(`[event_bus] Agent run started: ${runId}`);
    } else if (phase === 'end') {
      console.debug(
        `[event_bus] Agent run ended: ${runId} chars=${stream_s?.content.length ?? 0}`,
      );
      const dAny = data as Record<string, unknown>;
      const dNested = dAny.response as Record<string, unknown> | undefined;

      // D-3.3: Deduplicate token recording — only fire once per run
      if (stream_s && !stream_s.tokenRecorded) {
        stream_s.tokenRecorded = true;
        // Prefer nested usage over top-level to avoid double-count
        const agentUsage = (dAny.usage ?? dNested?.usage ?? data) as
          | Record<string, unknown>
          | undefined;
        handlers.onToken(agentUsage);
      }

      // Update model selector with API-confirmed model name (main chat only)
      const confirmedModel = dAny.model as string | undefined;
      if (confirmedModel) {
        // Only update the main chat model selector if these are the main handlers
        if (handlers === _streamHandlers) {
          const modelSel = document.getElementById('chat-model-select') as HTMLSelectElement | null;
          if (modelSel) {
            const exists = Array.from(modelSel.options).some((o) => o.value === confirmedModel);
            if (!exists) {
              const opt = document.createElement('option');
              opt.value = confirmedModel;
              opt.textContent = `✓ ${confirmedModel}`;
              modelSel.appendChild(opt);
            }
            if (modelSel.value === 'default' || modelSel.value === '')
              modelSel.value = confirmedModel;
          }
        }
        handlers.onModel(confirmedModel);
      }

      if (stream_s?.resolve) {
        if (stream_s.content) {
          stream_s.resolve(stream_s.content);
          stream_s.resolve = null;
        } else {
          console.debug('[event_bus] No content at lifecycle end — waiting 3s for chat.final...');
          const savedResolve = stream_s.resolve;
          setTimeout(() => {
            if (stream_s.resolve === savedResolve && stream_s.resolve) {
              console.warn('[event_bus] Grace period expired — resolving with empty content');
              stream_s.resolve(stream_s.content || '');
              stream_s.resolve = null;
            }
          }, 3000);
        }
      }
    }
  } else if (stream === 'tool') {
    const tool = (data.name ?? data.tool) as string | undefined;
    const phase = data.phase as string | undefined;
    if (phase === 'start' && tool) {
      console.debug(`[event_bus] Tool: ${tool}`);
      appState.sessionToolCallCount++;
      if (stream_s?.el) handlers.onDelta(`\n\n▶ ${tool}...`);
    } else if (phase === 'end' && data.output) {
      const outputLen = String(data.output).length;
      appState.sessionToolResultTokens += Math.ceil(outputLen / 4) + 4;
    }
  } else if (stream === 'error') {
    const error = (data.message ?? data.error ?? '') as string;
    console.error(`[event_bus] Agent error: ${error}`);
    if (error && stream_s?.el) handlers.onDelta(`\n\nError: ${error}`);
    if (stream_s?.resolve) {
      stream_s.resolve(stream_s.content);
      stream_s.resolve = null;
    }
  }
}

// Register immediately — this module is imported once at startup.
onEngineAgent(handleAgentEvent);
