import { describe, it, expect, beforeEach } from 'vitest';
import {
  createLogger,
  setLogLevel,
  getLogLevel,
  getRecentLogs,
  clearLogBuffer,
  getLogCounts,
} from './logger';

beforeEach(() => {
  clearLogBuffer();
  setLogLevel('debug');
});

describe('createLogger', () => {
  it('creates a logger with all level methods', () => {
    const log = createLogger('test');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
  });

  it('logs to the ring buffer', () => {
    const log = createLogger('engine');
    log.info('Session started', { sessionId: 's1' });
    const logs = getRecentLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe('Session started');
    expect(logs[0].module).toBe('engine');
    expect(logs[0].level).toBe('info');
    expect(logs[0].data).toEqual({ sessionId: 's1' });
  });
});

describe('setLogLevel / getLogLevel', () => {
  it('defaults to info', () => {
    setLogLevel('info');
    expect(getLogLevel()).toBe('info');
  });

  it('suppresses lower levels', () => {
    setLogLevel('warn');
    const log = createLogger('test');
    log.debug('should not appear');
    log.info('should not appear');
    log.warn('should appear');
    log.error('should appear');
    const logs = getRecentLogs();
    expect(logs.length).toBe(2);
    expect(logs[0].level).toBe('warn');
    expect(logs[1].level).toBe('error');
  });
});

describe('getRecentLogs', () => {
  it('returns requested count', () => {
    const log = createLogger('test');
    for (let i = 0; i < 10; i++) log.info(`msg ${i}`);
    expect(getRecentLogs(3).length).toBe(3);
  });
});

describe('clearLogBuffer', () => {
  it('clears all logs', () => {
    createLogger('test').info('test');
    expect(getRecentLogs().length).toBe(1);
    clearLogBuffer();
    expect(getRecentLogs().length).toBe(0);
  });
});

describe('getLogCounts', () => {
  it('counts by level', () => {
    const log = createLogger('test');
    log.debug('d');
    log.info('i');
    log.info('i2');
    log.warn('w');
    log.error('e');
    const counts = getLogCounts();
    expect(counts.debug).toBe(1);
    expect(counts.info).toBe(2);
    expect(counts.warn).toBe(1);
    expect(counts.error).toBe(1);
  });
});
