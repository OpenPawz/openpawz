/**
 * pawz-client.ts — SSE streaming client for the Pawz webhook /chat/stream endpoint.
 *
 * Connects to a local Pawz Desktop instance (Rust backend) and streams engine
 * events (delta, tool_request, tool_result, complete, error, …) as they arrive.
 */

/** Mirrors the Rust EngineEvent enum exactly (serde tag = "kind"). */
export interface PawzEvent {
  kind:
    | 'delta'
    | 'tool_request'
    | 'tool_result'
    | 'complete'
    | 'error'
    | 'thinking_delta'
    | 'tool_auto_approved'
    | 'canvas_push'
    | 'canvas_update';
  session_id: string;
  run_id: string;
  // delta + thinking_delta
  text?: string;
  // tool_request — ToolCall struct with nested FunctionCall
  tool_call?: {
    id: string;
    type: string;
    function: { name: string; arguments: string };
  };
  tool_tier?: 'safe' | 'reversible' | 'external' | 'dangerous' | 'unknown';
  round_number?: number;
  // tool_result
  tool_call_id?: string;
  output?: string;
  success?: boolean;
  duration_ms?: number;
  // complete
  tool_calls_count?: number;
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  model?: string;
  total_rounds?: number;
  max_rounds?: number;
  // error
  message?: string;
  // tool_auto_approved
  tool_name?: string;
}

export interface PawzChatRequest {
  message: string;
  agent_id?: string;
  /** Extra context injected into the agent system prompt (file, workspace, etc.) */
  context?: string;
  /** Stable user ID — keep consistent across sessions for memory continuity */
  user_id?: string;
}

export class PawzClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authToken: string,
  ) {}

  /**
   * POST /chat/stream — streams PawzEvents via Server-Sent Events.
   * Calls onEvent for each received event until Complete or Error arrives.
   */
  async streamChat(
    req: PawzChatRequest,
    onEvent: (event: PawzEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const url = new URL('/chat/stream', this.baseUrl).toString();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        message: req.message,
        agent_id: req.agent_id ?? 'default',
        user_id: req.user_id ?? 'vscode',
        context: req.context,
      }),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => `HTTP ${response.status}`);
      throw new Error(`Pawz ${response.status}: ${text}`);
    }

    const body = response.body;
    if (!body) {
      throw new Error('Empty response body from Pawz');
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by double newlines
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';

        for (const block of blocks) {
          for (const line of block.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue; // skip keepalives/comments
            if (trimmed.startsWith('data: ')) {
              try {
                const event = JSON.parse(trimmed.slice(6)) as PawzEvent;
                onEvent(event);
              } catch {
                // malformed JSON in SSE frame — skip
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Quick health check — returns true if the webhook server is reachable. */
  async isReachable(): Promise<boolean> {
    try {
      const resp = await fetch(new URL('/webhook/health', this.baseUrl).toString(), {
        signal: AbortSignal.timeout(2000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
