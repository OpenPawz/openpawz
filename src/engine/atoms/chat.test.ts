import { describe, it, expect } from 'vitest';
import {
  generateSessionLabel,
  extractContent,
  findLastIndex,
  fileTypeIcon,
  fmtK,
  estimateContextBreakdown,
} from './chat';

// ── generateSessionLabel ──────────────────────────────────────────────────

describe('generateSessionLabel', () => {
  it('returns a trimmed label from a simple message', () => {
    expect(generateSessionLabel('Hello world')).toBe('Hello world');
  });

  it('strips leading slash commands', () => {
    expect(generateSessionLabel('/model gpt-4o explain the code')).toBe('gpt-4o explain the code');
  });

  it('strips markdown characters', () => {
    expect(generateSessionLabel('# **Bold** and _italic_')).toBe('Bold and italic');
  });

  it('collapses whitespace', () => {
    expect(generateSessionLabel('  lots   of   spaces  ')).toBe('lots of spaces');
  });

  it('truncates to 50 chars with ellipsis on word boundary', () => {
    const long = 'This is a very long message that should be truncated at fifty characters maximum';
    const label = generateSessionLabel(long);
    expect(label.length).toBeLessThanOrEqual(50);
    expect(label.endsWith('…')).toBe(true);
  });

  it('returns "New chat" for empty/whitespace input', () => {
    expect(generateSessionLabel('')).toBe('New chat');
    expect(generateSessionLabel('   ')).toBe('New chat');
  });

  it('returns "New chat" for markdown-only input', () => {
    expect(generateSessionLabel('### **')).toBe('New chat');
  });
});

// ── extractContent ────────────────────────────────────────────────────────

describe('extractContent', () => {
  it('returns string content as-is', () => {
    expect(extractContent('hello')).toBe('hello');
  });

  it('extracts text from content block arrays', () => {
    const blocks = [
      { type: 'text', text: 'first' },
      { type: 'tool_use', id: '1', name: 'test' },
      { type: 'text', text: 'second' },
    ];
    expect(extractContent(blocks)).toBe('first\nsecond');
  });

  it('extracts text from a single content block object', () => {
    expect(extractContent({ type: 'text', text: 'solo' })).toBe('solo');
  });

  it('returns empty string for null/undefined', () => {
    expect(extractContent(null)).toBe('');
    expect(extractContent(undefined)).toBe('');
  });

  it('stringifies non-matching objects', () => {
    expect(extractContent(42)).toBe('42');
    expect(extractContent(true)).toBe('true');
  });

  it('ignores non-text blocks in arrays', () => {
    const blocks = [
      { type: 'image', url: 'http://example.com' },
      { type: 'text', text: 'only this' },
    ];
    expect(extractContent(blocks)).toBe('only this');
  });
});

// ── findLastIndex ─────────────────────────────────────────────────────────

describe('findLastIndex', () => {
  it('finds last matching element', () => {
    expect(findLastIndex([1, 2, 3, 2, 1], (n) => n === 2)).toBe(3);
  });

  it('returns -1 when no match', () => {
    expect(findLastIndex([1, 2, 3], (n) => n === 5)).toBe(-1);
  });

  it('handles empty array', () => {
    expect(findLastIndex([], () => true)).toBe(-1);
  });

  it('returns first element when only match', () => {
    expect(findLastIndex([1, 2, 3], (n) => n === 1)).toBe(0);
  });
});

// ── fileTypeIcon ──────────────────────────────────────────────────────────

describe('fileTypeIcon', () => {
  it('returns "image" for image MIME types', () => {
    expect(fileTypeIcon('image/png')).toBe('image');
    expect(fileTypeIcon('image/jpeg')).toBe('image');
    expect(fileTypeIcon('image/svg+xml')).toBe('image');
  });

  it('returns "file-text" for PDF and text types', () => {
    expect(fileTypeIcon('application/pdf')).toBe('file-text');
    expect(fileTypeIcon('text/plain')).toBe('file-text');
    expect(fileTypeIcon('text/html')).toBe('file-text');
  });

  it('returns generic "file" for unknown types', () => {
    expect(fileTypeIcon('application/zip')).toBe('file');
    expect(fileTypeIcon('application/octet-stream')).toBe('file');
  });
});

// ── fmtK ──────────────────────────────────────────────────────────────────

describe('fmtK', () => {
  it('formats small numbers as-is', () => {
    expect(fmtK(0)).toBe('0');
    expect(fmtK(500)).toBe('500');
    expect(fmtK(999)).toBe('999');
  });

  it('formats 1000+ as K suffix', () => {
    expect(fmtK(1000)).toBe('1.0K');
    expect(fmtK(1500)).toBe('1.5K');
    expect(fmtK(128000)).toBe('128.0K');
  });
});

// ── estimateContextBreakdown ──────────────────────────────────────────────

describe('estimateContextBreakdown', () => {
  it('returns zero percentages for zero usage', () => {
    const result = estimateContextBreakdown({
      sessionTokensUsed: 0,
      modelContextLimit: 128000,
      sessionInputTokens: 0,
      sessionOutputTokens: 0,
      sessionToolResultTokens: 0,
      messages: [],
    });
    expect(result.total).toBe(0);
    expect(result.pct).toBe(0);
    expect(result.system).toBe(0);
  });

  it('computes breakdown correctly with usage data', () => {
    const result = estimateContextBreakdown({
      sessionTokensUsed: 5000,
      modelContextLimit: 128000,
      sessionInputTokens: 3000,
      sessionOutputTokens: 2000,
      sessionToolResultTokens: 500,
      messages: [
        { content: 'Hello there' }, // ~7 chars → ceil(7/4) + 4 = 6 tokens
        { content: 'I can help with that, let me explain in detail.' }, // ~48 chars → ceil(48/4) + 4 = 16 tokens
      ],
    });
    expect(result.total).toBe(5000);
    expect(result.limit).toBe(128000);
    expect(result.pct).toBeCloseTo(3.90625, 2);
    expect(result.output).toBe(2000);
    expect(result.toolResults).toBe(500);
    // system = input - msgs - toolResults = 3000 - 22 - 500 = 2478
    expect(result.system).toBeGreaterThan(0);
  });

  it('caps percentage at 100 when over limit', () => {
    const result = estimateContextBreakdown({
      sessionTokensUsed: 200000,
      modelContextLimit: 128000,
      sessionInputTokens: 150000,
      sessionOutputTokens: 50000,
      sessionToolResultTokens: 0,
      messages: [],
    });
    expect(result.pct).toBe(100);
  });

  it('handles zero context limit gracefully', () => {
    const result = estimateContextBreakdown({
      sessionTokensUsed: 100,
      modelContextLimit: 0,
      sessionInputTokens: 50,
      sessionOutputTokens: 50,
      sessionToolResultTokens: 0,
      messages: [],
    });
    expect(result.pct).toBe(0);
  });
});
