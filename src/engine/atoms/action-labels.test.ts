import { describe, it, expect } from 'vitest';
import {
  translateAction,
  detectOutputType,
  computeStats,
  formatDuration,
  timeAgo,
} from './action-labels';
import type { IntegrationActionLog } from './action-labels';

// ── translateAction ────────────────────────────────────────────────────

describe('translateAction', () => {
  it('translates slack post_message with channel input', () => {
    const label = translateAction('slack', 'post_message', { channel: '#general' });
    expect(label).toBe('Sent message to #general');
  });

  it('translates slack search with query input', () => {
    const label = translateAction('slack', 'search', { query: 'deployment' });
    expect(label).toContain('Searched Slack');
    expect(label).toContain('deployment');
  });

  it('translates github create_issue with title and repo', () => {
    const label = translateAction('github', 'create_issue', {
      title: 'Fix bug',
      repo: 'openpawz',
    });
    expect(label).toContain('Created issue');
    expect(label).toContain('Fix bug');
    expect(label).toContain('openpawz');
  });

  it('translates github create_pr', () => {
    const label = translateAction('github', 'create_pr', {
      title: 'Add tests',
      repo: 'openpawz',
    });
    expect(label).toContain('Created PR');
    expect(label).toContain('Add tests');
  });

  it('translates github comment with issue number', () => {
    const label = translateAction('github', 'comment', { issue_number: '42' });
    expect(label).toContain('Commented on #42');
  });

  it('translates gmail send with subject and recipient', () => {
    const label = translateAction('gmail', 'send', { subject: 'Hello', to: 'user@test.com' });
    expect(label).toContain("Sent email 'Hello'");
    expect(label).toContain('user@test.com');
  });

  it('translates gmail list as searched emails', () => {
    const label = translateAction('gmail', 'list');
    expect(label).toBe('Searched emails');
  });

  it('translates jira create_issue with summary', () => {
    const label = translateAction('jira', 'create_issue', { summary: 'Fix login' });
    expect(label).toContain("Created ticket 'Fix login'");
  });

  it('translates trello create_card with name', () => {
    const label = translateAction('trello', 'create_card', { name: 'New feature' });
    expect(label).toContain("Created card 'New feature'");
  });

  it('translates hubspot list_deals', () => {
    const label = translateAction('hubspot', 'list_deals');
    expect(label).toBe('Fetched deals');
  });

  it('translates notion create_page', () => {
    const label = translateAction('notion', 'create_page', { title: 'Meeting notes' });
    expect(label).toContain("Created page 'Meeting notes'");
  });

  it('falls back to title-cased action for unknown service', () => {
    const label = translateAction('unknown_service', 'do_something');
    expect(label).toContain('unknown_service');
    expect(label).toContain('Do Something');
  });

  it('falls back to title-cased action for unknown action on known service', () => {
    const label = translateAction('slack', 'custom_unknown_action');
    expect(label).toContain('Custom Unknown Action');
  });

  it('handles missing input gracefully', () => {
    const label = translateAction('slack', 'post_message');
    expect(label).toContain('(channel)');
  });

  it('truncates long input values to 60 chars', () => {
    const longTitle = 'A'.repeat(100);
    const label = translateAction('github', 'create_issue', { title: longTitle, repo: 'test' });
    expect(label).toContain('…');
    expect(label.length).toBeLessThan(200);
  });
});

// ── detectOutputType ───────────────────────────────────────────────────

describe('detectOutputType', () => {
  it('returns table for list action with array result', () => {
    expect(detectOutputType('list_issues', [{ id: 1 }, { id: 2 }])).toBe('table');
  });

  it('returns table for search action with items object', () => {
    expect(detectOutputType('search', { items: [1, 2] })).toBe('table');
  });

  it('returns summary for list action without array result', () => {
    expect(detectOutputType('list_issues', 'no results')).toBe('summary');
  });

  it('returns notification for message action', () => {
    expect(detectOutputType('post_message')).toBe('notification');
  });

  it('returns notification for notification action', () => {
    expect(detectOutputType('send_notification')).toBe('notification');
  });

  it('returns timeline for log action', () => {
    expect(detectOutputType('activity_log')).toBe('timeline');
  });

  it('returns timeline for history action', () => {
    expect(detectOutputType('get_history')).toBe('timeline');
  });

  it('returns summary as default', () => {
    expect(detectOutputType('create_issue')).toBe('summary');
  });
});

// ── computeStats ───────────────────────────────────────────────────────

describe('computeStats', () => {
  const makeLog = (
    service: string,
    serviceName: string,
    status: 'success' | 'failed' | 'running',
  ): IntegrationActionLog => ({
    id: Math.random().toString(),
    timestamp: new Date().toISOString(),
    service,
    serviceName,
    action: 'test',
    actionLabel: 'Test',
    summary: '',
    agent: 'agent-1',
    status,
    durationMs: 100,
  });

  it('returns zero counts for empty array', () => {
    const stats = computeStats([]);
    expect(stats.total).toBe(0);
    expect(stats.success).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.running).toBe(0);
    expect(Object.keys(stats.byService)).toHaveLength(0);
  });

  it('counts success, failed, and running correctly', () => {
    const actions = [
      makeLog('slack', 'Slack', 'success'),
      makeLog('slack', 'Slack', 'success'),
      makeLog('github', 'GitHub', 'failed'),
      makeLog('gmail', 'Gmail', 'running'),
    ];
    const stats = computeStats(actions);
    expect(stats.total).toBe(4);
    expect(stats.success).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.running).toBe(1);
  });

  it('groups by service correctly', () => {
    const actions = [
      makeLog('slack', 'Slack', 'success'),
      makeLog('slack', 'Slack', 'failed'),
      makeLog('github', 'GitHub', 'success'),
    ];
    const stats = computeStats(actions);
    expect(stats.byService.slack.count).toBe(2);
    expect(stats.byService.slack.failed).toBe(1);
    expect(stats.byService.slack.label).toBe('Slack');
    expect(stats.byService.github.count).toBe(1);
    expect(stats.byService.github.failed).toBe(0);
  });
});

// ── formatDuration ─────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(350)).toBe('350ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(2100)).toBe('2.1s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(192_000)).toBe('3m 12s');
  });

  it('formats exactly 1 second', () => {
    expect(formatDuration(1000)).toBe('1.0s');
  });

  it('formats zero', () => {
    expect(formatDuration(0)).toBe('0ms');
  });
});

// ── timeAgo ────────────────────────────────────────────────────────────

describe('timeAgo', () => {
  it('returns "just now" for recent timestamps', () => {
    const now = new Date().toISOString();
    expect(timeAgo(now)).toBe('just now');
  });

  it('returns minutes ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(timeAgo(fiveMinAgo)).toBe('5m ago');
  });

  it('returns hours ago', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    expect(timeAgo(twoHoursAgo)).toBe('2h ago');
  });

  it('returns days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(timeAgo(threeDaysAgo)).toBe('3d ago');
  });
});
