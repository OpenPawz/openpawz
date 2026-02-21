import { describe, it, expect } from 'vitest';
import {
  isReDoSRisk,
  validateRegexPattern,
  matchesAllowlist,
  matchesDenylist,
  extractCommandString,
} from './security';

describe('isReDoSRisk', () => {
  it('detects nested quantifiers (a+)+', () => {
    expect(isReDoSRisk('(a+)+')).toBe(true);
  });

  it('detects nested quantifiers (a+)*', () => {
    expect(isReDoSRisk('(a+)*')).toBe(true);
  });

  it('detects nested quantifiers (a*)*', () => {
    expect(isReDoSRisk('(a*)*')).toBe(true);
  });

  it('detects nested quantifiers in complex patterns', () => {
    expect(isReDoSRisk('(x[a-z]+)+')).toBe(true);
  });

  it('allows simple patterns', () => {
    expect(isReDoSRisk('^git\\b')).toBe(false);
    expect(isReDoSRisk('^npm\\b')).toBe(false);
    expect(isReDoSRisk('^ls\\b')).toBe(false);
  });

  it('allows single quantifiers', () => {
    expect(isReDoSRisk('a+')).toBe(false);
    expect(isReDoSRisk('[a-z]*')).toBe(false);
  });

  it('allows anchored patterns', () => {
    expect(isReDoSRisk('^rm\\b')).toBe(false);
    expect(isReDoSRisk('^chmod\\b')).toBe(false);
  });
});

describe('validateRegexPattern', () => {
  it('returns null for valid patterns', () => {
    expect(validateRegexPattern('^git\\b')).toBeNull();
    expect(validateRegexPattern('^npm (install|ci)\\b')).toBeNull();
  });

  it('returns error for invalid regex syntax', () => {
    const result = validateRegexPattern('[unclosed');
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('returns error for ReDoS-risk patterns', () => {
    const result = validateRegexPattern('(a+)+$');
    expect(result).toContain('catastrophic backtracking');
  });
});

describe('matchesAllowlist', () => {
  it('matches simple patterns', () => {
    expect(matchesAllowlist('git status', ['^git\\b'])).toBe(true);
    expect(matchesAllowlist('npm install', ['^npm\\b'])).toBe(true);
  });

  it('rejects non-matching commands', () => {
    expect(matchesAllowlist('rm -rf /', ['^git\\b', '^npm\\b'])).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(matchesAllowlist('Git Status', ['^git\\b'])).toBe(true);
  });

  it('silently rejects ReDoS patterns', () => {
    // Should not hang — returns false instead of attempting the match
    expect(matchesAllowlist('aaaaaaaaaaaa', ['(a+)+$'])).toBe(false);
  });

  it('handles invalid regex gracefully', () => {
    expect(matchesAllowlist('test', ['[invalid'])).toBe(false);
  });
});

describe('matchesDenylist', () => {
  it('matches dangerous patterns', () => {
    expect(matchesDenylist('rm -rf /', ['^rm\\s+-rf'])).toBe(true);
  });

  it('silently rejects ReDoS patterns', () => {
    expect(matchesDenylist('aaaaaaaaaaaa', ['(a+)+$'])).toBe(false);
  });
});

describe('extractCommandString', () => {
  it('extracts full command for exec tools', () => {
    const result = extractCommandString('exec', { command: 'ls -la' });
    expect(result).toBe('ls -la');
  });

  it('returns tool name for non-exec tools', () => {
    expect(extractCommandString('read_file')).toBe('read_file');
    expect(extractCommandString('fetch', { url: 'http://evil.com' })).toBe('fetch');
  });
});
