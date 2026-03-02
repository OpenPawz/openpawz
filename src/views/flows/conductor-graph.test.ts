import { describe, it, expect } from 'vitest';
import {
  classifyNode,
  isStructuredCondition,
  buildAdjacency,
  detectCycles,
  computeDepthLevels,
} from './conductor-graph';
import type { FlowGraph, FlowNode, FlowEdge, FlowNodeKind } from './atoms';

// ── Test factories ─────────────────────────────────────────────────────────

function makeNode(id: string, kind: FlowNodeKind, overrides: Partial<FlowNode> = {}): FlowNode {
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
    ...overrides,
  };
}

function makeEdge(from: string, to: string, kind: 'forward' | 'reverse' = 'forward'): FlowEdge {
  return {
    id: `${from}-${to}`,
    kind,
    from,
    to,
    fromPort: 'out',
    toPort: 'in',
    active: false,
  };
}

function makeGraph(
  nodes: FlowNode[],
  edges: FlowEdge[],
  overrides: Partial<FlowGraph> = {},
): FlowGraph {
  return {
    id: 'test-flow',
    name: 'Test Flow',
    nodes,
    edges,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── classifyNode ───────────────────────────────────────────────────────────

describe('classifyNode', () => {
  it('classifies trigger as passthrough', () => {
    expect(classifyNode(makeNode('1', 'trigger'))).toBe('passthrough');
  });

  it('classifies tool as direct', () => {
    expect(classifyNode(makeNode('1', 'tool'))).toBe('direct');
  });

  it('classifies code as direct', () => {
    expect(classifyNode(makeNode('1', 'code'))).toBe('direct');
  });

  it('classifies output as direct', () => {
    expect(classifyNode(makeNode('1', 'output'))).toBe('direct');
  });

  it('classifies error as direct', () => {
    expect(classifyNode(makeNode('1', 'error'))).toBe('direct');
  });

  it('classifies agent as agent', () => {
    expect(classifyNode(makeNode('1', 'agent'))).toBe('agent');
  });

  it('classifies data as agent', () => {
    expect(classifyNode(makeNode('1', 'data'))).toBe('agent');
  });

  it('classifies loop as direct', () => {
    expect(classifyNode(makeNode('1', 'loop'))).toBe('direct');
  });

  it('classifies group as direct', () => {
    expect(classifyNode(makeNode('1', 'group'))).toBe('direct');
  });

  it('classifies memory as direct', () => {
    expect(classifyNode(makeNode('1', 'memory'))).toBe('direct');
  });

  it('classifies condition with structured expression as direct', () => {
    const node = makeNode('1', 'condition', { config: { conditionExpr: 'data.status === 200' } });
    expect(classifyNode(node)).toBe('direct');
  });

  it('classifies condition without expression as agent', () => {
    const node = makeNode('1', 'condition', { config: {} });
    expect(classifyNode(node)).toBe('agent');
  });

  it('classifies squad as agent', () => {
    expect(classifyNode(makeNode('1', 'squad' as FlowNodeKind))).toBe('agent');
  });
});

// ── isStructuredCondition ──────────────────────────────────────────────────

describe('isStructuredCondition', () => {
  it('recognizes boolean literals', () => {
    expect(isStructuredCondition('true')).toBe(true);
    expect(isStructuredCondition('false')).toBe(true);
    expect(isStructuredCondition('yes')).toBe(true);
    expect(isStructuredCondition('no')).toBe(true);
  });

  it('recognizes comparison operators', () => {
    expect(isStructuredCondition('x === 1')).toBe(true);
    expect(isStructuredCondition('a !== b')).toBe(true);
    expect(isStructuredCondition('count > 10')).toBe(true);
    expect(isStructuredCondition('price < 99')).toBe(true);
    expect(isStructuredCondition('score >= 80')).toBe(true);
    expect(isStructuredCondition('age <= 30')).toBe(true);
    expect(isStructuredCondition('status == 200')).toBe(true);
    expect(isStructuredCondition('type != "error"')).toBe(true);
  });

  it('recognizes dotted property comparisons', () => {
    expect(isStructuredCondition('data.status === 200')).toBe(true);
    expect(isStructuredCondition('input.length > 0')).toBe(true);
  });

  it('rejects natural language conditions', () => {
    expect(isStructuredCondition('is the user happy?')).toBe(false);
    expect(isStructuredCondition('check if active')).toBe(false);
  });
});

// ── buildAdjacency ─────────────────────────────────────────────────────────

describe('buildAdjacency', () => {
  it('builds forward and backward maps', () => {
    const graph = makeGraph(
      [makeNode('a', 'trigger'), makeNode('b', 'agent'), makeNode('c', 'output')],
      [makeEdge('a', 'b'), makeEdge('b', 'c')],
    );
    const { forward, backward } = buildAdjacency(graph);

    expect(forward.get('a')).toEqual(['b']);
    expect(forward.get('b')).toEqual(['c']);
    expect(forward.get('c')).toEqual([]);

    expect(backward.get('a')).toEqual([]);
    expect(backward.get('b')).toEqual(['a']);
    expect(backward.get('c')).toEqual(['b']);
  });

  it('ignores reverse edges', () => {
    const graph = makeGraph(
      [makeNode('a', 'trigger'), makeNode('b', 'agent')],
      [makeEdge('a', 'b', 'forward'), makeEdge('b', 'a', 'reverse')],
    );
    const { forward } = buildAdjacency(graph);
    expect(forward.get('a')).toEqual(['b']);
    // Reverse edge should not appear in forward map
    expect(forward.get('b')).toEqual([]);
  });

  it('handles disconnected nodes', () => {
    const graph = makeGraph([makeNode('a', 'trigger'), makeNode('b', 'agent')], []);
    const { forward, backward } = buildAdjacency(graph);
    expect(forward.get('a')).toEqual([]);
    expect(backward.get('b')).toEqual([]);
  });

  it('handles multiple edges from one node', () => {
    const graph = makeGraph(
      [makeNode('a', 'condition'), makeNode('b', 'agent'), makeNode('c', 'agent')],
      [makeEdge('a', 'b'), makeEdge('a', 'c')],
    );
    const { forward } = buildAdjacency(graph);
    expect(forward.get('a')).toEqual(['b', 'c']);
  });
});

// ── detectCycles ───────────────────────────────────────────────────────────

describe('detectCycles', () => {
  it('detects no cycles in a DAG', () => {
    const graph = makeGraph(
      [makeNode('a', 'trigger'), makeNode('b', 'agent'), makeNode('c', 'output')],
      [makeEdge('a', 'b'), makeEdge('b', 'c')],
    );
    expect(detectCycles(graph)).toHaveLength(0);
  });

  it('detects a simple cycle', () => {
    const graph = makeGraph(
      [makeNode('a', 'agent'), makeNode('b', 'agent')],
      [makeEdge('a', 'b'), makeEdge('b', 'a')],
    );
    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0].has('a')).toBe(true);
    expect(cycles[0].has('b')).toBe(true);
  });

  it('detects a triangle cycle', () => {
    const graph = makeGraph(
      [makeNode('a', 'agent'), makeNode('b', 'agent'), makeNode('c', 'agent')],
      [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'a')],
    );
    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('handles single node with no edges', () => {
    const graph = makeGraph([makeNode('a', 'trigger')], []);
    expect(detectCycles(graph)).toHaveLength(0);
  });

  it('handles empty graph', () => {
    const graph = makeGraph([], []);
    expect(detectCycles(graph)).toHaveLength(0);
  });
});

// ── computeDepthLevels ─────────────────────────────────────────────────────

describe('computeDepthLevels', () => {
  it('assigns depth 0 to root nodes', () => {
    const graph = makeGraph(
      [makeNode('a', 'trigger'), makeNode('b', 'agent'), makeNode('c', 'output')],
      [makeEdge('a', 'b'), makeEdge('b', 'c')],
    );
    const depths = computeDepthLevels(graph, new Set());
    expect(depths.get('a')).toBe(0);
    expect(depths.get('b')).toBe(1);
    expect(depths.get('c')).toBe(2);
  });

  it('handles parallel branches', () => {
    const graph = makeGraph(
      [
        makeNode('a', 'trigger'),
        makeNode('b', 'agent'),
        makeNode('c', 'agent'),
        makeNode('d', 'output'),
      ],
      [makeEdge('a', 'b'), makeEdge('a', 'c'), makeEdge('b', 'd'), makeEdge('c', 'd')],
    );
    const depths = computeDepthLevels(graph, new Set());
    expect(depths.get('a')).toBe(0);
    expect(depths.get('b')).toBe(1);
    expect(depths.get('c')).toBe(1);
    expect(depths.get('d')).toBe(2);
  });

  it('excludes cycle nodes', () => {
    const graph = makeGraph(
      [makeNode('a', 'trigger'), makeNode('b', 'agent'), makeNode('c', 'agent')],
      [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'b')],
    );
    const cycleNodes = new Set(['b', 'c']);
    const depths = computeDepthLevels(graph, cycleNodes);
    expect(depths.get('a')).toBe(0);
    expect(depths.has('b')).toBe(false); // excluded
    expect(depths.has('c')).toBe(false); // excluded
  });

  it('handles single node', () => {
    const graph = makeGraph([makeNode('a', 'trigger')], []);
    const depths = computeDepthLevels(graph, new Set());
    expect(depths.get('a')).toBe(0);
  });
});
