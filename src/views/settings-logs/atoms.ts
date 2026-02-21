// Settings: Logs — Pure data constants (no DOM, no IPC)

import type { LogLevel } from '../../logger';

/** CSS class suffix per log level for color-coding. */
export const LOG_LEVEL_CLASSES: Record<LogLevel, string> = {
  debug: 'log-level-debug',
  info: 'log-level-info',
  warn: 'log-level-warn',
  error: 'log-level-error',
};

/** Badge labels. */
export const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
};

/** All selectable log levels for the filter dropdown. */
export const LOG_LEVEL_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All levels' },
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

/** Tail-follow polling interval (ms). */
export const TAIL_POLL_INTERVAL_MS = 2000;

/** Max lines to render at once (performance guard). */
export const MAX_RENDERED_LINES = 1000;

/**
 * Parse a formatted log line back into components.
 * Expected format: `[2026-02-21T12:00:00.000Z] [INFO ] [module] message {data}`
 */
export function parseLogLine(
  line: string,
): { timestamp: string; level: LogLevel; module: string; message: string } | null {
  const m = line.match(/^\[([^\]]+)\]\s+\[(DEBUG|INFO|WARN|ERROR)\s*\]\s+\[([^\]]*)\]\s+(.*)/i);
  if (!m) return null;
  return {
    timestamp: m[1],
    level: m[2].trim().toLowerCase() as LogLevel,
    module: m[3],
    message: m[4],
  };
}
