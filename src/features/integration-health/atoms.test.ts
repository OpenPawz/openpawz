import { describe, it, expect } from 'vitest';
import {
  statusIcon,
  statusColor,
  statusLabel,
  computeHealthSummary,
  deriveHealthStatus,
  daysUntilExpiry,
  generateSuggestions,
} from './atoms';
import type { ServiceHealth } from './atoms';

// ── statusIcon ─────────────────────────────────────────────────────────

describe('statusIcon', () => {
  it('returns check_circle for healthy', () => {
    expect(statusIcon('healthy')).toBe('check_circle');
  });

  it('returns warning for degraded', () => {
    expect(statusIcon('degraded')).toBe('warning');
  });

  it('returns error for error', () => {
    expect(statusIcon('error')).toBe('error');
  });

  it('returns lock_clock for expired', () => {
    expect(statusIcon('expired')).toBe('lock_clock');
  });

  it('returns help for unknown', () => {
    expect(statusIcon('unknown')).toBe('help');
  });
});

// ── statusColor ────────────────────────────────────────────────────────

describe('statusColor', () => {
  it('returns success color for healthy', () => {
    expect(statusColor('healthy')).toContain('#22c55e');
  });

  it('returns warning color for degraded', () => {
    expect(statusColor('degraded')).toContain('#f59e0b');
  });

  it('returns danger color for error', () => {
    expect(statusColor('error')).toContain('#ef4444');
  });

  it('returns danger color for expired', () => {
    expect(statusColor('expired')).toContain('#ef4444');
  });

  it('returns secondary for unknown', () => {
    expect(statusColor('unknown')).toContain('text-secondary');
  });
});

// ── statusLabel ────────────────────────────────────────────────────────

describe('statusLabel', () => {
  it('returns Connected for healthy', () => {
    expect(statusLabel('healthy')).toBe('Connected');
  });

  it('returns Degraded for degraded', () => {
    expect(statusLabel('degraded')).toBe('Degraded');
  });

  it('returns Error for error', () => {
    expect(statusLabel('error')).toBe('Error');
  });

  it('returns Token Expired for expired', () => {
    expect(statusLabel('expired')).toBe('Token Expired');
  });

  it('returns Unknown for unknown', () => {
    expect(statusLabel('unknown')).toBe('Unknown');
  });
});

// ── computeHealthSummary ───────────────────────────────────────────────

describe('computeHealthSummary', () => {
  const base: ServiceHealth = {
    service: 'test',
    serviceName: 'Test',
    icon: 'test',
    status: 'healthy',
    lastChecked: new Date().toISOString(),
    recentFailures: 0,
    todayActions: 5,
  };

  it('counts all healthy', () => {
    const services = [
      { ...base, service: 'a' },
      { ...base, service: 'b' },
    ];
    const summary = computeHealthSummary(services);
    expect(summary.total).toBe(2);
    expect(summary.healthy).toBe(2);
    expect(summary.degraded).toBe(0);
    expect(summary.error).toBe(0);
    expect(summary.expired).toBe(0);
    expect(summary.needsAttention).toHaveLength(0);
  });

  it('counts mixed statuses', () => {
    const services: ServiceHealth[] = [
      { ...base, service: 'a', status: 'healthy' },
      { ...base, service: 'b', status: 'degraded' },
      { ...base, service: 'c', status: 'error' },
      { ...base, service: 'd', status: 'expired' },
      { ...base, service: 'e', status: 'unknown' },
    ];
    const summary = computeHealthSummary(services);
    expect(summary.total).toBe(5);
    expect(summary.healthy).toBe(1);
    expect(summary.degraded).toBe(1);
    expect(summary.error).toBe(1);
    expect(summary.expired).toBe(1);
  });

  it('adds degraded/error/expired to needsAttention', () => {
    const services: ServiceHealth[] = [
      { ...base, service: 'a', status: 'healthy' },
      { ...base, service: 'b', status: 'degraded' },
      { ...base, service: 'c', status: 'error' },
    ];
    const summary = computeHealthSummary(services);
    expect(summary.needsAttention).toHaveLength(2);
    expect(summary.needsAttention.map((s) => s.service)).toContain('b');
    expect(summary.needsAttention.map((s) => s.service)).toContain('c');
  });

  it('handles empty array', () => {
    const summary = computeHealthSummary([]);
    expect(summary.total).toBe(0);
    expect(summary.healthy).toBe(0);
    expect(summary.needsAttention).toHaveLength(0);
  });
});

// ── deriveHealthStatus ─────────────────────────────────────────────────

describe('deriveHealthStatus', () => {
  it('returns unknown when no credentials', () => {
    expect(deriveHealthStatus(undefined, 0, false)).toBe('unknown');
  });

  it('returns expired when token is past', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(deriveHealthStatus(past, 0, true)).toBe('expired');
  });

  it('returns degraded when token expires within 7 days', () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString(); // 3 days
    expect(deriveHealthStatus(soon, 0, true)).toBe('degraded');
  });

  it('returns healthy when token is far from expiry and no failures', () => {
    const far = new Date(Date.now() + 30 * 86_400_000).toISOString(); // 30 days
    expect(deriveHealthStatus(far, 0, true)).toBe('healthy');
  });

  it('returns error when 3+ recent failures', () => {
    expect(deriveHealthStatus(undefined, 3, true)).toBe('error');
  });

  it('returns degraded when 1-2 recent failures', () => {
    expect(deriveHealthStatus(undefined, 1, true)).toBe('degraded');
    expect(deriveHealthStatus(undefined, 2, true)).toBe('degraded');
  });

  it('returns healthy when no issues', () => {
    expect(deriveHealthStatus(undefined, 0, true)).toBe('healthy');
  });

  it('token expiry takes priority over failures', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(deriveHealthStatus(past, 0, true)).toBe('expired');
  });
});

// ── daysUntilExpiry ────────────────────────────────────────────────────

describe('daysUntilExpiry', () => {
  it('returns positive days for future expiry', () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const days = daysUntilExpiry(future);
    expect(days).toBeGreaterThanOrEqual(9);
    expect(days).toBeLessThanOrEqual(10);
  });

  it('returns negative days for past expiry', () => {
    const past = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const days = daysUntilExpiry(past);
    expect(days).toBeLessThan(0);
  });

  it('returns 0 for today', () => {
    const today = new Date(Date.now() + 1000).toISOString(); // 1 second ahead
    expect(daysUntilExpiry(today)).toBe(0);
  });
});

// ── generateSuggestions ────────────────────────────────────────────────

describe('generateSuggestions', () => {
  it('returns gmail suggestion when connected', () => {
    const suggestions = generateSuggestions(['gmail']);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].service).toBe('gmail');
    expect(suggestions[0].id).toBe('suggest-gmail');
  });

  it('returns multiple suggestions for multiple services', () => {
    const suggestions = generateSuggestions(['gmail', 'slack', 'github']);
    expect(suggestions).toHaveLength(3);
  });

  it('caps at 3 suggestions even with more services', () => {
    const suggestions = generateSuggestions([
      'gmail',
      'slack',
      'github',
      'hubspot',
      'trello',
      'jira',
    ]);
    expect(suggestions).toHaveLength(3);
  });

  it('returns empty for unknown services', () => {
    const suggestions = generateSuggestions(['totally_unknown_service']);
    expect(suggestions).toHaveLength(0);
  });

  it('returns empty for no services', () => {
    expect(generateSuggestions([])).toHaveLength(0);
  });

  it('includes correct action labels', () => {
    const suggestions = generateSuggestions(['slack']);
    expect(suggestions[0].actionLabel).toBe('Check Slack');
  });
});
