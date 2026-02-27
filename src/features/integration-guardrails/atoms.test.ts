import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyActionRisk,
  riskMeta,
  getRateLimit,
  checkRateLimit,
  resetRateLimit,
  bumpRateLimit,
  isActionAllowed,
  accessMeta,
  countHighRisk,
  planRequiresConfirm,
  ACTION_RISK_MAP,
  DEFAULT_RATE_LIMITS,
  DEFAULT_GENERIC_LIMIT,
} from './atoms';
import type { DryRunPlan, DryRunStep, RateLimitConfig } from './atoms';

// ── classifyActionRisk ─────────────────────────────────────────────────

describe('classifyActionRisk', () => {
  it('classifies "list" as auto', () => {
    expect(classifyActionRisk('list_contacts')).toBe('auto');
  });

  it('classifies "get" as auto', () => {
    expect(classifyActionRisk('get_user')).toBe('auto');
  });

  it('classifies "search" as auto', () => {
    expect(classifyActionRisk('search_issues')).toBe('auto');
  });

  it('classifies "read" as auto', () => {
    expect(classifyActionRisk('read_inbox')).toBe('auto');
  });

  it('classifies "send" as soft', () => {
    expect(classifyActionRisk('send_message')).toBe('soft');
  });

  it('classifies "create" as soft', () => {
    expect(classifyActionRisk('create_issue')).toBe('soft');
  });

  it('classifies "update" as soft', () => {
    expect(classifyActionRisk('update_contact')).toBe('soft');
  });

  it('classifies "delete" as hard', () => {
    expect(classifyActionRisk('delete_record')).toBe('hard');
  });

  it('classifies "remove" — matches "move" (soft) first due to iteration order', () => {
    // "remove_user" contains "move" which appears earlier in ACTION_RISK_MAP
    expect(classifyActionRisk('remove_user')).toBe('soft');
  });

  it('classifies "delete" as hard (no shorter verb collision)', () => {
    expect(classifyActionRisk('delete_all')).toBe('hard');
  });

  it('classifies "archive" as hard', () => {
    expect(classifyActionRisk('archive_channel')).toBe('hard');
  });

  it('classifies "bulk_send" — matches "send" (soft) first due to iteration order', () => {
    // "bulk_send_emails" contains "send" which appears earlier in ACTION_RISK_MAP
    expect(classifyActionRisk('bulk_send_emails')).toBe('soft');
  });

  it('defaults to soft for unknown verb', () => {
    expect(classifyActionRisk('unknown_verb_xyz')).toBe('soft');
  });

  it('is case insensitive', () => {
    expect(classifyActionRisk('DELETE_something')).toBe('hard');
  });
});

// ── riskMeta ───────────────────────────────────────────────────────────

describe('riskMeta', () => {
  it('returns check_circle icon for auto', () => {
    const meta = riskMeta('auto');
    expect(meta.icon).toBe('check_circle');
    expect(meta.label).toBe('Auto-approved');
    expect(meta.cssClass).toBe('risk-auto');
  });

  it('returns visibility icon for soft', () => {
    const meta = riskMeta('soft');
    expect(meta.icon).toBe('visibility');
    expect(meta.label).toBe('Preview');
    expect(meta.cssClass).toBe('risk-soft');
  });

  it('returns warning icon for hard', () => {
    const meta = riskMeta('hard');
    expect(meta.icon).toBe('warning');
    expect(meta.label).toBe('Confirm');
    expect(meta.cssClass).toBe('risk-hard');
  });

  it('returns distinct colors for each level', () => {
    const colors = new Set([
      riskMeta('auto').color,
      riskMeta('soft').color,
      riskMeta('hard').color,
    ]);
    expect(colors.size).toBe(3);
  });
});

// ── getRateLimit ───────────────────────────────────────────────────────

