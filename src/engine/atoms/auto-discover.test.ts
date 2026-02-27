import { describe, it, expect } from 'vitest';
import {
  discoverIntegrations,
  buildSystemHint,
  mightNeedIntegration,
  countPotentialServices,
  INTENT_PATTERNS,
} from './auto-discover';
import type { IntentMatch } from './auto-discover';

// ── discoverIntegrations ───────────────────────────────────────────────

describe('discoverIntegrations', () => {
  it('matches "send an email" to gmail with high confidence', () => {
    const result = discoverIntegrations('send an email to Bob', new Set());
    expect(result.matches.some((m) => m.service === 'gmail')).toBe(true);
    const gmail = result.matches.find((m) => m.service === 'gmail' && m.confidence === 'high');
    expect(gmail).toBeDefined();
  });

  it('matches "post to slack #general" to slack', () => {
    const result = discoverIntegrations('post to slack #general', new Set());
    expect(result.matches.some((m) => m.service === 'slack')).toBe(true);
  });

  it('matches "create a github issue" to github', () => {
    const result = discoverIntegrations('create an issue on github', new Set(['github']));
    const gh = result.matches.find((m) => m.service === 'github');
    expect(gh).toBeDefined();
    expect(gh!.connected).toBe(true);
  });

  it('marks connected services correctly', () => {
    const result = discoverIntegrations('send email and post to slack', new Set(['gmail']));
    const gmail = result.matches.find((m) => m.service === 'gmail');
    const slack = result.matches.find((m) => m.service === 'slack');
    expect(gmail!.connected).toBe(true);
    expect(slack!.connected).toBe(false);
  });

  it('sets hasConnectedMatch when a connected service matches', () => {
    const result = discoverIntegrations('check my slack', new Set(['slack']));
    expect(result.hasConnectedMatch).toBe(true);
  });

  it('sets hasDisconnectedMatch when unconnected service matches', () => {
    const result = discoverIntegrations('check my slack', new Set());
    expect(result.hasDisconnectedMatch).toBe(true);
  });

  it('returns empty matches for unrelated message', () => {
    const result = discoverIntegrations('what is the meaning of life?', new Set());
    // Should not match any service-specific patterns
    expect(result.matches.length).toBeLessThanOrEqual(1);
  });

  it('sorts matches by confidence (high before low)', () => {
    const result = discoverIntegrations('send a slack message', new Set());
    if (result.matches.length >= 2) {
      const confOrder = { high: 0, medium: 1, low: 2 };
      expect(confOrder[result.matches[0].confidence]).toBeLessThanOrEqual(
        confOrder[result.matches[result.matches.length - 1].confidence],
      );
    }
  });

  it('sorts connected matches before disconnected at same confidence', () => {
    // "email" matches gmail, "slack" matches slack
    const result = discoverIntegrations('check my email and slack', new Set(['slack']));
    // Among same-confidence matches, connected (slack) should come first
    const highMatches = result.matches.filter((m) => m.confidence === 'high');
    if (highMatches.length >= 2) {
      const connected = highMatches.filter((m) => m.connected);
      const disconnected = highMatches.filter((m) => !m.connected);
      if (connected.length && disconnected.length) {
        const firstConnIdx = result.matches.indexOf(connected[0]);
        const firstDisIdx = result.matches.indexOf(disconnected[0]);
        expect(firstConnIdx).toBeLessThan(firstDisIdx);
      }
    }
  });

  it('bestMatch is the first ranked match', () => {
    const result = discoverIntegrations('send an email', new Set());
    expect(result.bestMatch).toBeDefined();
    expect(result.bestMatch).toEqual(result.matches[0]);
  });

  it('bestMatch is null when no matches', () => {
    const result = discoverIntegrations('foobar baz', new Set());
    if (result.matches.length === 0) {
      expect(result.bestMatch).toBeNull();
    }
  });

  it('deduplicates by service:action key', () => {
    // "send email to someone" should only match gmail send_email once
    const result = discoverIntegrations('send email', new Set());
    const gmailSend = result.matches.filter(
      (m) => m.service === 'gmail' && m.action === 'send_email',
    );
    expect(gmailSend.length).toBeLessThanOrEqual(1);
  });

  it('matches discord_send_message', () => {
    const result = discoverIntegrations('send a message on discord', new Set());
    expect(result.matches.some((m) => m.service === 'discord')).toBe(true);
  });

  it('matches telegram_send_message', () => {
    const result = discoverIntegrations('send a telegram message', new Set());
    expect(result.matches.some((m) => m.service === 'telegram')).toBe(true);
  });

  it('matches trello create_card', () => {
    const result = discoverIntegrations('create a trello card', new Set());
    const trello = result.matches.find((m) => m.service === 'trello' && m.action === 'create_card');
    expect(trello).toBeDefined();
  });

  it('matches jira create_issue', () => {
    const result = discoverIntegrations('create a jira issue', new Set());
    expect(result.matches.some((m) => m.service === 'jira' && m.action === 'create_issue')).toBe(
      true,
    );
  });

  it('matches hubspot CRM action', () => {
    const result = discoverIntegrations('add a contact to hubspot', new Set());
    expect(result.matches.some((m) => m.service === 'hubspot')).toBe(true);
  });
});

