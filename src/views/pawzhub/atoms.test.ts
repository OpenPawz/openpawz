import { describe, it, expect } from 'vitest';
import {
  msIcon,
  tierBadge,
  formatInstalls,
  TIER_META,
  PAWZHUB_CATEGORIES,
  FEATURED_SKILL_IDS,
} from './atoms';

// ── msIcon ─────────────────────────────────────────────────────────────

describe('msIcon', () => {
  it('wraps icon name in span with default size', () => {
    const html = msIcon('home');
    expect(html).toBe('<span class="ms ms-sm">home</span>');
  });

  it('uses custom size class', () => {
    const html = msIcon('settings', 'ms-lg');
    expect(html).toContain('ms-lg');
    expect(html).toContain('settings');
  });
});

// ── tierBadge ──────────────────────────────────────────────────────────

describe('tierBadge', () => {
  it('renders skill tier badge', () => {
    const badge = tierBadge('skill');
    expect(badge).toContain('🔵');
    expect(badge).toContain('Skill');
    expect(badge).toContain(TIER_META.skill.color);
  });

  it('renders integration tier badge', () => {
    const badge = tierBadge('integration');
    expect(badge).toContain('🟣');
    expect(badge).toContain('Integration');
  });

  it('renders extension tier badge', () => {
    const badge = tierBadge('extension');
    expect(badge).toContain('🟡');
    expect(badge).toContain('Extension');
  });

  it('renders mcp tier badge', () => {
    const badge = tierBadge('mcp');
    expect(badge).toContain('MCP Server');
    expect(badge).toContain('🔴');
  });

  it('falls back to skill for unknown tier', () => {
    const badge = tierBadge('nonexistent_tier');
    expect(badge).toContain('Skill');
    expect(badge).toContain('🔵');
  });
});

// ── formatInstalls ─────────────────────────────────────────────────────

describe('formatInstalls', () => {
  it('formats millions', () => {
    expect(formatInstalls(2_500_000)).toBe('2.5M');
  });

  it('formats exactly 1M', () => {
    expect(formatInstalls(1_000_000)).toBe('1.0M');
  });

  it('formats thousands', () => {
    expect(formatInstalls(15_300)).toBe('15.3K');
  });

  it('formats exactly 1K', () => {
    expect(formatInstalls(1_000)).toBe('1.0K');
  });

  it('returns raw number below 1K', () => {
    expect(formatInstalls(500)).toBe('500');
  });

  it('returns "0" for 0', () => {
    expect(formatInstalls(0)).toBe('0');
  });
});

// ── Constants ──────────────────────────────────────────────────────────

describe('PAWZHUB_CATEGORIES', () => {
  it('starts with "all"', () => {
    expect(PAWZHUB_CATEGORIES[0]).toBe('all');
  });

  it('contains core categories', () => {
    expect(PAWZHUB_CATEGORIES).toContain('development');
    expect(PAWZHUB_CATEGORIES).toContain('productivity');
    expect(PAWZHUB_CATEGORIES).toContain('communication');
    expect(PAWZHUB_CATEGORIES).toContain('data');
  });
});

describe('TIER_META', () => {
  it('has 4 tiers', () => {
    expect(Object.keys(TIER_META)).toHaveLength(4);
  });

  it('every tier has label, emoji, and color', () => {
    for (const [, meta] of Object.entries(TIER_META)) {
      expect(meta.label).toBeDefined();
      expect(meta.emoji).toBeDefined();
      expect(meta.color).toBeDefined();
    }
  });
});

describe('FEATURED_SKILL_IDS', () => {
  it('contains github and slack', () => {
    expect(FEATURED_SKILL_IDS).toContain('github');
    expect(FEATURED_SKILL_IDS).toContain('slack');
  });
});
