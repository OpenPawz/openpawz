import { describe, it, expect } from 'vitest';
import { KIND_LABELS, ID_LABELS } from './atoms';

// ── KIND_LABELS ────────────────────────────────────────────────────────────

describe('KIND_LABELS', () => {
  it('maps all core provider kinds', () => {
    expect(KIND_LABELS.anthropic).toBe('Anthropic');
    expect(KIND_LABELS.openai).toBe('OpenAI');
    expect(KIND_LABELS.google).toBe('Google');
    expect(KIND_LABELS.openrouter).toBe('OpenRouter');
    expect(KIND_LABELS.ollama).toBe('Ollama');
    expect(KIND_LABELS.custom).toBe('Custom');
  });

  it('has 6 provider kinds', () => {
    expect(Object.keys(KIND_LABELS).length).toBe(6);
  });
});

// ── ID_LABELS ──────────────────────────────────────────────────────────────

describe('ID_LABELS', () => {
  it('maps extended provider IDs', () => {
    expect(ID_LABELS.moonshot).toBe('Kimi / Moonshot');
    expect(ID_LABELS.deepseek).toBe('DeepSeek');
    expect(ID_LABELS.xai).toBe('xAI (Grok)');
    expect(ID_LABELS.mistral).toBe('Mistral');
    expect(ID_LABELS.groq).toBe('Groq');
  });

  it('has google-openai compat entry', () => {
    expect(ID_LABELS['google-openai']).toBe('Google (OpenAI-compat)');
  });

  it('has 8 extended IDs', () => {
    expect(Object.keys(ID_LABELS).length).toBe(8);
  });
});
