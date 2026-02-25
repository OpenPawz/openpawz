// src/views/integrations/index.ts — Orchestration + public API
//
// Thin barrel: owns module state, re-exports public surface.

import type { ServiceDefinition, ConnectedService } from './atoms';
import { renderIntegrations, initMoleculesState } from './molecules';
import {
  updateIntegrationsHeroStats,
  renderHealthList,
  renderCategoryBreakdown,
  initIntegrationsKinetic,
} from '../../components/integrations-panel';

// ── Module state ───────────────────────────────────────────────────────

let _connected: ConnectedService[] = [];
let _selectedService: ServiceDefinition | null = null;

const { setMoleculesState } = initMoleculesState();
setMoleculesState({
  getConnected: () => _connected,
  setSelectedService: (s) => { _selectedService = s; },
  getSelectedService: () => _selectedService,
});

// ── Public API ─────────────────────────────────────────────────────────

export async function loadIntegrations(): Promise<void> {
  // TODO Phase 2.5+: fetch connected services from backend
  // _connected = await pawEngine.engine_n8n_get_connected_services();
  renderIntegrations();

  // Side panel
  updateIntegrationsHeroStats(_connected);
  renderHealthList(_connected);
  renderCategoryBreakdown();
  initIntegrationsKinetic();

  // Wire quick actions
  _wireQuickActions();
}

export function getConnectedCount(): number {
  return _connected.length;
}

// ── Quick Action Bindings ──────────────────────────────────────────────

function _wireQuickActions(): void {
  document.getElementById('integrations-qa-browse')?.addEventListener('click', () => {
    // Switch to services tab and clear filters
    renderIntegrations();
  });

  document.getElementById('integrations-qa-automations')?.addEventListener('click', () => {
    // Simulate clicking the Automations main tab
    const btn = document.querySelector('.integrations-main-tab[data-main-tab="automations"]') as HTMLElement;
    btn?.click();
  });

  document.getElementById('integrations-qa-queries')?.addEventListener('click', () => {
    const btn = document.querySelector('.integrations-main-tab[data-main-tab="queries"]') as HTMLElement;
    btn?.click();
  });
}

export { SERVICE_CATALOG } from './catalog';
