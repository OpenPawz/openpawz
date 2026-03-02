import { describe, it, expect } from 'vitest';
import {
  escHtml,
  escAttr,
  formatBytes,
  formatMarkdown,
  formatTimeAgo,
  icon,
  providerIcon,
  PROVIDER_ICONS,
} from './helpers';

// ── escHtml ────────────────────────────────────────────────────────────────

describe('escHtml (helpers)', () => {
  it('escapes all five HTML entities', () => {
    expect(escHtml('& < > " \'')).toBe('&amp; &lt; &gt; &quot; &#39;');
  });

  it('handles empty string', () => {
    expect(escHtml('')).toBe('');
  });

  it('escapes a full XSS payload', () => {
    expect(escHtml('<img onerror="alert(1)" src=x>')).toBe(
      '&lt;img onerror=&quot;alert(1)&quot; src=x&gt;',
    );
  });

  it('leaves safe text untouched', () => {
    expect(escHtml('hello world')).toBe('hello world');
  });

  it('escapes single quotes (unlike community version)', () => {
    expect(escHtml("it's")).toBe('it&#39;s');
  });
});

// ── escAttr ────────────────────────────────────────────────────────────────

describe('escAttr', () => {
  it('escapes HTML entities', () => {
    expect(escAttr('<"hello">')).toContain('&lt;');
    expect(escAttr('<"hello">')).toContain('&quot;');
  });

  it('escapes newlines to &#10;', () => {
    expect(escAttr('line1\nline2')).toBe('line1&#10;line2');
  });

  it('handles empty string', () => {
    expect(escAttr('')).toBe('');
  });

  it('escapes combined HTML + newlines', () => {
    const result = escAttr('a & b\nc > d');
    expect(result).toContain('&amp;');
    expect(result).toContain('&#10;');
    expect(result).toContain('&gt;');
  });
});

// ── formatBytes ────────────────────────────────────────────────────────────

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(10240)).toBe('10.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB');
    expect(formatBytes(2621440)).toBe('2.5 MB');
  });

  it('handles exact boundary values', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });
});

// ── formatMarkdown ─────────────────────────────────────────────────────────

describe('formatMarkdown', () => {
  it('renders bold', () => {
    expect(formatMarkdown('**bold**')).toContain('<strong>bold</strong>');
  });

  it('renders italic', () => {
    expect(formatMarkdown('*italic*')).toContain('<em>italic</em>');
  });

  it('renders inline code', () => {
    expect(formatMarkdown('`code`')).toContain('<code>code</code>');
  });

  it('renders headings', () => {
    expect(formatMarkdown('# H1')).toContain('<h2>H1</h2>');
    expect(formatMarkdown('## H2')).toContain('<h3>H2</h3>');
    expect(formatMarkdown('### H3')).toContain('<h4>H3</h4>');
  });

  it('converts newlines to <br>', () => {
    expect(formatMarkdown('line1\nline2')).toContain('<br>');
  });

  it('escapes HTML before rendering markdown', () => {
    expect(formatMarkdown('<script>alert(1)</script>')).not.toContain('<script>');
    expect(formatMarkdown('<script>alert(1)</script>')).toContain('&lt;script&gt;');
  });

  it('handles empty string', () => {
    expect(formatMarkdown('')).toBe('');
  });

  it('handles mixed markdown', () => {
    const result = formatMarkdown('**bold** and *italic* with `code`');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<em>italic</em>');
    expect(result).toContain('<code>code</code>');
  });
});

// ── formatTimeAgo ──────────────────────────────────────────────────────────

describe('formatTimeAgo', () => {
  it('shows "just now" for recent times', () => {
    const now = new Date();
    expect(formatTimeAgo(now)).toBe('just now');
  });

  it('shows minutes', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatTimeAgo(fiveMinAgo)).toBe('5m ago');
  });

  it('shows hours', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    expect(formatTimeAgo(twoHoursAgo)).toBe('2h ago');
  });

  it('shows days', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400 * 1000);
    expect(formatTimeAgo(threeDaysAgo)).toBe('3d ago');
  });

  it('shows localized date for old entries', () => {
    const longAgo = new Date(Date.now() - 60 * 86400 * 1000);
    // Should be a localized date string, not minutes/hours/days
    const result = formatTimeAgo(longAgo);
    expect(result).not.toContain('ago');
  });

  it('accepts ISO string input', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatTimeAgo(fiveMinAgo)).toBe('5m ago');
  });

  it('accepts Date object input', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatTimeAgo(fiveMinAgo)).toBe('5m ago');
  });
});

// ── icon ───────────────────────────────────────────────────────────────────

describe('icon', () => {
  it('renders a Material Symbols span', () => {
    const result = icon('send');
    expect(result).toBe('<span class="ms">send</span>');
  });

  it('maps known aliases', () => {
    expect(icon('paperclip')).toContain('attach_file');
    expect(icon('arrow-up')).toContain('send');
    expect(icon('x')).toContain('close');
  });

  it('appends extra class', () => {
    const result = icon('send', 'ms-sm');
    expect(result).toBe('<span class="ms ms-sm">send</span>');
  });

  it('passes through unknown icons as ligature', () => {
    expect(icon('home')).toBe('<span class="ms">home</span>');
  });
});

// ── providerIcon ───────────────────────────────────────────────────────────

describe('providerIcon', () => {
  it('renders known provider icon', () => {
    const result = providerIcon('ollama');
    expect(result).toContain('pets');
    expect(result).toContain('ms-sm');
  });

  it('falls back to "build" for unknown provider', () => {
    const result = providerIcon('unknown');
    expect(result).toContain('build');
  });

  it('respects custom size class', () => {
    const result = providerIcon('openai', 'ms-lg');
    expect(result).toContain('ms-lg');
    expect(result).toContain('smart_toy');
  });
});

// ── PROVIDER_ICONS ─────────────────────────────────────────────────────────

describe('PROVIDER_ICONS', () => {
  it('has all major providers', () => {
    expect(PROVIDER_ICONS).toHaveProperty('ollama');
    expect(PROVIDER_ICONS).toHaveProperty('openai');
    expect(PROVIDER_ICONS).toHaveProperty('anthropic');
    expect(PROVIDER_ICONS).toHaveProperty('google');
  });

  it('all values are non-empty strings', () => {
    for (const val of Object.values(PROVIDER_ICONS)) {
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
    }
  });
});
