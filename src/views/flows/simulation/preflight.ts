// ─────────────────────────────────────────────────────────────────────────────
// Pre-flight Safety Report — Flow Analysis & Dry-Run Report Card
//
// Analyzes a flow graph BEFORE execution and produces a human-readable
// safety report covering:
//   - Blast radius: how many tools, what node kinds, fan-out width
//   - Data egress: which nodes send data externally (HTTP, MCP, agent)
//   - Destructive risk: nodes that could delete/modify data
//   - Credential exposure: which credentials are needed
//   - Simulation result: pass/fail from a dry-run Holodeck simulation
//   - Cost estimate: estimated tool calls and LLM invocations
//
// This is the "prove it's safe before you run it" feature.
// ─────────────────────────────────────────────────────────────────────────────

import type { FlowGraph, FlowNodeKind } from '../atoms';
import { runSimulation, type SimScenario, type SimResult, type SimMockConfig } from '../simulation';

// ── Report Types ───────────────────────────────────────────────────────────

export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

export interface SafetyFinding {
  /** What was found */
  title: string;
  /** Detailed explanation */
  detail: string;
  /** Severity */
  risk: RiskLevel;
  /** Which node(s) are involved */
  nodeIds: string[];
  /** Category of finding */
  category: 'blast-radius' | 'data-egress' | 'destructive' | 'credential' | 'complexity';
}

export interface CostEstimate {
  /** Estimated number of LLM calls */
  llmCalls: number;
  /** Estimated number of tool/MCP calls */
  toolCalls: number;
  /** Estimated number of HTTP requests */
  httpRequests: number;
  /** Nodes involved in external calls */
  externalNodes: string[];
}

export interface PreflightReport {
  /** Unique report ID */
  id: string;
  /** Timestamp of report generation */
  timestamp: string;
  /** Flow graph that was analyzed */
  flowId: string;
  flowName: string;
  /** Overall risk assessment */
  overallRisk: RiskLevel;
  /** Blast radius score (0-100) */
  blastRadius: number;
  /** Detailed findings */
  findings: SafetyFinding[];
  /** Cost estimate */
  costEstimate: CostEstimate;
  /** Node count by kind */
  nodeBreakdown: Record<string, number>;
  /** Total nodes / edges */
  totalNodes: number;
  totalEdges: number;
  /** Maximum fan-out (widest parallel branch) */
  maxFanOut: number;
  /** Maximum chain depth */
  maxDepth: number;
  /** Dry-run simulation result (null if skipped) */
  simulationResult: SimResult | null;
  /** Whether the report recommends proceeding */
  recommendation: 'proceed' | 'review' | 'block';
  /** Human-readable summary */
  summary: string;
}

// ── Static Analysis ────────────────────────────────────────────────────────

/** Node kinds that send data externally */
const EGRESS_KINDS: Set<FlowNodeKind> = new Set(['http', 'mcp-tool', 'agent', 'output', 'squad']);

/** Node kinds that could modify/delete data */
const DESTRUCTIVE_KINDS: Set<FlowNodeKind> = new Set(['tool', 'mcp-tool', 'code', 'http']);

/** Node kinds that involve LLM calls */
const LLM_KINDS: Set<FlowNodeKind> = new Set(['agent', 'squad']);

/** Keywords in node config/labels that suggest destructive operations */
const DESTRUCTIVE_KEYWORDS = [
  'delete',
  'remove',
  'drop',
  'destroy',
  'purge',
  'erase',
  'truncate',
  'kill',
  'terminate',
  'revoke',
  'disable',
  'shutdown',
  'format',
  'overwrite',
  'reset',
  'wipe',
  'uninstall',
];

/** Keywords suggesting credential/secret usage */
const CREDENTIAL_KEYWORDS = [
  'api_key',
  'apikey',
  'api-key',
  'token',
  'secret',
  'password',
  'credential',
  'oauth',
  'auth',
  'bearer',
  'jwt',
];