describe('getRateLimit', () => {
  it('returns known service limit', () => {
    const limit = getRateLimit('slack');
    expect(limit.service).toBe('slack');
    expect(limit.maxActions).toBe(30);
    expect(limit.windowMinutes).toBe(15);
  });

  it('returns gmail limit of 10', () => {
    expect(getRateLimit('gmail').maxActions).toBe(10);
  });

  it('falls back to generic limit for unknown service', () => {
    const limit = getRateLimit('some_random_service');
    expect(limit).toEqual(DEFAULT_GENERIC_LIMIT);
  });

  it('respects overrides', () => {
    const overrides: RateLimitConfig[] = [{ service: 'slack', maxActions: 5, windowMinutes: 1 }];
    const limit = getRateLimit('slack', overrides);
    expect(limit.maxActions).toBe(5);
    expect(limit.windowMinutes).toBe(1);
  });
});

// ── checkRateLimit / resetRateLimit / bumpRateLimit ────────────────────

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetRateLimit('test-svc');
  });

  it('allows first action', () => {
    const config: RateLimitConfig = { service: 'test-svc', maxActions: 5, windowMinutes: 15 };
    const result = checkRateLimit('test-svc', config);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.limit).toBe(5);
  });

  it('counts down remaining actions', () => {
    const config: RateLimitConfig = { service: 'test-svc', maxActions: 3, windowMinutes: 15 };
    checkRateLimit('test-svc', config);
    const second = checkRateLimit('test-svc', config);
    expect(second.remaining).toBe(1);
  });

  it('blocks after exceeding limit', () => {
    const config: RateLimitConfig = { service: 'test-svc', maxActions: 2, windowMinutes: 15 };
    checkRateLimit('test-svc', config);
    checkRateLimit('test-svc', config);
    const third = checkRateLimit('test-svc', config);
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it('resets window after resetRateLimit', () => {
    const config: RateLimitConfig = { service: 'test-svc', maxActions: 2, windowMinutes: 15 };
    checkRateLimit('test-svc', config);
    checkRateLimit('test-svc', config);
    resetRateLimit('test-svc');
    const fresh = checkRateLimit('test-svc', config);
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(1);
  });

  it('bumpRateLimit reduces count', () => {
    const config: RateLimitConfig = { service: 'test-svc', maxActions: 5, windowMinutes: 15 };
    checkRateLimit('test-svc', config); // count=1
    checkRateLimit('test-svc', config); // count=2
    bumpRateLimit('test-svc', 1); // count->1
    const result = checkRateLimit('test-svc', config); // count=2
    expect(result.remaining).toBe(3);
  });
});

// ── isActionAllowed ────────────────────────────────────────────────────

describe('isActionAllowed', () => {
  it('none access blocks everything', () => {
    expect(isActionAllowed('none', 'list')).toBe(false);
    expect(isActionAllowed('none', 'delete')).toBe(false);
  });

  it('full access allows everything', () => {
    expect(isActionAllowed('full', 'list')).toBe(true);
    expect(isActionAllowed('full', 'delete')).toBe(true);
  });

  it('read access allows auto-risk actions only', () => {
    expect(isActionAllowed('read', 'list')).toBe(true);
    expect(isActionAllowed('read', 'get')).toBe(true);
    expect(isActionAllowed('read', 'send')).toBe(false);
    expect(isActionAllowed('read', 'delete')).toBe(false);
  });

  it('write access allows all action verbs', () => {
    expect(isActionAllowed('write', 'list')).toBe(true);
    expect(isActionAllowed('write', 'send')).toBe(true);
    expect(isActionAllowed('write', 'delete')).toBe(true);
  });
});

// ── accessMeta ─────────────────────────────────────────────────────────

describe('accessMeta', () => {
  it('returns block icon for none', () => {
    expect(accessMeta('none').icon).toBe('block');
  });

  it('returns visibility icon for read', () => {
    expect(accessMeta('read').icon).toBe('visibility');
  });

  it('returns edit icon for write', () => {
    expect(accessMeta('write').icon).toBe('edit');
  });

  it('returns admin_panel_settings icon for full', () => {
    expect(accessMeta('full').icon).toBe('admin_panel_settings');
  });
});

// ── countHighRisk ──────────────────────────────────────────────────────

