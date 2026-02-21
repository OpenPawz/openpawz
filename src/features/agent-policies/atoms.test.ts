import { describe, it, expect } from 'vitest';
import {
  checkToolPolicy,
  filterToolsByPolicy,
  isOverToolCallLimit,
  describePolicySummary,
  DEFAULT_POLICY,
  READONLY_POLICY,
  POLICY_PRESETS,
  ALL_TOOLS,
  SAFE_TOOLS,
  HIGH_RISK_TOOLS,
} from './atoms';
import type { ToolPolicy } from './atoms';

// ── checkToolPolicy ────────────────────────────────────────────────────

describe('checkToolPolicy', () => {
  it('unrestricted mode allows everything', () => {
    const d = checkToolPolicy('exec', DEFAULT_POLICY);
    expect(d.allowed).toBe(true);
    expect(d.requiresApproval).toBe(false);
  });

  it('allowlist mode allows listed tools', () => {
    const d = checkToolPolicy('read_file', READONLY_POLICY);
    expect(d.allowed).toBe(true);
  });

  it('allowlist mode blocks unlisted tools', () => {
    const d = checkToolPolicy('exec', READONLY_POLICY);
    expect(d.allowed).toBe(false);
  });

  it('allowlist with requireApprovalForUnlisted still allows with approval', () => {
    const policy: ToolPolicy = {
      ...READONLY_POLICY,
      requireApprovalForUnlisted: true,
    };
    const d = checkToolPolicy('exec', policy);
    expect(d.allowed).toBe(true);
    expect(d.requiresApproval).toBe(true);
  });

  it('denylist mode blocks denied tools', () => {
    const policy: ToolPolicy = {
      mode: 'denylist',
      allowed: [],
      denied: ['exec'],
      requireApprovalForUnlisted: false,
      alwaysRequireApproval: [],
    };
    const d = checkToolPolicy('exec', policy);
    expect(d.allowed).toBe(false);
  });

  it('denylist mode allows non-denied tools', () => {
    const policy: ToolPolicy = {
      mode: 'denylist',
      allowed: [],
      denied: ['exec'],
      requireApprovalForUnlisted: false,
      alwaysRequireApproval: [],
    };
    const d = checkToolPolicy('read_file', policy);
    expect(d.allowed).toBe(true);
  });

  it('alwaysRequireApproval overrides mode', () => {
    const policy: ToolPolicy = {
      ...DEFAULT_POLICY,
      alwaysRequireApproval: ['exec'],
    };
    const d = checkToolPolicy('exec', policy);
    expect(d.allowed).toBe(true);
    expect(d.requiresApproval).toBe(true);
  });
});

// ── filterToolsByPolicy ────────────────────────────────────────────────

describe('filterToolsByPolicy', () => {
  it('returns all tools for unrestricted', () => {
    const tools = ['exec', 'read_file', 'write_file'];
    expect(filterToolsByPolicy(tools, DEFAULT_POLICY)).toEqual(tools);
  });

  it('filters to only allowed tools for allowlist', () => {
    const tools = ['exec', 'read_file', 'write_file'];
    const result = filterToolsByPolicy(tools, READONLY_POLICY);
    expect(result).toContain('read_file');
    expect(result).not.toContain('exec');
  });
});

// ── isOverToolCallLimit ────────────────────────────────────────────────

describe('isOverToolCallLimit', () => {
  it('returns false when no limit set', () => {
    expect(isOverToolCallLimit(100, DEFAULT_POLICY)).toBe(false);
  });

  it('returns true when over limit', () => {
    const policy: ToolPolicy = { ...DEFAULT_POLICY, maxToolCallsPerTurn: 5 };
    expect(isOverToolCallLimit(6, policy)).toBe(true);
  });

  it('returns false when within limit', () => {
    const policy: ToolPolicy = { ...DEFAULT_POLICY, maxToolCallsPerTurn: 5 };
    expect(isOverToolCallLimit(3, policy)).toBe(false);
  });
});

// ── describePolicySummary ──────────────────────────────────────────────

describe('describePolicySummary', () => {
  it('describes unrestricted', () => {
    expect(describePolicySummary(DEFAULT_POLICY)).toContain('Unrestricted');
  });

  it('describes allowlist with count', () => {
    expect(describePolicySummary(READONLY_POLICY)).toContain('Allowlist');
    expect(describePolicySummary(READONLY_POLICY)).toMatch(/\d+ tools/);
  });
});

// ── Constants ──────────────────────────────────────────────────────────

describe('Tool constants', () => {
  it('ALL_TOOLS has many tools', () => {
    expect(ALL_TOOLS.length).toBeGreaterThan(30);
  });

  it('SAFE_TOOLS is subset of ALL_TOOLS', () => {
    for (const tool of SAFE_TOOLS) {
      expect(ALL_TOOLS).toContain(tool);
    }
  });

  it('HIGH_RISK_TOOLS is subset of ALL_TOOLS', () => {
    for (const tool of HIGH_RISK_TOOLS) {
      expect(ALL_TOOLS).toContain(tool);
    }
  });

  it('POLICY_PRESETS has 4 presets', () => {
    expect(Object.keys(POLICY_PRESETS)).toHaveLength(4);
  });
});
