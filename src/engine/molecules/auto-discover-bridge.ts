// src/engine/molecules/auto-discover-bridge.ts — Integration Auto-Discovery Bridge
//
// Molecule: wires auto-discovery atoms into the chat send path.
// Loads connected service IDs via IPC, runs intent matching, returns
// a system prompt hint to inject into the chat request.

import { invoke } from '@tauri-apps/api/core';
import {
  discoverIntegrations,
  mightNeedIntegration,
  type DiscoveryResult,
} from '../atoms/auto-discover';

// ── Cached connected services ──────────────────────────────────────────

let _connectedCache: Set<string> = new Set();
let _cacheTs = 0;
const CACHE_TTL = 30_000; // refresh every 30s

async function getConnectedIds(): Promise<Set<string>> {
  const now = Date.now();
  if (now - _cacheTs < CACHE_TTL && _connectedCache.size > 0) {
    return _connectedCache;
  }

  try {
    const health: Array<{ service: string }> = await invoke('engine_health_check_services');
    _connectedCache = new Set(health.map((h) => h.service));
    _cacheTs = now;
  } catch {
    // Keep stale cache on failure
  }
  return _connectedCache;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Check a user message for integration intent and return a system prompt
 * hint if relevant. Call this before sending a chat message.
 *
 * Returns null if no integration context is needed (fast path for most messages).
 */
export async function getIntegrationHint(message: string): Promise<string | null> {
  // Fast pre-filter: skip expensive work for unrelated messages
  if (!mightNeedIntegration(message)) return null;

  const connectedIds = await getConnectedIds();
  const result = discoverIntegrations(message, connectedIds);
  return result.systemHint;
}

/**
 * Full discovery result for UI rendering (e.g. suggestion chip in chat).
 */
export async function discoverForMessage(message: string): Promise<DiscoveryResult | null> {
  if (!mightNeedIntegration(message)) return null;
  const connectedIds = await getConnectedIds();
  return discoverIntegrations(message, connectedIds);
}

/**
 * Invalidate the cached connected-services list.
 * Call after a service is connected/disconnected.
 */
export function invalidateConnectedCache(): void {
  _cacheTs = 0;
}
