import { describe, it, expect } from 'vitest';
import { nextCronFire, validateCron, describeCron, CRON_PRESETS } from './cron-atoms';

// ── nextCronFire ───────────────────────────────────────────────────────────

describe('nextCronFire', () => {
  it('finds next fire for "every minute"', () => {
    const now = new Date('2025-06-15T10:00:00Z');
    const result = nextCronFire('* * * * *', now);
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBe(new Date('2025-06-15T10:01:00Z').getTime());
  });

  it('finds next fire for "every 5 minutes"', () => {
    const now = new Date('2025-06-15T10:02:00Z');
    const result = nextCronFire('*/5 * * * *', now);
    expect(result).not.toBeNull();
    expect(result!.getMinutes() % 5).toBe(0);
  });

  it('finds next fire for "daily at midnight"', () => {
    const now = new Date('2025-06-15T10:00:00Z');
    const result = nextCronFire('0 0 * * *', now);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(0);
    expect(result!.getMinutes()).toBe(0);
    // Should be the next day
    expect(result!.getDate()).toBe(16);
  });

  it('finds next fire for "every hour"', () => {
    const now = new Date('2025-06-15T10:30:00Z');
    const result = nextCronFire('0 * * * *', now);
    expect(result).not.toBeNull();
    expect(result!.getMinutes()).toBe(0);
    // Next hour after :30 — exact hour depends on local timezone
    expect(result!.getTime()).toBeGreaterThan(now.getTime());
  });

  it('handles day-of-week (weekdays only)', () => {
    // June 15 2025 is a Sunday → next weekday is Monday June 16
    const now = new Date('2025-06-15T10:00:00Z');
    const result = nextCronFire('0 9 * * 1-5', now);
    expect(result).not.toBeNull();
    const dow = result!.getDay();
    expect(dow).toBeGreaterThanOrEqual(1);
    expect(dow).toBeLessThanOrEqual(5);
  });

  it('handles specific month', () => {
    // Only fires in December
    const now = new Date('2025-06-15T10:00:00Z');
    const result = nextCronFire('0 0 1 12 *', now);
    expect(result).not.toBeNull();
    expect(result!.getMonth()).toBe(11); // December = 11 (0-indexed)
  });

  it('handles comma-separated list', () => {
    const now = new Date('2025-06-15T10:00:00Z');
    const result = nextCronFire('0,30 * * * *', now);
    expect(result).not.toBeNull();
    expect([0, 30]).toContain(result!.getMinutes());
  });

  it('returns null for invalid expression (wrong field count)', () => {
    expect(nextCronFire('* * *')).toBeNull();
    expect(nextCronFire('* * * * * *')).toBeNull();
  });

  it('returns a date in the future from now', () => {
    const result = nextCronFire('* * * * *');
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBeGreaterThan(Date.now());
  });
});

// ── validateCron ───────────────────────────────────────────────────────────

describe('validateCron', () => {
  it('accepts valid expressions', () => {
    expect(validateCron('* * * * *')).toBeNull();
    expect(validateCron('*/5 * * * *')).toBeNull();
    expect(validateCron('0 9 * * 1-5')).toBeNull();
    expect(validateCron('0 0 1 * *')).toBeNull();
    expect(validateCron('0,30 * * * *')).toBeNull();
  });

  it('rejects expression with wrong field count', () => {
    expect(validateCron('* * *')).toContain('5 fields');
    expect(validateCron('* * * * * *')).toContain('5 fields');
  });

  it('rejects invalid field values', () => {
    expect(validateCron('abc * * * *')).toContain('minute');
    expect(validateCron('* * * * @')).toContain('weekday');
  });

  it('accepts all preset expressions', () => {
    for (const preset of CRON_PRESETS) {
      expect(validateCron(preset.value)).toBeNull();
    }
  });
});

// ── describeCron ───────────────────────────────────────────────────────────

describe('describeCron', () => {
  it('returns description for known presets', () => {
    expect(describeCron('* * * * *')).toBe('Runs every 60 seconds');
    expect(describeCron('0 0 * * *')).toBe('Runs once a day at 00:00');
    expect(describeCron('0 9 * * 1-5')).toBe('Mon–Fri at 09:00');
  });

  it('returns generic for unknown expressions', () => {
    expect(describeCron('15 3 * * *')).toBe('Schedule: 15 3 * * *');
  });
});

// ── CRON_PRESETS ───────────────────────────────────────────────────────────

describe('CRON_PRESETS', () => {
  it('has at least 5 presets', () => {
    expect(CRON_PRESETS.length).toBeGreaterThanOrEqual(5);
  });

  it('each preset has label, value, and description', () => {
    for (const preset of CRON_PRESETS) {
      expect(preset.label).toBeTruthy();
      expect(preset.value).toBeTruthy();
      expect(preset.description).toBeTruthy();
    }
  });

  it('all preset values are valid cron expressions', () => {
    for (const preset of CRON_PRESETS) {
      expect(validateCron(preset.value)).toBeNull();
    }
  });
});
