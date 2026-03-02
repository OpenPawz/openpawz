import { describe, it, expect } from 'vitest';
import { resolveVariables, parseLoopArray } from './variable-atoms';

// ── resolveVariables ───────────────────────────────────────────────────────

describe('resolveVariables', () => {
  it('resolves {{input}} with input value', () => {
    expect(resolveVariables('Hello {{input}}!', { input: 'World' })).toBe('Hello World!');
  });

  it('resolves multiple {{input}} occurrences', () => {
    expect(resolveVariables('{{input}} and {{input}}', { input: 'A' })).toBe('A and A');
  });

  it('resolves {{flow.key}} from variables', () => {
    expect(
      resolveVariables('API: {{flow.apiUrl}}', {
        variables: { apiUrl: 'https://api.example.com' },
      }),
    ).toBe('API: https://api.example.com');
  });

  it('leaves unresolved flow variables as-is', () => {
    expect(resolveVariables('{{flow.missing}}', { variables: {} })).toBe('{{flow.missing}}');
  });

  it('resolves {{vault.NAME}} from vault credentials', () => {
    expect(
      resolveVariables('Key: {{vault.openai}}', { vaultCredentials: { openai: 'sk-test' } }),
    ).toBe('Key: sk-test');
  });

  it('leaves unresolved vault variables as-is', () => {
    expect(resolveVariables('{{vault.missing}}', { vaultCredentials: {} })).toBe(
      '{{vault.missing}}',
    );
  });

  it('resolves {{loop.index}}', () => {
    expect(resolveVariables('Item {{loop.index}}', { loopIndex: 3 })).toBe('Item 3');
  });

  it('resolves {{loop.item}} with string', () => {
    expect(resolveVariables('Processing: {{loop.item}}', { loopItem: 'apple' })).toBe(
      'Processing: apple',
    );
  });

  it('resolves {{loop.item}} with object', () => {
    const result = resolveVariables('Data: {{loop.item}}', { loopItem: { id: 1 } });
    expect(result).toBe('Data: {"id":1}');
  });

  it('resolves custom loop variable name', () => {
    const result = resolveVariables('File: {{loop.file}}', {
      loopItem: 'readme.md',
      loopVar: 'file',
    });
    expect(result).toBe('File: readme.md');
  });

  it('handles empty template', () => {
    expect(resolveVariables('', { input: 'test' })).toBe('');
  });

  it('handles template with no variables', () => {
    expect(resolveVariables('plain text', {})).toBe('plain text');
  });

  it('handles flow variable with non-string value', () => {
    const result = resolveVariables('Count: {{flow.count}}', { variables: { count: 42 } });
    expect(result).toBe('Count: 42');
  });

  it('handles combined variables in one template', () => {
    const result = resolveVariables('{{input}} for {{flow.name}} at {{loop.index}}', {
      input: 'data',
      variables: { name: 'test' },
      loopIndex: 0,
    });
    expect(result).toBe('data for test at 0');
  });
});

// ── parseLoopArray ─────────────────────────────────────────────────────────

describe('parseLoopArray', () => {
  it('parses JSON array', () => {
    const result = parseLoopArray('[1, 2, 3]');
    expect(result).toEqual([1, 2, 3]);
  });

  it('wraps non-array JSON in an array', () => {
    const result = parseLoopArray('{"key": "value"}');
    expect(result).toEqual([{ key: 'value' }]);
  });

  it('parses newline-separated text', () => {
    const result = parseLoopArray('apple\nbanana\ncherry');
    expect(result).toEqual(['apple', 'banana', 'cherry']);
  });

  it('filters empty lines from text', () => {
    const result = parseLoopArray('apple\n\nbanana\n');
    expect(result).toEqual(['apple', 'banana']);
  });

  it('returns empty array for empty input', () => {
    expect(parseLoopArray('')).toEqual([]);
  });

  it('uses loopOver dot-path on JSON object', () => {
    const input = JSON.stringify({ data: { items: ['a', 'b', 'c'] } });
    expect(parseLoopArray(input, 'data.items')).toEqual(['a', 'b', 'c']);
  });

  it('handles nested dot-path', () => {
    const input = JSON.stringify({ response: { data: { list: [1, 2] } } });
    expect(parseLoopArray(input, 'response.data.list')).toEqual([1, 2]);
  });

  it('wraps non-array loopOver result in array', () => {
    const input = JSON.stringify({ config: { name: 'test' } });
    expect(parseLoopArray(input, 'config.name')).toEqual(['test']);
  });

  it('returns [data] when loopOver path traverses into non-object', () => {
    const input = JSON.stringify({ x: 1 });
    const result = parseLoopArray(input, 'nonexistent.path');
    // When path traversal hits a non-object early, fallback is [data]
    expect(result).toEqual([{ x: 1 }]);
  });

  it('handles loopOver on non-JSON text input', () => {
    // When input isn't parseable as JSON and loopOver specified
    const result = parseLoopArray('raw text', 'items');
    expect(Array.isArray(result)).toBe(true);
  });
});
