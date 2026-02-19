// src/engine/molecules/event_bus.ts
// Registers the Tauri IPC agent event listener and routes incoming events
// to the correct handler: streaming chat bubbles, research view, or task sessions.
//
// This module is side-effectful on import — it calls onEngineAgent() once.

import { onEngineAgent } from '../../engine-bridge';
import { appState } from '../../state/index';
import {
  appendStreamingDelta,
  recordTokenUsage,
  updateContextLimitFromModel,
} from '../organisms/chat_controller';
import * as ResearchModule from '../../views/research';

function handleAgentEvent(payload: unknown): void {
  try {
    const evt       = payload as Record<string, unknown>;
    const stream    = evt.stream    as string | undefined;
    const data      = evt.data      as Record<string, unknown> | undefined;
    const runId     = evt.runId     as string | undefined;
    const evtSession = evt.sessionKey as string | undefined;

    if (stream !== 'assistant') {
      console.log(`[event_bus] stream=${stream} session=${evtSession} runId=${String(runId).slice(0, 12)} isLoading=${appState.isLoading}`);
    }

    // ── Route research sessions ──
    if (evtSession && evtSession.startsWith('paw-research-')) {
      if (!ResearchModule.isStreaming()) return;
      if (ResearchModule.getRunId() && runId && runId !== ResearchModule.getRunId()) return;
      if (stream === 'assistant' && data) {
        const delta = data.delta as string | undefined;
        if (delta) ResearchModule.appendDelta(delta);
      } else if (stream === 'lifecycle' && data) {
        if ((data.phase as string) === 'end') ResearchModule.resolveStream();
      } else if (stream === 'tool' && data) {
        const tool  = (data.name  ?? data.tool)  as string | undefined;
        const phase = data.phase as string | undefined;
        if (phase === 'start' && tool) ResearchModule.appendDelta(`\n\n▶ ${tool}...`);
      } else if (stream === 'error' && data) {
        const error = (data.message ?? data.error ?? '') as string;
        if (error) ResearchModule.appendDelta(`\n\nError: ${error}`);
        ResearchModule.resolveStream();
      }
      return;
    }

    // ── Drop background task events unless the user is viewing that session ──
    if (evtSession && evtSession.startsWith('eng-task-') && evtSession !== appState.currentSessionKey) return;

    // ── Drop other paw-* internal sessions ──
    if (evtSession && evtSession.startsWith('paw-')) return;

    // ── Drop channel bridge sessions ──
    if (evtSession && (
      evtSession.startsWith('eng-tg-') || evtSession.startsWith('eng-discord-') ||
      evtSession.startsWith('eng-irc-') || evtSession.startsWith('eng-slack-')  ||
      evtSession.startsWith('eng-matrix-')
    )) return;

    // ── Guard: only process while streaming is active ──
    if (!appState.isLoading && !appState.streamingEl) return;
    if (appState.streamingRunId && runId && runId !== appState.streamingRunId) return;
    if (evtSession && appState.currentSessionKey && evtSession !== appState.currentSessionKey) return;

    if (stream === 'assistant' && data) {
      const delta = data.delta as string | undefined;
      if (delta) appendStreamingDelta(delta);

    } else if (stream === 'lifecycle' && data) {
      const phase = data.phase as string | undefined;
      if (phase === 'start') {
        if (!appState.streamingRunId && runId) appState.streamingRunId = runId;
        console.log(`[event_bus] Agent run started: ${runId}`);
      } else if (phase === 'end') {
        console.log(`[event_bus] Agent run ended: ${runId} chars=${appState.streamingContent.length}`);
        const dAny    = data as Record<string, unknown>;
        const dNested = (dAny.response as Record<string, unknown> | undefined);
        const agentUsage = (dAny.usage ?? dNested?.usage ?? data) as Record<string, unknown> | undefined;
        recordTokenUsage(agentUsage);
        const evtUsage = (evt as Record<string, unknown>).usage as Record<string, unknown> | undefined;
        if (evtUsage) recordTokenUsage(evtUsage);

        // Update model selector with API-confirmed model name
        const confirmedModel = dAny.model as string | undefined;
        if (confirmedModel) {
          const modelSel = document.getElementById('chat-model-select') as HTMLSelectElement | null;
          if (modelSel) {
            const exists = Array.from(modelSel.options).some(o => o.value === confirmedModel);
            if (!exists) {
              const opt = document.createElement('option');
              opt.value = confirmedModel;
              opt.textContent = `✓ ${confirmedModel}`;
              modelSel.appendChild(opt);
            }
            if (modelSel.value === 'default' || modelSel.value === '') modelSel.value = confirmedModel;
          }
          updateContextLimitFromModel(confirmedModel);
        }

        if (appState.streamingResolve) {
          if (appState.streamingContent) {
            appState.streamingResolve(appState.streamingContent);
            appState.streamingResolve = null;
          } else {
            console.log('[event_bus] No content at lifecycle end — waiting 3s for chat.final...');
            const savedResolve = appState.streamingResolve;
            setTimeout(() => {
              if (appState.streamingResolve === savedResolve && appState.streamingResolve) {
                console.warn('[event_bus] Grace period expired — resolving with empty content');
                appState.streamingResolve(appState.streamingContent || '');
                appState.streamingResolve = null;
              }
            }, 3000);
          }
        }
      }

    } else if (stream === 'tool' && data) {
      const tool  = (data.name ?? data.tool) as string | undefined;
      const phase = data.phase as string | undefined;
      if (phase === 'start' && tool) {
        console.log(`[event_bus] Tool: ${tool}`);
        if (appState.streamingEl) appendStreamingDelta(`\n\n▶ ${tool}...`);
      }

    } else if (stream === 'error' && data) {
      const error = (data.message ?? data.error ?? '') as string;
      console.error(`[event_bus] Agent error: ${error}`);
      if (error && appState.streamingEl) appendStreamingDelta(`\n\nError: ${error}`);
      if (appState.streamingResolve) {
        appState.streamingResolve(appState.streamingContent);
        appState.streamingResolve = null;
      }
    }
  } catch (e) {
    console.warn('[event_bus] Handler error:', e);
  }
}

// Register immediately — this module is imported once at startup.
onEngineAgent(handleAgentEvent);