function analyzeBlastRadius(graph: FlowGraph): {
  fanOut: number;
  depth: number;
  score: number;
} {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }

  // Max fan-out: maximum number of outgoing edges from any node
  let maxFanOut = 0;
  for (const [, targets] of adjacency) {
    maxFanOut = Math.max(maxFanOut, targets.length);
  }

  // Max depth: longest path from any trigger node
  const triggers = graph.nodes.filter((n) => n.kind === 'trigger');
  let maxDepth = 0;

  function dfs(nodeId: string, depth: number, visited: Set<string>) {
    maxDepth = Math.max(maxDepth, depth);
    const neighbors = adjacency.get(nodeId) ?? [];
    for (const next of neighbors) {
      if (!visited.has(next)) {
        visited.add(next);
        dfs(next, depth + 1, visited);
        visited.delete(next);
      }
    }
  }

  for (const trigger of triggers) {
    dfs(trigger.id, 0, new Set([trigger.id]));
  }

  // If no triggers, try from all root nodes (no incoming edges)
  if (triggers.length === 0) {
    const hasIncoming = new Set(graph.edges.map((e) => e.to));
    const roots = graph.nodes.filter((n) => !hasIncoming.has(n.id));
    for (const root of roots) {
      dfs(root.id, 0, new Set([root.id]));
    }
  }

  // Score: weighted combination of node count, fan-out, and depth
  const nodeCount = graph.nodes.length;
  const score = Math.min(
    100,
    Math.round(
      nodeCount * 2 +
        maxFanOut * 10 +
        maxDepth * 5 +
        graph.nodes.filter((n) => EGRESS_KINDS.has(n.kind)).length * 8 +
        graph.nodes.filter((n) => DESTRUCTIVE_KINDS.has(n.kind)).length * 12,
    ),
  );

  return { fanOut: maxFanOut, depth: maxDepth, score };
}

function findDestructiveNodes(graph: FlowGraph): SafetyFinding[] {
  const findings: SafetyFinding[] = [];

  for (const node of graph.nodes) {
    if (!DESTRUCTIVE_KINDS.has(node.kind)) continue;

    const configStr = JSON.stringify(node.config).toLowerCase();
    const labelStr = `${node.label} ${node.description ?? ''}`.toLowerCase();
    const combined = `${configStr} ${labelStr}`;

    const matchedKeywords = DESTRUCTIVE_KEYWORDS.filter((kw) => combined.includes(kw));
    if (matchedKeywords.length > 0) {
      findings.push({
        title: `Potentially destructive: ${node.label}`,
        detail: `Node "${node.label}" (${node.kind}) contains destructive keywords: ${matchedKeywords.join(', ')}. Review before execution.`,
        risk: matchedKeywords.some((k) =>
          ['delete', 'drop', 'destroy', 'purge', 'wipe', 'format'].includes(k),
        )
          ? 'high'
          : 'medium',
        nodeIds: [node.id],
        category: 'destructive',
      });
    }
  }

  return findings;
}

function findEgressNodes(graph: FlowGraph): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  const egressNodes = graph.nodes.filter((n) => EGRESS_KINDS.has(n.kind));

  if (egressNodes.length > 0) {
    const httpNodes = egressNodes.filter((n) => n.kind === 'http');
    const mcpNodes = egressNodes.filter((n) => n.kind === 'mcp-tool');

    if (httpNodes.length > 0) {
      findings.push({
        title: `${httpNodes.length} HTTP request node(s)`,
        detail: `Nodes that send data to external URLs: ${httpNodes.map((n) => `"${n.label}"`).join(', ')}. Data will leave this machine.`,
        risk: httpNodes.length > 3 ? 'high' : 'medium',
        nodeIds: httpNodes.map((n) => n.id),
        category: 'data-egress',
      });
    }

    if (mcpNodes.length > 0) {
      findings.push({
        title: `${mcpNodes.length} MCP tool node(s)`,
        detail: `MCP tool calls: ${mcpNodes.map((n) => `"${n.label}"`).join(', ')}. These invoke external tool servers.`,
        risk: 'medium',
        nodeIds: mcpNodes.map((n) => n.id),
        category: 'data-egress',
      });
    }
  }

  return findings;
}

function findCredentialExposure(graph: FlowGraph): SafetyFinding[] {
  const findings: SafetyFinding[] = [];

  for (const node of graph.nodes) {
    const configStr = JSON.stringify(node.config).toLowerCase();
    const matched = CREDENTIAL_KEYWORDS.filter((kw) => configStr.includes(kw));

    if (matched.length > 0) {
      findings.push({
        title: `Credential reference: ${node.label}`,
        detail: `Node "${node.label}" references credential-related config: ${matched.join(', ')}. Ensure credentials are securely stored in the vault.`,
        risk: 'low',
        nodeIds: [node.id],
        category: 'credential',
      });
    }
  }

  return findings;
}

