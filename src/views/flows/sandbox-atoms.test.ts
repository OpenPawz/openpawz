import { describe, it, expect } from 'vitest';
import { formatMs, executeCodeSandboxed } from './sandbox-atoms';

// ── formatMs ───────────────────────────────────────────────────────────────

describe('formatMs', () => {
  it('formats milliseconds', () => {
    expect(formatMs(0)).toBe('0ms');
    expect(formatMs(100)).toBe('100ms');
    expect(formatMs(999)).toBe('999ms');
  });

  it('formats seconds', () => {
    expect(formatMs(1000)).toBe('1.0s');
    expect(formatMs(1500)).toBe('1.5s');
    expect(formatMs(30000)).toBe('30.0s');
    expect(formatMs(59999)).toBe('60.0s');
  });

  it('formats minutes', () => {
    expect(formatMs(60000)).toBe('1.0m');
    expect(formatMs(90000)).toBe('1.5m');
    expect(formatMs(300000)).toBe('5.0m');
  });
});

// ── executeCodeSandboxed ───────────────────────────────────────────────────

describe('executeCodeSandboxed', () => {
  it('executes simple return statement', () => {
    const result = executeCodeSandboxed('return 42;', '');
    expect(result.output).toContain('42');
    expect(result.error).toBeUndefined();
  });

  it('receives input as string', () => {
    const result = executeCodeSandboxed('return input;', 'hello');
    expect(result.output).toBe('hello');
  });

  it('receives parsed data', () => {
    const result = executeCodeSandboxed('return data.name;', '{"name":"Alice"}');
    expect(result.output).toBe('Alice');
  });

  it('data is null when input is not valid JSON', () => {
    const result = executeCodeSandboxed('return data;', 'not json');
    expect(result.output).toBe('Code executed (no output)');
  });

  it('captures console.log output', () => {
    const result = executeCodeSandboxed('console.log("hello");', '');
    expect(result.output).toContain('hello');
  });

  it('captures console.warn output', () => {
    const result = executeCodeSandboxed('console.warn("warning!");', '');
    expect(result.output).toContain('[warn]');
    expect(result.output).toContain('warning!');
  });

  it('blocks window access', () => {
    const result = executeCodeSandboxed('return window.location;', '');
    expect(result.error).toContain('Blocked');
    expect(result.error).toContain('window');
  });

  it('blocks document access', () => {
    const result = executeCodeSandboxed('return document.getElementById("x");', '');
    expect(result.error).toContain('Blocked');
    expect(result.error).toContain('document');
  });

  it('blocks fetch', () => {
    const result = executeCodeSandboxed('return fetch("http://evil.com");', '');
    expect(result.error).toContain('Blocked');
  });

  it('blocks eval', () => {
    const result = executeCodeSandboxed('return eval("1+1");', '');
    expect(result.error).toContain('Blocked');
  });

  it('blocks require', () => {
    const result = executeCodeSandboxed('return require("fs");', '');
    expect(result.error).toContain('Blocked');
  });

  it('blocks import()', () => {
    const result = executeCodeSandboxed('return import("module");', '');
    expect(result.error).toContain('Blocked');
  });

  it('blocks process access', () => {
    const result = executeCodeSandboxed('return process.env;', '');
    expect(result.error).toContain('Blocked');
  });

  it('blocks __proto__ access', () => {
    const result = executeCodeSandboxed('return {}.__proto__;', '');
    expect(result.error).toContain('Blocked');
  });

  it('handles runtime errors gracefully', () => {
    const result = executeCodeSandboxed('throw new Error("boom");', '');
    expect(result.error).toBe('boom');
    expect(result.output).toBe('');
  });

  it('handles syntax errors gracefully', () => {
    const result = executeCodeSandboxed('function {{{', '');
    expect(result.error).toBeTruthy();
  });

  it('allows Math, JSON, Array, Object', () => {
    const result = executeCodeSandboxed(
      'return JSON.stringify({ pi: Math.round(Math.PI * 100) / 100, arr: Array.from([1,2,3]) });',
      '',
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('3.14');
    expect(result.output).toContain('[1,2,3]');
  });

  it('allows string manipulation', () => {
    const result = executeCodeSandboxed('return input.toUpperCase();', 'hello');
    expect(result.output).toBe('HELLO');
  });

  it('stringifies object return values', () => {
    const result = executeCodeSandboxed('return { key: "value" };', '');
    expect(result.output).toContain('"key"');
    expect(result.output).toContain('"value"');
  });

  it('reports no output for void return', () => {
    const result = executeCodeSandboxed('var x = 1;', '');
    expect(result.output).toBe('Code executed (no output)');
  });
});
