import { describe, it, expect } from 'vitest';
import {
  remapTool,
  remapToolOrFallback,
  groupToolsByService,
  filterToolsForAgent,
  buildToolSchema,
} from './tool-remap';
import type { RemappedTool, AgentToolAssignment } from './tool-remap';

// ── remapTool ──────────────────────────────────────────────────────────

describe('remapTool', () => {
  it('remaps n8n slack send message', () => {
    const result = remapTool('n8n_slack_post_message');
    expect(result).not.toBeNull();
    expect(result!.service).toBe('slack');
    expect(result!.action).toBe('send_message');
    expect(result!.name).toBe('slack_send_message');
    expect(result!.description).toContain('Slack');
  });

  it('remaps slack_send_message without n8n prefix', () => {
    const result = remapTool('slack_post_message');
    expect(result).not.toBeNull();
    expect(result!.service).toBe('slack');
  });

  it('remaps github_create_issue', () => {
    const result = remapTool('n8n_github_create_issue');
    expect(result).not.toBeNull();
    expect(result!.service).toBe('github');
    expect(result!.action).toBe('create_issue');
  });

  it('remaps github_create_pr', () => {
    const result = remapTool('n8n_github_create_pr');
    expect(result).not.toBeNull();
    expect(result!.action).toBe('create_pr');
  });

  it('remaps gmail_send_email', () => {
    const result = remapTool('n8n_gmail_send_email');
    expect(result).not.toBeNull();
    expect(result!.service).toBe('gmail');
    expect(result!.action).toBe('send_email');
  });

  it('remaps hubspot_list_deals', () => {
    const result = remapTool('n8n_hubspot_list_deals');
    expect(result).not.toBeNull();
    expect(result!.service).toBe('hubspot');
    expect(result!.action).toBe('list_deals');
  });

  it('remaps jira_create_issue', () => {
    const result = remapTool('n8n_jira_create_issue');
    expect(result).not.toBeNull();
    expect(result!.service).toBe('jira');
    expect(result!.action).toBe('create_issue');
  });

  it('remaps trello_create_card', () => {
    const result = remapTool('n8n_trello_create_card');
    expect(result).not.toBeNull();
    expect(result!.service).toBe('trello');
    expect(result!.action).toBe('create_card');
  });

  it('remaps notion_create_page', () => {
    const result = remapTool('n8n_notion_create_page');
    expect(result).not.toBeNull();
    expect(result!.service).toBe('notion');
    expect(result!.action).toBe('create_page');
  });

  it('remaps discord_send_message', () => {
    const result = remapTool('n8n_discord_send_message');
    expect(result).not.toBeNull();
    expect(result!.service).toBe('discord');
    expect(result!.action).toBe('send_message');
  });

  it('remaps telegram_send_message', () => {
    const result = remapTool('n8n_telegram_send_message');
    expect(result).not.toBeNull();
    expect(result!.service).toBe('telegram');
  });

  it('remaps stripe_list_payments', () => {
    const result = remapTool('n8n_stripe_list_payments');
    expect(result).not.toBeNull();
    expect(result!.service).toBe('stripe');
  });

  it('returns null for unknown tool', () => {
    expect(remapTool('totally_unknown_tool')).toBeNull();
  });

  it('preserves params in remapped tool', () => {
    const params = { channel: '#general', text: 'hello' };
    const result = remapTool('slack_post_message', params);
    expect(result!.parameters).toEqual(params);
  });
});

// ── remapToolOrFallback ────────────────────────────────────────────────

describe('remapToolOrFallback', () => {
  it('returns mapped tool for known names', () => {
    const result = remapToolOrFallback('n8n_slack_post_message');
    expect(result.service).toBe('slack');
    expect(result.action).toBe('send_message');
  });

  it('returns fallback for unknown tool with prefix', () => {
    const result = remapToolOrFallback('n8n_custom_do_thing');
    expect(result.name).toBe('n8n_custom_do_thing');
    expect(result.originalName).toBe('n8n_custom_do_thing');
    expect(result.description).toContain('Integration tool');
  });

  it('capitalizes service name in fallback', () => {
    const result = remapToolOrFallback('myservice_do_something');
    expect(result.serviceName.charAt(0)).toBe(result.serviceName.charAt(0).toUpperCase());
  });

  it('always returns a RemappedTool (never null)', () => {
    const result = remapToolOrFallback('completely_random_name');
    expect(result).toBeDefined();
    expect(result.name).toBeDefined();
    expect(result.description).toBeDefined();
  });
});

// ── groupToolsByService ────────────────────────────────────────────────

