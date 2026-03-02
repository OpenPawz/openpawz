// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { esc, workflowCountLabel, makeBtn } from './atoms';

// ── esc ────────────────────────────────────────────────────────────────────

describe('esc (n8n)', () => {
  it('escapes HTML entities', () => {
    expect(esc('<script>"alert"</script>')).toBe('&lt;script&gt;&quot;alert&quot;&lt;/script&gt;');
  });

  it('escapes single quotes', () => {
    expect(esc("it's")).toBe('it&#39;s');
  });

  it('handles empty string', () => {
    expect(esc('')).toBe('');
  });

  it('handles ampersands', () => {
    expect(esc('A & B')).toBe('A &amp; B');
  });
});

// ── workflowCountLabel ─────────────────────────────────────────────────────

describe('workflowCountLabel', () => {
  it('returns singular for 1', () => {
    expect(workflowCountLabel(1)).toBe('1 workflow');
  });

  it('returns plural for 0', () => {
    expect(workflowCountLabel(0)).toBe('0 workflows');
  });

  it('returns plural for multiple', () => {
    expect(workflowCountLabel(5)).toBe('5 workflows');
    expect(workflowCountLabel(100)).toBe('100 workflows');
  });
});

// ── makeBtn ────────────────────────────────────────────────────────────────

describe('makeBtn', () => {
  it('creates a button element', () => {
    const btn = makeBtn('Click', 'btn-primary', () => {});
    expect(btn.tagName).toBe('BUTTON');
  });

  it('sets text content', () => {
    const btn = makeBtn('Save', 'btn-primary', () => {});
    expect(btn.textContent).toBe('Save');
  });

  it('sets className with btn prefix and btn-sm', () => {
    const btn = makeBtn('OK', 'btn-danger', () => {});
    expect(btn.className).toBe('btn btn-danger btn-sm');
  });

  it('attaches click handler', () => {
    const handler = vi.fn();
    const btn = makeBtn('Go', 'btn-primary', handler);
    btn.click();
    expect(handler).toHaveBeenCalledOnce();
  });
});
