import { describe, it, expect } from 'vitest';
import { isValidSchedule, MORNING_BRIEF_PROMPT } from './atoms';

// ── isValidSchedule ────────────────────────────────────────────────────

describe('isValidSchedule', () => {
  it('accepts "every Xm" format', () => {
    expect(isValidSchedule('every 30m')).toBe(true);
    expect(isValidSchedule('every 5m')).toBe(true);
  });

  it('accepts "every Xh" format', () => {
    expect(isValidSchedule('every 2h')).toBe(true);
  });

  it('accepts "daily HH:MM" format', () => {
    expect(isValidSchedule('daily 08:00')).toBe(true);
    expect(isValidSchedule('daily 23:59')).toBe(true);
  });

  it('rejects invalid formats', () => {
    expect(isValidSchedule('weekly')).toBe(false);
    expect(isValidSchedule('every day')).toBe(false);
    expect(isValidSchedule('daily 8am')).toBe(false);
    expect(isValidSchedule('')).toBe(false);
  });

  it('handles whitespace', () => {
    expect(isValidSchedule('  every 10m  ')).toBe(true);
  });
});

// ── MORNING_BRIEF_PROMPT ───────────────────────────────────────────────

describe('MORNING_BRIEF_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(MORNING_BRIEF_PROMPT.length).toBeGreaterThan(50);
  });

  it('mentions weather, tasks, and news', () => {
    expect(MORNING_BRIEF_PROMPT).toContain('Weather');
    expect(MORNING_BRIEF_PROMPT).toContain('Tasks');
    expect(MORNING_BRIEF_PROMPT).toContain('News');
  });
});
