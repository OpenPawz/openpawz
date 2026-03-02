import { describe, it, expect } from 'vitest';
import { PROVIDER_KINDS, DEFAULT_BASE_URLS, POPULAR_MODELS } from './atoms';

// ── PROVIDER_KINDS ─────────────────────────────────────────────────────────

describe('PROVIDER_KINDS', () => {
  it('has all expected providers', () => {
    const values = PROVIDER_KINDS.map((p) => p.value);
    expect(values).toContain('ollama');
    expect(values).toContain('openai');
    expect(values).toContain('anthropic');
    expect(values).toContain('google');
    expect(values).toContain('openrouter');
    expect(values).toContain('custom');
  });

  it('each entry has value and label', () => {
    for (const pk of PROVIDER_KINDS) {
      expect(pk.value).toBeTruthy();
      expect(pk.label).toBeTruthy();
    }
  });
});

// ── DEFAULT_BASE_URLS ──────────────────────────────────────────────────────

describe('DEFAULT_BASE_URLS', () => {
  it('provides URLs for all provider kinds', () => {
    for (const pk of PROVIDER_KINDS) {
      expect(pk.value in DEFAULT_BASE_URLS).toBe(true);
    }
  });

  it('ollama points to localhost', () => {
    expect(DEFAULT_BASE_URLS.ollama).toContain('localhost');
  });

  it('custom is empty string', () => {
    expect(DEFAULT_BASE_URLS.custom).toBe('');
  });

  it('all non-custom URLs start with http', () => {
    for (const [key, url] of Object.entries(DEFAULT_BASE_URLS)) {
      if (key !== 'custom') expect(url).toMatch(/^https?:\/\//);
    }
  });
});

// ── POPULAR_MODELS ─────────────────────────────────────────────────────────

describe('POPULAR_MODELS', () => {
  it('has entries for all providers', () => {
    for (const pk of PROVIDER_KINDS) {
      expect(POPULAR_MODELS[pk.value]).toBeDefined();
      expect(Array.isArray(POPULAR_MODELS[pk.value])).toBe(true);
    }
  });

  it('ollama has local model names', () => {
    expect(POPULAR_MODELS.ollama.length).toBeGreaterThan(0);
    expect(POPULAR_MODELS.ollama.some((m) => m.includes('llama'))).toBe(true);
  });

  it('openai has gpt models', () => {
    expect(POPULAR_MODELS.openai.some((m) => m.includes('gpt'))).toBe(true);
  });

  it('anthropic has claude models', () => {
    expect(POPULAR_MODELS.anthropic.some((m) => m.includes('claude'))).toBe(true);
  });

  it('custom has empty array', () => {
    expect(POPULAR_MODELS.custom).toEqual([]);
  });
});
