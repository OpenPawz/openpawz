import { describe, it, expect } from 'vitest';
import {
  extractDomain,
  parseProgressStep,
  buildResearchPrompt,
  modeTimeout,
  PROGRESS_PATTERNS,
} from './atoms';

// ── extractDomain ──────────────────────────────────────────────────────

describe('extractDomain', () => {
  it('extracts domain from URL', () => {
    expect(extractDomain('https://www.example.com/page')).toBe('example.com');
  });

  it('handles URL without www', () => {
    expect(extractDomain('https://docs.github.com/something')).toBe('docs.github.com');
  });

  it('returns truncated string for invalid URL', () => {
    expect(extractDomain('not-a-url')).toBeTruthy();
  });
});

// ── parseProgressStep ──────────────────────────────────────────────────

describe('parseProgressStep', () => {
  it('returns step for matching text', () => {
    expect(parseProgressStep('Searching for results', [])).toBe('Searching the web...');
  });

  it('skips already-seen steps', () => {
    expect(parseProgressStep('Searching', ['Searching the web...'])).toBeNull();
  });

  it('returns null for non-matching text', () => {
    expect(parseProgressStep('Hello world', [])).toBeNull();
  });

  it('matches reading pattern', () => {
    expect(parseProgressStep('Reading the article', [])).toBe('Reading sources...');
  });
});

// ── buildResearchPrompt ────────────────────────────────────────────────

describe('buildResearchPrompt', () => {
  it('returns deep prompt for deep mode', () => {
    const prompt = buildResearchPrompt('quantum computing', 'deep');
    expect(prompt).toContain('thoroughly');
    expect(prompt).toContain('10 diverse sources');
    expect(prompt).toContain('quantum computing');
  });

  it('returns quick prompt for quick mode', () => {
    const prompt = buildResearchPrompt('AI safety', 'quick');
    expect(prompt).toContain('efficiently');
    expect(prompt).toContain('3-5 reliable');
    expect(prompt).toContain('AI safety');
  });
});

// ── modeTimeout ────────────────────────────────────────────────────────

describe('modeTimeout', () => {
  it('returns 300s for deep', () => {
    expect(modeTimeout('deep')).toBe(300_000);
  });

  it('returns 120s for quick', () => {
    expect(modeTimeout('quick')).toBe(120_000);
  });
});

// ── PROGRESS_PATTERNS ──────────────────────────────────────────────────

describe('PROGRESS_PATTERNS', () => {
  it('is a non-empty array', () => {
    expect(PROGRESS_PATTERNS.length).toBeGreaterThan(0);
  });

  it('each pattern has regex and step', () => {
    for (const p of PROGRESS_PATTERNS) {
      expect(p.regex).toBeInstanceOf(RegExp);
      expect(typeof p.step).toBe('string');
    }
  });
});
