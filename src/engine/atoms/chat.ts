// src/engine/atoms/chat.ts
// Pure helper functions extracted from chat_controller.ts.
// Zero DOM access, zero side effects, zero state imports.
// Receives data as arguments and returns values — true atoms.

// ── Auto-label helper ────────────────────────────────────────────────────

/** Generate a short label from the user's first message (max 50 chars). */
export function generateSessionLabel(message: string): string {
  // Strip leading slashes, markdown, excessive whitespace
  let label = message
    .replace(/^\/\w+\s*/, '')
    .replace(/[#*_~`>]+/g, '')
    .trim();
  // Collapse whitespace
  label = label.replace(/\s+/g, ' ');
  if (label.length > 50) {
    label = `${label.slice(0, 47).replace(/\s+\S*$/, '')}…`;
  }
  return label || 'New chat';
}

// ── Content extraction ───────────────────────────────────────────────────

/**
 * Normalize content blocks (string | array | object) to a plain string.
 * Handles the various shapes the engine can return.
 */
export function extractContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Record<string, unknown>[])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n');
  }
  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    if (obj.type === 'text' && typeof obj.text === 'string') return obj.text;
  }
  return content == null ? '' : String(content);
}

// ── Generic array utility ────────────────────────────────────────────────

/** Find the last index in an array matching a predicate. Returns -1 if none. */
export function findLastIndex<T>(arr: T[], pred: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
}

// ── MIME / file helpers ──────────────────────────────────────────────────

/** Map a MIME type to an icon name for file display. */
export function fileTypeIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf' || mimeType.startsWith('text/')) return 'file-text';
  return 'file';
}

/** Convert a File to a base64 string (data URI prefix stripped). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ── Number formatting ────────────────────────────────────────────────────

/** Format a number as K/M suffix (e.g. 1500 → "1.5K"). */
export function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;
}

// ── Context breakdown ────────────────────────────────────────────────────

export interface ContextBreakdown {
  total: number;
  limit: number;
  pct: number;
  system: number;
  systemPct: number;
  messages: number;
  messagesPct: number;
  toolResults: number;
  toolResultsPct: number;
  output: number;
  outputPct: number;
}

/**
 * Pure computation: estimate how the context window is used.
 * Receives a snapshot of the relevant state values — no direct state access.
 */
export function estimateContextBreakdown(snapshot: {
  sessionTokensUsed: number;
  modelContextLimit: number;
  sessionInputTokens: number;
  sessionOutputTokens: number;
  sessionToolResultTokens: number;
  messages: Array<{ content?: string }>;
}): ContextBreakdown {
  const total = snapshot.sessionTokensUsed;
  const limit = snapshot.modelContextLimit;
  const pct = limit > 0 ? Math.min((total / limit) * 100, 100) : 0;

  // Estimate message tokens from visible chat messages
  let msgTokens = 0;
  for (const m of snapshot.messages) {
    const contentLen = m.content?.length ?? 0;
    msgTokens += Math.ceil(contentLen / 4) + 4;
  }

  const toolResultTokens = snapshot.sessionToolResultTokens;
  const output = snapshot.sessionOutputTokens;

  // System = input − messages − tool results (what the model sees beyond conversation)
  const inputTokens = snapshot.sessionInputTokens;
  const system = Math.max(0, inputTokens - msgTokens - toolResultTokens);

  const safeDivisor = total > 0 ? total : 1;

  return {
    total,
    limit,
    pct,
    system,
    systemPct: (system / safeDivisor) * 100,
    messages: msgTokens,
    messagesPct: (msgTokens / safeDivisor) * 100,
    toolResults: toolResultTokens,
    toolResultsPct: (toolResultTokens / safeDivisor) * 100,
    output,
    outputPct: (output / safeDivisor) * 100,
  };
}
