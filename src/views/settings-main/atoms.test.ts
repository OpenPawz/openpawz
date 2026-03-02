import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BUDGET_KEY, getBudgetLimit, setBudgetLimit } from './atoms';

// ── Mock localStorage ──────────────────────────────────────────────────────

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
});

// ── BUDGET_KEY ─────────────────────────────────────────────────────────────

describe('BUDGET_KEY', () => {
  it('equals paw-budget-limit', () => {
    expect(BUDGET_KEY).toBe('paw-budget-limit');
  });
});

// ── getBudgetLimit ─────────────────────────────────────────────────────────

describe('getBudgetLimit', () => {
  it('returns null when nothing saved', () => {
    expect(getBudgetLimit()).toBeNull();
  });

  it('returns parsed number when valid', () => {
    store.set(BUDGET_KEY, '50');
    expect(getBudgetLimit()).toBe(50);
  });

  it('returns null for NaN', () => {
    store.set(BUDGET_KEY, 'abc');
    expect(getBudgetLimit()).toBeNull();
  });

  it('returns null for zero', () => {
    store.set(BUDGET_KEY, '0');
    expect(getBudgetLimit()).toBeNull();
  });

  it('returns null for negative', () => {
    store.set(BUDGET_KEY, '-10');
    expect(getBudgetLimit()).toBeNull();
  });

  it('handles decimal values', () => {
    store.set(BUDGET_KEY, '25.5');
    expect(getBudgetLimit()).toBe(25.5);
  });
});

// ── setBudgetLimit ─────────────────────────────────────────────────────────

describe('setBudgetLimit', () => {
  it('saves a positive number', () => {
    setBudgetLimit(100);
    expect(store.get(BUDGET_KEY)).toBe('100');
  });

  it('removes when null', () => {
    store.set(BUDGET_KEY, '50');
    setBudgetLimit(null);
    expect(store.has(BUDGET_KEY)).toBe(false);
  });

  it('removes when zero', () => {
    store.set(BUDGET_KEY, '50');
    setBudgetLimit(0);
    expect(store.has(BUDGET_KEY)).toBe(false);
  });

  it('removes when negative', () => {
    store.set(BUDGET_KEY, '50');
    setBudgetLimit(-5);
    expect(store.has(BUDGET_KEY)).toBe(false);
  });
});
