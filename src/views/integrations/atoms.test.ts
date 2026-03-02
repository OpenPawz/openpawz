import { describe, it, expect } from 'vitest';
import {
  escHtml,
  fuzzyMatch,
  filterServices,
  sortServices,
  categoryLabel,
  categoryIcon,
  CATEGORIES,
} from './atoms';
import type { ServiceDefinition, ServiceCategory } from './atoms';

// ── Test data factory ──────────────────────────────────────────────────────

function makeService(overrides: Partial<ServiceDefinition> = {}): ServiceDefinition {
  return {
    id: 'test-service',
    name: 'Test Service',
    icon: 'build',
    color: '#000',
    category: 'utility',
    description: 'A test service for unit tests',
    capabilities: ['test'],
    n8nNodeType: 'n8n-nodes-base.test',
    credentialFields: [],
    setupGuide: { title: 'Setup', steps: [], estimatedTime: '1m' },
    queryExamples: [],
    automationExamples: [],
    docsUrl: 'https://example.com',
    popular: false,
    ...overrides,
  };
}

// ── escHtml ────────────────────────────────────────────────────────────────

describe('escHtml (integrations)', () => {
  it('escapes HTML special characters', () => {
    expect(escHtml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  it('handles empty string', () => {
    expect(escHtml('')).toBe('');
  });
});

// ── fuzzyMatch ─────────────────────────────────────────────────────────────

describe('fuzzyMatch', () => {
  it('matches exact substring', () => {
    expect(fuzzyMatch('slack', 'Slack Integration')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(fuzzyMatch('SLACK', 'slack')).toBe(true);
    expect(fuzzyMatch('slack', 'SLACK')).toBe(true);
  });

  it('matches fuzzy char sequence', () => {
    expect(fuzzyMatch('slk', 'slack')).toBe(true);
    expect(fuzzyMatch('gml', 'gmail')).toBe(true);
  });

  it('rejects non-matching sequence', () => {
    expect(fuzzyMatch('xyz', 'slack')).toBe(false);
  });

  it('matches empty query to any text', () => {
    expect(fuzzyMatch('', 'anything')).toBe(true);
  });

  it('rejects non-empty query against empty text', () => {
    expect(fuzzyMatch('a', '')).toBe(false);
  });

  it('handles single character matches', () => {
    expect(fuzzyMatch('s', 'slack')).toBe(true);
    expect(fuzzyMatch('z', 'slack')).toBe(false);
  });
});

// ── filterServices ─────────────────────────────────────────────────────────

describe('filterServices', () => {
  const services = [
    makeService({
      id: 'slack',
      name: 'Slack',
      category: 'communication',
      description: 'Team messaging',
    }),
    makeService({
      id: 'github',
      name: 'GitHub',
      category: 'development',
      description: 'Code hosting',
    }),
    makeService({
      id: 'gmail',
      name: 'Gmail',
      category: 'communication',
      description: 'Email service',
    }),
    makeService({ id: 'stripe', name: 'Stripe', category: 'commerce', description: 'Payments' }),
  ];

  it('returns all when no filter applied', () => {
    expect(filterServices(services, '', 'all')).toHaveLength(4);
  });

  it('filters by category', () => {
    const result = filterServices(services, '', 'communication');
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id)).toContain('slack');
    expect(result.map((s) => s.id)).toContain('gmail');
  });

  it('filters by query (name match)', () => {
    const result = filterServices(services, 'slack', 'all');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('slack');
  });

  it('filters by query (description match)', () => {
    const result = filterServices(services, 'messaging', 'all');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('slack');
  });

  it('combines category + query', () => {
    const result = filterServices(services, 'mail', 'communication');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('gmail');
  });

  it('returns empty when nothing matches', () => {
    expect(filterServices(services, 'nonexistent', 'all')).toHaveLength(0);
  });

  it('ignores whitespace-only query', () => {
    expect(filterServices(services, '   ', 'all')).toHaveLength(4);
  });
});

// ── sortServices ───────────────────────────────────────────────────────────

describe('sortServices', () => {
  const services = [
    makeService({ id: 'c', name: 'Charlie', category: 'development', popular: false }),
    makeService({ id: 'a', name: 'Alpha', category: 'communication', popular: true }),
    makeService({ id: 'b', name: 'Bravo', category: 'communication', popular: false }),
  ];

  it('sorts popular first, then A-Z', () => {
    const result = sortServices(services, 'popular');
    expect(result[0].name).toBe('Alpha'); // popular
    expect(result[1].name).toBe('Bravo'); // alphabetical among non-popular
    expect(result[2].name).toBe('Charlie');
  });

  it('sorts A-Z by name', () => {
    const result = sortServices(services, 'a-z');
    expect(result.map((s) => s.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('sorts by category then name', () => {
    const result = sortServices(services, 'category');
    expect(result[0].name).toBe('Alpha'); // communication
    expect(result[1].name).toBe('Bravo'); // communication
    expect(result[2].name).toBe('Charlie'); // development
  });

  it('does not mutate the original array', () => {
    const snapshot = services[0].id;
    sortServices(services, 'a-z');
    expect(services[0].id).toBe(snapshot); // first element unchanged
  });

  it('returns copy for unknown sort', () => {
    const result = sortServices(services, 'unknown' as any);
    expect(result).toHaveLength(3);
  });
});

// ── categoryLabel ──────────────────────────────────────────────────────────

describe('categoryLabel', () => {
  it('returns label for known category', () => {
    expect(categoryLabel('communication')).toBe('Communication');
    expect(categoryLabel('development')).toBe('Development');
    expect(categoryLabel('commerce')).toBe('Commerce');
  });

  it('returns raw category for unknown', () => {
    expect(categoryLabel('nonexistent' as ServiceCategory)).toBe('nonexistent');
  });
});

// ── categoryIcon ───────────────────────────────────────────────────────────

describe('categoryIcon', () => {
  it('returns icon for known category', () => {
    expect(categoryIcon('communication')).toBe('chat');
    expect(categoryIcon('development')).toBe('code');
    expect(categoryIcon('cloud')).toBe('cloud');
  });

  it('returns fallback for unknown category', () => {
    expect(categoryIcon('nonexistent' as ServiceCategory)).toBe('extension');
  });
});

// ── CATEGORIES ─────────────────────────────────────────────────────────────

describe('CATEGORIES', () => {
  it('has 15 categories', () => {
    expect(CATEGORIES).toHaveLength(15);
  });

  it('each entry has id, label, and icon', () => {
    for (const cat of CATEGORIES) {
      expect(cat.id).toBeTruthy();
      expect(cat.label).toBeTruthy();
      expect(cat.icon).toBeTruthy();
    }
  });

  it('ids are unique', () => {
    const ids = CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
