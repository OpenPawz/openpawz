import { describe, it, expect } from 'vitest';
import {
  groupByDepth,
  hasDataDependency,
  splitIntoIndependentGroups,
  buildMeshConfigs,
  textSimilarity,
  checkConvergence,
} from './conductor-parallel';
import type { FlowGraph, FlowNode, FlowEdge, FlowNodeKind } from './atoms';

// ── Factories ──────────────────────────────────────────────────────────────

function makeNode(id: string, kind: FlowNodeKind = 'agent'): FlowNode {
  return {
    id,
    kind,
    label: `Node ${id}`,
    x: 0,
    y: 0,
    width: 200,
    height: 60,
    status: 'idle',
    depth: 0,
    phase: 0,
    config: {},
    inputs: ['in'],
    outputs: ['out'],
  };
}

function makeEdge(from: string, to: string): FlowEdge {
  return {
    id: `${from}-${to}`,
    kind: 'forward',
    from,
    to,
    fromPort: 'out',
    toPort: 'in',
    active: false,
  };
}

function makeGraph(nodes: FlowNode[], edges: FlowEdge[]): FlowGraph {
  return {
    id: 'g1',
    name: 'Test',
    nodes,
    edges,
    createdAt: '',
    updatedAt: '',
  };
}

// ── groupByDepth ───────────────────────────────────────────────────────────

