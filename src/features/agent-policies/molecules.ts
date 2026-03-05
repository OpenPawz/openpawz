// ─────────────────────────────────────────────────────────────────────────────
// Agent Tool Policies — Molecules
// Composed behaviours: load/save policies, enforce during agent execution.
//
// Security: policies are stored in the encrypted SQLite database, not
// localStorage, so XSS in the webview cannot tamper with them.
// ─────────────────────────────────────────────────────────────────────────────

import {
  type ToolPolicy,
  type PolicyDecision,
  DEFAULT_POLICY,
  checkToolPolicy,
  filterToolsByPolicy,
} from './atoms';
import { loadAgentPoliciesFromDb, saveAgentPoliciesToDb } from '../../db';

// ── Storage ────────────────────────────────────────────────────────────────

/** In-memory cache — populated at init. */
let _cache: Record<string, ToolPolicy> | null = null;

/**
 * Initialise the agent policies cache from the encrypted database.
 * Call once at app startup after initDb().
 */
export async function initAgentPolicies(): Promise<void> {
  try {
    const fromDb = await loadAgentPoliciesFromDb();
    _cache = (fromDb as Record<string, ToolPolicy>) ?? {};
  } catch (e) {
    console.warn('[agent-policies] Failed to init from DB, using empty:', e);
    _cache = {};
  }
}

/**
 * Load all agent tool policies (synchronous — reads from in-memory cache).
 */
export function loadAllPolicies(): Record<string, ToolPolicy> {
  if (_cache) return { ..._cache };
  return {};
}

/**
 * Get the tool policy for a specific agent.
 * Returns DEFAULT_POLICY if none is set.
 */
export function getAgentPolicy(agentId: string): ToolPolicy {
  const all = loadAllPolicies();
  return all[agentId] ?? { ...DEFAULT_POLICY };
}

/**
 * Save a tool policy for a specific agent.
 * Updates in-memory cache immediately; flushes to DB async.
 */
export function setAgentPolicy(agentId: string, policy: ToolPolicy): void {
  if (!_cache) _cache = {};
  _cache[agentId] = policy;
  void saveAgentPoliciesToDb(JSON.stringify(_cache));
}

/**
 * Remove a tool policy for an agent (reverts to default).
 */
export function removeAgentPolicy(agentId: string): void {
  if (!_cache) _cache = {};
  delete _cache[agentId];
  void saveAgentPoliciesToDb(JSON.stringify(_cache));
}

// ── Enforcement ────────────────────────────────────────────────────────────

/**
 * Evaluate whether a tool call should be allowed for a given agent.
 * This is the main enforcement function called during agent execution.
 */
export function enforceToolPolicy(agentId: string, toolName: string): PolicyDecision {
  const policy = getAgentPolicy(agentId);
  return checkToolPolicy(toolName, policy);
}

/**
 * Get the list of tool names an agent is allowed to use.
 * Use this to filter tool definitions sent to the AI model.
 */
export function getAgentAllowedTools(agentId: string, allToolNames: string[]): string[] {
  const policy = getAgentPolicy(agentId);
  return filterToolsByPolicy(allToolNames, policy);
}

/**
 * Build a policy summary string for display in the agent card.
 */
export function getAgentPolicySummary(agentId: string): string {
  const policy = getAgentPolicy(agentId);
  switch (policy.mode) {
    case 'unrestricted':
      return 'Unrestricted';
    case 'allowlist':
      return `${policy.allowed.length} tools allowed`;
    case 'denylist':
      return `${policy.denied.length} tools blocked`;
    default:
      return 'Unrestricted';
  }
}
