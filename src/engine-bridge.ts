// Paw Engine Bridge
// Translates Tauri engine events into the same shape as gateway 'agent' events,
// and provides a drop-in chatSend replacement for engine mode.

import { pawEngine, type EngineEvent, type EngineChatRequest } from './engine';

type AgentEventHandler = (payload: unknown) => void;

let _engineListening = false;
let _agentHandlers: AgentEventHandler[] = [];

/** Whether the engine mode is active (vs gateway mode). */
export function isEngineMode(): boolean {
  return localStorage.getItem('paw-runtime-mode') === 'engine';
}

/** Set the runtime mode. */
export function setEngineMode(enabled: boolean): void {
  localStorage.setItem('paw-runtime-mode', enabled ? 'engine' : 'gateway');
}

/**
 * Register a handler that receives agent-style events.
 * In engine mode these come from the Rust engine via Tauri IPC.
 * The payload shape matches the gateway's 'agent' event so the existing
 * main.ts handler works unchanged.
 */
export function onEngineAgent(handler: AgentEventHandler): void {
  _agentHandlers.push(handler);
}

/**
 * Start listening for engine events and forward them as gateway-style agent events.
 * Call this once at startup if in engine mode.
 */
export async function startEngineBridge(): Promise<void> {
  if (_engineListening) return;
  _engineListening = true;

  await pawEngine.startListening();

  pawEngine.on('*', (event: EngineEvent) => {
    const gatewayEvt = translateEngineEvent(event);
    if (gatewayEvt) {
      for (const h of _agentHandlers) {
        try { h(gatewayEvt); } catch (e) { console.error('[engine-bridge] handler error:', e); }
      }
    }
  });
}

/**
 * Send a chat message using the engine.
 * Signature intentionally matches the shape of gateway.chatSend.
 */
export async function engineChatSend(
  sessionKey: string,
  content: string,
  opts: {
    model?: string;
    temperature?: number;
    agentProfile?: { systemPrompt?: string; model?: string };
  } = {},
): Promise<{ runId: string; sessionKey: string; status: string }> {

  const request: EngineChatRequest = {
    session_id: (sessionKey === 'default' || !sessionKey) ? undefined : sessionKey,
    message: content,
    model: opts.model ?? opts.agentProfile?.model,
    system_prompt: opts.agentProfile?.systemPrompt,
    temperature: opts.temperature,
    tools_enabled: true,
  };

  const result = await pawEngine.chatSend(request);

  return {
    runId: result.run_id,
    sessionKey: result.session_id,
    status: 'started',
  };
}

/**
 * Translate an EngineEvent into the shape that main.ts agent handler expects:
 *   { stream: 'assistant'|'lifecycle'|'tool'|'error', data: {...}, runId, sessionKey }
 */
function translateEngineEvent(event: EngineEvent): Record<string, unknown> | null {
  switch (event.kind) {
    case 'delta':
      return {
        stream: 'assistant',
        data: { delta: event.text },
        runId: event.run_id,
        sessionKey: event.session_id,
      };

    case 'tool_request':
      return {
        stream: 'tool',
        data: {
          phase: 'start',
          name: event.tool_call?.function?.name ?? 'tool',
          tool: event.tool_call?.function?.name,
        },
        runId: event.run_id,
        sessionKey: event.session_id,
      };

    case 'tool_result':
      return {
        stream: 'tool',
        data: {
          phase: 'end',
          tool_call_id: event.tool_call_id,
          output: event.output,
          success: event.success,
        },
        runId: event.run_id,
        sessionKey: event.session_id,
      };

    case 'complete':
      return {
        stream: 'lifecycle',
        data: { phase: 'end' },
        runId: event.run_id,
        sessionKey: event.session_id,
      };

    case 'error':
      return {
        stream: 'error',
        data: { message: event.message },
        runId: event.run_id,
        sessionKey: event.session_id,
      };

    default:
      return null;
  }
}
