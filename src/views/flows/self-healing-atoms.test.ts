import { describe, it, expect } from 'vitest';
import {
  classifyError,
  isTransientError,
  suggestQuickFixes,
  buildDiagnosisSystemPrompt,
  buildDiagnosisPrompt,
  parseDiagnosisResponse,
  applyFixToConfig,
} from './self-healing-atoms';
import type { FlowNode, FlowGraph } from './atoms';
import type { NodeExecConfig } from './executor-atoms';

// ── Test helpers ───────────────────────────────────────────────────────────

function makeNode(overrides: Partial<FlowNode> = {}): FlowNode {
  return {
    id: 'node-1',
    kind: 'agent',
    label: 'Test Node',
    description: '',
    x: 0,
    y: 0,
    ...overrides,
  } as FlowNode;
}

function makeConfig(overrides: Partial<NodeExecConfig> = {}): NodeExecConfig {
  return {
    prompt: 'Do something',
    timeoutMs: 120000,
    maxRetries: 0,
    ...overrides,
  } as NodeExecConfig;
}

function makeGraph(overrides: Partial<FlowGraph> = {}): FlowGraph {
  return {
    id: 'flow-1',
    name: 'Test Flow',
    nodes: [makeNode()],
    edges: [],
    ...overrides,
  } as FlowGraph;
}

// ── classifyError ──────────────────────────────────────────────────────────

describe('classifyError', () => {
  it('detects timeout errors', () => {
    expect(classifyError('Request timed out after 30s')).toBe('timeout');
    expect(classifyError('ETIMEDOUT')).toBe('timeout');
    expect(classifyError('Connection timeout')).toBe('timeout');
  });

  it('detects rate limit errors', () => {
    expect(classifyError('HTTP 429 Too Many Requests')).toBe('rate-limit');
    expect(classifyError('Rate limit exceeded')).toBe('rate-limit');
  });

  it('detects auth errors', () => {
    expect(classifyError('401 Unauthorized')).toBe('auth');
    expect(classifyError('403 Forbidden')).toBe('auth');
    expect(classifyError('Authentication failed')).toBe('auth');
  });

  it('detects network errors', () => {
    expect(classifyError('ECONNREFUSED')).toBe('network');
    expect(classifyError('ENOTFOUND host.example.com')).toBe('network');
    expect(classifyError('DNS resolution failed')).toBe('network');
  });

  it('detects invalid input errors', () => {
    expect(classifyError('Unexpected token < in JSON')).toBe('invalid-input');
    expect(classifyError('JSON.parse error')).toBe('invalid-input');
  });

  it('detects config errors', () => {
    expect(classifyError('No API key configured')).toBe('config');
    expect(classifyError('Missing config value')).toBe('config');
  });

  it('detects code errors', () => {
    expect(classifyError('Code error: ReferenceError')).toBe('code-error');
    expect(classifyError('Blocked: sandbox violation')).toBe('code-error');
  });

  it('detects API errors', () => {
    expect(classifyError('Server error 500')).toBe('api-error');
    expect(classifyError('API error: bad gateway')).toBe('api-error');
  });

  it('returns "unknown" for unrecognized errors', () => {
    expect(classifyError('Something weird happened')).toBe('unknown');
    expect(classifyError('')).toBe('unknown');
  });
});

// ── isTransientError ───────────────────────────────────────────────────────

describe('isTransientError', () => {
  it('considers timeout as transient', () => {
    expect(isTransientError('Request timed out')).toBe(true);
  });

  it('considers rate limit as transient', () => {
    expect(isTransientError('429 Too Many Requests')).toBe(true);
  });

  it('considers network error as transient', () => {
    expect(isTransientError('ECONNREFUSED')).toBe(true);
  });

  it('does not consider auth error as transient', () => {
    expect(isTransientError('401 Unauthorized')).toBe(false);
  });

  it('does not consider config error as transient', () => {
    expect(isTransientError('Missing config')).toBe(false);
  });

  it('does not consider unknown error as transient', () => {
    expect(isTransientError('Something broke')).toBe(false);
  });
});

// ── suggestQuickFixes ──────────────────────────────────────────────────────

