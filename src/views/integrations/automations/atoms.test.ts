import { describe, it, expect } from 'vitest';
import {
  checkRequirements,
  filterTemplates,
  triggerLabel,
  statusBadge,
  sortAutomations,
  TEMPLATE_CATEGORIES,
} from './atoms';
import type { AutomationTemplate, ActiveAutomation } from './atoms';

// ── Factories ──────────────────────────────────────────────────────────────

function makeTemplate(overrides: Partial<AutomationTemplate> = {}): AutomationTemplate {
  return {
    id: 'tpl-1',
    name: 'Test Template',
    description: 'A test automation',
    category: 'alerts',
    trigger: { type: 'schedule', label: 'Every hour' },
    steps: [],
    requiredServices: ['slack'],
    tags: ['popular'],
    estimatedSetup: '30 seconds',
    ...overrides,
  };
}

function makeAutomation(overrides: Partial<ActiveAutomation> = {}): ActiveAutomation {
  return {
    id: 'auto-1',
    name: 'Test Automation',
    description: 'test',
    trigger: { type: 'manual', label: 'Manual run' },
    steps: [],
    services: ['slack'],
    status: 'active',
    createdAt: '2025-01-01T00:00:00Z',
    runCount: 0,
    ...overrides,
  };
}

// ── checkRequirements ──────────────────────────────────────────────────────

describe('checkRequirements', () => {
  it('reports all met when services are connected', () => {
    const tpl = makeTemplate({ requiredServices: ['slack', 'github'] });
    const result = checkRequirements(tpl, new Set(['slack', 'github', 'gmail']));
    expect(result.met).toEqual(['slack', 'github']);
    expect(result.missing).toEqual([]);
  });

  it('reports missing when services are not connected', () => {
    const tpl = makeTemplate({ requiredServices: ['slack', 'github'] });
    const result = checkRequirements(tpl, new Set(['slack']));
    expect(result.met).toEqual(['slack']);
    expect(result.missing).toEqual(['github']);
  });

  it('reports all missing when nothing connected', () => {
    const tpl = makeTemplate({ requiredServices: ['slack', 'github'] });
    const result = checkRequirements(tpl, new Set());
    expect(result.met).toEqual([]);
    expect(result.missing).toEqual(['slack', 'github']);
  });

  it('handles template with no required services', () => {
    const tpl = makeTemplate({ requiredServices: [] });
    const result = checkRequirements(tpl, new Set(['slack']));
    expect(result.met).toEqual([]);
    expect(result.missing).toEqual([]);
  });
});

// ── filterTemplates ────────────────────────────────────────────────────────

describe('filterTemplates', () => {
  const templates = [
    makeTemplate({
      id: '1',
      name: 'Slack Alert',
      category: 'alerts',
      requiredServices: ['slack'],
      tags: ['popular'],
    }),
    makeTemplate({
      id: '2',
      name: 'GitHub Sync',
      category: 'sync',
      requiredServices: ['github'],
      tags: ['devops'],
    }),
    makeTemplate({
      id: '3',
      name: 'Weekly Report',
      category: 'reporting',
      requiredServices: ['slack'],
      tags: ['popular'],
    }),
  ];

  it('returns all when no filters', () => {
    expect(filterTemplates(templates, {})).toHaveLength(3);
  });

  it('filters by serviceId', () => {
    const result = filterTemplates(templates, { serviceId: 'github' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('filters by category', () => {
    const result = filterTemplates(templates, { category: 'alerts' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('filters by query (name match)', () => {
    const result = filterTemplates(templates, { query: 'report' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('3');
  });

  it('filters by query (tag match)', () => {
    const result = filterTemplates(templates, { query: 'devops' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('combines filters', () => {
    const result = filterTemplates(templates, { serviceId: 'slack', category: 'alerts' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('passes through with "all" category', () => {
    expect(filterTemplates(templates, { category: 'all' })).toHaveLength(3);
  });
});

// ── triggerLabel ───────────────────────────────────────────────────────────

describe('triggerLabel', () => {
  it('formats schedule trigger', () => {
    const result = triggerLabel({ type: 'schedule', label: 'Every hour' });
    expect(result).toContain('📅');
    expect(result).toContain('Every hour');
  });

  it('formats webhook trigger', () => {
    const result = triggerLabel({ type: 'webhook', label: 'On push' });
    expect(result).toContain('🔗');
  });

  it('formats event trigger', () => {
    const result = triggerLabel({ type: 'event', label: 'New deal' });
    expect(result).toContain('⚡');
  });

  it('formats manual trigger', () => {
    const result = triggerLabel({ type: 'manual', label: 'Run now' });
    expect(result).toContain('▶️');
  });
});

// ── statusBadge ────────────────────────────────────────────────────────────

describe('statusBadge', () => {
  it('returns active badge', () => {
    const badge = statusBadge('active');
    expect(badge.label).toBe('Active');
    expect(badge.icon).toBe('play_circle');
  });

  it('returns paused badge', () => {
    const badge = statusBadge('paused');
    expect(badge.label).toBe('Paused');
    expect(badge.icon).toBe('pause_circle');
  });

  it('returns error badge', () => {
    const badge = statusBadge('error');
    expect(badge.label).toBe('Error');
    expect(badge.icon).toBe('error');
  });

  it('returns draft badge', () => {
    const badge = statusBadge('draft');
    expect(badge.label).toBe('Draft');
    expect(badge.icon).toBe('edit_note');
  });
});

// ── sortAutomations ────────────────────────────────────────────────────────

describe('sortAutomations', () => {
  it('sorts active before paused before error', () => {
    const items = [
      makeAutomation({ id: '1', status: 'error', name: 'C' }),
      makeAutomation({ id: '2', status: 'active', name: 'A' }),
      makeAutomation({ id: '3', status: 'paused', name: 'B' }),
    ];
    const result = sortAutomations(items);
    expect(result.map((a) => a.status)).toEqual(['active', 'paused', 'error']);
  });

  it('sorts by last run within same status', () => {
    const items = [
      makeAutomation({ id: '1', status: 'active', lastRunAt: '2025-01-01T00:00:00Z' }),
      makeAutomation({ id: '2', status: 'active', lastRunAt: '2025-06-01T00:00:00Z' }),
    ];
    const result = sortAutomations(items);
    expect(result[0].id).toBe('2'); // more recent first
  });

  it('sorts by name when no last run', () => {
    const items = [
      makeAutomation({ id: '1', status: 'active', name: 'Beta' }),
      makeAutomation({ id: '2', status: 'active', name: 'Alpha' }),
    ];
    const result = sortAutomations(items);
    expect(result[0].name).toBe('Alpha');
  });

  it('does not mutate original array', () => {
    const items = [
      makeAutomation({ id: '1', status: 'error' }),
      makeAutomation({ id: '2', status: 'active' }),
    ];
    sortAutomations(items);
    expect(items[0].status).toBe('error'); // unchanged
  });
});

// ── TEMPLATE_CATEGORIES ────────────────────────────────────────────────────

describe('TEMPLATE_CATEGORIES', () => {
  it('has 8 categories', () => {
    expect(TEMPLATE_CATEGORIES).toHaveLength(8);
  });

  it('each has id, label, icon', () => {
    for (const cat of TEMPLATE_CATEGORIES) {
      expect(cat.id).toBeTruthy();
      expect(cat.label).toBeTruthy();
      expect(cat.icon).toBeTruthy();
    }
  });
});
