import { describe, it, expect } from 'vitest';
import {
  parseConditionExpr,
  resolvePath,
  compareValues,
  evaluateBuiltinCondition,
  evaluateSmartCondition,
} from './smart-condition-atoms';

// ── parseConditionExpr ─────────────────────────────────────────────────────

describe('parseConditionExpr', () => {
  it('parses equality', () => {
    const r = parseConditionExpr('status === 200');
    expect(r).toEqual({ left: 'status', operator: '===', right: '200' });
  });

  it('parses inequality', () => {
    const r = parseConditionExpr('a !== b');
    expect(r).toEqual({ left: 'a', operator: '!==', right: 'b' });
  });

  it('parses loose equality', () => {
    const r = parseConditionExpr('x == "hello"');
    expect(r).toEqual({ left: 'x', operator: '==', right: '"hello"' });
  });

  it('parses greater than', () => {
    const r = parseConditionExpr('count > 10');
    expect(r).toEqual({ left: 'count', operator: '>', right: '10' });
  });

  it('parses less than', () => {
    const r = parseConditionExpr('price < 99.99');
    expect(r).toEqual({ left: 'price', operator: '<', right: '99.99' });
  });

  it('parses >=', () => {
    const r = parseConditionExpr('score >= 80');
    expect(r).toEqual({ left: 'score', operator: '>=', right: '80' });
  });

  it('parses <=', () => {
    const r = parseConditionExpr('age <= 30');
    expect(r).toEqual({ left: 'age', operator: '<=', right: '30' });
  });

  it('returns null for no operator', () => {
    expect(parseConditionExpr('justAVariable')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseConditionExpr('')).toBeNull();
  });

  it('handles dotted paths', () => {
    const r = parseConditionExpr('data.status === 200');
    expect(r).toEqual({ left: 'data.status', operator: '===', right: '200' });
  });

  it('handles quoted string on right', () => {
    const r = parseConditionExpr('data.type === "error"');
    expect(r).toEqual({ left: 'data.type', operator: '===', right: '"error"' });
  });
});

// ── resolvePath ────────────────────────────────────────────────────────────

describe('resolvePath', () => {
  it('returns rawInput for "input"', () => {
    expect(resolvePath('input', null, 'hello')).toBe('hello');
  });

  it('resolves boolean literals', () => {
    expect(resolvePath('true', null)).toBe(true);
    expect(resolvePath('false', null)).toBe(false);
  });

  it('resolves null and undefined', () => {
    expect(resolvePath('null', null)).toBeNull();
    expect(resolvePath('undefined', null)).toBeUndefined();
  });

  it('resolves numeric literals', () => {
    expect(resolvePath('42', null)).toBe(42);
    expect(resolvePath('3.14', null)).toBe(3.14);
    expect(resolvePath('0', null)).toBe(0);
  });

  it('resolves quoted strings', () => {
    expect(resolvePath('"hello"', null)).toBe('hello');
    expect(resolvePath("'world'", null)).toBe('world');
  });

  it('resolves dot-path on object', () => {
    const data = { user: { name: 'Alice', age: 30 } };
    expect(resolvePath('user.name', data)).toBe('Alice');
    expect(resolvePath('user.age', data)).toBe(30);
  });

  it('resolves array index', () => {
    const data = { items: ['a', 'b', 'c'] };
    expect(resolvePath('items[0]', data)).toBe('a');
    expect(resolvePath('items[2]', data)).toBe('c');
  });

  it('returns undefined for missing path', () => {
    const data = { user: { name: 'Alice' } };
    expect(resolvePath('user.email', data)).toBeUndefined();
  });

  it('returns undefined for null traversal', () => {
    expect(resolvePath('a.b.c', null)).toBeUndefined();
  });

  it('handles "data" prefix shortcut', () => {
    // When the data object doesn't have a 'data' key, 'data.' is stripped
    const obj = { status: 200, items: [1, 2, 3] };
    expect(resolvePath('data.status', obj)).toBe(200);
  });
});

// ── compareValues ──────────────────────────────────────────────────────────

describe('compareValues', () => {
  it('strict equality', () => {
    expect(compareValues(1, '===', 1)).toBe(true);
    expect(compareValues(1, '===', '1')).toBe(false);
    expect(compareValues('abc', '===', 'abc')).toBe(true);
  });

  it('strict inequality', () => {
    expect(compareValues(1, '!==', 2)).toBe(true);
    expect(compareValues(1, '!==', 1)).toBe(false);
  });

  it('loose equality', () => {
    expect(compareValues(1, '==', '1')).toBe(true);
    expect(compareValues(null, '==', undefined)).toBe(true);
  });

  it('loose inequality', () => {
    expect(compareValues(1, '!=', 2)).toBe(true);
    expect(compareValues(1, '!=', '1')).toBe(false);
  });

  it('greater than', () => {
    expect(compareValues(10, '>', 5)).toBe(true);
    expect(compareValues(5, '>', 10)).toBe(false);
    expect(compareValues(5, '>', 5)).toBe(false);
  });

  it('less than', () => {
    expect(compareValues(3, '<', 7)).toBe(true);
    expect(compareValues(7, '<', 3)).toBe(false);
  });

  it('greater than or equal', () => {
    expect(compareValues(10, '>=', 10)).toBe(true);
    expect(compareValues(11, '>=', 10)).toBe(true);
    expect(compareValues(9, '>=', 10)).toBe(false);
  });

  it('less than or equal', () => {
    expect(compareValues(5, '<=', 5)).toBe(true);
    expect(compareValues(4, '<=', 5)).toBe(true);
    expect(compareValues(6, '<=', 5)).toBe(false);
  });

  it('returns false for unknown operator', () => {
    expect(compareValues(1, '~=', 1)).toBe(false);
  });
});

