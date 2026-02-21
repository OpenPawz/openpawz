import { describe, it, expect } from 'vitest';
import {
  estimateMessageTokens,
  analyzeCompactionNeed,
  formatCompactionResult,
  DEFAULT_COMPACTION_CONFIG,
} from './atoms';
import type { EngineStoredMessage } from '../../engine';

const makeMsg = (content: string, toolCalls = ''): EngineStoredMessage => ({
  id: '1',
  session_id: 's1',
  role: 'assistant',
  content,
  tool_calls_json: toolCalls,
  created_at: new Date().toISOString(),
});

// ── estimateMessageTokens ──────────────────────────────────────────────

describe('estimateMessageTokens', () => {
  it('estimates ~1 token per 4 chars + overhead', () => {
    const msg = makeMsg('Hello world! This is a test message.');
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(50);
  });

  it('includes tool calls in estimate', () => {
    const msg = makeMsg('short', '{"name":"read_file","args":{}}');
    const withoutTool = estimateMessageTokens(makeMsg('short'));
    expect(estimateMessageTokens(msg)).toBeGreaterThan(withoutTool);
  });

  it('handles empty message', () => {
    const msg = makeMsg('');
    expect(estimateMessageTokens(msg)).toBeGreaterThanOrEqual(4); // overhead
  });
});

// ── analyzeCompactionNeed ──────────────────────────────────────────────

describe('analyzeCompactionNeed', () => {
  it('says no compaction needed for few messages', () => {
    const msgs = Array.from({ length: 5 }, (_, i) => makeMsg(`msg ${i}`));
    const stats = analyzeCompactionNeed(msgs);
    expect(stats.needsCompaction).toBe(false);
    expect(stats.messageCount).toBe(5);
  });

  it('says compaction needed for many long messages', () => {
    const longContent = 'x'.repeat(10000);
    const msgs = Array.from({ length: 25 }, () => makeMsg(longContent));
    const stats = analyzeCompactionNeed(msgs);
    expect(stats.needsCompaction).toBe(true);
    expect(stats.toSummarize).toBe(25 - DEFAULT_COMPACTION_CONFIG.keepRecent);
    expect(stats.toKeep).toBe(DEFAULT_COMPACTION_CONFIG.keepRecent);
  });

  it('respects custom config', () => {
    const msgs = Array.from({ length: 10 }, () => makeMsg('x'.repeat(40000)));
    const stats = analyzeCompactionNeed(msgs, {
      minMessages: 5,
      tokenThreshold: 1000,
      keepRecent: 3,
    });
    expect(stats.needsCompaction).toBe(true);
    expect(stats.toKeep).toBe(3);
  });
});

// ── formatCompactionResult ─────────────────────────────────────────────

describe('formatCompactionResult', () => {
  it('formats result with reduction percentage', () => {
    const text = formatCompactionResult({
      messages_before: 50,
      messages_after: 10,
      tokens_before: 60000,
      tokens_after: 15000,
      summary_length: 500,
    });
    expect(text).toContain('50 → 10');
    expect(text).toContain('75%');
    expect(text).toContain('500 chars');
  });

  it('handles zero tokens gracefully', () => {
    const text = formatCompactionResult({
      messages_before: 0,
      messages_after: 0,
      tokens_before: 0,
      tokens_after: 0,
      summary_length: 0,
    });
    expect(text).toContain('0%');
  });
});
