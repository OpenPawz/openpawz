import { describe, it, expect } from 'vitest';
import { esc } from './atoms';

describe('esc (webhook)', () => {
  it('escapes HTML entities', () => {
    expect(esc('<b>"&</b>')).toBe('&lt;b&gt;&quot;&amp;&lt;/b&gt;');
  });

  it('escapes single quotes', () => {
    expect(esc("it's")).toBe('it&#39;s');
  });

  it('handles empty string', () => {
    expect(esc('')).toBe('');
  });
});