describe('groupToolsByService', () => {
  const tools: RemappedTool[] = [
    {
      name: 'slack_send_message',
      originalName: 'n8n_slack',
      description: '',
      service: 'slack',
      serviceName: 'Slack',
      action: 'send_message',
      source: 'test',
    },
    {
      name: 'slack_list_channels',
      originalName: 'n8n_slack_list',
      description: '',
      service: 'slack',
      serviceName: 'Slack',
      action: 'list_channels',
      source: 'test',
    },
    {
      name: 'github_create_issue',
      originalName: 'n8n_github',
      description: '',
      service: 'github',
      serviceName: 'GitHub',
      action: 'create_issue',
      source: 'test',
    },
  ];

  it('groups tools by service', () => {
    const groups = groupToolsByService(tools);
    expect(groups).toHaveLength(2);
    const slackGroup = groups.find((g) => g.service === 'slack');
    expect(slackGroup!.tools).toHaveLength(2);
  });

  it('marks connected services', () => {
    const groups = groupToolsByService(tools, ['slack']);
    const slackGroup = groups.find((g) => g.service === 'slack');
    const githubGroup = groups.find((g) => g.service === 'github');
    expect(slackGroup!.connected).toBe(true);
    expect(githubGroup!.connected).toBe(false);
  });

  it('sorts connected services first', () => {
    const groups = groupToolsByService(tools, ['github']);
    expect(groups[0].service).toBe('github');
  });

  it('sorts alphabetically within same connected status', () => {
    const groups = groupToolsByService(tools, []);
    // Both disconnected, should be alphabetical: GitHub before Slack
    expect(groups[0].service).toBe('github');
    expect(groups[1].service).toBe('slack');
  });
});

// ── filterToolsForAgent ────────────────────────────────────────────────

describe('filterToolsForAgent', () => {
  const tools: RemappedTool[] = [
    {
      name: 'slack_send_message',
      originalName: '',
      description: '',
      service: 'slack',
      serviceName: 'Slack',
      action: 'send_message',
      source: '',
    },
    {
      name: 'github_create_issue',
      originalName: '',
      description: '',
      service: 'github',
      serviceName: 'GitHub',
      action: 'create_issue',
      source: '',
    },
    {
      name: 'gmail_send_email',
      originalName: '',
      description: '',
      service: 'gmail',
      serviceName: 'Gmail',
      action: 'send_email',
      source: '',
    },
  ];

  it('filters by wildcard access', () => {
    const assignment: AgentToolAssignment = {
      agentId: 'a1',
      services: { slack: ['*'] },
    };
    const filtered = filterToolsForAgent(tools, assignment);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].service).toBe('slack');
  });

  it('filters by specific tool names', () => {
    const assignment: AgentToolAssignment = {
      agentId: 'a1',
      services: { slack: ['slack_send_message'], github: ['create_issue'] },
    };
    const filtered = filterToolsForAgent(tools, assignment);
    expect(filtered).toHaveLength(2);
  });

  it('excludes services not in assignment', () => {
    const assignment: AgentToolAssignment = {
      agentId: 'a1',
      services: { slack: ['*'] },
    };
    const filtered = filterToolsForAgent(tools, assignment);
    expect(filtered.every((t) => t.service === 'slack')).toBe(true);
  });

  it('returns empty array when no services match', () => {
    const assignment: AgentToolAssignment = {
      agentId: 'a1',
      services: {},
    };
    expect(filterToolsForAgent(tools, assignment)).toHaveLength(0);
  });
});

// ── buildToolSchema ────────────────────────────────────────────────────

describe('buildToolSchema', () => {
  it('builds schema with name and description', () => {
    const tool: RemappedTool = {
      name: 'slack_send_message',
      originalName: 'n8n_slack',
      description: 'Send a Slack message',
      service: 'slack',
      serviceName: 'Slack',
      action: 'send_message',
      source: 'test',
    };
    const schema = buildToolSchema(tool);
    expect(schema.name).toBe('slack_send_message');
    expect(schema.description).toBe('Send a Slack message');
  });

  it('uses provided parameters', () => {
    const tool: RemappedTool = {
      name: 'test',
      originalName: 'test',
      description: 'test',
      service: 'test',
      serviceName: 'Test',
      action: 'test',
      source: 'test',
      parameters: { type: 'object', properties: { text: { type: 'string' } } },
    };
    const schema = buildToolSchema(tool);
    expect(schema.parameters).toHaveProperty('properties');
  });

  it('defaults to empty object parameters when none provided', () => {
    const tool: RemappedTool = {
      name: 'test',
      originalName: 'test',
      description: 'test',
      service: 'test',
      serviceName: 'Test',
      action: 'test',
      source: 'test',
    };
    const schema = buildToolSchema(tool);
    expect(schema.parameters).toEqual({ type: 'object', properties: {} });
  });
});