describe('groupByDepth', () => {
  it('groups nodes by their depth', () => {
    const depths = new Map([
      ['a', 0],
      ['b', 1],
      ['c', 1],
      ['d', 2],
    ]);
    const graph = makeGraph([makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')], []);
    const groups = groupByDepth(graph, depths);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toEqual({ depth: 0, nodeIds: ['a'] });
    expect(groups[1].depth).toBe(1);
    expect(groups[1].nodeIds).toContain('b');
    expect(groups[1].nodeIds).toContain('c');
    expect(groups[2]).toEqual({ depth: 2, nodeIds: ['d'] });
  });

  it('returns sorted by depth', () => {
    const depths = new Map([
      ['c', 2],
      ['a', 0],
      ['b', 1],
    ]);
    const graph = makeGraph([makeNode('a'), makeNode('b'), makeNode('c')], []);
    const groups = groupByDepth(graph, depths);
    expect(groups.map((g) => g.depth)).toEqual([0, 1, 2]);
  });

  it('handles empty map', () => {
    const graph = makeGraph([], []);
    expect(groupByDepth(graph, new Map())).toEqual([]);
  });
});

// ── hasDataDependency ──────────────────────────────────────────────────────

describe('hasDataDependency', () => {
  it('detects direct forward edge', () => {
    const graph = makeGraph([makeNode('a'), makeNode('b')], [makeEdge('a', 'b')]);
    expect(hasDataDependency(graph, 'a', 'b')).toBe(true);
  });

  it('detects reverse direction', () => {
    const graph = makeGraph([makeNode('a'), makeNode('b')], [makeEdge('b', 'a')]);
    expect(hasDataDependency(graph, 'a', 'b')).toBe(true);
  });

  it('returns false for no edge', () => {
    const graph = makeGraph([makeNode('a'), makeNode('b')], []);
    expect(hasDataDependency(graph, 'a', 'b')).toBe(false);
  });
});

// ── splitIntoIndependentGroups ─────────────────────────────────────────────

describe('splitIntoIndependentGroups', () => {
  it('returns single item in its own group', () => {
    const graph = makeGraph([makeNode('a')], []);
    expect(splitIntoIndependentGroups(graph, ['a'])).toEqual([['a']]);
  });

  it('splits independent nodes into separate groups', () => {
    const graph = makeGraph(
      [makeNode('a'), makeNode('b'), makeNode('c')],
      [], // no edges → all independent
    );
    const groups = splitIntoIndependentGroups(graph, ['a', 'b', 'c']);
    expect(groups).toHaveLength(3);
    expect(groups.flat()).toContain('a');
    expect(groups.flat()).toContain('b');
    expect(groups.flat()).toContain('c');
  });

  it('groups dependent nodes together', () => {
    const graph = makeGraph(
      [makeNode('a'), makeNode('b'), makeNode('c')],
      [makeEdge('a', 'b')], // a depends on b → same group
    );
    const groups = splitIntoIndependentGroups(graph, ['a', 'b', 'c']);
    expect(groups).toHaveLength(2);
    // a and b should be in the same group
    const abGroup = groups.find((g) => g.includes('a'));
    expect(abGroup).toContain('b');
  });

  it('handles empty input', () => {
    const graph = makeGraph([], []);
    expect(splitIntoIndependentGroups(graph, [])).toEqual([[]]);
  });
});

// ── buildMeshConfigs ───────────────────────────────────────────────────────

describe('buildMeshConfigs', () => {
  it('builds config from cycles', () => {
    const cycles = [new Set(['a', 'b']), new Set(['c', 'd'])];
    const configs = buildMeshConfigs(cycles);
    expect(configs).toHaveLength(2);
    expect(configs[0].maxIterations).toBe(5);
    expect(configs[0].convergenceThreshold).toBe(0.85);
  });

  it('merges overlapping cycles', () => {
    const cycles = [new Set(['a', 'b']), new Set(['b', 'c'])];
    const configs = buildMeshConfigs(cycles);
    expect(configs).toHaveLength(1);
    expect(configs[0].nodeIds).toContain('a');
    expect(configs[0].nodeIds).toContain('b');
    expect(configs[0].nodeIds).toContain('c');
  });

  it('returns empty for no cycles', () => {
    expect(buildMeshConfigs([])).toEqual([]);
  });

  it('respects custom defaults', () => {
    const cycles = [new Set(['a', 'b'])];
    const configs = buildMeshConfigs(cycles, 10, 0.95);
    expect(configs[0].maxIterations).toBe(10);
    expect(configs[0].convergenceThreshold).toBe(0.95);
  });
});

// ── textSimilarity ─────────────────────────────────────────────────────────

describe('textSimilarity', () => {
  it('returns 1 for identical text', () => {
    expect(textSimilarity('hello world', 'hello world')).toBe(1);
  });

  it('returns 0 for completely different text', () => {
    expect(textSimilarity('hello world', 'foo bar')).toBe(0);
  });

  it('returns partial similarity for overlapping words', () => {
    const sim = textSimilarity('hello wonderful world', 'hello cruel world');
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it('is case-insensitive', () => {
    expect(textSimilarity('Hello World', 'hello world')).toBe(1);
  });

  it('returns 0 for empty vs non-empty', () => {
    expect(textSimilarity('', 'hello')).toBe(0);
    expect(textSimilarity('hello', '')).toBe(0);
  });

  it('returns 1 for two empty strings', () => {
    expect(textSimilarity('', '')).toBe(1);
  });
});

// ── checkConvergence ───────────────────────────────────────────────────────

describe('checkConvergence', () => {
  it('returns false for empty previous outputs', () => {
    const curr = new Map([['a', 'hello']]);
    expect(checkConvergence(new Map(), curr, 0.85)).toBe(false);
  });

  it('returns true when outputs are identical (similarity = 1)', () => {
    const prev = new Map([['a', 'hello world']]);
    const curr = new Map([['a', 'hello world']]);
    expect(checkConvergence(prev, curr, 0.85)).toBe(true);
  });

  it('returns false when outputs are very different', () => {
    const prev = new Map([['a', 'apples oranges bananas']]);
    const curr = new Map([['a', 'dogs cats birds']]);
    expect(checkConvergence(prev, curr, 0.85)).toBe(false);
  });

  it('handles multiple nodes', () => {
    const prev = new Map([
      ['a', 'hello world'],
      ['b', 'foo bar baz'],
    ]);
    const curr = new Map([
      ['a', 'hello world'],
      ['b', 'foo bar baz'],
    ]);
    expect(checkConvergence(prev, curr, 0.85)).toBe(true);
  });

  it('returns false when no common node IDs', () => {
    const prev = new Map([['a', 'hello']]);
    const curr = new Map([['b', 'hello']]);
    expect(checkConvergence(prev, curr, 0.85)).toBe(false);
  });
});