// ── evaluateBuiltinCondition ───────────────────────────────────────────────

describe('evaluateBuiltinCondition', () => {
  it('recognizes "true"', () => {
    const r = evaluateBuiltinCondition('true');
    expect(r).not.toBeNull();
    expect(r!.result).toBe(true);
    expect(r!.method).toBe('structured');
  });

  it('recognizes "yes"', () => {
    const r = evaluateBuiltinCondition('yes');
    expect(r).not.toBeNull();
    expect(r!.result).toBe(true);
  });

  it('recognizes "false"', () => {
    const r = evaluateBuiltinCondition('false');
    expect(r).not.toBeNull();
    expect(r!.result).toBe(false);
  });

  it('recognizes "no"', () => {
    const r = evaluateBuiltinCondition('no');
    expect(r).not.toBeNull();
    expect(r!.result).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(evaluateBuiltinCondition('TRUE')!.result).toBe(true);
    expect(evaluateBuiltinCondition('FALSE')!.result).toBe(false);
    expect(evaluateBuiltinCondition('Yes')!.result).toBe(true);
  });

  it('returns null for "input" (needs context)', () => {
    expect(evaluateBuiltinCondition('input')).toBeNull();
  });

  it('returns null for unknown expressions', () => {
    expect(evaluateBuiltinCondition('x > 5')).toBeNull();
    expect(evaluateBuiltinCondition('some random text')).toBeNull();
  });
});

// ── evaluateSmartCondition ─────────────────────────────────────────────────

describe('evaluateSmartCondition', () => {
  it('evaluates boolean literals', () => {
    expect(evaluateSmartCondition('true', '')?.result).toBe(true);
    expect(evaluateSmartCondition('false', '')?.result).toBe(false);
  });

  it('evaluates simple comparison on JSON data', () => {
    const input = JSON.stringify({ status: 200 });
    const result = evaluateSmartCondition('data.status === 200', input);
    expect(result).not.toBeNull();
    expect(result!.result).toBe(true);
    expect(result!.method).toBe('structured');
  });

  it('evaluates inequality on JSON data', () => {
    const input = JSON.stringify({ status: 404 });
    const result = evaluateSmartCondition('data.status !== 200', input);
    expect(result).not.toBeNull();
    expect(result!.result).toBe(true);
  });

  it('evaluates greater-than comparison', () => {
    const input = JSON.stringify({ count: 15 });
    const result = evaluateSmartCondition('data.count > 10', input);
    expect(result).not.toBeNull();
    expect(result!.result).toBe(true);
  });

  it('evaluates string comparison', () => {
    const input = JSON.stringify({ type: 'error' });
    const result = evaluateSmartCondition('data.type === "error"', input);
    expect(result).not.toBeNull();
    expect(result!.result).toBe(true);
  });

  it('evaluates compound && condition', () => {
    const input = JSON.stringify({ status: 200, items: [1, 2, 3] });
    const result = evaluateSmartCondition('data.status === 200 && data.items', input);
    expect(result).not.toBeNull();
    expect(result!.result).toBe(true);
  });

  it('evaluates compound || condition', () => {
    const input = JSON.stringify({ status: 404 });
    const result = evaluateSmartCondition('data.status === 200 || data.status === 404', input);
    expect(result).not.toBeNull();
    expect(result!.result).toBe(true);
  });

  it('evaluates truthiness check on existing property', () => {
    const input = JSON.stringify({ name: 'Alice' });
    const result = evaluateSmartCondition('data.name', input);
    expect(result).not.toBeNull();
    expect(result!.result).toBe(true);
  });

  it('evaluates truthiness check on falsy property', () => {
    const input = JSON.stringify({ count: 0 });
    const result = evaluateSmartCondition('data.count', input);
    expect(result).not.toBeNull();
    expect(result!.result).toBe(false);
  });

  it('returns null for empty expression', () => {
    expect(evaluateSmartCondition('', 'data')).toBeNull();
  });

  it('handles non-JSON input gracefully', () => {
    // "input" as raw text should still allow comparisons
    const result = evaluateSmartCondition('true', 'not json');
    expect(result).not.toBeNull();
    expect(result!.result).toBe(true);
  });
});