describe('suggestQuickFixes', () => {
  it('suggests timeout increase for timeout errors', () => {
    const fixes = suggestQuickFixes('Request timed out', makeNode(), makeConfig());
    expect(fixes.length).toBeGreaterThan(0);
    const timeoutFix = fixes.find((f) => f.configPatch?.timeoutMs);
    expect(timeoutFix).toBeDefined();
    expect(timeoutFix!.configPatch!.timeoutMs).toBe(240000);
  });

  it('suggests retry for timeout with no retries', () => {
    const fixes = suggestQuickFixes('ETIMEDOUT', makeNode(), makeConfig({ maxRetries: 0 }));
    const retryFix = fixes.find((f) => f.configPatch?.maxRetries);
    expect(retryFix).toBeDefined();
  });

  it('does not suggest retry when retries already configured', () => {
    const fixes = suggestQuickFixes('ETIMEDOUT', makeNode(), makeConfig({ maxRetries: 3 }));
    const retryFix = fixes.find(
      (f) => f.configPatch?.maxRetries && f.description.includes('retry'),
    );
    expect(retryFix).toBeUndefined();
  });

  it('suggests backoff for rate limit errors', () => {
    const fixes = suggestQuickFixes('429 Rate Limited', makeNode(), makeConfig());
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes[0].configPatch?.retryDelayMs).toBeDefined();
    expect(fixes[0].autoApplicable).toBe(true);
  });

  it('suggests credential check for auth errors', () => {
    const fixes = suggestQuickFixes('401 Unauthorized', makeNode(), makeConfig());
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes[0].autoApplicable).toBe(false); // Needs user action
  });

  it('suggests prompt for agent node with no prompt', () => {
    const node = makeNode({ kind: 'agent' });
    const config = makeConfig({ prompt: '' });
    const fixes = suggestQuickFixes('No prompt configured', node, config);
    const promptFix = fixes.find((f) => f.configPatch?.prompt);
    expect(promptFix).toBeDefined();
  });

  it('returns empty array for unknown errors', () => {
    const fixes = suggestQuickFixes('Something weird', makeNode(), makeConfig());
    expect(fixes).toEqual([]);
  });
});

// ── buildDiagnosisSystemPrompt ─────────────────────────────────────────────