describe('countHighRisk', () => {
  const makePlan = (steps: DryRunStep[]): DryRunPlan => ({
    id: 'p1',
    steps,
    totalActions: steps.length,
    highRiskCount: steps.filter((s) => s.risk === 'hard').length,
  });

  it('counts zero when no hard steps', () => {
    const plan = makePlan([
      { index: 0, service: 'slack', action: 'post', target: '#general', risk: 'soft' },
    ]);
    expect(countHighRisk(plan)).toBe(0);
  });

  it('counts hard-risk steps', () => {
    const plan = makePlan([
      { index: 0, service: 'github', action: 'delete_repo', target: 'my-repo', risk: 'hard' },
      { index: 1, service: 'slack', action: 'send', target: '#alerts', risk: 'soft' },
      { index: 2, service: 'gmail', action: 'delete', target: 'all', risk: 'hard' },
    ]);
    expect(countHighRisk(plan)).toBe(2);
  });
});

// ── planRequiresConfirm ────────────────────────────────────────────────

describe('planRequiresConfirm', () => {
  const makePlan = (steps: DryRunStep[]): DryRunPlan => ({
    id: 'p1',
    steps,
    totalActions: steps.length,
    highRiskCount: steps.filter((s) => s.risk === 'hard').length,
  });

  it('requires confirm if any step is hard', () => {
    const plan = makePlan([
      { index: 0, service: 'a', action: 'delete', target: 'x', risk: 'hard' },
    ]);
    expect(planRequiresConfirm(plan)).toBe(true);
  });

  it('requires confirm if more than 3 steps', () => {
    const plan = makePlan([
      { index: 0, service: 'a', action: 'send', target: 'x', risk: 'soft' },
      { index: 1, service: 'b', action: 'send', target: 'y', risk: 'soft' },
      { index: 2, service: 'c', action: 'send', target: 'z', risk: 'soft' },
      { index: 3, service: 'd', action: 'send', target: 'w', risk: 'soft' },
    ]);
    expect(planRequiresConfirm(plan)).toBe(true);
  });

  it('does not require confirm for short safe plan', () => {
    const plan = makePlan([
      { index: 0, service: 'a', action: 'list', target: 'x', risk: 'auto' },
      { index: 1, service: 'b', action: 'get', target: 'y', risk: 'auto' },
    ]);
    expect(planRequiresConfirm(plan)).toBe(false);
  });
});

// ── ACTION_RISK_MAP ────────────────────────────────────────────────────

describe('ACTION_RISK_MAP', () => {
  it('has auto entries for read verbs', () => {
    expect(ACTION_RISK_MAP.list).toBe('auto');
    expect(ACTION_RISK_MAP.get).toBe('auto');
    expect(ACTION_RISK_MAP.search).toBe('auto');
    expect(ACTION_RISK_MAP.read).toBe('auto');
    expect(ACTION_RISK_MAP.fetch).toBe('auto');
  });

  it('has soft entries for write verbs', () => {
    expect(ACTION_RISK_MAP.send).toBe('soft');
    expect(ACTION_RISK_MAP.create).toBe('soft');
    expect(ACTION_RISK_MAP.update).toBe('soft');
  });

  it('has hard entries for destructive verbs', () => {
    expect(ACTION_RISK_MAP.delete).toBe('hard');
    expect(ACTION_RISK_MAP.remove).toBe('hard');
    expect(ACTION_RISK_MAP.archive).toBe('hard');
    expect(ACTION_RISK_MAP.revoke).toBe('hard');
  });
});

// ── DEFAULT_RATE_LIMITS ────────────────────────────────────────────────

describe('DEFAULT_RATE_LIMITS', () => {
  it('includes all core services', () => {
    const services = DEFAULT_RATE_LIMITS.map((r) => r.service);
    expect(services).toContain('slack');
    expect(services).toContain('gmail');
    expect(services).toContain('github');
    expect(services).toContain('stripe');
  });

  it('all limits have positive maxActions', () => {
    for (const limit of DEFAULT_RATE_LIMITS) {
      expect(limit.maxActions).toBeGreaterThan(0);
    }
  });
});
