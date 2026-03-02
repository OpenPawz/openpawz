import { describe, it, expect } from 'vitest';
import { esc, inputStyle } from './atoms';

// ── esc ────────────────────────────────────────────────────────────────────

describe('esc (MCP)', () => {
  it('escapes all HTML entities', () => {
    expect(esc('<div class="x">&</div>')).toBe('&lt;div class=&quot;x&quot;&gt;&amp;&lt;/div&gt;');
  });

  it('escapes single quotes', () => {
    expect(esc("it's")).toBe('it&#39;s');
  });

  it('is identity for plain text', () => {
    expect(esc('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(esc('')).toBe('');
  });
});

// ── inputStyle ─────────────────────────────────────────────────────────────

describe('inputStyle', () => {
  it('is a non-empty CSS style string', () => {
    expect(typeof inputStyle).toBe('string');
    expect(inputStyle.length).toBeGreaterThan(0);
  });

  it('includes width and padding', () => {
    expect(inputStyle).toContain('width:100%');
    expect(inputStyle).toContain('padding:8px');
  });

  it('includes border-radius', () => {
    expect(inputStyle).toContain('border-radius:6px');
  });
});