function estimateCost(graph: FlowGraph): CostEstimate {
  let llmCalls = 0;
  let toolCalls = 0;
  let httpRequests = 0;
  const externalNodes: string[] = [];

  for (const node of graph.nodes) {
    if (LLM_KINDS.has(node.kind)) {
      llmCalls++;
      externalNodes.push(node.id);
    }
    if (node.kind === 'tool' || node.kind === 'mcp-tool') {
      toolCalls++;
      externalNodes.push(node.id);
    }
    if (node.kind === 'http') {
      httpRequests++;
      externalNodes.push(node.id);
    }
  }

  return { llmCalls, toolCalls, httpRequests, externalNodes };
}

function computeOverallRisk(findings: SafetyFinding[], blastRadius: number): RiskLevel {
  const hasHigh = findings.some((f) => f.risk === 'high');
  const hasCritical = findings.some((f) => f.risk === 'critical');
  const mediumCount = findings.filter((f) => f.risk === 'medium').length;

  if (hasCritical) return 'critical';
  if (hasHigh && blastRadius > 60) return 'critical';
  if (hasHigh) return 'high';
  if (mediumCount >= 3 || blastRadius > 50) return 'medium';
  if (findings.length > 0) return 'low';
  return 'safe';
}

function buildSummary(report: Omit<PreflightReport, 'summary'>): string {
  const lines: string[] = [];

  lines.push(`Flow "${report.flowName}" — ${report.totalNodes} nodes, ${report.totalEdges} edges`);
  lines.push(
    `Blast radius: ${report.blastRadius}/100 | Max fan-out: ${report.maxFanOut} | Max depth: ${report.maxDepth}`,
  );

  if (report.costEstimate.llmCalls > 0) {
    lines.push(
      `Estimated: ${report.costEstimate.llmCalls} LLM calls, ${report.costEstimate.toolCalls} tool calls, ${report.costEstimate.httpRequests} HTTP requests`,
    );
  }

  const highFindings = report.findings.filter((f) => f.risk === 'high' || f.risk === 'critical');
  if (highFindings.length > 0) {
    lines.push(`⚠ ${highFindings.length} high-risk finding(s):`);
    for (const f of highFindings) {
      lines.push(`  • ${f.title}`);
    }
  }

  if (report.simulationResult) {
    lines.push(
      report.simulationResult.passed
        ? `✓ Dry-run simulation PASSED (${report.simulationResult.durationMs}ms)`
        : `✗ Dry-run simulation FAILED: ${report.simulationResult.expectationResults
            .filter((e) => !e.passed)
            .map((e) => e.message)
            .join('; ')}`,
    );
  }

  const rec =
    report.recommendation === 'proceed'
      ? '✓ Recommended: PROCEED'
      : report.recommendation === 'review'
        ? '⚠ Recommended: REVIEW before running'
        : '✗ Recommended: DO NOT RUN without review';
  lines.push(rec);

  return lines.join('\n');
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface PreflightOptions {
  /** Run a dry-run simulation via Holodeck (default: true) */
  runSimulation?: boolean;
  /** Mock config for simulation (uses safe defaults if omitted) */
  simulationMocks?: SimMockConfig;
  /** Timeout for simulation in ms (default: 30000) */
  simulationTimeoutMs?: number;
}

/**
 * Generate a pre-flight safety report for a flow graph.
 * This is the main entry point — call before executing any flow.
 */
export async function generatePreflightReport(
  graph: FlowGraph,
  options: PreflightOptions = {},
): Promise<PreflightReport> {
  const { runSimulation: doSim = true, simulationTimeoutMs = 30000 } = options;

  // Static analysis
  const { fanOut, depth, score: blastRadius } = analyzeBlastRadius(graph);
  const destructiveFindings = findDestructiveNodes(graph);
  const egressFindings = findEgressNodes(graph);
  const credentialFindings = findCredentialExposure(graph);

  const nodeBreakdown: Record<string, number> = {};
  for (const node of graph.nodes) {
    nodeBreakdown[node.kind] = (nodeBreakdown[node.kind] ?? 0) + 1;
  }

  const allFindings = [...destructiveFindings, ...egressFindings, ...credentialFindings];

  // Complexity findings
  if (graph.nodes.length > 20) {
    allFindings.push({
      title: `Complex flow: ${graph.nodes.length} nodes`,
      detail: `Flows with more than 20 nodes are harder to reason about and have higher blast radius. Consider breaking into sub-flows.`,
      risk: graph.nodes.length > 50 ? 'high' : 'medium',
      nodeIds: [],
      category: 'complexity',
    });
  }

  if (fanOut > 5) {
    allFindings.push({
      title: `High fan-out: ${fanOut} parallel branches`,
      detail: `A single node branches into ${fanOut} parallel paths. Failures in one branch may be hard to isolate.`,
      risk: fanOut > 10 ? 'high' : 'medium',
      nodeIds: [],
      category: 'blast-radius',
    });
  }

  const costEstimate = estimateCost(graph);

  // Optional dry-run simulation
  let simulationResult: SimResult | null = null;
  if (doSim && graph.nodes.length > 0) {
    try {
      const scenario: SimScenario = {
        id: `preflight-${graph.id}`,
        name: `Pre-flight: ${graph.name ?? graph.id}`,
        description: 'Automated pre-flight safety simulation',
        category: 'basic',
        tier: graph.nodes.length > 15 ? 'complex' : 'standard',
        graph,
        mocks: options.simulationMocks ?? {
          agentDefault: {
            strategy: 'static',
            response: 'Simulated response for safety check.',
          },
          latencyMs: 5,
          failureRate: 0,
          simulateStreaming: false,
        },
        expectations: [
          {
            type: 'flow-status',
            description: 'Flow completes without errors',
            check: { type: 'flow-status', expectedStatus: 'success' },
          },
        ],
        timeoutMs: simulationTimeoutMs,
      };

      simulationResult = await runSimulation(scenario);

      if (!simulationResult.passed) {
        allFindings.push({
          title: 'Dry-run simulation failed',
          detail: `Simulation did not pass: ${simulationResult.expectationResults
            .filter((e) => !e.passed)
            .map((e) => e.message)
            .join('; ')}`,
          risk: 'high',
          nodeIds: [],
          category: 'complexity',
        });
      }
    } catch (err) {
      allFindings.push({
        title: 'Dry-run simulation error',
        detail: `Simulation crashed: ${err instanceof Error ? err.message : String(err)}`,
        risk: 'medium',
        nodeIds: [],
        category: 'complexity',
      });
    }
  }

  const overallRisk = computeOverallRisk(allFindings, blastRadius);
  const recommendation: PreflightReport['recommendation'] =
    overallRisk === 'critical' || overallRisk === 'high'
      ? 'block'
      : overallRisk === 'medium'
        ? 'review'
        : 'proceed';

  const partial: Omit<PreflightReport, 'summary'> = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    flowId: graph.id,
    flowName: graph.name ?? graph.id,
    overallRisk,
    blastRadius,
    findings: allFindings,
    costEstimate,
    nodeBreakdown,
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    maxFanOut: fanOut,
    maxDepth: depth,
    simulationResult,
    recommendation,
  };

  return {
    ...partial,
    summary: buildSummary(partial),
  };
}

