import { describe, it, expect } from 'vitest';
import {
  msIcon,
  skillIcon,
  formatInstalls,
  tierBadge,
  CATEGORY_META,
  POPULAR_REPOS,
  POPULAR_TAGS,
  TIER_META,
  PAWZHUB_CATEGORIES,
  SKILL_ICON_MAP,
} from './atoms';

describe('msIcon', () => {
  it('renders Material Symbol span', () => {
    expect(msIcon('code')).toBe('<span class="ms ms-sm">code</span>');
  });

  it('accepts custom size class', () => {
    expect(msIcon('home', 'ms-lg')).toBe('<span class="ms ms-lg">home</span>');
  });
});

describe('skillIcon', () => {
  it('maps known emoji to Material Symbol', () => {
    expect(skillIcon('📧')).toContain('mail');
  });

  it('falls back to extension icon for unknown', () => {
    expect(skillIcon('🦄')).toContain('extension');
  });
});

describe('formatInstalls', () => {
  it('formats millions', () => {
    expect(formatInstalls(1_500_000)).toBe('1.5M');
  });

  it('formats thousands', () => {
    expect(formatInstalls(2_500)).toBe('2.5K');
  });

  it('returns raw for small numbers', () => {
    expect(formatInstalls(42)).toBe('42');
  });
});

describe('CATEGORY_META', () => {
  it('has Vault category', () => {
    expect(CATEGORY_META.Vault.icon).toBe('enhanced_encryption');
  });

  it('categories have order', () => {
    expect(CATEGORY_META.Vault.order).toBe(0);
    expect(CATEGORY_META.System.order).toBe(8);
  });
});

describe('POPULAR_REPOS', () => {
  it('has entries with source and label', () => {
    for (const repo of POPULAR_REPOS) {
      expect(repo.source).toBeTruthy();
      expect(repo.label).toBeTruthy();
    }
  });
});

describe('POPULAR_TAGS', () => {
  it('has common tags', () => {
    expect(POPULAR_TAGS).toContain('trading');
    expect(POPULAR_TAGS).toContain('coding');
  });
});

// ── tierBadge ──────────────────────────────────────────────────────────────

describe('tierBadge', () => {
  it('renders known tier badge', () => {
    const badge = tierBadge('skill');
    expect(badge).toContain('pawzhub-tier-badge');
    expect(badge).toContain('🔵');
    expect(badge).toContain('Skill');
    expect(badge).toContain(TIER_META.skill.color);
  });

  it('renders integration tier', () => {
    const badge = tierBadge('integration');
    expect(badge).toContain('🟣');
    expect(badge).toContain('Integration');
  });

  it('renders mcp tier', () => {
    const badge = tierBadge('mcp');
    expect(badge).toContain('🔴');
    expect(badge).toContain('MCP Server');
  });

  it('falls back to skill for unknown tier', () => {
    const badge = tierBadge('unknown-tier');
    expect(badge).toContain('🔵');
    expect(badge).toContain('Skill');
  });
});

// ── TIER_META ──────────────────────────────────────────────────────────────

describe('TIER_META', () => {
  it('has all expected tiers', () => {
    expect(TIER_META.skill).toBeDefined();
    expect(TIER_META.integration).toBeDefined();
    expect(TIER_META.extension).toBeDefined();
    expect(TIER_META.mcp).toBeDefined();
  });

  it('each tier has label, emoji, color', () => {
    for (const meta of Object.values(TIER_META)) {
      expect(meta.label).toBeTruthy();
      expect(meta.emoji).toBeTruthy();
      expect(meta.color).toMatch(/^#/);
    }
  });
});

// ── PAWZHUB_CATEGORIES ─────────────────────────────────────────────────────

describe('PAWZHUB_CATEGORIES', () => {
  it('starts with "all"', () => {
    expect(PAWZHUB_CATEGORIES[0]).toBe('all');
  });

  it('has common categories', () => {
    expect(PAWZHUB_CATEGORIES).toContain('development');
    expect(PAWZHUB_CATEGORIES).toContain('productivity');
    expect(PAWZHUB_CATEGORIES).toContain('finance');
  });
});

// ── SKILL_ICON_MAP ─────────────────────────────────────────────────────────

describe('SKILL_ICON_MAP', () => {
  it('maps emoji to Material Symbol names', () => {
    expect(SKILL_ICON_MAP['📧']).toBe('mail');
    expect(SKILL_ICON_MAP['💬']).toBe('chat');
    expect(SKILL_ICON_MAP['🔐']).toBe('lock');
  });

  it('all values are non-empty strings', () => {
    for (const val of Object.values(SKILL_ICON_MAP)) {
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
    }
  });
});