describe('buildDiagnosisSystemPrompt', () => {
  it('returns a non-empty prompt string', () => {
    const prompt = buildDiagnosisSystemPrompt();
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('includes JSON output format instruction', () => {
    const prompt = buildDiagnosisSystemPrompt();
    expect(prompt).toContain('rootCause');
    expect(prompt).toContain('fixes');
    expect(prompt).toContain('JSON');
  });
});

// ── buildDiagnosisPrompt ───────────────────────────────────────────────────

describe('buildDiagnosisPrompt', () => {
  it('includes node info', () => {
    const prompt = buildDiagnosisPrompt({
      node: makeNode({ label: 'API Call', kind: 'tool' }),
      config: makeConfig(),
      error: 'Connection refused',
      input: '{"query": "test"}',
      graph: makeGraph(),
    });
    expect(prompt).toContain('API Call');
    expect(prompt).toContain('tool');
  });

  it('includes error and input', () => {
    const prompt = buildDiagnosisPrompt({
      node: makeNode(),
      config: makeConfig(),
      error: 'ECONNREFUSED',
      input: 'hello world',
      graph: makeGraph(),
    });
    expect(prompt).toContain('ECONNREFUSED');
    expect(prompt).toContain('hello world');
  });

  it('includes upstream outputs when present', () => {
    const prompt = buildDiagnosisPrompt({
      node: makeNode(),
      config: makeConfig(),
      error: 'error',
      input: '',
      upstreamOutputs: [{ nodeId: 'n1', label: 'Fetch Data', output: 'result data' }],
      graph: makeGraph(),
    });
    expect(prompt).toContain('Fetch Data');
    expect(prompt).toContain('result data');
  });

  it('shows (empty) when input is empty', () => {
    const prompt = buildDiagnosisPrompt({
      node: makeNode(),
      config: makeConfig(),
      error: 'error',
      input: '',
      graph: makeGraph(),
    });
    expect(prompt).toContain('(empty)');
  });

  it('includes config values', () => {
    const prompt = buildDiagnosisPrompt({
      node: makeNode(),
      config: makeConfig({ prompt: 'Summarize data', timeoutMs: 60000 }),
      error: 'error',
      input: 'test',
      graph: makeGraph(),
    });
    expect(prompt).toContain('Summarize data');
  });
});

// ── parseDiagnosisResponse ─────────────────────────────────────────────────

describe('parseDiagnosisResponse', () => {
  it('parses valid JSON response', () => {
    const json = JSON.stringify({
      rootCause: 'API key expired',
      explanation: 'The stored API key has expired',
      fixes: [
        {
          diagnosis: 'Expired key',
          description: 'Refresh the API key',
          confidence: 0.9,
          autoApplicable: false,
        },
      ],
      isTransient: false,
    });
    const result = parseDiagnosisResponse(json);
    expect(result).not.toBeNull();
    expect(result!.rootCause).toBe('API key expired');
    expect(result!.fixes).toHaveLength(1);
    expect(result!.fixes[0].confidence).toBe(0.9);
  });

  it('parses JSON wrapped in code block', () => {
    const response =
      '```json\n{"rootCause":"test","explanation":"test","fixes":[],"isTransient":true}\n```';
    const result = parseDiagnosisResponse(response);
    expect(result).not.toBeNull();
    expect(result!.rootCause).toBe('test');
    expect(result!.isTransient).toBe(true);
  });

  it('returns null for invalid JSON', () => {
    expect(parseDiagnosisResponse('not json')).toBeNull();
    expect(parseDiagnosisResponse('{invalid')).toBeNull();
  });

  it('returns null for JSON without rootCause', () => {
    expect(parseDiagnosisResponse('{"explanation":"test","fixes":[]}')).toBeNull();
  });

  it('returns null for JSON without fixes array', () => {
    expect(parseDiagnosisResponse('{"rootCause":"test"}')).toBeNull();
  });

  it('uses defaults for missing fix fields', () => {
    const json = JSON.stringify({
      rootCause: 'test',
      fixes: [{}],
    });
    const result = parseDiagnosisResponse(json);
    expect(result!.fixes[0].diagnosis).toBe('');
    expect(result!.fixes[0].description).toBe('');
    expect(result!.fixes[0].confidence).toBe(0.5);
    expect(result!.fixes[0].autoApplicable).toBe(false);
  });
});

// ── applyFixToConfig ───────────────────────────────────────────────────────

describe('applyFixToConfig', () => {
  it('merges configPatch into current config', () => {
    const config = { prompt: 'test', timeoutMs: 30000 };
    const fix = {
      diagnosis: '',
      description: '',
      configPatch: { timeoutMs: 60000 },
      confidence: 0.8,
      autoApplicable: true,
    };
    const result = applyFixToConfig(config, fix);
    expect(result.timeoutMs).toBe(60000);
    expect(result.prompt).toBe('test');
  });

  it('returns original config when no configPatch', () => {
    const config = { prompt: 'test' };
    const fix = {
      diagnosis: '',
      description: '',
      confidence: 0.5,
      autoApplicable: false,
    };
    const result = applyFixToConfig(config, fix);
    expect(result).toBe(config); // same reference
  });

  it('adds new keys from patch', () => {
    const config = { prompt: 'test' };
    const fix = {
      diagnosis: '',
      description: '',
      configPatch: { maxRetries: 3, retryDelayMs: 2000 },
      confidence: 0.7,
      autoApplicable: true,
    };
    const result = applyFixToConfig(config, fix);
    expect(result.maxRetries).toBe(3);
    expect(result.retryDelayMs).toBe(2000);
    expect(result.prompt).toBe('test');
  });

  it('does not mutate original config', () => {
    const config = { timeoutMs: 30000 };
    const fix = {
      diagnosis: '',
      description: '',
      configPatch: { timeoutMs: 60000 },
      confidence: 0.8,
      autoApplicable: true,
    };
    applyFixToConfig(config, fix);
    expect(config.timeoutMs).toBe(30000);
  });
});
