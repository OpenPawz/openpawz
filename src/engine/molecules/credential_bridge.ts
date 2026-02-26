// src/engine/molecules/credential_bridge.ts — Agent credential request handler
//
// Phase 3: Listens for 'credential_required' engine events and shows
// the credential prompt modal. After credentials are saved, optionally
// retries the original agent action.

import {
  showCredentialPrompt,
  buildCredentialRequest,
} from '../../components/molecules/credential-prompt';
import { SERVICE_CATALOG } from '../../views/integrations/catalog';
import { sendMessage } from '../organisms/chat_controller';

// ── Types ──────────────────────────────────────────────────────────────

export interface CredentialRequiredEvent {
  service: string;
  fields?: { key: string; label: string; type: string; placeholder?: string; required: boolean }[];
  helpSteps?: string[];
  retryAction?: string;
  retryPayload?: Record<string, unknown>;
}

// ── Handler ────────────────────────────────────────────────────────────

/**
 * Handle a credential_required event from the engine.
 * Shows the credential prompt modal and optionally retries the action.
 */
export async function handleCredentialRequired(event: CredentialRequiredEvent): Promise<void> {
  const serviceId = event.service;
  const serviceDef = SERVICE_CATALOG.find((s) => s.id === serviceId);

  // Build the credential request from catalog or event data
  const request = serviceDef
    ? buildCredentialRequest(serviceDef)
    : {
        service: serviceId,
        serviceName: serviceId,
        serviceIcon: 'extension',
        serviceColor: '#888',
        fields: (event.fields ?? []).map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type as 'password' | 'url' | 'text',
          placeholder: f.placeholder,
          required: f.required,
        })),
        helpSteps: event.helpSteps,
      };

  if (event.retryAction) {
    request.retryAction = event.retryAction;
    request.retryPayload = event.retryPayload;
  }

  const result = await showCredentialPrompt(request);

  if (result.saved && event.retryAction) {
    // Re-send the original user message to retry the action
    const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
    if (chatInput && event.retryAction) {
      chatInput.value = event.retryAction;
      chatInput.style.height = 'auto';
      sendMessage();
    }
  }
}

/**
 * Known safe retry action prefixes. The retryAction from a credential signal
 * must start with one of these to be accepted. This prevents a prompt-injected
 * AI from smuggling arbitrary commands through the credential flow.
 */
const SAFE_RETRY_PREFIXES = [
  'post to ',
  'send to ',
  'connect to ',
  'check ',
  'list ',
  'fetch ',
  'get ',
  'read ',
  'search ',
  'query ',
];

function isRetryActionSafe(action: string): boolean {
  const lower = action.toLowerCase().trim();
  return SAFE_RETRY_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Check if an assistant message contains a credential request signal.
 * Returns the parsed event if found, null otherwise.
 *
 * Convention: the agent embeds a JSON block tagged with `[CREDENTIAL_REQUIRED]`:
 * ```
 * [CREDENTIAL_REQUIRED]{"service":"slack","retryAction":"post to #general"}
 * ```
 *
 * Security: retryAction is validated against a safe-prefix allowlist to prevent
 * prompt injection from smuggling arbitrary commands through the credential flow.
 */
export function parseCredentialSignal(message: string): CredentialRequiredEvent | null {
  const marker = '[CREDENTIAL_REQUIRED]';
  const idx = message.indexOf(marker);
  if (idx === -1) return null;

  try {
    const jsonStr = message.substring(idx + marker.length).trim();
    // Take only the first line or JSON block
    const end = jsonStr.indexOf('\n');
    const raw = end > 0 ? jsonStr.substring(0, end) : jsonStr;
    const parsed = JSON.parse(raw) as CredentialRequiredEvent;

    // Validate retryAction against safe prefixes
    if (parsed.retryAction && !isRetryActionSafe(parsed.retryAction)) {
      console.warn(
        '[credential_bridge] Blocked unsafe retryAction from credential signal:',
        parsed.retryAction,
      );
      parsed.retryAction = undefined;
      parsed.retryPayload = undefined;
    }

    return parsed;
  } catch {
    return null;
  }
}
