import { describe, it, expect } from 'vitest';
import { esc } from './atoms';

// ── esc (HTML escape) ──────────────────────────────────────────────────

describe('esc', () => {
  it('escapes ampersands', () => {
    expect(esc('a & b')).toBe('a &amp; b');
  });

  it('escapes angle brackets', () => {
    expect(esc('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes quotes', () => {
    expect(esc('"hello" & \'world\'')).toBe('&quot;hello&quot; &amp; &#39;world&#39;');
  });

  it('leaves safe strings unchanged', () => {
    expect(esc('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(esc('')).toBe('');
  });

  it('escapes all special chars at once', () => {
    expect(esc('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});
