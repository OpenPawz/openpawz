import { describe, it, expect } from 'vitest';
import {
  msIcon,
  skillIcon,
  formatInstalls,
  CATEGORY_META,
  POPULAR_REPOS,
  POPULAR_TAGS,
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