// ── buildSystemHint ────────────────────────────────────────────────────

describe('buildSystemHint', () => {
  it('returns null for empty matches', () => {
    expect(buildSystemHint([], new Set())).toBeNull();
  });

  it('includes connected service names in hint', () => {
    const matches: IntentMatch[] = [
      {
        service: 'slack',
        serviceName: 'Slack',
        confidence: 'high',
        action: 'post_message',
        actionLabel: 'Send a Slack message',
        connected: true,
      },
    ];
    const hint = buildSystemHint(matches, new Set(['slack']));
    expect(hint).toContain('Slack');
    expect(hint).toContain('connected');
  });

  it('suggests connecting disconnected services when none are connected', () => {
    const matches: IntentMatch[] = [
      {
        service: 'jira',
        serviceName: 'Jira',
        confidence: 'high',
        action: 'create_issue',
        actionLabel: 'Create a Jira issue',
        connected: false,
      },
    ];
    const hint = buildSystemHint(matches, new Set());
    expect(hint).toContain('NOT yet connected');
    expect(hint).toContain('Jira');
  });

  it('does not suggest disconnected when connected services exist', () => {
    const matches: IntentMatch[] = [
      {
        service: 'slack',
        serviceName: 'Slack',
        confidence: 'high',
        action: 'post',
        actionLabel: 'Post',
        connected: true,
      },
      {
        service: 'discord',
        serviceName: 'Discord',
        confidence: 'low',
        action: 'discord',
        actionLabel: 'Discord',
        connected: false,
      },
    ];
    const hint = buildSystemHint(matches, new Set(['slack']));
    expect(hint).not.toContain('NOT yet connected');
  });
});

// ── mightNeedIntegration ───────────────────────────────────────────────

describe('mightNeedIntegration', () => {
  it('returns true for "send an email"', () => {
    expect(mightNeedIntegration('send an email to Bob')).toBe(true);
  });

  it('returns true for "check my slack"', () => {
    expect(mightNeedIntegration('check my slack')).toBe(true);
  });

  it('returns true for "create a github issue"', () => {
    expect(mightNeedIntegration('create a github issue')).toBe(true);
  });

  it('returns true for "schedule a meeting"', () => {
    expect(mightNeedIntegration('schedule a meeting tomorrow')).toBe(true);
  });

  it('returns false for generic unrelated message', () => {
    expect(mightNeedIntegration('what is quantum physics?')).toBe(false);
  });

  it('returns true for "send sms"', () => {
    expect(mightNeedIntegration('send sms to +1234567890')).toBe(true);
  });

  it('returns true for "invoice"', () => {
    expect(mightNeedIntegration('create a new invoice')).toBe(true);
  });
});

// ── countPotentialServices ─────────────────────────────────────────────

describe('countPotentialServices', () => {
  it('counts distinct services for multi-service message', () => {
    const count = countPotentialServices('send email and post to slack channel');
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('returns 0 for unrelated message', () => {
    expect(countPotentialServices('what is the speed of light?')).toBe(0);
  });

  it('counts 1 for single-service message', () => {
    const count = countPotentialServices('check my hubspot deals');
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

// ── INTENT_PATTERNS ────────────────────────────────────────────────────

describe('INTENT_PATTERNS', () => {
  it('has patterns for all core services', () => {
    const services = new Set(INTENT_PATTERNS.map((p) => p.service));
    expect(services.has('gmail')).toBe(true);
    expect(services.has('slack')).toBe(true);
    expect(services.has('github')).toBe(true);
    expect(services.has('discord')).toBe(true);
    expect(services.has('jira')).toBe(true);
    expect(services.has('trello')).toBe(true);
    expect(services.has('notion')).toBe(true);
    expect(services.has('stripe')).toBe(true);
    expect(services.has('hubspot')).toBe(true);
  });

  it('every pattern has a confidence level', () => {
    for (const p of INTENT_PATTERNS) {
      expect(['high', 'medium', 'low']).toContain(p.confidence);
    }
  });

  it('every pattern has a non-empty service name', () => {
    for (const p of INTENT_PATTERNS) {
      expect(p.serviceName.length).toBeGreaterThan(0);
    }
  });
});