// ── Report Renderer (HTML) ─────────────────────────────────────────────────

const RISK_COLORS: Record<RiskLevel, string> = {
  safe: '#22c55e',
  low: '#84cc16',
  medium: '#eab308',
  high: '#f97316',
  critical: '#ef4444',
};

const RISK_LABELS: Record<RiskLevel, string> = {
  safe: '✓ Safe',
  low: '○ Low Risk',
  medium: '⚠ Medium Risk',
  high: '▲ High Risk',
  critical: '✗ Critical Risk',
};

/**
 * Render a pre-flight report as an HTML element suitable for inserting
 * into the flow editor UI. Returns a self-contained DOM element.
 */
export function renderPreflightReport(report: PreflightReport): HTMLElement {
  const container = document.createElement('div');
  container.className = 'preflight-report';
  container.style.cssText = `
    background: var(--bg-secondary, #1a1a2e);
    border: 1px solid var(--border, #333);
    border-radius: 8px;
    padding: 16px;
    margin: 8px 0;
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    line-height: 1.5;
    max-height: 500px;
    overflow-y: auto;
  `;

  const riskColor = RISK_COLORS[report.overallRisk];
  const riskLabel = RISK_LABELS[report.overallRisk];

  let html = `
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
      <div style="
        display: inline-flex; align-items: center; gap: 6px;
        padding: 4px 12px; border-radius: 12px;
        background: ${riskColor}20; color: ${riskColor};
        font-weight: 600; font-size: 14px;
      ">${riskLabel}</div>
      <span style="color: var(--text-muted, #888); font-size: 12px;">
        ${report.totalNodes} nodes · ${report.totalEdges} edges · Blast radius: ${report.blastRadius}/100
      </span>
    </div>

    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px;">
      <div style="background: var(--bg-tertiary, #252540); padding: 8px; border-radius: 6px; text-align: center;">
        <div style="font-size: 18px; font-weight: 700;">${report.costEstimate.llmCalls}</div>
        <div style="font-size: 11px; color: var(--text-muted, #888);">LLM Calls</div>
      </div>
      <div style="background: var(--bg-tertiary, #252540); padding: 8px; border-radius: 6px; text-align: center;">
        <div style="font-size: 18px; font-weight: 700;">${report.costEstimate.toolCalls}</div>
        <div style="font-size: 11px; color: var(--text-muted, #888);">Tool Calls</div>
      </div>
      <div style="background: var(--bg-tertiary, #252540); padding: 8px; border-radius: 6px; text-align: center;">
        <div style="font-size: 18px; font-weight: 700;">${report.costEstimate.httpRequests}</div>
        <div style="font-size: 11px; color: var(--text-muted, #888);">HTTP Requests</div>
      </div>
    </div>
  `;

  // Findings
  if (report.findings.length > 0) {
    html += `<div style="margin-bottom: 12px;">
      <div style="font-weight: 600; margin-bottom: 6px; color: var(--text-primary, #eee);">
        Findings (${report.findings.length})
      </div>`;

    for (const finding of report.findings) {
      const fColor = RISK_COLORS[finding.risk];
      html += `
        <div style="
          padding: 8px; margin-bottom: 4px; border-radius: 4px;
          border-left: 3px solid ${fColor};
          background: ${fColor}08;
        ">
          <div style="font-weight: 600; color: ${fColor};">${finding.title}</div>
          <div style="font-size: 12px; color: var(--text-muted, #aaa);">${finding.detail}</div>
        </div>`;
    }
    html += '</div>';
  }

  // Simulation result
  if (report.simulationResult) {
    const sim = report.simulationResult;
    const simColor = sim.passed ? '#22c55e' : '#ef4444';
    html += `
      <div style="
        padding: 8px; border-radius: 6px; margin-bottom: 12px;
        background: ${simColor}10; border: 1px solid ${simColor}40;
      ">
        <div style="font-weight: 600; color: ${simColor};">
          ${sim.passed ? '✓' : '✗'} Dry-Run Simulation: ${sim.passed ? 'PASSED' : 'FAILED'}
          <span style="font-weight: 400; font-size: 12px;"> (${sim.durationMs}ms)</span>
        </div>
        <div style="font-size: 12px; color: var(--text-muted, #aaa);">
          ${sim.expectationResults.length} checks ·
          ${sim.mockCalls.length} mock calls intercepted ·
          ${sim.events.length} events
        </div>
      </div>`;
  }

  // Recommendation
  const recStyles: Record<string, string> = {
    proceed: 'background: #22c55e20; color: #22c55e; border-color: #22c55e40;',
    review: 'background: #eab30820; color: #eab308; border-color: #eab30840;',
    block: 'background: #ef444420; color: #ef4444; border-color: #ef444440;',
  };
  html += `
    <div style="
      padding: 10px; border-radius: 6px; text-align: center;
      font-weight: 600; border: 1px solid;
      ${recStyles[report.recommendation]}
    ">
      ${
        report.recommendation === 'proceed'
          ? '✓ Ready to execute'
          : report.recommendation === 'review'
            ? '⚠ Review findings before executing'
            : '✗ High-risk flow — manual review required'
      }
    </div>
  `;

  container.innerHTML = html;
  return container;
}
