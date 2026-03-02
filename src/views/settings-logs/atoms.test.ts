import { describe, it, expect } from 'vitest';
import {
  parseLogLine,
  LOG_LEVEL_CLASSES,
  LOG_LEVEL_LABELS,
  LOG_LEVEL_OPTIONS,
  TAIL_POLL_INTERVAL_MS,
  MAX_RENDERED_LINES,
} from './atoms';

// ── parseLogLine ───────────────────────────────────────────────────────────

describe('parseLogLine', () => {
  it('parses a standard INFO log line', () => {
    const result = parseLogLine('[2026-02-21T12:00:00.000Z] [INFO ] [engine] Session started');
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe('2026-02-21T12:00:00.000Z');
    expect(result!.level).toBe('info');
    expect(result!.module).toBe('engine');
    expect(result!.message).toBe('Session started');
  });

  it('parses an ERROR log line', () => {
    const result = parseLogLine(
      '[2026-01-01T00:00:00.000Z] [ERROR] [db] Connection failed {"code":42}',
    );
    expect(result).not.toBeNull();
    expect(result!.level).toBe('error');
    expect(result!.module).toBe('db');
    expect(result!.message).toContain('Connection failed');
  });

  it('parses a DEBUG log line', () => {
    const result = parseLogLine('[2026-03-15T08:30:00.000Z] [DEBUG] [net] Ping sent');
    expect(result).not.toBeNull();
    expect(result!.level).toBe('debug');
  });

  it('parses a WARN log line', () => {
    const result = parseLogLine('[2026-06-01T12:00:00.000Z] [WARN ] [security] Rate limited');
    expect(result).not.toBeNull();
    expect(result!.level).toBe('warn');
  });

  it('returns null for invalid format', () => {
    expect(parseLogLine('just some random text')).toBeNull();
    expect(parseLogLine('')).toBeNull();
    expect(parseLogLine('[timestamp] message')).toBeNull();
  });
});

// ── Constants ──────────────────────────────────────────────────────────────

describe('LOG_LEVEL_CLASSES', () => {
  it('has classes for all levels', () => {
    expect(LOG_LEVEL_CLASSES.debug).toBe('log-level-debug');
    expect(LOG_LEVEL_CLASSES.info).toBe('log-level-info');
    expect(LOG_LEVEL_CLASSES.warn).toBe('log-level-warn');
    expect(LOG_LEVEL_CLASSES.error).toBe('log-level-error');
  });
});

describe('LOG_LEVEL_LABELS', () => {
  it('has short labels', () => {
    expect(LOG_LEVEL_LABELS.debug).toBe('DBG');
    expect(LOG_LEVEL_LABELS.info).toBe('INF');
    expect(LOG_LEVEL_LABELS.warn).toBe('WRN');
    expect(LOG_LEVEL_LABELS.error).toBe('ERR');
  });
});

describe('LOG_LEVEL_OPTIONS', () => {
  it('has 5 options (All + 4 levels)', () => {
    expect(LOG_LEVEL_OPTIONS).toHaveLength(5);
  });

  it('first option is "All levels"', () => {
    expect(LOG_LEVEL_OPTIONS[0].value).toBe('');
    expect(LOG_LEVEL_OPTIONS[0].label).toBe('All levels');
  });
});

describe('settings-logs constants', () => {
  it('TAIL_POLL_INTERVAL_MS is reasonable', () => {
    expect(TAIL_POLL_INTERVAL_MS).toBeGreaterThan(500);
    expect(TAIL_POLL_INTERVAL_MS).toBeLessThan(10000);
  });

  it('MAX_RENDERED_LINES is a reasonable limit', () => {
    expect(MAX_RENDERED_LINES).toBeGreaterThan(100);
    expect(MAX_RENDERED_LINES).toBeLessThanOrEqual(10000);
  });
});
