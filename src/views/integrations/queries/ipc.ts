// src/views/integrations/queries/ipc.ts — IPC helpers for query commands
//
// Atom-level: thin invoke wrappers, no DOM.

import { invoke } from '@tauri-apps/api/core';
import { SERVICE_CATALOG } from '../catalog';

// ── Types (mirroring backend) ──────────────────────────────────────────

export interface QueryRequest {
  question: string;
  serviceIds: string[];
  category?: string;
}

export interface QueryHistoryEntry {
  id: string;
  question: string;
  serviceIds: string[];
  status: string;
  formatted: string;
  executedAt: string;
}

// ── IPC calls ──────────────────────────────────────────────────────────

export async function executeQuery(request: QueryRequest): Promise<unknown> {
  return invoke('engine_queries_execute', { request });
}

export async function getQueryHistory(): Promise<QueryHistoryEntry[]> {
  return invoke<QueryHistoryEntry[]>('engine_queries_history');
}

export async function clearQueryHistory(): Promise<void> {
  await invoke('engine_queries_clear_history');
}

// ── Service helpers ────────────────────────────────────────────────────

export function svcName(id: string): string {
  return SERVICE_CATALOG.find((s) => s.id === id)?.name ?? id;
}

export function svcIcon(id: string): string {
  return SERVICE_CATALOG.find((s) => s.id === id)?.icon ?? 'extension';
}

export function svcColor(id: string): string {
  return SERVICE_CATALOG.find((s) => s.id === id)?.color ?? '#888';
}
